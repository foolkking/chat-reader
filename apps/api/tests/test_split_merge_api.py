import json
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app.core.database import get_db
from app.main import app
from app.models.attachment import Attachment, MessageVersionAttachment
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.services.background_jobs import claim_next_job, process_background_job
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


def _complete_background_job(job_id: str) -> None:
    override = app.dependency_overrides[get_db]
    override_generator = override()
    fixture_db = next(override_generator)
    testing_session_local = sessionmaker(bind=fixture_db.get_bind(), autoflush=False, autocommit=False)
    fixture_db.close()
    override_generator.close()

    with testing_session_local() as db:
        claimed_id = claim_next_job(db)
        assert claimed_id == uuid.UUID(job_id)
        db.commit()
    process_background_job(uuid.UUID(job_id), testing_session_local)


@contextmanager
def _database_session():
    override = app.dependency_overrides[get_db]
    generator = override()
    db = next(generator)
    try:
        yield db
    finally:
        db.close()
        generator.close()


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


@pytest.mark.parametrize("corruption", ["inactive_attachment", "missing_occurrence", "missing_block"])
def test_message_merge_rejects_broken_attachment_graph_without_mutation(
    client: TestClient,
    corruption: str,
) -> None:
    conversation_id = _commit_messages(
        client,
        "Broken Message Merge",
        [
            {"role": "Prompt", "say": "Question"},
            {"role": "Response", "say": "First assistant part"},
            {"role": "Response", "say": "Second assistant part"},
        ],
    )
    messages = _window(client, conversation_id, limit=10)["items"]
    first_assistant = messages[1]
    second_assistant = messages[2]
    upload_session = client.post(
        f"/api/conversations/{conversation_id}/attachment-upload-sessions",
        json={
            "target_message_id": first_assistant["id"],
            "base_message_version_id": first_assistant["current_version"]["id"],
        },
    )
    uploaded = client.post(
        f"/api/attachment-upload-sessions/{upload_session.json()['id']}/items",
        files={"file": ("message-merge.txt", b"attachment body", "text/plain")},
    )
    promoted = client.post(
        f"/api/conversations/{conversation_id}/attachments",
        json={"upload_item_ids": [uploaded.json()["id"]]},
    )
    attachment_id = promoted.json()["items"][0]["id"]
    saved = client.patch(
        f"/api/messages/{first_assistant['id']}",
        json={
            "content_markdown": f"[Evidence](cr-asset://{attachment_id})",
            "base_version_id": first_assistant["current_version"]["id"],
        },
    )
    assert saved.status_code == 200, saved.text
    first_version_id = saved.json()["message"]["current_version"]["id"]

    with _database_session() as db:
        attachment = db.get(Attachment, uuid.UUID(attachment_id))
        occurrence = (
            db.query(MessageVersionAttachment)
            .filter(MessageVersionAttachment.message_version_id == uuid.UUID(first_version_id))
            .one()
        )
        if corruption == "inactive_attachment":
            attachment.deleted_at = datetime.now(timezone.utc)
        elif corruption == "missing_occurrence":
            db.delete(occurrence)
        elif corruption == "missing_block":
            occurrence.block_index = 999
        db.commit()

    rejected = client.post(
        "/api/messages/merge",
        json={"message_ids": [first_assistant["id"], second_assistant["id"]]},
    )
    assert rejected.status_code == 422
    assert rejected.json()["detail"]["code"] == "attachment_integrity_invalid"

    with _database_session() as db:
        first_message = db.get(Message, uuid.UUID(first_assistant["id"]))
        second_message = db.get(Message, uuid.UUID(second_assistant["id"]))
        assert first_message is not None and first_message.current_version_id == uuid.UUID(first_version_id)
        assert second_message is not None and second_message.is_deleted is False
        assert (
            db.query(MessageVersion)
            .filter(MessageVersion.message_id == first_message.id)
            .count()
            == 2
        )


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
        headers={"Idempotency-Key": "merge-forward"},
    )
    assert merge.status_code == 202
    assert merge.json()["status"] == "queued"
    forward_job_id = merge.json()["job_id"]

    duplicate = client.post(
        "/api/conversations/merge",
        json={"conversation_ids": [first_id, second_id], "title": "Merged Sources"},
        headers={"Idempotency-Key": "merge-forward"},
    )
    assert duplicate.status_code == 202
    assert duplicate.json()["job_id"] == forward_job_id

    _complete_background_job(forward_job_id)
    completed = client.get(f"/api/tasks/{forward_job_id}")
    assert completed.status_code == 200
    assert completed.json()["status"] == "committed"
    assert completed.json()["progress"] == 100
    merged_id = completed.json()["result"]["conversation_id"]
    assert merged_id not in {first_id, second_id}
    assert completed.json()["result"]["message_count"] == 4
    assert _window(client, first_id, limit=10)["total"] == 2
    assert _window(client, second_id, limit=10)["total"] == 2

    merged_messages = _window(client, merged_id, limit=10)["items"]
    assert [message["current_version"]["display_text"] for message in merged_messages] == [
        "first q",
        "first a",
        "second q",
        "second a",
    ]

    reverse_merge = client.post(
        "/api/conversations/merge",
        json={"conversation_ids": [second_id, first_id], "title": "Reverse Merged Sources"},
    )
    assert reverse_merge.status_code == 202
    _complete_background_job(reverse_merge.json()["job_id"])
    reverse_task = client.get(f"/api/tasks/{reverse_merge.json()['job_id']}").json()
    reverse_messages = _window(client, reverse_task["result"]["conversation_id"], limit=10)["items"]
    assert [message["current_version"]["display_text"] for message in reverse_messages] == [
        "second q",
        "second a",
        "first q",
        "first a",
    ]

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


