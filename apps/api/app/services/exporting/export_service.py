import json
import re
import uuid
import zlib
from collections.abc import Iterator
from datetime import datetime, timezone
from http import HTTPStatus
from urllib.parse import quote

from sqlalchemy import func, or_, select
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.orm import Session

from app.models.conversation import Conversation
from app.models.attachment import Attachment, AssetObject, MessageVersionAttachment
from app.models.annotation import ConversationAnnotation, ConversationNotebook
from app.models.conversation_event import ConversationEvent
from app.models.heading import Heading
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.render_block import RenderBlock
from app.models.source_message_ref import SourceMessageRef
from app.schemas.export import ExportOptions, ExportResult, StreamingExportResult


class ExportError(ValueError):
    def __init__(self, message: str, status_code: int = HTTPStatus.BAD_REQUEST) -> None:
        super().__init__(message)
        self.status_code = status_code


def _subject_key_for_conversation(conversation: Conversation) -> str:
    return str(conversation.owner_user_id) if conversation.owner_user_id is not None else "local:default"


def export_conversation_markdown_v2(db: Session, conversation_id: uuid.UUID, options: ExportOptions) -> StreamingExportResult:
    conversation = _get_conversation(db, conversation_id)
    _validate_message_ids(db, conversation.id, options.message_ids)
    message_count = _message_count(db, conversation.id, options.message_ids)
    _write_export_event(db, conversation.id, options, message_count)
    chunks = _markdown_v2_chunks(db.get_bind(), conversation.id, options, _utc_now().isoformat())
    if not options.preserve_attachment_uris:
        attachment_names = {
            row.id: row.display_name
            for row in db.query(Attachment).filter(
                Attachment.conversation_id == conversation.id,
                Attachment.deleted_at.is_(None),
                Attachment.status != "detached",
            )
        }
        chunks = _markdown_attachment_placeholder_chunks(chunks, attachment_names)
    return StreamingExportResult(
        content=chunks,
        media_type="text/markdown; charset=utf-8",
        filename=f"{_safe_filename(conversation.display_title)}--{str(conversation.id)[:8]}.md",
        message_count=message_count,
    )


def export_conversation_canjson_v2(db: Session, conversation_id: uuid.UUID, options: ExportOptions) -> StreamingExportResult:
    conversation = _get_conversation(db, conversation_id)
    _validate_message_ids(db, conversation.id, options.message_ids)
    message_count = _message_count(db, conversation.id, options.message_ids)
    _write_export_event(db, conversation.id, options, message_count)
    chunks: Iterator[bytes] = _canjson_v2_chunks(db.get_bind(), conversation.id, options, _utc_now().isoformat())
    compressed = options.compression == "gzip"
    if compressed:
        chunks = _gzip_chunks(chunks)
    suffix = ".canonical.jsonl.gz" if compressed else ".canonical.jsonl"
    return StreamingExportResult(
        content=chunks,
        media_type="application/gzip" if compressed else "application/x-ndjson; charset=utf-8",
        filename=f"{_safe_filename(conversation.display_title)}--{str(conversation.id)[:8]}{suffix}",
        message_count=message_count,
    )


