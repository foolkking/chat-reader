import re
import uuid
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.models.conversation import Conversation
from app.models.heading import Heading
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.render_block import RenderBlock
from app.services.database.bulk_insert import insert_rows


@dataclass(frozen=True)
class TocBuildResult:
    conversation_count: int
    heading_count: int


def delete_headings_for_conversation(db: Session, conversation_id: uuid.UUID) -> None:
    db.query(Heading).filter(Heading.conversation_id == conversation_id).delete(synchronize_session=False)
    db.flush()


def rebuild_headings_for_conversation(db: Session, conversation_id: uuid.UUID) -> TocBuildResult:
    conversation = db.get(Conversation, conversation_id)
    if conversation is None or conversation.deleted_at is not None:
        return TocBuildResult(conversation_count=0, heading_count=0)

    delete_headings_for_conversation(db, conversation_id)
    rows = _heading_source_rows(db, conversation_id)
    slug_counts: dict[str, int] = {}
    heading_count = 0

    heading_rows: list[dict] = []
    for heading_index, row in enumerate(rows):
        text = _heading_text(row.data, row.plain_text)
        if not text:
            continue
        level = _heading_level(row.data)
        slug = _unique_slug(text, heading_index, slug_counts)
        heading_rows.append(
            {
                "id": uuid.uuid4(),
                "conversation_id": conversation_id,
                "message_id": row.message_id,
                "message_version_id": row.message_version_id,
                "render_block_id": row.render_block_id,
                "block_index": row.block_index,
                "heading_index": heading_count,
                "level": level,
                "text": text,
                "slug": slug,
                "order_key": row.order_key,
                "metadata_": {},
            }
        )
        if len(heading_rows) >= 500:
            insert_rows(db, Heading, heading_rows)
            heading_rows.clear()
        heading_count += 1

    if heading_rows:
        insert_rows(db, Heading, heading_rows)
    db.flush()
    return TocBuildResult(conversation_count=1, heading_count=heading_count)


def rebuild_headings_for_all(db: Session) -> TocBuildResult:
    conversation_ids = [
        row[0]
        for row in db.query(Conversation.id).filter(Conversation.deleted_at.is_(None)).all()
    ]
    total = 0
    for conversation_id in conversation_ids:
        total += rebuild_headings_for_conversation(db, conversation_id).heading_count
    return TocBuildResult(conversation_count=len(conversation_ids), heading_count=total)


def _heading_source_rows(db: Session, conversation_id: uuid.UUID):
    return (
        db.query(
            Message.id.label("message_id"),
            Message.order_key,
            MessageVersion.id.label("message_version_id"),
            RenderBlock.id.label("render_block_id"),
            RenderBlock.block_index,
            RenderBlock.plain_text,
            RenderBlock.data,
        )
        .join(MessageVersion, MessageVersion.id == Message.current_version_id)
        .join(RenderBlock, RenderBlock.message_version_id == MessageVersion.id)
        .filter(
            Message.conversation_id == conversation_id,
            Message.is_deleted.is_(False),
            RenderBlock.block_type == "heading",
        )
        .order_by(Message.order_key.asc(), RenderBlock.block_index.asc())
        .yield_per(500)
    )


def _heading_text(data: dict, plain_text: str | None) -> str:
    title = data.get("title") if isinstance(data, dict) else None
    return str(title or plain_text or "").strip()


def _heading_level(data: dict) -> int:
    raw_level = data.get("level") if isinstance(data, dict) else None
    try:
        level = int(raw_level)
    except (TypeError, ValueError):
        level = 3
    return max(1, min(level, 6))


def _unique_slug(text: str, index: int, slug_counts: dict[str, int]) -> str:
    base = _slugify(text) or f"heading-{index}"
    count = slug_counts.get(base, 0) + 1
    slug_counts[base] = count
    return base if count == 1 else f"{base}-{count}"


def _slugify(text: str) -> str:
    normalized = re.sub(r"\s+", "-", text.strip().lower())
    normalized = re.sub(r"[^\w\-\u4e00-\u9fff]", "", normalized, flags=re.UNICODE)
    return normalized.strip("-")
