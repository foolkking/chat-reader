"""Actual PG/API pagination and the original insertion's asynchronous follow-up."""
from fastapi.testclient import TestClient
import pytest
from sqlalchemy.orm import sessionmaker

from app.core import auth_middleware
from app.core.config import get_settings
from app.core.database import get_db
from app.main import app
from app.models.background_job import BackgroundJob
from app.models.user import User
from app.services.auth import provision_owner
from app.services.background_jobs import claim_next_job, process_background_job
from test_auth import owner_login
from test_admin_system import _normal_user_session
from test_import_profile_postgres import isolated_schema, pytestmark  # noqa: F401


@pytest.fixture
def client(isolated_schema, monkeypatch, tmp_path):
    engine, migrate = isolated_schema
    migrate("head")
    for name, value in {
        "APP_ENV": "test",
        "AUTH_ENABLED": "true",
        "AUTH_SESSION_SECRET": "test-only-pagination-secret-012345678901234567890",
        "AUTH_COOKIE_SECURE": "false",
        "PUBLIC_WEB_BASE_URL": "http://testserver",
        "AUTH_ACTIVITY_TOUCH_INTERVAL_SECONDS": "600",
        "DATABASE_URL": engine.url.render_as_string(hide_password=False),
        "IMPORT_STORAGE_DIR": str(tmp_path / "imports"),
        "ASSET_STORAGE_DIR": str(tmp_path / "assets"),
        "EXPORT_STORAGE_DIR": str(tmp_path / "exports"),
    }.items():
        monkeypatch.setenv(name, value)
    get_settings.cache_clear()
    factory = sessionmaker(bind=engine, autoflush=False)

    def override():
        with factory() as db:
            yield db

    monkeypatch.setitem(app.dependency_overrides, get_db, override)
    monkeypatch.setattr(auth_middleware, "SessionLocal", factory)
    with factory() as db:
        principal = provision_owner(db, "correct horse battery staple", get_settings())
        db.get(User, principal.user_id).normalized_email = "admin@example.test"
        db.commit()
    try:
        with TestClient(app) as value:
            value.headers.update({"Origin": "http://testserver"})
            yield value
    finally:
        get_settings.cache_clear()


def test_pagination_requires_the_original_insert_materialization_before_a_stable_snapshot(client):
    user_id, token = _normal_user_session(client)
    client.cookies.set("chat_reader_session", token)
    created = client.post("/api/conversations", json={
        "title": "Synthetic original inspection",
        "messages": [
            {"role": "user", "content_markdown": "Synthetic original question"},
            {"role": "assistant", "content_markdown": "Synthetic original answer"},
        ],
    })
    assert created.status_code == 201
    original = created.json()
    conversation_id = original["conversation"]["id"]
    events_path = f"/api/conversations/{conversation_id}/events?event_type=derived_data_rebuilt"
    assert client.get(events_path).json()["total"] == 0
    inserted = client.post(f"/api/conversations/{conversation_id}/messages/insert", json={
        "anchor_message_id": original["messages"][1]["id"], "position": "after", "mode": "pair",
        "messages": [
            {"role": "user", "content_markdown": "Synthetic searchable inserted question"},
            {"role": "assistant", "content_markdown": "Synthetic inserted answer"},
        ],
    })
    assert inserted.status_code == 201
    revision = inserted.json()["conversation"]["offline_revision"]
    assert client.get(events_path).json()["total"] == 0, "Insertion acknowledgement is not follow-up completion."
    for index in range(20):
        response = client.post("/api/conversations", json={
            "title": f"Synthetic pagination {index}",
            "messages": [
                {"role": "user", "content_markdown": "Synthetic pagination question"},
                {"role": "assistant", "content_markdown": "Synthetic pagination answer"},
            ],
        })
        assert response.status_code == 201
    assert owner_login(client).status_code == 200
    listing = f"/api/admin/content/users/{user_id}/conversations"

    def page(offset):
        response = client.get(listing, params={"limit": 20, "offset": offset})
        assert response.status_code == 200
        value = response.json()
        assert value["total"] == 21 and value["offset"] == offset
        return [item["id"] for item in value["items"]]

    early_first = page(0)
    assert len(early_first) == len(set(early_first)) == 20
    assert conversation_id not in early_first
    with auth_middleware.SessionLocal() as db:
        job_id = claim_next_job(db, job_type="conversation_derived_rebuild")
        assert job_id is not None
        job = db.get(BackgroundJob, job_id)
        assert job.owner_user_id == user_id
        assert job.payload["conversation_id"] == conversation_id
        db.commit()
    process_background_job(job_id, session_factory=auth_middleware.SessionLocal)
    with auth_middleware.SessionLocal() as db:
        assert db.get(BackgroundJob, job_id).status == "committed"

    # This is the CI's real negative control: the original pending follow-up
    # changes sorting between requests, so these are not one stable snapshot.
    raced_last = page(20)
    assert len(raced_last) == 1 and len(set(early_first + raced_last)) == 20
    with pytest.raises(AssertionError):
        assert len(set(early_first + raced_last)) == 21

    client.cookies.clear()
    client.cookies.set("chat_reader_session", token)
    materialized = client.get(events_path)
    assert materialized.status_code == 200
    assert materialized.json()["total"] == 1
    assert materialized.json()["items"][0]["event_type"] == "derived_data_rebuilt"
    canonical = client.get(f"/api/conversations/{conversation_id}").json()
    assert canonical["message_count"] == 4 and canonical["offline_revision"] == revision
    assert owner_login(client).status_code == 200
    first, last = page(0), page(20)
    assert len(first) == 20 and len(last) == 1
    assert len(set(first + last)) == 21
    assert conversation_id in first