def _markdown_v2_chunks(
    bind: Engine | Connection,
    conversation_id: uuid.UUID,
    options: ExportOptions,
    exported_at: str,
) -> Iterator[bytes]:
    with Session(bind=bind) as stream_db:
        conversation = _get_conversation(stream_db, conversation_id)
        subject_key = _subject_key_for_conversation(conversation)
        count = _message_count(stream_db, conversation_id, options.message_ids)
        front_matter = {
            "format": "chat-reader-markdown-export",
            "version": 2,
            "conversation_id": str(conversation.id),
            "title": conversation.display_title,
            "message_count": count,
            "content_scope": "all_versions" if options.include_versions else "current_versions",
        }
        if options.include_metadata:
            front_matter.update({"source_profile": conversation.source_profile, "exported_at": exported_at})
        yield b"---\n"
        for key, value in front_matter.items():
            yield f"{key}: {json.dumps(value, ensure_ascii=False)}\n".encode("utf-8")
        yield f"---\n\n# {conversation.display_title}\n\n".encode("utf-8")

        if options.include_description and conversation.description_markdown:
            yield b"## Description\n\n"
            yield conversation.description_markdown.strip().encode("utf-8")
            yield b"\n\n"

        if options.toc_mode == "message_index":
            yield b"## Message Index\n\n"
            for row in _iter_current_message_rows(stream_db, conversation_id, options.message_ids):
                yield f"- {row['role'].title()} {row['order_key']}\n".encode("utf-8")
            yield b"\n"
        elif options.toc_mode == "bounded_headings":
            yield b"## Contents\n\n"
            for heading in _iter_toc_payloads(stream_db, conversation_id, options.message_ids):
                if heading["heading_index"] >= 500:
                    break
                indent = "  " * max(0, int(heading["level"]) - 1)
                yield f"{indent}- {heading['text']}\n".encode("utf-8")
            yield b"\n"

        for rows in _current_message_batches(stream_db, conversation_id, options.message_ids):
            histories = _history_versions_by_message(stream_db, [row["message_id"] for row in rows]) if options.include_versions else {}
            for row in rows:
                marker = {
                    "id": str(row["message_id"]),
                    "role": row["role"],
                    "order_key": row["order_key"],
                    "created_at": _dt(row["message_created_at"]),
                }
                yield b"<!-- chat-reader-message\n"
                for key, value in marker.items():
                    yield f"{key}: {json.dumps(value, ensure_ascii=False)}\n".encode("utf-8")
                yield b"-->\n\n"
                yield f"## {str(row['role']).title()} · {row['order_key']}\n\n".encode("utf-8")
                yield str(row["display_text"]).encode("utf-8")
                if options.include_versions:
                    older_versions = [
                        version
                        for version in histories.get(row["message_id"], [])
                        if version["id"] != row["version_id"]
                    ]
                    if older_versions:
                        yield b"\n\n### Version History\n\n"
                        for version in older_versions:
                            yield (
                                f"<!-- chat-reader-message-version id={json.dumps(str(version['id']))} "
                                f"number={int(version['version_number'])} -->\n\n"
                            ).encode("utf-8")
                            yield f"#### Version {int(version['version_number'])}\n\n".encode("utf-8")
                            yield str(version["display_text"]).encode("utf-8")
                            yield b"\n\n<!-- /chat-reader-message-version -->\n"
                yield b"\n\n<!-- /chat-reader-message -->\n\n"

        if options.include_annotations:
            yield b"## Annotations\n\n"
            yield b"This section is a readable projection; use a .cr archive for exact anchor restoration.\n\n"
            for annotation in _iter_annotation_payloads(
                stream_db, conversation_id, options.message_ids, subject_key=subject_key
            ):
                yield f"### {str(annotation['annotation_type']).replace('_', ' ').title()} · {annotation['id']}\n\n".encode("utf-8")
                if annotation.get("message_id"):
                    yield f"- Message: `{annotation['message_id']}`\n".encode("utf-8")
                if annotation.get("message_version_id"):
                    yield f"- Version: `{annotation['message_version_id']}`\n".encode("utf-8")
                if annotation.get("start_offset") is not None or annotation.get("end_offset") is not None:
                    yield f"- Range: {annotation.get('start_offset')}–{annotation.get('end_offset')}\n".encode("utf-8")
                yield b"\n"
                if annotation.get("quote"):
                    yield _markdown_quote(str(annotation["quote"]))
                    yield b"\n\n"
                if annotation.get("comment_markdown"):
                    yield str(annotation["comment_markdown"]).encode("utf-8")
                    yield b"\n\n"

        if options.include_notebook:
            notebook = _notebook_row(stream_db, conversation)
            if notebook is not None and notebook.blocks:
                annotation_ids: set[uuid.UUID] = set()
                for block in notebook.blocks:
                    if not isinstance(block, dict) or block.get("type") != "annotation_reference" or not block.get("annotation_id"):
                        continue
                    try:
                        annotation_ids.add(uuid.UUID(str(block["annotation_id"])))
                    except ValueError:
                        continue
                annotation_quotes = {
                    str(row.id): row.quote
                    for row in stream_db.query(ConversationAnnotation).filter(
                        ConversationAnnotation.conversation_id == conversation_id,
                        ConversationAnnotation.id.in_(annotation_ids),
                        ConversationAnnotation.subject_key == subject_key,
                        ConversationAnnotation.is_deleted.is_(False),
                    )
                } if annotation_ids else {}
                yield b"## Curated Notes\n\n"
                if notebook.title:
                    yield f"### {notebook.title}\n\n".encode("utf-8")
                for block in notebook.blocks:
                    if not isinstance(block, dict):
                        continue
                    if block.get("type") == "markdown":
                        markdown = str(block.get("markdown") or "")
                        if markdown:
                            yield markdown.encode("utf-8")
                            yield b"\n\n"
                    elif block.get("type") == "annotation_reference" and block.get("annotation_id"):
                        quote_text = annotation_quotes.get(str(block["annotation_id"]))
                        if quote_text:
                            yield _markdown_quote(quote_text)
                            yield b"\n\n"


