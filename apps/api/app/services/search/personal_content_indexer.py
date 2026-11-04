"""Owner-only notebook/description search, maintained in the writing transaction."""
import uuid

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models.annotation import ConversationNotebook
from app.models.conversation import Conversation
from app.models.search_document import SearchDocument
from app.models.import_record import utc_now

NAMESPACE = uuid.UUID("0ccbbfa4-333e-440f-9734-8f507d826b9d")


def sync_personal_content(db: Session, conversation: Conversation) -> None:
    subject = str(conversation.owner_user_id) if conversation.owner_user_id else "local:default"
    notebook = db.query(ConversationNotebook).filter(
        ConversationNotebook.conversation_id == conversation.id,
        ConversationNotebook.subject_key == subject,
        ConversationNotebook.is_conflict.is_(False),
    ).first()
    notebook_text = "\n".join(
        [notebook.title or ""] + [str(block.get("markdown") or "") for block in notebook.blocks if isinstance(block, dict)]
    ) if notebook else ""
    for kind, body in (("description", conversation.description_markdown or ""), ("notebook", notebook_text)):
        document_id = uuid.uuid5(NAMESPACE, f"{conversation.id}:{kind}")
        existing = db.get(SearchDocument, document_id)
        if conversation.deleted_at or not body.strip():
            if existing:
                db.delete(existing)
            continue
        values = dict(
            conversation_id=conversation.id, document_type=kind,
            title=conversation.display_title, plain_text=body, search_text=body,
            source_type=conversation.source_type, source_profile=conversation.source_profile,
            created_at=notebook.updated_at if kind == "notebook" and notebook else conversation.updated_at,
            metadata_={"subject_key": subject}, indexed_at=utc_now(),
        )
        if existing is None:
            db.add(SearchDocument(id=document_id, **values))
        else:
            for name, value in values.items():
                setattr(existing, name, value)
    db.flush()
    if db.get_bind().dialect.name == "postgresql":
        db.execute(text(
            "UPDATE search_documents SET search_tsv = to_tsvector('simple', coalesce(search_text, '')) "
            "WHERE conversation_id = :id AND document_type IN ('notebook', 'description')"
        ), {"id": conversation.id})
