import hashlib
import json
import uuid
import zipfile
from collections.abc import Callable, Iterable
from datetime import datetime, timedelta, timezone
from pathlib import Path, PurePosixPath
from typing import Any

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.conversation import Conversation
from app.models.annotation import ConversationAnnotation, ConversationNotebook
from app.models.conversation_event import ConversationEvent
from app.models.export_artifact import ExportArtifact
from app.models.heading import Heading
from app.models.import_record import ImportRecord
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.project import Project
from app.models.project_conversation import ProjectConversation
from app.models.reading_position import ReadingPosition
from app.models.render_block import RenderBlock
from app.models.search_document import SearchDocument
from app.models.source_artifact import SourceArtifact
from app.models.source_message_ref import SourceMessageRef
from app.services.database.bulk_insert import insert_rows
from app.services.projects.project_service import add_conversation_to_project, ensure_default_project
from app.services.search.search_indexer import _refresh_postgres_tsv

ARCHIVE_FORMAT = "chat-reader-archive"
ARCHIVE_VERSION = 2
ARCHIVE_MIME = "application/vnd.chat-reader.archive+zip"
ARCHIVE_NAMESPACE = uuid.UUID("12f7e0d6-8ef6-46bd-a4bb-843ed437a14c")
JSONL_ENTRIES = (
    "messages.jsonl",
    "versions.jsonl",
    "blocks.jsonl",
    "headings.jsonl",
    "search_documents.jsonl",
    "source_refs.jsonl",
    "events.jsonl",
)
MAX_ARCHIVE_ENTRIES = 32
MAX_COMPRESSION_RATIO = 200
ProgressCallback = Callable[[str, int, int, int], None]


class CrArchiveError(ValueError):
    pass


def inspect_cr_archive(path: Path) -> dict[str, Any]:
    with _open_validated_zip(path) as archive:
        manifest = _read_json_entry(archive, "manifest.json")
        _validate_manifest(archive, manifest)
        conversation = _read_json_entry(archive, "conversation.json")
    summary = manifest.get("summary") if isinstance(manifest.get("summary"), dict) else {}
    return {
        "format": manifest["format"],
        "version": manifest["version"],
        "compatible": True,
        "title": str(conversation.get("display_title") or conversation.get("title") or "Conversation"),
        "message_count": int(summary.get("messages") or 0),
        "version_count": int(summary.get("versions") or 0),
        "block_count": int(summary.get("blocks") or 0),
        "heading_count": int(summary.get("headings") or 0),
        "project": conversation.get("project"),
        "archive_fingerprint": _manifest_fingerprint(manifest),
    }


