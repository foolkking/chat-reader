import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Query, Session

from app.api.routes import tasks as task_routes
from app.core.config import get_settings
from app.core.database import get_db
from app.main import app
from app.models.background_job import BackgroundJob
from app.models.import_record import ImportRecord
from app.services.assets.derivatives import AssetDerivativeError
from app.services.assets.scanner import AssetScanError
from app.services.background_jobs import _safe_error
from app.services.exporting.attachment_download import AttachmentDownloadError
from test_import_preview_api import client  # noqa: F401


@pytest.mark.parametrize("error", [
    AssetDerivativeError("Unsupported attachment derivative type."),
    AssetDerivativeError("Attachment object is not available for derivative generation."),
    AssetDerivativeError("Text extraction is not supported for this MIME type."),
    AssetDerivativeError("Image source exceeds the 50 MiB derivative limit."),
    AssetDerivativeError("Image derivatives are not supported for this MIME type."),
    AssetDerivativeError("Decoded image exceeds the derivative resource limit."),
    AssetDerivativeError("Image derivative generation exceeded its deadline."),
    AssetDerivativeError("Image derivative generation failed."),
    AssetScanError("Attachment scanner is unavailable."),
    AssetScanError("Attachment scanner returned an invalid response."),
    AssetScanError("Remote scanner URL is not configured."),
    AssetScanError("Remote attachment scanner is unavailable."),
    AssetScanError("Remote attachment scanner returned an invalid response."),
    AttachmentDownloadError("Select 1-500 distinct attachments."),
    AttachmentDownloadError("Conversation not found."),
    AttachmentDownloadError("One or more attachments are unavailable or outside this conversation."),
    AttachmentDownloadError("Selected attachments exceed the 2 GiB batch limit."),
    AttachmentDownloadError("An attachment object is missing."),
    AttachmentDownloadError("Invalid export path."),
])
def test_authored_attachment_error_survives_writer_and_task_api_projection(client, error):
    # Review these fixed messages explicitly. Do not authorize arbitrary text
    # merely because it came from a domain exception or an error-shaped prefix.
    message = str(error)
    persisted = _safe_error(error)
    assert persisted == message
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        job = BackgroundJob(
            job_type="attachment_derivative" if isinstance(error, AssetDerivativeError) else "attachment_batch_download",
            status="failed",
            phase="failed",
            error_message=persisted,
            completed_at=datetime.now(timezone.utc),
        )
        db.add(job)
        db.commit()
        job_id = str(job.id)
    finally:
        db.close()
        generator.close()

    detail = client.get(f"/api/tasks/{job_id}")
    assert detail.status_code == 200
    assert detail.json()["error_message"] == message
    listing = client.get("/api/tasks/active")
    assert listing.status_code == 200
    task = next(item for item in listing.json() if item["job_id"] == job_id)
    assert task["error_message"] == message


@pytest.mark.parametrize("failure_phase", ["request", "commit"])
def test_unexpected_cancellation_failure_rolls_back_and_returns_safe_500(
    client, monkeypatch, caplog, failure_phase,
):
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        job = BackgroundJob(job_type="conversation_batch_delete", status="queued", phase="queued")
        db.add(job)
        db.commit()
        job_id = str(job.id)
    finally:
        db.close()
        generator.close()

    private_error = "synthetic-private-database-detail"
    if failure_phase == "request":
        def fail_request(job):
            job.status = "cancelled"
            raise RuntimeError(private_error)

        monkeypatch.setattr(task_routes, "request_background_job_cancellation", fail_request)
    else:
        def fail_commit(_db):
            raise RuntimeError(private_error)

        monkeypatch.setattr(Session, "commit", fail_commit)

    response = client.post(f"/api/tasks/{job_id}/cancel")
    assert response.status_code == 500, response.text
    assert response.json()["detail"] == "Internal server error."
    assert response.json()["request_id"] == response.headers["X-Request-ID"]
    assert private_error not in response.text
    assert private_error not in caplog.text

    retained = client.get(f"/api/tasks/{job_id}")
    assert retained.status_code == 200
    assert retained.json()["status"] == "queued"