def _canjson_v2_chunks(
    bind: Engine | Connection,
    conversation_id: uuid.UUID,
    options: ExportOptions,
    exported_at: str,
) -> Iterator[bytes]:
    with Session(bind=bind) as stream_db:
        conversation = _get_conversation(stream_db, conversation_id)
        subject_key = _subject_key_for_conversation(conversation)
        message_count = _message_count(stream_db, conversation_id, options.message_ids)
        manifest = {
            "record_type": "manifest",
            "format": "chat-reader-canonical-jsonl",
            "version": 2,
            "exported_at": exported_at,
            "conversation": {
                "id": str(conversation.id),
                "title": conversation.title,
                "display_title": conversation.display_title,
                **({"description_markdown": conversation.description_markdown} if options.include_description else {}),
                **({
                    "source_type": conversation.source_type,
                    "source_profile": conversation.source_profile,
                    "created_at": _dt(conversation.created_at),
                    "updated_at": _dt(conversation.updated_at),
                } if options.include_metadata else {}),
            },
            "selection": {
                "scope": "selected_messages" if options.message_ids else "all_current_messages",
                "message_count": message_count,
            },
            "content": {
                "format": "markdown",
                "versions": (
                    "all"
                    if options.include_versions
                    else "current_plus_annotation_anchors"
                    if options.include_annotations
                    else "current_only"
                ),
                "attachments": "metadata_only",
            },
        }
        yield _jsonl(manifest)
        record_count = 1
        exported_versions: dict[uuid.UUID, uuid.UUID] = {}
        for rows in _current_message_batches(stream_db, conversation_id, options.message_ids):
            message_ids = [row["message_id"] for row in rows]
            histories = (
                _history_versions_by_message(stream_db, message_ids)
                if options.include_versions
                else _annotation_versions_by_message(stream_db, message_ids)
                if options.include_annotations
                else {}
            )
            source_refs = _source_refs_by_message(stream_db, message_ids) if options.include_source_refs else {}
            for row in rows:
                current_version = _canjson_version(row, include_based_on=options.include_versions)
                exported_versions[row["version_id"]] = row["message_id"]
                yield _jsonl({
                    "record_type": "message",
                    "id": str(row["message_id"]),
                    "seq": int(row["ordinal"]),
                    "order_key": row["order_key"],
                    "role": row["role"],
                    "turn_index": row["turn_index"],
                    "created_at": _dt(row["message_created_at"]),
                    "current_version": current_version,
                })
                record_count += 1
                for version in histories.get(row["message_id"], []):
                    if version["id"] == row["version_id"]:
                        continue
                    yield _jsonl({
                        "record_type": "message_version",
                        "message_id": str(row["message_id"]),
                        **_canjson_version(version, include_based_on=options.include_versions),
                    })
                    exported_versions[version["id"]] = row["message_id"]
                    record_count += 1
                for ref in source_refs.get(row["message_id"], []):
                    yield _jsonl(ref)
                    record_count += 1

        if options.include_annotations:
            for annotation in _iter_annotation_payloads(
                stream_db,
                conversation_id,
                options.message_ids,
                require_message=True,
            ):
                yield _jsonl({
                    "record_type": "annotation",
                    "id": annotation["id"],
                    "message_id": annotation["message_id"],
                    "version_id": annotation["message_version_id"],
                    "start_block_index": annotation["start_block_index"],
                    "start_offset": annotation["start_offset"],
                    "end_block_index": annotation["end_block_index"],
                    "end_offset": annotation["end_offset"],
                    "quoted_text": annotation["quote"],
                    "annotation_type": annotation["annotation_type"],
                    "color": annotation["color"],
                    "comment_markdown": annotation["comment_markdown"],
                    "anchor_status": annotation["anchor_status"],
                })
                record_count += 1
        if options.include_notebook:
            notebook = _notebook_row(stream_db, conversation)
            if notebook is not None:
                notebook_blocks = _exportable_notebook_blocks(
                    stream_db,
                    notebook.blocks,
                    conversation_id,
                    options.message_ids,
                    include_annotation_references=options.include_annotations,
                )
                markdown = "\n\n".join(
                    str(block.get("markdown") or "")
                    for block in notebook_blocks
                    if isinstance(block, dict) and block.get("type") == "markdown"
                )
                yield _jsonl({
                    "record_type": "notebook",
                    "id": str(notebook.id),
                    "title": notebook.title,
                    "content_markdown": markdown,
                    "blocks": notebook_blocks,
                })
                record_count += 1
        if exported_versions:
            attachment_links = (
                stream_db.query(MessageVersionAttachment)
                .filter(MessageVersionAttachment.message_version_id.in_(list(exported_versions)))
                .order_by(MessageVersionAttachment.message_version_id, MessageVersionAttachment.display_order)
                .all()
            )
            attachments = {
                item.id: item
                for item in stream_db.query(Attachment).filter(
                    Attachment.conversation_id == conversation_id,
                    Attachment.deleted_at.is_(None),
                    Attachment.status != "detached",
                ).all()
            }
            for attachment in attachments.values():
                asset = attachment.asset_object
                resolution_status = (
                    "not_included"
                    if attachment.resolution_status == "resolved" and asset is not None
                    else attachment.resolution_status
                )
                yield _jsonl({
                    "record_type": "attachment",
                    "id": str(attachment.id),
                    "conversation_id": str(attachment.conversation_id),
                    "original_filename": attachment.original_filename,
                    "display_name": attachment.display_name,
                    "declared_mime_type": attachment.declared_mime_type,
                    "detected_mime_type": attachment.detected_mime_type,
                    "status": attachment.status,
                    "scan_status": attachment.scan_status,
                    "source_type": attachment.source_type,
                    "source_attachment_id": attachment.source_attachment_id,
                    "metadata": attachment.metadata_ or {},
                    "resolution_status": resolution_status,
                    "asset_object": ({
                        "sha256": asset.sha256,
                        "byte_size": asset.byte_size,
                        "detected_mime_type": asset.detected_mime_type,
                        "detected_extension": asset.detected_extension,
                    } if asset is not None else None),
                })
                record_count += 1
            for link in attachment_links:
                if link.attachment_id not in attachments:
                    continue
                yield _jsonl({
                    "record_type": "attachment_ref",
                    "attachment_id": str(link.attachment_id),
                    "message_id": str(exported_versions[link.message_version_id]),
                    "message_version_id": str(link.message_version_id),
                    "occurrence_key": link.occurrence_key,
                    "placement": link.placement,
                    "relation_type": link.relation_type,
                    "display_order": link.display_order,
                    "block_index": link.block_index,
                    "display_mode": link.display_mode,
                    "alt_text": link.alt_text,
                    "caption": link.caption,
                })
                record_count += 1
        yield _jsonl({"record_type": "end", "record_count": record_count + 1, "message_count": message_count})


def _markdown_attachment_placeholder_chunks(
    chunks: Iterator[bytes],
    attachment_names: dict[uuid.UUID, str],
) -> Iterator[bytes]:
    names = {str(attachment_id): name for attachment_id, name in attachment_names.items()}
    pending = b""
    for chunk in chunks:
        pending += chunk
        while b"\n" in pending:
            line, pending = pending.split(b"\n", 1)
            yield (_replace_markdown_attachment_line(line.decode("utf-8"), names) + "\n").encode("utf-8")
    if pending:
        yield _replace_markdown_attachment_line(pending.decode("utf-8"), names).encode("utf-8")


_MARKDOWN_ATTACHMENT_LINK_RE = re.compile(
    r"(?P<image>!)?\[(?P<label>[^\]]*)\]\(cr-asset://(?P<id>[0-9a-fA-F-]{36})(?:\s+[^)]*)?\)"
)
_RAW_ATTACHMENT_URI_RE = re.compile(r"cr-asset://(?P<id>[0-9a-fA-F-]{36})")


def _replace_markdown_attachment_line(line: str, names: dict[str, str]) -> str:
    def replace_link(match: re.Match[str]) -> str:
        attachment_id = match.group("id")
        name = names.get(attachment_id, match.group("label") or "unknown attachment")
        kind = "Image" if match.group("image") else "Attachment"
        return f"{kind}: {name} (file not included in this export)"

    rendered = _MARKDOWN_ATTACHMENT_LINK_RE.sub(replace_link, line)
    return _RAW_ATTACHMENT_URI_RE.sub(
        lambda match: f"Attachment: {names.get(match.group('id'), 'unknown attachment')} (file not included in this export)",
        rendered,
    )


