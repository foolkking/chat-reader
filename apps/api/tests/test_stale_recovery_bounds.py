"""Synthetic bounded recovery and actual PostgreSQL heartbeat lock protection."""
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.core.database import Base
from app.models.background_job import BackgroundJob
from app.models.import_record import ImportRecord
from app.models.source_artifact import SourceArtifact
from app.models.user import User
from app.services.background_jobs import recover_stale_jobs
from app.services.import_queue import recover_stale_imports
from test_import_profile_postgres import isolated_schema  # noqa: F401


def record(model, owner=None, *, age=60):
    now = datetime.now(timezone.utc)
    values = dict(id=uuid.uuid4(), status="processing", attempt_count=1,
                  heartbeat_at=now - timedelta(minutes=age), created_at=now,
                  owner_user_id=owner)
    return model(**values, **({"source_profile": "synthetic", "source_fingerprint": uuid.uuid4().hex}
                            if model is ImportRecord else {"job_type": "synthetic_recovery"}))


@pytest.mark.parametrize("model,recover", [(ImportRecord, recover_stale_imports), (BackgroundJob, recover_stale_jobs)])
def test_each_recovery_pass_loads_only_one_bounded_batch(tmp_path, model, recover):
    engine = create_engine(f"sqlite:///{tmp_path / 'recovery.sqlite'}")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.add_all([record(model) for _ in range(105)])
        db.commit()
        assert recover(db, 60) == 100
        assert len(db.identity_map) <= 100
        db.commit()
        assert db.query(model).filter_by(status="processing").count() == 5
        assert recover(db, 60) == 5
        db.commit()
        assert recover(db, 60) == 0
        assert db.query(model).filter_by(status="queued").count() == 105
    engine.dispose()


@pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1", reason="requires disposable PostgreSQL")
@pytest.mark.parametrize("model,recover", [(ImportRecord, recover_stale_imports), (BackgroundJob, recover_stale_jobs)])
def test_live_heartbeat_row_lock_does_not_block_or_get_overwritten(isolated_schema, model, recover):
    engine, migrate = isolated_schema
    migrate("head")
    with Session(engine) as seed:
        owner = User(normalized_email="synthetic-stale-recovery@example.test")
        seed.add(owner); seed.flush()
        live, abandoned = record(model, owner.id), record(model, owner.id)
        seed.add_all([live, abandoned]); seed.commit()
        live_id, abandoned_id = live.id, abandoned.id
    with Session(engine) as writer, Session(engine) as recovery:
        row = writer.query(model).filter_by(id=live_id).with_for_update().one()
        row.heartbeat_at = datetime.now(timezone.utc)
        writer.flush()  # The old stale value is still visible to another connection.
        recovery.execute(text("SET LOCAL lock_timeout = '250ms'"))
        recovery.execute(text("SET LOCAL statement_timeout = '1500ms'"))
        assert recover(recovery, 60) == 1
        recovery.commit()
        assert recovery.get(model, abandoned_id).status == "queued"
        writer.commit()
    with Session(engine) as check:
        row = check.get(model, live_id)
        assert row.status == "processing" and row.attempt_count == 1
        assert row.heartbeat_at >= datetime.now(timezone.utc) - timedelta(seconds=10)


@pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1", reason="requires disposable PostgreSQL")
@pytest.mark.parametrize("model,recover", [(ImportRecord, recover_stale_imports), (BackgroundJob, recover_stale_jobs)])
def test_locked_recovery_refreshes_previously_loaded_identity(isolated_schema, model, recover):
    engine, migrate = isolated_schema
    migrate("head")
    with Session(engine) as seed:
        owner = User(normalized_email="synthetic-recovery-identity@example.test")
        seed.add(owner); seed.flush()
        row = record(model, owner.id)
        seed.add(row); seed.commit(); identity = row.id
    with Session(engine, expire_on_commit=False) as recovery:
        old = recovery.get(model, identity)
        with Session(engine) as writer:
            current = writer.get(model, identity)
            current.attempt_count = 99
            writer.commit()
        recover(recovery, 60); recovery.commit()
        assert old.status == "failed", "Recovery must use current attempts under its row lock, not a stale identity."
        assert old.attempt_count == 99


@pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1", reason="requires disposable PostgreSQL")
def test_live_canonical_transaction_cannot_be_recovered_or_failed_by_a_duplicate(isolated_schema, monkeypatch):
    import threading
    from concurrent.futures import ThreadPoolExecutor
    from sqlalchemy.orm import sessionmaker
    from app.services.canonical import persistence
    from app.services.import_queue import process_import

    engine, migrate = isolated_schema
    migrate("head")
    factory = sessionmaker(bind=engine, autoflush=False)
    with factory() as db:
        owner = User(normalized_email="synthetic-live-commit@example.test")
        db.add(owner); db.flush()
        row = record(ImportRecord, owner.id)
        db.add(row); db.flush()
        db.add(SourceArtifact(import_id=row.id, source_type="file", source_profile="synthetic",
            filename="synthetic.json", safe_filename="synthetic.json", sha256="a" * 64,
            byte_size=0, raw_storage_uri="synthetic-not-opened"))
        db.commit(); identity = row.id
    entered, release = threading.Event(), threading.Event()
    worker_thread = []

    class EndSyntheticTransaction(Exception):
        pass

    def pause_current_writer(*args):
        if threading.get_ident() == worker_thread[0]:
            entered.set()
            assert release.wait(timeout=15), "Synthetic writer must be released even on test failure."
        raise EndSyntheticTransaction()

    monkeypatch.setattr(persistence, "_report", pause_current_writer)

    def canonical_writer():
        worker_thread.append(threading.get_ident())
        with factory() as db:
            with pytest.raises(EndSyntheticTransaction):
                persistence.commit_import_preview(identity, db)
            db.rollback()

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(canonical_writer)
        try:
            assert entered.wait(timeout=10)
            with factory() as recovery:
                recovery.execute(text("SET LOCAL statement_timeout = '1500ms'"))
                assert recover_stale_imports(recovery, 60) == 0, "A missing heartbeat does not release a live canonical writer."
                recovery.commit()
            # This duplicate worker cannot mutate the original task to failed.
            assert process_import(identity, factory) is None
            with factory() as check:
                assert check.get(ImportRecord, identity).status == "processing"
                with pytest.raises(persistence.CommitImportError, match="already being processed"):
                    persistence.commit_import_preview(identity, check)
        finally:
            release.set()
            future.result(timeout=10)
    with factory() as db:
        assert recover_stale_imports(db, 60) == 1, "Rollback releases the lease; the next pass can recover."
        db.commit()
        assert db.get(ImportRecord, identity).status == "queued"


