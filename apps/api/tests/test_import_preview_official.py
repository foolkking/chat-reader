import json

from fastapi.testclient import TestClient

from test_import_preview_api import client  # noqa: F401
from test_official_samples import official_single_conversation


def test_preview_official_single_json_returns_conversation_preview(client: TestClient) -> None:
    response = client.post(
        "/api/imports/preview",
        files={"files": ("conversation.json", json.dumps(official_single_conversation()).encode(), "application/json")},
    )

    assert response.status_code == 200
    payload = response.json()
    preview = payload["conversation_preview"]
    assert preview["source_profile"] == "official_conversation_json"
    assert preview["alignment_status"] == "official_primary_path"
    assert preview["message_count"] == 2
    assert preview["branch_count"] == 1
    assert preview["has_branches"] is True
    assert preview["messages"][1]["source_node_id"] == "assistant-1"
    assert "assistant-alt" not in [message["source_node_id"] for message in preview["messages"]]

    artifacts = client.get(f"/api/imports/{payload['import_id']}/source-artifacts")
    assert artifacts.status_code == 200
    assert len(artifacts.json()) == 1


def test_preview_official_conversations_list_returns_conversation_previews(client: TestClient) -> None:
    response = client.post(
        "/api/imports/preview",
        files={
            "files": (
                "conversations.json",
                json.dumps([official_single_conversation(), official_single_conversation()]).encode(),
                "application/json",
            )
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["conversation_preview"]["source_profile"] == "official_conversations_json"
    assert len(payload["conversation_previews"]) == 2


def test_exporter_preview_still_works(client: TestClient) -> None:
    response = client.post(
        "/api/imports/preview",
        files={
            "files": (
                "export.json",
                b'{"metadata":{"powered_by":"ChatGPT Exporter"},"messages":[{"role":"Prompt","say":"hi"}]}',
                "application/json",
            )
        },
    )

    assert response.status_code == 200
    assert response.json()["conversation_preview"]["source_profile"] == "chatgpt_exporter_json"
