"""Cancellation must not wait for the analysis transaction's ImportRecord lock."""
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO

import pytest
from sqlalchemy import event, text
from sqlalchemy.orm import sessionmaker

from app.api.routes.adaptive_imports import cancel_adaptive_import_session
from app.api.routes.tasks import cancel_task
from app.core.config import get_settings
from app.models.background_job import BackgroundJob
from app.models.conversation import Conversation
from app.models.import_profile import ImportInputGroup, ImportStructureFamily
from app.models.import_record import ImportRecord
from app.models.user import User
from app.services.adaptive_import import service
from app.services.background_jobs import claim_next_job, process_background_job
from app.services.ownership import OwnershipScope
from test_import_profile_postgres import isolated_schema as _isolated_schema
from test_import_analysis_queue import small_conversation_zip

isolated_schema = _isolated_schema
pytestmark = pytest.mark.skipif(
    os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1",
    reason="requires explicitly selected disposable PostgreSQL",
)


@pytest.mark.parametrize("via_tasks", [False, True])
@pytest.mark.parametrize("pause_at", ["before_parse", "before_publish"])
@pytest.mark.parametrize(("bounded_zip", "streaming"), [
    pytest.param(False, False, id="json"),
    pytest.param(True, False, id="small-zip-v1"),
    pytest.param(True, True, id="bounded-zip-v2"),
])
def test_cancellation_during_analysis_rolls_back_before_removing_sources(
    isolated_schema, tmp_path, monkeypatch, via_tasks, pause_at, bounded_zip, streaming,
):
    engine, migrate = isolated_schema
    migrate("head")
    monkeypatch.setenv("IMPORT_STORAGE_DIR", str(tmp_path / "imports"))
    monkeypatch.setenv("ASSET_STORAGE_DIR", str(tmp_path / "assets"))
    monkeypatch.setenv("IMPORT_BOUNDED_ZIP_ENABLED", "true" if streaming else "false")
    # Model a small host consistently: free bytes alone cannot determine the
    # v2 reserve. Do not combine 224 MiB free with the CI runner's real capacity.
    monkeypatch.setattr("app.services.adaptive_import.memory_budget.effective_total_memory_bytes",
                        lambda: 1024**3)
    monkeypatch.setattr("app.services.uploads.available_memory_bytes",
                        lambda: (224 * 1024**2) if bounded_zip else (16 * 1024**3))
    get_settings.cache_clear()
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    with factory() as db:
        owner = User(normalized_email="analysis-queue@example.test")
        db.add(owner)
        db.flush()
        record = service.begin_session(db, 1, owner_user_id=owner.id)
        service.add_session_source_stream(
            db, record, "synthetic.zip" if bounded_zip else "synthetic.json",
            BytesIO(small_conversation_zip() if bounded_zip else
                    b'{"metadata":{"powered_by":"ChatGPT Exporter"},'
                    b'"messages":[{"role":"Prompt","say":"Synthetic input."}]}'),
            max_file_bytes=1024 * 1024,
        )
        job = service.queue_session_analysis(db, record)
        db.commit()
        owner_id, import_id, job_id = owner.id, record.id, job.id
        assert claim_next_job(db, job_type="adaptive_import_analysis") == job_id
        db.commit()

    paused, release = threading.Event(), threading.Event()
    original_analyze = service.analyze_initial_session

    def pause():
        paused.set()
        assert release.wait(timeout=15), "Test did not release the analysis worker."

    def analyze(*args, **kwargs):
        from app.services.adaptive_import.memory_budget import current_budget
        budget = current_budget()
        assert (budget is not None) == bounded_zip
        if budget is not None:
            assert budget.streaming == streaming
        if pause_at == "before_parse":
            pause()
        return original_analyze(*args, **kwargs)

    def before_publish(_connection, _cursor, statement, parameters, _context, _many):
        if pause_at != "before_publish" or not statement.startswith("UPDATE background_jobs"):
            return
        values = parameters.values() if isinstance(parameters, dict) else parameters
        if "committed" in values:
            pause()

    monkeypatch.setattr(service, "analyze_initial_session", analyze)
    event.listen(engine, "before_cursor_execute", before_publish)
    root = tmp_path / "imports" / str(import_id)

    def cancel():
        with factory() as db:
            db.execute(text("SET LOCAL lock_timeout = '3s'"))
            db.execute(text("SET LOCAL statement_timeout = '5s'"))
            scope = OwnershipScope(owner_id)
            if via_tasks:
                result = cancel_task(job_id, db=db, ownership_scope=scope)
                assert result.status == "cancelling"
            else:
                cancel_adaptive_import_session(import_id, db=db, ownership_scope=scope)

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            worker = executor.submit(process_background_job, job_id, session_factory=factory)
            try:
                assert paused.wait(timeout=10)
                # The worker has already flushed imports, holding its row lock.
                # Cancel must update only BackgroundJob and return immediately.
                executor.submit(cancel).result(timeout=7)
                assert root.exists()
                assert (root / ("synthetic.zip" if bounded_zip else "synthetic.json")).is_file()
                with factory() as db:
                    assert db.get(BackgroundJob, job_id).status == "cancelling"
                    assert db.get(ImportRecord, import_id).session_state == "ANALYZING"
            finally:
                release.set()
                worker.result(timeout=20)
        with factory() as db:
            assert db.get(BackgroundJob, job_id).status == "cancelled"
            assert db.get(ImportRecord, import_id).session_state == "CANCELED"
            assert db.query(Conversation).count() == 0
            assert db.query(ImportInputGroup).filter_by(import_id=import_id).count() == 0
            assert db.query(ImportStructureFamily).filter_by(import_id=import_id).count() == 0
        assert not root.exists()
    finally:
        release.set()
        event.remove(engine, "before_cursor_execute", before_publish)
        get_settings.cache_clear()


