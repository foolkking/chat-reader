from __future__ import annotations

import hashlib
import json
import re
import stat
import time
import uuid
import zipfile
from copy import copy
from datetime import datetime, timedelta, timezone
from pathlib import Path, PurePosixPath
from typing import Any, Iterator

from sqlalchemy import DateTime, Uuid, inspect, text
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.core.config import get_settings
from app.models.annotation import ConversationAnnotation, ConversationNotebook
from app.models.attachment import AssetObject, Attachment, MessageVersionAttachment
from app.models.conversation import Conversation
from app.models.export_artifact import ExportArtifact
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.project import Project
from app.models.project_conversation import ProjectConversation
from app.models.reading_position import ReadingPosition
from app.models.source_message_ref import SourceMessageRef
from app.models.user import User
from app.services.assets.asset_store import LocalAssetStore, get_asset_store
from app.services.derived_rebuild import rebuild_conversation_derived_data
from app.services.artifact_lifecycle import publish_zip_artifact, staging_path
from app.services.exporting.archive_transaction import archive_read_snapshot, track_archive_object
from app.services.exporting.archive_accounts import (
    IDENTITY_FIELDS, ArchiveOwnershipError, remap_account_payload, restore_account_mapping,
)


SYSTEM_ARCHIVE_FORMAT = "chat-reader-system-archive"
SYSTEM_ARCHIVE_VERSION = 5
SYSTEM_ARCHIVE_MIME = "application/vnd.chat-reader.archive+zip"


class SystemArchiveError(ValueError):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


TABLE_MODELS = {
    "projects": Project,
    "conversations": Conversation,
    "project_conversations": ProjectConversation,
    "messages": Message,
    "message_versions": MessageVersion,
    "asset_objects": AssetObject,
    "attachments": Attachment,
    "attachment_occurrences": MessageVersionAttachment,
    "annotations": ConversationAnnotation,
    "notebooks": ConversationNotebook,
    "source_refs": SourceMessageRef,
    "reading_positions": ReadingPosition,
}


def _export_limit(condition: bool, setting: str) -> None:
    if condition:
        raise SystemArchiveError(
            f"Backup exceeds the configured restore limit ({setting}). "
            "Ask an administrator to review archive capacity before retrying.", 413,
        )


def _check_written_size(archive: zipfile.ZipFile) -> None:
    _export_limit(archive.fp.tell() > get_settings().bundle_max_compressed_bytes, "BUNDLE_MAX_COMPRESSED_BYTES")


