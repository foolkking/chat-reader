"""Split acknowledgement replay under real PostgreSQL transaction locks."""
import os
import hashlib
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from types import SimpleNamespace

import pytest
import sqlalchemy as sa
from fastapi import HTTPException, Request
from sqlalchemy.orm import Session

from app.api.routes.conversations import execute_split_workspace
from app.models.conversation import Conversation
from app.models.conversation_split import ConversationSplitReceipt
from app.models.message import Message
from app.models.user import User
from app.schemas.editing import ConversationSplitWorkspaceRequest
from app.services.editing.message_edit_service import create_manual_conversation
from app.services.ownership import OwnershipScope
from test_import_profile_postgres import isolated_schema  # noqa: F401

pytestmark = pytest.mark.skipif(
    os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1",
    reason="requires explicitly selected disposable PostgreSQL",
)


def request_for(user_id):
    request = Request({"type": "http", "headers": []})
    request.state.auth = SimpleNamespace(user_id=user_id, principal_id=str(user_id))
    return request


def seed(engine):
    with Session(engine) as db:
        owner = User(normalized_email=f"split-{uuid.uuid4()}@example.test")
        other = User(normalized_email=f"split-other-{uuid.uuid4()}@example.test")
        db.add_all([owner, other])
        db.flush()
        result = create_manual_conversation(
            db, title="Synthetic source", user_text="Synthetic question",
            assistant_text="Synthetic answer", ownership_scope=OwnershipScope(owner.id),
        )
        payload = ConversationSplitWorkspaceRequest(
            mode="range_copy", start_message_id=result.messages[0].id,
            end_message_id=result.messages[1].id, titles=["Synthetic result"],
        )
        db.commit()
        return owner.id, other.id, result.conversation.id, payload


def test_concurrent_split_commits_once_replays_exact_receipt_and_isolates_owner(isolated_schema):
    engine, migrate = isolated_schema
    migrate("head")
    owner, other, source_id, payload = seed(engine)
    barrier = Barrier(2)

    def run(_):
        with Session(engine) as db:
            barrier.wait(timeout=10)
            return execute_split_workspace(
                source_id, payload, request_for(owner), idempotency_key="synthetic-same-split", db=db,
            ).model_dump(mode="json")

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(run, range(2)))
    assert responses[0] == responses[1]
    with Session(engine) as db:
        assert db.query(ConversationSplitReceipt).count() == 1
        assert db.query(Conversation).filter_by(source_type="split").count() == 1
        assert db.query(Message).filter_by(conversation_id=source_id).count() == 2
        assert db.query(Message).count() == 4
        with pytest.raises(HTTPException) as denied:
            execute_split_workspace(source_id, payload, request_for(other), idempotency_key="synthetic-same-split", db=db)
        assert denied.value.status_code == 404
        db.rollback()
        changed = payload.model_copy(update={"titles": ["Different synthetic plan"]})
        with pytest.raises(HTTPException) as conflict:
            execute_split_workspace(source_id, changed, request_for(owner), idempotency_key="synthetic-same-split", db=db)
        assert conflict.value.status_code == 409
        assert conflict.value.detail["code"] == "SPLIT_IDEMPOTENCY_CONFLICT"
        assert db.query(Conversation).filter_by(source_type="split").count() == 1
        separate = execute_split_workspace(source_id, payload, request_for(owner), idempotency_key="synthetic-new-split", db=db)
        assert str(separate.conversations[0].conversation_id) != responses[0]["conversations"][0]["conversation_id"]
        assert db.query(Conversation).filter_by(source_type="split").count() == 2
        assert db.query(ConversationSplitReceipt).count() == 2


def test_receipt_migration_preserves_canonical_rows_and_has_cascade_lifetime(isolated_schema):
    engine, migrate = isolated_schema
    migrate("20261022_0053")
    # A migration fixture must use the actual old schema, not current ORM
    # listeners/columns (0062 reserves navigation positions before insertion).
    metadata = sa.MetaData()
    users, conversations, messages, versions = [
        sa.Table(name, metadata, autoload_with=engine)
        for name in ("users", "conversations", "messages", "message_versions")
    ]
    assert "unclassified_sort_order" not in conversations.c
    owner, source_id = uuid.uuid4(), uuid.uuid4()
    source_message_ids = [uuid.uuid4(), uuid.uuid4()]
    with engine.begin() as db:
        db.execute(users.insert().values(id=owner, normalized_email=f"split-{owner}@example.test",
            created_at=sa.func.now(), updated_at=sa.func.now()))
        db.execute(conversations.insert().values(id=source_id, owner_user_id=owner,
            title="Synthetic source", display_title="Synthetic source", source_type="test",
            source_profile="test", parser_version="test", imported_at=sa.func.now(),
            message_count=2, turn_count=1))
        for index, (role, text) in enumerate((("user", "Synthetic question"), ("assistant", "Synthetic answer"))):
            message_id, version_id = source_message_ids[index], uuid.uuid4()
            content_hash = hashlib.sha256(text.encode()).hexdigest()
            db.execute(messages.insert().values(id=message_id, conversation_id=source_id, role=role,
                order_key=str(index + 1).zfill(8), turn_index=0, created_in_system_at=sa.func.now(),
                created_by="test", source_type="test", is_deleted=False, block_count=0,
                char_count=len(text), is_heavy=False, content_hash=content_hash))
            db.execute(versions.insert().values(id=version_id, message_id=message_id, version_number=1,
                plain_text=text, display_text=text, blocks=[], edit_type="import", created_by="test",
                created_at=sa.func.now(), content_hash=content_hash, normalizer_version="legacy-v1",
                markdown_parser_version="legacy-v1", block_builder_version="legacy-v1", search_document_version="legacy-v1"))
            db.execute(messages.update().where(messages.c.id == message_id).values(current_version_id=version_id))
    payload = ConversationSplitWorkspaceRequest(mode="range_copy", start_message_id=source_message_ids[0],
        end_message_id=source_message_ids[1], titles=["Synthetic result"])
    migrate("head")
    with Session(engine) as db:
        execute_split_workspace(source_id, payload, request_for(owner), idempotency_key="synthetic-migration", db=db)
        canonical_ids = {row.id for row in db.query(Conversation)}
        message_ids = {row.id for row in db.query(Message)}
        assert source_id in canonical_ids and set(source_message_ids) <= message_ids
        canonical_versions = list(db.execute(sa.select(versions.c.id, versions.c.display_text).order_by(versions.c.id)))
    foreign_key = sa.inspect(engine).get_foreign_keys("conversation_split_receipts")[0]
    assert foreign_key["options"]["ondelete"] == "CASCADE"
    migrate("20261022_0053", operation="downgrade")
    assert "conversation_split_receipts" not in sa.inspect(engine).get_table_names()
    with engine.connect() as db:
        assert set(db.scalars(sa.select(conversations.c.id))) == canonical_ids
        assert set(db.scalars(sa.select(messages.c.id))) == message_ids
        assert list(db.execute(sa.select(versions.c.id, versions.c.display_text).order_by(versions.c.id))) == canonical_versions
