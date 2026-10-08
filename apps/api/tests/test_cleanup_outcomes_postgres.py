"""Completion receipts and final-message atomicity on real PostgreSQL."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from types import SimpleNamespace

import pytest
from fastapi import Request
from sqlalchemy.orm import Session

from app.api.routes.content_cleanup import apply
from app.models.background_job import BackgroundJob
from app.models.content_cleanup import ContentCleanupOccurrence, ContentCleanupScan
from app.models.message_version import MessageVersion
from app.models.user import User
from app.services import cleanup_outcomes, content_cleanup as cleanup
from app.services.editing.message_edit_service import create_manual_conversation
from app.services.ownership import OwnershipScope
from test_cleanup_postgres import isolated_schema, pytestmark, seed  # noqa: F401


def select(db, scan_id):
    cleanup.update_decisions(db, scan_id, {row.id: "DELETE" for row in db.query(ContentCleanupOccurrence).filter_by(scan_id=scan_id)})
    db.commit()


def request_for(owner_id):
    return Request({"type": "http", "state": {"auth": SimpleNamespace(user_id=owner_id, principal_id="synthetic-user")}})


def test_concurrent_completed_http_replay_and_owner_isolation(isolated_schema):
    engine, migrate = isolated_schema
    migrate("head")
    scan_id, message_id = seed(engine)
    with Session(engine) as db:
        select(db, scan_id)
        owner_id = db.get(ContentCleanupScan, scan_id).owner_user_id
    barrier = Barrier(2)

    def submit():
        with Session(engine) as db:
            barrier.wait(timeout=10)
            return apply(scan_id, request_for(owner_id), None, db).model_dump()

    with ThreadPoolExecutor(max_workers=2) as executor:
        assert list(executor.map(lambda _: submit(), range(2))) == [{"applied": 1, "conflicts": 0}] * 2
    with Session(engine) as db:
        assert db.query(MessageVersion).filter_by(message_id=message_id).count() == 2
        assert db.get(ContentCleanupScan, scan_id) is None
        assert db.query(BackgroundJob).filter_by(idempotency_key=f"cleanup-apply:{scan_id}").count() == 1
        assert cleanup_outcomes.read_outcome(db, scan_id, OwnershipScope(owner_id))["applied"] == 1
        other = User(normalized_email="receipt-other@example.test")
        db.add(other)
        db.flush()
        assert cleanup_outcomes.read_outcome(db, scan_id, OwnershipScope(other.id)) is None
        db.query(User).filter_by(id=owner_id).delete(synchronize_session=False)
        db.commit()
        assert db.query(BackgroundJob).filter_by(idempotency_key=f"cleanup-apply:{scan_id}").count() == 0


def test_final_receipt_failure_preserves_only_earlier_conversations(isolated_schema, monkeypatch):
    engine, migrate = isolated_schema
    migrate("head")
    with Session(engine) as db:
        user = User(normalized_email="receipt-rollback@example.test")
        db.add(user)
        db.flush()
        scope = OwnershipScope(user.id)
        created = [create_manual_conversation(db, title=f"Synthetic cleanup {i}", user_text="Question",
                   assistant_text="Before \ue200cite\ue202turn12search4\ue201 after.", ownership_scope=scope) for i in range(2)]
        message_ids = [row.messages[1].id for row in created]
        scan, _ = cleanup.create_scan(db, source="BATCH", scope_type="SELECTED_CONVERSATIONS",
                       conversation_ids=[row.conversation.id for row in created], ownership_scope=scope)
        scan_id = scan.id
        db.commit()
        while not cleanup.process_scan_chunk(db, scan_id)["done"]:
            db.commit()
        db.commit()
        select(db, scan_id)
    original = cleanup_outcomes.save_completed_outcome

    def fail_final(db, scan, response):
        original(db, scan, response)
        db.flush()
        raise RuntimeError("Synthetic receipt publication failure")

    monkeypatch.setattr(cleanup_outcomes, "save_completed_outcome", fail_final)
    with Session(engine) as db:
        with pytest.raises(RuntimeError, match="Synthetic receipt"):
            cleanup.apply_scan(db, scan_id)
    with Session(engine) as db:
        assert sorted(db.query(MessageVersion).filter_by(message_id=mid).count() for mid in message_ids) == [1, 2]
        assert cleanup_outcomes.read_outcome(db, scan_id, scope) == {
            "status": "REVIEW", "applied": 1, "remaining": 1, "conflicts": 0, "completed_at": None}
        assert db.query(BackgroundJob).filter_by(idempotency_key=f"cleanup-apply:{scan_id}").count() == 0
    monkeypatch.setattr(cleanup_outcomes, "save_completed_outcome", original)
    with Session(engine) as db:
        assert apply(scan_id, request_for(scope.owner_user_id), None, db).applied == 1
        assert cleanup_outcomes.read_outcome(db, scan_id, scope)["applied"] == 2
        assert all(db.query(MessageVersion).filter_by(message_id=mid).count() == 2 for mid in message_ids)