@pytest.mark.parametrize("kind", ["job", "import", "pending_cleanup"])
def test_task_finishing_between_active_and_terminal_reads_is_returned_once(client, monkeypatch, kind):
    model = ImportRecord if kind == "import" else BackgroundJob
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        row = (ImportRecord(source_profile="fixture", source_fingerprint="synthetic-transition", status="processing")
               if kind == "import" else BackgroundJob(
                   job_type="user_account_delete" if kind == "pending_cleanup" else "conversation_merge",
                   status="processing", phase="processing"))
        db.add(row)
        db.commit()
        identity = row.id
    finally:
        db.close()
        generator.close()

    original = Query.all
    moved = False

    def finish_after_active_read(query):
        nonlocal moved
        rows = original(query)
        if not moved and any(isinstance(item, model) and item.id == identity for item in rows):
            moved = True
            # A real independent commit in the gap between the endpoint's
            # bounded queries, not a fabricated duplicate response.
            with Session(query.session.get_bind()) as writer:
                finished = writer.get(model, identity)
                finished.status = "committed" if kind == "pending_cleanup" else "failed"
                finished.completed_at = datetime.now(timezone.utc)
                if kind == "pending_cleanup":
                    finished.result = {"account_deleted": True, "asset_cleanup_pending": 1}
                writer.commit()
        return rows

    monkeypatch.setattr(Query, "all", finish_after_active_read)
    response = client.get("/api/tasks/active")
    assert response.status_code == 200
    assert moved
    assert [item["job_id"] for item in response.json()].count(str(identity)) == 1
    # The next read sees the terminal row too, still as a single task.
    following = client.get("/api/tasks/active")
    matching = [item for item in following.json() if item["job_id"] == str(identity)]
    assert len(matching) == 1
    assert matching[0]["status"] == ("committed" if kind == "pending_cleanup" else "failed")


def test_legacy_persisted_task_errors_are_sanitized_without_rewriting_rows(client):
    private_error = "SELECT secret FROM /srv/private/customer.sqlite"
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        job = BackgroundJob(
            job_type="conversation_merge",
            status="failed",
            phase="failed",
            error_message=private_error,
            completed_at=datetime.now(timezone.utc),
        )
        record = ImportRecord(
            source_profile="adaptive_json_markdown",
            source_fingerprint="legacy-error-projection",
            status="failed",
            phase="failed",
            error_message=private_error,
            completed_at=datetime.now(timezone.utc),
        )
        db.add_all([job, record])
        db.commit()
        job_id, import_id = str(job.id), str(record.id)
    finally:
        db.close()
        generator.close()

    task_response = client.get(f"/api/tasks/{job_id}")
    import_task_response = client.get(f"/api/tasks/{import_id}")
    import_status_response = client.get(f"/api/imports/{import_id}/status")
    session_response = client.get(f"/api/adaptive-import/sessions/{import_id}")
    active_response = client.get("/api/tasks/active")

    assert task_response.status_code == 200
    assert task_response.json()["error_message"] == "TASK_FAILED"
    assert import_task_response.status_code == 200
    assert import_task_response.json()["error_message"] == "IMPORT_FAILED"
    assert import_status_response.status_code == 200
    assert import_status_response.json()["error_message"] == "IMPORT_FAILED"
    assert session_response.status_code == 200
    assert session_response.json()["error_message"] == "IMPORT_FAILED"
    assert active_response.status_code == 200
    projected = {item["job_id"]: item for item in active_response.json()}
    assert projected[job_id]["error_message"] == "TASK_FAILED"
    assert projected[import_id]["error_message"] == "IMPORT_FAILED"
    assert private_error not in "".join(
        response.text for response in (
            task_response, import_task_response, import_status_response, session_response, active_response,
        )
    )

    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        assert db.get(BackgroundJob, uuid.UUID(job_id)).error_message == private_error
        assert db.get(ImportRecord, uuid.UUID(import_id)).error_message == private_error
    finally:
        db.close()
        generator.close()


@pytest.mark.parametrize("job_type,error,expected", [
    ("adaptive_import_analysis", "UPLOAD_MEMORY_PRESSURE", "UPLOAD_MEMORY_PRESSURE"),
    ("offline_package", "OFFLINE_ASSET_INTEGRITY", "OFFLINE_ASSET_INTEGRITY"),
    ("conversation_batch_export", "BATCH_EXPORT_LIMIT", "BATCH_EXPORT_LIMIT"),
    ("context_package_export", "CONTEXT_EXPORT_SOURCE_CHANGED", "CONTEXT_EXPORT_SOURCE_CHANGED"),
    ("personal_archive_restore", "The uploaded archive has expired. Upload it again.",
     "The uploaded archive has expired. Upload it again."),
    ("system_archive_preflight", "synthetic-private-details",
     "Archive operation failed. Your current data was preserved; retry the task or upload the archive again."),
])
def test_task_error_projection_preserves_recovery_categories(client, job_type, error, expected):
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        job = BackgroundJob(
            job_type=job_type,
            status="failed",
            phase="analysis_failed",
            error_message=error,
        )
        db.add(job)
        db.commit()
        job_id = str(job.id)
    finally:
        db.close()
        generator.close()

    response = client.get(f"/api/tasks/{job_id}")

    assert response.status_code == 200
    assert response.json()["error_message"] == expected


