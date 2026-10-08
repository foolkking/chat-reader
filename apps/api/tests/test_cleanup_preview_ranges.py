"""Exact Unicode ranges describe the real proposed deletion, never guessed diffs."""
import pytest
from app.models.content_cleanup import ContentCleanupOccurrence
from app.models.message import Message
from app.models.message_version import MessageVersion
from test_import_preview_api import client  # noqa: F401
from test_cleanup_safety import MARKER, create_review, session


@pytest.mark.parametrize("text", [
    "👩🏽‍💻 é 中文 before " + MARKER + " after.",
    "🙂" + MARKER * 3 + " adjacent markers removed.",
    "Keep exact repeated tokens " + (MARKER + " retained 👩🏽‍💻.\n") * 125 + "Code `" + MARKER + "`.",
])
def test_exact_ranges_reproduce_after_without_creating_a_version(client, text):
    scan_id, messages = create_review(client, [text])
    prefix = f"/api/content-cleanup/scans/{scan_id}"
    assert client.patch(prefix + "/decisions/filter", json={"decision": "DELETE", "all_matching": True}).status_code == 200
    with session() as db:
        version = db.get(Message, messages[0]).current_version_id
        count = db.query(MessageVersion).filter_by(message_id=messages[0]).count()
        stored = [(row.start_offset, row.end_offset) for row in db.query(ContentCleanupOccurrence).filter_by(scan_id=scan_id, decision="DELETE").order_by(ContentCleanupOccurrence.start_offset)]
    preview = client.get(prefix + "/preview").json()
    item = preview["items"][0]
    assert item["before"] == text and not item["conflict"]
    assert item["removed_ranges"] == [{"start_offset": start, "end_offset": end} for start, end in stored]
    after = text
    for start, end in reversed(stored):
        assert text[start:end] == MARKER
        after = after[:start] + after[end:]
    assert item["after"] == after
    assert item["fragments"] == len(stored)
    with session() as db:
        assert db.get(Message, messages[0]).current_version_id == version
        assert db.query(MessageVersion).filter_by(message_id=messages[0]).count() == count


def test_changed_source_has_no_proposed_removal_ranges(client):
    text = f"Before {MARKER} after."
    scan_id, messages = create_review(client, [text])
    prefix = f"/api/content-cleanup/scans/{scan_id}"
    assert client.patch(prefix + "/decisions/filter", json={"decision": "DELETE", "all_matching": True}).status_code == 200
    version = client.get(f"/api/messages/{messages[0]}").json()["current_version"]["id"]
    edited = client.patch(f"/api/messages/{messages[0]}", json={"content_markdown": "Later change. " + text, "base_version_id": version, "save_mode": "create_version"})
    assert edited.status_code == 200
    item = client.get(prefix + "/preview").json()["items"][0]
    assert item["conflict"] and item["removed_ranges"] == []
    assert item["before"] == item["after"] == text


def test_unsafe_legacy_protected_choice_is_not_drawn_as_a_deletion(client):
    text = f"Safe {MARKER} and protected `{MARKER}`."
    scan_id, messages = create_review(client, [text])
    with session() as db:
        for row in db.query(ContentCleanupOccurrence).filter_by(scan_id=scan_id):
            row.decision = "DELETE"
        db.commit()
    item = client.get(f"/api/content-cleanup/scans/{scan_id}/preview").json()["items"][0]
    assert item["conflict"] and item["removed_ranges"] == []
    assert item["before"] == item["after"] == text
