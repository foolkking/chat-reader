from __future__ import annotations

import hashlib
import json
import time
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, BinaryIO, Callable, Iterable
from zipfile import ZIP_DEFLATED, ZipFile

from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload, with_loader_criteria

from app.core.config import get_settings
from app.models.annotation import ConversationAnnotation, ConversationNotebook
from app.models.attachment import Attachment, AssetObject, MessageVersionAttachment
from app.models.conversation import Conversation
from app.models.heading import Heading
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.offline_package_artifact import OfflinePackageArtifact
from app.models.project import Project
from app.models.project_conversation import ProjectConversation
from app.models.reading_position import ReadingPosition
from app.models.render_block import RenderBlock
from app.models.search_document import SearchDocument
from app.models.user_feature_entry import UserFeatureEntry
from app.models.import_record import utc_now
from app.schemas.offline import (
    OfflineCatalogConversation,
    OfflineCatalogProject,
    OfflineCatalogResponse,
)
from app.services.annotations import annotation_read, notebook_read
from app.services.assets.asset_store import get_asset_store
from app.services.assets.scanner import allowed_scan_statuses
from app.services.artifact_lifecycle import publish_zip_artifact, staging_path
from app.services.exporting.export_service import _source_refs_by_message
from app.services.exporting.context_package import _project_context
from app.services.ownership import LEGACY_OWNERSHIP_SCOPE, OwnershipScope, get_owned
from app.services.offline_continuation import OfflineDependencyError, offline_continuation

ProgressCallback = Callable[[str, int, int, int], None]
ConversationProgressCallback = Callable[[str, int, int], None]

# Bodies, blocks and anchored history coexist while a batch is serialized.
# Use a small batch and release its frame before fetching the next one.
_MESSAGE_BATCH_SIZE = 8
_CONVERSATION_PHASE_RANGES = {
    "packaging_messages": (0, 52),
    "packaging_headings": (52, 59),
    "packaging_search": (59, 72),
    "packaging_annotations": (72, 78),
    "packaging_metadata": (78, 84),
    "packaging_attachments": (84, 90),
}
_JSON_ENCODER = json.JSONEncoder(
    ensure_ascii=False,
    separators=(",", ":"),
    default=lambda value: _json_value(value),
)


class OfflinePackageError(ValueError):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def build_catalog(
    db: Session,
    ownership_scope: OwnershipScope = LEGACY_OWNERSHIP_SCOPE,
) -> OfflineCatalogResponse:
    conversations = (
        db.query(Conversation)
        .options(
            selectinload(Conversation.project_links).joinedload(ProjectConversation.project),
            with_loader_criteria(Project, ownership_scope.predicate(Project), include_aliases=True),
        )
        .filter(
            Conversation.deleted_at.is_(None),
            Conversation.status == "active",
            ownership_scope.predicate(Conversation),
        )
        .order_by(Conversation.sort_time.desc(), Conversation.id.asc())
        .all()
    )
    items: list[OfflineCatalogConversation] = []
    estimates = estimate_catalog_bytes(db, conversations)
    project_rows: dict[uuid.UUID, tuple[Project, list[uuid.UUID], int]] = {}
    for conversation in conversations:
        project_id, project_name = _conversation_project(conversation)
        estimate = estimates[conversation.id]
        items.append(
            OfflineCatalogConversation(
                id=conversation.id,
                display_title=conversation.display_title,
                project_id=project_id,
                project_name=project_name,
                revision=conversation.offline_revision,
                estimated_bytes=estimate,
                updated_at=conversation.updated_at,
            )
        )
        for relation in conversation.project_links:
            if relation.project is None or relation.project.is_default or relation.project.is_archived:
                continue
            existing = project_rows.get(relation.project.id)
            if existing is None:
                project_rows[relation.project.id] = (relation.project, [conversation.id], estimate)
            else:
                existing[1].append(conversation.id)
                project_rows[relation.project.id] = (existing[0], existing[1], existing[2] + estimate)
    projects = [
        OfflineCatalogProject(
            id=project.id,
            name=project.name,
            conversation_ids=conversation_ids,
            revision=_revision_for(project, conversation_ids, items),
            estimated_bytes=estimated_bytes,
        )
        for project, conversation_ids, estimated_bytes in project_rows.values()
    ]
    revision = _catalog_revision(items, projects)
    return OfflineCatalogResponse(
        revision=revision,
        generated_at=datetime.now(timezone.utc),
        estimated_bytes=sum(item.estimated_bytes for item in items),
        conversations=items,
        projects=projects,
    )


