"""Actual cleanup completion, replay and partial-commit recovery."""
import uuid
import io
import json
from datetime import timedelta

import pytest

from app.models.background_job import BackgroundJob
from app.models.content_cleanup import ContentCleanupScan
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.conversation import Conversation
from app.services import cleanup_outcomes
from app.services import content_cleanup as cleanup
from test_cleanup_safety import create_review, session, MARKER
from test_import_preview_api import client  # noqa: F401


def test_cleanup_reader_share_toc_search_and_offline_use_committed_version(client):
    from app.services.offline_packages import _write_conversation_payload
    source = f"# Before {MARKER} after.\n\nRetained synthetic evidence."
    scan_id, messages = create_review(client, [source])
    message_id = messages[0]
    with session() as db:
        conversation_id = db.get(Message, message_id).conversation_id
        before_revision = db.get(Conversation, conversation_id).offline_revision
    shared = client.post(f"/api/conversations/{conversation_id}/shares", json={"include_toc": True})
    assert shared.status_code == 200
    assert client.patch(f"/api/content-cleanup/scans/{scan_id}/decisions/filter", json={"decision": "DELETE", "all_matching": True}).status_code == 200
    assert client.post(f"/api/content-cleanup/scans/{scan_id}/apply").json()["applied"] == 1
    current = client.get(f"/api/messages/{message_id}").json()["current_version"]
    expected = source.replace(MARKER, "")
    assert current["display_text"] == expected
    for endpoint in (f"/api/conversations/{conversation_id}/reader-turn", f"/api/shared/{shared.json()['token']}/reader-turn"):
        result = client.get(endpoint)
        assert result.status_code == 200
        item = next(row for row in result.json()["items"] if row["id"] == str(message_id))
        assert item["current_version"]["id"] == current["id"]
        assert item["current_version"]["display_text"] == expected
        assert item["render_blocks"]
    headings = client.get(f"/api/conversations/{conversation_id}/toc").json()["items"]
    assert len(headings) == 1 and "turn12search4" not in headings[0]["text"]
    assert any(row["message_id"] == str(message_id) for row in client.get("/api/search", params={"q": "Retained synthetic evidence"}).json()["items"])
    with session() as db:
        conversation = db.get(Conversation, conversation_id)
        assert conversation.offline_revision > before_revision
        output = io.BytesIO()
        _write_conversation_payload(output, db, conversation, subject_key=str(conversation.owner_user_id))
        item = next(row for row in json.loads(output.getvalue())["messages"] if row["id"] == str(message_id))
        assert item["current_version"]["id"] == current["id"]
        assert item["current_version"]["display_text"] == expected
        assert item["render_blocks"]


def selected(client, count=1):
    scan_id, messages = create_review(client, [f"Synthetic {i} {MARKER} retained." for i in range(count)])
    response = client.patch(f"/api/content-cleanup/scans/{scan_id}/decisions/filter", json={"decision": "DELETE", "all_matching": True})
    assert response.status_code == 200
    return scan_id, messages


def test_completed_receipt_replays_without_versions_and_outlives_task_window(client):
    scan_id, messages = selected(client)
    prefix = f"/api/content-cleanup/scans/{scan_id}"
    with session() as db:
        job_id = db.get(ContentCleanupScan, scan_id).background_job_id
    token = client.get(prefix + "/preview").json()["preview_token"]
    first = client.post(prefix + "/apply", json={"preview_token": token})
    assert first.status_code == 200 and first.json() == {"applied": 1, "conflicts": 0}
    assert client.get(prefix).status_code == 404  # Old scan endpoint stays compatible.
    for _ in range(2):
        assert client.post(prefix + "/apply", json={"preview_token": token}).json() == first.json()
    outcome = client.get(prefix + "/outcome")
    assert outcome.status_code == 200
    assert outcome.json() == {"status": "COMPLETED", "applied": 1, "conflicts": 0, "remaining": 0,
                              "completed_at": outcome.json()["completed_at"]}
    assert outcome.json()["completed_at"]
    task = client.get(f"/api/tasks/{job_id}").json()
    assert task["result"]["cleanup_apply"] == outcome.json()
    assert "response" not in task["result"]["cleanup_apply"]
    with session() as db:
        assert db.get(ContentCleanupScan, scan_id) is None
        assert db.query(MessageVersion).filter_by(message_id=messages[0]).count() == 2
        version = db.get(MessageVersion, db.get(Message, messages[0]).current_version_id)
        assert version.display_text == "Synthetic 0  retained."
        job = db.get(BackgroundJob, job_id)
        assert job.idempotency_key == f"cleanup-apply:{scan_id}"
        job.completed_at = cleanup.utc_now() - timedelta(days=2)
        db.commit()
    assert str(job_id) not in [row["job_id"] for row in client.get("/api/tasks/active").json()]
    assert client.get(prefix + "/outcome").json() == outcome.json()


def test_dismissed_and_unknown_scans_do_not_claim_completion(client):
    scan_id, _ = selected(client)
    prefix = f"/api/content-cleanup/scans/{scan_id}"
    assert client.get(prefix + "/outcome").json() == {"status": "REVIEW", "applied": 0, "conflicts": 0, "remaining": 1, "completed_at": None}
    assert client.delete(prefix).status_code == 204
    assert client.get(prefix + "/outcome").status_code == 404
    assert client.post(prefix + "/apply").status_code == 409
    assert client.get(f"/api/content-cleanup/scans/{uuid.uuid4()}/outcome").status_code == 404


@pytest.mark.parametrize("failure", ["second_message", "receipt"])
def test_interruption_keeps_earlier_commit_and_rolls_back_final_receipt(client, monkeypatch, failure):
    scan_id, messages = selected(client, 2)
    original_create = cleanup._create_version
    original_receipt = cleanup_outcomes.save_completed_outcome
    calls = 0

    def fail_second(**kwargs):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("Synthetic message failure")
        return original_create(**kwargs)

    def fail_receipt(*args):
        original_receipt(*args)
        args[0].flush()
        raise RuntimeError("Synthetic final receipt failure")

    if failure == "second_message":
        monkeypatch.setattr(cleanup, "_create_version", fail_second)
    else:
        monkeypatch.setattr(cleanup_outcomes, "save_completed_outcome", fail_receipt)
    with session() as db:
        with pytest.raises(RuntimeError, match="Synthetic"):
            cleanup.apply_scan(db, scan_id)
    prefix = f"/api/content-cleanup/scans/{scan_id}"
    assert client.get(prefix + "/outcome").json() == {"status": "REVIEW", "applied": 1, "conflicts": 0, "remaining": 1, "completed_at": None}
    with session() as db:
        assert sorted(db.query(MessageVersion).filter_by(message_id=mid).count() for mid in messages) == [1, 2]
        assert db.query(BackgroundJob).filter_by(idempotency_key=f"cleanup-apply:{scan_id}").count() == 0
    monkeypatch.setattr(cleanup, "_create_version", original_create)
    monkeypatch.setattr(cleanup_outcomes, "save_completed_outcome", original_receipt)
    token = client.get(prefix + "/preview").json()["preview_token"]
    result = client.post(prefix + "/apply", json={"preview_token": token})
    assert result.status_code == 200 and result.json() == {"applied": 1, "conflicts": 0}
    assert client.get(prefix + "/outcome").json()["applied"] == 2
    assert client.post(prefix + "/apply").json() == result.json()
    with session() as db:
        assert all(db.query(MessageVersion).filter_by(message_id=mid).count() == 2 for mid in messages)
