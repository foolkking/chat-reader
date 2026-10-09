import pytest
from fastapi.testclient import TestClient

from test_import_preview_api import client  # noqa: F401
from test_projects_api import _commit_conversation


def _read(client: TestClient, conversation_id: str) -> dict:
    response = client.get(f"/api/conversations/{conversation_id}")
    assert response.status_code == 200
    return response.json()


@pytest.mark.parametrize("empty", [None, "", " \n\t "], ids=["null", "empty", "whitespace"])
def test_optional_description_can_be_cleared_without_editing_messages(
    client: TestClient, empty: str | None,
) -> None:
    conversation_id = _commit_conversation(client, "Synthetic metadata clear")
    path = f"/api/conversations/{conversation_id}"
    initial = client.patch(path, json={"description_markdown": "Synthetic description"}).json()
    before_messages = client.get(f"{path}/message-window").json()

    cleared = client.patch(path, json={"description_markdown": empty})
    assert cleared.status_code == 200
    for snapshot in (cleared.json(), _read(client, conversation_id)):
        assert snapshot["description_markdown"] is None
        assert snapshot["offline_revision"] == initial["offline_revision"] + 1
        for field in ("title", "display_title", "status", "project_id"):
            assert snapshot[field] == initial[field]
    assert client.get(f"{path}/message-window").json() == before_messages
    again = client.patch(path, json={"description_markdown": empty})
    assert again.status_code == 200
    assert again.json()["offline_revision"] == cleared.json()["offline_revision"]


@pytest.mark.parametrize("text", ["a" * 500, "😀" * 500, "a" * 499 + "😀"], ids=["ascii", "astral", "boundary"])
def test_description_limit_accepts_500_code_points(client: TestClient, text: str) -> None:
    conversation_id = _commit_conversation(client, "Synthetic metadata Unicode")
    response = client.patch(f"/api/conversations/{conversation_id}", json={"description_markdown": text})
    assert response.status_code == 200
    assert response.json()["description_markdown"] == text
    assert _read(client, conversation_id)["description_markdown"] == text


@pytest.mark.parametrize("text", ["a" * 501, "😀" * 501, "👩‍🔬" * 167], ids=["ascii", "astral", "joined-emoji"])
def test_over_limit_description_is_rejected_without_a_revision_change(client: TestClient, text: str) -> None:
    conversation_id = _commit_conversation(client, "Synthetic metadata overflow")
    before = _read(client, conversation_id)
    response = client.patch(f"/api/conversations/{conversation_id}", json={"description_markdown": text})
    assert response.status_code == 422
    assert _read(client, conversation_id) == before


def test_description_patch_preserves_title_and_internal_markdown_lines(client: TestClient) -> None:
    conversation_id = _commit_conversation(client, "Synthetic metadata partial")
    path = f"/api/conversations/{conversation_id}"
    renamed = client.patch(path, json={"title": "Synthetic remote title", "display_title": "Synthetic display"})
    assert renamed.status_code == 200
    response = client.patch(path, json={"description_markdown": "  First line\n\n- Second line  "})
    assert response.status_code == 200
    value = _read(client, conversation_id)
    assert value["title"] == "Synthetic remote title"
    assert value["display_title"] == "Synthetic display"
    assert value["description_markdown"] == "First line\n\n- Second line"


def test_title_patch_preserves_description_and_rejects_empty_titles(client: TestClient) -> None:
    conversation_id = _commit_conversation(client, "Synthetic metadata rename")
    path = f"/api/conversations/{conversation_id}"
    assert client.patch(path, json={"description_markdown": "Synthetic retained description"}).status_code == 200
    renamed = client.patch(path, json={"title": "  Synthetic new name  ", "display_title": " Synthetic new name "})
    assert renamed.status_code == 200
    before = _read(client, conversation_id)
    assert before["title"] == before["display_title"] == "Synthetic new name"
    assert before["description_markdown"] == "Synthetic retained description"
    assert client.patch(path, json={"title": " ", "display_title": " "}).status_code == 400
    assert _read(client, conversation_id) == before
