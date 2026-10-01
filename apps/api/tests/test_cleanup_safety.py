"""Synthetic false-positive corpus and real version persistence on failures."""
from contextlib import contextmanager
from datetime import timedelta
from types import SimpleNamespace
import uuid

import pytest

from app.core.database import get_db
from app.main import app
from app.models.content_cleanup import ContentCleanupOccurrence, ContentCleanupScan
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.services import content_cleanup as cleanup
from test_import_preview_api import client  # noqa: F401

MARKER = "\ue200cite\ue202turn12search4\ue201"


@pytest.mark.parametrize("source", [
    "field_name: cite turn12search4", '"citation": "cite turn12search4"',
    "Example: cite turn12search4 is a protocol token.", "例如：cite turn12search4 是一种示例标记。",
    "| field | value |\n| --- | --- |\n| citation | cite turn12search4 |",
    "The ordinary fields citation, title, cite, content and turn12search4 are valid.",
    "示例：" + MARKER,
])
def test_normal_fields_tables_and_examples_are_not_noise(source):
    for detector in ("visible-turn-citation-v1", "openai-private-citation-v1", "openai-private-marker-v1"):
        rule = SimpleNamespace(detector_id=detector)
        assert cleanup.detect_occurrences("assistant", source, rule, SimpleNamespace(match_value=None)) == []


@pytest.mark.parametrize("source", [
    "`NOISE`", "``some `NOISE` code``", "```md\nNOISE\n```", "    NOISE\n",
    "$NOISE$", "$$NOISE$$", r"\(NOISE\)", r"\[NOISE\]",
    "[safe](https://example.test/NOISE)", "<https://example.test/NOISE>",
    "[safe](https://example.test/(section)/NOISE)",
    r"[safe](https://example.test/escaped\)/NOISE)",
    "[ref]: https://example.test/NOISE", "[safe][NOISE]", "[^NOISE]",
    "![NOISE](cr-asset://00000000-0000-0000-0000-000000000001)",
])
def test_protected_syntax_is_never_an_actionable_candidate(source):
    matches = cleanup.detect_occurrences("assistant", source, SimpleNamespace(detector_id=None),
        SimpleNamespace(match_value="NOISE", case_sensitive=True, matcher_mode="EXACT"))
    assert matches and all(item.decision == "PROTECTED" for item in matches)


@contextmanager
def session():
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        yield db
    finally:
        db.close()
        generator.close()


def create_review(client, contents):
    ids, message_ids = [], []
    for text in contents:
        response = client.post("/api/conversations", json={"title": "Synthetic cleanup review", "messages": [
            {"role": "user", "content_markdown": "Synthetic question"}, {"role": "assistant", "content_markdown": text}]} )
        assert response.status_code == 201
        ids.append(response.json()["conversation"]["id"])
        message_ids.append(uuid.UUID(response.json()["messages"][1]["id"]))
    response = client.post("/api/content-cleanup/scans", json={"source": "BATCH", "scope_type": "SELECTED_CONVERSATIONS", "conversation_ids": ids})
    assert response.status_code == 202
    scan_id = uuid.UUID(response.json()["id"])
    with session() as db:
        while not cleanup.process_scan_chunk(db, scan_id)["done"]:
            db.commit()
        db.commit()
    return scan_id, message_ids


def test_scan_apply_without_selection_preserves_all_text_and_versions(client):
    text = "Keep " + MARKER + " here."
    scan_id, message_ids = create_review(client, [text])
    with session() as db:
        before = db.get(Message, message_ids[0]).current_version_id
        assert db.query(ContentCleanupOccurrence).filter_by(scan_id=scan_id).one().decision == "KEEP"
        assert cleanup.apply_scan(db, scan_id) == {"applied": 0, "conflicts": 0}
        db.commit()
    with session() as db:
        assert db.get(Message, message_ids[0]).current_version_id == before
        assert db.get(MessageVersion, before).display_text == text


def test_forged_protected_decision_is_revalidated_during_apply(client):
    text = "Keep `" + MARKER + "` here."
    scan_id, message_ids = create_review(client, [text])
    with session() as db:
        occurrence = db.query(ContentCleanupOccurrence).filter_by(scan_id=scan_id).one()
        assert occurrence.decision == "PROTECTED"
        # Simulate a legacy/corrupt stored decision that bypassed the HTTP guard.
        occurrence.decision = "DELETE"
        occurrence.decision_updated_at = cleanup.utc_now()
        db.commit()
        assert cleanup.apply_scan(db, scan_id) == {"applied": 0, "conflicts": 1}
        db.commit()
    with session() as db:
        message = db.get(Message, message_ids[0])
        assert db.get(MessageVersion, message.current_version_id).display_text == text
        assert db.query(MessageVersion).filter_by(message_id=message.id).count() == 1


