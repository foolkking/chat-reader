"""Placement/read contracts on disposable SQLite, not PostgreSQL lock evidence."""

import uuid

import pytest
from fastapi.testclient import TestClient

from test_import_preview_api import client  # noqa: F401
from test_projects_api import _commit_conversation


def _read(client: TestClient, conversation_id: str) -> dict:
    response = client.get(f"/api/conversations/{conversation_id}")
    assert response.status_code == 200
    return response.json()


def _project(client: TestClient, name: str) -> dict:
    response = client.post("/api/projects", json={"name": name})
    assert response.status_code == 201
    return response.json()


def _place(client: TestClient, conversation_id: str, target_id: str | None, revision: int):
    return client.put(f"/api/conversations/{conversation_id}/placement", json={
        "target_project_id": target_id,
        "target_section": "normal",
        "expected_offline_revision": revision,
    })


def _members(client: TestClient, project_id: str) -> list[dict]:
    response = client.get(f"/api/projects/{project_id}/conversations")
    assert response.status_code == 200
    return response.json()


def test_acknowledged_move_has_canonical_location_and_preserves_reading_data(client: TestClient) -> None:
    conversation_id = _commit_conversation(client, "Synthetic placement data")
    path = f"/api/conversations/{conversation_id}"
    source = _project(client, "Synthetic placement source")
    target = _project(client, "Synthetic placement target")
    assert _place(client, conversation_id, source["id"], _read(client, conversation_id)["offline_revision"]).status_code == 200
    assert client.patch(f"{path}/pin", json={"is_pinned": True}).status_code == 200
    messages_response = client.get(f"{path}/message-window")
    assert messages_response.status_code == 200
    messages = messages_response.json()
    anchor_id = messages["items"][0]["id"]
    assert client.post(f"{path}/recent", json={
        "project_id": source["id"], "last_message_id": anchor_id, "context": {"progress": 42, "turn_index": 0},
    }).status_code == 200
    assert client.put(f"{path}/reading-position", json={
        "message_id": anchor_id, "block_index": 0, "scroll_offset": 18, "anchor_data": {"turn_index": 0},
    }).status_code == 200
    before = _read(client, conversation_id)
    position = client.get(f"{path}/reading-position").json()
    recent = client.get("/api/recent-items").json()[0]

    response = _place(client, conversation_id, target["id"], before["offline_revision"])
    assert response.status_code == 200
    result = response.json()
    assert result["placement"]["project_id"] == target["id"]
    assert result["placement"]["target_section"] == "normal"
    assert result["placement"]["is_pinned"] is False
    assert result["source_project_count"] == 0
    assert result["target_project_count"] == 1
    for snapshot in (result["conversation"], _read(client, conversation_id)):
        assert snapshot["project_id"] == target["id"]
        assert snapshot["project_name"] == target["name"]
        assert snapshot["offline_revision"] == before["offline_revision"] + 1
        for field in ("title", "display_title", "description_markdown", "status", "is_global_pinned", "last_read_at", "reading_progress"):
            assert snapshot[field] == before[field]
    assert _members(client, source["id"]) == []
    assert [item["id"] for item in _members(client, target["id"])] == [conversation_id]
    assert client.get(f"{path}/message-window").json() == messages
    assert client.get(f"{path}/reading-position").json() == position
    after_recent = client.get("/api/recent-items").json()[0]
    assert after_recent["project_id"] == target["id"]
    for field in ("last_message_id", "last_opened_at", "open_count", "context"):
        assert after_recent[field] == recent[field]


def test_same_project_move_preserves_pin_order_and_revision(client: TestClient) -> None:
    conversation_id = _commit_conversation(client, "Synthetic placement no-op")
    project = _project(client, "Synthetic no-op project")
    assert _place(client, conversation_id, project["id"], _read(client, conversation_id)["offline_revision"]).status_code == 200
    pinned = client.patch(f"/api/projects/{project['id']}/conversations/{conversation_id}/pin", json={"is_pinned": True})
    assert pinned.status_code == 200
    relation = pinned.json()["project_relation"]
    before = _read(client, conversation_id)
    response = _place(client, conversation_id, project["id"], before["offline_revision"])
    assert response.status_code == 200
    assert response.json()["placement"]["target_section"] == "pinned"
    assert response.json()["placement"]["sort_order"] == relation["sort_order"]
    assert response.json()["placement"]["offline_revision"] == before["offline_revision"]
    assert _members(client, project["id"])[0]["project_relation"] == relation
    assert _read(client, conversation_id) == before


