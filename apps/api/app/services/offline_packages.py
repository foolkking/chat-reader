from __future__ import annotations

import hashlib
import json
import os
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, BinaryIO, Callable, Iterable
from zipfile import ZIP_DEFLATED, ZipFile

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.annotation import ConversationAnnotation, ConversationNotebook
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
from app.models.import_record import utc_now
from app.schemas.offline import (
    OfflineCatalogConversation,
    OfflineCatalogProject,
    OfflineCatalogResponse,
)
from app.services.annotations import annotation_read, notebook_read

ProgressCallback = Callable[[str, int, int, int], None]
MessageProgressCallback = Callable[[int, int], None]

_MESSAGE_BATCH_SIZE = 20
_JSON_ENCODER = json.JSONEncoder(
    ensure_ascii=False,
    separators=(",", ":"),
    default=lambda value: _json_value(value),
)


class OfflinePackageError(ValueError):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def build_catalog(db: Session) -> OfflineCatalogResponse:
    conversations = (
        db.query(Conversation)
        .filter(Conversation.deleted_at.is_(None), Conversation.status == "active")
        .order_by(Conversation.sort_time.desc(), Conversation.id.asc())
        .all()
    )
    items: list[OfflineCatalogConversation] = []
    project_rows: dict[uuid.UUID, tuple[Project, list[uuid.UUID], int]] = {}
    for conversation in conversations:
        project_id, project_name = _conversation_project(conversation)
        estimate = estimate_conversation_bytes(db, conversation)
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
                project_rows[relation.project.id] = (existing[0], [*existing[1], conversation.id], existing[2] + estimate)
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
    return max(2_048, int((body * 1.25) + blocks + headings + annotations + 1_500))


def select_conversations(
    db: Session, *, scope: str, conversation_id: uuid.UUID | None, project_id: uuid.UUID | None
) -> list[Conversation]:
    query = db.query(Conversation).filter(Conversation.deleted_at.is_(None), Conversation.status == "active")
    if scope == "conversation":
        if conversation_id is None:
            raise OfflinePackageError("conversation_id is required.")
        query = query.filter(Conversation.id == conversation_id)
    elif scope == "project":
        if project_id is None:
            raise OfflinePackageError("project_id is required.")
        project = db.get(Project, project_id)
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


def build_offline_package(
    db: Session,
    *,
    job_id: uuid.UUID,
    package_id: uuid.UUID,
    scope: str,
    conversation_id: uuid.UUID | None,
    project_id: uuid.UUID | None,
    progress_callback: ProgressCallback | None = None,
) -> OfflinePackageArtifact:
    conversations = select_conversations(
        db, scope=scope, conversation_id=conversation_id, project_id=project_id
    )
    catalog = build_catalog(db)
    total = max(len(conversations), 1)
    package_metadata = {
        "format": "chat-reader-offline-package",
        "version": 1,
        "catalog_revision": catalog.revision,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "scope": scope,
        "scope_id": str(conversation_id or project_id) if scope != "all" else None,
        "projects": [project.model_dump(mode="json") for project in catalog.projects],
    }

    root = Path(get_settings().offline_storage_dir).resolve()
    root.mkdir(parents=True, exist_ok=True)
    filename = f"offline-{scope}-{job_id}.crpkg"
    destination = (root / filename).resolve()
    if not destination.is_relative_to(root):
        raise OfflinePackageError("Invalid offline package path.")
    temporary = destination.with_suffix(destination.suffix + ".tmp")
    try:
        with ZipFile(temporary, "w", compression=ZIP_DEFLATED, allowZip64=True, compresslevel=6) as archive:
            with archive.open("package.json", "w", force_zip64=True) as output:
                _write_package_payload(
                    output,
                    db,
                    package_metadata,
                    conversations,
                    progress_callback=progress_callback,
                )
        os.replace(temporary, destination)
    finally:
        if temporary.exists():
            temporary.unlink()
    digest = _sha256(destination)
    artifact = OfflinePackageArtifact(
        id=package_id,
        job_id=job_id,
        subject_key="local:default",
        scope_type=scope,
        scope_id=conversation_id or project_id,
        catalog_revision=catalog.revision,
        filename=filename,
        storage_uri=str(destination),
        sha256=digest,
        byte_size=destination.stat().st_size,
        conversation_count=len(conversations),
        created_at=utc_now(),
    )
    previous_artifacts = (
        db.query(OfflinePackageArtifact)
        .filter(
            OfflinePackageArtifact.subject_key == "local:default",
            OfflinePackageArtifact.scope_type == scope,
            OfflinePackageArtifact.scope_id == (conversation_id or project_id),
        )
        .all()
    )
    for previous in previous_artifacts:
        previous_path = Path(previous.storage_uri).resolve()
        if previous_path.is_relative_to(root) and previous_path.is_file():
            previous_path.unlink()
        db.delete(previous)
    db.add(artifact)
    db.flush()
    _report(progress_callback, "publishing", 99, total, total)
    return artifact


