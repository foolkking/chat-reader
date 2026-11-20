import re
import uuid
from collections.abc import Iterable
from dataclasses import dataclass, replace
from datetime import datetime
from itertools import islice

from sqlalchemy import String, and_, case, cast, func, literal, or_
from sqlalchemy.orm import Session

from app.models.conversation import Conversation
from app.models.message import Message
from app.models.project import Project
from app.models.project_conversation import ProjectConversation
from app.models.render_block import RenderBlock
from app.models.search_document import SearchDocument
from app.models.user_feature_entry import UserFeatureEntry
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
    hit_count: int = 1
    project_name: str | None = None
    conversation_status: str = "active"


@dataclass(frozen=True)
class SearchResultPage:
    query: str
    items: list[SearchResult]
    limit: int
    offset: int
    total: int
    has_more: bool
    next_offset: int | None = None
    next_match_offset: int = 0
    next_document_id: uuid.UUID | None = None


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
    tag_id: uuid.UUID | None = None,
    duplicate_of: uuid.UUID | None = None,
    grouped: bool = False,
    terms_mode: bool = False,
    reader_find: bool = False,
    match_offset: int = 0,
    match_document_id: uuid.UUID | None = None,
    sort: str = "relevance",
    ownership_scope: OwnershipScope = LEGACY_OWNERSHIP_SCOPE,
) -> SearchResultPage:
    normalized_query = query.strip()
    if not normalized_query:
        raise SearchServiceError("Search query cannot be empty.")
    if conversation_id is not None and get_owned(db, Conversation, conversation_id, ownership_scope) is None:
        raise SearchServiceError("Conversation not found.")
    if project_id is not None and get_owned(db, Project, project_id, ownership_scope) is None:
        raise SearchServiceError("Project not found.")

    if reader_find:
        if (conversation_id is None or grouped or terms_mode or sort != "relevance"
                or any(x is not None for x in (project_id, tag_id, duplicate_of, date_from, date_to))):
            raise SearchServiceError("Reader find requires one conversation and no catalog filters.")
        return _find_in_reader(db, normalized_query, conversation_id, document_type, role,
                               status_scope, ownership_scope, limit, offset, match_offset, match_document_id)

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

    terms = query_terms(normalized_query) if grouped or terms_mode else [normalized_query]
    if grouped or terms_mode:
        # Title eligibility is restricted to the title document. Messages must
        # contain all terms in their own text, not in their copied title field.
        text_match = and_(*(SearchDocument.search_text.ilike(f"%{_escape_like_pattern(term.lower())}%", escape="\\") for term in terms))
        title_match = and_(SearchDocument.document_type == "conversation", *(
            SearchDocument.title.ilike(f"%{_escape_like_pattern(term.lower())}%", escape="\\") for term in terms))
        exact_title = and_(SearchDocument.document_type == "conversation", func.lower(SearchDocument.title) == " ".join(terms).lower())
        rank_expr = case((exact_title, 100.0), (title_match, 80.0),
                         (SearchDocument.document_type == "conversation", 10.0), else_=20.0)
        if db.get_bind().dialect.name == "postgresql":
            # Normalize to [0, 1): content relevance breaks ties without
            # overruling a title match or rewarding the number of documents.
            rank_expr = rank_expr + func.coalesce(func.ts_rank_cd(
                SearchDocument.search_tsv, func.plainto_tsquery("simple", " ".join(terms)), 32), 0.0)
        ordered_query = db.query(SearchDocument).join(Conversation, Conversation.id == SearchDocument.conversation_id).filter(
            ownership_scope.predicate(Conversation), Conversation.deleted_at.is_(None),
            _status_filter(status_scope), or_(text_match, title_match))
        if conversation_id is not None:
            ordered_query = ordered_query.filter(Conversation.id == conversation_id)
        if project_id is not None:
            ordered_query = ordered_query.join(ProjectConversation, ProjectConversation.conversation_id == Conversation.id).filter(ProjectConversation.project_id == project_id)
        if document_type is not None:
            ordered_query = ordered_query.filter(SearchDocument.document_type == document_type)
        if role is not None:
            ordered_query = ordered_query.filter(SearchDocument.role == role)
        if date_from is not None:
            ordered_query = ordered_query.filter(SearchDocument.created_at >= date_from)
        if date_to is not None:
            ordered_query = ordered_query.filter(SearchDocument.created_at <= date_to)
    if tag_id is not None:
        subject = str(ownership_scope.owner_user_id) if ownership_scope.owner_user_id else "local:default"
        tag = db.query(UserFeatureEntry).filter(
            UserFeatureEntry.id == tag_id, UserFeatureEntry.subject_key == subject,
            UserFeatureEntry.collection == "conversation-tag",
        ).first()
        if tag is None:
            raise SearchServiceError("Tag not found.")
        ordered_query = ordered_query.filter(SearchDocument.conversation_id.in_(
            [uuid.UUID(value) for value in (tag.value or {}).get("conversation_ids", [])]
        ))
    ordered_query = ordered_query.outerjoin(Message, Message.id == SearchDocument.message_id)
    if duplicate_of is not None:
        source = db.query(Message.content_hash).join(
            SearchDocument, SearchDocument.message_id == Message.id,
        ).join(Conversation, Conversation.id == SearchDocument.conversation_id).filter(
            SearchDocument.id == duplicate_of, SearchDocument.document_type == "message",
            ownership_scope.predicate(Conversation), Conversation.deleted_at.is_(None),
        ).first()
        if source is None or not source.content_hash:
            raise SearchServiceError("Duplicate source not found.")
        ordered_query = ordered_query.filter(
            SearchDocument.document_type == "message", Message.content_hash == source.content_hash,
        )
    # Group metadata in SQL; only page bodies enter Python. The representative
    # uses exactly the existing rank/date/order/id tie-breaks.
    folded = and_(
        literal(not grouped and not terms_mode and conversation_id is None and duplicate_of is None),
        SearchDocument.document_type == "message",
        Message.content_hash.is_not(None), Message.content_hash != "",
    )
    group_key = cast(SearchDocument.conversation_id, String) if grouped else case((folded, Message.content_hash), else_=cast(SearchDocument.id, String))
    group_type = literal("conversation") if grouped else SearchDocument.document_type
    ordering = [rank_expr.desc(), SearchDocument.created_at.desc(), SearchDocument.order_key.asc(), SearchDocument.id.asc()]
    ranked = ordered_query.order_by(None).with_entities(
        SearchDocument.id.label("document_id"),
        SearchDocument.document_type,
        SearchDocument.conversation_id,
        SearchDocument.message_id,
        Conversation.display_title.label("conversation_title"),
        rank_expr.label("rank"),
        SearchDocument.created_at, SearchDocument.order_key, group_key.label("group_key"),
        group_type.label("group_type"),
        Conversation.imported_at.label("imported_at"),
        func.coalesce(Conversation.sort_time, Conversation.imported_at).label("content_updated"),
        func.row_number().over(partition_by=[group_type, group_key], order_by=ordering).label("position"),
    ).subquery()
    counts = db.query(
        ranked.c.group_type, ranked.c.group_key,
        (func.count() if grouped else func.count(func.distinct(ranked.c.conversation_id))).label("occurrences"),
    ).group_by(ranked.c.group_type, ranked.c.group_key).subquery()
    representatives = db.query(ranked).filter(ranked.c.position == 1)
    total = representatives.count()
    page_rows = representatives.join(counts, and_(
        counts.c.group_type == ranked.c.group_type, counts.c.group_key == ranked.c.group_key,
    )).with_entities(
        ranked.c.document_id, ranked.c.document_type, ranked.c.conversation_id, ranked.c.message_id,
        ranked.c.conversation_title, ranked.c.rank, counts.c.occurrences,
    ).order_by(
        *([ranked.c.imported_at.desc()] if sort == "imported" else [ranked.c.content_updated.desc()] if sort == "content_updated" else []),
        ranked.c.rank.desc(), ranked.c.created_at.desc(), ranked.c.order_key.asc(), ranked.c.document_id.asc(),
    ).offset(offset).limit(limit).all()
    documents = {
        document.id: document
        for document in db.query(SearchDocument)
        .filter(SearchDocument.id.in_([row[0] for row in page_rows]))
        .all()
    }
    block_texts_by_version = _page_blocks(db, documents.values())
    items = [
        _build_search_result(
            document,
            conversation_title=conversation_title,
            normalized_query=terms[0] if grouped or terms_mode else normalized_query,
            rank=rank,
            occurrence_count=occurrence_count,
            block_texts_by_version=block_texts_by_version,
            db=db,
        )
        for document_id, _, _, _, conversation_title, rank, occurrence_count in page_rows
        if (document := documents.get(document_id)) is not None
    ]
    if grouped:
        metadata = {row.id: (row.status, row.name) for row in db.query(Conversation.id, Conversation.status, Project.name)
                    .outerjoin(ProjectConversation, ProjectConversation.conversation_id == Conversation.id)
                    .outerjoin(Project, and_(Project.id == ProjectConversation.project_id, Project.is_default.is_(False)))
                    .filter(Conversation.id.in_([item.conversation_id for item in items])).all()}
        items = [replace(item, hit_count=item.occurrence_count, occurrence_count=1,
                         conversation_status=metadata[item.conversation_id][0], project_name=metadata[item.conversation_id][1]) for item in items]
    return SearchResultPage(query=normalized_query, items=items, limit=limit, offset=offset, total=total, has_more=offset + len(items) < total)


