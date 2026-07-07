import json

from fastapi.testclient import TestClient

from test_import_preview_api import client  # noqa: F401


def test_conversation_without_heading_has_empty_toc(client: TestClient) -> None:
    preview = client.post(
        "/api/imports/preview",
        files={
            "files": (
                "no-heading.json",
                json.dumps(
                    {
                        "metadata": {"title": "No Heading", "powered_by": "ChatGPT Exporter"},
                        "messages": [{"role": "Prompt", "say": "plain text only"}],
                    }
                ).encode(),
                "application/json",
            )
        },
    )
    conversation_id = client.post(f"/api/imports/{preview.json()['import_id']}/commit").json()["conversation_ids"][0]

    response = client.get(f"/api/conversations/{conversation_id}/toc")
    assert response.status_code == 200
    assert response.json()["items"] == []
