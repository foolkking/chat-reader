"""First-pass imports are persistent worker tasks, not long-running uploads."""
import hashlib
import json
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from io import BytesIO
from types import SimpleNamespace

import pytest
from sqlalchemy import event
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from app.api.routes import adaptive_imports
from app.core.database import get_db
from app.main import app
from app.models.background_job import BackgroundJob
from app.models.import_record import ImportRecord
from app.services.adaptive_import import service
from app.services.background_jobs import claim_next_job, process_background_job, recover_stale_jobs
from app.services.storage.local_storage import save_import_file_stream
from app.services.uploads import UploadLimitError
from test_adaptive_import_api import _complete_analysis
from test_import_preview_api import client as _preview_client

client = _preview_client


@pytest.fixture(autouse=True)
def synthetic_headroom(monkeypatch):
    # This module's kilobyte sources test worker/transaction behavior, not the
    # current desktop's free RAM. Keep admission itself active; rejection tests
    # override this sensor explicitly, as in test_import_draft_streaming.
    monkeypatch.setattr("app.services.uploads.available_memory_bytes", lambda: 16 * 1024**3)


def source() -> bytes:
    return json.dumps({
        "metadata": {"powered_by": "ChatGPT Exporter", "title": "Queued synthetic source"},
        "messages": [{"role": "Prompt", "say": "Synthetic retained source."}],
    }).encode()


def queue(client, *, count=2) -> dict:
    response = client.post("/api/adaptive-import/sessions", files=[
        ("files", (f"source-{index}.json", source(), "application/json"))
        for index in range(count)
    ])
    assert response.status_code == 201, response.text
    result = response.json()
    assert result["state"] == "ANALYZING"
    assert result["phase"] == "queued"
    assert result["families"] == []
    assert result["analysis_task_id"]
    return result


@contextmanager
def database():
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        yield db
    finally:
        db.close()
        generator.close()


def claim(queued: dict):
    with database() as db:
        factory = sessionmaker(bind=db.get_bind(), expire_on_commit=False)
        job_id = claim_next_job(db, job_type="adaptive_import_analysis")
        assert str(job_id) == queued["analysis_task_id"]
        db.commit()
    return job_id, factory


def test_upload_only_stages_and_queues_without_entering_the_analyzer(client, tmp_path, monkeypatch):
    monkeypatch.setattr(service, "analyze_documents", lambda *_: pytest.fail("The HTTP request entered the parser."))
    queued = queue(client)
    assert client.get("/api/conversations").json() == []
    root = tmp_path / "storage" / "imports" / queued["import_id"]
    assert sorted(path.name for path in root.iterdir()) == ["source-0.json", "source-1.json"]
    assert all(path.read_bytes() == source() for path in root.iterdir())
    tasks = client.get("/api/tasks/active").json()
    matching = [task for task in tasks if task["job_id"] == queued["analysis_task_id"]]
    assert len(matching) == 1
    assert matching[0]["job_type"] == "adaptive_import_analysis"
    assert matching[0]["status"] == "queued"
    assert matching[0]["result"]["import_id"] == queued["import_id"]
    premature = client.post(f"/api/imports/{queued['import_id']}/commit")
    assert premature.status_code == 409
    assert premature.json()["detail"]["code"] == "SESSION_STATE_INVALID"


@pytest.mark.parametrize("failure", ["commit_before", "commit_after", "refresh", "response"])
def test_create_failure_after_commit_attempt_preserves_staged_sources(
    client, tmp_path, monkeypatch, caplog, failure,
):
    private_error = "synthetic private admission failure /srv/private-import/source.json"
    original_commit = Session.commit
    original_refresh = Session.refresh

    def commit(db):
        if failure == "commit_before":
            raise SQLAlchemyError(private_error)
        original_commit(db)
        raise SQLAlchemyError(private_error)

    def refresh(db, instance, *args, **kwargs):
        if isinstance(instance, ImportRecord):
            raise SQLAlchemyError(private_error)
        return original_refresh(db, instance, *args, **kwargs)

    def payload(_record):
        raise RuntimeError(private_error)

    with monkeypatch.context() as patch:
        if failure.startswith("commit_"):
            patch.setattr(Session, "commit", commit)
        elif failure == "refresh":
            patch.setattr(Session, "refresh", refresh)
        else:
            patch.setattr(adaptive_imports, "session_payload", payload)
        response = client.post("/api/adaptive-import/sessions", files=[
            ("files", ("source.json", source(), "application/json")),
        ])
    assert response.status_code == 500
    assert response.json()["detail"]["message"] == (
        "Import analysis submission is not confirmed. Check Tasks before uploading again."
    )
    assert private_error not in response.text
    assert private_error not in caplog.text
    root = tmp_path / "storage" / "imports"
    staged = list(root.glob("*/source.json"))
    assert len(staged) == 1, "An uncertain admission must not delete potentially committed job inputs."
    assert staged[0].read_bytes() == source()
    with database() as db:
        records = db.query(ImportRecord).all()
        jobs = db.query(BackgroundJob).filter_by(job_type="adaptive_import_analysis").all()
        assert len(records) == len(jobs) == (0 if failure == "commit_before" else 1)
        if failure == "commit_before":
            return
        import_id, task_id = str(records[0].id), str(jobs[0].id)
    assert client.get(f"/api/tasks/{task_id}").json()["status"] == "queued"
    # The durable Task Center entry still opens and processes its original input.
    queued = client.get(f"/api/adaptive-import/sessions/{import_id}").json()
    assert _complete_analysis(client, queued)["state"] == "READY"