def create_cr_archive(
    db: Session,
    *,
    conversation_id: uuid.UUID,
    job_id: uuid.UUID,
    progress_callback: ProgressCallback | None = None,
    include_description: bool = False,
    include_annotations: bool = False,
    include_notebook: bool = False,
) -> ExportArtifact:
    conversation = db.get(Conversation, conversation_id)
    if conversation is None or conversation.deleted_at is not None:
        raise CrArchiveError("Conversation not found.")

    export_root = Path(get_settings().export_storage_dir).resolve()
    export_dir = (export_root / str(job_id)).resolve()
    if not export_dir.is_relative_to(export_root):
        raise CrArchiveError("Invalid export storage path.")
    export_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{_safe_filename(conversation.display_title)}.cr"
    destination = export_dir / filename

    message_rows = db.query(Message).filter(Message.conversation_id == conversation.id).order_by(Message.order_key).all()
    message_ids = [message.id for message in message_rows]
    version_rows = (
        db.query(MessageVersion)
        .filter(MessageVersion.message_id.in_(message_ids))
        .order_by(MessageVersion.message_id, MessageVersion.version_number)
        .all()
        if message_ids
        else []
    )
    version_ids = [version.id for version in version_rows]
    counts = {
        "messages": len(message_rows),
        "versions": len(version_rows),
        "blocks": db.query(RenderBlock).filter(RenderBlock.message_version_id.in_(version_ids)).count() if version_ids else 0,
        "headings": db.query(Heading).filter(Heading.conversation_id == conversation.id).count(),
        "search_documents": db.query(SearchDocument).filter(SearchDocument.conversation_id == conversation.id).count(),
        "source_refs": db.query(SourceMessageRef).filter(SourceMessageRef.message_id.in_(message_ids)).count() if message_ids else 0,
        "events": db.query(ConversationEvent).filter(ConversationEvent.conversation_id == conversation.id).count(),
    }
    total_records = max(sum(counts.values()), 1)
    processed = 0
    checksums: dict[str, dict[str, Any]] = {}

    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True, compresslevel=6) as archive:
        conversation_payload = _conversation_payload(db, conversation)
        if include_description:
            conversation_payload["description_markdown"] = conversation.description_markdown
        checksums["conversation.json"] = _write_json(archive, "conversation.json", conversation_payload)
        _report(progress_callback, "exporting", 5, processed, total_records)

        entries: list[tuple[str, Iterable[dict[str, Any]]]] = [
            ("messages.jsonl", (_message_payload(row) for row in message_rows)),
            ("versions.jsonl", (_version_payload(row) for row in version_rows)),
            (
                "blocks.jsonl",
                (_block_payload(row) for row in _yield_blocks(db, version_ids)),
            ),
            (
                "headings.jsonl",
                (_heading_payload(row) for row in db.query(Heading).filter(Heading.conversation_id == conversation.id).order_by(Heading.heading_index).yield_per(500)),
            ),
            (
                "search_documents.jsonl",
                (_search_payload(row) for row in db.query(SearchDocument).filter(SearchDocument.conversation_id == conversation.id).yield_per(500)),
            ),
            (
                "source_refs.jsonl",
                (_source_ref_payload(row) for row in db.query(SourceMessageRef).filter(SourceMessageRef.message_id.in_(message_ids)).yield_per(500)) if message_ids else (),
            ),
            (
                "events.jsonl",
                (_event_payload(row) for row in db.query(ConversationEvent).filter(ConversationEvent.conversation_id == conversation.id).order_by(ConversationEvent.created_at).yield_per(500)),
            ),
        ]
        for entry_name, rows in entries:
            entry_result, written = _write_jsonl(archive, entry_name, rows)
            checksums[entry_name] = entry_result
            processed += written
            _report(progress_callback, "exporting", min(90, 5 + round(85 * processed / total_records)), processed, total_records)

        if include_annotations:
            annotation_rows = db.query(ConversationAnnotation).filter(
                ConversationAnnotation.conversation_id == conversation.id,
                ConversationAnnotation.subject_key == "local:default",
                ConversationAnnotation.is_deleted.is_(False),
            ).order_by(ConversationAnnotation.created_at.asc()).all()
            checksums["annotations.jsonl"], written = _write_jsonl(
                archive, "annotations.jsonl", (_annotation_payload(row) for row in annotation_rows)
            )
            counts["annotations"] = written
        if include_notebook:
            notebook = db.query(ConversationNotebook).filter(
                ConversationNotebook.conversation_id == conversation.id,
                ConversationNotebook.subject_key == "local:default",
                ConversationNotebook.is_conflict.is_(False),
            ).order_by(ConversationNotebook.created_at.asc()).first()
            if notebook is not None:
                checksums["notebook.json"] = _write_json(archive, "notebook.json", _notebook_payload(notebook))
                counts["notebooks"] = 1

        manifest = {
            "format": ARCHIVE_FORMAT,
            "version": ARCHIVE_VERSION,
            "canonical_schema_version": 1,
            "render_version": conversation.render_version,
            "created_at": _dt(datetime.now(timezone.utc)),
            "scope": "conversation",
            "summary": counts,
            "entries": checksums,
            "optional_entries": {
                "description": include_description,
                "annotations": include_annotations,
                "notebook": include_notebook,
            },
        }
        _write_json(archive, "manifest.json", manifest)

    digest = _sha256_file(destination)
    artifact = ExportArtifact(
        id=uuid.uuid4(),
        job_id=job_id,
        conversation_id=conversation.id,
        format="chat_reader_archive",
        filename=filename,
        storage_uri=str(destination),
        sha256=digest,
        byte_size=destination.stat().st_size,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
    )
    db.add(artifact)
    db.flush()
    _report(progress_callback, "publishing", 99, total_records, total_records)
    return artifact


