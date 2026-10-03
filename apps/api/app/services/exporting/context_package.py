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
from app.services.artifact_lifecycle import publish_zip_artifact, staging_path
from app.services.exporting.export_service import _source_refs_by_message


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
    subject_key: str = "local:default",
    output_directory: Path | None = None,
    record_artifact: bool = True,
    include_continuation: bool = True,
    include_attachments: bool = True,
) -> ExportArtifact:
    if scope_kind not in {"full_conversation", "reading_scope"}:
        raise ContextPackageError("Unsupported context package scope.")
    conversation = db.get(Conversation, conversation_id)
    if conversation is None or conversation.deleted_at is not None:
        raise ContextPackageError("Conversation not found.")
    from app.models.context_continuation import ContinuationState
    from app.services.context_dependencies import context_dependency_digest
    source_revision = conversation.offline_revision
    source_dependencies = context_dependency_digest(db, conversation.id, subject_key)
    source_generation = db.query(ContinuationState.generation).filter_by(conversation_id=conversation.id).scalar()

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

    if not record_artifact and output_directory is None:
        raise ContextPackageError("Temporary exports require a private output directory.")
    export_root = (output_directory or Path(get_settings().export_storage_dir)).resolve()
    export_dir = (export_root / str(job_id)).resolve()
    if not export_dir.is_relative_to(export_root):
        raise ContextPackageError("Invalid export storage path.")
    export_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{_safe_filename(conversation.display_title)}.context.zip"
    destination = export_dir / filename
    temporary = staging_path(destination)
    jsonl_path = staging_path(export_dir / "conversation.canjsonl")

    links = (
        db.query(MessageVersionAttachment)
        .filter(MessageVersionAttachment.message_version_id.in_(selected_version_ids))
        .order_by(MessageVersionAttachment.message_version_id, MessageVersionAttachment.display_order)
        .all()
    )
    links_by_version: dict[uuid.UUID, list[MessageVersionAttachment]] = {}
    for link in links:
        links_by_version.setdefault(link.message_version_id, []).append(link)
    attachment_query = db.query(Attachment).filter(
        Attachment.conversation_id == conversation.id,
        Attachment.deleted_at.is_(None),
        Attachment.status != "detached",
    )
    if scope_kind == "reading_scope":
        attachment_query = attachment_query.filter(Attachment.id.in_({link.attachment_id for link in links}))
    attachments = {row.id: row for row in attachment_query.all()}
    message_seq = {message.id: all_sequence[message.id] for message, _ in messages}

    records: list[dict[str, Any]] = [
        {
            "record_type": "manifest",
            "format": "chat-reader-canonical-jsonl",
            "version": 2,
            "package_id": str(package_id),
            "conversation_revision": conversation.offline_revision,
            "exported_at": _dt(exported_at),
            "conversation": {
                "id": str(conversation.id),
                "title": conversation.title,
                "display_title": conversation.display_title,
                "description_markdown": conversation.description_markdown,
                "source_type": conversation.source_type,
                "source_profile": conversation.source_profile,
                "created_at": _dt(conversation.created_at),
                "updated_at": _dt(conversation.updated_at),
            },
            "selection": {
                "scope": "all_current_messages" if scope_kind == "full_conversation" else "selected_messages",
                "message_count": len(messages),
                "first_message_seq": first_sequence,
                "last_message_seq": last_sequence,
            },
            "content": {"format": "markdown", "versions": "current_only", "attachments": "metadata_and_objects" if include_attachments else "metadata_only"},
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
            "turn_index": message.turn_index,
            "author_label": message.author_label,
            "created_at": _dt(message.created_at),
            "current_version": _version_payload(version),
        })
        for link in links_by_version.get(version.id, []):
            if link.attachment_id not in attachments:
                continue
            records.append({
                "record_type": "attachment_ref",
                "message_id": str(message.id),
                "message_version_id": str(version.id),
                "attachment_id": str(link.attachment_id),
                "occurrence_key": link.occurrence_key,
                "placement": link.placement,
                "relation_type": link.relation_type,
                "display_order": link.display_order,
                "block_index": link.block_index,
                "display_mode": link.display_mode,
                "alt_text": link.alt_text,
                "caption": link.caption,
            })
        _report(progress_callback, "serializing", min(55, round(processed * 55 / total)), processed, total)

    for offset in range(0, len(selected_message_ids), 100):
        source_refs = _source_refs_by_message(db, selected_message_ids[offset:offset + 100])
        for refs in source_refs.values():
            records.extend(refs)

    asset_entries: dict[str, tuple[AssetObject, Path]] = {}
    available_objects: set[uuid.UUID] = set()
    missing_objects: set[str] = set()
    excluded_objects: set[uuid.UUID] = set()
    omitted_objects: set[uuid.UUID] = set()
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
                byte_size = source_path.stat().st_size
                if byte_size != asset.byte_size:
                    raise ContextPackageError("Attachment size validation failed.")
                object_path = f"assets/objects/{asset.sha256[:2]}/{asset.sha256}"
                object_payload = {
                    "path": object_path,
                    "sha256": asset.sha256,
                    "byte_size": asset.byte_size,
                }
                if include_attachments:
                    asset_entries.setdefault(object_path, (asset, source_path))
                else:
                    omitted_objects.add(asset.id)
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
            "status": attachment.status,
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
            ConversationAnnotation.subject_key == subject_key,
            ConversationAnnotation.is_deleted.is_(False),
            ConversationAnnotation.message_id.in_(selected_message_ids),
        )
        .order_by(ConversationAnnotation.created_at.asc())
        .all()
    )
    anchor_version_ids = {item.message_version_id for item in annotations if item.message_version_id} - set(selected_version_ids)
    if anchor_version_ids:
        records[0]["content"]["versions"] = "current_plus_annotation_anchors"
        for version in db.query(MessageVersion).filter(
            MessageVersion.id.in_(anchor_version_ids), MessageVersion.message_id.in_(selected_message_ids),
        ).order_by(MessageVersion.message_id, MessageVersion.version_number):
            records.append({"record_type": "message_version", "message_id": str(version.message_id), **_version_payload(version)})
    for annotation in annotations:
        records.append({
            "record_type": "annotation",
            "id": str(annotation.id),
            "message_id": str(annotation.message_id) if annotation.message_id else None,
            "message_seq": message_seq.get(annotation.message_id),
            "version_id": str(annotation.message_version_id) if annotation.message_version_id else None,
            "start_block_index": annotation.start_block_index,
            "start_offset": annotation.start_offset,
            "end_block_index": annotation.end_block_index,
            "end_offset": annotation.end_offset,
            "quoted_text": annotation.quote,
            "annotation_type": annotation.annotation_type,
            "color": annotation.color,
            "comment_markdown": annotation.comment_markdown,
            "anchor_status": annotation.anchor_status,
        })
    notebook = (
        db.query(ConversationNotebook)
        .filter(
            ConversationNotebook.conversation_id == conversation.id,
            ConversationNotebook.subject_key == subject_key,
            ConversationNotebook.is_conflict.is_(False),
        )
        .order_by(ConversationNotebook.created_at.asc())
        .first()
    )
    if notebook is not None:
        annotation_ids = {str(item.id) for item in annotations}
        blocks = [block for block in notebook.blocks if isinstance(block, dict) and (
            block.get("type") == "markdown" or (
                block.get("type") == "annotation_reference" and str(block.get("annotation_id")) in annotation_ids
            )
        )]
        markdown = "\n\n".join(
            str(block.get("markdown") or "")
            for block in blocks
            if isinstance(block, dict) and block.get("type") == "markdown" and block.get("markdown")
        )
        records.append({
            "record_type": "notebook",
            "id": str(notebook.id),
            "title": notebook.title,
            "content_markdown": markdown,
            "blocks": blocks,
            "created_at": _dt(notebook.created_at),
        })

    records.append({"record_type": "end", "record_count": len(records) + 1, "message_count": len(messages)})
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
        "producer": {"name": "chat-reader", "version": "1.0.0", "canjson_version": 2},
        "entrypoint": "conversation.canjsonl",
        "conversation": {
            "id": str(conversation.id),
            "title": conversation.display_title,
            "conversation_revision": conversation.offline_revision,
            "current_versions_only": True,
            "message_count": len(messages),
        },
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
            "source_refs": True,
        },
        "files": {
            "conversation.canjsonl": {"sha256": jsonl_sha, "byte_size": jsonl_size},
            **{path: {"sha256": asset.sha256, "byte_size": asset.byte_size}
               for path, (asset, _) in asset_entries.items()},
        },
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
            if missing_objects or excluded_objects or omitted_objects
            else "complete"
        ),
        "attachments": {
            "requested": include_attachments,
            "policy": "include" if include_attachments else "metadata_only",
            "omitted_object_count": len(omitted_objects),
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
                if missing_objects or excluded_objects or omitted_objects
                else "complete"
            ),
        },
    }
    continuation_members = {}
    if not include_continuation:
        manifest["extensions"] = {"chat_reader_continuation_export": {"version": 1, "status": "omitted_by_request"}}
    if include_continuation:
        from app.services.exporting.context_continuation import carry_continuation
        continuation_members, continuation_metadata, continuation_status = carry_continuation(
            db, conversation.id, jsonl_path, subject_key=subject_key, full_scope=scope_kind == "full_conversation",
        )
        manifest["extensions"] = {"chat_reader_continuation_export": {"version": 1, "status": continuation_status}}
        if continuation_metadata is not None:
            manifest["continuation"] = continuation_metadata
            for name, data in continuation_members.items():
                manifest["files"][name] = {"sha256": hashlib.sha256(data).hexdigest(), "byte_size": len(data)}
    try:
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True, compresslevel=6) as archive:
            archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8"))
            archive.write(jsonl_path, "conversation.canjsonl")
            for member_name, member_bytes in continuation_members.items():
                archive.writestr(member_name, member_bytes)
            for index, (object_path, (_, source_path)) in enumerate(asset_entries.items(), start=1):
                archive.write(source_path, object_path)
                _report(progress_callback, "packaging_assets", 55 + round(index * 40 / max(len(asset_entries), 1)), len(messages), total)
    finally:
        jsonl_path.unlink(missing_ok=True)

    artifact_id = uuid.uuid4()
    try:
        latest_revision = db.query(Conversation.offline_revision).filter(
            Conversation.id == conversation.id, Conversation.deleted_at.is_(None)).scalar()
        latest_generation = db.query(ContinuationState.generation).filter_by(conversation_id=conversation.id).scalar()
        if (latest_revision != source_revision
                or context_dependency_digest(db, conversation.id, subject_key) != source_dependencies
                or (include_continuation and latest_generation != source_generation)):
            raise ContextPackageError("Context source changed during export; retry with the current version.")
        published = publish_zip_artifact(
            temporary,
            destination,
            category="export",
            artifact_id=artifact_id,
            required_entries=("manifest.json", "conversation.canjsonl"),
        )
    finally:
        temporary.unlink(missing_ok=True)
    artifact = ExportArtifact(
        id=artifact_id,
        job_id=job_id,
        conversation_id=conversation.id,
        format=CONTEXT_PACKAGE_FORMAT,
        filename=filename,
        storage_uri=str(destination),
        sha256=published.sha256,
        byte_size=published.byte_size,
        expires_at=exported_at + timedelta(hours=24),
    )
    if not record_artifact:
        _report(progress_callback, "publishing", 99, total, total)
        return artifact
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


def _version_payload(version: MessageVersion) -> dict[str, Any]:
    return {
        "id": str(version.id), "number": version.version_number,
        "content_markdown": version.display_text, "content_hash": version.content_hash,
        "edit_type": version.edit_type, "edit_reason": version.edit_reason,
        "created_at": _dt(version.created_at), "based_on_version_id": None,
        "normalizer_version": version.normalizer_version,
        "markdown_parser_version": version.markdown_parser_version,
        "block_builder_version": version.block_builder_version,
        "search_document_version": version.search_document_version,
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
