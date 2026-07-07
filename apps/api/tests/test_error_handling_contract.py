from fastapi.testclient import TestClient

from test_import_preview_api import client  # noqa: F401
from test_message_editing_api import assistant_message, commit_edit_sample


def test_user_input_errors_return_400(client: TestClient) -> None:
    unsupported = client.post(
        "/api/imports/preview",
        files={"files": ("payload.exe", b"data", "application/octet-stream")},
    )
    assert unsupported.status_code == 400

    empty_search = client.get("/api/search?q=")
    assert empty_search.status_code == 400

    sample = commit_edit_sample(client)
    invalid_export = client.get(
        f"/api/conversations/{sample['conversation_id']}/export?format=invalid"
    )
    assert invalid_export.status_code == 400

    invalid_share = client.post(
        f"/api/conversations/{sample['conversation_id']}/shares",
        json={"scope": "selected_messages", "selected_message_ids": []},
    )
    assert invalid_share.status_code == 400


def test_missing_resources_return_404(client: TestClient) -> None:
    missing_id = "00000000-0000-0000-0000-000000000000"
    assert client.get(f"/api/conversations/{missing_id}").status_code == 404
    assert client.get(f"/api/messages/{missing_id}").status_code == 404
    assert client.post(f"/api/imports/{missing_id}/commit").status_code == 404
    assert client.get("/api/shared/not-a-token").status_code == 404


def test_edit_conflict_returns_409(client: TestClient) -> None:
    message = assistant_message(commit_edit_sample(client))
    base_version_id = message["current_version"]["id"]

    first = client.patch(f"/api/messages/{message['id']}", json={"display_text": "Conflict v2"})
    assert first.status_code == 200
    conflict = client.patch(
        f"/api/messages/{message['id']}",
        json={"display_text": "Conflict v3", "base_version_id": base_version_id},
    )
    assert conflict.status_code == 409


def test_revoked_share_returns_410(client: TestClient) -> None:
    sample = commit_edit_sample(client)
    share = client.post(f"/api/conversations/{sample['conversation_id']}/shares", json={}).json()
    assert client.post(f"/api/shares/{share['id']}/revoke").status_code == 200
    assert client.get(f"/api/shared/{share['token']}").status_code == 410
