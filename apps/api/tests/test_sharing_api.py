from datetime import datetime, timedelta, timezone
import json
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
    assert listed["share_url"].endswith(f"/share/{token}")

    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}")
    with Session(engine) as session:
        share = session.get(Share, UUID(payload["id"]))
        assert share is not None
    assert share.token_hash == hash_token(token)
    assert share.token_hash != token
    assert share.metadata_["share_url"].endswith(f"/share/{token}")


def test_update_share_expiry_and_management_url(client: TestClient) -> None:
    sample = commit_edit_sample(client)
    conversation_id = sample["conversation_id"]
    create = client.post(f"/api/conversations/{conversation_id}/shares", json={})
    assert create.status_code == 200
    share_id = create.json()["id"]
    token = create.json()["token"]

    next_expiry = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
    update = client.patch(f"/api/shares/{share_id}", json={"expires_at": next_expiry, "title": "Managed share"})
    assert update.status_code == 200
    payload = update.json()
    assert payload["title"] == "Managed share"
    assert payload["expires_at"] is not None
    assert payload["share_url"].endswith(f"/share/{token}")

    shares = client.get(f"/api/conversations/{conversation_id}/shares")
    listed = shares.json()[0]
    assert listed["title"] == "Managed share"
    assert listed["share_url"].endswith(f"/share/{token}")

    past = client.patch(
        f"/api/shares/{share_id}",
        json={"expires_at": (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()},
    )
    assert past.status_code == 400


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
    assert payload["message_count"] == 1
    assert "messages" not in payload
    window = client.get(f"/api/shared/{token}/message-window")
    assert window.status_code == 200
    assert len(window.json()["items"]) == 1
    assert window.json()["items"][0]["id"] == selected_message_id
    assert "raw_storage_uri" not in str(payload)
    assert "storage/imports" not in str(payload)

    second = client.get(f"/api/shared/{token}")
    assert second.status_code == 200
    shares = client.get(f"/api/conversations/{conversation_id}/shares").json()
    assert shares[0]["access_count"] == 2


def test_shared_readonly_response_uses_heavy_message_preview(client: TestClient) -> None:
    long_text = "# Long answer\n\n" + ("content line\n" * 1200)
    preview = client.post(
        "/api/imports/preview",
        files={
            "files": (
                "share-heavy.json",
                json.dumps(
                    {
                        "metadata": {"title": "Share Heavy", "powered_by": "ChatGPT Exporter"},
                        "messages": [
                            {"role": "Prompt", "say": "question"},
                            {"role": "Response", "say": long_text},
                        ],
                    }
                ).encode(),
                "application/json",
            )
        },
    )
    conversation_id = client.post(f"/api/imports/{preview.json()['import_id']}/commit").json()["conversation_ids"][0]
    create = client.post(f"/api/conversations/{conversation_id}/shares", json={})
    token = create.json()["token"]

    bootstrap = client.get(f"/api/shared/{token}")
    assert bootstrap.status_code == 200
    response = client.get(f"/api/shared/{token}/message-window")
    assert response.status_code == 200
    heavy = response.json()["items"][1]
    assert heavy["is_heavy"] is True
    assert heavy["content_truncated"] is True
    assert heavy["render_blocks"] == []
    assert heavy["current_version"]["blocks"] == []
    assert len(heavy["current_version"]["display_text"]) <= 500
    assert len(response.content) < 20_000


def test_shared_paged_endpoints_enforce_selected_scope(client: TestClient) -> None:
    sample = commit_edit_sample(client)
    conversation_id = sample["conversation_id"]
    selected_message_id = sample["messages"][0]["id"]
    hidden_message_id = sample["messages"][1]["id"]
    create = client.post(
        f"/api/conversations/{conversation_id}/shares",
        json={"scope": "selected_messages", "selected_message_ids": [selected_message_id]},
    )
    token = create.json()["token"]

    index = client.get(f"/api/shared/{token}/dialogue-index")
    assert index.status_code == 200
    assert index.json()["total"] == 1
    assert index.json()["items"][0]["message_id"] == selected_message_id

    hidden_window = client.get(
        f"/api/shared/{token}/message-window",
        params={"anchor_message_id": hidden_message_id},
    )
    assert hidden_window.status_code == 404
    hidden_blocks = client.get(f"/api/shared/{token}/messages/{hidden_message_id}/blocks")
    assert hidden_blocks.status_code == 404


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
