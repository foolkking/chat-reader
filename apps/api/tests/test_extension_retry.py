"""Synthetic device-scoped retries keep admission receipts and require fresh consent."""
import uuid
from datetime import datetime, timezone

import pytest

from app.core import auth_middleware
from app.models.background_job import BackgroundJob
from app.models.conversation import Conversation
from app.models.import_record import ImportRecord
from app.models.message import Message
from app.models.reader_extension import ExtensionDevice
from app.models.task_execution_control import TaskExecutionControl
from test_auth import auth_client, owner_login  # noqa: F401
from test_reader_extension import (  # noqa: F401
    EXT, ROWS, paired, package, drive_analysis, submit, commit, run_queued,
)


def stage(c, headers):
    key = str(uuid.uuid4())
    result = c.post(EXT + "/imports", headers={**headers, "Idempotency-Key": key},
                    files={"files": ("retry.zip", package(ROWS), "application/zip")})
    assert result.status_code == 201, result.text
    return result.json()["id"], key


def stop_analysis(iid, state):
    """The terminal record/job state produced by the existing worker stop/failure."""
    from app.services.background_jobs import _sync_adaptive_import_record_after_job
    with auth_middleware.SessionLocal() as db:
        record = db.get(ImportRecord, uuid.UUID(iid))
        job = db.get(BackgroundJob, uuid.UUID(record.analysis_summary["analysis_task_id"]))
        job.status = "failed" if state == "FAILED" else "cancelled"
        job.phase = job.status
        job.completed_at = datetime.now(timezone.utc)
        if state == "PAUSED":
            job.payload = {**job.payload, "source_disposition": "retain"}
        _sync_adaptive_import_record_after_job(db, job, status=job.status, now=job.completed_at)
        db.commit()
        assert record.session_state == state
        return job.id


@pytest.mark.parametrize("state", ["FAILED", "PAUSED"])
@pytest.mark.parametrize("resumable", [False, True])
def test_retry_analysis_reuses_import_receipt_without_canonical_writes(paired, state, resumable):
    c, h, _ = paired
    if resumable:
        from test_extension_transfer import transfer, send_chunk
        data = package(ROWS)
        key, path, _, _ = transfer(c, h, data)
        assert send_chunk(c, h, path, data, 0).status_code == 200
        result = c.post(path + "/finish", headers=h)
        assert result.status_code == 200, result.text
        iid = result.json()["id"]
    else:
        iid, key = stage(c, h)
    original_job = stop_analysis(iid, state)
    with auth_middleware.SessionLocal() as db:
        record = db.get(ImportRecord, uuid.UUID(iid))
        record.analysis_summary = {**record.analysis_summary, "extension_decision": {
            "accept_partial": True, "accept_share": True, "separate": True}}
        fingerprint = record.source_fingerprint
        originals = [(a.id, a.sha256, a.safe_filename) for a in record.artifacts]
        db.commit()
    response = c.post(f"{EXT}/imports/{iid}/retry", headers=h)
    assert response.status_code == 202, response.text
    assert response.json()["state"] == "ANALYZING"
    assert response.json()["id"] == iid
    assert c.get(f"{EXT}/requests/{key}", headers=h).json()["id"] == iid
    # An unknown response is resolved by GET, never a second import/job.
    assert c.post(f"{EXT}/imports/{iid}/retry", headers=h).status_code == 409
    with auth_middleware.SessionLocal() as db:
        record = db.get(ImportRecord, uuid.UUID(iid))
        assert db.query(ImportRecord).count() == 1
        assert db.query(Conversation).count() == 0
        assert record.source_fingerprint == fingerprint
        assert [(a.id, a.sha256, a.safe_filename) for a in record.artifacts] == originals
        assert "extension_decision" not in record.analysis_summary
        if state == "FAILED":
            assert uuid.UUID(record.analysis_summary["analysis_task_id"]) == original_job
            assert db.query(BackgroundJob).count() == 1
        else:
            assert uuid.UUID(record.analysis_summary["analysis_task_id"]) != original_job
            assert db.query(BackgroundJob).count() == 2
    drive_analysis()
    status = c.get(f"{EXT}/imports/{iid}", headers=h).json()
    assert status["status"] == "previewed" and status["review"]
    with auth_middleware.SessionLocal() as db:
        assert db.query(Conversation).count() == 0
    commit(c, h, iid, status["review"])
    assert c.post(f"{EXT}/imports/{iid}/retry", headers=h).status_code == 409


def fail_commit(iid):
    with auth_middleware.SessionLocal() as db:
        record = db.get(ImportRecord, uuid.UUID(iid))
        record.status, record.phase, record.session_state = "failed", "failed", "FAILED"
        record.error_message = "Synthetic failed canonical attempt"
        record.attempt_count = 3
        db.commit()


def test_failed_commit_retry_restores_review_not_old_partial_consent(paired):
    c, h, _ = paired
    iid, review = submit(c, h, ROWS, partial=True)
    path = f"{EXT}/imports/{iid}"
    assert c.post(path + "/commit", headers=h, json={
        "receipt": review["receipt"], "accept_partial": True}).status_code == 202
    fail_commit(iid)
    result = c.post(path + "/retry", headers=h)
    assert result.status_code == 202, result.text
    drive_analysis()
    result = c.get(path, headers=h).json()
    assert result["review"]["partial"] and result["status"] == "previewed"
    with auth_middleware.SessionLocal() as db:
        record = db.get(ImportRecord, uuid.UUID(iid))
        assert db.query(Conversation).count() == 0
        assert record.attempt_count == 0
        assert "extension_decision" not in record.analysis_summary
    assert c.post(path + "/commit", headers=h, json={
        "receipt": result["review"]["receipt"]}).status_code == 409


