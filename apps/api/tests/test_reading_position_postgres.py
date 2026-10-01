import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.models.conversation import Conversation
from app.models.reading_position import ReadingPosition, ReadingPositionSyncReceipt
from app.models.user import User
from app.schemas.reading import ReadingPositionSyncRequest
from app.services.reading.reading_service import sync_reading_position
from app.services.ownership import OwnershipScope
from test_import_profile_postgres import isolated_schema  # noqa: F401

pytestmark = pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1", reason="requires disposable PostgreSQL")


def seed(engine):
    with Session(engine) as db:
        user = User(normalized_email="reading-test@example.test"); db.add(user); db.flush()
        conversation = Conversation(owner_user_id=user.id, title="Synthetic", display_title="Synthetic", source_type="test", source_profile="test", parser_version="test")
        db.add(conversation); db.commit()
        return str(user.id), conversation.id


def request(offset, base=0):
    return ReadingPositionSyncRequest(operation_id=uuid.uuid4(), base_revision=base, position={"scroll_offset": offset})


def test_reading_migration_preserves_old_anchor_and_cascades_receipts(isolated_schema):
    engine, migrate = isolated_schema
    migrate("20261001_0039")
    subject, conversation_id = seed(engine)
    with engine.begin() as db:
        db.execute(sa.text("INSERT INTO reading_positions(id,subject_key,conversation_id,scroll_offset,anchor_data,created_at,updated_at) VALUES (:id,:subject,:conversation,37,'{}',now(),now())"), {"id": uuid.uuid4(), "subject": subject, "conversation": conversation_id})
    migrate("head")
    with Session(engine) as db:
        row = db.query(ReadingPosition).one()
        assert row.scroll_offset == 37 and row.revision == 1
        result = sync_reading_position(db, conversation_id, request(45, 1), subject_key=subject, ownership_scope=OwnershipScope(uuid.UUID(subject)))
        assert result.position.revision == 2
        db.commit()
        db.delete(db.get(Conversation, conversation_id)); db.commit()
        assert db.query(ReadingPositionSyncReceipt).count() == 0
    migrate("20261001_0039", "downgrade"); migrate("head")


def test_concurrent_position_updates_and_replay_are_serialized(isolated_schema):
    engine, migrate = isolated_schema; migrate("head")
    subject, conversation_id = seed(engine)
    same = request(10)
    barrier = Barrier(2)
    def apply(payload):
        with Session(engine) as db:
            # Verify the advisory lock refreshes rows previously read in a session.
            db.query(ReadingPosition).all()
            barrier.wait(timeout=10)
            result = sync_reading_position(db, conversation_id, payload, subject_key=subject, ownership_scope=OwnershipScope(uuid.UUID(subject)))
            db.commit(); return result
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(apply, [same, same]))
    assert results[0] == results[1] and results[0].position.revision == 1
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(apply, [request(20, 1), request(30, 1)]))
    assert sorted(result.status for result in results) == ["applied", "conflict"]
    with Session(engine) as db:
        assert db.query(ReadingPosition).one().revision == 2
        assert db.query(ReadingPositionSyncReceipt).count() == 3
