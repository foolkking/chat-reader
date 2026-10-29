"""Split acknowledgement replay under real PostgreSQL transaction locks."""
import os
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
    owner, _, source_id, payload = seed(engine)
    migrate("head")
    with Session(engine) as db:
        execute_split_workspace(source_id, payload, request_for(owner), idempotency_key="synthetic-migration", db=db)
        canonical_ids = {row.id for row in db.query(Conversation)}
        message_ids = {row.id for row in db.query(Message)}
    foreign_key = sa.inspect(engine).get_foreign_keys("conversation_split_receipts")[0]
    assert foreign_key["options"]["ondelete"] == "CASCADE"
    migrate("20261022_0053", operation="downgrade")
    assert "conversation_split_receipts" not in sa.inspect(engine).get_table_names()
    with Session(engine) as db:
        assert {row.id for row in db.query(Conversation)} == canonical_ids
        assert {row.id for row in db.query(Message)} == message_ids
