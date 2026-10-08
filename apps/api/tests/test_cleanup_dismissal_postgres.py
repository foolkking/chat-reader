"""Actual PostgreSQL dismissal locks, idempotency and failed-transaction rollback."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from sqlalchemy.orm import Session
from app.models.background_job import BackgroundJob
from app.models.content_cleanup import ContentCleanupScan, ContentCleanupOccurrence
from app.models.message_version import MessageVersion
from app.services import cleanup_outcomes
from app.services.content_cleanup import dismiss_scan
from app.services.ownership import OwnershipScope
from test_cleanup_postgres import isolated_schema, pytestmark, seed  # noqa: F401


def test_concurrent_dismissal_creates_one_receipt_without_message_changes(isolated_schema):
    engine, migrate = isolated_schema
    migrate("head")
    scan, message = seed(engine)
    with Session(engine) as db:
        scope = OwnershipScope(db.get(ContentCleanupScan, scan).owner_user_id)
    barrier = Barrier(2)
    def dismiss(_):
        with Session(engine) as db:
            barrier.wait(timeout=10)
            dismiss_scan(db, scan, ownership_scope=scope)
            db.commit()
    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(dismiss, range(2)))
    with Session(engine) as db:
        assert db.get(ContentCleanupScan, scan) is None
        assert db.query(ContentCleanupOccurrence).filter_by(scan_id=scan).count() == 0
        assert db.query(BackgroundJob).filter_by(idempotency_key=f"cleanup-dismiss:{scan}").count() == 1
        assert cleanup_outcomes.dismissed_job(db, scan, scope)
        assert db.query(MessageVersion).filter_by(message_id=message).count() == 1


def test_dismissal_refreshes_cached_scan_before_checking_active_apply(isolated_schema):
    engine, migrate = isolated_schema
    migrate("head")
    scan, _ = seed(engine)
    with Session(engine) as waiting:
        cached = waiting.get(ContentCleanupScan, scan)
        scope = OwnershipScope(cached.owner_user_id)
        with Session(engine) as other:
            other.get(ContentCleanupScan, scan).status = "APPLYING"
            other.commit()
        assert cached.status == "READY"
        with pytest.raises(ValueError, match="Wait for"):
            dismiss_scan(waiting, scan, ownership_scope=scope)
        waiting.rollback()
    with Session(engine) as db:
        assert db.get(ContentCleanupScan, scan).status == "APPLYING"
        assert cleanup_outcomes.dismissed_job(db, scan, scope) is None


def test_receipt_failure_preserves_review_and_task(isolated_schema, monkeypatch):
    engine, migrate = isolated_schema
    migrate("head")
    scan, message = seed(engine)
    original = cleanup_outcomes.save_dismissed_outcome
    def fail(db, row):
        original(db, row)
        db.flush()
        raise ValueError("Synthetic rollback")
    monkeypatch.setattr(cleanup_outcomes, "save_dismissed_outcome", fail)
    with Session(engine) as db:
        scope = OwnershipScope(db.get(ContentCleanupScan, scan).owner_user_id)
        with pytest.raises(ValueError, match="Synthetic rollback"):
            dismiss_scan(db, scan, ownership_scope=scope)
        db.rollback()
    with Session(engine) as db:
        assert db.get(ContentCleanupScan, scan).status == "READY"
        assert cleanup_outcomes.dismissed_job(db, scan, scope) is None
        assert db.query(MessageVersion).filter_by(message_id=message).count() == 1