def import_cr_archive(
    db: Session,
    *,
    import_record: ImportRecord,
    artifact: SourceArtifact,
    progress_callback: ProgressCallback | None = None,
) -> tuple[Conversation, int]:
    path = _artifact_path(artifact)
    options = artifact.parsed_summary.get("commit_options", {}) if isinstance(artifact.parsed_summary, dict) else {}
    duplicate_policy = str(options.get("duplicate_policy") or "reject")
    duplicate_id = options.get("duplicate_conversation_id")
    if duplicate_id and duplicate_policy != "copy":
        raise CrArchiveError("Archive already exists. Choose import as copy to continue.")

    with _open_validated_zip(path) as archive:
        manifest = _read_json_entry(archive, "manifest.json")
        _validate_manifest(archive, manifest)
        source_conversation = _read_json_entry(archive, "conversation.json")
        summary = manifest.get("summary") if isinstance(manifest.get("summary"), dict) else {}
        total = max(sum(int(summary.get(key) or 0) for key in ("messages", "versions", "blocks", "headings", "search_documents")), 1)
        target_id = uuid.uuid4()
        title = str(source_conversation.get("title") or "Imported conversation")
        display_title = str(source_conversation.get("display_title") or title)
        if duplicate_id and duplicate_policy == "copy":
            display_title = f"{display_title}（副本）"
            title = display_title

        conversation = Conversation(
            id=target_id,
            title=title,
            display_title=display_title,
            source_type="chat_reader_archive",
            source_profile="chat_reader_archive_v1",
            external_source_id=str(source_conversation.get("id") or "") or None,
            status="importing",
            created_at=_parse_dt(source_conversation.get("created_at")),
            updated_at=_parse_dt(source_conversation.get("updated_at")),
            imported_at=datetime.now(timezone.utc),
            message_count=int(source_conversation.get("message_count") or summary.get("messages") or 0),
            turn_count=int(source_conversation.get("turn_count") or 0),
            first_user_message=source_conversation.get("first_user_message"),
            description_markdown=source_conversation.get("description_markdown"),
            summary=source_conversation.get("summary"),
            parser_version="chat-reader-archive-v1",
            render_version=int(manifest.get("render_version") or 1),
            content_hash=source_conversation.get("content_hash"),
            sort_time=_parse_dt(source_conversation.get("sort_time")),
            is_global_pinned=bool(source_conversation.get("is_global_pinned")),
            global_pinned_at=_parse_dt(source_conversation.get("global_pinned_at")),
        )
        db.add(conversation)
        db.flush()
        processed = 0

        message_rows = []
        current_versions: dict[uuid.UUID, uuid.UUID | None] = {}
        for row in _read_jsonl(archive, "messages.jsonl"):
            source_id = uuid.UUID(row["id"])
            target_message_id = _mapped_id(target_id, "message", source_id)
            current_source = row.get("current_version_id")
            current_versions[target_message_id] = _mapped_id(target_id, "version", uuid.UUID(current_source)) if current_source else None
            message_rows.append(
                {
                    "id": target_message_id,
                    "conversation_id": target_id,
                    "role": row["role"],
                    "author_label": row.get("author_label"),
                    "order_key": row["order_key"],
                    "turn_index": row.get("turn_index"),
                    "created_at": _parse_dt(row.get("created_at")),
                    "current_version_id": current_versions[target_message_id],
                    "is_deleted": bool(row.get("is_deleted")),
                    "deleted_at": _parse_dt(row.get("deleted_at")),
                    "deleted_by": row.get("deleted_by"),
                    "delete_reason": row.get("delete_reason"),
                    "created_by": row.get("created_by") or "import",
                    "source_type": "chat_reader_archive",
                    "content_hash": row.get("content_hash"),
                    "estimated_height": row.get("estimated_height"),
                    "measured_height": row.get("measured_height"),
                    "block_count": int(row.get("block_count") or 0),
                    "char_count": int(row.get("char_count") or 0),
                    "is_heavy": bool(row.get("is_heavy")),
                }
            )
            if len(message_rows) >= 500:
                insert_rows(db, Message, message_rows)
                processed += len(message_rows)
                message_rows.clear()
                _report(progress_callback, "persisting", 10 + round(15 * processed / total), processed, total)
        if message_rows:
            insert_rows(db, Message, message_rows)
            processed += len(message_rows)

        processed = _import_versions(db, archive, target_id, processed, total, progress_callback)
        processed = _import_blocks(db, archive, target_id, processed, total, progress_callback)
        _import_headings(db, archive, target_id)
        _report(progress_callback, "headings", 82, processed, total)
        _import_search_documents(db, archive, target_id)
        _refresh_postgres_tsv(db, target_id)
        _report(progress_callback, "search", 96, total, total)
        _import_source_refs(db, archive, target_id)
        _import_events(db, archive, target_id)
        _import_optional_reader_metadata(db, archive, target_id)
        _restore_placement(db, conversation, source_conversation, options)
        _restore_reading_position(db, conversation, source_conversation)

    conversation.status = "active"
    db.flush()
    return conversation, conversation.message_count


