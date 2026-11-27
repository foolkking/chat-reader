"""Append-specific safe recovery: synthetic worker failures, never production."""
from types import SimpleNamespace
import uuid

import pytest

from app.core import auth_middleware
from app.models.import_record import ImportRecord
from app.api.routes.append_imports import metadata
from app.services.adaptive_import import append_choices
from test_reader_extension import EXT, paired, ROWS  # noqa: F401
from test_auth import auth_client  # noqa: F401
from test_selective_append import contents, endpoint, review, run, stage, target


def test_queued_tail_change_is_actionable_not_an_integrity_failure(paired):
    client, _, _ = paired
    cid = target(client)
    iid, fields = stage(client, cid, ROWS)
    selected = {**fields, "indexes": [0, 1]}
    receipt = review(client, iid, selected)["receipt"]
    assert client.post(endpoint(iid, "confirm"), json={**selected, "receipt": receipt}).status_code == 202
    tail = contents(cid)[-1]
    assert client.patch(f"/api/messages/{tail.id}", json={
        "base_version_id": str(tail.current_version_id), "content_markdown": "Synthetic newer tail",
    }).status_code == 200
    run(iid)
    failed = client.get(f"/api/append-imports/{iid}").json()
    assert failed["failure"] == {"code": "APPEND_REVIEW_CHANGED", "stage": "commit", "recovery": "review_in_reader"}
    assert failed["submitted_selection"] == selected and len(contents(cid)) == 2
    new = review(client, iid, selected)
    assert new["receipt"] != receipt
    assert client.post(endpoint(iid, "confirm"), json={**selected, "receipt": new["receipt"]}).status_code == 202
    run(iid)
    assert len(contents(cid)) == 4


def test_corrupted_draft_preserves_selection_but_cannot_reconfirm_same_artifact(paired):
    client, _, _ = paired
    cid = target(client)
    original = contents(cid)
    iid, fields = stage(client, cid, ROWS)
    selected = {**fields, "ranges": [[0, 3]], "selected_count": 3}
    receipt = review(client, iid, selected)["receipt"]
    approved = {**selected, "receipt": receipt}
    assert client.post(endpoint(iid, "confirm"), json=approved).status_code == 202
    with auth_middleware.SessionLocal() as db:
        record = db.get(ImportRecord, uuid.UUID(iid))
        directory = append_choices.directory(record)
        draft = (directory.parent / record.draft_storage_uri).resolve()
        assert draft.parent == directory
        with draft.open("ab") as out:
            out.write(b"\nSynthetic integrity failure\n")
    run(iid)
    failed = client.get(f"/api/append-imports/{iid}").json()
    assert failed["failure"] == {"code": "SOURCE_CHANGED", "stage": "commit", "recovery": "system_support"}
    assert failed["submitted_selection"] == selected and contents(cid) == original
    for operation, body in (("review", selected), ("confirm", approved)):
        response = client.post(endpoint(iid, operation), json=body)
        assert response.status_code == 409 and response.json()["detail"]["code"] == "APPEND_SOURCE_CHANGED"
    assert client.get(f"/api/append-imports/{iid}").json()["status"] == "failed"


@pytest.mark.parametrize("failure", [
    {"code": "READER_PACKAGE_INVALID", "stage": "archive", "message": "synthetic private filename"},
    {"code": "synthetic private filename", "stage": "synthetic traceback"},
])
def test_status_only_projects_whitelisted_failure_metadata(failure):
    record = SimpleNamespace(id=uuid.uuid4(), draft_sha256=None, session_state="FAILED", status="failed",
        phase="analysis_failed", progress=0, error_message="synthetic private filename", draft_summary={},
        analysis_summary={"append_only": {"target": str(uuid.uuid4())}, "failure": failure})
    result = metadata(record)
    assert set(result["failure"]) == {"code", "stage", "recovery"}
    assert result["error"] == result["failure"]["code"]
    assert "synthetic" not in str(result)


def test_resource_wait_is_active_not_a_terminal_failure():
    record = SimpleNamespace(id=uuid.uuid4(), draft_sha256="a" * 64, session_state="READY", status="queued",
        phase="waiting_resources", progress=0, error_message=None, draft_summary={},
        analysis_summary={"append_only": {"target": str(uuid.uuid4())},
                          "failure": {"code": "UPLOAD_MEMORY_PRESSURE", "stage": "commit"}})
    result = metadata(record)
    assert result["phase"] == "waiting_resources" and result["failure"] is None and result["error"] is None


def test_device_append_receipt_is_read_only_and_reports_committed_partial_or_duplicate_counts(paired):
    client, grant, _ = paired
    cid = target(client)
    for expected in ({"added": 2, "skipped": 0, "partial": True}, {"added": 0, "skipped": 2, "partial": False}):
        iid, fields = stage(client, cid, ROWS, device=grant, partial=True)
        path = f"{EXT}/imports/{iid}"
        selected = {**fields, "indexes": [0, 1]}
        current = review(client, iid, selected)
        assert current["partial"] is True
        prior = client.get(path, headers=grant).json()
        assert prior["phase"] == "ready" and prior["result"] is prior["wait"] is None
        assert client.post(path + "/commit", headers=grant, json={"receipt": current["receipt"],
                           "accept_partial": True}).status_code == 409
        assert client.post(endpoint(iid, "confirm"), json={**selected, "receipt": current["receipt"],
                           "allow_partial": True}).status_code == 202
        queued = client.get(path, headers=grant).json()
        assert queued["status"] == queued["phase"] == "queued" and queued["result"] is None
        run(iid)
        for _ in range(2):
            assert client.get(path, headers=grant).json() == {
                "id": iid, "state": "COMPLETED", "status": "committed", "mode": "selective_append",
                "progress": 100, "phase": "completed", "wait": None, "result": expected, "failure": None,
            }
        assert len(contents(cid)) == 4
        with auth_middleware.SessionLocal() as db:
            record = db.get(ImportRecord, uuid.UUID(iid))
            record.analysis_summary = {**record.analysis_summary, "extension_device": str(uuid.uuid4())}
            db.commit()
        assert client.get(path, headers=grant).status_code == 404


def test_device_append_progress_wait_and_result_are_finite_redacted_and_not_inferred():
    from app.services.extension_results import public_append_status
    raw = {"reason": "UPLOAD_MEMORY_PRESSURE", "remaining_seconds": 25.5,
           "next_retry_at": "2026-11-26T01:02:03+00:00", "private": "do-not-expose"}
    record = SimpleNamespace(phase="waiting_resources", progress=12, status="queued",
        analysis_summary={"resource_wait": raw, "append_result": {"target": "do-not-expose"}})
    assert public_append_status(record) == {"phase": "waiting_resources", "progress": 12, "result": None,
        "wait": {k: raw[k] for k in ("reason", "remaining_seconds", "next_retry_at")}}
    raw["next_retry_at"] = "do-not-expose"
    assert public_append_status(record)["wait"]["next_retry_at"] is None
    raw["reason"] = ["do-not-expose"]
    assert public_append_status(record)["wait"] is None
    record.phase, record.progress, record.status = "do-not-expose", 104, "committed"
    record.analysis_summary["append_result"].update(added=True, skipped=-1, partial="do-not-expose")
    assert public_append_status(record) == {"phase": None, "progress": None, "wait": None, "result": None}
    record.analysis_summary["append_result"].update(added=0, skipped=2, partial=False)
    assert public_append_status(record)["result"] == {"added": 0, "skipped": 2, "partial": False}
