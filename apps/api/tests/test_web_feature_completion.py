from datetime import datetime, timedelta, timezone
import io
import json
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from app.core import auth_middleware
from app.models.conversation_event import ConversationEvent
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.attachment import Attachment, MessageVersionAttachment
from app.models.share import Share
from app.models.share_snapshot import ShareSnapshot
from app.services.sharing.share_service import reclaim_expired_frozen_snapshots
from app.services.offline_packages import _write_conversation_payload
from test_auth import auth_client  # noqa: F401
from test_my_shares import conversation, register


def messages(client, source):
    return client.get(f"/api/conversations/{source['id']}/reader-turn").json()["items"]


def test_share_preview_is_scoped_private_and_has_no_creation_side_effects(auth_client: TestClient):
    register(auth_client, "preview-owner")
    source = conversation(auth_client, "Synthetic preview")
    rows = messages(auth_client, source)
    path = f"/api/conversations/{source['id']}/shares/preview"
    with auth_middleware.SessionLocal() as db:
        before = (db.query(Share).count(), db.query(ConversationEvent).count())
    result = auth_client.post(path, json={"scope": "selected_messages", "selected_message_ids": [rows[0]["id"]]})
    assert result.status_code == 200, result.text
    assert result.headers["cache-control"] == "no-store"
    data = result.json()
    assert data["message_count"] == 1 and data["turn_count"] == 1
    assert [item["id"] for item in data["sampled_turn"]["items"]] == [rows[0]["id"]]
    assert not data["capabilities"]["annotations"] and data["description_markdown"] is None
    assert "token" not in data and "share_url" not in data
    assert auth_client.post(path, params={"anchor_message_id": rows[1]["id"]}, json={
        "scope": "selected_messages", "selected_message_ids": [rows[0]["id"]],
    }).status_code == 404
    with auth_middleware.SessionLocal() as db:
        assert (db.query(Share).count(), db.query(ConversationEvent).count()) == before
    register(auth_client, "preview-other")
    assert auth_client.post(path, json={}).status_code == 404


def test_frozen_share_preserves_original_blocks_and_scope_after_edit(auth_client: TestClient):
    register(auth_client, "frozen-owner")
    source = conversation(auth_client, "Synthetic frozen")
    rows = messages(auth_client, source)
    created = auth_client.post(f"/api/conversations/{source['id']}/shares", json={
        "content_mode": "frozen", "scope": "selected_messages", "selected_message_ids": [rows[1]["id"]],
    })
    assert created.status_code == 200, created.text
    share = created.json()
    public = f"/api/shared/{share['token']}"
    initial = auth_client.get(public + "/reader-turn").json()
    assert initial["items"][0]["current_version"]["display_text"] == "Synthetic private answer"
    assert auth_client.patch(f"/api/messages/{rows[1]['id']}", json={"display_text": "# Changed source\n\nChanged answer"}).status_code == 200
    assert auth_client.get(public + "/reader-turn").json() == initial
    with auth_middleware.SessionLocal() as db:
        db.get(Message, UUID(rows[1]["id"])).is_deleted = True
        db.commit()
    assert auth_client.get(public + "/reader-turn").json() == initial
    assert auth_client.get(public).json()["share"]["content_mode"] == "frozen"
    assert auth_client.get(public + "/dialogue-index").json()["total"] == 1
    assert auth_client.get(public + "/message-window").json()["items"] == initial["items"]
    assert auth_client.get(public + f"/messages/{rows[0]['id']}/blocks").status_code == 404
    block = initial["items"][0]["render_blocks"][0]
    locator = auth_client.post(public + "/resolve-locator", json={
        "message_id": rows[1]["id"], "render_block_id": block["id"],
        "message_version_id": initial["items"][0]["current_version"]["id"],
    })
    assert locator.status_code == 200 and locator.json()["status"] == "EXACT"
    assert auth_client.patch(f"/api/shares/{share['id']}", json={"include_description": True}).status_code == 409
    assert auth_client.patch(f"/api/shares/{share['id']}", json={"title": "New label"}).status_code == 200
    assert auth_client.post(f"/api/shares/{share['id']}/revoke").status_code == 200
    assert auth_client.get(public).status_code == 410
    with auth_middleware.SessionLocal() as db:
        assert db.get(ShareSnapshot, UUID(share["id"])) is None


