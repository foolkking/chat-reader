import re
import uuid
from dataclasses import dataclass

from sqlalchemy import case, func, literal, or_
from sqlalchemy.orm import Session

from app.models.conversation import Conversation
from app.models.message import Message
from app.models.project import Project
from app.models.project_conversation import ProjectConversation
from app.models.search_document import SearchDocument


class SearchServiceError(ValueError):
    pass


@dataclass(frozen=True)
class SearchResult:
    document_id: uuid.UUID
    document_type: str
    conversation_id: uuid.UUID
    conversation_title: str
    message_id: uuid.UUID | None
    role: str | None
    order_key: str | None
    snippet: str
    rank: float
    source_profile: str | None
    occurrence_count: int = 1


@dataclass(frozen=True)
class SearchResultPage:
    query: str
    items: list[SearchResult]
    limit: int
    offset: int
    total: int


def search(
    db: Session,
    query: str,
    *,
    limit: int,
    offset: int,
    conversation_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
    document_type: str | None = None,
    role: str | None = None,
) -> SearchResultPage:
    normalized_query = query.strip()
    if not normalized_query:
        raise SearchServiceError("Search query cannot be empty.")
    if conversation_id is not None and db.get(Conversation, conversation_id) is None:
        raise SearchServiceError("Conversation not found.")
    if project_id is not None and db.get(Project, project_id) is None:
        raise SearchServiceError("Project not found.")

    rank_expr = literal(1.0)
    lowered_query = normalized_query.lower()
    like_query = f"%{lowered_query}%"
    base_query = (
        db.query(SearchDocument, Conversation.display_title.label("conversation_title"), rank_expr.label("rank"))
        .join(Conversation, Conversation.id == SearchDocument.conversation_id)
        .filter(Conversation.deleted_at.is_(None), Conversation.status == "active")
    )
    if conversation_id is not None:
        base_query = base_query.filter(SearchDocument.conversation_id == conversation_id)
    if project_id is not None:
        base_query = base_query.join(
            ProjectConversation,
            ProjectConversation.conversation_id == SearchDocument.conversation_id,
        ).filter(ProjectConversation.project_id == project_id)
    if document_type is not None:
        base_query = base_query.filter(SearchDocument.document_type == document_type)
    if role is not None:
        base_query = base_query.filter(SearchDocument.role == role)

    if db.bind is not None and db.bind.dialect.name == "postgresql":
        use_text_query = not _needs_substring_first(normalized_query)
        tsquery = (
            func.plainto_tsquery("simple", normalized_query)
            if use_text_query
            else func.plainto_tsquery("simple", _safe_tsquery_text(normalized_query))
        )
        ts_rank_expr = func.ts_rank_cd(SearchDocument.search_tsv, tsquery)
        title_match = func.lower(SearchDocument.title).like(like_query)
        text_match = func.lower(SearchDocument.search_text).like(like_query)
        exact_title_match = func.lower(SearchDocument.title) == lowered_query
        heading_match = (SearchDocument.document_type == "heading") & text_match
        rank_expr = (
            ts_rank_expr
            + case((exact_title_match, 8.0), else_=0.0)
            + case((title_match, 6.0), else_=0.0)
            + case((text_match & (SearchDocument.document_type == "message"), 4.0), else_=0.0)
            + case((heading_match, 3.0), else_=0.0)
            + case((text_match, 2.0), else_=0.0)
        )
        filters = [title_match, text_match]
        if use_text_query:
            filters.append(SearchDocument.search_tsv.op("@@")(tsquery))
        base_query = (
            db.query(SearchDocument, Conversation.display_title.label("conversation_title"), rank_expr.label("rank"))
            .join(Conversation, Conversation.id == SearchDocument.conversation_id)
            .filter(
                Conversation.deleted_at.is_(None),
                Conversation.status == "active",
                or_(*filters),
            )
        )
        if conversation_id is not None:
            base_query = base_query.filter(SearchDocument.conversation_id == conversation_id)
        if project_id is not None:
            base_query = base_query.join(
                ProjectConversation,
                ProjectConversation.conversation_id == SearchDocument.conversation_id,
            ).filter(ProjectConversation.project_id == project_id)
        if document_type is not None:
            base_query = base_query.filter(SearchDocument.document_type == document_type)
        if role is not None:
            base_query = base_query.filter(SearchDocument.role == role)
        ordered_query = base_query.order_by(rank_expr.desc(), SearchDocument.created_at.desc(), SearchDocument.order_key.asc())
    else:
        title_match = func.lower(SearchDocument.title).like(like_query)
        text_match = func.lower(SearchDocument.search_text).like(like_query)
        rank_expr = (
            case((func.lower(SearchDocument.title) == lowered_query, 8.0), else_=0.0)
            + case((title_match, 6.0), else_=0.0)
            + case((text_match & (SearchDocument.document_type == "message"), 4.0), else_=0.0)
            + case((text_match & (SearchDocument.document_type == "heading"), 3.0), else_=0.0)
            + case((text_match, 2.0), else_=0.0)
        )
        base_query = (
            db.query(SearchDocument, Conversation.display_title.label("conversation_title"), rank_expr.label("rank"))
            .join(Conversation, Conversation.id == SearchDocument.conversation_id)
            .filter(Conversation.deleted_at.is_(None), Conversation.status == "active", or_(text_match, title_match))
        )
        if conversation_id is not None:
            base_query = base_query.filter(SearchDocument.conversation_id == conversation_id)
        if project_id is not None:
            base_query = base_query.join(
                ProjectConversation,
                ProjectConversation.conversation_id == SearchDocument.conversation_id,
            ).filter(ProjectConversation.project_id == project_id)
        if document_type is not None:
            base_query = base_query.filter(SearchDocument.document_type == document_type)
        if role is not None:
            base_query = base_query.filter(SearchDocument.role == role)
        ordered_query = base_query.order_by(rank_expr.desc(), SearchDocument.created_at.desc(), SearchDocument.order_key.asc())

    rows = ordered_query.all()
    message_ids = {document.message_id for document, _, _ in rows if document.message_id is not None}
    content_hashes = (
        dict(db.query(Message.id, Message.content_hash).filter(Message.id.in_(message_ids)).all())
        if message_ids
        else {}
    )
    grouped_rows: list[tuple[SearchDocument, str, float, int]] = []
    group_positions: dict[tuple[str, str], int] = {}
    group_conversations: list[set[uuid.UUID]] = []
    for document, conversation_title, rank in rows:
        content_hash = content_hashes.get(document.message_id)
        key = (
            ("message", content_hash)
            if document.document_type == "message" and content_hash
            else (document.document_type, str(document.id))
        )
        existing_position = group_positions.get(key)
        if existing_position is None:
            group_positions[key] = len(grouped_rows)
            grouped_rows.append((document, conversation_title, float(rank or 0), 1))
            group_conversations.append({document.conversation_id})
            continue
        conversations = group_conversations[existing_position]
        conversations.add(document.conversation_id)
        current = grouped_rows[existing_position]
        grouped_rows[existing_position] = (*current[:3], len(conversations))

    total = len(grouped_rows)
    page_rows = grouped_rows[offset : offset + limit]
    items = [
        SearchResult(
            document_id=document.id,
            document_type=document.document_type,
            conversation_id=document.conversation_id,
            conversation_title=conversation_title,
            message_id=document.message_id,
            role=document.role,
            order_key=document.order_key,
            snippet=_snippet(document.search_text, normalized_query),
            rank=rank,
            source_profile=document.source_profile,
            occurrence_count=occurrence_count,
        )
        for document, conversation_title, rank, occurrence_count in page_rows
    ]
    return SearchResultPage(query=normalized_query, items=items, limit=limit, offset=offset, total=total)