def _import_versions(db: Session, archive: zipfile.ZipFile, target_id: uuid.UUID, processed: int, total: int, callback: ProgressCallback | None) -> int:
    rows: list[dict[str, Any]] = []
    for row in _read_jsonl(archive, "versions.jsonl"):
        source_id = uuid.UUID(row["id"])
        based_on = row.get("based_on_version_id")
        rows.append(
            {
                "id": _mapped_id(target_id, "version", source_id),
                "message_id": _mapped_id(target_id, "message", uuid.UUID(row["message_id"])),
                "version_number": int(row["version_number"]),
                "plain_text": row.get("plain_text") or "",
                "display_text": row.get("display_text") or "",
                "blocks": [],
                "edit_type": row.get("edit_type") or "imported",
                "edit_reason": row.get("edit_reason"),
                "created_at": _parse_dt(row.get("created_at")) or datetime.now(timezone.utc),
                "created_by": row.get("created_by") or "import",
                "based_on_version_id": _mapped_id(target_id, "version", uuid.UUID(based_on)) if based_on else None,
                "content_hash": row["content_hash"],
            }
        )
        if len(rows) >= 500:
            insert_rows(db, MessageVersion, rows)
            processed += len(rows)
            rows.clear()
            _report(callback, "persisting", min(45, 25 + round(20 * processed / total)), processed, total)
    if rows:
        insert_rows(db, MessageVersion, rows)
        processed += len(rows)
    return processed


def _import_blocks(db: Session, archive: zipfile.ZipFile, target_id: uuid.UUID, processed: int, total: int, callback: ProgressCallback | None) -> int:
    rows: list[dict[str, Any]] = []
    for row in _read_jsonl(archive, "blocks.jsonl"):
        rows.append(
            {
                "id": _mapped_id(target_id, "block", uuid.UUID(row["id"])),
                "message_version_id": _mapped_id(target_id, "version", uuid.UUID(row["message_version_id"])),
                "block_index": int(row["block_index"]),
                "block_type": row["block_type"],
                "plain_text": row.get("plain_text"),
                "data": row.get("data") or {},
                "sanitized_html": None,
                "char_count": int(row.get("char_count") or 0),
                "estimated_height": row.get("estimated_height"),
                "measured_height": row.get("measured_height"),
                "collapsed_by_default": bool(row.get("collapsed_by_default")),
                "render_priority": int(row.get("render_priority") or 0),
            }
        )
        if len(rows) >= 500:
            insert_rows(db, RenderBlock, rows)
            processed += len(rows)
            rows.clear()
            _report(callback, "persisting", min(75, 45 + round(30 * processed / total)), processed, total)
    if rows:
        insert_rows(db, RenderBlock, rows)
        processed += len(rows)
    return processed


def _import_headings(db: Session, archive: zipfile.ZipFile, target_id: uuid.UUID) -> None:
    rows = []
    for row in _read_jsonl(archive, "headings.jsonl"):
        render_block = row.get("render_block_id")
        rows.append(
            {
                "id": _mapped_id(target_id, "heading", uuid.UUID(row["id"])),
                "conversation_id": target_id,
                "message_id": _mapped_id(target_id, "message", uuid.UUID(row["message_id"])),
                "message_version_id": _mapped_id(target_id, "version", uuid.UUID(row["message_version_id"])),
                "render_block_id": _mapped_id(target_id, "block", uuid.UUID(render_block)) if render_block else None,
                "block_index": int(row["block_index"]),
                "heading_index": int(row["heading_index"]),
                "level": int(row["level"]),
                "text": row["text"],
                "slug": row["slug"],
                "order_key": row["order_key"],
                "metadata_": row.get("metadata") or {},
            }
        )
        if len(rows) >= 500:
            insert_rows(db, Heading, rows)
            rows.clear()
    if rows:
        insert_rows(db, Heading, rows)


