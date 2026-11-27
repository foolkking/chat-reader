"""Finite device diagnostics, real worker failures, and no invalid-artifact replay."""
import io
import json
from types import SimpleNamespace
import uuid
import zipfile

import pytest

from app.core import auth_middleware
from app.models.background_job import BackgroundJob
from app.models.conversation import Conversation
from app.models.import_record import ImportRecord
from app.models.message import Message
from app.services.adaptive_import.contracts import AdaptiveImportError
from app.services.extension_results import public_failure
from app.services.task_errors import import_failure_from_exception, public_task_error
from test_auth import auth_client, owner_login  # noqa: F401
from test_reader_extension import paired, package, ROWS, EXT, drive_analysis, submit, commit  # noqa: F401
from test_extension_transfer import transfer, send_chunk


PRIVATE = "synthetic-private-name.zip /internal/source Bearer synthetic-token traceback"
INVALID = {"code": "READER_PACKAGE_INVALID", "stage": "archive", "recovery": "system_support"}
OLD_RECEIPT_KEYS = {
    "id", "state", "status", "phase", "progress", "review", "wait", "conversation_id", "title", "result",
}


def failed(value=None, **changes):
    return SimpleNamespace(**{
        "status": "failed", "phase": "analysis_failed", "error_message": PRIVATE,
        "analysis_summary": {"failure": value}, **changes,
    })


@pytest.mark.parametrize("stage", ["analysis", "commit"])
def test_reader_package_category_survives_exception_wrappers_without_text(stage):
    inner = AdaptiveImportError("READER_PACKAGE_INVALID", PRIVATE, layer="archive")
    outer = RuntimeError(PRIVATE)
    outer.__cause__ = inner
    assert import_failure_from_exception(outer, stage=stage) == {
        "code": "READER_PACKAGE_INVALID", "stage": "commit" if stage == "commit" else "archive",
        "retryable": False,
    }
    assert public_task_error("READER_PACKAGE_INVALID") == "READER_PACKAGE_INVALID"
    assert public_task_error("READER_PACKAGE_INVALID " + PRIVATE) == "TASK_FAILED"


@pytest.mark.parametrize("code,recovery", [
    ("READER_PACKAGE_INVALID", "system_support"),
    ("ZIP_CRC_INVALID", "system_support"),
    ("SOURCE_CHANGED", "system_support"),
    ("SOURCE_PATH_INVALID", "system_support"),
    ("IMPORT_STORAGE_FULL", "free_storage"),
    ("UPLOAD_MEMORY_PRESSURE", "retry_existing"),
    ("SMALL_IMPORT_BUDGET_EXCEEDED", "retry_existing"),
    ("UPLOAD_QUEUE_FULL", "retry_existing"),
    ("UPLOAD_QUEUE_TIMEOUT", "retry_existing"),
    ("IMPORT_RESOURCE_WAIT_EXPIRED", "retry_existing"),
    ("NO_MESSAGE_STRUCTURE", "review_in_reader"),
    ("DOCUMENT_NOT_TRANSCRIPT", "review_in_reader"),
    ("IMPORT_PLAN_INVALID", "review_in_reader"),
    ("SOURCE_MISSING", "review_in_reader"),
    ("TASK_FAILED", "system_support"),
])
def test_recovery_is_derived_from_code_not_untrusted_hints(code, recovery):
    value = {"code": code, "stage": "archive", "retryable": True, "recovery": "retry_existing",
             "message": PRIVATE, "details": {"path": PRIVATE}, "traceback": PRIVATE}
    result = public_failure(failed(value))
    assert result == {"code": code, "stage": "archive", "recovery": recovery}
    assert set(result) == {"code", "stage", "recovery"}
    assert PRIVATE not in json.dumps(result)


@pytest.mark.parametrize("value", [
    None, [], PRIVATE, {"code": []}, {"code": PRIVATE, "stage": PRIVATE},
    {"code": "TASK_FAILED", "stage": {"path": PRIVATE}, "recovery": PRIVATE},
])
def test_legacy_and_malformed_metadata_fail_closed(value):
    assert public_failure(failed(value)) == {
        "code": "TASK_FAILED", "stage": "analysis", "recovery": "system_support",
    }


def test_legacy_commit_fallback_and_safe_memory_message():
    assert public_failure(failed(phase="failed")) == {
        "code": "TASK_FAILED", "stage": "commit", "recovery": "system_support",
    }
    assert public_failure(failed(error_message="UPLOAD_MEMORY_PRESSURE")) == {
        "code": "UPLOAD_MEMORY_PRESSURE", "stage": "analysis", "recovery": "retry_existing",
    }
    assert public_failure(failed(analysis_summary={
        "append_only": {"device": "synthetic"},
        "failure": {"code": "UPLOAD_MEMORY_PRESSURE", "stage": "analysis"},
    }))["recovery"] == "review_in_reader"


@pytest.mark.parametrize("status", ["receiving", "analyzing", "previewed", "queued", "processing", "committed", "paused"])
def test_nonfailed_receipts_never_expose_stale_failure(status):
    assert public_failure(failed(INVALID, status=status)) is None