def _snippet(text: str, query: str) -> str:
    normalized_text = " ".join(text.split())
    query_lower = query.lower()
    text_lower = normalized_text.lower()
    index = text_lower.find(query_lower)
    snippet_length = len(query)
    if index < 0:
        for token in _query_tokens(query_lower):
            index = text_lower.find(token)
            if index >= 0:
                snippet_length = len(token)
                break
    if index < 0:
        return normalized_text[:160]
    start = max(0, index - 80)
    end = min(len(normalized_text), index + snippet_length + 80)
    prefix = "..." if start > 0 else ""
    suffix = "..." if end < len(normalized_text) else ""
    return f"{prefix}{normalized_text[start:end]}{suffix}"


def _query_tokens(query: str) -> list[str]:
    return [part for part in re.split(r"\s+", query.replace('"', " ").strip()) if part]


def _needs_substring_first(query: str) -> bool:
    if re.search(r"[\u3400-\u9fff]", query):
        return True
    if len(query.strip()) <= 2:
        return True
    return bool(re.search(r"[./:#?&=_`'\"()[\]{}<>@\\-]", query))


def _safe_tsquery_text(query: str) -> str:
    parts = re.findall(r"[\w\u3400-\u9fff]+", query, flags=re.UNICODE)
    return " ".join(parts) or query