def estimate_catalog_bytes(db: Session, conversations: list[Conversation]) -> dict[uuid.UUID, int]:
    """Five grouped scalar projections; never materialize message text/bodies."""
    from app.models.context_continuation import ContinuationState, ContinuationRevision, ContextMemberObject
    ids = [row.id for row in conversations]
    if not ids:
        return {}
    body = dict(db.query(Message.conversation_id, func.sum(Message.char_count)).filter(
        Message.conversation_id.in_(ids), Message.is_deleted.is_(False),
    ).group_by(Message.conversation_id).all())
    headings = dict(db.query(Heading.conversation_id, func.count(Heading.id)).filter(
        Heading.conversation_id.in_(ids),
    ).group_by(Heading.conversation_id).all())
    annotations = dict(db.query(ConversationAnnotation.conversation_id, func.count(ConversationAnnotation.id)).filter(
        ConversationAnnotation.conversation_id.in_(ids), ConversationAnnotation.is_deleted.is_(False),
    ).group_by(ConversationAnnotation.conversation_id).all())
    # Distinct byte sizes collapse unrelated equal-sized assets. Deduplicate the
    # real object identity per conversation before summing its physical bytes.
    assets = db.query(Message.conversation_id.label("cid"), AssetObject.id, AssetObject.byte_size).select_from(Message).join(
        MessageVersionAttachment, Message.current_version_id == MessageVersionAttachment.message_version_id,
    ).join(Attachment, Attachment.id == MessageVersionAttachment.attachment_id).join(
        AssetObject, AssetObject.id == Attachment.asset_object_id,
    ).filter(Message.conversation_id.in_(ids), Message.is_deleted.is_(False),
        AssetObject.status == "available", AssetObject.scan_status.in_(allowed_scan_statuses())).distinct().subquery()
    attachment_bytes = dict(db.query(assets.c.cid, func.sum(assets.c.byte_size)).group_by(assets.c.cid).all())
    def members(column):
        return db.query(ContinuationState.conversation_id.label("cid"), column.label("digest")).join(
            ContinuationRevision, ContinuationRevision.id == ContinuationState.adopted_revision_id,
        ).filter(ContinuationState.conversation_id.in_(ids),
            ContinuationRevision.conversation_id == ContinuationState.conversation_id, column.is_not(None))
    refs = members(ContinuationRevision.current_sha256).union(members(ContinuationRevision.index_sha256)).subquery()
    context_bytes = dict(db.query(refs.c.cid, func.sum(ContextMemberObject.byte_size)).select_from(refs).join(
        ContextMemberObject, ContextMemberObject.sha256 == refs.c.digest,
    ).group_by(refs.c.cid).all())
    return {row.id: max(2_048, int(
        int(body.get(row.id) or 0) * 1.25 + row.message_count * 180
        + int(headings.get(row.id) or 0) * 180 + int(annotations.get(row.id) or 0) * 650
        + int(attachment_bytes.get(row.id) or 0) + int(context_bytes.get(row.id) or 0) + 1_500
    )) for row in conversations}


def estimate_conversation_bytes(db: Session, conversation: Conversation) -> int:
    # The estimate intentionally includes compression overhead and annotation metadata.
    body = sum(
        int(row[0] or 0)
        for row in db.query(Message.char_count)
        .filter(Message.conversation_id == conversation.id, Message.is_deleted.is_(False))
        .all()
    )
    blocks = conversation.message_count * 180
    headings = db.query(Heading.id).filter(Heading.conversation_id == conversation.id).count() * 180
    annotations = db.query(ConversationAnnotation.id).filter(
        ConversationAnnotation.conversation_id == conversation.id,
        ConversationAnnotation.is_deleted.is_(False),
    ).count() * 650
    attachment_bytes = sum(
        int(row[1] or 0)
        for row in (
            db.query(AssetObject.id, AssetObject.byte_size)
            .join(Attachment, Attachment.asset_object_id == AssetObject.id)
            .join(MessageVersionAttachment, MessageVersionAttachment.attachment_id == Attachment.id)
            .join(Message, Message.current_version_id == MessageVersionAttachment.message_version_id)
            .filter(
                Message.conversation_id == conversation.id,
                Message.is_deleted.is_(False),
                AssetObject.status == "available",
                AssetObject.scan_status.in_(allowed_scan_statuses()),
            )
            .distinct()
            .all()
        )
    )
    from app.models.context_continuation import ContinuationState, ContinuationRevision, ContextMemberObject
    state = db.get(ContinuationState, conversation.id)
    revision = db.get(ContinuationRevision, state.adopted_revision_id) if state and state.adopted_revision_id else None
    context_bytes = 0
    if revision:
        for digest in {revision.current_sha256, revision.index_sha256} - {None}:
            obj = db.get(ContextMemberObject, digest)
            context_bytes += obj.byte_size if obj else 0
    return max(2_048, int((body * 1.25) + blocks + headings + annotations + attachment_bytes + context_bytes + 1_500))


