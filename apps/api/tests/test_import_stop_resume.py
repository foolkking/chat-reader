"""Stopping is not disposal; a retained session needs an explicit owned resume."""
import uuid

import pytest

from app.models.background_job import BackgroundJob
from app.models.import_record import ImportRecord
from app.services.background_jobs import process_background_job
from test_adaptive_import_api import _complete_analysis
from test_import_analysis_queue import claim, database, queue, source
from test_import_preview_api import client  # noqa: F401


@pytest.mark.parametrize("started", [False, True])
def test_retained_stop_preserves_sources_and_only_resumes_explicitly(client, tmp_path, started):
    queued = queue(client)
    job_id, factory = claim(queued) if started else (None, None)
    response = client.post(f"/api/tasks/{queued['analysis_task_id']}/cancel",
                           json={"source_disposition": "retain"})
    assert response.status_code == 200, response.text
    assert response.json()["status"] == ("cancelling" if started else "cancelled")
    root = tmp_path / "storage" / "imports" / queued["import_id"]
    assert (root / "source-0.json").read_bytes() == source()
    if started:
        pending = client.get(f"/api/adaptive-import/sessions/{queued['import_id']}").json()
        assert pending["state"] == "CANCELING"
        process_background_job(job_id, session_factory=factory)
    stopped = client.get(f"/api/adaptive-import/sessions/{queued['import_id']}").json()
    assert stopped["state"] == "PAUSED"
    assert stopped["source_status"] == "available"
    assert stopped["can_import"] is False
    assert "resume" in stopped["allowed_actions"]
    assert any(item["import_id"] == queued["import_id"]
               for item in client.get("/api/adaptive-import/sessions").json()["items"])
    assert client.get("/api/conversations").json() == []
    with database() as db:
        assert db.get(BackgroundJob, uuid.UUID(queued["analysis_task_id"])).status == "cancelled"
    resumed = client.post(f"/api/adaptive-import/sessions/{queued['import_id']}/resume",
                          json={"expected_updated_at": stopped["updated_at"]})
    assert resumed.status_code == 202, resumed.text
    next_session = resumed.json()
    assert next_session["analysis_task_id"] != queued["analysis_task_id"]
    completed = _complete_analysis(client, next_session)
    assert completed["state"] == "READY", completed
    assert (root / "source-0.json").read_bytes() == source()
    assert client.get("/api/conversations").json() == []


def test_stopping_cannot_silently_switch_from_retention_to_disposal(client, tmp_path):
    queued = queue(client)
    job_id, factory = claim(queued)
    endpoint = f"/api/tasks/{job_id}/cancel"
    assert client.post(endpoint, json={"source_disposition": "retain"}).status_code == 200
    repeated = client.post(endpoint, json={"source_disposition": "retain"})
    assert repeated.status_code == 200
    changed = client.post(endpoint, json={"source_disposition": "discard"})
    assert changed.status_code == 409, changed.text
    process_background_job(job_id, session_factory=factory)
    assert (tmp_path / "storage" / "imports" / queued["import_id"]).is_dir()
    stopped = client.get(f"/api/adaptive-import/sessions/{queued['import_id']}").json()
    assert stopped["state"] == "PAUSED"
    # Disposal is a different explicit session operation after acknowledgement.
    assert client.delete(f"/api/adaptive-import/sessions/{queued['import_id']}").status_code == 204
    assert not (tmp_path / "storage" / "imports" / queued["import_id"]).exists()


def test_resume_rejects_stale_version_without_duplicating_analysis(client):
    queued = queue(client)
    assert client.post(f"/api/tasks/{queued['analysis_task_id']}/cancel",
                       json={"source_disposition": "retain"}).status_code == 200
    stopped = client.get(f"/api/adaptive-import/sessions/{queued['import_id']}").json()
    url = f"/api/adaptive-import/sessions/{queued['import_id']}/resume"
    first = client.post(url, json={"expected_updated_at": stopped["updated_at"]})
    assert first.status_code == 202, first.text
    repeated = client.post(url, json={"expected_updated_at": stopped["updated_at"]})
    assert repeated.status_code == 409, repeated.text
    with database() as db:
        assert db.query(BackgroundJob).filter(BackgroundJob.job_type == "adaptive_import_analysis").count() == 2


def test_resume_missing_retained_source_does_not_queue_work(client, tmp_path):
    queued = queue(client)
    assert client.post(f"/api/tasks/{queued['analysis_task_id']}/cancel",
                       json={"source_disposition": "retain"}).status_code == 200
    stopped = client.get(f"/api/adaptive-import/sessions/{queued['import_id']}").json()
    (tmp_path / "storage" / "imports" / queued["import_id"] / "source-0.json").unlink()
    response = client.post(f"/api/adaptive-import/sessions/{queued['import_id']}/resume",
                           json={"expected_updated_at": stopped["updated_at"]})
    assert response.status_code == 409, response.text
    with database() as db:
        assert db.get(ImportRecord, uuid.UUID(queued["import_id"])).session_state == "PAUSED"
        assert db.query(BackgroundJob).filter(BackgroundJob.job_type == "adaptive_import_analysis").count() == 1


def test_legacy_cancel_still_discards_sources(client, tmp_path):
    queued = queue(client)
    response = client.post(f"/api/tasks/{queued['analysis_task_id']}/cancel")
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "cancelled"
    assert not (tmp_path / "storage" / "imports" / queued["import_id"]).exists()