def _current_message_batches(
    db: Session,
    conversation_id: uuid.UUID,
    message_ids: list[uuid.UUID],
    batch_size: int = 100,
) -> Iterator[list[dict]]:
    last_order_key: str | None = None
    ordinal = 0
    selected_ids = set(message_ids)
    while True:
        statement = (
            select(
                Message.id.label("message_id"), Message.role, Message.order_key, Message.turn_index,
                Message.created_at.label("message_created_at"), MessageVersion.id.label("version_id"),
                MessageVersion.version_number, MessageVersion.display_text, MessageVersion.content_hash,
                MessageVersion.edit_type, MessageVersion.edit_reason, MessageVersion.created_at.label("version_created_at"),
                MessageVersion.based_on_version_id, MessageVersion.normalizer_version,
                MessageVersion.markdown_parser_version, MessageVersion.block_builder_version,
                MessageVersion.search_document_version,
            )
            .join(MessageVersion, MessageVersion.id == Message.current_version_id)
            .where(Message.conversation_id == conversation_id, Message.is_deleted.is_(False))
            .order_by(Message.order_key.asc()).limit(batch_size)
        )
        if selected_ids:
            statement = statement.where(Message.id.in_(selected_ids))
        if last_order_key is not None:
            statement = statement.where(Message.order_key > last_order_key)
        rows = [dict(row) for row in db.execute(statement).mappings().all()]
        if not rows:
            return
        for row in rows:
            ordinal += 1
            row["ordinal"] = ordinal
        yield rows
        last_order_key = rows[-1]["order_key"]
        db.expunge_all()


def _iter_current_message_rows(db: Session, conversation_id: uuid.UUID, message_ids: list[uuid.UUID]) -> Iterator[dict]:
    for rows in _current_message_batches(db, conversation_id, message_ids):
        yield from rows


def _history_versions_by_message(db: Session, message_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[dict]]:
    statement = select(
        MessageVersion.id, MessageVersion.message_id, MessageVersion.version_number, MessageVersion.display_text,
        MessageVersion.content_hash, MessageVersion.edit_type, MessageVersion.edit_reason, MessageVersion.created_at,
        MessageVersion.based_on_version_id, MessageVersion.normalizer_version, MessageVersion.markdown_parser_version,
        MessageVersion.block_builder_version, MessageVersion.search_document_version,
    ).where(MessageVersion.message_id.in_(message_ids)).order_by(MessageVersion.message_id, MessageVersion.version_number)
    grouped: dict[uuid.UUID, list[dict]] = {}
    for row in db.execute(statement).mappings():
        grouped.setdefault(row["message_id"], []).append(dict(row))
    return grouped


def _annotation_versions_by_message(db: Session, message_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[dict]]:
    subject_keys = {
        _subject_key_for_conversation(conversation)
        for conversation in db.query(Conversation)
        .join(Message, Message.conversation_id == Conversation.id)
        .filter(Message.id.in_(message_ids))
        .all()
    }
    statement = (
        select(
            MessageVersion.id,
            MessageVersion.message_id,
            MessageVersion.version_number,
            MessageVersion.display_text,
            MessageVersion.content_hash,
            MessageVersion.edit_type,
            MessageVersion.edit_reason,
            MessageVersion.created_at,
            MessageVersion.based_on_version_id,
            MessageVersion.normalizer_version,
            MessageVersion.markdown_parser_version,
            MessageVersion.block_builder_version,
            MessageVersion.search_document_version,
        )
        .join(ConversationAnnotation, ConversationAnnotation.message_version_id == MessageVersion.id)
        .where(
            ConversationAnnotation.message_id.in_(message_ids),
            MessageVersion.message_id == ConversationAnnotation.message_id,
            ConversationAnnotation.subject_key.in_(subject_keys or {"local:default"}),
            ConversationAnnotation.is_deleted.is_(False),
        )
        .distinct()
        .order_by(MessageVersion.message_id, MessageVersion.version_number)
    )
    grouped: dict[uuid.UUID, list[dict]] = {}
    for row in db.execute(statement).mappings():
        grouped.setdefault(row["message_id"], []).append(dict(row))
    return grouped


def _exportable_notebook_blocks(
    db: Session,
    raw_blocks: list[dict],
    conversation_id: uuid.UUID,
    message_ids: list[uuid.UUID],
    *,
    include_annotation_references: bool,
) -> list[dict]:
    if not include_annotation_references:
        return [dict(block) for block in raw_blocks if isinstance(block, dict) and block.get("type") == "markdown"]
    conversation = _get_conversation(db, conversation_id)
    referenced_ids: set[uuid.UUID] = set()
    for block in raw_blocks:
        if not isinstance(block, dict) or block.get("type") != "annotation_reference" or not block.get("annotation_id"):
            continue
        try:
            referenced_ids.add(uuid.UUID(str(block["annotation_id"])))
        except ValueError:
            continue
    query = db.query(ConversationAnnotation.id).outerjoin(
        MessageVersion,
        MessageVersion.id == ConversationAnnotation.message_version_id,
    ).filter(
        ConversationAnnotation.id.in_(referenced_ids),
        ConversationAnnotation.conversation_id == conversation_id,
        ConversationAnnotation.message_id.is_not(None),
        or_(
            ConversationAnnotation.message_version_id.is_(None),
            MessageVersion.message_id == ConversationAnnotation.message_id,
        ),
        ConversationAnnotation.subject_key == _subject_key_for_conversation(conversation),
        ConversationAnnotation.is_deleted.is_(False),
    )
    if message_ids:
        query = query.filter(ConversationAnnotation.message_id.in_(message_ids))
    exported_annotation_ids = {row[0] for row in query.all()} if referenced_ids else set()
    return [
        dict(block)
        for block in raw_blocks
        if isinstance(block, dict)
        and (
            block.get("type") == "markdown"
            or (
                block.get("type") == "annotation_reference"
                and _as_uuid(block.get("annotation_id")) in exported_annotation_ids
            )
        )
    ]


def _source_refs_by_message(db: Session, message_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[dict]]:
    grouped: dict[uuid.UUID, list[dict]] = {}
    for ref in db.query(SourceMessageRef).filter(SourceMessageRef.message_id.in_(message_ids)).yield_per(100):
        grouped.setdefault(ref.message_id, []).append({
            "record_type": "source_ref",
            "message_id": str(ref.message_id),
            "source_type": ref.source_type,
            "source_profile": ref.source_profile,
            "source_conversation_id": ref.source_conversation_id,
            "source_message_id": ref.source_message_id,
            "source_index": ref.source_json_index if ref.source_json_index is not None else ref.source_markdown_index,
            "source_metadata": {},
        })
    return grouped


