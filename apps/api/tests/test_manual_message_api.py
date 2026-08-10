from __future__ import annotations

from uuid import UUID

from test_import_preview_api import client  # noqa: F401


def test_create_manual_conversation_creates_user_and_assistant(client) -> None:
    response = client.post(
        "/api/conversations",
        json={
            "title": "Manual conversation",
            "messages": [
                {"role": "user", "content_markdown": "Question"},
                {"role": "assistant", "content_markdown": "Answer"},
            ],
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["conversation"]["source_profile"] == "chat_reader_manual"
    assert [item["role"] for item in payload["messages"]] == ["user", "assistant"]
    assert payload["conversation"]["message_count"] == 2


def test_manual_insert_defaults_to_opposite_role_and_pair(client) -> None:
    created = client.post(
        "/api/conversations",
        json={
            "title": "Insert conversation",
            "messages": [
                {"role": "user", "content_markdown": "Question"},
                {"role": "assistant", "content_markdown": "Answer"},
            ],
        },
    ).json()
    conversation_id = created["conversation"]["id"]
    anchor_id = created["messages"][1]["id"]

    single = client.post(
        f"/api/conversations/{conversation_id}/messages/insert",
        json={
            "anchor_message_id": anchor_id,
            "position": "after",
            "mode": "single",
            "messages": [{"content_markdown": "Follow-up user"}],
            "expected_offline_revision": created["conversation"]["offline_revision"],
        },
    )
    assert single.status_code == 201, single.text
    inserted = single.json()["messages"][0]
    assert inserted["role"] == "user"

    pair = client.post(
        f"/api/conversations/{conversation_id}/messages/insert",
        json={
            "anchor_message_id": anchor_id,
            "position": "before",
            "mode": "pair",
            "messages": [
                {"role": "user", "content_markdown": "Pair question"},
                {"role": "assistant", "content_markdown": "Pair answer"},
            ],
        },
    )
    assert pair.status_code == 201, pair.text
    assert [item["role"] for item in pair.json()["messages"]] == ["user", "assistant"]

    window = client.get(f"/api/conversations/{conversation_id}/message-window?limit=10")
    assert window.status_code == 200
    items = window.json()["items"]
    assert [item["current_version"]["display_text"] for item in items] == [
        "Question",
        "Pair question",
        "Pair answer",
        "Answer",
        "Follow-up user",
    ]


def test_manual_message_delete_and_restore_without_trash(client) -> None:
    created = client.post(
        "/api/conversations",
        json={
            "title": "Delete conversation",
            "messages": [
                {"role": "user", "content_markdown": "Question"},
                {"role": "assistant", "content_markdown": "Answer"},
            ],
        },
    ).json()
    conversation_id = UUID(created["conversation"]["id"])
    message_id = created["messages"][0]["id"]

    deleted = client.delete(f"/api/messages/{message_id}")
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["deleted"] is True
    deleted_revision = deleted.json()["conversation_revision"]
    assert deleted_revision > created["conversation"]["offline_revision"]
    assert client.get(f"/api/conversations/{conversation_id}/message-window?limit=10").json()["total"] == 1

    restored = client.post(f"/api/messages/{message_id}/restore?expected_offline_revision={deleted_revision}")
    assert restored.status_code == 200, restored.text
    assert restored.json()["deleted"] is False
    assert restored.json()["conversation_revision"] > deleted_revision
    assert client.get(f"/api/conversations/{conversation_id}/message-window?limit=10").json()["total"] == 2
    repeated = client.post(f"/api/messages/{message_id}/restore?expected_offline_revision={restored.json()['conversation_revision']}")
    assert repeated.status_code == 200, repeated.text
    assert repeated.json()["deleted"] is False
    assert repeated.json()["conversation_revision"] == restored.json()["conversation_revision"]
    assert client.get(f"/api/conversations/{conversation_id}/message-window?limit=10").json()["total"] == 2


def test_manual_insert_rejects_stale_revision(client) -> None:
    created = client.post(
        "/api/conversations",
        json={
            "title": "Conflict conversation",
            "messages": [
                {"role": "user", "content_markdown": "Question"},
                {"role": "assistant", "content_markdown": "Answer"},
            ],
        },
    ).json()
    conversation_id = created["conversation"]["id"]
    anchor_id = created["messages"][0]["id"]
    response = client.post(
        f"/api/conversations/{conversation_id}/messages/insert",
        json={
            "anchor_message_id": anchor_id,
            "position": "after",
            "mode": "single",
            "messages": [{"content_markdown": "stale"}],
            "expected_offline_revision": 1,
        },
    )
    assert response.status_code == 409
