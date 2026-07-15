import uuid
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models.conversation import Conversation
from app.models.heading import Heading
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.search_document import SearchDocument
from app.services.database.bulk_insert import insert_rows
from app.services.toc.toc_builder import rebuild_headings_for_all, rebuild_headings_for_conversation


@dataclass(frozen=True)
class SearchIndexResult:
    conversation_count: int
    indexed_count: int
    heading_count: int = 0


def delete_search_documents_for_conversation(db: Session, conversation_id: uuid.UUID) -> None:
    db.query(SearchDocument).filter(SearchDocument.conversation_id == conversation_id).delete(synchronize_session=False)
    db.flush()


def rebuild_search_documents_for_conversation(db: Session, conversation_id: uuid.UUID) -> SearchIndexResult:
    conversation = db.get(Conversation, conversation_id)
    if conversation is None or conversation.deleted_at is not None:
        return SearchIndexResult(conversation_count=0, indexed_count=0, heading_count=0)

    delete_search_documents_for_conversation(db, conversation_id)
    indexed_count = 0

    conversation_text = " ".join(
        part
        for part in [
            conversation.title,
            conversation.display_title,
            conversation.first_user_message,
            conversation.summary,
        ]
        if part
    )
    document_rows: list[dict] = []
    if conversation_text.strip():
        document_rows.append(
            {
                "id": uuid.uuid4(),
                "conversation_id": conversation.id,
                "document_type": "conversation",
                "title": conversation.display_title,
                "plain_text": conversation_text,
                "search_text": conversation_text,
                "source_type": conversation.source_type,
                "source_profile": conversation.source_profile,
                "metadata_": {},
            }
        )
        indexed_count += 1

    for message, version in _message_version_rows(db, conversation.id):
        canonical_body = version.display_text.strip() or version.plain_text.strip()
        search_text = f"{message.role} {canonical_body}".strip()
        if not search_text:
            continue
        document_rows.append(
            {
                "id": uuid.uuid4(),
                "conversation_id": conversation.id,
                "message_id": message.id,
                "message_version_id": version.id,
                "document_type": "message",
                "role": message.role,
                "title": conversation.display_title,
                "plain_text": version.plain_text,
                "search_text": search_text,
                "source_type": conversation.source_type,
                "source_profile": conversation.source_profile,
                "order_key": message.order_key,
                "turn_index": message.turn_index,
                "created_at": message.created_at,
                "metadata_": {"char_count": message.char_count, "block_count": message.block_count},
            }
        )
        indexed_count += 1
        if len(document_rows) >= 500:
            insert_rows(db, SearchDocument, document_rows)
            document_rows.clear()

    for heading in db.query(Heading).filter(Heading.conversation_id == conversation.id).yield_per(500):
        search_text = f"{heading.text} {conversation.display_title}".strip()
        document_rows.append(
            {
                "id": uuid.uuid4(),
                "conversation_id": conversation.id,
                "message_id": heading.message_id,
                "message_version_id": heading.message_version_id,
                "document_type": "heading",
                "title": conversation.display_title,
                "plain_text": heading.text,
                "search_text": search_text,
                "source_type": conversation.source_type,
                "source_profile": conversation.source_profile,
                "order_key": heading.order_key,
                "metadata_": {"heading_index": heading.heading_index, "slug": heading.slug},
            }
        )
        indexed_count += 1
        if len(document_rows) >= 500:
            insert_rows(db, SearchDocument, document_rows)
            document_rows.clear()

    if document_rows:
        insert_rows(db, SearchDocument, document_rows)

    db.flush()
    _refresh_postgres_tsv(db, conversation.id)
    return SearchIndexResult(conversation_count=1, indexed_count=indexed_count, heading_count=0)


def rebuild_search_documents_for_all(db: Session) -> SearchIndexResult:
    toc_result = rebuild_headings_for_all(db)
    conversation_ids = [
        row[0]
        for row in db.query(Conversation.id).filter(Conversation.deleted_at.is_(None)).all()
    ]
    total = 0
    for conversation_id in conversation_ids:
        total += rebuild_search_documents_for_conversation(db, conversation_id).indexed_count
    return SearchIndexResult(
        conversation_count=len(conversation_ids),
        indexed_count=total,
        heading_count=toc_result.heading_count,
    )


def rebuild_search_and_toc_for_conversation(db: Session, conversation_id: uuid.UUID) -> SearchIndexResult:
    toc_result = rebuild_headings_for_conversation(db, conversation_id)
    search_result = rebuild_search_documents_for_conversation(db, conversation_id)
    return SearchIndexResult(
        conversation_count=search_result.conversation_count,
        indexed_count=search_result.indexed_count,
        heading_count=toc_result.heading_count,
    )


def _message_version_rows(db: Session, conversation_id: uuid.UUID) -> list[tuple[Message, MessageVersion]]:
    return (
        db.query(Message, MessageVersion)
        .join(MessageVersion, MessageVersion.id == Message.current_version_id)
        .filter(Message.conversation_id == conversation_id, Message.is_deleted.is_(False))
        .order_by(Message.order_key.asc())
        .all()
    )


def _refresh_postgres_tsv(db: Session, conversation_id: uuid.UUID) -> None:
    if db.bind is None or db.bind.dialect.name != "postgresql":
        return
    db.execute(
        text(
            "UPDATE search_documents "
            "SET search_tsv = to_tsvector('simple', search_text) "
            "WHERE conversation_id = :conversation_id"
        ),
        {"conversation_id": conversation_id},
    )