@pytest.mark.parametrize("change", ["share", "edited"])
def test_retry_rechecks_real_append_failure_without_overwriting(paired, change):
    from app.models.share import Share
    c, h, _ = paired
    initial, review = submit(c, h, ROWS)
    cid = commit(c, h, initial, review)
    iid, review = submit(c, h, [*ROWS, ("user", "Synthetic new tail")])
    path = f"{EXT}/imports/{iid}"
    assert review["action"] == "append"
    assert c.post(path + "/commit", headers=h, json={"receipt": review["receipt"]}).status_code == 202
    with auth_middleware.SessionLocal() as db:
        if change == "share":
            db.add(Share(conversation_id=uuid.UUID(cid), title="Synthetic live audience", scope="conversation",
                         content_mode="live", token_hash="a" * 64, token_prefix="synthetic"))
        else:
            message = db.query(Message).filter_by(conversation_id=uuid.UUID(cid)).first()
            message.is_deleted = True
        db.commit()
    run_queued(iid)  # Real canonical failure after audience/content changed.
    assert c.get(path, headers=h).json()["status"] == "failed"
    result = c.post(path + "/retry", headers=h)
    assert result.status_code == 202, result.text
    drive_analysis()
    current = c.get(path, headers=h).json()
    assert current["status"] == "previewed"
    if change == "share":
        assert current["review"]["live_share"]
    else:
        assert current["review"]["action"] == "conflict"
    assert c.post(path + "/commit", headers=h, json={"receipt": current["review"]["receipt"]}).status_code == 409
    with auth_middleware.SessionLocal() as db:
        assert db.query(Conversation).count() == 1
        assert db.query(Message).count() == 3
        if change == "edited":
            assert db.query(Message).filter_by(is_deleted=True).count() == 1


@pytest.mark.parametrize("reason", ["device", "owner", "revoked", "source", "slot", "operation",
                                    "append", "upload", "active", "committed"])
def test_retry_refuses_unauthorized_or_nonrecoverable_state(paired, reason):
    c, h, grant = paired
    iid, _ = stage(c, h)
    jid = stop_analysis(iid, "FAILED")
    with auth_middleware.SessionLocal() as db:
        record = db.get(ImportRecord, uuid.UUID(iid))
        job = db.get(BackgroundJob, jid)
        if reason == "device":
            record.analysis_summary = {**record.analysis_summary, "extension_device": str(uuid.uuid4())}
        elif reason == "owner":
            record.owner_user_id = None
        elif reason == "revoked":
            db.delete(db.get(ExtensionDevice, uuid.UUID(grant["device_id"])))
        elif reason == "source":
            record.artifacts.clear()
        elif reason == "slot":
            now = datetime.now(timezone.utc)
            db.add(TaskExecutionControl(slot="primary", token=uuid.uuid4(), task_kind="job",
                   task_id=jid, attempt=1, started_at=now, progress_at=now))
        elif reason == "operation":
            job.payload = {**job.payload, "operation": "replace"}
        elif reason == "append":
            record.analysis_summary = {**record.analysis_summary, "append_only": {"device": grant["device_id"]}}
        elif reason == "upload":
            record.analysis_summary = {**record.analysis_summary, "extension_transfer": {"accepted": False}}
        elif reason == "active":
            record.status, record.session_state = "analyzing", "ANALYZING"
            job.status = "processing"
        else:
            record.committed_at = datetime.now(timezone.utc)
        db.commit()
    result = c.post(f"{EXT}/imports/{iid}/retry", headers=h)
    assert result.status_code == (404 if reason in {"owner", "device"} else 401 if reason == "revoked" else 409), result.text
    with auth_middleware.SessionLocal() as db:
        assert db.query(ImportRecord).count() == 1
        assert db.query(BackgroundJob).count() == 1
        assert db.query(Conversation).count() == 0


def test_retry_respects_capture_kill_switch_and_has_no_web_cookie_fallback(paired, monkeypatch):
    from app.core.config import get_settings
    c, h, _ = paired
    iid, _ = stage(c, h)
    stop_analysis(iid, "FAILED")
    path = f"{EXT}/imports/{iid}/retry"
    assert c.get(EXT + "/capabilities", headers=h).json()["import_retry"] is True
    # The shared Web client has a default Reader Origin and a valid Web cookie.
    # First prove Origin refusal, then pass the registered extension Origin to
    # exercise the separate missing-device-token check (still with that cookie).
    assert c.post(path).status_code == 403
    assert c.post(path, headers={"Origin": h["Origin"]}).status_code == 401
    assert c.post(path, headers={**h, "Origin": "https://example.invalid"}).status_code == 403
    monkeypatch.setenv("READER_EXTENSION_CAPTURE", "false")
    get_settings.cache_clear()
    assert c.post(path, headers=h).status_code == 403
    with auth_middleware.SessionLocal() as db:
        assert db.get(ImportRecord, uuid.UUID(iid)).status == "failed"
