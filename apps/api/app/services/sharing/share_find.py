"""Read-only, authorized canonical-body find. Never query the owner's search index."""
import uuid
from http import HTTPStatus
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.models.message import Message
from app.models.render_block import RenderBlock
from app.schemas.search import SearchResponse, SearchResultItem
from app.services.search.search_service import literal_block_matches
from app.services.sharing.share_service import (
    ShareError, _get_accessible_share, _share_message_query, _snapshot_for_share,
)


class SharedFindRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    q: str = Field(min_length=1, max_length=500)
    limit: int = Field(default=20, ge=1, le=50)
    offset: int = Field(default=0, ge=0)
    match_offset: int = Field(default=0, ge=0)
    match_document_id: uuid.UUID | None = None
    document_type: Literal["message", "heading", "code"] = "message"
    role: Literal["user", "assistant", "system", "tool", "note"] | None = None


def find_shared_body(db: Session, token: str, payload: SharedFindRequest, unlock_token: str | None) -> SearchResponse:
    share = _get_accessible_share(db, token, unlock_token)
    snapshot = _snapshot_for_share(db, share)
    q = payload.q.strip()
    if not q:
        raise ShareError("Find text cannot be empty.", HTTPStatus.BAD_REQUEST)
    # Cursor offsets are authorized message positions, not owner search rows.
    # Hydrate bounded batches; no attachment bytes or private annotations.
    if snapshot is not None:
        def source():
            for n in range(payload.offset, len(snapshot.messages)):
                row = snapshot.messages[n]
                yield n, uuid.UUID(row["id"]), uuid.UUID(row["current_version"]["id"]), row["role"], row["order_key"], (
                    (b["block_index"], b.get("plain_text") or "", uuid.UUID(b["id"]))
                    for b in row.get("render_blocks", [])
                    if payload.document_type == "message" or b["block_type"] == payload.document_type
                )
    else:
        def source():
            query = _share_message_query(db, share).order_by(Message.order_key.asc(), Message.id.asc())
            position = payload.offset
            while True:
                messages = query.offset(position).limit(32).all()
                if not messages:
                    break
                blocks = db.query(RenderBlock).filter(RenderBlock.message_version_id.in_(
                    [message.current_version_id for message in messages]
                ))
                if payload.document_type != "message":
                    blocks = blocks.filter(RenderBlock.block_type == payload.document_type)
                by_version = {}
                for block in blocks.order_by(RenderBlock.block_index).yield_per(32):
                    by_version.setdefault(block.message_version_id, []).append(
                        (block.block_index, block.plain_text or "", block.id)
                    )
                for message in messages:
                    yield position, message.id, message.current_version_id, message.role, message.order_key, by_version.get(message.current_version_id, [])
                    position += 1
    items = []
    seen_cursor = not payload.match_offset
    for n, message_id, version_id, role, order, blocks in source():
        identity = uuid.uuid5(message_id, str(version_id))
        skip = payload.match_offset if n == payload.offset else 0
        if skip:
            if identity != payload.match_document_id:
                raise ShareError("The searched content changed. Restart this search.", HTTPStatus.CONFLICT)
            seen_cursor = True
        if payload.role and role != payload.role:
            continue
        matches = literal_block_matches(blocks, q, skip=skip)
        if not matches:
            continue
        if len(items) == payload.limit:
            return SearchResponse(query=q, items=items, limit=payload.limit, offset=payload.offset,
                                  total=len(items) + 1, total_is_exact=False, has_more=True, next_offset=n)
        more = len(matches) > 100
        matches = matches[:100]
        hit = matches[0]
        items.append(SearchResultItem(
            document_id=identity, document_type=payload.document_type, conversation_id=share.conversation_id,
            conversation_title=share.title or "", message_id=message_id, message_version_id=version_id,
            role=role, order_key=order, block_index=hit.block_index, render_block_id=hit.render_block_id,
            character_offset=hit.match_start, snippet=f"{hit.context_before}{hit.quote}{hit.context_after}",
            rank=1, source_profile=None, matches=matches, matches_truncated=more,
        ))
        if more:
            return SearchResponse(query=q, items=items, limit=payload.limit, offset=payload.offset,
                                  total=len(items), total_is_exact=False, has_more=True, next_offset=n,
                                  next_match_offset=skip + len(matches), next_document_id=identity)
    if not seen_cursor:
        raise ShareError("The searched content changed. Restart this search.", HTTPStatus.CONFLICT)
    return SearchResponse(query=q, items=items, limit=payload.limit, offset=payload.offset,
                          total=len(items), total_is_exact=payload.offset == 0)
