"""Synthetic-only CI characterization; query counts contain no user data."""
import json
import time

import pytest
from sqlalchemy import event

from app.services.offline_packages import build_catalog, estimate_catalog_bytes, estimate_conversation_bytes
from test_attachment_bundle import bundle_state, state  # noqa: F401
from test_attachment_storage_integrity import _conversation, _database
from test_import_preview_api import client  # noqa: F401


@pytest.mark.parametrize("size", [47, 470])
def test_offline_catalog_characterization(client, size):
    db, generator = _database()
    statements = []
    def count_statement(*_):
        statements.append(1)
    engine = db.get_bind()
    try:
        db.add_all([_conversation() for _ in range(size)])
        db.commit()
        db.expunge_all()
        event.listen(engine, "before_cursor_execute", count_statement)
        started = time.perf_counter()
        catalog = build_catalog(db)
        elapsed = time.perf_counter() - started
        assert len(catalog.conversations) == size
        assert len(statements) <= 8, "catalog SQL must not grow once per conversation"
        print(json.dumps({"fixture": "synthetic-offline-catalog-v1", "conversations": size,
                          "sql_count": len(statements), "elapsed_ms": round(elapsed * 1000, 2)}))
    finally:
        event.remove(engine, "before_cursor_execute", count_statement)
        db.close()
        generator.close()


def test_equal_sized_distinct_assets_are_counted_once_each(bundle_state):
    from app.models.attachment import AssetObject, Attachment, MessageVersionAttachment
    from app.models.conversation import Conversation
    from app.models.message import Message
    info = bundle_state
    with info["factory"]() as db:
        conversation = db.get(Conversation, info["sources"][0])
        initial = estimate_catalog_bytes(db, [conversation])[conversation.id]
        second = Attachment(conversation_id=conversation.id, asset_object_id=info["assets"][1],
            original_filename="Second same-sized asset", display_name="Second same-sized asset", scan_status="clean")
        db.add(second)
        db.flush()
        message = db.get(Message, info["messages"][0])
        db.add_all([
            MessageVersionAttachment(message_version_id=message.current_version_id, attachment_id=second.id),
            MessageVersionAttachment(message_version_id=message.current_version_id, attachment_id=second.id),
        ])
        db.commit()
        size = db.get(AssetObject, info["assets"][1]).byte_size
        grouped = estimate_catalog_bytes(db, [conversation])[conversation.id]
        assert grouped - initial == size
        assert estimate_conversation_bytes(db, conversation) == grouped


def test_catalog_preserves_owner_project_and_scalar_estimate_parity(bundle_state):
    from app.models.conversation import Conversation
    from app.models.project import Project
    from app.models.project_conversation import ProjectConversation
    from app.services.continuation_files import update_files
    from app.services.ownership import OwnershipScope
    info = bundle_state
    with info["factory"]() as db:
        own = Project(name="Synthetic owned project", owner_user_id=info["owners"][0])
        foreign = Project(name="PRIVATE FOREIGN PROJECT", owner_user_id=info["owners"][1])
        db.add_all([own, foreign])
        db.flush()
        own_id = own.id
        db.add_all([ProjectConversation(conversation_id=info["sources"][0], project_id=own.id),
            ProjectConversation(conversation_id=info["sources"][1], project_id=foreign.id)])
        update_files(db, info["sources"][0], OwnershipScope(info["owners"][0]), base_generation=0,
            members={"current": b"# Synthetic catalog", "index": b'{"chapters":[]}'})
        db.commit()
        expected = {cid: estimate_conversation_bytes(db, db.get(Conversation, cid)) for cid in info["sources"][:2]}
        db.expunge_all()
        catalog = build_catalog(db, OwnershipScope(info["owners"][0]))
        assert {row.id for row in catalog.conversations} == set(info["sources"][:2])
        assert {row.id: row.estimated_bytes for row in catalog.conversations} == expected
        assert {row.id for row in catalog.projects} == {own_id}
        assert next(row for row in catalog.conversations if row.id == info["sources"][1]).project_id is None
        assert "PRIVATE FOREIGN PROJECT" not in catalog.model_dump_json()


def test_tag_membership_mapping_is_one_account_owned_query(bundle_state):
    import uuid
    from app.models.user_feature_entry import UserFeatureEntry
    from app.services.offline_packages import _offline_tag_mapping
    from app.services.preferences import get_or_create_preferences
    info = bundle_state
    with info["factory"]() as db:
        subjects = [str(owner) for owner in info["owners"]]
        for subject in subjects:
            get_or_create_preferences(db, subject)
        db.add_all([
            UserFeatureEntry(id=uuid.uuid4(), subject_key=subjects[0], collection="conversation-tag",
                value={"name": "Synthetic tag", "conversation_ids": [str(cid) for cid in info["sources"][:2]]}),
            UserFeatureEntry(id=uuid.uuid4(), subject_key=subjects[1], collection="conversation-tag",
                value={"name": "PRIVATE TAG", "conversation_ids": [str(info["sources"][0])]}),
        ])
        db.commit()
        statements = []
        def capture(*_):
            statements.append(1)
        event.listen(db.bind, "before_cursor_execute", capture)
        try:
            mapping = _offline_tag_mapping(db, info["sources"][:2], subjects[0])
        finally:
            event.remove(db.bind, "before_cursor_execute", capture)
        assert mapping == {cid: ["Synthetic tag"] for cid in info["sources"][:2]}
        assert len(statements) == 1
