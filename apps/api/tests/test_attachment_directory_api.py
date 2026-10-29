from fastapi.testclient import TestClient

from app.core.config import get_settings
from test_attachment_upload_api import _conversation_with_message, _create_session, _upload
from test_import_preview_api import client  # noqa: F401


def test_attachment_directory_lists_owned_files_and_current_usage(client: TestClient, tmp_path) -> None:
    get_settings.cache_clear()
    conversation_id, message = _conversation_with_message(client)
    session = _create_session(client, conversation_id)
    item = _upload(client, session["id"], "directory-note.md", b"directory body")
    finalized = client.post(
        f"/api/conversations/{conversation_id}/attachments",
        json={"upload_item_ids": [item["id"]]},
    )
    assert finalized.status_code == 201, finalized.text
    attachment_id = finalized.json()["items"][0]["id"]

    placed = client.patch(
        f"/api/messages/{message['id']}",
        json={
            "content_markdown": message["current_version"]["display_text"]
            + f"\n\n[Directory note](cr-asset://{attachment_id})",
            "base_version_id": message["current_version"]["id"],
        },
    )
    assert placed.status_code == 200, placed.text

    response = client.get("/api/attachments/directory", params={"q": "directory-note"})
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["total"] == 1
    assert payload["has_more"] is False
    item_payload = payload["items"][0]
    assert item_payload["id"] == attachment_id
    assert item_payload["conversation_id"] == conversation_id
    assert item_payload["conversation_display_title"]
    assert item_payload["is_used"] is True
    assert item_payload["current_occurrence_count"] == 1
    assert item_payload["occurrence_count"] >= 1

    unused = client.get("/api/attachments/directory", params={"used": "unused"})
    assert unused.status_code == 200
    assert attachment_id not in {row["id"] for row in unused.json()["items"]}

    by_mime = client.get("/api/attachments/directory", params={"mime_type": "text/markdown"})
    assert by_mime.status_code == 200
    assert attachment_id in {row["id"] for row in by_mime.json()["items"]}