def test_split_workspace_plans_and_executes_range_boundary_and_discrete_modes(client: TestClient) -> None:
    conversation_id = _commit_messages(
        client,
        "Workspace Split",
        [
            {"role": "Prompt", "say": "Question 0"},
            {"role": "Response", "say": "Answer 1"},
            {"role": "Prompt", "say": "Question 2"},
            {"role": "Response", "say": "Answer 3"},
        ],
    )
    messages = _window(client, conversation_id, limit=10)["items"]

    range_preview = client.post(
        f"/api/conversations/{conversation_id}/split-workspace/preview",
        json={"mode": "range_copy", "start_message_id": messages[1]["id"], "end_message_id": messages[3]["id"]},
    )
    assert range_preview.status_code == 200
    assert range_preview.json()["groups"][0]["message_count"] == 3
    range_created = client.post(
        f"/api/conversations/{conversation_id}/split-workspace",
        json={"mode": "range_copy", "start_message_id": messages[1]["id"], "end_message_id": messages[3]["id"], "titles": ["Range result"]},
    )
    assert range_created.status_code == 200
    range_id = range_created.json()["conversations"][0]["conversation_id"]
    assert _window(client, range_id, limit=10)["total"] == 3
    assert _window(client, conversation_id, limit=10)["total"] == 4

    boundary_preview = client.post(
        f"/api/conversations/{conversation_id}/split-workspace/preview",
        json={"mode": "boundary_copy", "boundary_message_id": messages[1]["id"]},
    )
    assert boundary_preview.status_code == 200
    assert [group["message_count"] for group in boundary_preview.json()["groups"]] == [2, 2]
    boundary_created = client.post(
        f"/api/conversations/{conversation_id}/split-workspace",
        json={"mode": "boundary_copy", "boundary_message_id": messages[1]["id"], "titles": ["Before", "After"]},
    )
    assert boundary_created.status_code == 200
    assert [item["message_count"] for item in boundary_created.json()["conversations"]] == [2, 2]

    discrete_preview = client.post(
        f"/api/conversations/{conversation_id}/split-workspace/preview",
        json={"mode": "discrete_copy", "message_ids": [messages[0]["id"], messages[2]["id"]]},
    )
    assert discrete_preview.status_code == 200
    assert discrete_preview.json()["groups"][0]["message_ids"] == [messages[0]["id"], messages[2]["id"]]
    discrete_created = client.post(
        f"/api/conversations/{conversation_id}/split-workspace",
        json={"mode": "discrete_copy", "message_ids": [messages[0]["id"], messages[2]["id"]], "titles": ["Discrete"]},
    )
    assert discrete_created.status_code == 200
    assert _window(client, discrete_created.json()["conversations"][0]["conversation_id"], limit=10)["total"] == 2
