"""Version 1 readable projection. Structured annotations remain authoritative."""
from collections.abc import Iterator
from datetime import datetime, timezone
import re

from sqlalchemy import func
from app.models.annotation import ConversationAnnotation
from app.models.message import Message
from app.models.message_version import MessageVersion

DOCUMENT_PATH = "annotations.md"
DOCUMENT_VERSION = 1


def timestamp(value):
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return value.replace(tzinfo=value.tzinfo or timezone.utc).astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def annotation_query(db, conversation_id, subject_key, message_ids=None):
    positions = db.query(
        Message.id.label("id"), Message.role.label("role"),
        func.row_number().over(order_by=(Message.order_key, Message.id)).label("seq"),
    ).filter(Message.conversation_id == conversation_id, Message.is_deleted.is_(False)).subquery()
    query = db.query(ConversationAnnotation, positions.c.seq, positions.c.role, MessageVersion.message_id).outerjoin(
        positions, positions.c.id == ConversationAnnotation.message_id,
    ).outerjoin(MessageVersion, MessageVersion.id == ConversationAnnotation.message_version_id).filter(
        ConversationAnnotation.conversation_id == conversation_id,
        ConversationAnnotation.subject_key == subject_key, ConversationAnnotation.is_deleted.is_(False),
    )
    if message_ids is not None:
        query = query.filter(ConversationAnnotation.message_id.in_(message_ids))
    return query.order_by(
        positions.c.seq.asc().nullslast(), ConversationAnnotation.start_block_index.asc().nullslast(),
        ConversationAnnotation.start_offset.asc().nullslast(), ConversationAnnotation.created_at, ConversationAnnotation.id,
    )


def annotation_record(annotation, seq, role, version_message_id):
    message_available = seq is not None
    version_available = message_available and version_message_id == annotation.message_id
    original = {}
    if annotation.message_id and not message_available:
        original["message_id"] = str(annotation.message_id)
    if annotation.message_version_id and not version_available:
        original["version_id"] = str(annotation.message_version_id)
    return {
        "record_type": "annotation", "id": str(annotation.id),
        "message_id": str(annotation.message_id) if message_available else None,
        "message_seq": seq, "message_role": role,
        "version_id": str(annotation.message_version_id) if version_available else None,
        **({"unavailable_anchor": original} if original else {}),
        "start_block_index": annotation.start_block_index, "start_offset": annotation.start_offset,
        "end_block_index": annotation.end_block_index, "end_offset": annotation.end_offset,
        "quoted_text": annotation.quote, "annotation_type": annotation.annotation_type, "color": annotation.color,
        "comment_markdown": annotation.comment_markdown, "anchor_status": annotation.anchor_status,
        "created_at": timestamp(annotation.created_at), "updated_at": timestamp(annotation.updated_at),
    }


def document_header(title, exported_at, count, *, scope="export_scope", source="server_snapshot"):
    title = str(title or "").replace("\r", " ").replace("\n", " ")
    return (
        "# 批注导出\n\n"
        "<!-- chat-reader-annotation-export version=1 -->\n\n"
        f"对话：{title}\n"
        f"导出时间：{timestamp(exported_at)}\n"
        f"范围：{scope}\n来源：{source}\n批注数：{count}\n\n"
        "> 可读导出，不作为批注回传格式。原文摘录为批注保存时的引用，批注内容是用户观点，不是原文事实。\n\n"
        + ("没有未删除的已保存批注。\n" if not count else "")
    ).encode("utf-8")


def document_entry(record, ordinal):
    seq = record.get("message_seq")
    position = f"消息 {seq} · {record.get('message_role') or 'unknown'}" if seq is not None else "无法定位到当前原文"
    lines = [
        f"## {position}", "", f"### 批注 {ordinal} · {record['annotation_type']}", "",
        f"- 状态：{record['anchor_status']}", f"- 颜色：{record.get('color') or 'none'}",
        f"- 创建时间：{record.get('created_at') or ''}", f"- 更新时间：{record.get('updated_at') or ''}", "",
    ]
    quote = record.get("quoted_text")
    if quote:
        fence = "`" * max(3, max((len(match[0]) + 1 for match in re.finditer(r"`+", quote)), default=3))
        lines.extend(["#### 原文摘录", "", fence + "text", quote, fence, ""])
    elif record["annotation_type"] != "bookmark":
        lines.extend(["#### 原文摘录", "", "未保存原文摘录。", ""])
    lines.extend(["#### 批注内容", "", record.get("comment_markdown") or "（无文字批注）", "", ""])
    return "\n".join(lines).encode("utf-8")


def iter_document(query, *, title, exported_at, scope="export_scope", source="server_snapshot") -> Iterator[bytes]:
    count = query.order_by(None).count()
    yield document_header(title, exported_at, count, scope=scope, source=source)
    # Only the current annotation body is retained, including large comments.
    for ordinal, row in enumerate(query.yield_per(1), 1):
        yield document_entry(annotation_record(*row), ordinal)


def manifest_extension(count, *, included=True):
    return {
        "version": DOCUMENT_VERSION, "status": "included" if included else "omitted_by_request",
        **({"path": DOCUMENT_PATH, "media_type": "text/markdown", "count": count,
            "source": "conversation.canjsonl", "scope": "export_scope"} if included else {}),
    }
