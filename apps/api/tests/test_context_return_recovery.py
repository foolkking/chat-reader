"""Recovery follows actual retained input, not a generic failed-task button."""
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
import uuid
from zipfile import ZipFile

import pytest

from app.models.background_job import BackgroundJob
from app.models.context_continuation import ContinuationState
from app.models.conversation import Conversation
from app.models.export_artifact import ExportArtifact
from app.models.user import User
from test_context_return import run_job
from test_continuation_candidates import client, database, private_objects, root  # noqa: F401


def failed_return(client, *, invalid=False):
    path = root(client)
    source = BytesIO()
    with ZipFile(source, "w") as archive:
        archive.writestr("manifest.json", "{}")
        archive.writestr("conversation.canjsonl", "Synthetic raw is not imported")
        archive.writestr("continuation/current.md", "# Synthetic returned notes")
    reply = client.post(path + "/returns", data={"base_generation": 0, "idempotency_key": "recover"},
        files={"file": ("synthetic.context.zip", b"invalid" if invalid else source.getvalue())})
    assert reply.status_code == 202, reply.text
    identity = uuid.UUID(reply.json()["task_id"])
    if invalid:
        run_job(str(identity))
    else:
        with database() as db:
            job = db.get(BackgroundJob, identity)
            job.status = job.phase = "failed"
            job.error_message = "CONTEXT_RETURN_FAILED"
            job.attempt_count = 2
            job.completed_at = datetime.now(timezone.utc)
            db.commit()
    return identity, uuid.UUID(path.split("/")[3])


def test_expired_input_cannot_requeue_and_explains_the_actual_recovery(client):
    identity, conversation_id = failed_return(client)
    with database() as db:
        artifact = db.query(ExportArtifact).filter_by(job_id=identity).one()
        artifact.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()
        original = db.get(BackgroundJob, identity)
        completed, queued = original.completed_at, original.queued_at
    response = client.post(f"/api/tasks/{identity}/retry")
    assert response.status_code == 410, response.text
    assert response.json()["detail"] == "CONTEXT_RETURN_EXPIRED"
    task = client.get(f"/api/tasks/{identity}").json()
    assert task["status"] == "failed"
    assert task["result"]["context_return_recovery"] == {
        "action": "update_files", "reason": "CONTEXT_RETURN_EXPIRED", "conversation_id": str(conversation_id),
    }
    with database() as db:
        job = db.get(BackgroundJob, identity)
        assert job.status == "failed" and job.attempt_count == 2
        assert job.completed_at == completed and job.queued_at == queued
        assert job.result == {}


def test_invalid_input_keeps_its_safe_reason_and_offers_reselection_not_retry(client):
    identity, _ = failed_return(client, invalid=True)
    task = client.get(f"/api/tasks/{identity}").json()
    assert task["error_message"] == "CONTEXT_RETURN_INVALID"
    assert task["result"]["context_return_recovery"]["action"] == "update_files"
    assert client.post(f"/api/tasks/{identity}/retry").status_code == 409


@pytest.mark.parametrize("change,reason", [
    ("missing", "CONTEXT_RETURN_EXPIRED"), ("released", "CONTEXT_RETURN_EXPIRED"),
    ("reclaiming", "CONTEXT_RETURN_EXPIRED"), ("retry", "CONTEXT_RETURN_EXPIRED"),
    ("format", "CONTEXT_RETURN_EXPIRED"), ("file_missing", "CONTEXT_RETURN_UNAVAILABLE"),
    ("file_changed", "CONTEXT_RETURN_UNAVAILABLE"), ("outside", "CONTEXT_RETURN_UNAVAILABLE"),
    ("generation", "CONTEXT_BASE_CHANGED"),
])
def test_unusable_source_or_newer_saved_files_require_review_without_mutation(client, tmp_path, change, reason):
    identity, conversation_id = failed_return(client)
    with database() as db:
        artifact = db.query(ExportArtifact).filter_by(job_id=identity).one()
        if change == "missing":
            db.delete(artifact)
        elif change == "released":
            artifact.release_requested_at = datetime.now(timezone.utc)
        elif change in {"retry", "reclaiming"}:
            artifact.lifecycle_state = change
        elif change == "format":
            artifact.format = "other-private-upload"
        elif change == "file_missing":
            Path(artifact.storage_uri).unlink()
        elif change == "file_changed":
            Path(artifact.storage_uri).write_bytes(b"synthetic changed input")
        elif change == "outside":
            artifact.storage_uri = str(tmp_path / "not-a-context-input.zip")
        else:
            db.add(ContinuationState(conversation_id=conversation_id, generation=3))
        db.commit()
    task = client.get(f"/api/tasks/{identity}").json()
    assert task["result"]["context_return_recovery"] == {
        "action": "update_files", "reason": reason, "conversation_id": str(conversation_id),
    }
    assert client.post(f"/api/tasks/{identity}/retry").status_code in (409, 410)
    with database() as db:
        job = db.get(BackgroundJob, identity)
        assert job.status == "failed" and job.result == {} and job.payload["base_generation"] == 0