def test_create_failure_before_commit_attempt_removes_only_its_partial_staging(client, tmp_path, monkeypatch):
    original_add = adaptive_imports.add_session_source_stream

    def fail_after_staging(*args, **kwargs):
        original_add(*args, **kwargs)
        raise RuntimeError("synthetic staging failure")

    monkeypatch.setattr(adaptive_imports, "add_session_source_stream", fail_after_staging)
    response = client.post("/api/adaptive-import/sessions", files=[
        ("files", ("source.json", source(), "application/json")),
    ])
    assert response.status_code == 500
    assert list((tmp_path / "storage" / "imports").iterdir()) == []
    with database() as db:
        assert db.query(ImportRecord).count() == 0
        assert db.query(BackgroundJob).count() == 0


def test_worker_publishes_analysis_result_without_importing_canonical_content(client):
    queued = queue(client)
    result = _complete_analysis(client, queued)
    assert result["state"] == "READY"
    assert result["conversation_count"] == 2
    assert result["analysis_task_id"] == queued["analysis_task_id"]
    assert client.get("/api/conversations").json() == []
    task = client.get(f"/api/tasks/{queued['analysis_task_id']}").json()
    assert task["status"] == "committed"
    assert task["progress"] == 100
    assert task["result"]["state"] == "READY"
    assert task["result"]["conversation_count"] == 2


def test_memory_rejection_retains_sources_and_explicit_retry_reuses_the_task(client, tmp_path, monkeypatch):
    queued = queue(client)
    job_id, factory = claim(queued)

    @contextmanager
    def rejected(_sizes, **_options):
        raise UploadLimitError("UPLOAD_MEMORY_PRESSURE", "Insufficient memory headroom.", status_code=429)
        yield

    with monkeypatch.context() as patched:
        patched.setattr("app.services.uploads.bounded_analysis_admission_sync", rejected)
        process_background_job(job_id, session_factory=factory)
    failed = client.get(f"/api/tasks/{job_id}").json()
    assert failed["status"] == "failed"
    stored = client.get(f"/api/adaptive-import/sessions/{queued['import_id']}").json()
    assert stored["state"] == "FAILED"
    task_rows = client.get("/api/tasks/active").json()
    assert [task["job_id"] for task in task_rows] == [str(job_id)]
    root = tmp_path / "storage" / "imports" / queued["import_id"]
    assert all(path.read_bytes() == source() for path in root.iterdir())

    retried = client.post(f"/api/tasks/{job_id}/retry")
    assert retried.status_code == 200
    assert retried.json()["job_id"] == str(job_id)
    repeated = client.post(f"/api/tasks/{job_id}/retry")
    assert repeated.status_code == 200
    assert repeated.json()["job_id"] == str(job_id)
    current = client.get(f"/api/adaptive-import/sessions/{queued['import_id']}").json()
    assert current["state"] == "ANALYZING"
    assert current["error_message"] is None
    result = _complete_analysis(client, current)
    assert result["state"] == "READY"
    assert result["group_count"] == 2
    with database() as db:
        assert db.query(BackgroundJob).filter_by(job_type="adaptive_import_analysis").count() == 1