def test_partial_apply_retry_never_reapplies_completed_messages(client, monkeypatch):
    scan_id, message_ids = create_review(client, ["First " + MARKER + " remains.", "Second " + MARKER + " remains."])
    with session() as db:
        rows = db.query(ContentCleanupOccurrence).filter_by(scan_id=scan_id).all()
        cleanup.update_decisions(db, scan_id, {row.id: "DELETE" for row in rows})
        db.commit()
    real_create = cleanup._create_version
    calls = 0

    def fail_second(**kwargs):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("Synthetic interrupted apply")
        return real_create(**kwargs)

    monkeypatch.setattr(cleanup, "_create_version", fail_second)
    with session() as db:
        with pytest.raises(RuntimeError, match="Synthetic interrupted"):
            cleanup.apply_scan(db, scan_id)
        db.rollback()
    monkeypatch.setattr(cleanup, "_create_version", real_create)
    with session() as db:
        assert db.query(ContentCleanupOccurrence).filter_by(scan_id=scan_id, decision="APPLIED").count() == 1
        assert cleanup.apply_scan(db, scan_id) == {"applied": 1, "conflicts": 0}
        db.commit()
    with session() as db:
        assert db.get(ContentCleanupScan, scan_id) is None
        for message_id in message_ids:
            message = db.get(Message, message_id)
            assert MARKER not in db.get(MessageVersion, message.current_version_id).display_text
            assert db.query(MessageVersion).filter_by(message_id=message_id).count() == 2


def test_filtered_selection_covers_all_pages_and_preview_guards_changes(client):
    text = "Before " + (MARKER + " between ") * 125 + "after."
    scan_id, message_ids = create_review(client, [text, "Other " + MARKER + " remains."])
    group_response = client.get(f"/api/content-cleanup/scans/{scan_id}/groups?limit=1&offset=0")
    assert group_response.status_code == 200, group_response.text
    assert group_response.json()["total"] == 2
    with session() as db:
        conversation_id = db.get(Message, message_ids[0]).conversation_id
    filtered = f"conversation_id={conversation_id}"
    first_page = client.get(f"/api/content-cleanup/scans/{scan_id}/occurrences?limit=100&{filtered}").json()
    assert len(first_page) == 100
    selected = client.patch(f"/api/content-cleanup/scans/{scan_id}/decisions/filter", json={"decision": "DELETE", "all_matching": True, "conversation_id": str(conversation_id)})
    assert selected.status_code == 200, selected.text
    assert selected.json()["matched"] == 125
    second_page = client.get(f"/api/content-cleanup/scans/{scan_id}/occurrences?offset=100&selected_only=true&{filtered}").json()
    assert len(second_page) == 25 and all(item["decision"] == "DELETE" for item in second_page)
    preview = client.get(f"/api/content-cleanup/scans/{scan_id}/preview").json()
    assert preview["summary"] == {"conversations": 1, "messages": 1, "fragments": 125}
    assert preview["items"][0]["before"] == text
    assert preview["items"][0]["after"] == text.replace(MARKER, "")
    assert preview["items"][0]["conflict"] is False
    assert client.patch(f"/api/content-cleanup/scans/{scan_id}/decisions", json={"decisions": [{"occurrence_id": first_page[0]["id"], "decision": "KEEP"}]}).status_code == 200
    stale = client.post(f"/api/content-cleanup/scans/{scan_id}/apply", json={"preview_token": preview["preview_token"]})
    assert stale.status_code == 409
    current = client.get(f"/api/content-cleanup/scans/{scan_id}/preview").json()
    assert current["summary"]["fragments"] == 124
    applied = client.post(f"/api/content-cleanup/scans/{scan_id}/apply", json={"preview_token": current["preview_token"]})
    assert applied.json() == {"applied": 124, "conflicts": 0}
    with session() as db:
        message = db.get(Message, message_ids[0])
        assert db.get(MessageVersion, message.current_version_id).display_text.count(MARKER) == 1
        other = db.get(Message, message_ids[1])
        assert db.get(MessageVersion, other.current_version_id).display_text == "Other " + MARKER + " remains."


def test_live_apply_lease_blocks_duplicates_and_expired_lease_can_resume(client):
    scan_id, _ = create_review(client, ["Keep " + MARKER + " here."])
    with session() as db:
        row = db.query(ContentCleanupOccurrence).filter_by(scan_id=scan_id).one()
        cleanup.update_decisions(db, scan_id, {row.id: "DELETE"})
        scan = db.get(ContentCleanupScan, scan_id)
        scan.status = "APPLYING"
        scan.apply_lease_until = cleanup.utc_now() + timedelta(minutes=5)
        db.commit()
    assert client.post(f"/api/content-cleanup/scans/{scan_id}/apply").status_code == 409
    with session() as db:
        db.get(ContentCleanupScan, scan_id).apply_lease_until = cleanup.utc_now() - timedelta(seconds=1)
        db.commit()
    resumed = client.get(f"/api/content-cleanup/scans/{scan_id}")
    assert resumed.json()["status"] == "READY"
    assert resumed.json()["delete_count"] == 1
    assert client.post(f"/api/content-cleanup/scans/{scan_id}/apply").json() == {"applied": 1, "conflicts": 0}
