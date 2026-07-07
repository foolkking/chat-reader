from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.models.share import Share
from app.services.sharing.share_service import hash_token
from test_import_preview_api import client  # noqa: F401
from test_message_editing_api import commit_edit_sample


def test_create_share_returns_token_once_and_db_stores_hash(
    client: TestClient,
    tmp_path,
) -> None:
    sample = commit_edit_sample(client)
    conversation_id = sample["conversation_id"]

    response = client.post(
        f"/api/conversations/{conversation_id}/shares",
        json={"scope": "conversation", "include_toc": True, "include_metadata": True},
    )

    assert response.status_code == 200
    payload = response.json()
    token = payload["token"]
    assert token
    assert payload["share_url"].endswith(f"/share/{token}")
    assert payload["token_prefix"] == token[:10]

    shares = client.get(f"/api/conversations/{conversation_id}/shares")
    assert shares.status_code == 200
    listed = shares.json()[0]
    assert "token" not in listed
    assert listed["token_prefix"] == token[:10]

    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}")
    with Session(engine) as session:
        share = session.get(Share, UUID(payload["id"]))
        assert share is not None
        assert share.token_hash == hash_token(token)
        assert share.token_hash != token


def test_shared_readonly_response_and_access_count(client: TestClient) -> None:
    sample = commit_edit_sample(client)
    conversation_id = sample["conversation_id"]
    selected_message_id = sample["messages"][0]["id"]
    create = client.post(
        f"/api/conversations/{conversation_id}/shares",
        json={"scope": "selected_messages", "selected_message_ids": [selected_message_id]},
    )
    token = create.json()["token"]

    first = client.get(f"/api/shared/{token}")
    assert first.status_code == 200
    payload = first.json()
    assert payload["conversation"]["id"] == conversation_id
    assert len(payload["messages"]) == 1
    assert payload["messages"][0]["id"] == selected_message_id
    assert "raw_storage_uri" not in str(payload)
    assert "storage/imports" not in str(payload)

    second = client.get(f"/api/shared/{token}")
    assert second.status_code == 200
    shares = client.get(f"/api/conversations/{conversation_id}/shares").json()
    assert shares[0]["access_count"] == 2


def test_share_validation_revoke_and_expiry(client: TestClient, tmp_path) -> None:
    sample = commit_edit_sample(client)
    conversation_id = sample["conversation_id"]

    past = client.post(
        f"/api/conversations/{conversation_id}/shares",
        json={"expires_at": (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()},
    )
    assert past.status_code == 400

    wrong_message = client.post(
        f"/api/conversations/{conversation_id}/shares",
        json={"scope": "selected_messages", "selected_message_ids": ["00000000-0000-0000-0000-000000000001"]},
    )
    assert wrong_message.status_code == 400

    create = client.post(f"/api/conversations/{conversation_id}/shares", json={})
    share_id = create.json()["id"]
    token = create.json()["token"]

    revoke = client.post(f"/api/shares/{share_id}/revoke")
    assert revoke.status_code == 200
    revoked_access = client.get(f"/api/shared/{token}")
    assert revoked_access.status_code == 410

    expiring = client.post(
        f"/api/conversations/{conversation_id}/shares",
        json={"expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()},
    )
    expiring_token = expiring.json()["token"]
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}")
    with Session(engine) as session:
        share = session.get(Share, UUID(expiring.json()["id"]))
        share.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        session.commit()

    expired_access = client.get(f"/api/shared/{expiring_token}")
    assert expired_access.status_code == 410

    invalid = client.get("/api/shared/not-a-real-token")
    assert invalid.status_code == 404


def test_share_events_exclude_raw_token(client: TestClient) -> None:
    sample = commit_edit_sample(client)
    conversation_id = sample["conversation_id"]
    create = client.post(f"/api/conversations/{conversation_id}/shares", json={})
    token = create.json()["token"]
    share_id = create.json()["id"]
    client.post(f"/api/shares/{share_id}/revoke")

    events = client.get(f"/api/conversations/{conversation_id}/events")
    assert events.status_code == 200
    payload = events.json()
    event_text = str(payload)
    assert "share_created" in event_text
    assert "share_revoked" in event_text
    assert token not in event_text
