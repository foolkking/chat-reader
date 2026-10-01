"""Real persistence, search cleanup, stale guards and idempotent conflict resolution."""
import uuid

import pytest
from fastapi.testclient import TestClient

from test_import_preview_api import client  # noqa: F401
from test_offline_annotations_api import _message_context


@pytest.mark.parametrize("choice", ["local", "server", "merge", "delete"])
def test_annotation_resolution_updates_canonical_and_removes_copy(client: TestClient, choice):
    conversation_id, message, version = _message_context(client)
    annotation = client.post(f"/api/conversations/{conversation_id}/annotations", json={
        "message_id": message["id"], "message_version_id": version["id"], "annotation_type": "bookmark",
        "comment_markdown": "Synthetic initial",
    }).json()
    updated = client.patch(f"/api/annotations/{annotation['id']}", json={"base_revision": 1, "comment_markdown": "Synthetic server"})
    assert updated.status_code == 200
    draft = {**annotation, "comment_markdown": "Synthetic local"}
    conflict = client.post("/api/annotations/sync", json={"operations": [{
        "operation_id": str(uuid.uuid4()), "entity_type": "annotation", "entity_id": annotation["id"],
        "action": "delete" if choice == "delete" else "upsert", "conversation_id": conversation_id,
        "base_revision": 1, "payload": draft,
    }]}).json()["results"][0]
    assert conflict["status"] == "conflict"
    copy_id = conflict["conflict_copy_id"]
    # References are not left pointing at the temporary copy after resolution.
    notebook = client.get(f"/api/conversations/{conversation_id}/notebook").json()
    if choice != "delete":
        result = client.put(f"/api/conversations/{conversation_id}/notebook", json={"base_revision": notebook["revision"],
            "blocks": [{"id": str(uuid.uuid4()), "type": "annotation_reference", "annotation_id": copy_id}]})
        assert result.status_code == 200
    operation = {"operation_id": str(uuid.uuid4()), "entity_type": "annotation", "entity_id": annotation["id"],
        "action": "resolve", "conversation_id": conversation_id, "base_revision": 2,
        "payload": {"conflict_copy_id": copy_id, "conflict_revision": 1, "choice": "local" if choice == "delete" else choice,
            "deleted": choice == "delete", "annotation": {**draft, "comment_markdown": "Synthetic merged" if choice == "merge" else "Synthetic local"}}}
    wrong = client.post("/api/annotations/sync", json={"operations": [{**operation, "base_revision": 1}]})
    assert wrong.status_code == 409
    copies = client.get(f"/api/conversations/{conversation_id}/annotations?include_deleted=true").json()
    assert len(copies) == 2
    result = client.post("/api/annotations/sync", json={"operations": [operation]})
    assert result.status_code == 200, result.text
    assert result.json()["results"][0]["status"] == "applied"
    replay = client.post("/api/annotations/sync", json={"operations": [operation]})
    assert replay.status_code == 200
    assert replay.json()["results"][0]["status"] == "duplicate"
    rows = client.get(f"/api/conversations/{conversation_id}/annotations?include_deleted=true").json()
    assert len(rows) == 1
    assert rows[0]["id"] == annotation["id"]
    assert rows[0]["revision"] == (2 if choice == "server" else 3)
    assert rows[0]["is_deleted"] is (choice == "delete")
    if choice != "delete":
        assert rows[0]["comment_markdown"] == f"Synthetic {'merged' if choice == 'merge' else choice}"
        blocks = client.get(f"/api/conversations/{conversation_id}/notebook").json()["blocks"]
        assert blocks[0]["annotation_id"] == annotation["id"]
    invalid = client.post("/api/annotations/sync", json={"operations": [{**operation, "operation_id": str(uuid.uuid4()), "payload": {}}]})
    assert invalid.status_code == 422