def _canjson_version(row: dict, *, include_based_on: bool) -> dict:
    return {
        "id": str(row["version_id"] if "version_id" in row else row["id"]),
        "number": int(row["version_number"]),
        "content_markdown": row["display_text"],
        "content_hash": row["content_hash"],
        "edit_type": row["edit_type"],
        "edit_reason": row.get("edit_reason"),
        "created_at": _dt(row.get("version_created_at") or row.get("created_at")),
        "based_on_version_id": (
            str(row["based_on_version_id"])
            if include_based_on and row.get("based_on_version_id")
            else None
        ),
        "normalizer_version": row.get("normalizer_version") or "legacy-v1",
        "markdown_parser_version": row.get("markdown_parser_version") or "legacy-v1",
        "block_builder_version": row.get("block_builder_version") or "legacy-v1",
        "search_document_version": row.get("search_document_version") or "legacy-v1",
    }


def _jsonl(value: dict) -> bytes:
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def _markdown_quote(value: str) -> bytes:
    lines = value.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    return "\n".join(f"> {line}" if line else ">" for line in lines).encode("utf-8")


def _as_uuid(value: object) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError, AttributeError):
        return None


def content_disposition(filename: str) -> str:
    fallback = re.sub(r"[^A-Za-z0-9._-]+", "-", filename).strip(".-") or "download"
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{quote(filename, safe='')}"


def _gzip_chunks(chunks: Iterator[bytes]) -> Iterator[bytes]:
    compressor = zlib.compressobj(level=6, wbits=31)
    for chunk in chunks:
        compressed = compressor.compress(chunk)
        if compressed:
            yield compressed
    tail = compressor.flush()
    if tail:
        yield tail


def export_conversation_markdown(db: Session, conversation_id: uuid.UUID, options: ExportOptions) -> ExportResult:
    conversation = _get_conversation(db, conversation_id)
    rows = _message_rows(db, conversation, options.message_ids)
    toc = _toc_rows(db, conversation, options.message_ids) if options.include_toc else []
    exported_at = _utc_now().isoformat()
    lines: list[str] = [f"# {conversation.display_title}", ""]

    if options.include_metadata:
        lines.extend(
            [
                f"- Source profile: {conversation.source_profile}",
                f"- Exported at: {exported_at}",
                f"- Message count: {len(rows)}",
                "",
            ]
        )

    if options.include_description and conversation.description_markdown:
        lines.extend(["## Description", "", conversation.description_markdown.strip(), ""])

    if toc:
        lines.extend(["## Table of Contents", ""])
        for heading in toc:
            indent = "  " * max(0, heading.level - 1)
            lines.append(f"{indent}- {heading.text}")
        lines.append("")

    lines.append("---")
    lines.append("")
    for message, version in rows:
        lines.append(f"## {message.role.title()} · {message.order_key}")
        lines.append("")
        block_text = _markdown_blocks(db, version)
        lines.append(block_text or version.display_text)
        lines.append("")

    if options.include_annotations:
        annotations = _annotation_rows(db, conversation, options.message_ids)
        if annotations:
            lines.extend(["## Annotations", ""])
            for annotation in annotations:
                quote = annotation.quote or "Whole message"
                lines.append(f"### {annotation.annotation_type.replace('_', ' ').title()}")
                lines.append("")
                lines.append(f"> {quote.replace(chr(10), ' ')}")
                if annotation.comment_markdown:
                    lines.extend(["", annotation.comment_markdown])
                lines.append("")
    if options.include_notebook:
        notebook = _notebook_row(db, conversation)
        if notebook and notebook.blocks:
            lines.extend(["## Curated Notes", ""])
            for block in notebook.blocks:
                if isinstance(block, dict) and block.get("type") == "markdown":
                    lines.extend([str(block.get("markdown") or ""), ""])
                elif isinstance(block, dict) and block.get("type") == "annotation_reference":
                    annotation = db.get(ConversationAnnotation, uuid.UUID(str(block.get("annotation_id"))))
                    if annotation and annotation.quote:
                        lines.extend([f"> {annotation.quote}", ""])

    _write_export_event(db, conversation.id, options, len(rows))
    content = "\n".join(lines).strip() + "\n"
    return ExportResult(
        content=content,
        media_type="text/markdown; charset=utf-8",
        filename=f"{_safe_filename(conversation.display_title)}.md",
        message_count=len(rows),
    )


def export_conversation_canonical_json(db: Session, conversation_id: uuid.UUID, options: ExportOptions) -> StreamingExportResult:
    conversation = _get_conversation(db, conversation_id)
    _validate_message_ids(db, conversation.id, options.message_ids)
    message_count = _message_count(db, conversation.id, options.message_ids)
    conversation_payload = {
        "id": str(conversation.id),
        "title": conversation.title,
        "display_title": conversation.display_title,
        "source_type": conversation.source_type,
        "source_profile": conversation.source_profile,
        "created_at": _dt(conversation.created_at),
        "updated_at": _dt(conversation.updated_at),
        "imported_at": _dt(conversation.imported_at),
        "message_count": message_count,
    }
    if options.include_description:
        conversation_payload["description_markdown"] = conversation.description_markdown

    _write_export_event(db, conversation.id, options, message_count)
    return StreamingExportResult(
        content=_canonical_json_chunks(
            bind=db.get_bind(),
            conversation_id=conversation.id,
            conversation_payload=conversation_payload,
            exported_at=_utc_now().isoformat(),
            options=options,
        ),
        media_type="application/json; charset=utf-8",
        filename=f"{_safe_filename(conversation.display_title)}.canonical.json",
        message_count=message_count,
    )


