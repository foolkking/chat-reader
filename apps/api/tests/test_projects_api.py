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
    assert conversation_id not in {item["id"] for item in client.get("/api/conversations", params={"scope": "history"}).json()}

    archived = client.patch(f"/api/conversations/{conversation_id}", json={"status": "archived"})
    assert archived.status_code == 200
    assert client.get(f"/api/projects/{project_id}/conversations").json() == []
    restored = client.patch(f"/api/conversations/{conversation_id}", json={"status": "active"})
    assert restored.status_code == 200
    assert [item["id"] for item in client.get(f"/api/projects/{project_id}/conversations").json()] == [conversation_id]

    removed = client.delete(f"/api/projects/{project_id}/conversations/{conversation_id}")
    assert removed.status_code == 204
    assert conversation_id in {item["id"] for item in client.get("/api/conversations", params={"scope": "history"}).json()}
    missing = client.delete(f"/api/projects/{project_id}/conversations/{conversation_id}")
    assert missing.status_code == 404


def test_archived_project_conversations_temporarily_return_to_history(client: TestClient) -> None:
    conversation_id = _commit_conversation(client, "Archived Project Membership")
    project_id = client.post("/api/projects", json={"name": "Temporary Archive"}).json()["id"]
    assert client.put(f"/api/conversations/{conversation_id}/project", json={"project_id": project_id}).status_code == 200

    assert conversation_id not in {item["id"] for item in client.get("/api/conversations", params={"scope": "history"}).json()}
    assert client.patch(project_id_path(project_id), json={"is_archived": True}).status_code == 200
    assert conversation_id in {item["id"] for item in client.get("/api/conversations", params={"scope": "history"}).json()}

    assert client.patch(project_id_path(project_id), json={"is_archived": False}).status_code == 200
    assert conversation_id not in {item["id"] for item in client.get("/api/conversations", params={"scope": "history"}).json()}
    assert [item["id"] for item in client.get(f"/api/projects/{project_id}/conversations").json()] == [conversation_id]


def test_activity_sorting_and_custom_orders(client: TestClient) -> None:
    alpha_id = _commit_conversation(client, "Alpha activity")
    beta_id = _commit_conversation(client, "Beta activity")

    assert client.post(f"/api/conversations/{alpha_id}/recent").status_code == 200
    assert client.post(f"/api/conversations/{beta_id}/recent").status_code == 200
    recent = client.get("/api/conversations", params={"sort": "recent_read", "direction": "desc"}).json()
    assert recent[0]["id"] == beta_id
    assert recent[0]["last_read_at"] is not None

    title_sorted = client.get("/api/conversations", params={"sort": "title", "direction": "asc"}).json()
    assert [item["display_title"] for item in title_sorted] == sorted(
        item["display_title"] for item in title_sorted
    )
    assert client.put("/api/conversations/order", json={"conversation_ids": [beta_id, alpha_id]}).status_code == 204
    custom = client.get("/api/conversations", params={"sort": "custom", "direction": "asc"}).json()
    custom_ids = [item["id"] for item in custom]
    assert custom_ids.index(beta_id) < custom_ids.index(alpha_id)

    first_project = client.post("/api/projects", json={"name": "Alpha project"}).json()
    second_project = client.post("/api/projects", json={"name": "Beta project"}).json()
    assert client.post(f"/api/projects/{first_project['id']}/recent").status_code == 200
    projects = client.get("/api/projects", params={"sort": "recent_read", "direction": "desc"}).json()
    assert next(item for item in projects if item["id"] == first_project["id"])["last_read_at"] is not None
    assert client.put("/api/projects/order", json={"project_ids": [second_project["id"], first_project["id"]]}).status_code == 204

    assert client.put(f"/api/conversations/{alpha_id}/project", json={"project_id": first_project["id"]}).status_code == 200
    assert client.put(f"/api/conversations/{beta_id}/project", json={"project_id": first_project["id"]}).status_code == 200
    assert client.put(
        f"/api/projects/{first_project['id']}/conversations/order",
        json={"conversation_ids": [beta_id, alpha_id]},
    ).status_code == 204
    project_custom = client.get(
        f"/api/projects/{first_project['id']}/conversations",
        params={"sort": "custom", "direction": "asc"},
    ).json()
    assert [item["id"] for item in project_custom] == [beta_id, alpha_id]


def project_id_path(project_id: str) -> str:
    return f"/api/projects/{project_id}"
