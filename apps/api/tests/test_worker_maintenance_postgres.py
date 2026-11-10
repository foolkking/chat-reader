"""Housekeeping and heartbeat lock boundaries on disposable PostgreSQL only."""
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, text
from sqlalchemy.orm import sessionmaker

from app.models.background_job import BackgroundJob
from app.models.conversation import Conversation
from app.models.share import Share
from app.models.share_snapshot import ShareSnapshot
from app.models.user import User
from app.models.worker_runtime_state import WorkerRuntimeState
from app.services.sharing.share_service import reclaim_expired_frozen_snapshots
from app.services.worker_liveness import WorkerHeartbeatReporter
from app.services.worker_maintenance import bound_worker_transaction
from test_import_profile_postgres import isolated_schema  # noqa: F401

pytestmark = pytest.mark.skipif(
    os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1",
    reason="requires explicitly selected disposable PostgreSQL",
)


def test_locked_share_is_skipped_without_blocking_other_expired_snapshots(isolated_schema):
    engine, migrate = isolated_schema
    migrate("head")
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    now = datetime.now(timezone.utc)
    with factory() as db:
        owner = User(normalized_email="maintenance-share@example.test")
        db.add(owner)
        db.flush()
        conversation = Conversation(owner_user_id=owner.id, title="Synthetic", display_title="Synthetic",
            source_type="synthetic", source_profile="synthetic", parser_version="test")
        db.add(conversation)
        db.flush()
        identities = []
        for offset in (-3, -2, 1):
            share = Share(conversation_id=conversation.id, token_hash=uuid.uuid4().hex,
                token_prefix="synthetic", content_mode="frozen", expires_at=now + timedelta(days=offset))
            db.add(share)
            db.flush()
            db.add(ShareSnapshot(share_id=share.id, conversation={}, messages=[],
                toc=[], message_count=0, turn_count=0))
            identities.append(share.id)
        db.commit()

    with factory() as holder:
        holder.scalar(select(Share).where(Share.id == identities[0]).with_for_update())
        with ThreadPoolExecutor(max_workers=1) as executor:
            assert executor.submit(reclaim_expired_frozen_snapshots, factory, now=now, limit=20).result(timeout=5) == 1
        with factory() as reader:
            assert reader.get(ShareSnapshot, identities[0]) is not None
            assert reader.get(ShareSnapshot, identities[1]) is None
            assert reader.get(ShareSnapshot, identities[2]) is not None
            assert reader.query(Share).count() == 3
    assert reclaim_expired_frozen_snapshots(factory, now=now, limit=20) == 1
    assert reclaim_expired_frozen_snapshots(factory, now=now, limit=20) == 0


@pytest.mark.parametrize("finish", ["commit", "rollback"])
def test_worker_deadlines_are_transaction_local_and_do_not_leak(isolated_schema, finish):
    engine, _ = isolated_schema
    factory = sessionmaker(bind=engine)
    with factory() as db:
        previous = tuple(db.scalar(text(f"SHOW {name}")) for name in ("statement_timeout", "lock_timeout"))
        db.commit()
        bound_worker_transaction(db)
        assert db.scalar(text("SHOW statement_timeout")) == "1500ms"
        assert db.scalar(text("SHOW lock_timeout")) == "250ms"
        getattr(db, finish)()
        assert tuple(db.scalar(text(f"SHOW {name}")) for name in ("statement_timeout", "lock_timeout")) == previous


def test_task_row_lock_does_not_suppress_worker_liveness(isolated_schema):
    engine, migrate = isolated_schema
    migrate("head")
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    now = datetime.now(timezone.utc)
    with factory() as db:
        owner = User(normalized_email="maintenance-heartbeat@example.test")
        db.add(owner)
        db.flush()
        job = BackgroundJob(owner_user_id=owner.id, job_type="conversation_export", status="processing", heartbeat_at=now)
        db.add(job)
        db.commit()
        identity = job.id
    reporter = WorkerHeartbeatReporter(interval_seconds=30, session_factory=factory)
    assert reporter.set_busy("job", identity)
    with factory() as holder:
        holder.scalar(select(BackgroundJob).where(BackgroundJob.id == identity).with_for_update())
        with ThreadPoolExecutor(max_workers=1) as executor:
            assert executor.submit(reporter.pulse, now=now + timedelta(seconds=1)).result(timeout=5)
        assert reporter._task_failure_active
        assert not reporter._worker_failure_active
        with factory() as reader:
            assert reader.get(WorkerRuntimeState, "primary").heartbeat_at == now + timedelta(seconds=1)
    assert reporter.pulse(now=now + timedelta(seconds=2))
    assert not reporter._task_failure_active
    with factory() as db:
        assert db.get(BackgroundJob, identity).heartbeat_at == now + timedelta(seconds=2)