@pytest.mark.parametrize("available", [0, 64 * 1024 * 1024, None])
def test_even_small_queued_analysis_does_not_start_under_low_host_headroom(client, tmp_path, monkeypatch, available):
    monkeypatch.setattr("app.services.uploads.available_memory_bytes", lambda: available)
    # Uploading only stages bounded chunks; it need not reserve a parser heap.
    queued = queue(client)
    monkeypatch.setattr(service, "analyze_initial_session", lambda *_args, **_kwargs: pytest.fail("Low-memory parsing started."))
    job_id, factory = claim(queued)
    process_background_job(job_id, session_factory=factory)
    task = client.get(f"/api/tasks/{job_id}").json()
    assert task["status"] == "failed"
    assert "memory headroom" in task["error_message"]
    assert (tmp_path / "storage" / "imports" / queued["import_id"] / "source-0.json").read_bytes() == source()
    stored = client.get(f"/api/adaptive-import/sessions/{queued['import_id']}").json()
    assert stored["state"] == "FAILED"
    assert stored["phase"] == "analysis_failed"


@pytest.mark.parametrize("error_type", [RuntimeError, ValueError, SQLAlchemyError])
def test_unexpected_analysis_failure_is_safe_in_tasks_and_session(
    client, tmp_path, monkeypatch, caplog, error_type,
):
    queued = queue(client, count=1)
    private_error = "synthetic private source /srv/private-source.json and database credentials"
    job_id, factory = claim(queued)

    def fail_analysis(*_args, **_kwargs):
        raise error_type(private_error)

    monkeypatch.setattr(service, "analyze_initial_session", fail_analysis)
    process_background_job(job_id, session_factory=factory)
    task = client.get(f"/api/tasks/{job_id}").json()
    active = client.get("/api/tasks/active").json()
    stored = client.get(f"/api/adaptive-import/sessions/{queued['import_id']}").json()
    assert task["status"] == "failed"
    assert stored["state"] == "FAILED"
    assert task["error_message"] == stored["error_message"] == "TASK_FAILED"
    assert private_error not in json.dumps([task, active, stored])
    assert private_error not in caplog.text
    assert (tmp_path / "storage" / "imports" / queued["import_id"] / "source-0.json").read_bytes() == source()
    failed_events = [
        json.loads(record.message) for record in caplog.records
        if "background_job_failed" in record.message
    ]
    assert failed_events[-1]["error_class"] == error_type.__name__


@pytest.mark.parametrize("via_tasks", [False, True])
def test_queued_cancel_stops_work_and_removes_only_its_staged_sources(client, tmp_path, via_tasks):
    queued = queue(client)
    path = tmp_path / "storage" / "imports" / queued["import_id"]
    response = (
        client.post(f"/api/tasks/{queued['analysis_task_id']}/cancel")
        if via_tasks else client.delete(f"/api/adaptive-import/sessions/{queued['import_id']}")
    )
    assert response.status_code == (200 if via_tasks else 204), response.text
    assert client.get(f"/api/tasks/{queued['analysis_task_id']}").json()["status"] == "cancelled"
    assert client.get(f"/api/adaptive-import/sessions/{queued['import_id']}").json()["state"] == "CANCELED"
    assert not path.exists()
    with database() as db:
        assert claim_next_job(db, job_type="adaptive_import_analysis") is None


@pytest.mark.parametrize("via_tasks", [False, True])
def test_cancel_commit_failure_preserves_staged_sources(client, tmp_path, monkeypatch, via_tasks):
    queued = queue(client)
    path = tmp_path / "storage" / "imports" / queued["import_id"]
    original_files = {item.name: item.read_bytes() for item in path.iterdir()}

    def fail_commit(_db):
        raise RuntimeError("synthetic cancellation commit failure")

    with monkeypatch.context() as patch:
        patch.setattr(Session, "commit", fail_commit)
        response = (
            client.post(f"/api/tasks/{queued['analysis_task_id']}/cancel")
            if via_tasks else client.delete(f"/api/adaptive-import/sessions/{queued['import_id']}")
        )
    assert response.status_code == 500
    assert path.is_dir(), "A failed cancellation transaction must retain its original sources."
    assert {item.name: item.read_bytes() for item in path.iterdir()} == original_files
    assert client.get(f"/api/adaptive-import/sessions/{queued['import_id']}").json()["state"] == "ANALYZING"
    assert client.get(f"/api/tasks/{queued['analysis_task_id']}").json()["status"] == "queued"


