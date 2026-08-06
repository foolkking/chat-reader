from __future__ import annotations

import hashlib
import json
import uuid
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path, PurePosixPath
from typing import Any, Iterator

from sqlalchemy import DateTime, Uuid, inspect
from sqlalchemy.orm import Session

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
from app.services.assets.asset_store import get_asset_store
from app.services.derived_rebuild import rebuild_conversation_derived_data


SYSTEM_ARCHIVE_FORMAT = "chat-reader-system-archive"
SYSTEM_ARCHIVE_VERSION = 4
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


def create_system_archive(
    db: Session,
    *,
    job_id: uuid.UUID,
    include_archived: bool,
    progress_callback=None,
) -> ExportArtifact:
    conversation_query = db.query(Conversation).filter(Conversation.deleted_at.is_(None))
    if not include_archived:
        conversation_query = conversation_query.filter(Conversation.status == "active")
    conversations = conversation_query.order_by(Conversation.created_at, Conversation.id).all()
    conversation_ids = [row.id for row in conversations]
    message_ids = [
        row[0]
        for row in db.query(Message.id).filter(Message.conversation_id.in_(conversation_ids)).all()
    ] if conversation_ids else []
    version_ids = [
        row[0]
        for row in db.query(MessageVersion.id).filter(MessageVersion.message_id.in_(message_ids)).all()
    ] if message_ids else []
    attachments = db.query(Attachment).filter(
        Attachment.conversation_id.in_(conversation_ids), Attachment.deleted_at.is_(None)
    ).all() if conversation_ids else []
    attachment_ids = [row.id for row in attachments]
    asset_ids = {row.asset_object_id for row in attachments if row.asset_object_id}
    relations = db.query(ProjectConversation).filter(
        ProjectConversation.conversation_id.in_(conversation_ids)
    ).all() if conversation_ids else []
    relation_project_ids = {row.project_id for row in relations}
    projects_query = db.query(Project).filter(Project.id.in_(relation_project_ids) | Project.is_default.is_(True))
    if not include_archived:
        projects_query = projects_query.filter(Project.is_archived.is_(False))
    projects = projects_query.order_by(Project.sort_order, Project.id).all()
    project_ids = {row.id for row in projects}
    relations = [row for row in relations if row.project_id in project_ids]

    rows: dict[str, list[Any]] = {
        "projects": projects,
        "conversations": conversations,
        "project_conversations": relations,
        "messages": db.query(Message).filter(Message.id.in_(message_ids)).order_by(Message.conversation_id, Message.order_key).all() if message_ids else [],
        "message_versions": db.query(MessageVersion).filter(MessageVersion.id.in_(version_ids)).order_by(MessageVersion.message_id, MessageVersion.version_number).all() if version_ids else [],
        "asset_objects": db.query(AssetObject).filter(AssetObject.id.in_(asset_ids)).order_by(AssetObject.id).all() if asset_ids else [],
        "attachments": attachments,
        "attachment_occurrences": db.query(MessageVersionAttachment).filter(MessageVersionAttachment.message_version_id.in_(version_ids)).order_by(MessageVersionAttachment.message_version_id, MessageVersionAttachment.display_order).all() if version_ids else [],
        "annotations": db.query(ConversationAnnotation).filter(ConversationAnnotation.conversation_id.in_(conversation_ids), ConversationAnnotation.is_deleted.is_(False)).order_by(ConversationAnnotation.conversation_id, ConversationAnnotation.created_at).all() if conversation_ids else [],
        "notebooks": db.query(ConversationNotebook).filter(ConversationNotebook.conversation_id.in_(conversation_ids)).order_by(ConversationNotebook.conversation_id, ConversationNotebook.created_at).all() if conversation_ids else [],
        "source_refs": db.query(SourceMessageRef).filter(SourceMessageRef.message_id.in_(message_ids)).order_by(SourceMessageRef.message_id, SourceMessageRef.id).all() if message_ids else [],
        "reading_positions": db.query(ReadingPosition).filter(ReadingPosition.conversation_id.in_(conversation_ids)).order_by(ReadingPosition.conversation_id).all() if conversation_ids else [],
    }

    export_root = Path(get_settings().export_storage_dir).resolve()
    export_dir = (export_root / str(job_id)).resolve()
    if not export_dir.is_relative_to(export_root):
        raise SystemArchiveError("Invalid export storage path.")
    export_dir.mkdir(parents=True, exist_ok=True)
    destination = export_dir / f"chat-reader-system-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}.cr"
    asset_entries: dict[str, tuple[AssetObject, Path]] = {}
    missing_assets = 0
    for asset in rows["asset_objects"]:
        try:
            path = get_asset_store().resolve_key(asset.storage_key)
        except (ValueError, FileNotFoundError):
            missing_assets += 1
            continue
        digest, size = _hash_file(path)
        if digest != asset.sha256 or size != asset.byte_size:
            raise SystemArchiveError("An attachment object failed integrity validation.")
        asset_entries.setdefault(f"assets/objects/{asset.sha256[:2]}/{asset.sha256}", (asset, path))

    files: list[dict[str, Any]] = []
    with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED, allowZip64=True, compresslevel=6) as archive:
        for index, (name, model_rows) in enumerate(rows.items(), start=1):
            entry = f"data/{name}.jsonl"
            digest = hashlib.sha256()
            size = 0
            with archive.open(entry, "w") as output:
                for row in model_rows:
                    payload = _model_payload(row)
                    if name == "message_versions":
                        payload.pop("blocks", None)
                    if name == "asset_objects":
                        archive_path = next((path for path, (asset, _) in asset_entries.items() if asset.id == row.id), None)
                        payload.pop("storage_backend", None)
                        payload.pop("storage_key", None)
                        payload["archive_path"] = archive_path
                    if name == "attachments":
                        payload["import_id"] = None
                    encoded = (json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
                    output.write(encoded)
                    digest.update(encoded)
                    size += len(encoded)
            files.append({"path": entry, "sha256": digest.hexdigest(), "byte_size": size, "record_count": len(model_rows)})
            if progress_callback:
                progress_callback("serializing", min(70, 5 + index * 5), index, len(rows))

        for index, (entry, (_, path)) in enumerate(asset_entries.items(), start=1):
            archive.write(path, entry)
            if progress_callback:
                progress_callback("assets", min(94, 70 + round(index * 24 / max(len(asset_entries), 1))), index, len(asset_entries))

        manifest = {
            "format": SYSTEM_ARCHIVE_FORMAT,
            "version": SYSTEM_ARCHIVE_VERSION,
            "created_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "restore_mode": "empty_instance_only",
            "include_archived": include_archived,
            "canonical_entries": files,
            "assets": {
                "attachment_records": len(attachments),
                "physical_object_records": len(rows["asset_objects"]),
                "included_objects": len(asset_entries),
                "missing_objects": missing_assets,
                "complete": missing_assets == 0,
            },
            "excluded": [
                "search_documents", "render_blocks", "headings", "events", "source_artifacts",
                "temporary_uploads", "asset_derivatives", "logs", "environment", "secrets",
            ],
        }
        archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")

    digest, size = _hash_file(destination)
    artifact = ExportArtifact(
        id=uuid.uuid4(),
        job_id=job_id,
        conversation_id=None,
        scope_type="system",
        format=SYSTEM_ARCHIVE_FORMAT,
        filename=destination.name,
        storage_uri=str(destination),
        sha256=digest,
        byte_size=size,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
    )
    db.add(artifact)
    db.flush()
    return artifact


def restore_system_archive(db: Session, archive_path: Path) -> dict[str, int]:
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
    promoted: list[str] = []
    store = get_asset_store()
    try:
        with zipfile.ZipFile(archive_path) as archive:
            _validate_members(archive)
            manifest = json.loads(archive.read("manifest.json"))
            if manifest.get("format") != SYSTEM_ARCHIVE_FORMAT or int(manifest.get("version", 0)) != SYSTEM_ARCHIVE_VERSION:
                raise SystemArchiveError("Unsupported system archive format.")
            _validate_canonical_entries(archive, manifest)
            records = {name: list(_read_jsonl(archive, f"data/{name}.jsonl")) for name in TABLE_MODELS}
            if db.query(Project.id).filter(Project.is_default.is_(True)).count():
                db.query(Project).filter(Project.is_default.is_(True)).delete(synchronize_session=False)
                db.flush()

            for payload in records["projects"]:
                db.add(Project(**_decode_payload(Project, payload)))
            for payload in records["conversations"]:
                db.add(Conversation(**_decode_payload(Conversation, payload)))
            db.flush()
            for payload in records["messages"]:
                decoded = _decode_payload(Message, payload)
                decoded["current_version_id"] = None
                db.add(Message(**decoded))
            db.flush()
            for payload in records["message_versions"]:
                decoded = _decode_payload(MessageVersion, payload)
                decoded["blocks"] = []
                db.add(MessageVersion(**decoded))
            db.flush()
            for payload in records["messages"]:
                message = db.get(Message, uuid.UUID(payload["id"]))
                message.current_version_id = uuid.UUID(payload["current_version_id"]) if payload.get("current_version_id") else None

            for payload in records["asset_objects"]:
                archive_entry = payload.pop("archive_path", None)
                if not archive_entry:
                    decoded = _decode_payload(AssetObject, payload)
                    decoded.update({
                        "storage_backend": store.backend,
                        "storage_key": f"missing/{decoded['id']}",
                        "status": "missing",
                    })
                    db.add(AssetObject(**decoded))
                    continue
                if not str(archive_entry).startswith("assets/objects/"):
                    raise SystemArchiveError("System archive contains an invalid attachment object path.")
                with archive.open(archive_entry) as source:
                    staged = store.stage(source, max_bytes=get_settings().bundle_max_object_bytes, quarantine=False)
                if staged.sha256 != payload.get("sha256") or staged.byte_size != int(payload.get("byte_size", -1)):
                    staged.path.unlink(missing_ok=True)
                    raise SystemArchiveError("System archive attachment hash mismatch.")
                storage_key = store.object_key()
                store.promote(staged.path, storage_key)
                promoted.append(storage_key)
                decoded = _decode_payload(AssetObject, payload)
                decoded.update({"storage_backend": store.backend, "storage_key": storage_key})
                db.add(AssetObject(**decoded))
            db.flush()

            _restore_rows(db, Attachment, records["attachments"], overrides={"import_id": None})
            _restore_rows(db, ProjectConversation, records["project_conversations"])
            _restore_rows(db, MessageVersionAttachment, records["attachment_occurrences"])
            _restore_rows(db, SourceMessageRef, records["source_refs"])
            _restore_self_referencing_rows(db, ConversationAnnotation, records["annotations"], "conflict_of_id")
            _restore_self_referencing_rows(db, ConversationNotebook, records["notebooks"], "conflict_of_id")
            _restore_rows(db, ReadingPosition, records["reading_positions"])
            db.flush()

            for conversation in db.query(Conversation).order_by(Conversation.id).all():
                rebuild_conversation_derived_data(db, conversation.id)
            db.flush()
            return {name: len(items) for name, items in records.items()}
    except Exception:
        for storage_key in promoted:
            store.delete_key(storage_key)
        raise


def _restore_rows(db: Session, model, rows: list[dict], overrides: dict[str, Any] | None = None) -> None:
    for payload in rows:
        decoded = _decode_payload(model, payload)
        decoded.update(overrides or {})
        db.add(model(**decoded))
    db.flush()


def _restore_self_referencing_rows(db: Session, model, rows: list[dict], field: str) -> None:
    pending: list[tuple[uuid.UUID, uuid.UUID]] = []
    for payload in rows:
        decoded = _decode_payload(model, payload)
        target = decoded.pop(field, None)
        db.add(model(**decoded, **{field: None}))
        if target:
            pending.append((decoded["id"], target))
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
        for line in source:
            if len(line) > get_settings().canjson_max_line_bytes:
                raise SystemArchiveError("System archive contains an oversized JSONL record.")
            if line.strip():
                value = json.loads(line)
                if not isinstance(value, dict):
                    raise SystemArchiveError("System archive JSONL records must be objects.")
                yield value


def _validate_members(archive: zipfile.ZipFile) -> None:
    settings = get_settings()
    infos = archive.infolist()
    if len(infos) > settings.bundle_max_entries:
        raise SystemArchiveError("System archive contains too many files.")
    expanded = 0
    for info in infos:
        path = PurePosixPath(info.filename)
        if path.is_absolute() or ".." in path.parts or "\\" in info.filename:
            raise SystemArchiveError("System archive contains an unsafe path.")
        expanded += info.file_size
        if expanded > settings.bundle_max_expanded_bytes:
            raise SystemArchiveError("System archive exceeds the expanded size limit.")
        if info.compress_size and info.file_size / info.compress_size > settings.bundle_max_compression_ratio:
            raise SystemArchiveError("System archive contains an unsafe compression ratio.")


def _validate_canonical_entries(archive: zipfile.ZipFile, manifest: dict[str, Any]) -> None:
    entries = manifest.get("canonical_entries")
    if not isinstance(entries, list):
        raise SystemArchiveError("System archive manifest is missing canonical entries.")
    expected_paths = {f"data/{name}.jsonl" for name in TABLE_MODELS}
    declared_paths: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict) or not isinstance(entry.get("path"), str):
            raise SystemArchiveError("System archive manifest contains an invalid canonical entry.")
        path = entry["path"]
        if path in declared_paths or path not in expected_paths:
            raise SystemArchiveError("System archive manifest contains an unexpected canonical entry.")
        declared_paths.add(path)
        digest = hashlib.sha256()
        size = 0
        try:
            source = archive.open(path)
        except KeyError as exc:
            raise SystemArchiveError(f"System archive is missing {path}.") from exc
        with source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
                size += len(chunk)
        if digest.hexdigest() != entry.get("sha256") or size != int(entry.get("byte_size", -1)):
            raise SystemArchiveError("System archive canonical entry failed integrity validation.")
    if declared_paths != expected_paths:
        raise SystemArchiveError("System archive manifest does not cover all canonical entries.")


def _hash_file(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
            size += len(chunk)
    return digest.hexdigest(), size
