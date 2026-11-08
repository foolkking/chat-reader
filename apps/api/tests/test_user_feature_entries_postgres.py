"""Saved feature membership and limits under actual transaction locks."""
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from sqlalchemy.orm import Session

from app.models.user import User
from app.models.user_feature_entry import UserFeatureEntry
from app.models.conversation import Conversation
from app.services.ownership import OwnershipScope
from app.services.user_feature_entries import UserFeatureEntryConflict, write_entry
from test_import_profile_postgres import isolated_schema  # noqa: F401

pytestmark = pytest.mark.skipif(
    os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1",
    reason="requires explicitly selected disposable PostgreSQL",
)


def test_different_entry_ids_cannot_add_one_conversation_twice(isolated_schema):
    engine, migrate = isolated_schema
    migrate("head")
    with Session(engine) as db:
        owner = User(normalized_email=f"reading-{uuid.uuid4()}@example.test")
        db.add(owner)
        db.flush()
        conversation = Conversation(owner_user_id=owner.id, title="Synthetic", display_title="Synthetic",
            source_type="manual", source_profile="test", parser_version="test")
        db.add(conversation); db.commit()
        subject = str(owner.id)
        owner_id, conversation_id = owner.id, conversation.id
    value = {"conversation_id": str(conversation_id), "state": "unread"}
    barrier = Barrier(2)

    def add(_):
        with Session(engine) as db:
            barrier.wait(timeout=10)
            try:
                write_entry(db, subject, "reading-list", uuid.uuid4(), 0, value, OwnershipScope(owner_id))
                db.commit()
                return "saved"
            except UserFeatureEntryConflict:
                db.rollback()
                return "conflict"

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(add, range(2))) == ["conflict", "saved"]
    with Session(engine) as db:
        rows = db.query(UserFeatureEntry).all()
        assert len(rows) == 1
        assert rows[0].value == value


def test_api_and_worker_image_conversion_share_a_transaction_slot(isolated_schema):
    from app.services.assets.image_display import acquire_conversion_transaction
    engine, migrate = isolated_schema
    migrate("head")
    with Session(engine) as api, Session(engine) as worker:
        assert acquire_conversion_transaction(api)
        assert not acquire_conversion_transaction(worker)
        api.rollback()
        assert acquire_conversion_transaction(worker)
        worker.rollback()
        assert acquire_conversion_transaction(api)


def test_concurrent_creates_cannot_exceed_the_collection_limit(isolated_schema):
    engine, migrate = isolated_schema
    migrate("head")
    with Session(engine) as db:
        owner = User(normalized_email=f"saved-{uuid.uuid4()}@example.test")
        db.add(owner)
        db.commit()
        subject = str(owner.id)
        for index in range(19):
            write_entry(db, subject, "saved-search", uuid.uuid4(), 0, {"name": f"Synthetic {index}", "q": "synthetic"})
        db.commit()
    barrier = Barrier(2)

    def add(_):
        with Session(engine) as db:
            barrier.wait(timeout=10)
            try:
                write_entry(db, subject, "saved-search", uuid.uuid4(), 0, {"name": "Synthetic final slot", "q": "synthetic"})
                db.commit()
                return "saved"
            except UserFeatureEntryConflict:
                db.rollback()
                return "conflict"

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(add, range(2))) == ["conflict", "saved"]
    with Session(engine) as db:
        assert db.query(UserFeatureEntry).count() == 20