def _canonical_json_chunks(
    *,
    bind: Engine | Connection,
    conversation_id: uuid.UUID,
    conversation_payload: dict,
    exported_at: str,
    options: ExportOptions,
) -> Iterator[bytes]:
    with Session(bind=bind) as stream_db:
        conversation = stream_db.get(Conversation, conversation_id)
        subject_key = _subject_key_for_conversation(conversation) if conversation else "local:default"
        yield b"{"
        yield from _json_field("format", "chat-reader-canonical-export", first=True)
        yield from _json_field("version", 1)
        yield from _json_field("exported_at", exported_at)
        yield from _json_field("conversation", conversation_payload)
        yield b',"messages":['
        first_message = True
        for payload in _iter_message_payloads(stream_db, conversation_id, options.message_ids, options.include_versions):
            if not first_message:
                yield b","
            first_message = False
            yield from _json_chunks(payload)
        yield b"]"

        yield b',"toc":['
        if options.include_toc:
            first_heading = True
            for heading in _iter_toc_payloads(stream_db, conversation_id, options.message_ids):
                if not first_heading:
                    yield b","
                first_heading = False
                yield from _json_chunks(heading)
        yield b"]"

        metadata = {
            "export_options": {
                "include_metadata": options.include_metadata,
                "include_toc": options.include_toc,
                "include_versions": options.include_versions,
                "include_description": options.include_description,
                "include_annotations": options.include_annotations,
                "include_notebook": options.include_notebook,
                "selected_message_count": len(options.message_ids),
            }
        } if options.include_metadata else {"export_options": {"include_metadata": False}}
        yield from _json_field("metadata", metadata)

        if options.include_annotations:
            yield b',"annotations":['
            first_annotation = True
            for annotation in _iter_annotation_payloads(
                stream_db, conversation_id, options.message_ids, subject_key=subject_key
            ):
                if not first_annotation:
                    yield b","
                first_annotation = False
                yield from _json_chunks(annotation)
            yield b"]"
        if options.include_notebook:
            notebook = stream_db.query(ConversationNotebook).filter(
                ConversationNotebook.conversation_id == conversation_id,
                ConversationNotebook.subject_key == subject_key,
                ConversationNotebook.is_conflict.is_(False),
            ).order_by(ConversationNotebook.created_at.asc()).first()
            yield from _json_field("notebook", _notebook_payload(notebook) if notebook else None)
        yield b"}"


def _iter_message_payloads(
    db: Session,
    conversation_id: uuid.UUID,
    message_ids: list[uuid.UUID],
    include_versions: bool,
    *,
    batch_size: int = 8,
) -> Iterator[dict]:
    last_order_key: str | None = None
    selected_ids = set(message_ids)
    while True:
        statement = (
            select(
                Message.id.label("message_id"),
                Message.role,
                Message.order_key,
                Message.turn_index,
                Message.created_at.label("message_created_at"),
                MessageVersion.id.label("version_id"),
                MessageVersion.version_number,
                MessageVersion.plain_text,
                MessageVersion.display_text,
                MessageVersion.edit_type,
                MessageVersion.edit_reason,
                MessageVersion.created_at.label("version_created_at"),
                MessageVersion.created_by,
                MessageVersion.based_on_version_id,
                MessageVersion.content_hash,
            )
            .join(MessageVersion, MessageVersion.id == Message.current_version_id)
            .where(Message.conversation_id == conversation_id, Message.is_deleted.is_(False))
            .order_by(Message.order_key.asc())
            .limit(batch_size)
        )
        if selected_ids:
            statement = statement.where(Message.id.in_(selected_ids))
        if last_order_key is not None:
            statement = statement.where(Message.order_key > last_order_key)
        rows = db.execute(statement).mappings().all()
        if not rows:
            return

        message_id_batch = [row["message_id"] for row in rows]
        version_rows = _version_rows_for_batch(db, rows, message_id_batch, include_versions)
        version_ids = [row["id"] for row in version_rows]
        blocks_by_version = _blocks_for_versions(db, version_ids)
        versions_by_message: dict[uuid.UUID, list[dict]] = {}
        for version in version_rows:
            versions_by_message.setdefault(version["message_id"], []).append(
                _version_payload_from_mapping(version, blocks_by_version.get(version["id"], []))
            )

        for row in rows:
            versions = versions_by_message.get(row["message_id"], [])
            current_version = next((item for item in versions if item["id"] == str(row["version_id"])), None)
            if current_version is None:
                raise ExportError("Current message version is missing.", HTTPStatus.CONFLICT)
            payload = {
                "id": str(row["message_id"]),
                "role": row["role"],
                "order_key": row["order_key"],
                "turn_index": row["turn_index"],
                "created_at": _dt(row["message_created_at"]),
                "current_version": current_version,
            }
            if include_versions:
                payload["versions"] = versions
            yield payload
        last_order_key = rows[-1]["order_key"]
        db.expunge_all()


def _version_rows_for_batch(db: Session, current_rows: list, message_ids: list[uuid.UUID], include_versions: bool) -> list[dict]:
    if not include_versions:
        return [
            {
                "id": row["version_id"],
                "message_id": row["message_id"],
                "version_number": row["version_number"],
                "plain_text": row["plain_text"],
                "display_text": row["display_text"],
                "edit_type": row["edit_type"],
                "edit_reason": row["edit_reason"],
                "created_at": row["version_created_at"],
                "created_by": row["created_by"],
                "based_on_version_id": row["based_on_version_id"],
                "content_hash": row["content_hash"],
            }
            for row in current_rows
        ]
    statement = (
        select(
            MessageVersion.id,
            MessageVersion.message_id,
            MessageVersion.version_number,
            MessageVersion.plain_text,
            MessageVersion.display_text,
            MessageVersion.edit_type,
            MessageVersion.edit_reason,
            MessageVersion.created_at,
            MessageVersion.created_by,
            MessageVersion.based_on_version_id,
            MessageVersion.content_hash,
        )
        .where(MessageVersion.message_id.in_(message_ids))
        .order_by(MessageVersion.message_id.asc(), MessageVersion.version_number.asc())
    )
    return [dict(row) for row in db.execute(statement).mappings()]