@pytest.mark.parametrize("streaming", [False, True], ids=["small-zip-v1", "bounded-zip-v2"])
def test_bounded_and_standard_parsers_share_a_transaction_scoped_postgres_lane(
    isolated_schema, tmp_path, monkeypatch, streaming,
):
    from app.services.adaptive_import.memory_budget import import_analysis_admission, current_budget
    from app.services.uploads import UploadLimitError, bounded_analysis_admission_sync
    engine, migrate = isolated_schema
    migrate("head")
    monkeypatch.setenv("IMPORT_STORAGE_DIR", str(tmp_path / "imports"))
    monkeypatch.setenv("UPLOAD_MAX_ACTIVE_ANALYSIS", "2")
    monkeypatch.setenv("IMPORT_BOUNDED_ZIP_ENABLED", "true" if streaming else "false")
    monkeypatch.setattr("app.services.adaptive_import.memory_budget.effective_total_memory_bytes",
                        lambda: 1024**3)
    monkeypatch.setattr("app.services.uploads.available_memory_bytes", lambda: 224 * 1024**2)
    get_settings.cache_clear()
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    try:
        with factory() as first, factory() as other:
            owner = User(role="ADMIN", status="ACTIVE")
            first.add(owner)
            first.flush()
            record = service.begin_session(first, 1, owner_user_id=owner.id)
            service.add_session_source_stream(first, record, "synthetic.zip", BytesIO(small_conversation_zip()),
                                             max_file_bytes=1024**2)
            first.commit()
            with import_analysis_admission(first, record, force_memory_check=True):
                assert current_budget() is not None
                assert current_budget().streaming == streaming
                assert current_budget().reserve_bytes == 128 * 1024**2
                # The local semaphore has a second slot, so this assertion
                # reaches the PostgreSQL transaction lane rather than timing
                # out on the in-process slot.
                with pytest.raises(UploadLimitError) as error:
                    with bounded_analysis_admission_sync([1], db=other, force_memory_check=True,
                                                         required_memory_bytes=1):
                        pytest.fail("Another database session entered the held lane.")
                assert error.value.code == "UPLOAD_QUEUE_FULL"
            first.rollback()
            with bounded_analysis_admission_sync([1], db=other, force_memory_check=True,
                                                 required_memory_bytes=1):
                assert other.scalar(text("SELECT 1")) == 1
            other.rollback()
    finally:
        get_settings.cache_clear()


