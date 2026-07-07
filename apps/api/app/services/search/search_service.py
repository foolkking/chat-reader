import uuid
from dataclasses import dataclass

from sqlalchemy import func, literal
from sqlalchemy.orm import Session

from app.models.conversation import Conversation
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
) -> SearchResultPage:
    normalized_query = query.strip()
    if not normalized_query:
        raise SearchServiceError("Search query cannot be empty.")
    if conversation_id is not None and db.get(Conversation, conversation_id) is None:
        raise SearchServiceError("Conversation not found.")
    if project_id is not None and db.get(Project, project_id) is None:
        raise SearchServiceError("Project not found.")

    rank_expr = literal(1.0)
    base_query = (
        db.query(SearchDocument, Conversation.display_title.label("conversation_title"), rank_expr.label("rank"))
        .join(Conversation, Conversation.id == SearchDocument.conversation_id)
        .filter(Conversation.deleted_at.is_(None))
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

    if db.bind is not None and db.bind.dialect.name == "postgresql":
        tsquery = func.websearch_to_tsquery("simple", normalized_query)
        rank_expr = func.ts_rank_cd(SearchDocument.search_tsv, tsquery)
        base_query = (
            db.query(SearchDocument, Conversation.display_title.label("conversation_title"), rank_expr.label("rank"))
            .join(Conversation, Conversation.id == SearchDocument.conversation_id)
            .filter(Conversation.deleted_at.is_(None), SearchDocument.search_tsv.op("@@")(tsquery))
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
        ordered_query = base_query.order_by(rank_expr.desc(), SearchDocument.created_at.desc(), SearchDocument.order_key.asc())
    else:
        lowered = f"%{normalized_query.lower()}%"
        base_query = base_query.filter(func.lower(SearchDocument.search_text).like(lowered))
        ordered_query = base_query.order_by(SearchDocument.created_at.desc(), SearchDocument.order_key.asc())

    total = ordered_query.count()
    rows = ordered_query.offset(offset).limit(limit).all()
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
            rank=float(rank or 0),
            source_profile=document.source_profile,
        )
        for document, conversation_title, rank in rows
    ]
    return SearchResultPage(query=normalized_query, items=items, limit=limit, offset=offset, total=total)


def _snippet(text: str, query: str) -> str:
    normalized_text = " ".join(text.split())
    index = normalized_text.lower().find(query.lower())
    if index < 0:
        return normalized_text[:160]
    start = max(0, index - 80)
    end = min(len(normalized_text), index + len(query) + 80)
    prefix = "..." if start > 0 else ""
    suffix = "..." if end < len(normalized_text) else ""
    return f"{prefix}{normalized_text[start:end]}{suffix}"