def _blocks_for_versions(db: Session, version_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[dict]]:
    if not version_ids:
        return {}
    statement = (
        select(
            RenderBlock.message_version_id,
            RenderBlock.block_index,
            RenderBlock.block_type,
            RenderBlock.plain_text,
            RenderBlock.data,
            RenderBlock.char_count,
            RenderBlock.collapsed_by_default,
            RenderBlock.render_priority,
        )
        .where(RenderBlock.message_version_id.in_(version_ids))
        .order_by(RenderBlock.message_version_id.asc(), RenderBlock.block_index.asc())
    )
    grouped: dict[uuid.UUID, list[dict]] = {}
    for row in db.execute(statement).mappings():
        grouped.setdefault(row["message_version_id"], []).append({
            "block_index": row["block_index"],
            "block_type": row["block_type"],
            "plain_text": row["plain_text"],
            "data": row["data"],
            "char_count": row["char_count"],
            "collapsed_by_default": row["collapsed_by_default"],
            "render_priority": row["render_priority"],
        })
    return grouped


def _version_payload_from_mapping(version: dict, blocks: list[dict]) -> dict:
    return {
        "id": str(version["id"]),
        "version_number": version["version_number"],
        "plain_text": version["plain_text"],
        "display_text": version["display_text"],
        "blocks": blocks,
        "edit_type": version["edit_type"],
        "edit_reason": version["edit_reason"],
        "created_at": _dt(version["created_at"]),
        "created_by": version["created_by"],
        "based_on_version_id": str(version["based_on_version_id"]) if version["based_on_version_id"] else None,
        "content_hash": version["content_hash"],
    }


def _iter_toc_payloads(db: Session, conversation_id: uuid.UUID, message_ids: list[uuid.UUID]) -> Iterator[dict]:
    query = db.query(Heading).filter(Heading.conversation_id == conversation_id)
    if message_ids:
        query = query.filter(Heading.message_id.in_(message_ids))
    for heading in query.order_by(Heading.heading_index.asc()).yield_per(200):
        yield {
            "id": str(heading.id),
            "heading_index": heading.heading_index,
            "level": heading.level,
            "text": heading.text,
            "slug": heading.slug,
            "message_id": str(heading.message_id),
            "block_index": heading.block_index,
            "order_key": heading.order_key,
        }


def _iter_annotation_payloads(
    db: Session,
    conversation_id: uuid.UUID,
    message_ids: list[uuid.UUID],
    *,
    require_message: bool = False,
    subject_key: str | None = None,
) -> Iterator[dict]:
    if subject_key is None:
        subject_key = _subject_key_for_conversation(_get_conversation(db, conversation_id))
    query = db.query(ConversationAnnotation).outerjoin(Message, Message.id == ConversationAnnotation.message_id).filter(
        ConversationAnnotation.conversation_id == conversation_id,
        ConversationAnnotation.subject_key == subject_key,
        ConversationAnnotation.is_deleted.is_(False),
    )
    if message_ids:
        query = query.filter(ConversationAnnotation.message_id.in_(message_ids))
    if require_message:
        query = query.outerjoin(
            MessageVersion,
            MessageVersion.id == ConversationAnnotation.message_version_id,
        ).filter(
            ConversationAnnotation.message_id.is_not(None),
            or_(
                ConversationAnnotation.message_version_id.is_(None),
                MessageVersion.message_id == ConversationAnnotation.message_id,
            ),
        )
    for annotation in query.order_by(
        Message.order_key.asc(),
        ConversationAnnotation.start_block_index.asc(),
        ConversationAnnotation.start_offset.asc(),
        ConversationAnnotation.created_at.asc(),
    ).yield_per(100):
        yield _annotation_payload(annotation)


def _json_field(name: str, value: object, *, first: bool = False) -> Iterator[bytes]:
    if not first:
        yield b","
    yield json.dumps(name).encode("utf-8")
    yield b":"
    yield from _json_chunks(value)


def _json_chunks(value: object, *, target_size: int = 64 * 1024) -> Iterator[bytes]:
    encoder = json.JSONEncoder(ensure_ascii=False, separators=(",", ":"))
    buffer = bytearray()
    for chunk in encoder.iterencode(value):
        encoded = chunk.encode("utf-8")
        if buffer and len(buffer) + len(encoded) >= target_size:
            yield bytes(buffer)
            buffer.clear()
        if len(encoded) >= target_size:
            yield encoded
        else:
            buffer.extend(encoded)
    if buffer:
        yield bytes(buffer)


def _validate_message_ids(db: Session, conversation_id: uuid.UUID, message_ids: list[uuid.UUID]) -> None:
    if not message_ids:
        return
    valid_ids = set(db.scalars(select(Message.id).where(Message.conversation_id == conversation_id, Message.id.in_(message_ids))))
    if valid_ids != set(message_ids):
        raise ExportError("message_ids must belong to the conversation.")


def _message_count(db: Session, conversation_id: uuid.UUID, message_ids: list[uuid.UUID]) -> int:
    statement = select(func.count(Message.id)).where(Message.conversation_id == conversation_id, Message.is_deleted.is_(False))
    if message_ids:
        statement = statement.where(Message.id.in_(message_ids))
    return int(db.scalar(statement) or 0)


def _get_conversation(db: Session, conversation_id: uuid.UUID) -> Conversation:
    conversation = db.get(Conversation, conversation_id)
    if conversation is None or conversation.deleted_at is not None:
        raise ExportError("Conversation not found.", HTTPStatus.NOT_FOUND)
    return conversation


def _message_rows(
    db: Session,
    conversation: Conversation,
    message_ids: list[uuid.UUID],
) -> list[tuple[Message, MessageVersion]]:
    query = (
        db.query(Message, MessageVersion)
        .join(MessageVersion, MessageVersion.id == Message.current_version_id)
        .filter(Message.conversation_id == conversation.id, Message.is_deleted.is_(False))
    )
    if message_ids:
        valid_ids = {row[0] for row in db.query(Message.id).filter(Message.conversation_id == conversation.id).all()}
        if any(message_id not in valid_ids for message_id in message_ids):
            raise ExportError("message_ids must belong to the conversation.")
        query = query.filter(Message.id.in_(message_ids))
    return query.order_by(Message.order_key.asc()).all()