def damaged_package(kind):
    raw = package(ROWS, corrupt=kind == "offset")
    if kind == "offset":
        return raw
    target = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(raw)) as source, zipfile.ZipFile(target, "w") as output:
        for name in source.namelist():
            data = source.read(name)
            if name == "manifest.json":
                data = json.dumps({**json.loads(data), "source_manifest": PRIVATE}).encode()
            output.writestr(name, data)
    return target.getvalue()


@pytest.mark.parametrize("kind", ["offset", "extra_header"])
def test_real_upload_worker_failure_is_sanitized_and_cannot_requeue_same_package(paired, kind):
    c, h, grant = paired
    data = damaged_package(kind)
    key, path, binding, _ = transfer(c, h, data)
    assert send_chunk(c, h, path, data, 0).status_code == 200
    accepted = c.post(path + "/finish", headers=h)
    assert accepted.status_code == 200
    iid = accepted.json()["id"]
    route = f"{EXT}/imports/{iid}"
    before = c.get(route, headers=h).json()
    assert before["failure"] is None
    assert set(before) == OLD_RECEIPT_KEYS | {"failure"}
    drive_analysis()  # Real validator and worker error projection; no mocked exception.
    response = c.get(route, headers=h)
    assert response.status_code == 200
    state = response.json()
    assert state["status"] == "failed" and state["state"] == "FAILED"
    assert state["phase"] == "analysis_failed"
    assert state["failure"] == INVALID
    assert state["conversation_id"] is None and state["result"] is None and state["review"] is None
    assert set(state) == OLD_RECEIPT_KEYS | {"failure"}
    assert PRIVATE not in response.text and "traceback" not in response.text
    with auth_middleware.SessionLocal() as db:
        record = db.get(ImportRecord, uuid.UUID(iid))
        job = db.get(BackgroundJob, uuid.UUID(record.analysis_summary["analysis_task_id"]))
        assert record.analysis_summary["failure"] == job.result["failure"] == {
            "code": "READER_PACKAGE_INVALID", "stage": "archive", "retryable": False,
        }
        snapshot = (job.id, job.attempt_count, job.status, job.queued_at, record.attempt_count, record.source_fingerprint)
        # Even legacy or injected retry hints cannot override immutable integrity.
        record.error_message = PRIVATE
        record.analysis_summary = {**record.analysis_summary, "failure": {
            **record.analysis_summary["failure"], "retryable": True, "recovery": "retry_existing",
            "details": {"path": PRIVATE}, "message": PRIVATE,
        }}
        db.commit()
    for _ in range(2):
        retry = c.post(route + "/retry", headers=h)
        assert retry.status_code == 409 and retry.json() == {"detail": INVALID}
        assert c.post(path + "/finish", headers=h).json()["id"] == iid
        assert c.post(path, headers=h, json=binding).json()["id"] == iid
        assert c.get(f"{EXT}/requests/{key}", headers=h).json()["id"] == iid
    assert c.get(route, headers=h).json()["failure"] == INVALID
    assert c.get(route, headers={"Origin": h["Origin"]}).status_code == 401
    assert c.get(route, headers={**h, "Origin": "https://example.invalid"}).status_code == 403
    with auth_middleware.SessionLocal() as db:
        record = db.get(ImportRecord, uuid.UUID(iid))
        job = db.query(BackgroundJob).one()
        assert (job.id, job.attempt_count, job.status, job.queued_at, record.attempt_count, record.source_fingerprint) == snapshot
        assert db.query(ImportRecord).count() == 1
        assert db.query(Conversation).count() == db.query(Message).count() == 0
        record.analysis_summary = {**record.analysis_summary, "extension_device": str(uuid.uuid4())}
        db.commit()
    assert c.get(route, headers=h).status_code == c.post(route + "/retry", headers=h).status_code == 404


def test_success_and_selective_receipts_keep_existing_fields_and_null_failure(paired):
    c, h, _ = paired
    caps = c.get(EXT + "/capabilities", headers=h).json()
    assert caps["protocol"] == 1 and caps["import_profile"] == "reader-chat-v1"
    assert caps["import_diagnostics"] is caps["import_retry"] is caps["resumable_capture"] is True
    iid, review = submit(c, h, ROWS)
    path = f"{EXT}/imports/{iid}"
    state = c.get(path, headers=h).json()
    assert set(state) == OLD_RECEIPT_KEYS | {"failure"} and state["failure"] is None
    cid = commit(c, h, iid, review)
    state = c.get(path, headers=h).json()
    assert set(state) == OLD_RECEIPT_KEYS | {"failure"} and state["failure"] is None
    assert state["conversation_id"] == cid and state["result"]["completeness"] == "complete"
    # Only check the additive projection, not selective append's admission/selection policy.
    with auth_middleware.SessionLocal() as db:
        record = db.get(ImportRecord, uuid.UUID(iid))
        record.analysis_summary = {**record.analysis_summary, "append_only": {"device": "synthetic"}}
        db.commit()
    assert c.get(path, headers=h).json() == {
        "id": iid, "state": "COMPLETED", "status": "committed", "mode": "selective_append", "failure": None,
        "phase": "completed", "progress": 100, "wait": None, "result": None,
    }