@pytest.mark.parametrize("option", ["include_annotations", "include_notebook", "allow_export"])
def test_frozen_unsupported_options_reject_without_orphan_rows(auth_client: TestClient, option):
    register(auth_client, "frozen-options")
    source = conversation(auth_client, "Synthetic frozen options")
    for suffix in ["", "/preview"]:
        response = auth_client.post(f"/api/conversations/{source['id']}/shares{suffix}", json={"content_mode": "frozen", option: True})
        assert response.status_code == 422
    with auth_middleware.SessionLocal() as db:
        assert db.query(Share).count() == 0 and db.query(ShareSnapshot).count() == 0


def test_expired_frozen_payload_is_reclaimed_and_cannot_be_reenabled(auth_client: TestClient):
    register(auth_client, "frozen-expiry")
    source = conversation(auth_client, "Synthetic frozen expiry")
    created = auth_client.post(f"/api/conversations/{source['id']}/shares", json={"content_mode": "frozen"}).json()
    now = datetime.now(timezone.utc)
    with auth_middleware.SessionLocal() as db:
        db.get(Share, UUID(created["id"])).expires_at = now - timedelta(seconds=1)
        db.commit()
    assert auth_client.get(f"/api/shared/{created['token']}").status_code == 410
    assert reclaim_expired_frozen_snapshots(auth_middleware.SessionLocal, now=now) == 1
    assert reclaim_expired_frozen_snapshots(auth_middleware.SessionLocal, now=now) == 0
    assert auth_client.patch(f"/api/shares/{created['id']}", json={"expires_at": (now + timedelta(days=1)).isoformat()}).status_code == 409


def test_new_message_baseline_is_explicit_and_compares_identity_not_edits(auth_client: TestClient):
    register(auth_client, "baseline-owner")
    source = conversation(auth_client, "Synthetic new content")
    rows = messages(auth_client, source)
    path = f"/api/conversations/{source['id']}/new-messages"
    unknown = auth_client.get(path)
    assert unknown.status_code == 200 and unknown.headers["cache-control"] == "no-store"
    assert unknown.json()["baseline_available"] is False and unknown.json()["new_message_count"] is None
    captured = auth_client.post(path + "/baseline")
    assert captured.status_code == 200 and captured.json()["message_count"] == 2
    assert auth_client.patch(f"/api/messages/{rows[1]['id']}", json={"display_text": "Edited existing content"}).status_code == 200
    assert auth_client.get(path).json()["new_message_count"] == 0
    revision = auth_client.get(f"/api/conversations/{source['id']}").json()["offline_revision"]
    inserted = auth_client.post(f"/api/conversations/{source['id']}/messages/insert", json={
        "anchor_message_id": rows[1]["id"], "position": "after", "mode": "single",
        "messages": [{"content_markdown": "Synthetic new message"}], "expected_offline_revision": revision,
    })
    assert inserted.status_code == 201, inserted.text
    new_id = inserted.json()["messages"][0]["id"]
    for _ in range(2):
        changes = auth_client.get(path).json()
        assert changes["new_message_count"] == 1 and changes["first_new_message_id"] == new_id
    assert auth_client.post(path + "/baseline").json()["message_count"] == 3
    assert auth_client.get(path).json()["new_message_count"] == 0
    register(auth_client, "baseline-other")
    assert auth_client.get(path).status_code == 404
    assert auth_client.post(path + "/baseline").status_code == 404