def select_conversations(
    db: Session,
    *,
    scope: str,
    conversation_id: uuid.UUID | None,
    project_id: uuid.UUID | None,
    ownership_scope: OwnershipScope = LEGACY_OWNERSHIP_SCOPE,
) -> list[Conversation]:
    query = db.query(Conversation).filter(
        Conversation.deleted_at.is_(None),
        Conversation.status == "active",
        ownership_scope.predicate(Conversation),
    )
    if scope == "conversation":
        if conversation_id is None:
            raise OfflinePackageError("conversation_id is required.")
        query = query.filter(Conversation.id == conversation_id)
    elif scope == "project":
        if project_id is None:
            raise OfflinePackageError("project_id is required.")
        project = get_owned(db, Project, project_id, ownership_scope)
        if project is None or project.is_archived:
            raise OfflinePackageError("Project not found.", 404)
        query = query.join(ProjectConversation, ProjectConversation.conversation_id == Conversation.id).filter(
            ProjectConversation.project_id == project_id
        )
    elif scope != "all":
        raise OfflinePackageError("Unsupported offline package scope.")
    conversations = query.order_by(Conversation.sort_time.desc(), Conversation.id.asc()).all()
    if scope == "conversation" and not conversations:
        raise OfflinePackageError("Conversation not found.", 404)
    return conversations


def changed_conversations(
    conversations: Iterable[Conversation], known_revisions: dict[uuid.UUID, int]
) -> list[Conversation]:
    return [
        conversation
        for conversation in conversations
        if known_revisions.get(conversation.id) != conversation.offline_revision
    ]


def build_offline_package(
    db: Session,
    *,
    job_id: uuid.UUID,
    package_id: uuid.UUID,
    scope: str,
    conversation_id: uuid.UUID | None,
    project_id: uuid.UUID | None,
    known_revisions: dict[uuid.UUID, int] | None = None,
    include_assets: str = "all",
    progress_callback: ProgressCallback | None = None,
    subject_key: str = "local:default",
    ownership_scope: OwnershipScope = LEGACY_OWNERSHIP_SCOPE,
) -> OfflinePackageArtifact:
    from app.services.exporting.archive_transaction import archive_read_snapshot

    with archive_read_snapshot(db) as snapshot:
        return _build_offline_package(snapshot, publication_db=db, job_id=job_id,
            package_id=package_id, scope=scope, conversation_id=conversation_id,
            project_id=project_id, known_revisions=known_revisions,
            include_assets=include_assets, progress_callback=progress_callback,
            subject_key=subject_key, ownership_scope=ownership_scope)


