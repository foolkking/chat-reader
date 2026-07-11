import json

from fastapi.testclient import TestClient

from test_import_preview_api import client  # noqa: F401


def _commit_messages(client: TestClient, title: str, messages: list[dict]) -> str:
    preview = client.post(
        "/api/imports/preview",
        files={
            "files": (
                f"{title}.json",
                json.dumps(
                    {
                        "metadata": {"title": title, "powered_by": "ChatGPT Exporter"},
                        "messages": messages,
                    }
                ).encode(),
                "application/json",
            )
        },
    )
    assert preview.status_code == 200
    commit = client.post(f"/api/imports/{preview.json()['import_id']}/commit")
    assert commit.status_code == 200
    return commit.json()["conversation_ids"][0]


def _window(client: TestClient, conversation_id: str, **params) -> dict:
    response = client.get(f"/api/conversations/{conversation_id}/message-window", params=params)
    assert response.status_code == 200
    return response.json()


def test_split_message_creates_inserted_message_version_event_and_reindex(client: TestClient) -> None:
    conversation_id = _commit_messages(
        client,
        "Split Message",
        [
            {"role": "Prompt", "say": "Question"},
            {"role": "Response", "say": "# First\n\nAlpha paragraph.\n\n# Second\n\nBeta paragraph."},
        ],
    )
    assistant = _window(client, conversation_id, include_blocks=True, limit=10)["items"][1]
    split_offset = assistant["current_version"]["display_text"].index("# Second")

    split = client.post(
        f"/api/messages/{assistant['id']}/split",
        json={"split_offset": split_offset, "edit_reason": "separate sections"},
    )

    assert split.status_code == 200
    payload = split.json()
    assert payload["original_message_id"] == assistant["id"]
    assert payload["new_message_id"] != assistant["id"]

    messages = _window(client, conversation_id, include_blocks=True, limit=10)["items"]
    assert len(messages) == 3
    assert messages[1]["current_version"]["display_text"].startswith("# First")
    assert messages[2]["current_version"]["display_text"].startswith("# Second")

    toc = client.get(f"/api/conversations/{conversation_id}/toc")
    assert toc.status_code == 200
    toc_text = [item["text"] for item in toc.json()["items"]]
    assert toc_text == ["First", "Second"]

    search = client.get("/api/search", params={"q": "Beta paragraph", "conversation_id": conversation_id})
    assert search.status_code == 200
    assert search.json()["total"] >= 1

    events = client.get(f"/api/conversations/{conversation_id}/events?event_type=message_split")
    assert events.status_code == 200
    assert events.json()["total"] == 1


def test_merge_adjacent_same_role_messages_soft_deletes_absorbed_message(client: TestClient) -> None:
    conversation_id = _commit_messages(
        client,
        "Merge Messages",
        [
            {"role": "Prompt", "say": "Question"},
            {"role": "Response", "say": "First assistant part"},
            {"role": "Response", "say": "Second assistant part"},
        ],
    )
    messages = _window(client, conversation_id, limit=10)["items"]
    first_assistant = messages[1]
    second_assistant = messages[2]

    merge = client.post(
        "/api/messages/merge",
        json={"message_ids": [first_assistant["id"], second_assistant["id"]], "separator": "\n---\n"},
    )

    assert merge.status_code == 200
    payload = merge.json()
    assert payload["survivor_message_id"] == first_assistant["id"]
    assert second_assistant["id"] in payload["merged_message_ids"]

    messages_after = _window(client, conversation_id, limit=10)["items"]
    assert len(messages_after) == 2
    merged_text = messages_after[1]["current_version"]["display_text"]
    assert "First assistant part" in merged_text
    assert "Second assistant part" in merged_text

    deleted_detail = client.get(f"/api/messages/{second_assistant['id']}")
    assert deleted_detail.status_code == 200
    assert deleted_detail.json()["order_key"].startswith("deleted-")


def test_conversation_merge_and_split_create_new_conversations_without_modifying_sources(client: TestClient) -> None:
    first_id = _commit_messages(
        client,
        "Merge Source One",
        [{"role": "Prompt", "say": "first q"}, {"role": "Response", "say": "first a"}],
    )
    second_id = _commit_messages(
        client,
        "Merge Source Two",
        [{"role": "Prompt", "say": "second q"}, {"role": "Response", "say": "second a"}],
    )

    merge = client.post(
        "/api/conversations/merge",
        json={"conversation_ids": [first_id, second_id], "title": "Merged Sources"},
    )
    assert merge.status_code == 200
    merged_id = merge.json()["conversation_id"]
    assert merged_id not in {first_id, second_id}
    assert merge.json()["message_count"] == 4
    assert _window(client, first_id, limit=10)["total"] == 2
    assert _window(client, second_id, limit=10)["total"] == 2

    merged_messages = _window(client, merged_id, limit=10)["items"]
    split = client.post(
        f"/api/conversations/{merged_id}/split",
        json={
            "start_message_id": merged_messages[1]["id"],
            "end_message_id": merged_messages[2]["id"],
            "title": "Middle Range",
        },
    )
    assert split.status_code == 200
    split_id = split.json()["conversation_id"]
    assert split_id != merged_id
    assert split.json()["message_count"] == 2
    assert _window(client, merged_id, limit=10)["total"] == 4


def test_message_window_anchor_returns_page_containing_far_target(client: TestClient) -> None:
    messages = [
        {"role": "Prompt" if index % 2 == 0 else "Response", "say": f"Message {index:03d}"}
        for index in range(120)
    ]
    conversation_id = _commit_messages(client, "Anchor Window", messages)
    target = _window(client, conversation_id, limit=1, offset=95)["items"][0]

    anchored = _window(
        client,
        conversation_id,
        limit=20,
        include_blocks=False,
        anchor_message_id=target["id"],
    )

    assert anchored["offset"] < 95
    assert anchored["offset"] + len(anchored["items"]) > 95
    assert target["id"] in {item["id"] for item in anchored["items"]}
