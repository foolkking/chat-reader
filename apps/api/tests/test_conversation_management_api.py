from fastapi.testclient import TestClient

from test_import_preview_api import client  # noqa: F401
from test_projects_api import _commit_conversation


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


def test_delete_conversation_soft_deletes_and_hides_from_list(client: TestClient) -> None:
    conversation_id = _commit_conversation(client, "Delete Management")

    deleted = client.delete(f"/api/conversations/{conversation_id}")
    assert deleted.status_code == 204

    missing = client.get(f"/api/conversations/{conversation_id}")
    assert missing.status_code == 200
    assert missing.json()["status"] == "deleted"

    conversations = client.get("/api/conversations")
    assert conversations.status_code == 200
    assert conversation_id not in {item["id"] for item in conversations.json()}

    restored = client.patch(f"/api/conversations/{conversation_id}", json={"status": "active"})
    assert restored.status_code == 200
    assert restored.json()["status"] == "active"

    conversations = client.get("/api/conversations")
    assert conversations.status_code == 200
    assert conversation_id in {item["id"] for item in conversations.json()}

    events = client.get(f"/api/conversations/{conversation_id}/events")
    assert events.status_code == 200
    event_types = {item["event_type"] for item in events.json()["items"]}
    assert "conversation_deleted" in event_types
    assert "conversation_restored" in event_types


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