def _write_package_payload(
    output: BinaryIO,
    db: Session,
    package_metadata: dict[str, Any],
    conversations: list[Conversation],
    *,
    progress_callback: ProgressCallback | None,
) -> None:
    output.write(b"{")
    first_field = True
    for key, value in package_metadata.items():
        first_field = _write_json_field(output, key, value, first=first_field)
    _write_json_key(output, "conversations", first=first_field)
    output.write(b"[")
    total = max(len(conversations), 1)
    for index, conversation in enumerate(conversations, start=1):
        if index > 1:
            output.write(b",")

        def report_messages(processed: int, message_total: int) -> None:
            fraction = processed / max(message_total, 1)
            progress = min(90, round(90 * ((index - 1 + fraction) / total)))
            _report(progress_callback, "packaging", progress, index - 1, total)

        _write_conversation_payload(output, db, conversation, progress_callback=report_messages)
        _report(progress_callback, "packaging", min(92, round(index * 90 / total)), index, total)
    output.write(b"]}")


def _write_conversation_payload(
    output: BinaryIO,
    db: Session,
    conversation: Conversation,
    *,
    progress_callback: MessageProgressCallback | None = None,
) -> None:
    message_rows = (
        db.query(Message)
        .filter(Message.conversation_id == conversation.id, Message.is_deleted.is_(False))
        .order_by(Message.order_key.asc())
        .all()
    )
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
    position = db.query(ReadingPosition).filter(ReadingPosition.conversation_id == conversation.id).first()
    project_id, project_name = _conversation_project(conversation)
    metadata = {
        "id": conversation.id,
        "title": conversation.title,
        "display_title": conversation.display_title,
        "description_markdown": conversation.description_markdown,
        "source_type": conversation.source_type,
        "source_profile": conversation.source_profile,
        "message_count": conversation.message_count,
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
    }

    output.write(b"{")
    first_field = True
    for key, value in metadata.items():
        first_field = _write_json_field(output, key, value, first=first_field)

    _write_json_key(output, "messages", first=first_field)
    output.write(b"[")
    first_message = True
    for batch_start in range(0, len(message_rows), _MESSAGE_BATCH_SIZE):
        batch = message_rows[batch_start : batch_start + _MESSAGE_BATCH_SIZE]
        version_ids = [message.current_version_id for message in batch if message.current_version_id]
        versions = (
            db.query(MessageVersion).filter(MessageVersion.id.in_(version_ids)).all()
            if version_ids
            else []
        )
        versions_by_id = {version.id: version for version in versions}
        block_rows = (
            db.query(RenderBlock)
            .filter(RenderBlock.message_version_id.in_(version_ids))
            .order_by(RenderBlock.message_version_id.asc(), RenderBlock.block_index.asc())
            .all()
            if version_ids
            else []
        )
        blocks_by_version: dict[uuid.UUID, list[RenderBlock]] = defaultdict(list)
        for block in block_rows:
            blocks_by_version[block.message_version_id].append(block)

        for message in batch:
            if not first_message:
                output.write(b",")
            first_message = False
            version = versions_by_id.get(message.current_version_id)
            _write_json_value(
                output,
                {
                    "id": message.id,
                    "conversation_id": message.conversation_id,
                    "role": message.role,
                    "order_key": message.order_key,
                    "turn_index": message.turn_index,
                    "created_at": message.created_at,
                    "block_count": message.block_count,
                    "char_count": message.char_count,
                    "is_heavy": message.is_heavy,
                    "current_version": _version_payload(version),
                    "render_blocks": [
                        _block_payload(block) for block in blocks_by_version.get(message.current_version_id, [])
                    ],
                },
            )
        if progress_callback:
            progress_callback(min(batch_start + len(batch), len(message_rows)), len(message_rows))
    if not message_rows and progress_callback:
        progress_callback(0, 0)
    output.write(b"]")

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
    _write_json_key(output, "search_documents", first=False)
    _write_json_array(
        output,
        (
            _search_payload(item)
            for item in db.query(SearchDocument)
            .filter(SearchDocument.conversation_id == conversation.id)
            .yield_per(100)
        ),
    )
    _write_json_field(output, "annotations", list_annotations_payload(db, conversation.id), first=False)
    _write_json_field(
        output,
        "notebook",
        notebook_read(notebook).model_dump(mode="json") if notebook else None,
        first=False,
    )
    _write_json_field(output, "reading_position", _reading_position_payload(position), first=False)
    output.write(b"}")


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


def list_annotations_payload(db: Session, conversation_id: uuid.UUID) -> list[dict[str, Any]]:
    return [annotation_read(item).model_dump(mode="json") for item in db.query(ConversationAnnotation).filter(
        ConversationAnnotation.conversation_id == conversation_id,
        ConversationAnnotation.subject_key == "local:default",
        ConversationAnnotation.is_deleted.is_(False),
    ).order_by(ConversationAnnotation.created_at.asc()).all()]


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


def _block_payload(block: RenderBlock) -> dict[str, Any]:
    return {
        "id": block.id,
        "block_index": block.block_index,
        "block_type": block.block_type,
        "plain_text": block.plain_text,
        "data": block.data,
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
    return {
        "id": document.id,
        "message_id": document.message_id,
        "message_version_id": document.message_version_id,
        "document_type": document.document_type,
        "role": document.role,
        "title": document.title,
        "plain_text": document.plain_text,
        "search_text": document.search_text,
        "order_key": document.order_key,
        "turn_index": document.turn_index,
        "metadata": {},
    }


def _reading_position_payload(position: ReadingPosition | None) -> dict[str, Any] | None:
    if position is None:
        return None
    return {
        "id": position.id,
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


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _json_value(value: Any) -> Any:
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def _report(callback: ProgressCallback | None, phase: str, progress: int, processed: int, total: int) -> None:
    if callback:
        callback(phase, max(0, min(progress, 99)), processed, total)