def _build_offline_package(
    db: Session,
    *,
    publication_db: Session,
    job_id: uuid.UUID,
    package_id: uuid.UUID,
    scope: str,
    conversation_id: uuid.UUID | None,
    project_id: uuid.UUID | None,
    known_revisions: dict[uuid.UUID, int] | None = None,
    include_assets: str = "all",
    progress_callback: ProgressCallback | None = None,
    subject_key: str = "local:default",
    ownership_scope: OwnershipScope = LEGACY_OWNERSHIP_SCOPE,
) -> OfflinePackageArtifact:
    if include_assets not in {"none", "small", "all"}:
        raise OfflinePackageError("Unsupported offline attachment mode.")
    selected_conversations = select_conversations(
        db,
        scope=scope,
        conversation_id=conversation_id,
        project_id=project_id,
        ownership_scope=ownership_scope,
    )
    base_revisions = known_revisions or {}
    conversations = changed_conversations(selected_conversations, base_revisions)
    # Fail before serializing bodies, but retain final byte checks below: the
    # filesystem does not participate in the database's repeatable-read snapshot.
    affected = []
    failure_code = None
    for index, conversation in enumerate(conversations):
        _report(progress_callback, "checking_dependencies", 0, index, len(conversations))
        try:
            offline_continuation(db, conversation.id)
        except OfflineDependencyError as exc:
            failure_code = failure_code or str(exc)
            affected.append({"conversation_id": str(conversation.id), "code": str(exc)})
    if affected:
        raise OfflineDependencyError(failure_code, affected=affected, affected_count=len(affected))
    assets = _offline_asset_objects(db, conversations, include_assets)
    for index, asset in enumerate(assets):
        _report(progress_callback, "checking_dependencies", 0, index, len(assets))
        try:
            path = get_asset_store().resolve_key(asset.storage_key)
            if not path.is_file():
                raise OSError()
            if path.stat().st_size != asset.byte_size:
                raise OfflineDependencyError("OFFLINE_ASSET_INTEGRITY", affected_count=1)
            with path.open("rb") as source:
                source.read(1)
        except OfflineDependencyError:
            raise
        except (OSError, ValueError) as exc:
            raise OfflineDependencyError("OFFLINE_ASSET_IO", affected_count=1) from exc
    catalog = build_catalog(db, ownership_scope)
    total = max(len(conversations), 1)
    package_metadata = {
        "format": "chat-reader-offline-package",
        "version": 3,
        "update_mode": "conversation-delta",
        "base_revisions": {str(key): value for key, value in base_revisions.items()},
        "catalog_revision": catalog.revision,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "scope": scope,
        "scope_id": str(conversation_id or project_id) if scope != "all" else None,
        "projects": [project.model_dump(mode="json") for project in catalog.projects],
        "asset_mode": include_assets,
    }

    root = Path(get_settings().offline_storage_dir).resolve()
    root.mkdir(parents=True, exist_ok=True)
    filename = f"offline-{scope}-{job_id}.crpkg"
    destination = (root / filename).resolve()
    if not destination.is_relative_to(root):
        raise OfflinePackageError("Invalid offline package path.")
    temporary = staging_path(destination)
    try:
        with ZipFile(temporary, "w", compression=ZIP_DEFLATED, allowZip64=True, compresslevel=6) as archive:
            with archive.open("package.json", "w", force_zip64=True) as output:
                _write_package_payload(
                    output,
                    db,
                    package_metadata,
                    conversations,
                    subject_key=subject_key,
                    progress_callback=progress_callback,
                )
            _report(progress_callback, "packaging_assets", 92, 0, len(assets))
            for index, asset in enumerate(assets, start=1):
                _write_verified_asset(archive, asset, progress_callback, index, len(assets))
                _report(
                    progress_callback,
                    "packaging_assets",
                    92 + round(index * 6 / max(len(assets), 1)),
                    index,
                    len(assets),
                )
        _report(progress_callback, "validating_package", 98, len(assets), len(assets))
        published = publish_zip_artifact(
            temporary,
            destination,
            category="offline",
            artifact_id=package_id,
            required_entries=("package.json",),
        )
    finally:
        if temporary.exists():
            temporary.unlink()
    digest = published.sha256
    artifact = OfflinePackageArtifact(
        id=package_id,
        job_id=job_id,
        subject_key=subject_key,
        scope_type=scope,
        scope_id=conversation_id or project_id,
        catalog_revision=catalog.revision,
        filename=filename,
        storage_uri=str(destination),
        sha256=digest,
        byte_size=published.byte_size,
        conversation_count=len(conversations),
        created_at=utc_now(),
    )
    previous_artifacts = (
        publication_db.query(OfflinePackageArtifact)
        .filter(
            OfflinePackageArtifact.subject_key == subject_key,
            OfflinePackageArtifact.scope_type == scope,
            OfflinePackageArtifact.scope_id == (conversation_id or project_id),
        )
        .all()
    )
    cleanup_paths: list[Path] = []
    for previous in previous_artifacts:
        previous_path = Path(previous.storage_uri).resolve()
        if previous_path.is_relative_to(root) and previous_path.is_file():
            cleanup_paths.append(previous_path)
        publication_db.delete(previous)
    publication_db.add(artifact)
    publication_db.flush()
    # The worker owns the outer transaction. Cleanup is deliberately deferred
    # until that transaction has committed successfully.
    setattr(artifact, "_cleanup_paths", cleanup_paths)
    _report(progress_callback, "publishing", 99, total, total)
    return artifact


def _write_verified_asset(archive, asset, callback, index: int, total: int) -> None:
    """Check the exact bytes copied, with bounded reads and cancellation points."""
    digest = hashlib.sha256()
    size = 0
    last_report = time.monotonic()
    try:
        path = get_asset_store().resolve_key(asset.storage_key)
        with path.open("rb") as source, archive.open(f"assets/objects/{asset.id}", "w", force_zip64=True) as output:
            while chunk := source.read(1024 * 1024):
                size += len(chunk)
                if size > asset.byte_size:
                    raise OfflinePackageError("OFFLINE_ASSET_INTEGRITY")
                digest.update(chunk)
                output.write(chunk)
                if time.monotonic() - last_report >= 0.25:
                    _report(callback, "packaging_assets", 92 + round((index - 1) * 6 / max(total, 1)), index - 1, total)
                    last_report = time.monotonic()
    except OSError as error:
        raise OfflinePackageError("OFFLINE_ASSET_IO") from error
    if size != asset.byte_size or digest.hexdigest() != asset.sha256:
        raise OfflinePackageError("OFFLINE_ASSET_INTEGRITY")


def _write_package_payload(
    output: BinaryIO,
    db: Session,
    package_metadata: dict[str, Any],
    conversations: list[Conversation],
    *,
    subject_key: str,
    progress_callback: ProgressCallback | None,
) -> None:
    output.write(b"{")
    first_field = True
    for key, value in package_metadata.items():
        first_field = _write_json_field(output, key, value, first=first_field)
    _write_json_key(output, "conversations", first=first_field)
    output.write(b"[")
    total = max(len(conversations), 1)
    tag_mapping = _offline_tag_mapping(db, [row.id for row in conversations], subject_key)
    for index, conversation in enumerate(conversations, start=1):
        if index > 1:
            output.write(b",")

        def report_conversation_phase(phase: str, processed: int, phase_total: int) -> None:
            start, end = _CONVERSATION_PHASE_RANGES[phase]
            fraction = min(1.0, processed / max(phase_total, 1))
            local_progress = start + ((end - start) * fraction)
            progress = round(90 * ((index - 1 + (local_progress / 90)) / total))
            _report(progress_callback, phase, progress, index, total)

        _write_conversation_payload(
            output,
            db,
            conversation,
            subject_key=subject_key,
            asset_mode=str(package_metadata.get("asset_mode") or "none"),
            tags=tag_mapping.get(conversation.id, []),
            progress_callback=report_conversation_phase,
        )
        _report(progress_callback, "packaging_conversations", min(92, round(index * 90 / total)), index, total)
    output.write(b"]}")


