from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.database import get_db
from app.main import app
from app.models.background_job import BackgroundJob
from app.models.import_record import ImportRecord
from test_import_preview_api import client  # noqa: F401


def test_active_tasks_include_only_terminal_results_inside_the_retention_window(
    client: TestClient,
    monkeypatch,
) -> None:
    monkeypatch.setenv("TASK_TERMINAL_RESULT_RETENTION_SECONDS", "600")
    get_settings.cache_clear()
    now = datetime.now(timezone.utc)
    override = app.dependency_overrides[get_db]
    generator = override()
    db = next(generator)
    try:
        active = BackgroundJob(
            job_type="conversation_export",
            status="processing",
            phase="exporting",
            queued_at=now - timedelta(minutes=20),
            started_at=now - timedelta(minutes=19),
        )
        recent_job = BackgroundJob(
            job_type="conversation_merge",
            status="committed",
            phase="committed",
            completed_at=now - timedelta(minutes=2),
            result={"conversation_id": "recent-result"},
        )
        expired_job = BackgroundJob(
            job_type="conversation_merge",
            status="committed",
            phase="committed",
            completed_at=now - timedelta(minutes=11),
        )
        recent_import = ImportRecord(
            source_profile="fixture",
            source_fingerprint="recent",
            status="failed",
            phase="failed",
            completed_at=now - timedelta(minutes=3),
        )
        expired_import = ImportRecord(
            source_profile="fixture",
            source_fingerprint="expired",
            status="failed",
            phase="failed",
            completed_at=now - timedelta(minutes=12),
        )
        db.add_all((active, recent_job, expired_job, recent_import, expired_import))
        db.commit()
        expected_ids = {str(active.id), str(recent_job.id), str(recent_import.id)}
        excluded_ids = {str(expired_job.id), str(expired_import.id)}
    finally:
        db.close()
        generator.close()

    response = client.get("/api/tasks/active")

    assert response.status_code == 200
    payload = response.json()
    returned_ids = {item["job_id"] for item in payload}
    assert returned_ids == expected_ids
    assert returned_ids.isdisjoint(excluded_ids)
    assert payload[0]["status"] == "processing"


@pytest.mark.parametrize("job_type", [
    "conversation_auto_clean",
    "conversation_merge",
    "conversation_export",
    "conversation_batch_delete",
])
def test_failed_background_task_retry_is_idempotent_across_task_types(
    client: TestClient,
    job_type: str,
) -> None:
    override = app.dependency_overrides[get_db]
    generator = override()
    db = next(generator)
    try:
        job = BackgroundJob(
            job_type=job_type,
            status="failed",
            phase="failed",
            attempt_count=2,
            error_message="retryable failure",
        )
        db.add(job)
        db.commit()
        job_id = str(job.id)
    finally:
        db.close()
        generator.close()

    first = client.post(f"/api/tasks/{job_id}/retry")
    assert first.status_code == 200
    first_payload = first.json()
    assert first_payload["status"] == "queued"
    assert first_payload["phase"] == "queued"
    assert first_payload["attempt_count"] == 0
    queued_at = first_payload["queued_at"]

    second = client.post(f"/api/tasks/{job_id}/retry")
    assert second.status_code == 200
    second_payload = second.json()
    assert second_payload["status"] == "queued"
    assert second_payload["queued_at"] == queued_at
    assert second_payload["attempt_count"] == 0


def test_failed_import_retry_is_idempotent(client: TestClient) -> None:
    override = app.dependency_overrides[get_db]
    generator = override()
    db = next(generator)
    try:
        record = ImportRecord(
            source_profile="fixture",
            source_fingerprint="retryable-import",
            status="failed",
            phase="failed",
            attempt_count=2,
        )
        db.add(record)
        db.commit()
        import_id = str(record.id)
    finally:
        db.close()
        generator.close()

    first = client.post(f"/api/tasks/{import_id}/retry")
    assert first.status_code == 200
    first_payload = first.json()
    assert first_payload["status"] == "queued"
    assert first_payload["phase"] == "queued"
    assert first_payload["attempt_count"] == 0
    queued_at = first_payload["queued_at"]

    second = client.post(f"/api/tasks/{import_id}/retry")
    assert second.status_code == 200
    second_payload = second.json()
    assert second_payload["status"] == "queued"
    assert second_payload["queued_at"] == queued_at
    assert second_payload["attempt_count"] == 0