def test_tags_normalize_names_keep_empty_tags_and_reject_foreign_members(auth_client: TestClient):
    register(auth_client, "tags-owner")
    source = conversation(auth_client, "Synthetic tagged")
    entry_id = str(uuid4())
    path = f"/api/user-feature-entries/conversation-tag/{entry_id}"
    created = auth_client.put(path, json={"expected_revision": 0, "value": {"name": "  Ｎｏｔｅｓ  ", "conversation_ids": [source["id"]]}})
    assert created.status_code == 200, created.text
    first_revision = auth_client.get(f"/api/conversations/{source['id']}").json()["offline_revision"]
    assert first_revision > source["offline_revision"]
    with auth_middleware.SessionLocal() as db:
        canonical = db.get(Conversation, UUID(source["id"]))
        output = io.BytesIO()
        _write_conversation_payload(output, db, canonical, subject_key=str(canonical.owner_user_id))
        assert json.loads(output.getvalue())["tags"] == ["Ｎｏｔｅｓ"]
        other_output = io.BytesIO()
        _write_conversation_payload(other_output, db, canonical, subject_key="synthetic-other")
        assert json.loads(other_output.getvalue())["tags"] == []
    duplicate = auth_client.put(f"/api/user-feature-entries/conversation-tag/{uuid4()}", json={
        "expected_revision": 0, "value": {"name": "notes", "conversation_ids": []},
    })
    assert duplicate.status_code == 409
    assert auth_client.put(path, json={"expected_revision": 1, "value": {"name": "Renamed", "conversation_ids": []}}).status_code == 200
    assert auth_client.get(f"/api/conversations/{source['id']}").json()["offline_revision"] > first_revision
    assert auth_client.get("/api/user-feature-entries/conversation-tag").json()[0]["value"]["conversation_ids"] == []
    assert auth_client.delete(path + "?expected_revision=1").status_code == 409
    register(auth_client, "tags-other")
    assert auth_client.get("/api/user-feature-entries/conversation-tag").json() == []
    assert auth_client.put(f"/api/user-feature-entries/conversation-tag/{uuid4()}", json={
        "expected_revision": 0, "value": {"name": "Private", "conversation_ids": [source["id"]]},
    }).status_code == 409


def test_reading_baseline_includes_all_batches_and_excludes_deleted_messages(auth_client: TestClient):
    register(auth_client, "baseline-batches")
    source = conversation(auth_client, "Synthetic large baseline")
    with auth_middleware.SessionLocal() as db:
        db.add_all(Message(
            id=uuid4(), conversation_id=UUID(source["id"]), role="assistant",
            order_key=f"synthetic-batch-{index:06d}", is_deleted=index == 1000,
        ) for index in range(1001))
        db.commit()
    path = f"/api/conversations/{source['id']}/new-messages"
    assert auth_client.post(path + "/baseline").json()["message_count"] == 1002
    assert auth_client.get(path).json()["new_message_count"] == 0


def test_frozen_attachment_rejection_is_explicit_and_preview_has_no_orphans(auth_client: TestClient):
    register(auth_client, "frozen-attachments")
    source = conversation(auth_client, "Synthetic attachment source")
    rows = messages(auth_client, source)
    with auth_middleware.SessionLocal() as db:
        attachment = Attachment(id=uuid4(), conversation_id=UUID(source["id"]),
                                original_filename="synthetic.txt", display_name="synthetic.txt")
        db.add(attachment)
        db.flush()
        db.add(MessageVersionAttachment(message_version_id=UUID(rows[1]["current_version"]["id"]), attachment_id=attachment.id))
        db.commit()
    for suffix in ["", "/preview"]:
        response = auth_client.post(f"/api/conversations/{source['id']}/shares{suffix}", json={"content_mode": "frozen"})
        assert response.status_code == 422 and response.json()["detail"]["code"] == "FROZEN_SHARE_TEXT_ONLY"
    with auth_middleware.SessionLocal() as db:
        assert db.query(Share).count() == 0 and db.query(ShareSnapshot).count() == 0


def test_compare_title_search_is_owner_scoped_and_treats_wildcards_literally(auth_client: TestClient):
    register(auth_client, "compare-search")
    first = conversation(auth_client, "Synthetic 100%_notes")
    conversation(auth_client, "Synthetic other notes")
    assert [row["id"] for row in auth_client.get("/api/conversations", params={"q": "%_"}).json()] == [first["id"]]
    assert len(auth_client.get("/api/conversations", params={"q": "NOTES"}).json()) == 2
    register(auth_client, "compare-search-other")
    assert auth_client.get("/api/conversations", params={"q": "Synthetic"}).json() == []