def _write_conversation_payload(
    output: BinaryIO,
    db: Session,
    conversation: Conversation,
    *,
    subject_key: str,
    asset_mode: str = "none",
    progress_callback: ConversationProgressCallback | None = None,
    tags: list[str] | None = None,
) -> None:
    message_query = (
        db.query(Message)
        .filter(Message.conversation_id == conversation.id, Message.is_deleted.is_(False))
    )
    message_count = message_query.count()
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
    position = db.query(ReadingPosition).filter(
        ReadingPosition.conversation_id == conversation.id,
        ReadingPosition.subject_key == subject_key,
    ).first()
    project_id, project_name = _conversation_project(conversation)
    from app.services.offline_continuation import offline_continuation
    metadata = {
        "id": conversation.id,
        "title": conversation.title,
        "display_title": conversation.display_title,
        "description_markdown": conversation.description_markdown,
        "source_type": conversation.source_type,
        "source_profile": conversation.source_profile,
        # The package aggregate is a completeness contract for the embedded
        # array, so derive it from the exact rows serialized below rather than
        # a conversation aggregate that may still be awaiting reconciliation.
        "message_count": message_count,
        "turn_count": conversation.turn_count,
        "created_at": conversation.created_at,
        "updated_at": conversation.updated_at,
        "imported_at": conversation.imported_at,
        "first_user_message": conversation.first_user_message,
        "status": conversation.status,
        "offline_revision": conversation.offline_revision,
        "render_version": conversation.render_version,
        "content_hash": conversation.content_hash,
        "project_id": project_id,
        "project_name": project_name,
        "project_context": _project_context(db, conversation.id),
        "continuation": offline_continuation(db, conversation.id),
        "tags": tags if tags is not None else _offline_conversation_tags(db, conversation.id, subject_key),
    }

    output.write(b"{")
    first_field = True
    for key, value in metadata.items():
        first_field = _write_json_field(output, key, value, first=first_field)

    _write_json_key(output, "messages", first=first_field)
    output.write(b"[")
    first_message = True
    if progress_callback:
        progress_callback("packaging_messages", 0, message_count)
    last_order_key: str | None = None
    processed = 0
    while True:
        query = message_query
        if last_order_key is not None:
            query = query.filter(Message.order_key > last_order_key)
        batch = query.order_by(Message.order_key.asc()).limit(_MESSAGE_BATCH_SIZE).all()
        if not batch:
            break
        first_message = _write_message_batch(
            output, db, batch, conversation.id, subject_key, first_message=first_message,
        )
        last_order_key = batch[-1].order_key
        processed += len(batch)
        del batch
        if progress_callback:
            progress_callback("packaging_messages", processed, message_count)
    if not message_count and progress_callback:
        progress_callback("packaging_messages", 1, 1)
    output.write(b"]")

    if progress_callback:
        progress_callback("packaging_headings", 0, 1)
    _write_json_key(output, "headings", first=False)
    _write_json_array(
        output,
        (
            _heading_payload(item)
            for item in db.query(Heading)
            .filter(Heading.conversation_id == conversation.id)
            .order_by(Heading.heading_index.asc())
            .yield_per(200)
        ),
    )
    if progress_callback:
        progress_callback("packaging_headings", 1, 1)
        progress_callback("packaging_search", 0, 1)
    _write_json_key(output, "search_documents", first=False)
    _write_json_array(
        output,
        (
            _search_payload(item)
            for item in db.query(SearchDocument)
            .filter(SearchDocument.conversation_id == conversation.id)
            .yield_per(_MESSAGE_BATCH_SIZE)
        ),
    )
    if progress_callback:
        progress_callback("packaging_search", 1, 1)
        progress_callback("packaging_annotations", 0, 1)
    _write_json_key(output, "annotations", first=False)
    _write_json_array(output, _iter_annotations_payload(db, conversation.id, subject_key))
    if progress_callback:
        progress_callback("packaging_annotations", 1, 1)
        progress_callback("packaging_metadata", 0, 1)
    _write_json_field(
        output,
        "notebook",
        notebook_read(notebook).model_dump(mode="json") if notebook else None,
        first=False,
    )
    _write_json_field(output, "reading_position", _reading_position_payload(position), first=False)
    if progress_callback:
        progress_callback("packaging_metadata", 1, 1)
        progress_callback("packaging_attachments", 0, 1)
    _write_json_key(output, "attachments", first=False)
    _write_json_array(output, _offline_attachment_payloads(db, conversation.id, asset_mode))
    if progress_callback:
        progress_callback("packaging_attachments", 1, 1)
    output.write(b"}")


