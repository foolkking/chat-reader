"""Version 2 internal draft manifest, published only after all records validate."""
import hashlib
import json
import os
import uuid
from contextlib import nullcontext
from dataclasses import fields
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.core.config import get_settings
from app.services.adaptive_import.bounded_io import file_hash
from app.services.adaptive_import.stream_markdown import decode_message
from app.services.import_pipeline.canonical_draft import CanonicalDraftConversation
from app.services.import_pipeline.record_spool import MappedSequence, RecordSpool


def attach_stream_draft(record, conversations):
    root = Path(get_settings().import_storage_dir).resolve()
    directory = (root / str(record.id)).resolve()
    if directory.parent != root:
        raise ValueError("Invalid draft directory.")
    directory.mkdir(parents=True, exist_ok=True)
    generation = uuid.uuid4().hex
    path = directory / f"canonical-draft-v2-{generation}.json"
    counts = {"conversation_count": 0, "message_count": 0}

    def headers():
        for draft in conversations:
            spool = draft.stream_records
            if not isinstance(spool, RecordSpool):
                raise ValueError("Bounded imports require message-level spools.")
            counts["conversation_count"] += 1
            counts["message_count"] += len(spool)
            payload = {field.name: getattr(draft, field.name) for field in fields(draft)
                       if field.name not in {"messages", "stream_records"}}
            payload["records"] = spool.descriptor()
            yield payload
    header_spool = RecordSpool.write(directory, headers(), prefix="conversations")
    payload = {"version": 2, "owner": str(record.owner_user_id), "source_fingerprint": record.source_fingerprint,
               "generation": generation, "conversations": header_spool.descriptor(), **counts}
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    with path.open("xb") as target:
        target.write(raw)
        target.flush()
        os.fsync(target.fileno())
    record.draft_storage_uri = str(path.relative_to(root))
    record.draft_sha256 = hashlib.sha256(raw).hexdigest()
    record.draft_summary = {"format_version": 2, **counts}
    record.draft_expires_at = datetime.now(timezone.utc) + timedelta(hours=get_settings().import_draft_ttl_hours)


def iter_stream_draft(record, *, db=None):
    from app.services.adaptive_import.memory_budget import import_analysis_admission
    from app.services.import_pipeline.draft_store import ImportDraftError
    root = Path(get_settings().import_storage_dir).resolve()
    path = (root / (record.draft_storage_uri or "")).resolve()
    expiry = record.draft_expires_at
    if expiry and (expiry.replace(tzinfo=timezone.utc) if expiry.tzinfo is None else expiry) <= datetime.now(timezone.utc):
        raise ImportDraftError("Import draft has expired.")
    try:
        admission = import_analysis_admission(db, record, stage="commit") if db is not None else nullcontext()
        with admission:
            if path.parent != root / str(record.id) or not path.is_file() or path.stat().st_size > 65536:
                raise ImportDraftError("Import draft is missing.")
            if file_hash(path) != record.draft_sha256:
                raise ImportDraftError("Import draft integrity check failed.")
            manifest = json.loads(path.read_bytes())
            if (manifest["version"] != 2 or manifest["owner"] != str(record.owner_user_id)
                    or manifest["source_fingerprint"] != record.source_fingerprint):
                raise ImportDraftError("Import draft source changed.")
            from app.services.adaptive_import.archive_sources import _artifact_path
            for artifact in record.artifacts:
                if file_hash(_artifact_path(record, artifact)) != artifact.sha256:
                    raise ImportDraftError("Import source integrity check failed.")
            headers = RecordSpool.open_verified(path.parent, manifest["conversations"])
            count = messages = 0
            for header in headers:
                spool = RecordSpool.open_verified(path.parent, header.pop("records"))
                count += 1
                messages += len(spool)
                if header["message_count"] != len(spool):
                    raise ImportDraftError("Import draft message count does not match preview.")
                yield CanonicalDraftConversation(**header, stream_records=spool,
                    messages=MappedSequence(spool, lambda raw: decode_message(raw["message"])))
            if (count != manifest["conversation_count"] or messages != manifest["message_count"]
                    or count != record.draft_summary["conversation_count"] or messages != record.draft_summary["message_count"]):
                raise ImportDraftError("Import draft conversation count does not match preview.")
    except (KeyError, TypeError, ValueError, OSError) as exc:
        from app.services.uploads import UploadLimitError
        if isinstance(exc, (ImportDraftError, UploadLimitError)):
            raise
        raise ImportDraftError("Import draft integrity check failed.") from exc