@pytest.mark.parametrize("outcome", ["commit", "rollback", "close"])
def test_cancel_session_cleans_sources_only_after_outer_commit(client, tmp_path, outcome):
    queued = queue(client, count=1)
    path = tmp_path / "storage" / "imports" / queued["import_id"]
    with database() as db:
        record = db.get(ImportRecord, uuid.UUID(queued["import_id"]))
        service.cancel_session(record)
        assert path.is_dir(), "Scheduling a cancellation must not delete before the transaction outcome."
        getattr(db, outcome)()
        assert path.exists() is (outcome != "commit")
        # An abandoned/rolled-back cleanup must not fire on a later transaction.
        db.commit()
        assert path.exists() is (outcome != "commit")


@pytest.mark.parametrize("nested_commit,outer_commit", [(False, True), (True, False), (True, True)])
def test_cancel_session_cleanup_follows_nested_transaction_outcomes(
    client, tmp_path, nested_commit, outer_commit,
):
    queued = queue(client, count=1)
    path = tmp_path / "storage" / "imports" / queued["import_id"]
    with database() as db:
        record = db.get(ImportRecord, uuid.UUID(queued["import_id"]))
        nested = db.begin_nested()
        service.cancel_session(record)
        if nested_commit:
            nested.commit()
        else:
            nested.rollback()
        assert path.is_dir(), "A savepoint cannot authorize deleting sources before outer commit."
        if outer_commit:
            db.commit()
        else:
            db.rollback()
        assert path.exists() is not (nested_commit and outer_commit)


def test_cancel_cleanup_uses_the_storage_root_captured_when_scheduled(client, tmp_path, monkeypatch):
    queued = queue(client, count=1)
    original = tmp_path / "storage" / "imports" / queued["import_id"]
    other_root = tmp_path / "other-imports"
    other_source = other_root / queued["import_id"] / "source-0.json"
    other_source.parent.mkdir(parents=True)
    other_source.write_bytes(b"unrelated synthetic source")
    with database() as db:
        record = db.get(ImportRecord, uuid.UUID(queued["import_id"]))
        service.cancel_session(record)
        monkeypatch.setattr(service, "get_settings", lambda: SimpleNamespace(import_storage_dir=other_root))
        db.commit()
    assert not original.exists()
    assert other_source.read_bytes() == b"unrelated synthetic source"


@pytest.mark.parametrize("via_tasks", [False, True])
def test_cancel_cleanup_failure_retains_sources_without_failing_committed_cancel(
    client, tmp_path, monkeypatch, caplog, via_tasks,
):
    queued = queue(client, count=1)
    path = tmp_path / "storage" / "imports" / queued["import_id"]
    private_error = "synthetic private source /srv/private-import/source.json"

    def fail_cleanup(_path):
        raise PermissionError(private_error)

    with monkeypatch.context() as patch:
        patch.setattr(service.shutil, "rmtree", fail_cleanup)
        response = (
            client.post(f"/api/tasks/{queued['analysis_task_id']}/cancel")
            if via_tasks else client.delete(f"/api/adaptive-import/sessions/{queued['import_id']}")
        )
    assert response.status_code == (200 if via_tasks else 204), response.text
    assert client.get(f"/api/adaptive-import/sessions/{queued['import_id']}").json()["state"] == "CANCELED"
    assert client.get(f"/api/tasks/{queued['analysis_task_id']}").json()["status"] == "cancelled"
    assert (path / "source-0.json").read_bytes() == source()
    events = [
        json.loads(record.message) for record in caplog.records
        if "adaptive_import_cancel_cleanup_failed" in record.message
    ]
    assert len(events) == 1
    assert events[0]["error_class"] == "PermissionError"
    assert private_error not in response.text
    assert private_error not in caplog.text


@pytest.mark.parametrize("via_tasks", [False, True])
def test_processing_cancel_only_updates_the_job_until_worker_acknowledges(client, tmp_path, via_tasks):
    queued = queue(client)
    job_id, factory = claim(queued)
    updates = []
    engine = factory.kw["bind"]

    def record_sql(_connection, _cursor, statement, _parameters, _context, _executemany):
        if statement.lstrip().upper().startswith("UPDATE"):
            updates.append(statement)

    event.listen(engine, "before_cursor_execute", record_sql)
    try:
        response = (
            client.post(f"/api/tasks/{job_id}/cancel")
            if via_tasks else client.delete(f"/api/adaptive-import/sessions/{queued['import_id']}")
        )
    finally:
        event.remove(engine, "before_cursor_execute", record_sql)
    assert response.status_code == (200 if via_tasks else 204), response.text
    assert not any("UPDATE imports" in statement for statement in updates)
    path = tmp_path / "storage" / "imports" / queued["import_id"]
    assert path.exists(), "Cancellation must not remove files a running parser may still be reading."
    assert client.get(f"/api/adaptive-import/sessions/{queued['import_id']}").json()["state"] == "CANCELING"
    process_background_job(job_id, session_factory=factory)
    assert client.get(f"/api/tasks/{job_id}").json()["status"] == "cancelled"
    assert client.get(f"/api/adaptive-import/sessions/{queued['import_id']}").json()["state"] == "CANCELED"
    assert not path.exists()