def _offline_conversation_tags(db: Session, conversation_id: uuid.UUID, subject_key: str) -> list[str]:
    """Carry account-owned tag names with a package without changing v1/v2/v3 shape."""
    return _offline_tag_mapping(db, [conversation_id], subject_key).get(conversation_id, [])


def _offline_tag_mapping(db: Session, conversation_ids: list[uuid.UUID], subject_key: str) -> dict[uuid.UUID, list[str]]:
    selected = {str(value): value for value in conversation_ids}
    result: dict[uuid.UUID, set[str]] = defaultdict(set)
    if not selected:
        return {}
    for row in db.query(UserFeatureEntry).filter(
        UserFeatureEntry.subject_key == subject_key,
        UserFeatureEntry.collection == "conversation-tag",
    ).all():
        value = row.value if isinstance(row.value, dict) else {}
        ids = value.get("conversation_ids") if isinstance(value.get("conversation_ids"), list) else []
        if not isinstance(value.get("name"), str):
            continue
        for item in ids:
            if str(item) in selected:
                result[selected[str(item)]].add(value["name"])
    return {cid: sorted(names, key=str.casefold) for cid, names in result.items()}


def _write_message_batch(
    output: BinaryIO,
    db: Session,
    batch: list[Message],
    conversation_id: uuid.UUID,
    subject_key: str,
    *,
    first_message: bool,
) -> bool:
    source_refs = _source_refs_by_message(db, [message.id for message in batch])
    version_ids = [message.current_version_id for message in batch if message.current_version_id]
    versions = db.query(MessageVersion).filter(MessageVersion.id.in_(version_ids)).all() if version_ids else []
    versions_by_id = {version.id: version for version in versions}
    # Preserve only the requesting owner's historical annotation anchors.
    anchor_versions = db.query(MessageVersion).join(
        ConversationAnnotation,
        (ConversationAnnotation.message_version_id == MessageVersion.id)
        & (ConversationAnnotation.message_id == MessageVersion.message_id),
    ).filter(
        MessageVersion.message_id.in_([message.id for message in batch]),
        MessageVersion.id.notin_(version_ids),
        ConversationAnnotation.conversation_id == conversation_id,
        ConversationAnnotation.subject_key == subject_key,
        ConversationAnnotation.is_deleted.is_(False),
    ).distinct().order_by(MessageVersion.message_id, MessageVersion.version_number).all()
    anchors_by_message: dict[uuid.UUID, list[MessageVersion]] = defaultdict(list)
    for anchor in anchor_versions:
        anchors_by_message[anchor.message_id].append(anchor)
    block_rows = (
        db.query(RenderBlock)
        .filter(RenderBlock.message_version_id.in_(version_ids))
        .order_by(RenderBlock.message_version_id.asc(), RenderBlock.block_index.asc())
        .all()
        if version_ids else []
    )
    occurrence_rows = (
        db.query(MessageVersionAttachment)
        .filter(MessageVersionAttachment.message_version_id.in_(version_ids))
        .order_by(
            MessageVersionAttachment.message_version_id.asc(),
            MessageVersionAttachment.block_index.asc().nullslast(),
            MessageVersionAttachment.display_order.asc(),
            MessageVersionAttachment.occurrence_key.asc(),
        )
        .all()
        if version_ids else []
    )
    occurrences_by_block: dict[tuple[uuid.UUID, int], list[MessageVersionAttachment]] = defaultdict(list)
    for link in occurrence_rows:
        if link.block_index is not None:
            occurrences_by_block[(link.message_version_id, link.block_index)].append(link)
    blocks_by_version: dict[uuid.UUID, list[RenderBlock]] = defaultdict(list)
    for block in block_rows:
        blocks_by_version[block.message_version_id].append(block)

    for message in batch:
        if not first_message:
            output.write(b",")
        first_message = False
        _write_json_value(
            output,
            {
                "id": message.id,
                "conversation_id": message.conversation_id,
                "role": message.role,
                "author_label": message.author_label,
                "order_key": message.order_key,
                "turn_index": message.turn_index,
                "created_at": message.created_at,
                "block_count": message.block_count,
                "char_count": message.char_count,
                "is_heavy": message.is_heavy,
                "current_version": _version_payload(versions_by_id.get(message.current_version_id)),
                "annotation_versions": [_version_payload(anchor) for anchor in anchors_by_message.get(message.id, [])],
                "source_refs": source_refs.get(message.id, []),
                "render_blocks": [
                    _block_payload(block, occurrences_by_block.get((block.message_version_id, block.block_index), []))
                    for block in blocks_by_version.get(message.current_version_id, [])
                ],
            },
        )
    return first_message


