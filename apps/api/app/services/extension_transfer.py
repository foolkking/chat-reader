"""One resumable file per device. Accepted chunks belong to an ordinary, owner-scoped import session."""
import errno
import hashlib
import os
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import select

from app.core.config import get_settings
from app.models.import_record import ImportRecord
from app.models.project import Project
from app.models.reader_extension import ExtensionDevice
from app.models.source_artifact import SourceArtifact
from app.services.adaptive_import.bounded_io import file_hash
from app.services.adaptive_import.contracts import AdaptiveImportError
from app.services.adaptive_import.ordering import remember_source
from app.services.adaptive_import.service import _session_root, begin_session, queue_session_analysis
from app.services.adaptive_import.upload_receipts import find_upload_request, lock_upload_request, request_key, staged_binding
from app.services.feature_policies import effective_import_size_mb, get_feature_policy
from app.services.ownership import get_owned

CHUNK_BYTES = 4 * 1024 * 1024


def _policy(db, scope):
    if not get_settings().reader_extension_capture or not get_feature_policy(db).allow_user_import:
        raise HTTPException(403)
    return effective_import_size_mb(db, scope.owner_user_id) * 1024 * 1024


def _target(db, scope, target):
    if target is not None:
        project = get_owned(db, Project, target, scope)
        if not project or project.is_archived:
            raise HTTPException(409, "The destination project is unavailable.")
        if project.is_default:
            return None
    return target


def _identity(device, key):
    return uuid.uuid5(uuid.UUID(str(device)), f"reader-upload/{key}")


def _lock_request(db, scope, key):
    try:
        lock_upload_request(db, scope, key)
    except AdaptiveImportError as exc:
        raise HTTPException(409, {"code": exc.code}) from exc


def _record(db, scope, device, key):
    record = db.scalar(select(ImportRecord).where(ImportRecord.id == _identity(device, key),
                       ImportRecord.owner_user_id == scope.owner_user_id).with_for_update())
    if record and record.analysis_summary.get("extension_device") == str(device):
        return record
    raise HTTPException(404)


def _part(record):
    path = _session_root(record.id) / "reader.zip"
    if path.is_symlink() or (path.exists() and not path.is_file()):
        raise HTTPException(409, "Staged source is unavailable.")
    return path


def _state(record):
    receipt = record.analysis_summary["extension_transfer"]
    if receipt.get("accepted"):
        return {"id": record.id, "offset": receipt["size"], "size": receipt["size"], "chunk_bytes": CHUNK_BYTES}
    if record.phase != "receiving" or record.session_state != "COLLECTING":
        raise HTTPException(409, "This upload has been closed.")
    return {"id": None, "offset": record.total_bytes, "size": receipt["size"], "chunk_bytes": CHUNK_BYTES}


def begin(db, scope, device, key, size, digest, target, excerpt):
    _lock_request(db, scope, key)
    maximum = _policy(db, scope)
    if size > maximum:
        raise HTTPException(413, {"code": "FILE_TOO_LARGE", "max_bytes": maximum})
    if excerpt and target is not None:
        raise HTTPException(422)
    # Serializes two different keys on one device as well as identical retries.
    if not db.scalar(select(ExtensionDevice.id).where(ExtensionDevice.id == device,
                     ExtensionDevice.user_id == scope.owner_user_id).with_for_update()):
        raise HTTPException(403)
    identity = _identity(device, key)
    expected = {"size": size, "sha256": digest, "project": str(target) if target else None, "excerpt": excerpt}
    record = db.get(ImportRecord, identity)
    if record:
        record = _record(db, scope, device, key)
        binding = record.analysis_summary.get("extension_transfer", {})
        if any(binding.get(k) != v for k, v in expected.items()):
            raise HTTPException(409, "The request belongs to another package or destination.")
        return _state(record)
    if find_upload_request(db, scope, key):
        raise HTTPException(409, "The request already belongs to a received import.")
    project = _target(db, scope, target)
    earlier = db.scalars(select(ImportRecord).where(ImportRecord.owner_user_id == scope.owner_user_id,
            ImportRecord.phase == "receiving",
            ImportRecord.analysis_summary["extension_device"].as_string() == str(device)).with_for_update())
    for previous in earlier:
        stamp = previous.updated_at.replace(tzinfo=timezone.utc) if not previous.updated_at.tzinfo else previous.updated_at
        if stamp + timedelta(days=1) > datetime.now(timezone.utc):
            raise HTTPException(409, {"code": "READER_TRANSFER_PENDING"})
        discard(previous)
    record = begin_session(db, 1, target_project_id=project, owner_user_id=scope.owner_user_id, record_id=identity)
    record.phase = "receiving"
    record.analysis_summary = {**record.analysis_summary, "extension_device": str(device), "extension_transfer": expected,
                               **({"append_only": {"device": str(device)}} if excerpt else {})}
    db.commit()
    return _state(record)


