"""Read an original admission receipt without staging or replaying its ZIP."""
import uuid

import pytest

from app.models.background_job import BackgroundJob
from app.models.conversation import Conversation
from app.models.export_artifact import ExportArtifact
from app.models.user import User
from test_context_return_recovery import failed_return
from test_continuation_candidates import client, database, private_objects, root  # noqa: F401
from test_auth import auth_client  # noqa: F401


def lookup(client, conversation_id, key="recover"):
    return client.get(f"/api/conversations/{conversation_id}/continuation/returns/by-request/{key}")


@pytest.mark.parametrize("status", ["queued", "processing", "cancelling", "committed", "failed", "cancelled"])
def test_receipt_includes_terminal_tasks_without_requiring_the_upload(client, monkeypatch, status):
    identity, conversation_id = failed_return(client)
    with database() as db:
        job = db.get(BackgroundJob, identity)
        job.status = status
        db.delete(db.query(ExportArtifact).filter_by(job_id=identity).one())
        db.commit()
        before = job.status, job.attempt_count, job.payload, job.result
    from app.services.assets.asset_store import LocalAssetStore
    monkeypatch.setattr(LocalAssetStore, "stage", lambda *a, **kw: pytest.fail("A receipt GET must not stage input"))
    response = lookup(client, conversation_id)
    assert response.status_code == 200, response.text
    assert response.json() == {"task": {"task_id": str(identity), "status": status}}
    assert response.headers["cache-control"] == "no-store"
    assert not any(value in response.text for value in ["storage_uri", "sha256", "payload", "base_generation"])
    with database() as db:
        job = db.get(BackgroundJob, identity)
        assert (job.status, job.attempt_count, job.payload, job.result) == before
        assert db.query(BackgroundJob).filter_by(job_type="context_return").count() == 1


def test_unknown_key_is_not_a_claim_that_admission_failed(client):
    identity, conversation_id = failed_return(client)
    response = lookup(client, conversation_id, "not-admitted-yet")
    assert response.status_code == 200 and response.json() == {"task": None}
    assert response.headers["cache-control"] == "no-store"
    with database() as db:
        assert db.get(BackgroundJob, identity).status == "failed"


@pytest.mark.parametrize("change", ["foreign_conversation", "deleted_conversation", "foreign_task", "other_type", "other_payload"])
def test_receipt_cannot_reveal_another_owner_target_or_task_type(client, change):
    identity, conversation_id = failed_return(client)
    with database() as db:
        other = User(normalized_email="synthetic-receipt-other@example.test")
        db.add(other)
        db.flush()
        job = db.get(BackgroundJob, identity)
        if change == "foreign_conversation":
            db.get(Conversation, conversation_id).owner_user_id = other.id
        elif change == "deleted_conversation":
            from datetime import datetime, timezone
            db.get(Conversation, conversation_id).deleted_at = datetime.now(timezone.utc)
        elif change == "foreign_task":
            job.owner_user_id = other.id
        elif change == "other_type":
            job.job_type = "conversation_export"
        else:
            job.payload = {**job.payload, "conversation_id": str(uuid.uuid4())}
        db.commit()
    response = lookup(client, conversation_id)
    if change.endswith("conversation"):
        assert response.status_code == 404
    else:
        assert response.status_code == 200 and response.json() == {"task": None}
    assert str(identity) not in response.text


def test_request_key_limit_matches_admission(client):
    _, conversation_id = failed_return(client)
    assert lookup(client, conversation_id, "x" * 129).status_code == 422


def test_receipt_can_read_existing_admission_keys_with_encoded_separators(client):
    from urllib.parse import quote
    path = root(client)
    key = "synthetic/原请求?with punctuation"
    accepted = client.post(path + "/returns", data={"base_generation": 0, "idempotency_key": key},
        files={"file": ("synthetic.context.zip", b"Synthetic input")})
    assert accepted.status_code == 202
    receipt = client.get(path + "/returns/by-request/" + quote(key, safe=""))
    assert receipt.status_code == 200 and receipt.json()["task"]["task_id"] == accepted.json()["task_id"]


def test_authenticated_receipts_are_not_shared_across_accounts(auth_client, monkeypatch):
    from app.core.config import get_settings
    from test_admin_system import _normal_user_session
    monkeypatch.setenv("IMPORT_COMMIT_INLINE", "true")
    get_settings.cache_clear()
    _, token = _normal_user_session(auth_client)
    auth_client.cookies.set("chat_reader_session", token)
    auth_client.cookies.set("chat_reader_session_present", "1")
    path = root(auth_client)
    response = auth_client.post(path + "/returns", data={"base_generation": 0, "idempotency_key": "same-request-key"},
        files={"file": ("synthetic.context.zip", b"Synthetic upload")})
    assert response.status_code == 202
    identity = response.json()["task_id"]
    url = path + "/returns/by-request/same-request-key"
    assert auth_client.get(url).json()["task"]["task_id"] == identity
    _, other_token = _normal_user_session(auth_client)
    auth_client.cookies.set("chat_reader_session", other_token)
    assert auth_client.get(url).status_code == 404
    other_path = root(auth_client)
    assert auth_client.get(other_path + "/returns/by-request/same-request-key").json() == {"task": None}
    auth_client.cookies.clear()
    assert auth_client.get(url).status_code == 401
