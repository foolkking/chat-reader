from __future__ import annotations

import hashlib
import json
import re
import uuid
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.annotation import ConversationAnnotation, ConversationNotebook
from app.models.attachment import Attachment, AssetObject, MessageVersionAttachment
from app.models.conversation import Conversation
from app.models.conversation_event import ConversationEvent
from app.models.export_artifact import ExportArtifact
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.project import Project
from app.models.project_conversation import ProjectConversation
from app.services.assets.asset_store import get_asset_store
from app.services.assets.scanner import scan_status_allows_use


CONTEXT_PACKAGE_FORMAT = "chat-reader-context-package"
CONTEXT_PACKAGE_VERSION = "1.0"
CONTEXT_PACKAGE_MIME = "application/zip"
ProgressCallback = Callable[[str, int, int, int], None]

class ContextPackageError(ValueError):
    pass


def create_context_package(
    db: Session,
    *,
    conversation_id: uuid.UUID,
    job_id: uuid.UUID,
    scope_kind: str,
    start_message_id: uuid.UUID | None,
    progress_callback: ProgressCallback | None = None,
) -> ExportArtifact:
    if scope_kind not in {"full_conversation", "reading_scope"}:
        raise ContextPackageError("Unsupported context package scope.")
    conversation = db.get(Conversation, conversation_id)
    if conversation is None or conversation.deleted_at is not None:
        raise ContextPackageError("Conversation not found.")

    messages = (
        db.query(Message, MessageVersion)
        .join(MessageVersion, MessageVersion.id == Message.current_version_id)
        .filter(Message.conversation_id == conversation.id, Message.is_deleted.is_(False))
        .order_by(Message.order_key.asc())
        .all()
    )
    if not messages:
        raise ContextPackageError("Conversation has no exportable messages.")
    all_sequence = {message.id: index for index, (message, _) in enumerate(messages, start=1)}
    if scope_kind == "reading_scope":
        if start_message_id is None or start_message_id not in all_sequence:
            raise ContextPackageError("Reading scope requires a message in this conversation.")
        first_sequence = all_sequence[start_message_id]
        messages = messages[first_sequence - 1 :]
    else:
        first_sequence = 1
    last_sequence = all_sequence[messages[-1][0].id]
    selected_message_ids = [message.id for message, _ in messages]
    selected_version_ids = [version.id for _, version in messages]
    total = max(len(messages), 1)
    package_id = uuid.uuid4()
    exported_at = datetime.now(timezone.utc)

    export_root = Path(get_settings().export_storage_dir).resolve()
    export_dir = (export_root / str(job_id)).resolve()
    if not export_dir.is_relative_to(export_root):
        raise ContextPackageError("Invalid export storage path.")
    export_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{_safe_filename(conversation.display_title)}.context.zip"
    destination = export_dir / filename
    jsonl_path = export_dir / "conversation.canjsonl.tmp"

    links = (
        db.query(MessageVersionAttachment)
        .filter(MessageVersionAttachment.message_version_id.in_(selected_version_ids))
        .order_by(MessageVersionAttachment.message_version_id, MessageVersionAttachment.display_order)
        .all()
    )
    links_by_version: dict[uuid.UUID, list[MessageVersionAttachment]] = {}
    for link in links:
        links_by_version.setdefault(link.message_version_id, []).append(link)
    attachments = {
        row.id: row
        for row in db.query(Attachment).filter(
            Attachment.conversation_id == conversation.id,
            Attachment.deleted_at.is_(None),
        ).all()
    }
    message_seq = {message.id: all_sequence[message.id] for message, _ in messages}

    records: list[dict[str, Any]] = [
        {
            "record_type": "header",
            "schema": "chat-reader-canjson",
            "version": "2.1",
            "package_id": str(package_id),
            "conversation_revision": conversation.offline_revision,
        },
        {
            "record_type": "conversation",
            "id": str(conversation.id),
            "title": conversation.title,
            "display_title": conversation.display_title,
            "description": conversation.description_markdown,
            "created_at": _dt(conversation.created_at),
            "updated_at": _dt(conversation.updated_at),
            "message_count": len(messages),
        },
    ]
    project_context = _project_context(db, conversation.id)
    if project_context is not None:
        records.append(project_context)

    for processed, (message, version) in enumerate(messages, start=1):
        records.append({
            "record_type": "message",
            "id": str(message.id),
            "seq": all_sequence[message.id],
            "order_key": message.order_key,
            "role": message.role,
            "author_label": message.author_label,
            "created_at": _dt(message.created_at),
            "current_version": {
                "id": str(version.id),
                "version_number": version.version_number,
                "content_hash": version.content_hash,
                "plain_text": version.plain_text,
                "display_text": version.display_text,
            },
            "attachment_refs": [
                {
                    "attachment_id": str(link.attachment_id),
                    "occurrence_key": link.occurrence_key,
                    "placement": link.placement,
                    "relation_type": link.relation_type,
                    "display_order": link.display_order,
                    "display_mode": link.display_mode,
                    "alt": link.alt_text,
                    "caption": link.caption,
                }
                for link in links_by_version.get(version.id, [])
                if link.attachment_id in attachments
            ],
        })
        _report(progress_callback, "serializing", min(55, round(processed * 55 / total)), processed, total)

    asset_entries: dict[str, tuple[AssetObject, Path]] = {}
    available_objects: set[uuid.UUID] = set()
    missing_objects: set[str] = set()
    excluded_objects: set[uuid.UUID] = set()
    available_attachments = 0
    for attachment in sorted(attachments.values(), key=lambda item: str(item.id)):
        asset = attachment.asset_object
        resolution_status = attachment.resolution_status
        object_payload = None
        if asset is None or asset.status != "available" or not scan_status_allows_use(asset.scan_status):
            resolution_status = "missing"
            missing_objects.add(str(asset.id if asset is not None else attachment.id))
        else:
            source_path = get_asset_store().resolve_key(asset.storage_key)
            if not source_path.is_file():
                resolution_status = "missing"
                missing_objects.add(str(asset.id))
            else:
                digest, byte_size = _hash_file(source_path)
                if digest != asset.sha256 or byte_size != asset.byte_size:
                    raise ContextPackageError("Attachment integrity check failed.")
                object_path = f"assets/objects/{asset.sha256[:2]}/{asset.sha256}"
                object_payload = {
                    "path": object_path,
                    "sha256": asset.sha256,
                    "byte_size": asset.byte_size,
                }
                asset_entries.setdefault(object_path, (asset, source_path))
                available_objects.add(asset.id)
                available_attachments += 1
        records.append({
            "record_type": "attachment",
            "id": str(attachment.id),
            "original_filename": attachment.original_filename,
            "display_name": attachment.display_name,
            "declared_mime_type": attachment.declared_mime_type,
            "detected_mime_type": asset.detected_mime_type if asset is not None else None,
            "scan_status": attachment.scan_status,
            "relation_status": "active",
            "resolution_status": resolution_status,
            "object": object_payload,
            "source": {
                "source_type": attachment.source_type,
                "source_attachment_id": attachment.source_attachment_id,
            },
        })

    annotations = (
        db.query(ConversationAnnotation)
        .filter(
            ConversationAnnotation.conversation_id == conversation.id,
            ConversationAnnotation.subject_key == "local:default",
            ConversationAnnotation.is_deleted.is_(False),
            ConversationAnnotation.message_id.in_(selected_message_ids),
        )
        .order_by(ConversationAnnotation.created_at.asc())
        .all()
    )
    for annotation in annotations:
        records.append({
            "record_type": "annotation",
            "id": str(annotation.id),
            "message_id": str(annotation.message_id) if annotation.message_id else None,
            "message_seq": message_seq.get(annotation.message_id),
            "quote": annotation.quote,
            "comment": annotation.comment_markdown,
            "status": annotation.anchor_status,
        })
    notebook = (
        db.query(ConversationNotebook)
        .filter(
            ConversationNotebook.conversation_id == conversation.id,
            ConversationNotebook.subject_key == "local:default",
            ConversationNotebook.is_conflict.is_(False),
        )
        .order_by(ConversationNotebook.created_at.asc())
        .first()
    )
    if notebook is not None:
        markdown = "\n\n".join(
            str(block.get("markdown") or "")
            for block in notebook.blocks
            if isinstance(block, dict) and block.get("type") == "markdown" and block.get("markdown")
        )
        records.append({
            "record_type": "notebook_entry",
            "id": str(notebook.id),
            "title": notebook.title,
            "content_markdown": markdown,
            "created_at": _dt(notebook.created_at),
        })

    with jsonl_path.open("wb") as output:
        for record in records:
            output.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
            output.write(b"\n")
    jsonl_sha, jsonl_size = _hash_file(jsonl_path)
    manifest = {
        "format": CONTEXT_PACKAGE_FORMAT,
        "format_version": CONTEXT_PACKAGE_VERSION,
        "package_id": str(package_id),
        "exported_at": _dt(exported_at),
        "producer": {"name": "chat-reader", "version": "1.0.0", "canjson_version": "2.1"},
        "entrypoint": "conversation.canjsonl",
        "scope": {
            "kind": scope_kind,
            "conversation_id": str(conversation.id),
            "conversation_revision": conversation.offline_revision,
            "current_versions_only": True,
            "first_message_seq": first_sequence,
            "last_message_seq": last_sequence,
            "message_count": len(messages),
            "is_complete_conversation": first_sequence == 1 and last_sequence == len(all_sequence),
        },
        "included_content": {
            "conversation_description": True,
            "annotations": True,
            "notebook": True,
            "attachment_metadata": True,
            "attachment_binary_objects": bool(asset_entries),
        },
        "files": [{"path": "conversation.canjsonl", "sha256": jsonl_sha, "byte_size": jsonl_size}],
        "assets": {
            "attachment_records": len(attachments),
            "physical_objects": len({item.asset_object_id for item in attachments.values() if item.asset_object_id}),
            "available_objects": len(asset_entries),
            "missing_objects": len(missing_objects),
            "excluded_sensitive_objects": len(excluded_objects),
            "total_available_bytes": sum(asset.byte_size for asset, _ in asset_entries.values()),
        },
        "conversation_completeness": (
            "complete" if first_sequence == 1 and last_sequence == len(all_sequence) else "partial"
        ),
        "asset_completeness": (
            "none"
            if not attachments
            else "partial"
            if missing_objects or excluded_objects
            else "complete"
        ),
        "attachments": {
            "requested": True,
            "metadata_included": True,
            "binary_objects_included": bool(asset_entries),
            "record_count": len(attachments),
            "reference_count": len(links),
            "resolved_attachment_count": available_attachments,
            "physical_object_count": len({item.asset_object_id for item in attachments.values() if item.asset_object_id}),
            "available_object_count": len(asset_entries),
            "missing_object_count": len(missing_objects),
            "excluded_object_count": len(excluded_objects),
            "completeness": (
                "none"
                if not attachments
                else "partial"
                if missing_objects or excluded_objects
                else "complete"
            ),
        },
    }
    try:
        with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True, compresslevel=6) as archive:
            archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8"))
            archive.write(jsonl_path, "conversation.canjsonl")
            for index, (object_path, (_, source_path)) in enumerate(asset_entries.items(), start=1):
                archive.write(source_path, object_path)
                _report(progress_callback, "packaging_assets", 55 + round(index * 40 / max(len(asset_entries), 1)), len(messages), total)
    finally:
        jsonl_path.unlink(missing_ok=True)

    digest, byte_size = _hash_file(destination)
    artifact = ExportArtifact(
        id=uuid.uuid4(),
        job_id=job_id,
        conversation_id=conversation.id,
        format=CONTEXT_PACKAGE_FORMAT,
        filename=filename,
        storage_uri=str(destination),
        sha256=digest,
        byte_size=byte_size,
        expires_at=exported_at + timedelta(hours=24),
    )
    db.add(artifact)
    db.add(ConversationEvent(
        id=uuid.uuid4(),
        conversation_id=conversation.id,
        event_type="context_package_exported",
        payload={
            "scope_kind": scope_kind,
            "message_count": len(messages),
            "attachment_count": len(attachments),
            "excluded_sensitive_objects": len(excluded_objects),
        },
        created_by="user",
    ))
    db.flush()
    _report(progress_callback, "publishing", 99, total, total)
    return artifact


def _project_context(db: Session, conversation_id: uuid.UUID) -> dict[str, Any] | None:
    row = (
        db.query(Project)
        .join(ProjectConversation, ProjectConversation.project_id == Project.id)
        .filter(ProjectConversation.conversation_id == conversation_id, Project.is_default.is_(False))
        .one_or_none()
    )
    if row is None:
        return None
    return {
        "record_type": "project_context",
        "project_id": str(row.id),
        "name": row.name,
        "description": row.description,
        "conversation_role": "member",
    }


def _hash_file(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    byte_size = 0
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
            byte_size += len(chunk)
    return digest.hexdigest(), byte_size


def _safe_filename(value: str) -> str:
    cleaned = re.sub(r"[\\/:*?\"<>|\x00-\x1f]+", "-", value).strip(" .")
    return (cleaned[:120] or "conversation")


def _dt(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _report(callback: ProgressCallback | None, phase: str, progress: int, processed: int, total: int) -> None:
    if callback is not None:
        callback(phase, progress, processed, total)
