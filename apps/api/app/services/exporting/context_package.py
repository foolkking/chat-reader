from __future__ import annotations

import hashlib
import json
import re
import time
import uuid
import zipfile
from contextlib import ExitStack
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

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
from app.services.assets.asset_store import LocalAssetStore, get_asset_store
from app.services.assets.scanner import scan_status_allows_use
from app.services.artifact_lifecycle import publish_zip_artifact, staging_path
from app.services.exporting.export_service import ExportError, _source_refs_by_message
from app.services.exporting.archive_transaction import archive_read_snapshot, track_archive_object
from app.services.exporting.attachment_bundle import _WriteBudget, _write_stream, _asset_chunks
from app.services.ownership import OwnershipScope
from app.models.user import User


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
    ownership_scope: OwnershipScope | None = None,
) -> ExportArtifact:
    cleanup_paths: list[Path] = []
    try:
        with ExitStack() as resources:
            snapshot = resources.enter_context(archive_read_snapshot(db)) if record_artifact else db
            return _create_context_package(snapshot, conversation_id=conversation_id, job_id=job_id,
                scope_kind=scope_kind, start_message_id=start_message_id,
                progress_callback=progress_callback, subject_key=subject_key,
                output_directory=output_directory, record_artifact=record_artifact,
                include_continuation=include_continuation, include_attachments=include_attachments,
                ownership_scope=ownership_scope, cleanup_paths=cleanup_paths,
                publication_db=db, resources=resources)
    except OSError as error:
        raise ContextPackageError("CONTEXT_EXPORT_STORAGE_UNAVAILABLE") from error
    except ExportError as error:
        # Reuse the bounded ZIP writer; expose errors for this export purpose.
        raise ContextPackageError(str(error).replace("ATTACHMENT_EXPORT_", "CONTEXT_EXPORT_")) from error
    finally:
        for path in cleanup_paths:
            path.unlink(missing_ok=True)


