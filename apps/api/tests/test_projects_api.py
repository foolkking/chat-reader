import json

from fastapi.testclient import TestClient

from test_import_preview_api import client  # noqa: F401


def _commit_conversation(client: TestClient, title: str = "Project API") -> str:
    preview = client.post(
        "/api/imports/preview",
        files={
            "files": (
                f"{title}.json",
                json.dumps(
                    {
                        "metadata": {"title": title, "powered_by": "ChatGPT Exporter"},
                        "messages": [{"role": "Prompt", "say": "hello"}],
                    }
                ).encode(),
                "application/json",
            )
        },
    )
    import_id = preview.json()["import_id"]
    return client.post(f"/api/imports/{import_id}/commit").json()["conversation_ids"][0]


def test_projects_default_inbox_and_create_update(client: TestClient) -> None:
    projects = client.get("/api/projects")
    assert projects.status_code == 200
    inbox = projects.json()[0]
    assert inbox["name"] == "Inbox"
    assert inbox["is_default"] is True

    created = client.post(
        "/api/projects",
        json={"name": "Research", "description": "Reading collection", "color": "#6366f1", "icon": "folder"},
    )
    assert created.status_code == 201
    project_id = created.json()["id"]

    updated = client.patch(project_id_path(project_id), json={"name": "Research Notes", "color": "#0f172a"})
    assert updated.status_code == 200
    assert updated.json()["name"] == "Research Notes"
    assert updated.json()["color"] == "#0f172a"


def test_default_project_cannot_be_archived(client: TestClient) -> None:
    inbox = client.get("/api/projects").json()[0]
    response = client.patch(project_id_path(inbox["id"]), json={"is_archived": True})
    assert response.status_code == 400


def test_add_and_remove_conversation_to_project(client: TestClient) -> None:
    conversation_id = _commit_conversation(client, "Project Membership")
    inbox = client.get("/api/projects").json()[0]

    inbox_conversations = client.get(f"/api/projects/{inbox['id']}/conversations")
    assert inbox_conversations.status_code == 200
    assert inbox_conversations.json()[0]["id"] == conversation_id

    project_id = client.post("/api/projects", json={"name": "Archive"}).json()["id"]
    first_add = client.post(f"/api/projects/{project_id}/conversations/{conversation_id}")
    second_add = client.post(f"/api/projects/{project_id}/conversations/{conversation_id}")
    assert first_add.status_code == 200
    assert second_add.status_code == 200
    assert first_add.json()["id"] == second_add.json()["id"]

    project_conversations = client.get(f"/api/projects/{project_id}/conversations")
    assert len(project_conversations.json()) == 1

    removed = client.delete(f"/api/projects/{project_id}/conversations/{conversation_id}")
    assert removed.status_code == 204
    missing = client.delete(f"/api/projects/{project_id}/conversations/{conversation_id}")
    assert missing.status_code == 404


def project_id_path(project_id: str) -> str:
    return f"/api/projects/{project_id}"