@pytest.mark.parametrize("change", ["deleted", "foreign", "malformed"])
def test_recovery_never_links_an_unowned_or_deleted_target(client, change):
    identity, conversation_id = failed_return(client)
    with database() as db:
        job = db.get(BackgroundJob, identity)
        if change == "deleted":
            db.get(Conversation, conversation_id).deleted_at = datetime.now(timezone.utc)
        elif change == "foreign":
            other = User(normalized_email="synthetic-return-other@example.test")
            db.add(other); db.flush()
            db.get(Conversation, conversation_id).owner_user_id = other.id
        else:
            job.payload = {**job.payload, "conversation_id": "private malformed value"}
        db.commit()
    response = client.get(f"/api/tasks/{identity}")
    assert response.status_code == 200
    assert response.json()["result"]["context_return_recovery"] == {
        "action": "open_list", "reason": "CONTEXT_NOT_FOUND", "conversation_id": None,
    }
    assert str(conversation_id) not in response.text and "private malformed value" not in response.text
    assert client.post(f"/api/tasks/{identity}/retry").status_code == 409


def test_transient_retry_keeps_original_input_and_deadline_and_uses_the_original_task(client):
    identity, conversation_id = failed_return(client)
    with database() as db:
        row = db.query(ExportArtifact).filter_by(job_id=identity).one()
        original = row.id, row.storage_uri, row.expires_at
    task = client.get(f"/api/tasks/{identity}").json()
    assert task["result"]["context_return_recovery"] == {
        "action": "retry", "reason": "CONTEXT_RETURN_FAILED", "conversation_id": str(conversation_id),
    }
    reply = client.post(f"/api/tasks/{identity}/retry")
    assert reply.status_code == 200 and reply.json()["job_id"] == str(identity)
    assert reply.json()["status"] == "queued"
    assert "context_return_recovery" not in reply.json()["result"]
    with database() as db:
        row = db.query(ExportArtifact).filter_by(job_id=identity).one()
        assert (row.id, row.storage_uri, row.expires_at) == original
    run_job(str(identity))
    assert client.get(f"/api/tasks/{identity}").json()["status"] == "committed"


@pytest.mark.parametrize("base", [None, True, "0"])
def test_legacy_or_malformed_generation_is_not_guessed(client, base):
    identity, _ = failed_return(client)
    with database() as db:
        job = db.get(BackgroundJob, identity)
        job.payload = {key: value for key, value in job.payload.items() if key != "base_generation"}
        if base is not None:
            job.payload = {**job.payload, "base_generation": base}
        db.commit()
    task = client.get(f"/api/tasks/{identity}").json()
    assert task["result"]["context_return_recovery"]["reason"] == "CONTEXT_BASE_CHANGED"
    assert client.post(f"/api/tasks/{identity}/retry").status_code == 409


def test_recovery_metadata_never_substitutes_for_worker_byte_validation(client):
    identity, _ = failed_return(client)
    with database() as db:
        artifact = db.query(ExportArtifact).filter_by(job_id=identity).one()
        path = Path(artifact.storage_uri)
        body = path.read_bytes()
        path.write_bytes(bytes([body[0] ^ 1]) + body[1:])
    # Same-length damage is intentionally not hashed on a polling GET.
    task = client.get(f"/api/tasks/{identity}").json()
    assert task["result"]["context_return_recovery"]["action"] == "retry"
    assert client.post(f"/api/tasks/{identity}/retry").status_code == 200
    run_job(str(identity))
    result = client.get(f"/api/tasks/{identity}").json()
    assert result["status"] == "failed" and result["error_message"] == "CONTEXT_RETURN_INVALID"
    assert result["result"]["context_return_recovery"]["action"] == "update_files"
