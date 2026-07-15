import json
import re
import uuid
from datetime import datetime, timezone
from http import HTTPStatus

from sqlalchemy.orm import Session

from app.models.conversation import Conversation
from app.models.conversation_event import ConversationEvent
from app.models.heading import Heading
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.render_block import RenderBlock
from app.schemas.export import ExportOptions, ExportResult


class ExportError(ValueError):
    def __init__(self, message: str, status_code: int = HTTPStatus.BAD_REQUEST) -> None:
        super().__init__(message)
        self.status_code = status_code


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

    _write_export_event(db, conversation.id, options, len(rows))
    content = "\n".join(lines).strip() + "\n"
    return ExportResult(
        content=content,
        media_type="text/markdown; charset=utf-8",
        filename=f"{_safe_filename(conversation.display_title)}.md",
        message_count=len(rows),
    )


def export_conversation_canonical_json(db: Session, conversation_id: uuid.UUID, options: ExportOptions) -> ExportResult:
    conversation = _get_conversation(db, conversation_id)
    rows = _message_rows(db, conversation, options.message_ids)
    toc = _toc_rows(db, conversation, options.message_ids) if options.include_toc else []
    payload = {
        "format": "chat-reader-canonical-export",
        "version": 1,
        "exported_at": _utc_now().isoformat(),
        "conversation": {
            "id": str(conversation.id),
            "title": conversation.title,
            "display_title": conversation.display_title,
            "source_type": conversation.source_type,
            "source_profile": conversation.source_profile,
            "created_at": _dt(conversation.created_at),
            "updated_at": _dt(conversation.updated_at),
            "imported_at": _dt(conversation.imported_at),
            "message_count": len(rows),
        },
        "messages": [_message_payload(db, message, version, options.include_versions) for message, version in rows],
        "toc": [
            {
                "id": str(heading.id),
                "heading_index": heading.heading_index,
                "level": heading.level,
                "text": heading.text,
                "slug": heading.slug,
                "message_id": str(heading.message_id),
                "block_index": heading.block_index,
                "order_key": heading.order_key,
            }
            for heading in toc
        ],
        "metadata": {
            "export_options": {
                "include_metadata": options.include_metadata,
                "include_toc": options.include_toc,
                "include_versions": options.include_versions,
                "selected_message_count": len(options.message_ids),
            }
        },
    }
    if not options.include_metadata:
        payload["metadata"] = {"export_options": {"include_metadata": False}}

    _write_export_event(db, conversation.id, options, len(rows))
    content = json.dumps(payload, ensure_ascii=False, indent=2)
    return ExportResult(
        content=content,
        media_type="application/json; charset=utf-8",
        filename=f"{_safe_filename(conversation.display_title)}.canonical.json",
        message_count=len(rows),
    )


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
    safe = re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip("-._")
    return safe or "conversation"


def _dt(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)
