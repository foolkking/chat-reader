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
from app.services.ownership import LEGACY_OWNERSHIP_SCOPE, OwnershipScope, get_owned


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
    matches_truncated: bool = False
    matches: list[SearchMatch] | None = None
    attachment_id: uuid.UUID | None = None
    attachment_display_name: str | None = None
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
    has_more: bool


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
    ownership_scope: OwnershipScope = LEGACY_OWNERSHIP_SCOPE,
) -> SearchResultPage:
    normalized_query = query.strip()
    if not normalized_query:
        raise SearchServiceError("Search query cannot be empty.")
    if conversation_id is not None and get_owned(db, Conversation, conversation_id, ownership_scope) is None:
        raise SearchServiceError("Conversation not found.")
    if project_id is not None and get_owned(db, Project, project_id, ownership_scope) is None:
        raise SearchServiceError("Project not found.")

    rank_expr = literal(1.0)
    lowered_query = normalized_query.lower()
    like_query = f"%{_escape_like_pattern(lowered_query)}%"
    base_query = (
        db.query(SearchDocument, Conversation.display_title.label("conversation_title"), rank_expr.label("rank"))
        .join(Conversation, Conversation.id == SearchDocument.conversation_id)
        .filter(
            ownership_scope.predicate(Conversation),
            Conversation.deleted_at.is_(None),
            _status_filter(status_scope),
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

    if db.bind is not None and db.bind.dialect.name == "postgresql":
        use_text_query = not _needs_substring_first(normalized_query)
        tsquery = (
            func.plainto_tsquery("simple", normalized_query)
            if use_text_query
            else func.plainto_tsquery("simple", _safe_tsquery_text(normalized_query))
        )
        ts_rank_expr = func.ts_rank_cd(SearchDocument.search_tsv, tsquery)
        title_match = SearchDocument.title.ilike(like_query, escape="\\")
        text_match = SearchDocument.search_text.ilike(like_query, escape="\\")
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
                ownership_scope.predicate(Conversation),
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
        ordered_query = base_query.order_by(rank_expr.desc(), SearchDocument.created_at.desc(), SearchDocument.order_key.asc(), SearchDocument.id.asc())
    else:
        title_match = SearchDocument.title.ilike(like_query, escape="\\")
        text_match = SearchDocument.search_text.ilike(like_query, escape="\\")
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
            .filter(
                ownership_scope.predicate(Conversation),
                Conversation.deleted_at.is_(None),
                _status_filter(status_scope),
                scoped_match,
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
        ordered_query = base_query.order_by(rank_expr.desc(), SearchDocument.created_at.desc(), SearchDocument.order_key.asc(), SearchDocument.id.asc())

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
        # Global/project search folds copies across conversations. Within one
        # conversation every distinct message must keep its own navigable target.
        key = (
            ("message", content_hash)
            if conversation_id is None and row.document_type == "message" and content_hash
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
    return SearchResultPage(query=normalized_query, items=items, limit=limit, offset=offset, total=total, has_more=offset + len(items) < total)


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


def _attachment_fields(document: SearchDocument) -> tuple[uuid.UUID | None, str | None]:
    if document.document_type != "attachment":
        return None, None
    metadata = document.metadata_ if isinstance(document.metadata_, dict) else {}
    try:
        attachment_id = uuid.UUID(str(metadata["attachment_id"])) if metadata.get("attachment_id") else None
    except (ValueError, TypeError):
        attachment_id = None
    display_name = document.title or metadata.get("display_name")
    return attachment_id, display_name if isinstance(display_name, str) else None


def _snippet(text: str, query: str) -> str:
    matches = _find_text_matches(text, query, None, max_matches=1)
    if not matches:
        return " ".join(text.split())[:160]
    match = matches[0]
    return _snippet_at_range(text, match.match_start, match.match_end)


def _snippet_at_range(text: str, match_start: int, match_end: int) -> str:
    start = max(0, match_start - 80)
    end = min(len(text), match_end + 80)
    prefix = "..." if start > 0 else ""
    suffix = "..." if end < len(text) else ""
    return f"{prefix}{' '.join(text[start:end].split())}{suffix}"


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
    matches_truncated = len(matches) > 100
    matches = matches[:100]
    first_match = matches[0] if matches else None
    annotation_id, annotation_type, annotation_color = _annotation_fields(document)
    attachment_id, attachment_display_name = _attachment_fields(document)
    return SearchResult(
        document_id=document.id,
        document_type=document.document_type,
        conversation_id=document.conversation_id,
        conversation_title=conversation_title,
        message_id=document.message_id,
        message_version_id=document.message_version_id,
        role=document.role,
        order_key=document.order_key,
        block_index=first_match.block_index if first_match else _document_block_index(document),
        render_block_id=first_match.render_block_id if first_match else _document_render_block_id(document),
        character_offset=first_match.match_start if first_match else _document_character_offset(document),
        snippet=_result_snippet(document, normalized_query, matches, block_texts_by_version),
        rank=rank,
        source_profile=document.source_profile,
        occurrence_count=occurrence_count,
        matches=matches,
        matches_truncated=matches_truncated,
        attachment_id=attachment_id,
        attachment_display_name=attachment_display_name,
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
        return _snippet_at_range(text, match.match_start, match.match_end)
    return _snippet(document.plain_text or document.search_text, query)


def _document_matches(
    document: SearchDocument,
    query: str,
    db: Session,
    block_texts_by_version: dict[uuid.UUID, list[tuple[int, str, uuid.UUID]]] | None = None,
) -> list[SearchMatch]:
    # SearchMatch is a canonical RenderBlock range, not a range in an
    # attachment extract, annotation comment or conversation title.
    if document.document_type not in {"message", "heading", "code"} or document.message_version_id is None:
        return []
    requested_block_index = _document_block_index(document) if document.document_type in {"heading", "code"} else None
    if document.document_type in {"heading", "code"} and requested_block_index is None:
        return []
    candidates = (block_texts_by_version or {}).get(document.message_version_id)
    if candidates is None:
        blocks = db.query(RenderBlock).filter(
            RenderBlock.message_version_id == document.message_version_id,
        ).order_by(RenderBlock.block_index.asc()).all()
        candidates = [(block.block_index, block.plain_text or "", block.id) for block in blocks]
    if not candidates:
        return []
    matches: list[SearchMatch] = []
    for block_index, text, block_id in candidates:
        if requested_block_index is not None and block_index != requested_block_index:
            continue
        remaining = 101 - len(matches)
        if remaining <= 0:
            break
        matches.extend(_find_text_matches(text, query, block_index, block_id, max_matches=remaining))
    return matches


def _find_text_matches(
    text: str,
    query: str,
    block_index: int | None,
    render_block_id: uuid.UUID | None = None,
    *,
    max_matches: int = 100,
) -> list[SearchMatch]:
    if max_matches <= 0:
        return []
    lower_text, folded_spans = _normalized_search_text(text)
    lower_query = " ".join(query.split()).casefold()
    if not lower_text or not lower_query:
        return []
    cursor = 0
    offsets: list[tuple[int, int]] = []
    while True:
        index = lower_text.find(lower_query, cursor)
        if index < 0:
            break
        end = index + len(lower_query)
        raw_span = _raw_match_span(folded_spans, index, end)
        if not offsets or offsets[-1] != raw_span:
            offsets.append(raw_span)
        if len(offsets) >= max_matches:
            break
        cursor = index + max(1, len(lower_query))
    if not offsets:
        for token in _query_tokens(lower_query):
            index = lower_text.find(token)
            if index >= 0:
                offsets.append(_raw_match_span(folded_spans, index, index + len(token)))
                break
    result: list[SearchMatch] = []
    for start, end in offsets:
        before_start = max(0, start - 80)
        after_end = min(len(text), end + 80)
        result.append(SearchMatch(
            block_index=block_index,
            render_block_id=render_block_id,
            match_start=start,
            match_end=end,
            quote=text[start:end],
            context_before=text[before_start:start],
            context_after=text[end:after_end],
        ))
    return result


def _normalized_search_text(text: str) -> tuple[str, list[tuple[int, int]]]:
    """Return a case-folded search surface and raw code-point spans.

    The search surface collapses whitespace like the legacy matcher, while
    every emitted code point retains the source range it came from. This
    keeps canonical reader offsets in the original RenderBlock text even when
    casefold expands a character such as ``ß``.
    """
    output: list[str] = []
    spans: list[tuple[int, int]] = []
    pending_start: int | None = None
    pending_end: int | None = None
    has_content = False
    for index, char in enumerate(text):
        if char.isspace():
            if has_content and pending_start is None:
                pending_start = index
            if pending_start is not None:
                pending_end = index + 1
            continue
        if pending_start is not None and pending_end is not None:
            output.append(" ")
            spans.append((pending_start, pending_end))
            pending_start = None
            pending_end = None
        folded = char.casefold()
        output.extend(folded)
        spans.extend([(index, index + 1)] * len(folded))
        has_content = True
    return "".join(output), spans


def _raw_match_span(spans: list[tuple[int, int]], start: int, end: int) -> tuple[int, int]:
    if start < 0 or end <= start or start >= len(spans):
        return (0, 0)
    return spans[start][0], spans[min(end, len(spans)) - 1][1]


def _escape_like_pattern(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _query_tokens(query: str) -> list[str]:
    return [part for part in re.split(r"\s+", query.replace('"', " ").strip()) if part]


def _needs_substring_first(query: str) -> bool:
    if re.search(r"[\u3400-\u9fff]", query):
        return True
    if len(query.strip()) <= 2:
        return True
    return bool(re.search(r"[./:#?&=%_`'\"()[\]{}<>@\\-]", query))


def _safe_tsquery_text(query: str) -> str:
    parts = re.findall(r"[\w\u3400-\u9fff]+", query, flags=re.UNICODE)
    return " ".join(parts) or query
