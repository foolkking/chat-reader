"""Offline snapshots retain only the history needed by the requesting owner's anchors."""
import io
import json

from app.models.annotation import ConversationAnnotation
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.project import Project
from app.models.project_conversation import ProjectConversation
from app.services.projects.project_service import update_project
from app.services.offline_packages import _write_conversation_payload
from test_system_archive_integrity import archive_db, seed_archive_source  # noqa: F401


def test_offline_snapshot_preserves_owned_anchor_versions_only(archive_db):
    users, conversations, _, _ = seed_archive_source(archive_db)
    conversation = conversations[0]
    message = archive_db.query(Message).filter_by(conversation_id=conversation.id).one()
    old = archive_db.query(MessageVersion).filter_by(message_id=message.id, version_number=1).one()
    foreign_version = MessageVersion(message_id=message.id, version_number=3,
        display_text='Synthetic foreign anchor', plain_text='Synthetic foreign anchor', content_hash='foreign', edit_type='test')
    archive_db.add(foreign_version)
    archive_db.flush()
    for owner, version in [(users[0], old), (users[1], foreign_version)]:
        archive_db.add(ConversationAnnotation(conversation_id=conversation.id, subject_key=str(owner.id),
            message_id=message.id, message_version_id=version.id, quote='Synthetic'))
    archive_db.commit()
    output = io.BytesIO()
    _write_conversation_payload(output, archive_db, conversation, subject_key=str(users[0].id))
    payload = json.loads(output.getvalue())
    saved = payload['messages'][0]
    assert saved['current_version']['id'] == str(message.current_version_id)
    assert [v['id'] for v in saved['annotation_versions']] == [str(old.id)]
    assert saved['annotation_versions'][0]['display_text'] == old.display_text
    assert len(payload['annotations']) == 1
    assert b'Synthetic foreign anchor' not in output.getvalue()


def test_project_description_invalidates_and_reaches_offline_snapshot(archive_db):
    users, conversations, _, _ = seed_archive_source(archive_db)
    conversation = conversations[0]
    project = archive_db.query(Project).filter_by(owner_user_id=users[0].id).one()
    archive_db.add(ProjectConversation(project_id=project.id, conversation_id=conversation.id))
    archive_db.commit()
    before = conversation.offline_revision
    update_project(archive_db, project, {'description': 'Synthetic updated project constraints'})
    archive_db.commit()
    archive_db.expire_all()
    assert conversation.offline_revision == before + 1
    output = io.BytesIO()
    _write_conversation_payload(output, archive_db, conversation, subject_key=str(users[0].id))
    assert json.loads(output.getvalue())['project_context'] == {
        'record_type': 'project_context', 'project_id': str(project.id), 'name': project.name,
        'description': 'Synthetic updated project constraints', 'conversation_role': 'member',
    }