@pytest.fixture
def controlled_analysis(isolated_schema, tmp_path, monkeypatch):
    engine, migrate = isolated_schema
    migrate("head")
    monkeypatch.setenv("IMPORT_STORAGE_DIR", str(tmp_path / "imports"))
    monkeypatch.setenv("ASSET_STORAGE_DIR", str(tmp_path / "assets"))
    monkeypatch.setattr("app.services.uploads.available_memory_bytes", lambda: 16 * 1024**3)
    get_settings.cache_clear()
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    with factory() as db:
        owner = User(normalized_email="execution-fence@example.test")
        db.add(owner); db.flush()
        record = service.begin_session(db, 1, owner_user_id=owner.id)
        service.add_session_source_stream(db, record, "synthetic.json", BytesIO(
            b'{"metadata":{"powered_by":"ChatGPT Exporter"},"messages":[{"role":"Prompt","say":"Synthetic"}]}',
        ), max_file_bytes=1024**2)
        job = service.queue_session_analysis(db, record)
        db.commit()
        assert claim_next_job(db, job_type="adaptive_import_analysis") == job.id
        db.commit()
        values = factory, owner.id, record.id, job.id, tmp_path / "imports" / str(record.id)
    try:
        yield values
    finally:
        get_settings.cache_clear()


def test_a_live_analysis_lease_prevents_time_only_orphan_cancellation(controlled_analysis):
    from datetime import datetime, timedelta, timezone
    from app.services.background_jobs import _analysis_execution_lock, recover_stale_jobs
    factory, _, import_id, job_id, root = controlled_analysis
    with factory() as writer, factory() as recovery:
        assert _analysis_execution_lock(writer, job_id)
        job = recovery.get(BackgroundJob, job_id)
        job.status = "cancelling"
        job.payload = {**job.payload, "source_disposition": "retain"}
        job.heartbeat_at = datetime.now(timezone.utc) - timedelta(hours=1)
        recovery.commit()
        assert recover_stale_jobs(recovery, 60) == 0
        recovery.commit()
        recovery.expire_all()
        assert recovery.get(BackgroundJob, job_id).status == "cancelling"
        assert recovery.get(ImportRecord, import_id).session_state == "ANALYZING"
        writer.rollback()  # Models the dead writer's connection releasing its lease.
        assert recover_stale_jobs(recovery, 60) == 1
        recovery.commit()
        assert recovery.get(ImportRecord, import_id).session_state == "PAUSED"
        assert (root / "synthetic.json").is_file()


@pytest.mark.parametrize("fail_after_release", [False, True])
def test_superseded_execution_cannot_publish_or_mark_new_execution_failed(controlled_analysis, monkeypatch, fail_after_release):
    factory, _, import_id, job_id, root = controlled_analysis
    paused, release = threading.Event(), threading.Event()
    original = service.analyze_initial_session

    def analyze(*args, **kwargs):
        paused.set()
        assert release.wait(15)
        if fail_after_release:
            raise RuntimeError("Synthetic obsolete execution failure")
        return original(*args, **kwargs)

    monkeypatch.setattr(service, "analyze_initial_session", analyze)
    with ThreadPoolExecutor(max_workers=1) as executor:
        worker = executor.submit(process_background_job, job_id, session_factory=factory)
        try:
            assert paused.wait(10)
            with factory() as db:
                job = db.get(BackgroundJob, job_id)
                # Simulate another claim identity, including an unchanged
                # timestamp/count. The execution token must still fence it.
                job.payload = {**job.payload, "execution_token": "synthetic-new-execution"}
                job.phase = "new_execution"
                db.commit()
        finally:
            release.set()
            worker.result(20)
    with factory() as db:
        job = db.get(BackgroundJob, job_id)
        assert job.status == "processing" and job.phase == "new_execution"
        assert job.payload["execution_token"] == "synthetic-new-execution"
        assert db.query(ImportInputGroup).filter_by(import_id=import_id).count() == 0
        assert db.query(Conversation).count() == 0
    assert (root / "synthetic.json").is_file()