def _import_search_documents(db: Session, archive: zipfile.ZipFile, target_id: uuid.UUID) -> None:
    rows = []
    for row in _read_jsonl(archive, "search_documents.jsonl"):
        message_id = row.get("message_id")
        version_id = row.get("message_version_id")
        rows.append(
            {
                "id": uuid.uuid4(),
                "conversation_id": target_id,
                "message_id": _mapped_id(target_id, "message", uuid.UUID(message_id)) if message_id else None,
                "message_version_id": _mapped_id(target_id, "version", uuid.UUID(version_id)) if version_id else None,
                "document_type": row["document_type"],
                "role": row.get("role"),
                "title": row.get("title"),
                "plain_text": row.get("plain_text") or "",
                "search_text": row.get("search_text") or "",
                "source_type": "chat_reader_archive",
                "source_profile": "chat_reader_archive_v1",
                "order_key": row.get("order_key"),
                "turn_index": row.get("turn_index"),
                "created_at": _parse_dt(row.get("created_at")),
                "metadata_": row.get("metadata") or {},
            }
        )
        if len(rows) >= 500:
            insert_rows(db, SearchDocument, rows)
            rows.clear()
    if rows:
        insert_rows(db, SearchDocument, rows)


def _import_source_refs(db: Session, archive: zipfile.ZipFile, target_id: uuid.UUID) -> None:
    rows = []
    for row in _read_jsonl(archive, "source_refs.jsonl"):
        rows.append(
            {
                "id": uuid.uuid4(),
                "message_id": _mapped_id(target_id, "message", uuid.UUID(row["message_id"])),
                "source_type": row.get("source_type") or "archive",
                "source_profile": row.get("source_profile") or "chat_reader_archive_v1",
                "source_conversation_id": row.get("source_conversation_id"),
                "source_node_id": row.get("source_node_id"),
                "source_message_id": row.get("source_message_id"),
                "source_json_index": row.get("source_json_index"),
                "source_markdown_index": row.get("source_markdown_index"),
                "parent_node_id": row.get("parent_node_id"),
                "child_node_ids": row.get("child_node_ids") or [],
                "is_primary_path": bool(row.get("is_primary_path", True)),
                "branch_index": row.get("branch_index"),
                "raw_metadata": row.get("raw_metadata") or {},
            }
        )
        if len(rows) >= 500:
            insert_rows(db, SourceMessageRef, rows)
            rows.clear()
    if rows:
        insert_rows(db, SourceMessageRef, rows)


def _import_events(db: Session, archive: zipfile.ZipFile, target_id: uuid.UUID) -> None:
    rows = []
    for row in _read_jsonl(archive, "events.jsonl"):
        target_message = row.get("target_message_id")
        target_version = row.get("target_version_id")
        rows.append(
            {
                "id": uuid.uuid4(),
                "conversation_id": target_id,
                "event_type": row.get("event_type") or "archived_event",
                "target_message_id": _mapped_id(target_id, "message", uuid.UUID(target_message)) if target_message else None,
                "target_version_id": _mapped_id(target_id, "version", uuid.UUID(target_version)) if target_version else None,
                "payload": row.get("payload") or {},
                "created_at": _parse_dt(row.get("created_at")) or datetime.now(timezone.utc),
                "created_by": row.get("created_by") or "archive",
            }
        )
    if rows:
        insert_rows(db, ConversationEvent, rows)


def _conversation_payload(db: Session, conversation: Conversation) -> dict[str, Any]:
    relation = db.query(ProjectConversation).filter(ProjectConversation.conversation_id == conversation.id).one_or_none()
    project = db.get(Project, relation.project_id) if relation else None
    reading = db.query(ReadingPosition).filter(ReadingPosition.conversation_id == conversation.id).one_or_none()
    return {
        "id": str(conversation.id),
        "title": conversation.title,
        "display_title": conversation.display_title,
        "source_type": conversation.source_type,
        "source_profile": conversation.source_profile,
        "created_at": _dt(conversation.created_at),
        "updated_at": _dt(conversation.updated_at),
        "message_count": conversation.message_count,
        "turn_count": conversation.turn_count,
        "first_user_message": conversation.first_user_message,
        "summary": conversation.summary,
        "render_version": conversation.render_version,
        "content_hash": conversation.content_hash,
        "sort_time": _dt(conversation.sort_time),
        "is_global_pinned": conversation.is_global_pinned,
        "global_pinned_at": _dt(conversation.global_pinned_at),
        "project": ({"name": project.name, "is_pinned": relation.is_pinned} if project and not project.is_default else None),
        "reading_position": (
            {
                "message_id": str(reading.message_id) if reading.message_id else None,
                "block_index": reading.block_index,
                "scroll_offset": reading.scroll_offset,
                "anchor_data": reading.anchor_data,
            }
            if reading
            else None
        ),
    }