def test_late_import_failure_does_not_overwrite_a_new_execution(tmp_path, monkeypatch):
    from sqlalchemy.orm import sessionmaker
    from app.services import import_queue
    engine = create_engine(f"sqlite:///{tmp_path / 'late-failure.sqlite'}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False)
    with factory() as db:
        row = record(ImportRecord)
        row.started_at = datetime.now(timezone.utc)
        db.add(row); db.commit(); identity = row.id

    def delayed_failure(import_id, db, **kwargs):
        with factory() as newer:
            row = newer.get(ImportRecord, import_id)
            row.attempt_count += 1
            row.started_at = datetime.now(timezone.utc)
            row.phase = "persisting"
            newer.commit()
        raise RuntimeError("Synthetic retired execution")

    monkeypatch.setattr(import_queue, "commit_import_preview", delayed_failure)
    assert import_queue.process_import(identity, factory) is None
    with factory() as db:
        row = db.get(ImportRecord, identity)
        assert row.status == "processing" and row.phase == "persisting" and row.attempt_count == 2
        assert row.error_message is None
    engine.dispose()


def test_a_queued_unclaimed_import_is_not_executed_by_a_stale_worker_call(tmp_path, monkeypatch):
    from sqlalchemy.orm import sessionmaker
    from app.services import import_queue
    engine = create_engine(f"sqlite:///{tmp_path / 'unclaimed.sqlite'}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    with factory() as db:
        row = record(ImportRecord); row.status = "queued"
        db.add(row); db.commit(); identity = row.id
    def forbidden(*args, **kwargs):
        pytest.fail("An unclaimed import cannot start a canonical write.")
    monkeypatch.setattr(import_queue, "commit_import_preview", forbidden)
    assert import_queue.process_import(identity, factory) is None
    with factory() as db:
        assert db.get(ImportRecord, identity).status == "queued"
    engine.dispose()


@pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1", reason="requires disposable PostgreSQL")
@pytest.mark.parametrize("fault", ["own-warning-row-lock", "progress-connection"])
def test_auxiliary_progress_cannot_deadlock_or_abort_canonical_commit(isolated_schema, monkeypatch, fault):
    from contextlib import contextmanager
    from sqlalchemy import event
    from sqlalchemy.exc import OperationalError
    from sqlalchemy.orm import sessionmaker
    from app.services import import_queue
    from app.services.canonical.persistence import CommitImportResult

    engine, migrate = isolated_schema
    migrate("head")
    factory = sessionmaker(bind=engine, autoflush=False)
    with factory() as db:
        owner = User(normalized_email="synthetic-progress-isolation@example.test")
        db.add(owner); db.flush()
        row = record(ImportRecord, owner.id); row.started_at = datetime.now(timezone.utc)
        db.add(row); db.commit(); identity = row.id
    # Bound the unfixed self-lock reproduction, not a substitute for the
    # application's own progress-transaction deadlines.
    def bounded(connection):
        connection.exec_driver_sql("SET LOCAL lock_timeout = '300ms'")
        connection.exec_driver_sql("SET LOCAL statement_timeout = '1500ms'")
    event.listen(engine, "begin", bounded)
    sessions = 0
    @contextmanager
    def faulty_factory():
        nonlocal sessions
        sessions += 1
        if fault == "progress-connection" and sessions == 2:
            raise OperationalError("synthetic-progress", {}, RuntimeError("synthetic-unavailable"))
        with factory() as db:
            yield db
    def commit_with_warning(import_id, db, *, progress_callback):
        row = db.get(ImportRecord, import_id)
        # Actual image fit warnings mutate this same row during attachment
        # persistence, before subsequent message/headings progress callbacks.
        row.warnings = ["Synthetic image fit warning"]
        db.flush()
        progress_callback("persisting", 50, 1, 2)
        row.status = "committed"; row.committed_at = datetime.now(timezone.utc)
        db.commit()
        return CommitImportResult(import_id=import_id, status="committed",
            conversation_ids=[], conversation_count=0, message_count=2)
    monkeypatch.setattr(import_queue, "commit_import_preview", commit_with_warning)
    monkeypatch.setattr(import_queue, "queue_import_scan", lambda *args, **kwargs: None)
    try:
        result = import_queue.process_import(identity, faulty_factory)
        assert result is not None and result.status == "committed"
        with factory() as db:
            row = db.get(ImportRecord, identity)
            assert row.status == "committed"
            assert row.warnings == ["Synthetic image fit warning"]
            assert row.error_message is None
    finally:
        event.remove(engine, "begin", bounded)