def _create_context_package(db: Session, *, conversation_id, job_id, scope_kind,
    start_message_id, progress_callback, subject_key, output_directory,
    record_artifact, include_continuation, include_attachments, ownership_scope,
    cleanup_paths: list[Path], publication_db, resources) -> ExportArtifact:
    if scope_kind not in {"full_conversation", "reading_scope"}:
        raise ContextPackageError("Unsupported context package scope.")
    conversation = _require_source(db, conversation_id, ownership_scope)
    source_owner = conversation.owner_user_id
    from app.models.context_continuation import ContinuationState
    from app.services.context_dependencies import context_dependency_digest
    source_revision = conversation.offline_revision
    source_dependencies = context_dependency_digest(db, conversation.id, subject_key)
    source_generation = db.query(ContinuationState.generation).filter_by(conversation_id=conversation.id).scalar()

    selected_query = db.query(Message).join(MessageVersion, MessageVersion.id == Message.current_version_id).filter(
        Message.conversation_id == conversation.id, Message.is_deleted.is_(False))
    first_sequence = 1
    if scope_kind == "reading_scope":
        start = selected_query.filter(Message.id == start_message_id).first() if start_message_id else None
        if start is None:
            raise ContextPackageError("Reading scope requires a message in this conversation.")
        first_sequence += selected_query.filter(Message.order_key < start.order_key).count()
        selected_query = selected_query.filter(Message.order_key >= start.order_key)
    # Retain bounded identity metadata, never all message bodies or ORM versions.
    selected_message_ids = [row.id for row in selected_query.with_entities(Message.id).order_by(Message.order_key)
                            .limit(get_settings().canjson_max_messages + 1)]
    message_count = len(selected_message_ids)
    if message_count > get_settings().canjson_max_messages:
        raise ContextPackageError("CONTEXT_EXPORT_LIMIT")
    if not message_count:
        raise ContextPackageError("Conversation has no exportable messages.")
    last_sequence = first_sequence + message_count - 1
    message_seq = {identity: seq for seq, identity in enumerate(selected_message_ids, first_sequence)}
    selected_ids = selected_query.with_entities(Message.id).statement
    selected_versions = selected_query.with_entities(Message.current_version_id).statement
    messages = selected_query.with_entities(Message, MessageVersion).order_by(Message.order_key).yield_per(100)
    total = message_count
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
    # A failed retry must never overwrite another still-referenced result.
    destination = export_dir / f"{package_id.hex}-{filename}"
    temporary = staging_path(destination)
    cleanup_paths.append(temporary)
    jsonl_path = staging_path(export_dir / "conversation.canjsonl")
    cleanup_paths.append(jsonl_path)

    attachment_query = db.query(Attachment).filter(
        Attachment.conversation_id == conversation.id,
        Attachment.deleted_at.is_(None), Attachment.status != "detached")
    if scope_kind == "reading_scope":
        attachment_query = attachment_query.filter(Attachment.id.in_(select(MessageVersionAttachment.attachment_id).where(
            MessageVersionAttachment.message_version_id.in_(selected_versions))))
    attachment_count = attachment_query.count()
    if attachment_count > get_settings().bundle_max_entries:
        raise ContextPackageError("CONTEXT_EXPORT_LIMIT")
    attachment_ids = attachment_query.with_entities(Attachment.id).statement
    # References and bodies advance in the same stable order without a global link map.
    links = iter(db.query(Message.id, MessageVersionAttachment).join(
        MessageVersionAttachment, MessageVersionAttachment.message_version_id == Message.current_version_id)
        .filter(Message.id.in_(selected_ids), MessageVersionAttachment.attachment_id.in_(attachment_ids))
        .order_by(Message.order_key, MessageVersionAttachment.display_order, MessageVersionAttachment.id).yield_per(100))
    resources.callback(links.close)
    next_link = next(links, None)
    reference_count = 0
    annotations = db.query(ConversationAnnotation).filter(
        ConversationAnnotation.conversation_id == conversation.id,
        ConversationAnnotation.subject_key == subject_key,
        ConversationAnnotation.is_deleted.is_(False), ConversationAnnotation.message_id.in_(selected_ids))
    anchor_versions = db.query(MessageVersion).filter(
        MessageVersion.id.in_(annotations.with_entities(ConversationAnnotation.message_version_id).statement),
        MessageVersion.id.not_in(selected_versions), MessageVersion.message_id.in_(selected_ids))
    has_anchor_versions = db.query(anchor_versions.exists()).scalar()
    records = resources.enter_context(_JsonlRecords(jsonl_path, progress_callback))
    records.append(
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
                "message_count": message_count,
                "first_message_seq": first_sequence,
                "last_message_seq": last_sequence,
            },
            "content": {"format": "markdown", "versions": "current_plus_annotation_anchors" if has_anchor_versions else "current_only", "attachments": "metadata_and_objects" if include_attachments else "metadata_only"},
        }
    )
    project_context = _project_context(db, conversation.id)
    if project_context is not None:
        records.append(project_context)

    for processed, (message, version) in enumerate(messages, start=1):
        records.progress = (min(55, round(processed * 55 / total)), processed, total)
        records.append({
            "record_type": "message",
            "id": str(message.id),
            "seq": message_seq[message.id],
            "order_key": message.order_key,
            "role": message.role,
            "turn_index": message.turn_index,
            "author_label": message.author_label,
            "created_at": _dt(message.created_at),
            "current_version": _version_payload(version),
        })
        while next_link is not None and next_link[0] == message.id:
            link = next_link[1]
            reference_count += 1
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
            next_link = next(links, None)
        _report(progress_callback, "serializing", min(55, round(processed * 55 / total)), processed, total)

    for offset in range(0, len(selected_message_ids), 100):
        source_refs = _source_refs_by_message(db, selected_message_ids[offset:offset + 100])
        for refs in source_refs.values():
            records.extend(refs)

    asset_entries: dict[str, tuple[AssetObject, Path]] = {}
    physical_objects: set[uuid.UUID] = set()
    missing_objects: set[str] = set()
    excluded_objects: set[uuid.UUID] = set()
    omitted_objects: set[uuid.UUID] = set()
    available_attachments = 0
    for attachment in attachment_query.options(joinedload(Attachment.asset_object)).order_by(Attachment.id).yield_per(100):
        asset = attachment.asset_object
        if attachment.asset_object_id:
            physical_objects.add(attachment.asset_object_id)
        resolution_status = attachment.resolution_status
        object_payload = None
        if asset is None or asset.status != "available" or asset.deleted_at is not None or not scan_status_allows_use(asset.scan_status):
            resolution_status = "missing"
            missing_objects.add(str(asset.id if asset is not None else attachment.id))
        else:
            try:
                source_path = get_asset_store().resolve_key(asset.storage_key)
            except (FileNotFoundError, ValueError):
                source_path = None
            if source_path is None or not source_path.is_file():
                resolution_status = "missing"
                missing_objects.add(str(asset.id))
            else:
                byte_size = source_path.stat().st_size
                if include_attachments and byte_size != asset.byte_size:
                    raise ContextPackageError("CONTEXT_EXPORT_INTEGRITY")
                object_path = f"assets/objects/{asset.sha256[:2]}/{asset.sha256}"
                object_payload = {
                    "path": object_path,
                    "sha256": asset.sha256,
                    "byte_size": asset.byte_size,
                }
                if include_attachments:
                    if asset.byte_size > get_settings().bundle_max_object_bytes:
                        raise ContextPackageError("CONTEXT_EXPORT_LIMIT")
                    asset_entries.setdefault(object_path, (asset, source_path))
                    if len(asset_entries) > get_settings().bundle_max_objects:
                        raise ContextPackageError("CONTEXT_EXPORT_LIMIT")
                else:
                    omitted_objects.add(asset.id)
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

    if has_anchor_versions:
        for version in anchor_versions.order_by(MessageVersion.message_id, MessageVersion.version_number).yield_per(100):
            records.append({"record_type": "message_version", "message_id": str(version.message_id), **_version_payload(version)})
    annotation_ids = set()
    for annotation in annotations.order_by(ConversationAnnotation.created_at, ConversationAnnotation.id).yield_per(100):
        annotation_ids.add(str(annotation.id))
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

    records.append({"record_type": "end", "record_count": len(records) + 1, "message_count": message_count})
    records.close()
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
            "message_count": message_count,
        },
        "scope": {
            "kind": scope_kind,
            "conversation_id": str(conversation.id),
            "conversation_revision": conversation.offline_revision,
            "current_versions_only": True,
            "first_message_seq": first_sequence,
            "last_message_seq": last_sequence,
            "message_count": message_count,
            "is_complete_conversation": first_sequence == 1 and last_sequence == message_count,
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
            "attachment_records": attachment_count,
            "physical_objects": len(physical_objects),
            "available_objects": len(asset_entries),
            "missing_objects": len(missing_objects),
            "excluded_sensitive_objects": len(excluded_objects),
            "total_available_bytes": sum(asset.byte_size for asset, _ in asset_entries.values()),
        },
        "conversation_completeness": (
            "complete" if first_sequence == 1 and last_sequence == message_count else "partial"
        ),
        "asset_completeness": (
            "none"
            if not attachment_count
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
            "record_count": attachment_count,
            "reference_count": reference_count,
            "resolved_attachment_count": available_attachments,
            "physical_object_count": len(physical_objects),
            "available_object_count": len(asset_entries),
            "missing_object_count": len(missing_objects),
            "excluded_object_count": len(excluded_objects),
            "completeness": (
                "none"
                if not attachment_count
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
    if len(asset_entries) > get_settings().bundle_max_objects or 2 + len(asset_entries) + len(continuation_members) > get_settings().bundle_max_entries:
        raise ContextPackageError("CONTEXT_EXPORT_LIMIT")
    budget = _WriteBudget(progress_callback)
    try:
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True, compresslevel=6) as archive:
            _write_stream(archive, "manifest.json", (json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8"),), budget=budget)
            _write_stream(archive, "conversation.canjsonl", _asset_chunks(jsonl_path, jsonl_size), budget=budget)
            for member_name, member_bytes in continuation_members.items():
                _write_stream(archive, member_name, (member_bytes,), budget=budget)
            for index, (object_path, (asset, source_path)) in enumerate(asset_entries.items(), start=1):
                budget.phase = "assets"
                budget.processed = index - 1
                budget.total = max(len(asset_entries), 1)
                actual = _write_stream(archive, object_path, _asset_chunks(source_path, asset.byte_size), budget=budget)
                if actual != {"sha256": asset.sha256, "byte_size": asset.byte_size}:
                    raise ContextPackageError("CONTEXT_EXPORT_INTEGRITY")
                _report(progress_callback, "packaging_assets", 55 + round(index * 40 / max(len(asset_entries), 1)), message_count, total)
    finally:
        jsonl_path.unlink(missing_ok=True)

    artifact_id = uuid.uuid4()
    try:
        if temporary.stat().st_size > get_settings().bundle_max_compressed_bytes:
            raise ContextPackageError("CONTEXT_EXPORT_LIMIT")
        def check_source(*, lock=False):
            _check_publication(publication_db, conversation_id, ownership_scope, source_owner,
                source_revision, source_dependencies, source_generation, subject_key,
                include_continuation, {asset.id for asset, _ in asset_entries.values()}, lock=lock)
        check_source()
        if destination.exists():
            raise ContextPackageError("CONTEXT_EXPORT_STORAGE_UNAVAILABLE")
        cleanup_paths.append(destination)
        if record_artifact:
            track_archive_object(publication_db, LocalAssetStore(export_root), destination.relative_to(export_root).as_posix())
        published = publish_zip_artifact(
            temporary,
            destination,
            category="export",
            artifact_id=artifact_id,
            required_entries=("manifest.json", "conversation.canjsonl"),
        )
        # ZIP validation may take time: fence source access again after I/O.
        check_source(lock=record_artifact)
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
        cleanup_paths.remove(destination)
        return artifact
    publication_db.add(artifact)
    publication_db.add(ConversationEvent(
        id=uuid.uuid4(),
        conversation_id=conversation.id,
        event_type="context_package_exported",
        payload={
            "scope_kind": scope_kind,
            "message_count": message_count,
            "attachment_count": attachment_count,
            "excluded_sensitive_objects": len(excluded_objects),
        },
        created_by="user",
    ))
    publication_db.flush()
    _report(progress_callback, "publishing", 99, total, total)
    cleanup_paths.remove(destination)
    return artifact


def _check_publication(db, conversation_id, scope, source_owner, source_revision,
    source_dependencies, source_generation, subject_key, include_continuation, asset_ids, *, lock):
    from app.models.context_continuation import ContinuationState
    from app.services.context_dependencies import context_dependency_digest

    # Match mutation lock order: owner, conversation, then ordered asset objects.
    # Temporary read-only snapshots must never request row locks.
    if lock and source_owner is not None:
        owner = db.query(User).filter(User.id == source_owner).populate_existing().with_for_update(read=True).one_or_none()
        if owner is None or not owner.can_login:
            raise ContextPackageError("CONTEXT_EXPORT_ACCOUNT_UNAVAILABLE")
    latest = _require_source(db, conversation_id, scope, lock=lock)
    if latest.owner_user_id != source_owner:
        raise ContextPackageError("CONTEXT_EXPORT_SOURCE_UNAVAILABLE")
    _require_assets(db, asset_ids, lock=lock)
    generation = db.query(ContinuationState.generation).filter_by(conversation_id=conversation_id).scalar()
    if (latest.offline_revision != source_revision
            or context_dependency_digest(db, conversation_id, subject_key) != source_dependencies
            or (include_continuation and generation != source_generation)):
        raise ContextPackageError("CONTEXT_EXPORT_SOURCE_CHANGED")


def _require_source(db, conversation_id, scope, *, lock=False):
    query = db.query(Conversation).filter(Conversation.id == conversation_id, Conversation.deleted_at.is_(None))
    if scope is not None:
        query = query.filter(scope.predicate(Conversation))
    if lock:
        query = query.with_for_update(read=True)
    conversation = query.populate_existing().one_or_none()
    if conversation is None:
        raise ContextPackageError("CONTEXT_EXPORT_SOURCE_UNAVAILABLE")
    if conversation.owner_user_id is not None:
        user = db.get(User, conversation.owner_user_id, populate_existing=True)
        if user is None or not user.can_login:
            raise ContextPackageError("CONTEXT_EXPORT_ACCOUNT_UNAVAILABLE")
    return conversation


def _require_assets(db, ids, *, lock=False):
    ordered = sorted(ids)
    for offset in range(0, len(ordered), 200):
        batch = ordered[offset:offset + 200]
        query = db.query(AssetObject).filter(AssetObject.id.in_(batch)).order_by(AssetObject.id).populate_existing()
        if lock:
            query = query.with_for_update(read=True)
        rows = query.all()
        if len(rows) != len(batch) or any(row.status != "available" or row.deleted_at is not None
                or not scan_status_allows_use(row.scan_status) for row in rows):
            raise ContextPackageError("CONTEXT_EXPORT_ASSET_UNAVAILABLE")


class _JsonlRecords:
    """Write each bounded record immediately; close before hashing or failure cleanup."""

    def __init__(self, path, callback):
        self.path = path
        self.callback = callback
        self.count = 0
        self.byte_size = 0
        self.progress = (0, 0, 1)
        self.last_report = time.monotonic()
        self.resources = ExitStack()

    def __enter__(self):
        self.output = self.resources.enter_context(self.path.open("wb"))
        return self

    def __exit__(self, *args):
        return self.resources.__exit__(*args)

    def close(self):
        self.resources.close()

    def __len__(self):
        return self.count

    def append(self, record):
        line = json.dumps(record, ensure_ascii=False, separators=(",", ":")).encode("utf-8") + b"\n"
        if len(line) > get_settings().canjson_max_line_bytes or self.byte_size + len(line) > get_settings().bundle_max_expanded_bytes:
            raise ContextPackageError("CONTEXT_EXPORT_LIMIT")
        self.output.write(line)
        self.count += 1
        self.byte_size += len(line)
        if self.callback and time.monotonic() - self.last_report >= 0.25:
            self.callback("serializing", *self.progress)
            self.last_report = time.monotonic()

    def extend(self, records):
        for record in records:
            self.append(record)


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
