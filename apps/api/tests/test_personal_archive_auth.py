import io
import uuid
import zipfile

from app.core import auth_middleware
from app.models.background_job import BackgroundJob
from app.services.background_jobs import claim_next_job, process_background_job
from test_auth import auth_client, owner_login  # noqa: F401
from test_my_shares import register


def test_real_authenticated_personal_backup_is_private_from_other_users_and_root(auth_client, tmp_path, monkeypatch):
    from app.core.config import get_settings
    monkeypatch.setenv("EXPORT_STORAGE_DIR", str(tmp_path / "exports")); get_settings.cache_clear()
    assert auth_client.get("/api/me/archive/tasks").status_code == 401
    register(auth_client, "archive-a")
    source = auth_client.post("/api/conversations", json={"title": "Synthetic private archive", "messages": [
        {"role": "user", "content_markdown": "Synthetic private archive question"},
        {"role": "assistant", "content_markdown": "Synthetic private archive answer"},
    ]})
    assert source.status_code == 201
    assert auth_client.post("/api/system/archive/exports", json={}).status_code == 404
    queued = auth_client.post("/api/me/archive/exports", headers={"Idempotency-Key": "real-auth-export"}, json={})
    assert queued.status_code == 202
    job_id = uuid.UUID(queued.json()["job_id"])
    with auth_middleware.SessionLocal() as db:
        assert claim_next_job(db, job_type="personal_archive_export") == job_id
        db.commit()
    process_background_job(job_id, session_factory=auth_middleware.SessionLocal)
    task = auth_client.get(f"/api/tasks/{job_id}").json()
    assert task["status"] == "committed", task
    download = auth_client.get(task["result"]["download_url"])
    assert download.status_code == 200
    with zipfile.ZipFile(io.BytesIO(download.content)) as archive:
        assert b"Synthetic private archive" in archive.read("data/conversations.jsonl")
    register(auth_client, "archive-b")
    assert auth_client.get("/api/me/archive/tasks").json() == []
    assert auth_client.get(task["result"]["download_url"]).status_code == 404
    assert auth_client.get(f"/api/tasks/{job_id}").status_code == 404
    auth_client.cookies.clear(); assert owner_login(auth_client).status_code == 200
    assert auth_client.get("/api/me/archive/tasks").json() == []
    assert auth_client.get(task["result"]["download_url"]).status_code == 404
    with auth_middleware.SessionLocal() as db:
        assert db.get(BackgroundJob, job_id).status == "committed"