def _page_blocks(db: Session, documents: Iterable[SearchDocument]) -> dict[uuid.UUID, list[tuple[int, str, uuid.UUID]]]:
    versions = {d.message_version_id for d in documents if d.message_version_id is not None
                and d.document_type in {"message", "heading", "code"}}
    by_version: dict[uuid.UUID, list[tuple[int, str, uuid.UUID]]] = {v: [] for v in versions}
    if versions:
        for version, index, text, block_id in db.query(
            RenderBlock.message_version_id, RenderBlock.block_index, RenderBlock.plain_text, RenderBlock.id,
        ).filter(RenderBlock.message_version_id.in_(versions)).order_by(
            RenderBlock.message_version_id, RenderBlock.block_index,
        ):
            by_version[version].append((index, text or "", block_id))
    return by_version


def _find_in_reader(db: Session, query: str, conversation_id: uuid.UUID, document_type: str | None,
                    role: str | None, status_scope: str, ownership: OwnershipScope, limit: int, offset: int,
                    match_offset: int = 0, match_document_id: uuid.UUID | None = None) -> SearchResultPage:
    """Find literal passages in reading order, independently of global relevance and copied metadata."""
    words = query.split()
    if len(query) > 500:
        raise SearchServiceError("Find text is limited to 500 characters.")

    def contains(column):
        if len(words) == 1:
            return column.ilike("%" + _escape_like_pattern(words[0]) + "%", escape="\\")
        # PostgreSQL ARE and SQLite REGEXP (Python) both support this subset.
        # User punctuation is literal; only the separator is a whitespace pattern.
        return column.regexp_match(r"(?i)" + r"\s+".join(re.escape(word) for word in words))

    kinds = ("message", "heading", "code", "attachment", "annotation")
    docs = db.query(SearchDocument, Conversation.display_title, Conversation.status).join(
        Conversation, Conversation.id == SearchDocument.conversation_id,
    ).filter(SearchDocument.conversation_id == conversation_id, ownership.predicate(Conversation),
             Conversation.deleted_at.is_(None), _status_filter(status_scope),
             SearchDocument.document_type.in_(kinds))
    if document_type is not None:
        docs = docs.filter(SearchDocument.document_type == document_type)
    if role is not None:
        docs = docs.filter(SearchDocument.role == role)
    blocks = db.query(RenderBlock.id).filter(RenderBlock.message_version_id == SearchDocument.message_version_id)
    # A token in a copied conversation title, role, or in two different blocks
    # is not a navigable exact occurrence. Legacy messages without blocks can
    # still be opened at the message; attachments retain filename/extract search.
    eligible = case(
        (SearchDocument.document_type == "message",
         or_(blocks.filter(contains(RenderBlock.plain_text)).exists(),
             and_(~blocks.exists(), contains(SearchDocument.plain_text)))),
        (SearchDocument.document_type == "attachment", contains(SearchDocument.search_text)),
        else_=contains(SearchDocument.plain_text),
    )
    docs = docs.filter(eligible)
    total = docs.count()
    rows = docs.order_by(SearchDocument.order_key.asc().nullslast(), SearchDocument.id).offset(offset).limit(limit).all()
    texts = _page_blocks(db, (doc for doc, _, _ in rows))
    if match_offset and (not rows or rows[0][0].id != match_document_id):
        raise SearchServiceError("The searched content changed. Restart this search.")
    items = []
    for n, (doc, title, status) in enumerate(rows):
        skip = match_offset if n == 0 else 0
        item = replace(_build_search_result(doc, conversation_title=title, normalized_query=query, rank=1.0,
                                            occurrence_count=1, block_texts_by_version=texts, db=db,
                                            literal_only=True, match_offset=skip), conversation_status=status)
        items.append(item)
        if item.matches_truncated:
            return SearchResultPage(query=query, items=items, limit=limit, offset=offset, total=total,
                                    has_more=True, next_offset=offset + n,
                                    next_match_offset=skip + len(item.matches), next_document_id=doc.id)
    return SearchResultPage(query=query, items=items, limit=limit, offset=offset, total=total, has_more=offset + len(items) < total)


