"""Replacing a version in place must invalidate previously reviewed cleanup."""
import pytest
from app.models.message import Message
from app.models.message_version import MessageVersion
from test_import_preview_api import client  # noqa: F401
from test_cleanup_safety import MARKER, create_review, session


@pytest.mark.parametrize("whitespace_only", [False, True])
def test_replacing_same_version_rejects_old_cleanup_preview(client, whitespace_only):
    original = f"Before {MARKER} after."
    # A replaceable version is required; initial source remains immutable.
    scan_id, messages = create_review(client, [original])
    message_url = f"/api/messages/{messages[0]}"
    first = client.get(message_url).json()["current_version"]
    edited = client.patch(message_url, json={"content_markdown": original + "\n\nRevision two.",
        "base_version_id": first["id"], "save_mode": "create_version"})
    assert edited.status_code == 200
    version = client.get(message_url).json()["current_version"]
    rescan = client.post(f"/api/content-cleanup/scans/{scan_id}/rescan")
    assert rescan.status_code == 202
    import uuid
    from app.services.content_cleanup import process_scan_chunk
    fresh_id = uuid.UUID(rescan.json()["id"])
    with session() as db:
        while not process_scan_chunk(db, fresh_id)["done"]:
            db.commit()
        db.commit()
    url = f"/api/content-cleanup/scans/{fresh_id}"
    assert client.patch(url + "/decisions/filter", json={"decision": "DELETE", "all_matching": True}).status_code == 200
    preview = client.get(url + "/preview").json()
    replacement = original + ("  \n\nRevision two." if whitespace_only else " Completely different current context.")
    changed = client.patch(message_url, json={"content_markdown": replacement,
        "base_version_id": version["id"], "save_mode": "replace_current"})
    assert changed.status_code == 200
    assert client.get(message_url).json()["current_version"]["id"] == version["id"]
    if whitespace_only:
        from app.services.import_pipeline.canonical_draft import content_hash
        assert content_hash(original + "\n\nRevision two.", "assistant") == content_hash(replacement, "assistant")
    result = client.post(url + "/apply", json={"preview_token": preview["preview_token"]})
    assert result.status_code == 409
    with session() as db:
        message = db.get(Message, messages[0])
        assert str(message.current_version_id) == version["id"]
        assert db.get(MessageVersion, message.current_version_id).display_text == replacement
        assert db.query(MessageVersion).filter_by(message_id=messages[0]).count() == 2
    candidates = client.get(url + "/review").json()["items"]
    assert len(candidates) == 1 and candidates[0]["stale"]
    updated_preview = client.get(url + "/preview").json()
    assert updated_preview["items"][0]["conflict"]
    assert updated_preview["items"][0]["after"] == replacement
    assert updated_preview["items"][0]["removed_ranges"] == []
    assert client.patch(url + "/decisions/filter", json={"decision": "DELETE", "all_matching": True}).status_code == 200
    assert client.get(url).json()["delete_count"] == 0