def test_legacy_batch_item_errors_and_scan_job_errors_are_safe_read_projections(client):
    from app.api.routes.content_cleanup import _scan_read
    from app.models.content_cleanup import ContentCleanupScan

    private_error = "synthetic-private-sql-or-path"
    failed_id = str(uuid.uuid4())
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        batch = BackgroundJob(
            job_type="conversation_batch_delete", status="failed", phase="failed",
            result={"failed": [{"id": failed_id, "error": private_error}], "deleted_ids": []},
        )
        scan_job = BackgroundJob(
            job_type="content_noise_scan", status="failed", phase="failed", error_message=private_error,
        )
        db.add_all([batch, scan_job])
        db.flush()
        scan = ContentCleanupScan(
            source="manual", status="FAILED", scope_type="all", background_job_id=scan_job.id,
        )
        db.add(scan)
        db.flush()
        scan_job.payload = {"scan_id": str(scan.id)}
        db.commit()
        batch_id = batch.id
        assert _scan_read(db, scan).error_message == "TASK_FAILED"
        assert scan_job.error_message == private_error
    finally:
        db.close()
        generator.close()

    response = client.get(f"/api/tasks/{batch_id}")
    assert response.status_code == 200
    assert response.json()["result"]["failed"] == [{"id": failed_id, "error": "CONVERSATION_DELETE_FAILED"}]
    assert private_error not in response.text

    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        assert db.get(BackgroundJob, batch_id).result["failed"][0]["error"] == private_error
    finally:
        db.close()
        generator.close()


@pytest.mark.parametrize("job_type,export_format,expected", [
    ("conversation_export", "markdown_bundle", "markdown_bundle"),
    ("conversation_export", "canjson_bundle", "canjson_bundle"),
    ("conversation_export", "context_package", "context_package"),
    ("conversation_export", "cr_v2", "cr_v2"),
    ("conversation_export", None, "cr_v2"),
    ("conversation_export", "unknown-private-value", None),
    ("conversation_batch_export", None, "canjson_batch"),
    ("attachment_batch_download", None, "attachments_zip"),
    ("personal_archive_export", None, "cr_v2"),
    ("conversation_merge", None, None),
])
def test_task_identity_survives_reload_and_retry_without_exposing_payload(
    client: TestClient, job_type: str, export_format: str | None, expected: str | None,
) -> None:
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        payload = {"title": "Synthetic source", "private_path": "/private/synthetic-object"}
        if export_format is not None:
            payload["export_format"] = export_format
        job = BackgroundJob(job_type=job_type, status="failed", phase="failed", payload=payload)
        db.add(job)
        db.commit()
        identity = str(job.id)
    finally:
        db.close()
        generator.close()
    for response in [client.get(f"/api/tasks/{identity}"), client.post(f"/api/tasks/{identity}/retry"),
                     client.get(f"/api/tasks/{identity}")]:
        assert response.status_code == 200
        data = response.json()
        assert data["source_label"] == "Synthetic source"
        assert data["export_format"] == expected
        assert data["queued_at"]
        assert "private_path" not in data and "/private/synthetic-object" not in response.text


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
        pending_cleanup = BackgroundJob(job_type="user_account_delete", status="committed", phase="completed",
            completed_at=now - timedelta(days=3),
            payload={"account_cleanup_keys": ["objects/synthetic-pending"]},
            result={"account_deleted": True, "asset_cleanup_status": "pending", "asset_cleanup_pending": 1})
        finished_cleanup = BackgroundJob(job_type="user_account_delete", status="committed", phase="completed",
            completed_at=now - timedelta(days=3), result={"account_deleted": True, "asset_cleanup_pending": 0})
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
        db.add_all((active, recent_job, expired_job, recent_import, expired_import, pending_cleanup, finished_cleanup))
        db.commit()
        expected_ids = {str(active.id), str(recent_job.id), str(recent_import.id), str(pending_cleanup.id)}
        excluded_ids = {str(expired_job.id), str(expired_import.id), str(finished_cleanup.id)}
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
    assert "account_cleanup_keys" not in response.text


def test_noise_task_exposes_import_parent_relation(client: TestClient) -> None:
    override = app.dependency_overrides[get_db]
    generator = override()
    db = next(generator)
    try:
        parent_id = "8f3e2c78-8ea0-4cca-8297-026109eb9a4e"
        job = BackgroundJob(
            job_type="content_noise_scan",
            status="queued",
            phase="queued",
            payload={"scan_id": "scan-1", "parent_task_id": parent_id},
            result={"scan_id": "scan-1"},
        )
        db.add(job)
        db.commit()
        job_id = str(job.id)
    finally:
        db.close()
        generator.close()

    response = client.get(f"/api/tasks/{job_id}")

    assert response.status_code == 200
    assert response.json()["result"]["parent_task_id"] == parent_id


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
