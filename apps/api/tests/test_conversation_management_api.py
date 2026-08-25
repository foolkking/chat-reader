import uuid

from fastapi.testclient import TestClient

from test_import_preview_api import client  # noqa: F401
from test_projects_api import _commit_conversation
from background_job_test_utils import process_queued_jobs


def test_update_conversation_renames_archives_and_writes_events(client: TestClient) -> None:
    conversation_id = _commit_conversation(client, "Manage Rename")

    renamed = client.patch(
        f"/api/conversations/{conversation_id}",
        json={"title": "Renamed Conversation", "display_title": "Renamed Display"},
    )
    assert renamed.status_code == 200
    assert renamed.json()["title"] == "Renamed Conversation"
    assert renamed.json()["display_title"] == "Renamed Display"

    archived = client.patch(f"/api/conversations/{conversation_id}", json={"status": "archived"})
    assert archived.status_code == 200
    assert archived.json()["status"] == "archived"

    default_list = client.get("/api/conversations")
    assert conversation_id not in {item["id"] for item in default_list.json()}
    archived_list = client.get("/api/conversations", params={"include_archived": True})
    assert conversation_id in {item["id"] for item in archived_list.json()}

    restored = client.patch(f"/api/conversations/{conversation_id}", json={"status": "active"})
    assert restored.status_code == 200
    assert restored.json()["status"] == "active"

    events = client.get(f"/api/conversations/{conversation_id}/events")
    assert events.status_code == 200
    event_types = {item["event_type"] for item in events.json()["items"]}
    assert "conversation_renamed" in event_types
    assert "conversation_archived" in event_types
    assert "conversation_restored" in event_types


def test_delete_conversation_is_permanent_and_hides_from_list(client: TestClient) -> None:
    conversation_id = _commit_conversation(client, "Delete Management")

    deleted = client.delete(f"/api/conversations/{conversation_id}")
    assert deleted.status_code == 204

    missing = client.get(f"/api/conversations/{conversation_id}")
    assert missing.status_code == 404

    conversations = client.get("/api/conversations")
    assert conversations.status_code == 200
    assert conversation_id not in {item["id"] for item in conversations.json()}

    assert client.patch(f"/api/conversations/{conversation_id}", json={"status": "active"}).status_code == 404
    assert client.post(f"/api/conversations/{conversation_id}/restore").status_code == 404


def test_batch_delete_is_ordered_background_job_and_commits_each_item(client: TestClient) -> None:
    conversation_ids = [_commit_conversation(client, f"Batch delete {index}") for index in range(3)]
    for conversation_id in conversation_ids:
        assert client.post(f"/api/conversations/{conversation_id}/archive").status_code == 200

    queued = client.post(
        "/api/conversations/batch-delete",
        headers={"Idempotency-Key": "batch-delete-test"},
        json={"conversation_ids": conversation_ids},
    )
    assert queued.status_code == 202
    assert queued.json()["job_type"] == "conversation_batch_delete"
    assert queued.json()["total_items"] == 3

    # Deletion deliberately yields after each conversation so imports and
    # interactive jobs can run between items.
    processed = process_queued_jobs(max_jobs=10)
    assert str(queued.json()["job_id"]) in {str(item) for item in processed}
    assert processed.count(uuid.UUID(queued.json()["job_id"])) == 3
    task = client.get(f"/api/tasks/{queued.json()['job_id']}")
    assert task.status_code == 200
    assert task.json()["status"] == "committed"
    assert task.json()["result"]["deleted_ids"] == conversation_ids
    assert client.get("/api/conversations", params={"status_scope": "archived"}).json() == []


def test_batch_delete_can_stop_before_the_next_item(client: TestClient) -> None:
    conversation_ids = [_commit_conversation(client, f"Batch cancel {index}") for index in range(2)]
    queued = client.post(
        "/api/conversations/batch-delete",
        json={"conversation_ids": conversation_ids},
    )
    assert queued.status_code == 202
    cancelled = client.post(f"/api/tasks/{queued.json()['job_id']}/cancel")
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"
    assert process_queued_jobs() == []
    assert {item["id"] for item in client.get("/api/conversations").json()} >= set(conversation_ids)


def test_explicit_archive_and_permanent_delete_filter_all_views(client: TestClient) -> None:
    conversation_id = _commit_conversation(client, "Explicit lifecycle")
    assert client.post(f"/api/conversations/{conversation_id}/recent", json={}).status_code == 200

    archived = client.post(f"/api/conversations/{conversation_id}/archive")
    assert archived.status_code == 200
    assert archived.json()["status"] == "archived"
    assert conversation_id not in {item["conversation_id"] for item in client.get("/api/recent-items").json()}
    assert conversation_id in {
        item["id"] for item in client.get("/api/conversations", params={"status_scope": "archived"}).json()
    }

    unarchived = client.post(f"/api/conversations/{conversation_id}/unarchive")
    assert unarchived.status_code == 200
    assert unarchived.json()["status"] == "active"

    assert client.delete(f"/api/conversations/{conversation_id}").status_code == 204
    deleted = client.get("/api/conversations", params={"status_scope": "deleted"})
    assert deleted.status_code == 422
    assert conversation_id not in {item["id"] for item in client.get("/api/conversations").json()}

    assert client.post(f"/api/conversations/{conversation_id}/restore").status_code == 404


def test_conversation_project_membership_compat_routes(client: TestClient) -> None:
    conversation_id = _commit_conversation(client, "Project Membership Compat")
    project_id = client.post("/api/projects", json={"name": "Compat Project"}).json()["id"]

    added = client.post(f"/api/conversations/{conversation_id}/projects/{project_id}")
    assert added.status_code == 200
    assert added.json()["id"] == conversation_id

    project_conversations = client.get(f"/api/projects/{project_id}/conversations")
    assert project_conversations.status_code == 200
    assert [item["id"] for item in project_conversations.json()] == [conversation_id]

    removed = client.delete(f"/api/conversations/{conversation_id}/projects/{project_id}")
    assert removed.status_code == 204

    project_conversations = client.get(f"/api/projects/{project_id}/conversations")
    assert project_conversations.status_code == 200
    assert project_conversations.json() == []

    events = client.get(f"/api/conversations/{conversation_id}/events")
    assert events.status_code == 200
    project_events = [item for item in events.json()["items"] if item["event_type"] == "project_changed"]
    assert {item["payload"]["action"] for item in project_events} == {"added", "removed"}


def test_anchor_window_contains_first_middle_and_last_messages(client: TestClient) -> None:
    preview = client.post(
        "/api/imports/preview",
        files={
            "files": (
                "anchor-many.json",
                (
                    '{"metadata":{"title":"Anchor Many","powered_by":"ChatGPT Exporter"},'
                    '"messages":['
                    + ",".join(
                        f'{{"role":"Prompt","say":"message {index}"}}' for index in range(75)
                    )
                    + "]}"
                ).encode(),
                "application/json",
            )
        },
    )
    conversation_id = client.post(f"/api/imports/{preview.json()['import_id']}/commit").json()["conversation_ids"][0]
    all_messages = client.get(f"/api/conversations/{conversation_id}/message-window", params={"limit": 200}).json()[
        "items"
    ]

    for target in (all_messages[0], all_messages[37], all_messages[-1]):
        window = client.get(
            f"/api/conversations/{conversation_id}/message-window",
            params={"limit": 11, "anchor_message_id": target["id"]},
        )
        assert window.status_code == 200
        assert target["id"] in {item["id"] for item in window.json()["items"]}