def query_terms(query: str) -> list[str]:
    """Whitespace AND, quoted phrases, literal punctuation (no wildcard syntax)."""
    terms = [match.group(1) if match.group(1) is not None else match.group(2)
             for match in re.finditer(r'"([^"]+)"|(\S+)', query)]
    terms = list(dict.fromkeys(term for term in terms if term))
    if not terms or len(terms) > 20 or len(query) > 500:
        raise SearchServiceError("Use 1–20 search terms within 500 characters.")
    return terms

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


def _snippet(text: str, query: str, *, literal_only: bool = False) -> str:
    matches = _find_text_matches(text, query, None, max_matches=1, literal_only=literal_only)
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
    literal_only: bool = False,
    match_offset: int = 0,
) -> SearchResult:
    matches = _document_matches(document, normalized_query, db, block_texts_by_version,
                                literal_only=literal_only, match_offset=match_offset)
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
        snippet=_result_snippet(document, normalized_query, matches, block_texts_by_version, literal_only=literal_only),
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
    *, literal_only: bool = False,
) -> str:
    if matches:
        match = matches[0]
        text = document.plain_text or document.search_text
        if match.block_index is not None:
            block_texts = {index: text for index, text, _block_id in block_texts_by_version.get(document.message_version_id, [])}
            text = block_texts.get(match.block_index, text) or text
        return _snippet_at_range(text, match.match_start, match.match_end)
    return _snippet(document.plain_text or document.search_text, query, literal_only=literal_only)


