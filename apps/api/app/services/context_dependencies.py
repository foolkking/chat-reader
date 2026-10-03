"""Independent binding for context outside the protocol's message fingerprint."""
import hashlib
import json

from app.models.annotation import ConversationAnnotation, ConversationNotebook
from app.models.conversation import Conversation
from app.models.project import Project
from app.models.project_conversation import ProjectConversation


def context_dependency_digest(db, conversation_id, subject_key):
    digest = hashlib.sha256(b'chat-reader-context-dependencies-v1\n')

    def append(kind, values):
        digest.update(json.dumps([kind, values], ensure_ascii=False, sort_keys=True,
                                 separators=(',', ':'), default=str).encode())
        digest.update(b'\n')

    conversation = db.query(Conversation.description_markdown, Conversation.summary).filter_by(id=conversation_id).one()
    append('conversation', list(conversation))
    projects = db.query(Project.id, Project.name, Project.description).join(ProjectConversation, ProjectConversation.project_id == Project.id).filter(
        ProjectConversation.conversation_id == conversation_id, Project.is_default.is_(False)).order_by(Project.id)
    for row in projects.yield_per(100):
        append('project', list(row))
    for model, kind in ((ConversationAnnotation, 'annotation'), (ConversationNotebook, 'notebook')):
        query = db.query(model).filter_by(conversation_id=conversation_id, subject_key=subject_key).order_by(model.id).populate_existing()
        for row in query.yield_per(100):
            # This is a digest only; no supplementary content is duplicated in storage.
            append(kind, {column.name: getattr(row, column.key if column.name != 'metadata' else 'metadata_')
                          for column in model.__table__.columns if column.name not in {'created_at', 'updated_at', 'subject_key', 'conversation_id'}})
    return digest.hexdigest()