def _offline_attachment_payloads(db: Session, conversation_id: uuid.UUID, asset_mode: str) -> Iterable[dict[str, Any]]:
    attachments = (
        db.query(Attachment, AssetObject)
        .outerjoin(AssetObject, AssetObject.id == Attachment.asset_object_id)
        .filter(
            Attachment.conversation_id == conversation_id,
            Attachment.deleted_at.is_(None),
        )
        .order_by(Attachment.created_at, Attachment.id)
        .yield_per(100)
    )
    for attachment, asset in attachments:
        links = (
            db.query(MessageVersionAttachment, Message, RenderBlock.id)
            .join(Message, Message.current_version_id == MessageVersionAttachment.message_version_id)
            .outerjoin(
                RenderBlock,
                (RenderBlock.message_version_id == MessageVersionAttachment.message_version_id)
                & (RenderBlock.block_index == MessageVersionAttachment.block_index),
            )
            .filter(MessageVersionAttachment.attachment_id == attachment.id, Message.is_deleted.is_(False))
            .order_by(Message.order_key, MessageVersionAttachment.display_order)
            .all()
        )
        downloadable = bool(
            asset
            and asset.status == "available"
            and asset.scan_status in allowed_scan_statuses()
        )
        included = downloadable and (asset_mode == "all" or (asset_mode == "small" and asset.byte_size <= 10 * 1024 * 1024))
        first_link, first_message, _ = links[0] if links else (None, None, None)
        yield {
            "id": str(attachment.id),
            "conversation_id": str(conversation_id),
            "message_id": str(first_message.id) if first_message else None,
            "message_version_id": str(first_link.message_version_id) if first_link else None,
            "display_name": attachment.display_name,
            "original_filename": attachment.original_filename,
            "declared_mime_type": attachment.declared_mime_type,
            "detected_mime_type": attachment.detected_mime_type or (asset.detected_mime_type if asset else "application/octet-stream"),
            "byte_size": asset.byte_size if asset else 0,
            "sha256": asset.sha256 if asset else "",
            "status": attachment.status,
            "scan_status": attachment.scan_status,
            "resolution_status": attachment.resolution_status,
            "source_type": attachment.source_type,
            "source_attachment_id": attachment.source_attachment_id,
            "occurrences": [{
                "message_id": str(message.id),
                "message_version_id": str(link.message_version_id),
                "render_block_id": str(block_id) if block_id else None,
                "occurrence_key": link.occurrence_key,
                "placement": link.placement,
                "relation_type": link.relation_type,
                "display_order": link.display_order,
                "block_index": link.block_index,
                "display_mode": link.display_mode,
                "alt_text": link.alt_text,
                "caption": link.caption,
            } for link, message, block_id in links],
            "content_path": f"assets/objects/{asset.id}" if included and asset else None,
            "downloadable": downloadable,
        }


def _offline_asset_objects(
    db: Session,
    conversations: list[Conversation],
    asset_mode: str,
) -> list[AssetObject]:
    if asset_mode == "none" or not conversations:
        return []
    conversation_ids = [conversation.id for conversation in conversations]
    query = (
        db.query(AssetObject)
        .join(Attachment, Attachment.asset_object_id == AssetObject.id)
        .filter(
            Attachment.conversation_id.in_(conversation_ids),
            Attachment.deleted_at.is_(None),
            AssetObject.status == "available",
            AssetObject.scan_status.in_(allowed_scan_statuses()),
        )
        .distinct()
    )
    if asset_mode == "small":
        query = query.filter(AssetObject.byte_size <= 10 * 1024 * 1024)
    return query.all()


def _write_json_array(output: BinaryIO, values: Iterable[Any]) -> None:
    output.write(b"[")
    for index, value in enumerate(values):
        if index:
            output.write(b",")
        _write_json_value(output, value)
    output.write(b"]")


def _write_json_field(output: BinaryIO, key: str, value: Any, *, first: bool) -> bool:
    _write_json_key(output, key, first=first)
    _write_json_value(output, value)
    return False


def _write_json_key(output: BinaryIO, key: str, *, first: bool) -> None:
    if not first:
        output.write(b",")
    _write_json_value(output, key)
    output.write(b":")


def _write_json_value(output: BinaryIO, value: Any) -> None:
    for chunk in _JSON_ENCODER.iterencode(value):
        output.write(chunk.encode("utf-8"))


def list_annotations_payload(db: Session, conversation_id: uuid.UUID, subject_key: str) -> list[dict[str, Any]]:
    return list(_iter_annotations_payload(db, conversation_id, subject_key))


