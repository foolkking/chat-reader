import uuid
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models.conversation import Conversation
from app.models.heading import Heading
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.render_block import RenderBlock
from app.models.search_document import SearchDocument
from app.models.attachment import Attachment, AssetDerivative, AssetObject, MessageVersionAttachment
from app.services.database.bulk_insert import insert_rows
from app.services.assets.asset_store import get_asset_store
from app.services.toc.toc_builder import rebuild_headings_for_all, rebuild_headings_for_conversation
from app.services.search.annotation_indexer import sync_annotations_for_conversation


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

    for row in _message_version_rows(db, conversation.id):
        # Search snippets use the rendered plain-text representation. Keep
        # Markdown source as the canonical authority, but do not leak its
        # presentation syntax into the result UI.
        canonical_body = row.plain_text.strip() or row.display_text.strip()
        search_text = f"{row.role} {canonical_body}".strip()
        if not search_text:
            continue
        document_rows.append(
            {
                "id": uuid.uuid4(),
                "conversation_id": conversation.id,
                "message_id": row.message_id,
                "message_version_id": row.message_version_id,
                "document_type": "message",
                "role": row.role,
                "title": conversation.display_title,
                "plain_text": row.plain_text,
                "search_text": search_text,
                "source_type": conversation.source_type,
                "source_profile": conversation.source_profile,
                "order_key": row.order_key,
                "turn_index": row.turn_index,
                "created_at": row.created_at,
                "metadata_": {"char_count": row.char_count, "block_count": row.block_count},
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
                "metadata_": {
                    "heading_index": heading.heading_index,
                    "block_index": heading.block_index,
                    "render_block_id": str(heading.render_block_id) if heading.render_block_id else None,
                    "slug": heading.slug,
                },
            }
        )
        indexed_count += 1
        if len(document_rows) >= 500:
            insert_rows(db, SearchDocument, document_rows)
            document_rows.clear()

    code_rows = (
        db.query(
            Message.id.label("message_id"),
            Message.role,
            Message.order_key,
            Message.turn_index,
            Message.created_at,
            MessageVersion.id.label("message_version_id"),
            RenderBlock.block_index,
            RenderBlock.id.label("render_block_id"),
            RenderBlock.plain_text,
            RenderBlock.data,
        )
        .join(MessageVersion, MessageVersion.id == Message.current_version_id)
        .join(RenderBlock, RenderBlock.message_version_id == MessageVersion.id)
        .filter(
            Message.conversation_id == conversation.id,
            Message.is_deleted.is_(False),
            RenderBlock.block_type == "code",
        )
        .order_by(Message.order_key.asc(), RenderBlock.block_index.asc())
        .yield_per(500)
    )
    for row in code_rows:
        block_data = row.data if isinstance(row.data, dict) else {}
        code_text = (row.plain_text or str(block_data.get("text") or "")).strip()
        if not code_text:
            continue
        language = str(block_data.get("language") or "text")
        document_rows.append(
            {
                "id": uuid.uuid4(),
                "conversation_id": conversation.id,
                "message_id": row.message_id,
                "message_version_id": row.message_version_id,
                "document_type": "code",
                "role": row.role,
                "title": conversation.display_title,
                "plain_text": code_text,
                "search_text": f"{language} {code_text}",
                "source_type": conversation.source_type,
                "source_profile": conversation.source_profile,
                "order_key": row.order_key,
                "turn_index": row.turn_index,
                "created_at": row.created_at,
                "metadata_": {"block_index": row.block_index, "render_block_id": str(row.render_block_id), "language": language},
            }
        )
        indexed_count += 1
        if len(document_rows) >= 500:
            insert_rows(db, SearchDocument, document_rows)
            document_rows.clear()

    attachment_rows = (
        db.query(MessageVersionAttachment, Attachment, AssetObject, Message)
        .join(Attachment, Attachment.id == MessageVersionAttachment.attachment_id)
        .join(AssetObject, AssetObject.id == Attachment.asset_object_id)
        .join(Message, Message.current_version_id == MessageVersionAttachment.message_version_id)
        .filter(
            Message.conversation_id == conversation.id,
            Message.is_deleted.is_(False),
            Attachment.deleted_at.is_(None),
        )
        .order_by(Message.order_key.asc(), MessageVersionAttachment.display_order.asc())
        .all()
    )
    derivative_by_source = {
        row.source_asset_object_id: row
        for row in db.query(AssetDerivative).filter(
            AssetDerivative.source_asset_object_id.in_({asset.id for _, _, asset, _ in attachment_rows}),
            AssetDerivative.derivative_type == "text_extract",
            AssetDerivative.status == "ready",
        ).order_by(AssetDerivative.created_at.desc()).all()
    } if attachment_rows else {}
    derivative_assets = {
        item.id: item
        for item in db.query(AssetObject).filter(
            AssetObject.id.in_({row.derivative_asset_object_id for row in derivative_by_source.values()})
        ).all()
    } if derivative_by_source else {}
    for link, attachment, asset, message in attachment_rows:
        extracted = ""
        derivative = derivative_by_source.get(asset.id)
        derivative_asset = derivative_assets.get(derivative.derivative_asset_object_id) if derivative else None
        if derivative_asset is not None and derivative_asset.status == "available":
            try:
                with get_asset_store().resolve_key(derivative_asset.storage_key).open("rb") as source:
                    extracted = source.read(256 * 1024).decode("utf-8", errors="replace")
            except (OSError, ValueError):
                extracted = ""
        search_text = " ".join(
            value for value in [attachment.display_name, attachment.original_filename, extracted] if value
        ).strip()
        if not search_text:
            continue
        document_rows.append(
            {
                "id": uuid.uuid4(),
                "conversation_id": conversation.id,
                "message_id": message.id,
                "message_version_id": link.message_version_id,
                "document_type": "attachment",
                "role": message.role,
                "title": attachment.display_name,
                "plain_text": extracted or attachment.display_name,
                "search_text": search_text,
                "source_type": conversation.source_type,
                "source_profile": conversation.source_profile,
                "order_key": message.order_key,
                "turn_index": message.turn_index,
                "created_at": message.created_at,
                "metadata_": {
                    "attachment_id": str(attachment.id),
                    "mime_type": asset.detected_mime_type,
                    "derivative_type": "text_extract" if extracted else None,
                },
            }
        )
        indexed_count += 1
        if len(document_rows) >= 500:
            insert_rows(db, SearchDocument, document_rows)
            document_rows.clear()

    if document_rows:
        insert_rows(db, SearchDocument, document_rows)

    db.flush()
    sync_annotations_for_conversation(db, conversation.id)
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


def _message_version_rows(db: Session, conversation_id: uuid.UUID):
    return (
        db.query(
            Message.id.label("message_id"),
            Message.role,
            Message.order_key,
            Message.turn_index,
            Message.created_at,
            Message.char_count,
            Message.block_count,
            MessageVersion.id.label("message_version_id"),
            MessageVersion.plain_text,
            MessageVersion.display_text,
        )
        .join(MessageVersion, MessageVersion.id == Message.current_version_id)
        .filter(Message.conversation_id == conversation_id, Message.is_deleted.is_(False))
        .order_by(Message.order_key.asc())
        .yield_per(500)
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
