"""Saved feature membership and limits under actual transaction locks."""
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from sqlalchemy.orm import Session

from app.models.user import User
from app.models.user_feature_entry import UserFeatureEntry
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
        db.commit()
        subject = str(owner.id)
    value = {"conversation_id": str(uuid.uuid4()), "state": "unread"}
    barrier = Barrier(2)

    def add(_):
        with Session(engine) as db:
            barrier.wait(timeout=10)
            try:
                write_entry(db, subject, "reading-list", uuid.uuid4(), 0, value)
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