def _document_matches(
    document: SearchDocument,
    query: str,
    db: Session,
    block_texts_by_version: dict[uuid.UUID, list[tuple[int, str, uuid.UUID]]] | None = None,
    *, literal_only: bool = False, match_offset: int = 0,
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
    if literal_only:
        return literal_block_matches(
            ((i, text, bid) for i, text, bid in candidates
             if requested_block_index is None or i == requested_block_index),
            query, skip=match_offset,
        )
    matches: list[SearchMatch] = []
    for block_index, text, block_id in candidates:
        if requested_block_index is not None and block_index != requested_block_index:
            continue
        remaining = 101 - len(matches)
        if remaining <= 0:
            break
        matches.extend(_find_text_matches(text, query, block_index, block_id, max_matches=remaining, literal_only=literal_only))
    return matches


def _find_text_matches(
    text: str,
    query: str,
    block_index: int | None,
    render_block_id: uuid.UUID | None = None,
    *,
    max_matches: int = 100,
    literal_only: bool = False,
) -> list[SearchMatch]:
    if max_matches <= 0:
        return []
    if literal_only:
        offsets = _literal_offsets(text, query, max_matches)
    else:
        offsets = _search_offsets(text, query, max_matches)
    return [SearchMatch(
        block_index=block_index, render_block_id=render_block_id, match_start=start, match_end=end,
        quote=text[start:end], context_before=text[max(0, start - 80):start], context_after=text[end:end + 80],
    ) for start, end in offsets]


def _literal_offsets(text: str, query: str, limit: int) -> list[tuple[int, int]]:
    return list(islice(iter_literal_offsets(text, query), limit))


def literal_block_matches(candidates: Iterable[tuple[int, str, uuid.UUID | None]], query: str,
                          *, skip: int = 0, limit: int = 101) -> list[SearchMatch]:
    """Bounded ranges across blocks; skipped matches never allocate snippets."""
    matches = []
    for index, text, block_id in candidates:
        for start, end in iter_literal_offsets(text, query):
            if skip:
                skip -= 1
                continue
            matches.append(SearchMatch(block_index=index, render_block_id=block_id,
                                       match_start=start, match_end=end, quote=text[start:end],
                                       context_before=text[max(0, start - 80):start], context_after=text[end:end + 80]))
            if len(matches) >= limit:
                return matches
    return matches


def iter_literal_offsets(text: str, query: str):
    """Reader find: no per-character position table, even for a megabyte-long code block."""
    words = query.casefold().split()
    if not words:
        return []
    folded = text.casefold()
    # Match the original whitespace run, rather than collapsing the body and
    # having to remember where every character came from. All input is literal.
    pattern = r"\s+".join(re.escape(word) for word in words)
    previous = None
    raw_end = folded_end = 0

    def raw_index(at: int) -> int:
        nonlocal raw_end, folded_end
        if len(text) == len(folded):  # casefold does not contract code points
            return at
        # The endpoints arrive monotonically. Walk an expanded fold once and
        # map partial matches inside e.g. ß back to the whole source character.
        while folded_end <= at:
            folded_end += len(text[raw_end].casefold())
            raw_end += 1
        return raw_end - 1

    for match in re.finditer(pattern, folded):
        span = (raw_index(match.start()), raw_index(match.end() - 1) + 1)
        if previous != span:
            previous = span
            yield span


def _search_offsets(text: str, query: str, max_matches: int) -> list[tuple[int, int]]:
    """Existing global search also offers a single token fallback."""
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
    return offsets


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
