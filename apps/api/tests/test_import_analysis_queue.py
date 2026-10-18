"""First-pass imports are persistent worker tasks, not long-running uploads."""
import hashlib
import json
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from io import BytesIO

import pytest
from sqlalchemy import event
from sqlalchemy.orm import sessionmaker

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


def test_even_small_queued_analysis_does_not_start_under_low_host_headroom(client, tmp_path, monkeypatch):
    monkeypatch.setattr("app.services.uploads.available_memory_bytes", lambda: 64 * 1024 * 1024)
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