def test_bounded_checkpoint_observes_stop_before_next_parse(controlled_analysis, monkeypatch):
    import time
    from app.schemas.task import TaskCancellationRequest
    from app.services.adaptive_import.memory_budget import checkpoint
    factory, owner_id, import_id, job_id, root = controlled_analysis
    paused, release = threading.Event(), threading.Event()

    def analyze(*_args, **_kwargs):
        paused.set()
        assert release.wait(15)
        # Exercise the real throttled read after its 250-ms interval. No parser,
        # progress callback or terminal publication is needed to observe stop.
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            checkpoint()
            time.sleep(0.01)
        pytest.fail("Bounded checkpoint did not observe the acknowledged stop request.")

    monkeypatch.setattr(service, "analyze_initial_session", analyze)
    with ThreadPoolExecutor(max_workers=1) as executor:
        worker = executor.submit(process_background_job, job_id, session_factory=factory)
        try:
            assert paused.wait(10)
            with factory() as db:
                result = cancel_task(job_id, db=db, ownership_scope=OwnershipScope(owner_id),
                                     payload=TaskCancellationRequest(source_disposition="retain"))
                assert result.status == "cancelling"
                assert result.progress_updated_at is not None
        finally:
            release.set()
            worker.result(15)
    with factory() as db:
        assert db.get(BackgroundJob, job_id).status == "cancelled"
        assert db.get(ImportRecord, import_id).session_state == "PAUSED"
    assert (root / "synthetic.json").is_file()


def test_claim_identity_fences_heartbeat_requeue_and_processor_entry(controlled_analysis):
    from datetime import datetime, timedelta, timezone
    from app.services.task_worker import _requeue_unstarted_task
    from app.services.worker_liveness import refresh_active_task_heartbeat
    factory, _, import_id, job_id, _ = controlled_analysis
    with factory() as db:
        job = db.get(BackgroundJob, job_id)
        old = (job.attempt_count, job.started_at, job.payload["execution_token"])
        old_heartbeat = datetime.now(timezone.utc) - timedelta(minutes=2)
        job.payload = {**job.payload, "execution_token": "synthetic-new-claim"}
        job.heartbeat_at = old_heartbeat
        db.commit()
        assert refresh_active_task_heartbeat(db, task_kind="job", task_id=job_id, execution=old) is False
        db.commit()
    _requeue_unstarted_task("job", job_id, factory, execution=old)
    process_background_job(job_id, factory, expected_execution=old)
    with factory() as db:
        job = db.get(BackgroundJob, job_id)
        assert job.status == "processing" and job.heartbeat_at == old_heartbeat
        assert job.payload["execution_token"] == "synthetic-new-claim"
        assert db.query(ImportInputGroup).filter_by(import_id=import_id).count() == 0
        assert db.query(Conversation).count() == 0
        current = (job.attempt_count, job.started_at, job.payload["execution_token"])
        assert refresh_active_task_heartbeat(db, task_kind="job", task_id=job_id, execution=current)
        db.commit()


def test_cancellation_between_progress_read_and_write_keeps_cancelling_phase(controlled_analysis):
    from app.services.background_jobs import request_background_job_cancellation
    factory, _, import_id, job_id, _ = controlled_analysis
    engine = factory.kw["bind"]
    intervened = []

    def cancel_before_progress_write(connection, cursor, statement, parameters, context, executemany):
        if intervened or not context.isupdate or "UPDATE background_jobs" not in statement:
            return
        intervened.append(True)
        with factory() as cancel_db:
            job = cancel_db.get(BackgroundJob, job_id)
            request_background_job_cancellation(job, source_disposition="retain")
            cancel_db.commit()

    event.listen(engine, "before_cursor_execute", cancel_before_progress_write)
    try:
        process_background_job(job_id, factory)
    finally:
        event.remove(engine, "before_cursor_execute", cancel_before_progress_write)
    assert intervened
    with factory() as db:
        job = db.get(BackgroundJob, job_id)
        assert job.status == "cancelled" and job.phase == "cancelled"
        assert job.result["source_retained"] is True
        assert db.get(ImportRecord, import_id).session_state == "PAUSED"
        assert db.query(Conversation).count() == 0