def _annotation_payload(row: ConversationAnnotation) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "message_id": str(row.message_id) if row.message_id else None,
        "message_version_id": str(row.message_version_id) if row.message_version_id else None,
        "annotation_type": row.annotation_type,
        "color": row.color,
        "start_block_index": row.start_block_index,
        "start_offset": row.start_offset,
        "end_block_index": row.end_block_index,
        "end_offset": row.end_offset,
        "quote": row.quote,
        "prefix": row.prefix,
        "suffix": row.suffix,
        "comment_markdown": row.comment_markdown,
        "anchor_status": row.anchor_status,
        "revision": row.revision,
        "metadata": row.metadata_,
        "created_at": _dt(row.created_at),
        "updated_at": _dt(row.updated_at),
    }


def _notebook_payload(row: ConversationNotebook) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "title": row.title,
        "blocks": row.blocks,
        "revision": row.revision,
        "created_at": _dt(row.created_at),
        "updated_at": _dt(row.updated_at),
    }


def _import_optional_reader_metadata(db: Session, archive: zipfile.ZipFile, target_id: uuid.UUID) -> None:
    names = set(archive.namelist())
    annotation_map: dict[uuid.UUID, uuid.UUID] = {}
    if "annotations.jsonl" in names:
        for row in _read_jsonl(archive, "annotations.jsonl"):
            source_id = uuid.UUID(row["id"])
            annotation_id = _mapped_id(target_id, "annotation", source_id)
            annotation_map[source_id] = annotation_id
            db.add(
                ConversationAnnotation(
                    id=annotation_id,
                    subject_key="local:default",
                    conversation_id=target_id,
                    message_id=_mapped_id(target_id, "message", uuid.UUID(row["message_id"])) if row.get("message_id") else None,
                    message_version_id=_mapped_id(target_id, "version", uuid.UUID(row["message_version_id"])) if row.get("message_version_id") else None,
                    annotation_type=row.get("annotation_type") or "highlight",
                    color=row.get("color"),
                    start_block_index=row.get("start_block_index"),
                    start_offset=row.get("start_offset"),
                    end_block_index=row.get("end_block_index"),
                    end_offset=row.get("end_offset"),
                    quote=row.get("quote"),
                    prefix=row.get("prefix"),
                    suffix=row.get("suffix"),
                    comment_markdown=row.get("comment_markdown") or "",
                    anchor_status=row.get("anchor_status") or "active",
                    revision=int(row.get("revision") or 1),
                    metadata_=row.get("metadata") or {},
                    created_at=_parse_dt(row.get("created_at")) or datetime.now(timezone.utc),
                    updated_at=_parse_dt(row.get("updated_at")) or datetime.now(timezone.utc),
                )
            )
    if "notebook.json" in names:
        row = _read_json_entry(archive, "notebook.json")
        blocks = []
        for block in row.get("blocks") or []:
            value = dict(block) if isinstance(block, dict) else {}
            if value.get("annotation_id"):
                source_annotation_id = uuid.UUID(str(value["annotation_id"]))
                value["annotation_id"] = str(annotation_map.get(source_annotation_id) or _mapped_id(target_id, "annotation", source_annotation_id))
            blocks.append(value)
        db.add(
            ConversationNotebook(
                id=_mapped_id(target_id, "notebook", uuid.UUID(row["id"])),
                subject_key="local:default",
                conversation_id=target_id,
                title=row.get("title"),
                blocks=blocks,
                revision=int(row.get("revision") or 1),
                created_at=_parse_dt(row.get("created_at")) or datetime.now(timezone.utc),
                updated_at=_parse_dt(row.get("updated_at")) or datetime.now(timezone.utc),
            )
        )


def _message_payload(row: Message) -> dict[str, Any]:
    return {key: _json_value(getattr(row, key)) for key in (
        "id", "role", "author_label", "order_key", "turn_index", "created_at", "current_version_id",
        "is_deleted", "deleted_at", "deleted_by", "delete_reason", "created_by", "source_type", "content_hash",
        "estimated_height", "measured_height", "block_count", "char_count", "is_heavy",
    )}


def _version_payload(row: MessageVersion) -> dict[str, Any]:
    return {key: _json_value(getattr(row, key)) for key in (
        "id", "message_id", "version_number", "plain_text", "display_text", "edit_type", "edit_reason",
        "created_at", "created_by", "based_on_version_id", "content_hash",
    )}


def _block_payload(row: RenderBlock) -> dict[str, Any]:
    return {key: _json_value(getattr(row, key)) for key in (
        "id", "message_version_id", "block_index", "block_type", "plain_text", "data", "char_count",
        "estimated_height", "measured_height", "collapsed_by_default", "render_priority",
    )}