def discard(record):
    if ((record.analysis_summary or {}).get("extension_transfer", {}).get("accepted") or record.artifacts
            or not (record.phase == "receiving" and record.session_state == "COLLECTING"
                    or record.session_state == "CANCELED")):
        raise HTTPException(409, "The package has already left the upload stage.")
    _part(record).unlink(missing_ok=True)
    record.phase, record.status, record.session_state = "cancelled", "cancelled", "CANCELED"


def chunk(db, scope, device, key, offset, digest, upload):
    maximum = _policy(db, scope)
    record = _record(db, scope, device, key)
    state = _state(record)
    if state["id"] or offset != state["offset"]:
        raise HTTPException(409, {"code": "READER_TRANSFER_OFFSET"})
    if state["size"] > maximum:
        raise HTTPException(413, {"code": "FILE_TOO_LARGE", "max_bytes": maximum})
    expected = min(CHUNK_BYTES, state["size"] - offset)
    if expected <= 0 or upload.size != expected:
        raise HTTPException(422, "Unexpected chunk length.")
    path = _part(record)
    try:
        path.parent.mkdir(exist_ok=True, parents=True)
        with path.open("r+b" if path.exists() else "x+b") as target:
            if target.seek(0, os.SEEK_END) < offset:
                raise HTTPException(409, "Staged source requires recovery.")
            # A crash after fsync and before SQL commit can leave one unacknowledged suffix.
            target.seek(offset)
            actual, remaining = hashlib.sha256(), expected
            while remaining:
                part = upload.file.read(min(65536, remaining))
                if not part:
                    raise HTTPException(422, "Incomplete chunk.")
                actual.update(part)
                target.write(part)
                remaining -= len(part)
            if actual.hexdigest() != digest or upload.file.read(1):
                target.truncate(offset)
                raise HTTPException(422, "Chunk checksum mismatch.")
            target.truncate()
            target.flush()
            os.fsync(target.fileno())
    except OSError as exc:
        if exc.errno in {errno.ENOSPC, errno.EDQUOT}:
            raise HTTPException(507, {"code": "IMPORT_STORAGE_FULL"}) from exc
        raise
    record.total_bytes += expected
    db.commit()
    return _state(record)


def finish(db, scope, device, key):
    _lock_request(db, scope, key)
    maximum = _policy(db, scope)
    record = _record(db, scope, device, key)
    state = _state(record)
    if state["id"]:
        return state
    binding = record.analysis_summary["extension_transfer"]
    if state["size"] > maximum:
        raise HTTPException(413, {"code": "FILE_TOO_LARGE", "max_bytes": maximum})
    target = uuid.UUID(binding["project"]) if binding["project"] else None
    actual_target = _target(db, scope, target)
    if (record.analysis_summary or {}).get("target_project_id") != (str(actual_target) if actual_target else None):
        raise HTTPException(409, "The destination changed while uploading. Review it before starting again.")
    if find_upload_request(db, scope, key):
        raise HTTPException(409, "The request already belongs to another received import.")
    path = _part(record)
    if record.total_bytes != state["size"] or not path.is_file() or path.stat().st_size != state["size"]:
        raise HTTPException(409, "Upload is incomplete.")
    if file_hash(path) != binding["sha256"]:
        raise HTTPException(422, "Archive checksum mismatch.")
    artifact = SourceArtifact(id=uuid.uuid4(), import_id=record.id, source_type="adaptive_archive", source_profile="unknown",
        filename="reader.zip", safe_filename=path.name, sha256=binding["sha256"], byte_size=record.total_bytes,
        mime_guess="application/zip", file_extension=".zip", raw_storage_uri=f"storage/imports/{record.id}/{path.name}", parsed_summary={})
    record.artifacts.append(artifact)
    remember_source(record, artifact.id)
    db.flush()
    record.analysis_summary = {**record.analysis_summary, "extension_transfer": {**binding, "accepted": True}}
    job = queue_session_analysis(db, record)
    job.idempotency_key = request_key(key)
    job.payload = {**job.payload, "upload_binding": staged_binding(record, None, target)}
    db.commit()
    return _state(record)
