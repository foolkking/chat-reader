from test_offline_annotations_api import _message_context
from test_import_preview_api import client  # noqa: F401


def test_annotation_inbox_lists_owned_annotations_and_filters_anchor_status(client):
    conversation_id, message, version = _message_context(client)
    created = client.post(
        f"/api/conversations/{conversation_id}/annotations",
        json={
            "message_id": message["id"],
            "message_version_id": version["id"],
            "annotation_type": "highlight",
            "color": "yellow",
            "start_block_index": 0,
            "start_offset": 0,
            "end_block_index": 0,
            "end_offset": 5,
            "quote": "hello",
        },
    )
    assert created.status_code == 201, created.text

    inbox = client.get("/api/annotations/inbox?limit=10")
    assert inbox.status_code == 200, inbox.text
    payload = inbox.json()
    assert payload["total"] >= 1
    item = next(item for item in payload["items"] if item["id"] == created.json()["id"])
    assert item["conversation_id"] == conversation_id
    assert item["conversation_title"]
    assert item["anchor_status"] == "valid"

    filtered = client.get("/api/annotations/inbox?anchor_status=orphaned")
    assert filtered.status_code == 200, filtered.text
    assert all(item["anchor_status"] == "orphaned" for item in filtered.json()["items"])