def test_old_failed_retry_rechecks_session_after_concurrent_replacement(controlled_analysis):
    from fastapi import HTTPException
    from app.api.routes.tasks import retry_task
    factory, owner_id, import_id, job_id, _ = controlled_analysis
    with factory() as db:
        record, job = db.get(ImportRecord, import_id), db.get(BackgroundJob, job_id)
        record.session_state, record.status = "FAILED", "failed"
        job.status, job.phase = "failed", "analysis_failed"
        db.commit()
    waiting = threading.Event()
    engine = factory.kw["bind"]
    retry_thread = [None]

    def lock_started(connection, cursor, statement, parameters, context, executemany):
        if (threading.get_ident() == retry_thread[0] and "FROM imports" in statement
                and "FOR UPDATE" in statement):
            waiting.set()

    def retry():
        retry_thread[0] = threading.get_ident()
        with factory() as db:
            return retry_task(job_id, db=db, ownership_scope=OwnershipScope(owner_id))

    event.listen(engine, "before_cursor_execute", lock_started)
    try:
        with factory() as replacement, ThreadPoolExecutor(max_workers=1) as executor:
            record = replacement.get(ImportRecord, import_id, with_for_update=True)
            next_job = service.queue_session_analysis(replacement, record)
            next_id = next_job.id
            pending = executor.submit(retry)
            try:
                assert waiting.wait(10), "Retry did not refresh/lock its session before mutating it"
            finally:
                # Publish the new association while the old retry is waiting.
                replacement.commit()
            with pytest.raises(HTTPException) as caught:
                pending.result(10)
            assert caught.value.status_code == 409
    finally:
        event.remove(engine, "before_cursor_execute", lock_started)
    with factory() as db:
        assert db.get(BackgroundJob, job_id).status == "failed"
        assert db.get(BackgroundJob, next_id).status == "queued"
        assert db.get(ImportRecord, import_id).analysis_summary["analysis_task_id"] == str(next_id)
        assert db.query(BackgroundJob).count() == 2
        assert db.query(Conversation).count() == 0


@pytest.mark.parametrize("rollback", [False, True])
def test_source_exclusion_is_atomic_with_cleanup_after_outer_commit(controlled_analysis, rollback):
    from app.models.source_artifact import SourceArtifact
    factory, _, import_id, job_id, root = controlled_analysis
    with factory() as db:
        record = db.get(ImportRecord, import_id)
        record.status, record.session_state, record.phase = "paused", "PAUSED", "paused"
        db.get(BackgroundJob, job_id).status = "cancelled"
        service.add_session_source_stream(db, record, "second.json", BytesIO(
            b'{"metadata":{"powered_by":"ChatGPT Exporter"},"messages":[{"role":"Prompt","say":"Second"}]}'),
            max_file_bytes=1024**2)
        record.file_count = 2
        service._refresh_source_fingerprint(record)
        service.analyze_initial_session(db, record)
        db.commit()
        removed_id = next(item.id for item in record.artifacts if item.filename == "synthetic.json")
        old_draft = root.parent / record.draft_storage_uri
        old_bytes = old_draft.read_bytes()
    with factory() as writer, factory() as reader:
        record = writer.get(ImportRecord, import_id, with_for_update=True)
        with writer.begin_nested():
            service.exclude_session_source(writer, record, writer.get(SourceArtifact, removed_id))
        assert (root / "synthetic.json").is_file()
        assert old_draft.read_bytes() == old_bytes
        assert record.draft_storage_uri != str(old_draft.relative_to(root.parent))
        assert reader.get(SourceArtifact, removed_id) is not None
        assert reader.get(ImportRecord, import_id).file_count == 2
        if rollback:
            writer.rollback()
        else:
            writer.commit()
        reader.expire_all()
        assert (reader.get(SourceArtifact, removed_id) is not None) == rollback
        assert reader.get(ImportRecord, import_id).file_count == (2 if rollback else 1)
        assert (root / "synthetic.json").exists() == rollback
        if rollback:
            assert old_draft.read_bytes() == old_bytes
        else:
            assert not old_draft.exists()
        assert (root / "second.json").is_file()
        assert reader.query(Conversation).count() == 0
