import pytest
from fastapi.testclient import TestClient

from test_import_preview_api import client  # noqa: F401


def _create_project(client: TestClient) -> dict:
    response = client.post(
        "/api/projects",
        json={
            "name": "Synthetic project settings",
            "description": "Synthetic description to clear",
            "color": "#0f766e",
            "icon": "book",
        },
    )
    assert response.status_code == 201
    return response.json()


def _read_project(client: TestClient, project_id: str) -> dict:
    response = client.get("/api/projects", params={"include_archived": True})
    assert response.status_code == 200
    return next(item for item in response.json() if item["id"] == project_id)


@pytest.mark.parametrize("field", ["description", "color", "icon"])
def test_project_explicit_null_clears_only_nullable_metadata(client: TestClient, field: str) -> None:
    project = _create_project(client)
    response = client.patch(f"/api/projects/{project['id']}", json={field: None})

    assert response.status_code == 200
    persisted = _read_project(client, project["id"])
    for snapshot in (response.json(), persisted):
        assert snapshot[field] is None
        for untouched in ("name", "description", "color", "icon", "sort_order", "is_archived"):
            if untouched != field:
                assert snapshot[untouched] == project[untouched]


def test_project_partial_patch_preserves_other_clients_metadata(client: TestClient) -> None:
    project = _create_project(client)
    remote = {"name": "Synthetic remote name", "color": "#994422", "icon": "star"}
    assert client.patch(f"/api/projects/{project['id']}", json=remote).status_code == 200

    response = client.patch(
        f"/api/projects/{project['id']}", json={"description": "Synthetic local description"}
    )
    assert response.status_code == 200
    persisted = _read_project(client, project["id"])
    assert persisted["description"] == "Synthetic local description"
    for field, value in remote.items():
        assert persisted[field] == value


def test_project_null_nonnullable_fields_keep_legacy_noop_behavior(client: TestClient) -> None:
    project = _create_project(client)
    response = client.patch(
        f"/api/projects/{project['id']}", json={"name": None, "sort_order": None, "is_archived": None}
    )
    assert response.status_code == 200
    persisted = _read_project(client, project["id"])
    for field in ("name", "sort_order", "is_archived"):
        assert persisted[field] == project[field]


def test_cleared_project_description_invalidates_offline_metadata_without_editing_messages(
    client: TestClient,
) -> None:
    project = _create_project(client)
    created = client.post(
        "/api/conversations",
        json={
            "title": "Synthetic metadata revision",
            "project_id": project["id"],
            "messages": [
                {"role": "user", "content_markdown": "Synthetic preserved question"},
                {"role": "assistant", "content_markdown": "Synthetic preserved answer"},
            ],
        },
    )
    assert created.status_code == 201
    conversation_id = created.json()["conversation"]["id"]
    before = client.get(f"/api/conversations/{conversation_id}").json()
    message_ids = [message["id"] for message in created.json()["messages"]]
    before_messages = [client.get(f"/api/messages/{message_id}").json() for message_id in message_ids]
    response = client.patch(f"/api/projects/{project['id']}", json={"description": None})
    assert response.status_code == 200
    assert _read_project(client, project["id"])["description"] is None
    after = client.get(f"/api/conversations/{conversation_id}").json()
    assert after["offline_revision"] == before["offline_revision"] + 1
    after_messages = [client.get(f"/api/messages/{message_id}").json() for message_id in message_ids]
    assert after_messages == before_messages


def test_project_duplicate_name_rejection_preserves_metadata(client: TestClient) -> None:
    project = _create_project(client)
    other = client.post("/api/projects", json={"name": "Synthetic existing name"})
    assert other.status_code == 201
    response = client.patch(
        f"/api/projects/{project['id']}",
        json={"name": "Synthetic existing name", "description": None},
    )
    assert response.status_code == 400
    persisted = _read_project(client, project["id"])
    assert persisted["name"] == project["name"]
    assert persisted["description"] == project["description"]