def test_stale_recovery_requeues_analysis_and_exhaustion_does_not_leave_analyzing_forever(client):
    queued = queue(client)
    job_id, factory = claim(queued)
    with factory() as db:
        job = db.get(BackgroundJob, job_id)
        job.heartbeat_at = datetime.now(timezone.utc) - timedelta(hours=1)
        db.commit()
        recover_stale_jobs(db, 60)
        db.commit()
        assert db.get(BackgroundJob, job_id).status == "queued"
        job = db.get(BackgroundJob, job_id)
        job.status = "processing"
        job.attempt_count = 100
        job.heartbeat_at = datetime.now(timezone.utc) - timedelta(hours=1)
        db.commit()
        recover_stale_jobs(db, 60)
        db.commit()
        assert db.get(BackgroundJob, job_id).status == "failed"
        record = db.get(ImportRecord, uuid.UUID(queued["import_id"]))
        assert record.session_state == "FAILED"


def test_analysis_uses_the_existing_fifo_lane_and_noise_waits_behind_import_work(client):
    from app.services.task_worker import _oldest_task_kind

    queued = queue(client)
    with database() as db:
        job = db.get(BackgroundJob, uuid.UUID(queued["analysis_task_id"]))
        now = datetime.now(timezone.utc)
        job.queued_at = now - timedelta(minutes=2)
        noise = BackgroundJob(job_type="content_noise_scan", status="queued", queued_at=now - timedelta(minutes=3))
        native = ImportRecord(source_profile="synthetic", source_fingerprint="synthetic-native", status="queued",
                              queued_at=now - timedelta(minutes=1))
        db.add_all([noise, native])
        db.commit()
        noise_id, native_id = noise.id, native.id
        assert _oldest_task_kind(db) == "job"
        assert claim_next_job(db) == job.id
        db.commit()
        factory = sessionmaker(bind=db.get_bind())
        job_id = job.id
    process_background_job(job_id, session_factory=factory)
    with database() as db:
        assert db.get(BackgroundJob, job_id).status == "committed"
        assert db.get(BackgroundJob, noise_id).status == "queued"
        assert db.get(ImportRecord, native_id).status == "queued"
        assert _oldest_task_kind(db) == "import"
        db.get(ImportRecord, native_id).status = "committed"
        db.flush()
        assert _oldest_task_kind(db) == "noise"


@pytest.mark.parametrize("status", ["queued", "processing"])
def test_analysis_cancel_cannot_remove_sources_after_canonical_import_started(client, tmp_path, status):
    queued = queue(client)
    ready = _complete_analysis(client, queued)
    with database() as db:
        record = db.get(ImportRecord, uuid.UUID(ready["import_id"]))
        record.status = status
        record.session_state = "READY" if status == "queued" else "IMPORTING"
        db.commit()
    response = client.delete(f"/api/adaptive-import/sessions/{ready['import_id']}")
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "SESSION_STATE_INVALID"
    assert (tmp_path / "storage" / "imports" / ready["import_id"]).is_dir()


def test_stream_staging_never_requests_unbounded_reads_and_removes_partial_files(tmp_path, monkeypatch):
    monkeypatch.setenv("IMPORT_STORAGE_DIR", str(tmp_path))
    from app.core.config import get_settings

    get_settings.cache_clear()
    data = b"synthetic bytes" * 100_000

    class BoundedReader(BytesIO):
        def read(self, size=-1):
            assert 0 < size <= 1024 * 1024
            return super().read(size)

    identity = uuid.uuid4()
    try:
        stored, digest = save_import_file_stream(identity, "../source.json", BoundedReader(data), max_bytes=len(data))
        assert stored.byte_size == len(data)
        assert digest == hashlib.sha256(data).hexdigest()
        assert (tmp_path / str(identity) / stored.safe_filename).read_bytes() == data
        with pytest.raises(ValueError):
            save_import_file_stream(identity, "too-large.json", BoundedReader(data), max_bytes=10)
        assert sorted(path.name for path in (tmp_path / str(identity)).iterdir()) == ["source.json"]
    finally:
        get_settings.cache_clear()
