import json

from fastapi.testclient import TestClient

from test_import_preview_api import client  # noqa: F401


def test_toc_returns_headings_with_unique_slugs(client: TestClient) -> None:
    preview = client.post(
        "/api/imports/preview",
        files={
            "files": (
                "toc.json",
                json.dumps(
                    {
                        "metadata": {"title": "TOC Sample", "powered_by": "ChatGPT Exporter"},
                        "messages": [
                            {"role": "Prompt", "say": "outline"},
                            {"role": "Response", "say": "# Repeat\n\n## Repeat\n\nbody"},
                        ],
                    }
                ).encode(),
                "application/json",
            )
        },
    )
    conversation_id = client.post(f"/api/imports/{preview.json()['import_id']}/commit").json()["conversation_ids"][0]

    response = client.get(f"/api/conversations/{conversation_id}/toc")
    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == 2
    assert [item["heading_index"] for item in items] == [0, 1]
    assert items[0]["slug"] != items[1]["slug"]
    assert items[0]["message_id"]
    assert items[0]["block_index"] == 0


def test_toc_unknown_conversation_returns_404(client: TestClient) -> None:
    response = client.get("/api/conversations/00000000-0000-0000-0000-000000000000/toc")
    assert response.status_code == 404