def test_read_review_does_not_move_and_explicit_retry_uses_new_revision(client: TestClient) -> None:
    conversation_id = _commit_conversation(client, "Synthetic placement review")
    first = _project(client, "Synthetic review first")
    second = _project(client, "Synthetic review second")
    original = _read(client, conversation_id)
    assert _place(client, conversation_id, first["id"], original["offline_revision"]).status_code == 200
    assert _place(client, conversation_id, second["id"], original["offline_revision"]).status_code == 409
    observed = _read(client, conversation_id)
    for _ in range(2):
        assert _read(client, conversation_id) == observed
    assert observed["project_id"] == first["id"]
    retried = _place(client, conversation_id, second["id"], observed["offline_revision"])
    assert retried.status_code == 200
    assert retried.json()["conversation"]["project_id"] == second["id"]
    assert retried.json()["placement"]["offline_revision"] == observed["offline_revision"] + 1


def test_null_visible_project_is_ambiguous_until_explicit_default_placement(client: TestClient) -> None:
    conversation_id = _commit_conversation(client, "Synthetic archived membership")
    archived = _project(client, "Synthetic archived placement")
    assert _place(client, conversation_id, archived["id"], _read(client, conversation_id)["offline_revision"]).status_code == 200
    assert client.patch(f"/api/projects/{archived['id']}", json={"is_archived": True}).status_code == 200
    projects = client.get("/api/projects", params={"include_archived": True}).json()
    default = next(item for item in projects if item["is_default"])
    observed = _read(client, conversation_id)
    assert observed["project_id"] is None and observed["project_name"] is None
    assert [item["id"] for item in _members(client, archived["id"])] == [conversation_id]
    assert _members(client, default["id"]) == []
    assert _read(client, conversation_id) == observed

    response = _place(client, conversation_id, None, observed["offline_revision"])
    assert response.status_code == 200
    assert response.json()["placement"]["project_id"] is None
    assert response.json()["placement"]["offline_revision"] == observed["offline_revision"] + 1
    assert _members(client, archived["id"]) == []
    assert [item["id"] for item in _members(client, default["id"])] == [conversation_id]
    assert client.patch(f"/api/projects/{archived['id']}", json={"is_archived": False}).status_code == 200
    assert _members(client, archived["id"]) == []


@pytest.mark.parametrize("target_state", ["archived", "missing"])
def test_unavailable_destination_is_rejected_without_moving(client: TestClient, target_state: str) -> None:
    conversation_id = _commit_conversation(client, "Synthetic unavailable placement")
    target_id = str(uuid.uuid4())
    if target_state == "archived":
        target_id = _project(client, "Synthetic unavailable destination")["id"]
        assert client.patch(f"/api/projects/{target_id}", json={"is_archived": True}).status_code == 200
        assert target_id not in {item["id"] for item in client.get("/api/projects").json()}
    before = _read(client, conversation_id)
    response = _place(client, conversation_id, target_id, before["offline_revision"])
    assert response.status_code == 422
    assert _read(client, conversation_id) == before


def test_archived_conversation_cannot_be_moved(client: TestClient) -> None:
    conversation_id = _commit_conversation(client, "Synthetic inactive placement")
    target = _project(client, "Synthetic inactive destination")
    assert client.patch(f"/api/conversations/{conversation_id}", json={"status": "archived"}).status_code == 200
    before = _read(client, conversation_id)
    assert _place(client, conversation_id, target["id"], before["offline_revision"]).status_code == 422
    assert _read(client, conversation_id) == before


def test_cross_project_move_cannot_bypass_the_normal_section(client: TestClient) -> None:
    conversation_id = _commit_conversation(client, "Synthetic pinned destination")
    target = _project(client, "Synthetic cross-pin destination")
    before = _read(client, conversation_id)
    response = client.put(f"/api/conversations/{conversation_id}/placement", json={
        "target_project_id": target["id"], "target_section": "pinned", "expected_offline_revision": before["offline_revision"],
    })
    assert response.status_code == 422
    assert _read(client, conversation_id) == before
