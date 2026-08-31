from fastapi.testclient import TestClient

from test_import_preview_api import client  # noqa: F401
from test_offline_annotations_api import _message_context


def test_resolve_locator_returns_canonical_block_and_offsets(client: TestClient) -> None:
    conversation_id, message, version = _message_context(client)
    current = client.get(f"/api/conversations/{conversation_id}/message-window?include_blocks=true").json()
    target = next(item for item in current["items"] if item["id"] == message["id"])
    block = target["render_blocks"][0]
    quote = (block["plain_text"] or "")[:8]

    response = client.post(
        f"/api/conversations/{conversation_id}/resolve-locator",
        json={
            "message_id": message["id"],
            "message_version_id": version["id"],
            "render_block_id": block["id"],
            "block_index": block["block_index"],
            "quote": quote,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "EXACT"
    assert payload["message_id"] == message["id"]
    assert payload["message_version_id"] == version["id"]
    assert payload["render_block_id"] == block["id"]
    assert payload["start_offset"] == 0
    assert payload["end_offset"] == len(quote)


def test_resolve_locator_reports_missing_attachment_without_guessing(client: TestClient) -> None:
    conversation_id, message, version = _message_context(client)
    response = client.post(
        f"/api/conversations/{conversation_id}/resolve-locator",
        json={
            "message_id": message["id"],
            "message_version_id": version["id"],
            "occurrence_key": "missing-occurrence",
            "attachment_id": "00000000-0000-0000-0000-000000000001",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "NOT_FOUND"
    assert payload["reason"] == "attachment-not-found"
    assert payload["fallback_kind"] == "message"
