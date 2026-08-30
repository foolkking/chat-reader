import re
import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import case, func, literal, or_
from sqlalchemy.orm import Session

from app.models.conversation import Conversation
from app.models.message import Message
from app.models.project import Project
from app.models.project_conversation import ProjectConversation
from app.models.render_block import RenderBlock
from app.models.search_document import SearchDocument
from app.schemas.search import SearchMatch


class SearchServiceError(ValueError):
    pass


@dataclass(frozen=True)
class SearchResult:
    document_id: uuid.UUID
    document_type: str
    conversation_id: uuid.UUID
    conversation_title: str
    message_id: uuid.UUID | None
    message_version_id: uuid.UUID | None
    role: str | None
    order_key: str | None
    block_index: int | None
    render_block_id: uuid.UUID | None
    character_offset: int | None
    snippet: str
    rank: float
    source_profile: str | None
    occurrence_count: int = 1
    matches: list[SearchMatch] | None = None
    annotation_id: uuid.UUID | None = None
    annotation_type: str | None = None
    annotation_color: str | None = None


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
    status_scope: str = "active",
    date_from: datetime | None = None,
    date_to: datetime | None = None,
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
        .filter(Conversation.deleted_at.is_(None), _status_filter(status_scope))
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
    if date_from is not None:
        base_query = base_query.filter(SearchDocument.created_at >= date_from)
    if date_to is not None:
        base_query = base_query.filter(SearchDocument.created_at <= date_to)

    if db.bind is not None and db.bind.dialect.name == "postgresql":
        use_text_query = not _needs_substring_first(normalized_query)
        tsquery = (
            func.plainto_tsquery("simple", normalized_query)
            if use_text_query
            else func.plainto_tsquery("simple", _safe_tsquery_text(normalized_query))
        )
        ts_rank_expr = func.ts_rank_cd(SearchDocument.search_tsv, tsquery)
        title_match = SearchDocument.title.ilike(like_query)
        text_match = SearchDocument.search_text.ilike(like_query)
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
        # A conversation-scoped search is a content search. The conversation
        # title must not make every message look like a hit with no navigable
        # occurrence in the message body.
        filters = [text_match] if conversation_id is not None else [title_match, text_match]
        if use_text_query:
            filters.append(SearchDocument.search_tsv.op("@@")(tsquery))
        base_query = (
            db.query(SearchDocument, Conversation.display_title.label("conversation_title"), rank_expr.label("rank"))
            .join(Conversation, Conversation.id == SearchDocument.conversation_id)
            .filter(
                Conversation.deleted_at.is_(None),
                _status_filter(status_scope),
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
        if date_from is not None:
            base_query = base_query.filter(SearchDocument.created_at >= date_from)
        if date_to is not None:
            base_query = base_query.filter(SearchDocument.created_at <= date_to)
        ordered_query = base_query.order_by(rank_expr.desc(), SearchDocument.created_at.desc(), SearchDocument.order_key.asc())
    else:
        title_match = SearchDocument.title.ilike(like_query)
        text_match = SearchDocument.search_text.ilike(like_query)
        rank_expr = (
            case((func.lower(SearchDocument.title) == lowered_query, 8.0), else_=0.0)
            + case((title_match, 6.0), else_=0.0)
            + case((text_match & (SearchDocument.document_type == "message"), 4.0), else_=0.0)
            + case((text_match & (SearchDocument.document_type == "heading"), 3.0), else_=0.0)
            + case((text_match, 2.0), else_=0.0)
        )
        scoped_match = text_match if conversation_id is not None else or_(text_match, title_match)
        base_query = (
            db.query(SearchDocument, Conversation.display_title.label("conversation_title"), rank_expr.label("rank"))
            .join(Conversation, Conversation.id == SearchDocument.conversation_id)
            .filter(Conversation.deleted_at.is_(None), _status_filter(status_scope), scoped_match)
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
        if date_from is not None:
            base_query = base_query.filter(SearchDocument.created_at >= date_from)
        if date_to is not None:
            base_query = base_query.filter(SearchDocument.created_at <= date_to)
        ordered_query = base_query.order_by(rank_expr.desc(), SearchDocument.created_at.desc(), SearchDocument.order_key.asc())

    rows = ordered_query.with_entities(
        SearchDocument.id.label("document_id"),
        SearchDocument.document_type,
        SearchDocument.conversation_id,
        SearchDocument.message_id,
        Message.content_hash.label("content_hash"),
        Conversation.display_title.label("conversation_title"),
        rank_expr.label("rank"),
    ).outerjoin(Message, Message.id == SearchDocument.message_id).all()
    grouped_rows: list[tuple[uuid.UUID, str, uuid.UUID, uuid.UUID | None, str, float, int]] = []
    group_positions: dict[tuple[str, str], int] = {}
    group_conversations: list[set[uuid.UUID]] = []
    for row in rows:
        content_hash = row.content_hash
        key = (
            ("message", content_hash)
            if row.document_type == "message" and content_hash
            else (row.document_type, str(row.document_id))
        )
        existing_position = group_positions.get(key)
        if existing_position is None:
            group_positions[key] = len(grouped_rows)
            grouped_rows.append(
                (
                    row.document_id,
                    row.document_type,
                    row.conversation_id,
                    row.message_id,
                    row.conversation_title,
                    float(row.rank or 0),
                    1,
                )
            )
            group_conversations.append({row.conversation_id})
            continue
        conversations = group_conversations[existing_position]
        conversations.add(row.conversation_id)
        current = grouped_rows[existing_position]
        grouped_rows[existing_position] = (*current[:6], len(conversations))

    total = len(grouped_rows)
    page_rows = grouped_rows[offset : offset + limit]
    documents = {
        document.id: document
        for document in db.query(SearchDocument)
        .filter(SearchDocument.id.in_([row[0] for row in page_rows]))
        .all()
    }
    message_version_ids = {
        document.message_version_id
        for document in documents.values()
        if document.message_version_id is not None
    }
    block_texts_by_version: dict[uuid.UUID, list[tuple[int, str, uuid.UUID]]] = {}
    if message_version_ids:
        block_rows = (
            db.query(RenderBlock.message_version_id, RenderBlock.block_index, RenderBlock.plain_text, RenderBlock.id)
            .filter(RenderBlock.message_version_id.in_(message_version_ids))
            .order_by(RenderBlock.message_version_id.asc(), RenderBlock.block_index.asc())
            .all()
        )
        for version_id, block_index, plain_text, block_id in block_rows:
            block_texts_by_version.setdefault(version_id, []).append((block_index, plain_text or "", block_id))
    items = [
        _build_search_result(
            document,
            conversation_title=conversation_title,
            normalized_query=normalized_query,
            rank=rank,
            occurrence_count=occurrence_count,
            block_texts_by_version=block_texts_by_version,
            db=db,
        )
        for document_id, _, _, _, conversation_title, rank, occurrence_count in page_rows
        if (document := documents.get(document_id)) is not None
    ]
    return SearchResultPage(query=normalized_query, items=items, limit=limit, offset=offset, total=total)


def _status_filter(status_scope: str):
    if status_scope == "archived":
        return Conversation.status == "archived"
    if status_scope == "all":
        return Conversation.status.in_(("active", "archived"))
    return Conversation.status == "active"


def _document_block_index(document: SearchDocument) -> int | None:
    metadata = document.metadata_ if isinstance(document.metadata_, dict) else {}
    raw = metadata.get("block_index", metadata.get("start_block_index"))
    try:
        return int(raw) if raw is not None else None
    except (TypeError, ValueError):
        return None


def _document_character_offset(document: SearchDocument) -> int | None:
    metadata = document.metadata_ if isinstance(document.metadata_, dict) else {}
    raw = metadata.get("character_offset", metadata.get("start_offset"))
    try:
        return int(raw) if raw is not None else None
    except (TypeError, ValueError):
        return None


def _document_render_block_id(document: SearchDocument) -> uuid.UUID | None:
    metadata = document.metadata_ if isinstance(document.metadata_, dict) else {}
    raw = metadata.get("render_block_id")
    if not raw:
        return None
    try:
        return uuid.UUID(str(raw))
    except (ValueError, TypeError, AttributeError):
        return None


def _annotation_fields(document: SearchDocument) -> tuple[uuid.UUID | None, str | None, str | None]:
    metadata = document.metadata_ if isinstance(document.metadata_, dict) else {}
    try:
        annotation_id = uuid.UUID(str(metadata["annotation_id"])) if metadata.get("annotation_id") else None
    except (ValueError, TypeError):
        annotation_id = None
    return annotation_id, metadata.get("annotation_type"), metadata.get("annotation_color")


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


def _build_search_result(
    document: SearchDocument,
    *,
    conversation_title: str,
    normalized_query: str,
    rank: float,
    occurrence_count: int,
    block_texts_by_version: dict[uuid.UUID, list[tuple[int, str, uuid.UUID]]],
    db: Session,
) -> SearchResult:
    matches = _document_matches(document, normalized_query, db, block_texts_by_version)
    annotation_id, annotation_type, annotation_color = _annotation_fields(document)
    return SearchResult(
        document_id=document.id,
        document_type=document.document_type,
        conversation_id=document.conversation_id,
        conversation_title=conversation_title,
        message_id=document.message_id,
        message_version_id=document.message_version_id,
        role=document.role,
        order_key=document.order_key,
        block_index=_document_block_index(document),
        render_block_id=_document_render_block_id(document),
        character_offset=_document_character_offset(document),
        snippet=_result_snippet(document, normalized_query, matches, block_texts_by_version),
        rank=rank,
        source_profile=document.source_profile,
        occurrence_count=occurrence_count,
        matches=matches,
        annotation_id=annotation_id,
        annotation_type=annotation_type,
        annotation_color=annotation_color,
    )


def _result_snippet(
    document: SearchDocument,
    query: str,
    matches: list[SearchMatch],
    block_texts_by_version: dict[uuid.UUID, list[tuple[int, str, uuid.UUID]]],
) -> str:
    if matches:
        match = matches[0]
        text = document.plain_text or document.search_text
        if match.block_index is not None:
            block_texts = {index: text for index, text, _block_id in block_texts_by_version.get(document.message_version_id, [])}
            text = block_texts.get(match.block_index, text) or text
        return _snippet(text, match.quote)
    return _snippet(document.plain_text or document.search_text, query)


def _document_matches(
    document: SearchDocument,
    query: str,
    db: Session,
    block_texts_by_version: dict[uuid.UUID, list[tuple[int, str, uuid.UUID]]] | None = None,
) -> list[SearchMatch]:
    if document.message_version_id is None:
        return []
    candidates = (block_texts_by_version or {}).get(document.message_version_id)
    if candidates is None:
        blocks = db.query(RenderBlock).filter(
            RenderBlock.message_version_id == document.message_version_id,
        ).order_by(RenderBlock.block_index.asc()).all()
        candidates = [(block.block_index, block.plain_text or "", block.id) for block in blocks]
    if not candidates:
        candidates = [(None, document.plain_text or document.search_text, None)]
    matches: list[SearchMatch] = []
    for block_index, text, block_id in candidates:
        matches.extend(_find_text_matches(text, query, block_index, block_id))
        if len(matches) >= 100:
            break
    return matches[:100]


def _find_text_matches(text: str, query: str, block_index: int | None, render_block_id: uuid.UUID | None = None) -> list[SearchMatch]:
    normalized_text = " ".join(text.split())
    normalized_query = " ".join(query.split())
    if not normalized_text or not normalized_query:
        return []
    lower_text = normalized_text.casefold()
    lower_query = normalized_query.casefold()
    offsets: list[tuple[int, int]] = []
    cursor = 0
    while True:
        index = lower_text.find(lower_query, cursor)
        if index < 0:
            break
        offsets.append((index, index + len(normalized_query)))
        cursor = index + max(1, len(normalized_query))
    if not offsets:
        for token in _query_tokens(lower_query):
            index = lower_text.find(token)
            if index >= 0:
                offsets.append((index, index + len(token)))
                break
    result: list[SearchMatch] = []
    for start, end in offsets:
        before_start = max(0, start - 80)
        after_end = min(len(normalized_text), end + 80)
        result.append(SearchMatch(
            block_index=block_index,
            render_block_id=render_block_id,
            match_start=start,
            match_end=end,
            quote=normalized_text[start:end],
            context_before=normalized_text[before_start:start],
            context_after=normalized_text[end:after_end],
        ))
    return result


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
