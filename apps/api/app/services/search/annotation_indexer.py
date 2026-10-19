"""Idempotent SearchDocument maintenance for conversation annotations."""

import logging
import uuid
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.models.annotation import ConversationAnnotation
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.search_document import SearchDocument
from app.models.import_record import utc_now
from app.core.observability import structured_event

ANNOTATION_NAMESPACE = uuid.UUID("7e6f2f90-7e5b-4cb3-bf82-4f7fd2b1a6b8")
_BODY_READ_BATCH_SIZE = 8
_ID_BATCH_SIZE = 200
logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class AnnotationIndexResult:
    scanned: int = 0
    created: int = 0
    updated: int = 0
    skipped: int = 0
    deleted: int = 0
    errors: int = 0


def annotation_document_id(annotation_id: uuid.UUID) -> uuid.UUID:
    return uuid.uuid5(ANNOTATION_NAMESPACE, str(annotation_id))


def sync_annotation_document(db: Session, annotation: ConversationAnnotation) -> str:
    """Upsert one annotation document, or remove it when deleted/empty."""
    document_id = annotation_document_id(annotation.id)
    existing = db.get(SearchDocument, document_id)
    if annotation.is_deleted:
        if existing is not None and existing.document_type == "annotation":
            db.delete(existing)
            db.flush()
            return "deleted"
        return "skipped"
    conversation = db.get(Conversation, annotation.conversation_id)
    if conversation is None or conversation.deleted_at is not None:
        if existing is not None and existing.document_type == "annotation":
            db.delete(existing)
            db.flush()
            return "deleted"
        return "skipped"
    message = db.get(Message, annotation.message_id) if annotation.message_id else None
    comment = (annotation.comment_markdown or "").strip()
    quote = (annotation.quote or "").strip()
    plain_text = " ".join(part for part in (comment, quote) if part).strip()
    if not plain_text:
        if existing is not None and existing.document_type == "annotation":
            db.delete(existing)
            db.flush()
            return "deleted"
        return "skipped"
    values = {
        "id": document_id,
        "conversation_id": annotation.conversation_id,
        "message_id": annotation.message_id,
        "message_version_id": annotation.message_version_id,
        "document_type": "annotation",
        "role": None,
        "title": conversation.display_title,
        "plain_text": plain_text,
        "search_text": plain_text,
        "source_type": conversation.source_type,
        "source_profile": conversation.source_profile,
        "order_key": message.order_key if message else None,
        "turn_index": message.turn_index if message else None,
        "created_at": annotation.created_at,
        "metadata_": {
            "annotation_id": str(annotation.id),
            "annotation_type": annotation.annotation_type,
            "annotation_color": annotation.color,
            "anchor_status": annotation.anchor_status,
            "quote": quote,
            "start_block_index": annotation.start_block_index,
            "start_offset": annotation.start_offset,
            "end_block_index": annotation.end_block_index,
            "end_offset": annotation.end_offset,
        },
    }
    if existing is None:
        db.add(SearchDocument(**values, indexed_at=utc_now()))
        db.flush()
        return "created"
    if existing.document_type != "annotation":
        raise ValueError(f"Search document id collision for annotation {annotation.id}")
    if all(getattr(existing, key) == value for key, value in values.items() if key != "id"):
        return "skipped"
    for key, value in values.items():
        if key != "id":
            setattr(existing, key, value)
    existing.indexed_at = utc_now()
    db.flush()
    return "updated"


def sync_annotations_for_conversation(db: Session, conversation_id: uuid.UUID) -> AnnotationIndexResult:
    result = AnnotationIndexResult()
    annotations = db.query(ConversationAnnotation).filter(
        ConversationAnnotation.conversation_id == conversation_id,
    ).yield_per(_BODY_READ_BATCH_SIZE)
    seen: set[uuid.UUID] = set()
    for annotation in annotations:
        result = AnnotationIndexResult(**{**result.__dict__, "scanned": result.scanned + 1})
        seen.add(annotation_document_id(annotation.id))
        action = sync_annotation_document(db, annotation)
        result = AnnotationIndexResult(**{**result.__dict__, action: getattr(result, action) + 1})
    deleted = _prune_stale_documents(db, conversation_id, seen)
    result = AnnotationIndexResult(**{**result.__dict__, "deleted": result.deleted + deleted})
    db.flush()
    return result


def backfill_annotation_documents(db: Session) -> AnnotationIndexResult:
    """Scan every annotation with per-row savepoints; callers decide commit/exit policy."""
    result = AnnotationIndexResult()
    for (conversation_id,) in db.query(Conversation.id).yield_per(_ID_BATCH_SIZE):
        annotations = db.query(ConversationAnnotation).filter(
            ConversationAnnotation.conversation_id == conversation_id,
        ).yield_per(_BODY_READ_BATCH_SIZE)
        seen: set[uuid.UUID] = set()
        for annotation in annotations:
            result = AnnotationIndexResult(**{**result.__dict__, "scanned": result.scanned + 1})
            seen.add(annotation_document_id(annotation.id))
            try:
                with db.begin_nested():
                    action = sync_annotation_document(db, annotation)
                result = AnnotationIndexResult(**{**result.__dict__, action: getattr(result, action) + 1})
            except Exception as exc:
                structured_event(logger, logging.WARNING, "annotation_search_index_failed", annotation_id=str(annotation.id), error_class=type(exc).__name__)
                result = AnnotationIndexResult(**{**result.__dict__, "errors": result.errors + 1})
        deleted = _prune_stale_documents(db, conversation_id, seen)
        result = AnnotationIndexResult(**{**result.__dict__, "deleted": result.deleted + deleted})
    db.flush()
    return result


def _prune_stale_documents(db: Session, conversation_id: uuid.UUID, seen: set[uuid.UUID]) -> int:
    """Delete stale IDs without reloading every quote/comment/search body.

    Keyset pages also avoid modifying a table while its read cursor is open.
    Synchronize caller-held documents just as ORM delete did, and leave commit
    and rollback ownership with the existing caller.
    """
    query = db.query(SearchDocument.id).filter(
        SearchDocument.conversation_id == conversation_id,
        SearchDocument.document_type == "annotation",
    )
    after = None
    deleted = 0
    while True:
        page = query.filter(SearchDocument.id > after) if after is not None else query
        rows = page.order_by(SearchDocument.id.asc()).limit(_ID_BATCH_SIZE).all()
        if not rows:
            break
        after = rows[-1][0]
        stale_ids = [row[0] for row in rows if row[0] not in seen]
        if stale_ids:
            deleted += db.query(SearchDocument).filter(
                SearchDocument.id.in_(stale_ids),
                SearchDocument.conversation_id == conversation_id,
                SearchDocument.document_type == "annotation",
            ).delete(synchronize_session="fetch")
    return deleted