def _heading_payload(row: Heading) -> dict[str, Any]:
    return {
        "id": str(row.id), "message_id": str(row.message_id), "message_version_id": str(row.message_version_id),
        "render_block_id": str(row.render_block_id) if row.render_block_id else None, "block_index": row.block_index,
        "heading_index": row.heading_index, "level": row.level, "text": row.text, "slug": row.slug,
        "order_key": row.order_key, "metadata": row.metadata_,
    }


def _search_payload(row: SearchDocument) -> dict[str, Any]:
    return {
        "message_id": str(row.message_id) if row.message_id else None,
        "message_version_id": str(row.message_version_id) if row.message_version_id else None,
        "document_type": row.document_type, "role": row.role, "title": row.title, "plain_text": row.plain_text,
        "search_text": row.search_text, "source_type": row.source_type, "source_profile": row.source_profile,
        "order_key": row.order_key, "turn_index": row.turn_index, "created_at": _dt(row.created_at), "metadata": row.metadata_,
    }


def _source_ref_payload(row: SourceMessageRef) -> dict[str, Any]:
    return {key: _json_value(getattr(row, key)) for key in (
        "message_id", "source_type", "source_profile", "source_conversation_id", "source_node_id", "source_message_id",
        "source_json_index", "source_markdown_index", "parent_node_id", "child_node_ids", "is_primary_path", "branch_index", "raw_metadata",
    )}


def _event_payload(row: ConversationEvent) -> dict[str, Any]:
    return {
        "event_type": row.event_type, "target_message_id": _json_value(row.target_message_id),
        "target_version_id": _json_value(row.target_version_id), "payload": row.payload,
        "created_at": _dt(row.created_at), "created_by": row.created_by,
    }


def _yield_blocks(db: Session, version_ids: list[uuid.UUID]):
    if not version_ids:
        return ()
    return db.query(RenderBlock).filter(RenderBlock.message_version_id.in_(version_ids)).order_by(RenderBlock.message_version_id, RenderBlock.block_index).yield_per(500)


def _restore_placement(db: Session, conversation: Conversation, payload: dict[str, Any], options: dict[str, Any]) -> None:
    project_id = options.get("project_id")
    project = db.get(Project, uuid.UUID(project_id)) if project_id else None
    archived_project = payload.get("project") if isinstance(payload.get("project"), dict) else None
    if project is None and archived_project and options.get("create_archive_project"):
        name = str(archived_project.get("name") or "").strip()
        project = db.query(Project).filter(Project.name == name).one_or_none() if name else None
        if project is None and name:
            project = Project(id=uuid.uuid4(), name=name)
            db.add(project)
            db.flush()
    if project is None and archived_project:
        project = db.query(Project).filter(Project.name == archived_project.get("name"), Project.is_archived.is_(False)).one_or_none()
    project = project or ensure_default_project(db)
    relation = add_conversation_to_project(db, project.id, conversation.id, added_by="archive")
    if archived_project and not project.is_default:
        relation.is_pinned = bool(archived_project.get("is_pinned"))


def _restore_reading_position(db: Session, conversation: Conversation, payload: dict[str, Any]) -> None:
    reading = payload.get("reading_position") if isinstance(payload.get("reading_position"), dict) else None
    if not reading:
        return
    source_message = reading.get("message_id")
    db.add(
        ReadingPosition(
            id=uuid.uuid4(), conversation_id=conversation.id,
            message_id=_mapped_id(conversation.id, "message", uuid.UUID(source_message)) if source_message else None,
            block_index=reading.get("block_index"), scroll_offset=int(reading.get("scroll_offset") or 0),
            anchor_data=reading.get("anchor_data") or {},
        )
    )


def _artifact_path(artifact: SourceArtifact) -> Path:
    root = Path(get_settings().import_storage_dir).resolve()
    path = (root / str(artifact.import_id) / artifact.safe_filename).resolve()
    if not path.is_relative_to(root) or not path.exists():
        raise CrArchiveError("Archive file is missing.")
    return path