def _prepare_restorable_zip(path: Path, *, progress_callback=None) -> None:
    """Keep safety limits intact when legitimate repetitive data compresses too well."""
    settings = get_settings()
    _export_limit(path.stat().st_size > settings.bundle_max_compressed_bytes, "BUNDLE_MAX_COMPRESSED_BYTES")
    repacked = staging_path(path)
    try:
        with zipfile.ZipFile(path) as source:
            infos = source.infolist()
            stored = {info.filename for info in infos if info.file_size > settings.bundle_max_compression_ratio * info.compress_size}
            if stored:
                # Copy one bounded chunk at a time. Only offending entries lose
                # compression; canonical bytes, checksums and identities stay put.
                with zipfile.ZipFile(repacked, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as target:
                    for index, info in enumerate(infos, start=1):
                        output_info = copy(info)
                        if info.filename in stored:
                            output_info.compress_type = zipfile.ZIP_STORED
                        with source.open(info) as incoming, target.open(output_info, "w", force_zip64=True) as outgoing:
                            while chunk := incoming.read(1024 * 1024):
                                outgoing.write(chunk)
                                _check_written_size(target)
                                if progress_callback:
                                    progress_callback("validating", 95, index, len(infos))
        if stored:
            repacked.replace(path)
        _export_limit(path.stat().st_size > settings.bundle_max_compressed_bytes, "BUNDLE_MAX_COMPRESSED_BYTES")
        with zipfile.ZipFile(path) as archive:
            _validate_members(archive)
            _read_manifest(archive)
        if progress_callback:
            progress_callback("validating", 96, len(infos), len(infos))
    finally:
        repacked.unlink(missing_ok=True)


def create_system_archive(
    db: Session,
    *,
    job_id: uuid.UUID,
    include_archived: bool,
    progress_callback=None,
) -> ExportArtifact:
    from app.services.exporting.system_archive_configuration import CONFIGURATION_VERSION, configuration_queries
    from app.services.exporting.system_archive_preflight import inspect_system_archive
    with archive_read_snapshot(db) as snapshot:
        rows = _canonical_queries(snapshot, include_archived=include_archived)
        rows["users"] = snapshot.query(User).order_by(User.id)
        rows.update(configuration_queries(snapshot))
        return _create_data_archive(
            db, rows=rows, job_id=job_id, include_archived=include_archived,
            archive_format=SYSTEM_ARCHIVE_FORMAT, archive_version=SYSTEM_ARCHIVE_VERSION,
            scope_type="system", restore_mode="empty_instance_only", progress_callback=progress_callback,
            payload_transform=lambda name, payload: ({key: value for key, value in payload.items() if key in IDENTITY_FIELDS} if name == "users" else payload),
            manifest_metadata={"configuration_version": CONFIGURATION_VERSION},
            archive_validator=inspect_system_archive,
        )


def _canonical_queries(db: Session, *, include_archived: bool, ownership_scope=None, subject_keys=None):
    """Keep SQL membership on the server; never expand all message IDs into binds."""
    conversation_query = db.query(Conversation).filter(Conversation.deleted_at.is_(None))
    projects_query = db.query(Project)
    if ownership_scope is not None:
        conversation_query = conversation_query.filter(ownership_scope.predicate(Conversation))
        projects_query = projects_query.filter(ownership_scope.predicate(Project))
    if not include_archived:
        conversation_query = conversation_query.filter(Conversation.status == "active")
        projects_query = projects_query.filter(Project.is_archived.is_(False))
    conversation_ids = conversation_query.with_entities(Conversation.id)
    messages = db.query(Message).filter(Message.conversation_id.in_(conversation_ids))
    versions = db.query(MessageVersion).filter(MessageVersion.message_id.in_(messages.with_entities(Message.id)))
    attachments = db.query(Attachment).filter(Attachment.conversation_id.in_(conversation_ids))
    rows = {
        "projects": projects_query.order_by(Project.sort_order, Project.id),
        "conversations": conversation_query.order_by(Conversation.created_at, Conversation.id),
        "project_conversations": db.query(ProjectConversation).filter(
            ProjectConversation.conversation_id.in_(conversation_ids),
            ProjectConversation.project_id.in_(projects_query.with_entities(Project.id)),
        ).order_by(ProjectConversation.project_id, ProjectConversation.conversation_id),
        "messages": messages.order_by(Message.conversation_id, Message.order_key),
        "message_versions": versions.order_by(MessageVersion.message_id, MessageVersion.version_number),
        "asset_objects": db.query(AssetObject).filter(AssetObject.id.in_(attachments.with_entities(Attachment.asset_object_id))).order_by(AssetObject.id),
        "attachments": attachments.order_by(Attachment.id),
        "attachment_occurrences": db.query(MessageVersionAttachment).filter(MessageVersionAttachment.message_version_id.in_(versions.with_entities(MessageVersion.id))).order_by(MessageVersionAttachment.message_version_id, MessageVersionAttachment.display_order),
        "annotations": db.query(ConversationAnnotation).filter(ConversationAnnotation.conversation_id.in_(conversation_ids)).order_by(ConversationAnnotation.conversation_id, ConversationAnnotation.created_at),
        "notebooks": db.query(ConversationNotebook).filter(ConversationNotebook.conversation_id.in_(conversation_ids)).order_by(ConversationNotebook.conversation_id, ConversationNotebook.created_at),
        "source_refs": db.query(SourceMessageRef).filter(SourceMessageRef.message_id.in_(messages.with_entities(Message.id))).order_by(SourceMessageRef.message_id, SourceMessageRef.id),
        "reading_positions": db.query(ReadingPosition).filter(ReadingPosition.conversation_id.in_(conversation_ids)).order_by(ReadingPosition.conversation_id),
    }
    if subject_keys is not None:
        for name, model in (("annotations", ConversationAnnotation), ("notebooks", ConversationNotebook), ("reading_positions", ReadingPosition)):
            rows[name] = rows[name].filter(model.subject_key.in_(subject_keys))
    return rows


def _create_data_archive(
    db: Session, *, rows, job_id: uuid.UUID, include_archived: bool,
    archive_format: str, archive_version: int, scope_type: str, restore_mode: str,
    progress_callback=None, payload_transform=None, manifest_metadata=None, archive_validator=None,
) -> ExportArtifact:
    settings = get_settings()
    export_root = Path(get_settings().export_storage_dir).resolve()
    export_dir = (export_root / str(job_id)).resolve()
    if not export_dir.is_relative_to(export_root):
        raise SystemArchiveError("Invalid export storage path.")
    export_dir.mkdir(parents=True, exist_ok=True)
    destination = export_dir / f"chat-reader-{scope_type}-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}.cr"
    temporary = staging_path(destination)
    asset_entries: dict[str, tuple[AssetObject, Path]] = {}
    missing_assets = 0
    missing_attachments = 0
    unbacked_attachments = 0
    asset_paths: dict[uuid.UUID, str | None] = {}
    for asset in rows["asset_objects"].yield_per(250):
        asset_paths[asset.id] = None
        try:
            path = get_asset_store().resolve_key(asset.storage_key)
        except (ValueError, FileNotFoundError):
            missing_assets += 1
            continue
        if path.stat().st_size != asset.byte_size:
            raise SystemArchiveError("An attachment object failed size validation.")
        _export_limit(asset.byte_size > settings.bundle_max_object_bytes, "BUNDLE_MAX_OBJECT_BYTES")
        entry = f"assets/objects/{asset.sha256[:2]}/{asset.sha256}"
        asset_paths[asset.id] = entry
        asset_entries.setdefault(entry, (asset, path))
        _export_limit(len(asset_entries) > settings.bundle_max_objects, "BUNDLE_MAX_OBJECTS")

    _export_limit(len(rows) + len(asset_entries) + 1 > settings.bundle_max_entries, "BUNDLE_MAX_ENTRIES")
    expanded = 0

    files: list[dict[str, Any]] = []
    counts = {}
    try:
        with zipfile.ZipFile(temporary, "w", zipfile.ZIP_DEFLATED, allowZip64=True, compresslevel=6) as archive:
            for index, (name, query) in enumerate(rows.items(), start=1):
                entry = f"data/{name}.jsonl"
                digest = hashlib.sha256()
                size = 0
                count = 0
                with archive.open(entry, "w") as output:
                    for row in query.yield_per(250):
                        payload = _model_payload(row)
                        if name == "message_versions":
                            payload.pop("blocks", None)
                        if name == "asset_objects":
                            payload.pop("storage_backend", None)
                            payload.pop("storage_key", None)
                            payload["archive_path"] = asset_paths[row.id]
                        if name == "attachments":
                            payload["import_id"] = None
                            if not asset_paths.get(row.asset_object_id):
                                missing_attachments += 1
                                if row.asset_object_id is None:
                                    unbacked_attachments += 1
                        if payload_transform:
                            payload = payload_transform(name, payload)
                        encoded = (json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
                        _export_limit(len(encoded) > settings.canjson_max_line_bytes, "CANJSON_MAX_LINE_BYTES")
                        expanded += len(encoded)
                        _export_limit(expanded > settings.bundle_max_expanded_bytes, "BUNDLE_MAX_EXPANDED_BYTES")
                        output.write(encoded)
                        _check_written_size(archive)
                        digest.update(encoded)
                        size += len(encoded)
                        count += 1
                        if progress_callback and count % 250 == 0:
                            progress_callback("serializing", min(70, 5 + round(index * 65 / len(rows))), index - 1, len(rows))
                counts[name] = count
                files.append({"path": entry, "sha256": digest.hexdigest(), "byte_size": size, "record_count": count})
                if progress_callback:
                    progress_callback("serializing", min(70, 5 + index * 5), index, len(rows))

            for index, (entry, (asset, path)) in enumerate(asset_entries.items(), start=1):
                digest = hashlib.sha256()
                size = 0
                with path.open("rb") as source, archive.open(entry, "w", force_zip64=True) as output:
                    for chunk in iter(lambda: source.read(1024 * 1024), b""):
                        expanded += len(chunk)
                        _export_limit(expanded > settings.bundle_max_expanded_bytes, "BUNDLE_MAX_EXPANDED_BYTES")
                        output.write(chunk)
                        _check_written_size(archive)
                        digest.update(chunk)
                        size += len(chunk)
                        if progress_callback and size % (16 * 1024 * 1024) == 0:
                            progress_callback("assets", min(94, 70 + round(index * 24 / max(len(asset_entries), 1))), index - 1, len(asset_entries))
                if size != asset.byte_size or digest.hexdigest() != asset.sha256:
                    raise SystemArchiveError("An attachment object failed checksum or size validation.")
                if progress_callback:
                    progress_callback("assets", min(94, 70 + round(index * 24 / max(len(asset_entries), 1))), index, len(asset_entries))

            manifest = {
                **(manifest_metadata or {}),
                "format": archive_format,
                "version": archive_version,
                "created_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                "restore_mode": restore_mode,
                "include_archived": include_archived,
                "canonical_entries": files,
                "assets": {
                    "attachment_records": counts["attachments"],
                    "physical_object_records": counts["asset_objects"],
                    "included_objects": len(asset_entries),
                    "missing_objects": missing_assets,
                    "missing_attachments": missing_attachments,
                    "unbacked_attachments": unbacked_attachments,
                    "complete": missing_assets == 0 and missing_attachments == 0,
                },
                "excluded": [
                    "search_documents", "render_blocks", "headings", "events", "source_artifacts",
                    "temporary_uploads", "asset_derivatives", "logs", "environment", "secrets",
                ],
            }
            encoded_manifest = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
            _export_limit(len(encoded_manifest) > settings.canjson_max_line_bytes, "CANJSON_MAX_LINE_BYTES")
            _export_limit(expanded + len(encoded_manifest) > settings.bundle_max_expanded_bytes, "BUNDLE_MAX_EXPANDED_BYTES")
            archive.writestr("manifest.json", encoded_manifest)

        _prepare_restorable_zip(temporary, progress_callback=progress_callback)
        if archive_validator:
            last_report = time.monotonic()
            def heartbeat():
                nonlocal last_report
                if progress_callback and time.monotonic() - last_report >= 1:
                    last_report = time.monotonic()
                    progress_callback("validating", 97, 0, 1)
            archive_validator(temporary, heartbeat=heartbeat)
            if progress_callback:
                progress_callback("validating", 98, 1, 1)
        artifact_id = uuid.uuid4()
        track_archive_object(db, LocalAssetStore(export_root), destination.relative_to(export_root).as_posix())
        published = publish_zip_artifact(
            temporary,
            destination,
            category="export",
            artifact_id=artifact_id,
            required_entries=("manifest.json",),
        )
    finally:
        temporary.unlink(missing_ok=True)
    artifact = ExportArtifact(
        id=artifact_id,
        job_id=job_id,
        conversation_id=None,
        scope_type=scope_type,
        format=archive_format,
        filename=destination.name,
        storage_uri=str(destination),
        sha256=published.sha256,
        byte_size=published.byte_size,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
    )
    db.add(artifact)
    db.flush()
    artifact.archive_summary = {"counts": counts, "missing_attachments": missing_attachments}
    return artifact


def require_empty_system_instance(db: Session) -> None:
    occupied_models = (
        Conversation,
        Message,
        MessageVersion,
        AssetObject,
        Attachment,
        MessageVersionAttachment,
        ConversationAnnotation,
        ConversationNotebook,
        SourceMessageRef,
        ReadingPosition,
        ProjectConversation,
    )
    if any(db.query(model).first() is not None for model in occupied_models):
        raise SystemArchiveError("System archives can only be restored into an empty instance.", 409)
    if db.query(Project.id).filter(Project.is_default.is_(False)).first() is not None:
        raise SystemArchiveError("System archives can only be restored into an empty instance.", 409)


def restore_system_archive(
    db: Session, archive_path: Path, *, target_root_id: uuid.UUID | None = None,
    owner_mapping: dict[str, str] | None = None, expected_digest: str | None = None,
    progress_callback=None, heartbeat=None,
) -> dict[str, int]:
    from app.services.exporting.system_archive_preflight import open_system_archive
    from app.services.exporting.system_archive_configuration import CONFIGURATION_MODELS, require_configuration_restore_target, require_configuration_restore_environment, restore_system_configuration
    require_empty_system_instance(db)
    promoted: list[str] = []
    store = get_asset_store()
    try:
        with open_system_archive(archive_path, heartbeat=heartbeat) as checked:
            if expected_digest is not None and checked.content_digest != expected_digest:
                raise SystemArchiveError("Archive changed since preview. Preview it again.", 409)
            if db.get_bind().dialect.name == "postgresql":
                tables = {model.__tablename__ for model in TABLE_MODELS.values()}
                if checked.has_configuration:
                    # Match the preference service's lock order before locking
                    # its table. Otherwise an in-flight preference save can
                    # hold its advisory lock while waiting for our table lock.
                    from app.services.preferences import _lock as lock_preferences
                    subjects = {str(value) for value in (owner_mapping or {}).values()}
                    if target_root_id:
                        subjects.add(str(target_root_id))
                    for subject in sorted(subjects):
                        lock_preferences(db, subject)
                    tables.update(model.__tablename__ for model in CONFIGURATION_MODELS.values())
                # Only model-defined identifiers enter this statement. Concurrent
                # business writes cannot invalidate the empty-instance check.
                db.execute(text(f"LOCK TABLE {', '.join(sorted(tables))} IN SHARE ROW EXCLUSIVE MODE"))
            require_empty_system_instance(db)
            archive, version = checked.archive, checked.version
            records = {name: checked.rows(name) for name in checked.table_models}
            if checked.has_configuration:
                require_configuration_restore_target(db)
                require_configuration_restore_environment(checked)
            mapping = restore_account_mapping(
                db, identities=records.get("users", []), referenced_owners=checked.referenced_owners,
                target_root_id=target_root_id, owner_mapping=owner_mapping, legacy=version == 4,
                allow_legacy_identity=not get_settings().auth_enabled,
            )
            if progress_callback:
                progress_callback("restoring", 25, 0, checked.counts["conversations"])
            def owned(rows):
                return (remap_account_payload(row, mapping) for row in rows)
            if db.query(Project.id).filter(Project.is_default.is_(True)).count():
                db.query(Project).filter(Project.is_default.is_(True)).delete(synchronize_session=False)
                db.flush()

            used_names: set[tuple[uuid.UUID | None, str]] = set()
            defaults: set[uuid.UUID | None] = set()
            def projects():
                for row in owned(records["projects"]):
                    owner, original = row.get("owner_user_id"), row["name"]
                    counter = 1
                    while (owner, row["name"]) in used_names:
                        counter += 1
                        row["name"] = f"{original} (restored {counter})"
                    used_names.add((owner, row["name"]))
                    if row.get("is_default"):
                        row["is_default"] = owner not in defaults
                        defaults.add(owner)
                    yield row
            _restore_rows(db, Project, projects())
            _restore_rows(db, Conversation, owned(records["conversations"]))
            _restore_rows(db, Message, records["messages"], overrides={"current_version_id": None})
            _restore_rows(db, MessageVersion, records["message_versions"], overrides={"blocks": []})
            for index, payload in enumerate(records["messages"], start=1):
                message = db.get(Message, uuid.UUID(payload["id"]))
                message.current_version_id = uuid.UUID(payload["current_version_id"]) if payload.get("current_version_id") else None
                if index % 250 == 0:
                    db.flush()

            for index, payload in enumerate(records["asset_objects"], start=1):
                if progress_callback:
                    progress_callback("restoring_assets", 45, index - 1, checked.counts["asset_objects"])
                archive_entry = payload.pop("archive_path", None)
                if not archive_entry:
                    decoded = _decode_payload(AssetObject, payload)
                    decoded.update({
                        "storage_backend": store.backend,
                        "storage_key": f"missing/{decoded['id']}",
                        "status": "missing",
                    })
                    db.add(AssetObject(**decoded))
                    if index % 250 == 0:
                        db.flush()
                    continue
                if not str(archive_entry).startswith("assets/objects/"):
                    raise SystemArchiveError("System archive contains an invalid attachment object path.")
                with archive.open(archive_entry) as source:
                    staged = store.stage(source, max_bytes=get_settings().bundle_max_object_bytes, quarantine=False)
                if staged.byte_size != int(payload.get("byte_size", -1)):
                    staged.path.unlink(missing_ok=True)
                    raise SystemArchiveError("System archive attachment size mismatch.")
                if staged.sha256 != payload.get("sha256"):
                    staged.path.unlink(missing_ok=True)
                    raise SystemArchiveError("System archive attachment checksum mismatch.")
                storage_key = store.object_key()
                promoted.append(storage_key)
                track_archive_object(db, store, storage_key)
                try:
                    store.promote(staged.path, storage_key)
                finally:
                    staged.path.unlink(missing_ok=True)
                decoded = _decode_payload(AssetObject, payload)
                decoded.update({"storage_backend": store.backend, "storage_key": storage_key})
                db.add(AssetObject(**decoded))
                if index % 250 == 0:
                    db.flush()
            db.flush()

            _restore_rows(db, Attachment, records["attachments"], overrides={"import_id": None})
            _restore_rows(db, ProjectConversation, records["project_conversations"])
            _restore_rows(db, MessageVersionAttachment, records["attachment_occurrences"])
            _restore_rows(db, SourceMessageRef, records["source_refs"])
            _restore_self_referencing_rows(db, ConversationAnnotation, owned(records["annotations"]), "conflict_of_id")
            _restore_self_referencing_rows(db, ConversationNotebook, owned(records["notebooks"]), "conflict_of_id")
            _restore_rows(db, ReadingPosition, owned(records["reading_positions"]))
            if checked.has_configuration:
                if progress_callback:
                    progress_callback("restoring_configuration", 70, 0, 1)
                restore_system_configuration(db, checked, mapping)
            db.flush()

            for index, payload in enumerate(records["conversations"], start=1):
                rebuild_conversation_derived_data(db, uuid.UUID(payload["id"]))
                if progress_callback:
                    progress_callback("rebuilding", 75 + round(20 * index / max(1, checked.counts["conversations"])), index, checked.counts["conversations"])
            db.flush()
            return {name: len(items) for name, items in records.items()}
    except ArchiveOwnershipError as exc:
        for storage_key in promoted:
            store.delete_key(storage_key)
        raise SystemArchiveError(str(exc), 409) from exc
    except (zipfile.BadZipFile, IntegrityError, KeyError, TypeError, ValueError, UnicodeError) as exc:
        for storage_key in promoted:
            store.delete_key(storage_key)
        if isinstance(exc, SystemArchiveError):
            raise
        raise SystemArchiveError("System archive is malformed or incomplete.") from exc
    except Exception:
        for storage_key in promoted:
            store.delete_key(storage_key)
        raise


def _restore_rows(db: Session, model, rows: list[dict], overrides: dict[str, Any] | None = None) -> None:
    for index, payload in enumerate(rows, start=1):
        decoded = _decode_payload(model, payload)
        decoded.update(overrides or {})
        db.add(model(**decoded))
        if index % 250 == 0:
            db.flush()
    db.flush()


def _restore_self_referencing_rows(db: Session, model, rows: list[dict], field: str) -> None:
    pending: list[tuple[uuid.UUID, uuid.UUID]] = []
    for index, payload in enumerate(rows, start=1):
        decoded = _decode_payload(model, payload)
        target = decoded.pop(field, None)
        db.add(model(**decoded, **{field: None}))
        if target:
            pending.append((decoded["id"], target))
        if index % 250 == 0:
            db.flush()
    db.flush()
    for row_id, target_id in pending:
        setattr(db.get(model, row_id), field, target_id)


def _model_payload(row) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    for prop in inspect(type(row)).column_attrs:
        payload[prop.key] = _encode_value(getattr(row, prop.key))
    return payload


def _encode_value(value):
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    return value


def _decode_payload(model, payload: dict[str, Any]) -> dict[str, Any]:
    output: dict[str, Any] = {}
    mapper = inspect(model)
    properties = {prop.key: prop for prop in mapper.column_attrs}
    for key, value in payload.items():
        prop = properties.get(key)
        if prop is None:
            continue
        column_type = prop.columns[0].type
        if value is not None and isinstance(column_type, Uuid):
            value = uuid.UUID(str(value))
        elif value is not None and isinstance(column_type, DateTime):
            value = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        output[key] = value
    return output


def _read_jsonl(archive: zipfile.ZipFile, name: str) -> Iterator[dict[str, Any]]:
    try:
        source = archive.open(name)
    except KeyError as exc:
        raise SystemArchiveError(f"System archive is missing {name}.") from exc
    with source:
        limit = get_settings().canjson_max_line_bytes
        while line := source.readline(limit + 1):
            if len(line) > limit:
                raise SystemArchiveError("System archive contains an oversized JSONL record.")
            if line.strip():
                value = _read_json(line)
                if not isinstance(value, dict):
                    raise SystemArchiveError("System archive JSONL records must be objects.")
                yield value


class _ArchiveRows:
    """A repeatable, bounded JSONL iterator, with the validated manifest count."""

    def __init__(self, archive: zipfile.ZipFile, path: str, count: int, heartbeat=None) -> None:
        self.archive, self.path, self.count = archive, path, count
        self.heartbeat = heartbeat

    def __iter__(self):
        for index, row in enumerate(_read_jsonl(self.archive, self.path), start=1):
            if self.heartbeat and index % 250 == 0:
                self.heartbeat()
            yield row

    def __len__(self):
        return self.count


def _validate_members(archive: zipfile.ZipFile) -> None:
    settings = get_settings()
    position = archive.fp.tell()
    size = archive.fp.seek(0, 2)
    archive.fp.seek(position)
    if size > settings.bundle_max_compressed_bytes:
        raise SystemArchiveError("System archive exceeds the upload size limit.", 413)
    infos = archive.infolist()
    if len(infos) > settings.bundle_max_entries:
        raise SystemArchiveError("System archive contains too many files.")
    if sum(info.filename.startswith("assets/objects/") and not info.is_dir() for info in infos) > settings.bundle_max_objects:
        raise SystemArchiveError("System archive exceeds the object count limit.")
    expanded = 0
    names: set[str] = set()
    for info in infos:
        path = PurePosixPath(info.filename)
        if (
            not info.filename or info.orig_filename != info.filename
            or path.is_absolute() or ".." in path.parts
            or "\\" in info.filename or ":" in info.filename or "\x00" in info.filename
            or path.as_posix() != info.filename.rstrip("/")
        ):
            raise SystemArchiveError("System archive contains an unsafe path.")
        if path.as_posix() in names:
            raise SystemArchiveError("System archive contains duplicate paths.")
        names.add(path.as_posix())
        mode = stat.S_IFMT(info.external_attr >> 16)
        if info.flag_bits & 1 or mode not in {0, stat.S_IFREG, stat.S_IFDIR}:
            raise SystemArchiveError("System archive contains an unsupported file type.")
        expanded += info.file_size
        if expanded > settings.bundle_max_expanded_bytes:
            raise SystemArchiveError("System archive exceeds the expanded size limit.")
        if info.compress_size and info.file_size / info.compress_size > settings.bundle_max_compression_ratio:
            raise SystemArchiveError("System archive contains an unsafe compression ratio.")


def _validate_canonical_entries(
    archive: zipfile.ZipFile, manifest: dict[str, Any], *, table_names=None, heartbeat=None,
) -> None:
    entries = manifest.get("canonical_entries")
    if not isinstance(entries, list):
        raise SystemArchiveError("System archive manifest is missing canonical entries.")
    expected_paths = {f"data/{name}.jsonl" for name in (TABLE_MODELS if table_names is None else table_names)}
    declared_paths: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict) or not isinstance(entry.get("path"), str):
            raise SystemArchiveError("System archive manifest contains an invalid canonical entry.")
        path = entry["path"]
        if path in declared_paths or path not in expected_paths:
            raise SystemArchiveError("System archive manifest contains an unexpected canonical entry.")
        declared_paths.add(path)
        size = 0
        digest = hashlib.sha256()
        try:
            source = archive.open(path)
        except KeyError as exc:
            raise SystemArchiveError(f"System archive is missing {path}.") from exc
        with source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                size += len(chunk)
                digest.update(chunk)
                if heartbeat:
                    heartbeat()
        if size != int(entry.get("byte_size", -1)):
            raise SystemArchiveError("System archive canonical entry failed size validation.")
        if digest.hexdigest() != entry.get("sha256"):
            raise SystemArchiveError("System archive canonical entry failed checksum validation.")
        if sum(1 for _ in _ArchiveRows(archive, path, 0, heartbeat)) != entry.get("record_count"):
            raise SystemArchiveError("System archive canonical entry failed record count validation.")
    if declared_paths != expected_paths:
        raise SystemArchiveError("System archive manifest does not cover all canonical entries.")


def _read_json(data: bytes):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise SystemArchiveError("System archive contains duplicate JSON keys.")
            result[key] = value
        return result

    def invalid_constant(_):
        raise SystemArchiveError("System archive contains an invalid JSON number.")

    try:
        return json.loads(data, object_pairs_hook=pairs, parse_constant=invalid_constant)
    except (ValueError, UnicodeError, RecursionError) as exc:
        if isinstance(exc, SystemArchiveError):
            raise
        raise SystemArchiveError("System archive contains invalid JSON.") from exc


def _read_manifest(archive: zipfile.ZipFile) -> dict[str, Any]:
    try:
        with archive.open("manifest.json") as source:
            data = source.read(get_settings().canjson_max_line_bytes + 1)
    except KeyError as exc:
        raise SystemArchiveError("System archive is missing its manifest.") from exc
    if len(data) > get_settings().canjson_max_line_bytes:
        raise SystemArchiveError("System archive manifest is too large.")
    manifest = _read_json(data)
    if not isinstance(manifest, dict):
        raise SystemArchiveError("System archive manifest must be an object.")
    return manifest


def _validate_asset_entries(archive: zipfile.ZipFile, records: list[dict], *, heartbeat=None) -> None:
    """Validate all objects before creating any rows or promoting any files."""
    checked: dict[str, tuple[str, int]] = {}
    for payload in records:
        entry = payload.get("archive_path")
        if entry is None:
            continue  # A missing source object remains explicitly missing.
        checksum = payload.get("sha256")
        size = payload.get("byte_size")
        if (
            not isinstance(checksum, str) or not re.fullmatch(r"[0-9a-f]{64}", checksum)
            or not isinstance(size, int) or isinstance(size, bool) or size < 0
            or size > get_settings().bundle_max_object_bytes
            or entry != f"assets/objects/{checksum[:2]}/{checksum}"
        ):
            raise SystemArchiveError("System archive contains invalid attachment metadata.")
        if entry not in checked:
            digest = hashlib.sha256()
            actual_size = 0
            try:
                with archive.open(entry) as source:
                    for chunk in iter(lambda: source.read(1024 * 1024), b""):
                        actual_size += len(chunk)
                        if actual_size > size:
                            raise SystemArchiveError("System archive attachment size mismatch.")
                        digest.update(chunk)
                        if heartbeat:
                            heartbeat()
            except KeyError as exc:
                raise SystemArchiveError("System archive attachment is missing.") from exc
            checked[entry] = digest.hexdigest(), actual_size
        if checked[entry] != (checksum, size):
            raise SystemArchiveError("System archive attachment failed checksum or size validation.")