def _iter_annotations_payload(db: Session, conversation_id: uuid.UUID, subject_key: str) -> Iterable[dict[str, Any]]:
    for item in db.query(ConversationAnnotation).filter(
        ConversationAnnotation.conversation_id == conversation_id,
        ConversationAnnotation.subject_key == subject_key,
        ConversationAnnotation.is_deleted.is_(False),
    ).order_by(ConversationAnnotation.created_at.asc()).yield_per(8):
        yield annotation_read(item).model_dump(mode="json")


def _conversation_project(conversation: Conversation) -> tuple[uuid.UUID | None, str | None]:
    for relation in conversation.project_links:
        if relation.project is not None and not relation.project.is_default and not relation.project.is_archived:
            return relation.project.id, relation.project.name
    return None, None


def _version_payload(version: MessageVersion | None) -> dict[str, Any] | None:
    if version is None:
        return None
    return {
        "id": version.id,
        "version_number": version.version_number,
        "plain_text": version.plain_text,
        "display_text": version.display_text,
        "blocks": version.blocks,
        "edit_type": version.edit_type,
        "created_at": version.created_at,
        "created_by": version.created_by,
        "content_hash": version.content_hash,
    }


def _block_payload(
    block: RenderBlock,
    occurrences: list[MessageVersionAttachment] | None = None,
) -> dict[str, Any]:
    data = dict(block.data or {})
    occurrences = occurrences or []
    if occurrences:
        # Keep the legacy singular fields for v1 readers, but expose every
        # occurrence so a block containing repeated attachments is lossless.
        first = occurrences[0]
        data.update({
            "messageVersionId": str(first.message_version_id),
            "occurrenceKey": first.occurrence_key,
            "displayOrder": first.display_order,
            "displayMode": first.display_mode,
            "alt": first.alt_text,
            "caption": first.caption,
            "relationType": first.relation_type,
            "attachmentOccurrences": [
                {
                    "attachmentId": str(item.attachment_id),
                    "messageVersionId": str(item.message_version_id),
                    "occurrenceKey": item.occurrence_key,
                    "blockIndex": item.block_index,
                    "renderBlockId": str(block.id),
                    "startOffset": getattr(item, "start_offset", None),
                    "endOffset": getattr(item, "end_offset", None),
                    "displayOrder": item.display_order,
                    "displayMode": item.display_mode,
                    "alt": item.alt_text,
                    "caption": item.caption,
                    "relationType": item.relation_type,
                }
                for item in occurrences
            ],
        })
    return {
        "id": block.id,
        "block_index": block.block_index,
        "block_type": block.block_type,
        "plain_text": block.plain_text,
        "data": data,
        "char_count": block.char_count,
        "collapsed_by_default": block.collapsed_by_default,
        "render_priority": block.render_priority,
    }


def _heading_payload(heading: Heading) -> dict[str, Any]:
    return {
        "id": heading.id,
        "heading_index": heading.heading_index,
        "level": heading.level,
        "text": heading.text,
        "slug": heading.slug,
        "message_id": heading.message_id,
        "message_order_key": heading.order_key,
        "block_index": heading.block_index,
    }


def _search_payload(document: SearchDocument) -> dict[str, Any]:
    payload = {
        "id": document.id,
        "message_id": document.message_id,
        "message_version_id": document.message_version_id,
        "document_type": document.document_type,
        "role": document.role,
        "title": document.title,
        "plain_text": document.plain_text,
        "order_key": document.order_key,
        "turn_index": document.turn_index,
        "metadata": document.metadata_ or {},
    }
    # Most message documents index the same canonical text they display.
    # Omitting the duplicate field materially reduces large offline packages;
    # clients fall back to plain_text when search_text is absent.
    if document.search_text != document.plain_text:
        payload["search_text"] = document.search_text
    return payload


def _reading_position_payload(position: ReadingPosition | None) -> dict[str, Any] | None:
    if position is None:
        return None
    return {
        "id": position.id,
        "revision": position.revision,
        "conversation_id": position.conversation_id,
        "message_id": position.message_id,
        "block_index": position.block_index,
        "scroll_offset": position.scroll_offset,
        "anchor_data": position.anchor_data,
        "updated_at": position.updated_at,
        "created_at": position.created_at,
    }


def _catalog_revision(items: Iterable[OfflineCatalogConversation], projects: Iterable[OfflineCatalogProject]) -> str:
    value = {
        "conversations": [item.model_dump(mode="json") for item in items],
        "projects": [item.model_dump(mode="json") for item in projects],
    }
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def _revision_for(project: Project, ids: list[uuid.UUID], items: list[OfflineCatalogConversation]) -> str:
    revisions = {item.id: item.revision for item in items}
    raw = f"{project.id}:{project.updated_at.isoformat()}:{','.join(f'{item}:{revisions.get(item, 0)}' for item in ids)}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _json_value(value: Any) -> Any:
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def _report(callback: ProgressCallback | None, phase: str, progress: int, processed: int, total: int) -> None:
    if callback:
        callback(phase, max(0, min(progress, 99)), processed, total)
