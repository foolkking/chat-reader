from fastapi.testclient import TestClient

from test_import_preview_api import client  # noqa: F401
from test_projects_api import _commit_conversation


def test_global_pin_sets_clears_and_sorts_first(client: TestClient) -> None:
    first_id = _commit_conversation(client, "Unpinned")
    second_id = _commit_conversation(client, "Pinned")

    pinned = client.patch(f"/api/conversations/{second_id}/pin", json={"is_pinned": True})
    assert pinned.status_code == 200
    assert pinned.json()["is_global_pinned"] is True
    assert pinned.json()["global_pinned_at"] is not None

    conversations = client.get("/api/conversations")
    assert conversations.status_code == 200
    assert conversations.json()[0]["id"] == second_id
    assert any(conversation["id"] == first_id for conversation in conversations.json())

    cleared = client.patch(f"/api/conversations/{second_id}/pin", json={"is_pinned": False})
    assert cleared.status_code == 200
    assert cleared.json()["is_global_pinned"] is False
    assert cleared.json()["global_pinned_at"] is None


def test_project_pin_sorts_inside_project_only(client: TestClient) -> None:
    first_id = _commit_conversation(client, "Project Unpinned")
    second_id = _commit_conversation(client, "Project Pinned")
    project_id = client.post("/api/projects", json={"name": "Pin Scope"}).json()["id"]

    assert client.post(f"/api/projects/{project_id}/conversations/{first_id}").status_code == 200
    assert client.post(f"/api/projects/{project_id}/conversations/{second_id}").status_code == 200

    pinned = client.patch(
        f"/api/projects/{project_id}/conversations/{second_id}/pin",
        json={"is_pinned": True},
    )
    assert pinned.status_code == 200
    assert pinned.json()["project_relation"]["is_pinned"] is True

    project_conversations = client.get(f"/api/projects/{project_id}/conversations")
    assert project_conversations.status_code == 200
    assert project_conversations.json()[0]["id"] == second_id

    global_detail = client.get(f"/api/conversations/{second_id}")
    assert global_detail.json()["is_global_pinned"] is False
