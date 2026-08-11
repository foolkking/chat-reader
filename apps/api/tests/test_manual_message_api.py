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


def test_initial_notebook_read_does_not_make_first_message_mutation_stale(client) -> None:
    created = client.post(
        "/api/conversations",
        json={
            "title": "Notebook read revision",
            "messages": [
                {"role": "user", "content_markdown": "Question"},
                {"role": "assistant", "content_markdown": "Answer"},
            ],
        },
    ).json()
    conversation_id = created["conversation"]["id"]
    revision = created["conversation"]["offline_revision"]

    notebook = client.get(f"/api/conversations/{conversation_id}/notebook")
    assert notebook.status_code == 200
    assert notebook.json()["blocks"] == []
    assert client.get(f"/api/conversations/{conversation_id}").json()["offline_revision"] == revision

    deleted = client.delete(
        f"/api/messages/{created['messages'][1]['id']}?expected_offline_revision={revision}"
    )
    assert deleted.status_code == 200, deleted.text


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


def test_manual_pair_insert_before_first_message_uses_lexically_sortable_keys(client) -> None:
    created = client.post(
        "/api/conversations",
        json={
            "title": "Insert before first conversation",
            "messages": [
                {"role": "user", "content_markdown": "Original question"},
                {"role": "assistant", "content_markdown": "Original answer"},
            ],
        },
    ).json()
    conversation_id = created["conversation"]["id"]
    first_message_id = created["messages"][0]["id"]

    inserted = client.post(
        f"/api/conversations/{conversation_id}/messages/insert",
        json={
            "anchor_message_id": first_message_id,
            "position": "before",
            "mode": "pair",
            "messages": [
                {"role": "user", "content_markdown": "Earlier question"},
                {"role": "assistant", "content_markdown": "Earlier answer"},
            ],
            "expected_offline_revision": created["conversation"]["offline_revision"],
        },
    )
    assert inserted.status_code == 201, inserted.text

    items = client.get(
        f"/api/conversations/{conversation_id}/message-window?limit=10"
    ).json()["items"]
    assert [item["current_version"]["display_text"] for item in items] == [
        "Earlier question",
        "Earlier answer",
        "Original question",
        "Original answer",
    ]
    assert [item["order_key"] for item in items] == sorted(
        item["order_key"] for item in items
    )


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