def _open_validated_zip(path: Path) -> zipfile.ZipFile:
    try:
        archive = zipfile.ZipFile(path, "r")
    except zipfile.BadZipFile as exc:
        raise CrArchiveError("Invalid .cr archive.") from exc
    infos = archive.infolist()
    if len(infos) > MAX_ARCHIVE_ENTRIES:
        archive.close()
        raise CrArchiveError("Archive contains too many entries.")
    for info in infos:
        posix = PurePosixPath(info.filename)
        if posix.is_absolute() or ".." in posix.parts or info.is_dir():
            archive.close()
            raise CrArchiveError("Archive contains an unsafe path.")
        if info.compress_size > 0 and info.file_size / info.compress_size > MAX_COMPRESSION_RATIO:
            archive.close()
            raise CrArchiveError("Archive compression ratio is unsafe.")
    return archive


def _validate_manifest(archive: zipfile.ZipFile, manifest: dict[str, Any]) -> None:
    if manifest.get("format") != ARCHIVE_FORMAT or manifest.get("version") not in {1, ARCHIVE_VERSION}:
        raise CrArchiveError("Unsupported .cr archive version.")
    required = {"manifest.json", "conversation.json", *JSONL_ENTRIES}
    if not required.issubset(set(archive.namelist())):
        raise CrArchiveError("Archive is missing required entries.")
    entries = manifest.get("entries") if isinstance(manifest.get("entries"), dict) else {}
    for name in ("conversation.json", *JSONL_ENTRIES):
        expected = entries.get(name, {}).get("sha256") if isinstance(entries.get(name), dict) else None
        if not expected:
            raise CrArchiveError(f"Archive checksum is missing for {name}.")
        actual = hashlib.sha256(archive.read(name)).hexdigest()
        if actual != expected:
            raise CrArchiveError(f"Archive checksum failed for {name}.")
    for name in ("annotations.jsonl", "notebook.json"):
        if name not in archive.namelist():
            continue
        expected = entries.get(name, {}).get("sha256") if isinstance(entries.get(name), dict) else None
        if not expected or hashlib.sha256(archive.read(name)).hexdigest() != expected:
            raise CrArchiveError(f"Archive checksum failed for {name}.")


def _manifest_fingerprint(manifest: dict[str, Any]) -> str:
    entries = manifest.get("entries") if isinstance(manifest.get("entries"), dict) else {}
    joined = "|".join(str(entries.get(name, {}).get("sha256") or "") for name in sorted(entries))
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_json(archive: zipfile.ZipFile, name: str, payload: dict[str, Any]) -> dict[str, Any]:
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), default=_json_value).encode("utf-8")
    archive.writestr(name, data)
    return {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "records": 1}


def _write_jsonl(archive: zipfile.ZipFile, name: str, rows: Iterable[dict[str, Any]]) -> tuple[dict[str, Any], int]:
    digest = hashlib.sha256()
    byte_count = 0
    record_count = 0
    with archive.open(name, "w") as destination:
        for row in rows:
            data = (json.dumps(row, ensure_ascii=False, separators=(",", ":"), default=_json_value) + "\n").encode("utf-8")
            destination.write(data)
            digest.update(data)
            byte_count += len(data)
            record_count += 1
    return {"sha256": digest.hexdigest(), "bytes": byte_count, "records": record_count}, record_count


def _read_json_entry(archive: zipfile.ZipFile, name: str) -> dict[str, Any]:
    try:
        value = json.loads(archive.read(name).decode("utf-8"))
    except (KeyError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CrArchiveError(f"Invalid archive entry: {name}.") from exc
    if not isinstance(value, dict):
        raise CrArchiveError(f"Archive entry must be an object: {name}.")
    return value


def _read_jsonl(archive: zipfile.ZipFile, name: str):
    with archive.open(name, "r") as source:
        for line_number, raw in enumerate(source, start=1):
            if not raw.strip():
                continue
            try:
                value = json.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise CrArchiveError(f"Invalid {name} record at line {line_number}.") from exc
            if not isinstance(value, dict):
                raise CrArchiveError(f"Invalid {name} record at line {line_number}.")
            yield value


def _mapped_id(conversation_id: uuid.UUID, kind: str, source_id: uuid.UUID) -> uuid.UUID:
    namespace = uuid.uuid5(ARCHIVE_NAMESPACE, str(conversation_id))
    return uuid.uuid5(namespace, f"{kind}:{source_id}")


def _parse_dt(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def _dt(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _json_value(value: Any) -> Any:
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def _safe_filename(value: str) -> str:
    safe = "".join(character if character.isalnum() or character in "._-" else "-" for character in value).strip("-._")
    return safe[:100] or "conversation"


def _report(callback: ProgressCallback | None, phase: str, progress: int, processed: int, total: int) -> None:
    if callback:
        callback(phase, max(0, min(progress, 99)), processed, total)