def _toc_rows(db: Session, conversation: Conversation, message_ids: list[uuid.UUID]) -> list[Heading]:
    query = db.query(Heading).filter(Heading.conversation_id == conversation.id)
    if message_ids:
        query = query.filter(Heading.message_id.in_(message_ids))
    return query.order_by(Heading.heading_index.asc()).all()


def _annotation_rows(db: Session, conversation: Conversation, message_ids: list[uuid.UUID]) -> list[ConversationAnnotation]:
    query = db.query(ConversationAnnotation).filter(
        ConversationAnnotation.conversation_id == conversation.id,
        ConversationAnnotation.subject_key == _subject_key_for_conversation(conversation),
        ConversationAnnotation.is_deleted.is_(False),
    )
    if message_ids:
        query = query.filter(ConversationAnnotation.message_id.in_(message_ids))
    return query.order_by(ConversationAnnotation.created_at.asc()).all()


def _notebook_row(db: Session, conversation: Conversation) -> ConversationNotebook | None:
    return db.query(ConversationNotebook).filter(
        ConversationNotebook.conversation_id == conversation.id,
        ConversationNotebook.subject_key == _subject_key_for_conversation(conversation),
        ConversationNotebook.is_conflict.is_(False),
    ).order_by(ConversationNotebook.created_at.asc()).first()


def _annotation_payload(annotation: ConversationAnnotation) -> dict:
    return {
        "id": str(annotation.id),
        "message_id": str(annotation.message_id) if annotation.message_id else None,
        "message_version_id": str(annotation.message_version_id) if annotation.message_version_id else None,
        "annotation_type": annotation.annotation_type,
        "color": annotation.color,
        "start_block_index": annotation.start_block_index,
        "start_offset": annotation.start_offset,
        "end_block_index": annotation.end_block_index,
        "end_offset": annotation.end_offset,
        "quote": annotation.quote,
        "prefix": annotation.prefix,
        "suffix": annotation.suffix,
        "comment_markdown": annotation.comment_markdown,
        "anchor_status": annotation.anchor_status,
        "revision": annotation.revision,
    }


def _notebook_payload(notebook: ConversationNotebook) -> dict:
    return {
        "id": str(notebook.id),
        "title": notebook.title,
        "blocks": notebook.blocks,
        "revision": notebook.revision,
    }


def _markdown_blocks(db: Session, version: MessageVersion) -> str:
    blocks = (
        db.query(RenderBlock)
        .filter(RenderBlock.message_version_id == version.id)
        .order_by(RenderBlock.block_index.asc())
        .all()
    )
    parts: list[str] = []
    for block in blocks:
        if block.block_type == "heading":
            level = int(block.data.get("level", 2)) if isinstance(block.data, dict) else 2
            parts.append(f"{'#' * max(1, min(level, 6))} {block.plain_text or block.data.get('title', '')}")
        elif block.block_type == "code":
            language = str(block.data.get("language", "")) if isinstance(block.data, dict) else ""
            code = str(block.data.get("code", block.plain_text or "")) if isinstance(block.data, dict) else block.plain_text or ""
            parts.append(f"```{language}\n{code}\n```")
        else:
            text = block.plain_text or (str(block.data.get("text", "")) if isinstance(block.data, dict) else "")
            if text:
                parts.append(text)
    return "\n\n".join(parts).strip()


def _message_payload(db: Session, message: Message, version: MessageVersion, include_versions: bool) -> dict:
    payload = {
        "id": str(message.id),
        "role": message.role,
        "order_key": message.order_key,
        "turn_index": message.turn_index,
        "created_at": _dt(message.created_at),
        "current_version": _version_payload(db, version),
    }
    if include_versions:
        payload["versions"] = [
            _version_payload(db, row)
            for row in (
                db.query(MessageVersion)
                .filter(MessageVersion.message_id == message.id)
                .order_by(MessageVersion.version_number.asc())
                .all()
            )
        ]
    return payload


def _version_payload(db: Session, version: MessageVersion) -> dict:
    blocks = (
        db.query(RenderBlock)
        .filter(RenderBlock.message_version_id == version.id)
        .order_by(RenderBlock.block_index.asc())
        .all()
    )
    return {
        "id": str(version.id),
        "version_number": version.version_number,
        "plain_text": version.plain_text,
        "display_text": version.display_text,
        "blocks": [
            {
                "block_index": block.block_index,
                "block_type": block.block_type,
                "plain_text": block.plain_text,
                "data": block.data,
                "char_count": block.char_count,
                "collapsed_by_default": block.collapsed_by_default,
                "render_priority": block.render_priority,
            }
            for block in blocks
        ],
        "edit_type": version.edit_type,
        "edit_reason": version.edit_reason,
        "created_at": _dt(version.created_at),
        "created_by": version.created_by,
        "based_on_version_id": str(version.based_on_version_id) if version.based_on_version_id else None,
        "content_hash": version.content_hash,
    }


def _write_export_event(db: Session, conversation_id: uuid.UUID, options: ExportOptions, message_count: int) -> None:
    db.add(
        ConversationEvent(
            id=uuid.uuid4(),
            conversation_id=conversation_id,
            event_type="conversation_exported",
            payload={
                "format": options.format,
                "message_count": message_count,
                "include_metadata": options.include_metadata,
                "include_toc": options.include_toc,
                "include_versions": options.include_versions,
            },
            created_by="system",
        )
    )


def _safe_filename(value: str) -> str:
    safe = re.sub(r"[\\/:*?\"<>|\x00-\x1f]+", "-", value)
    safe = re.sub(r"\s+", " ", safe).strip(" .-")[:120]
    reserved = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}
    if not safe or safe.upper() in reserved or safe in {".", ".."}:
        return "conversation"
    return safe


def _dt(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)
