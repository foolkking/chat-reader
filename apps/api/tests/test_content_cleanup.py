from types import SimpleNamespace
import uuid

from app.core.database import get_db
from app.main import app
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.services.content_cleanup import detect_occurrences, protected_ranges
from app.services.content_cleanup import process_scan_chunk
from test_import_preview_api import client  # noqa: F401


def _rule(detector_id: str | None = None, scope: str = "MESSAGE") -> SimpleNamespace:
    return SimpleNamespace(detector_id=detector_id, scope=scope)


def _revision(value: str | None = None, case_sensitive: bool = True) -> SimpleNamespace:
    return SimpleNamespace(match_value=value, case_sensitive=case_sensitive, role_filter=None)


def test_builtin_citation_detector_records_exact_offsets() -> None:
    text = "Answer before Cite turn2search1 and after."
    matches = detect_occurrences("assistant", text, _rule("visible-turn-citation-v1", "ASSISTANT_ONLY"), _revision())
    assert [(item.start, item.end, item.reason_code) for item in matches] == [(14, 31, "VISIBLE_CITATION")]
    assert text[matches[0].start:matches[0].end] == "Cite turn2search1"


def test_literal_detector_is_case_sensitive_by_default_and_can_ignore_code() -> None:
    text = "keep NOISE and `NOISE` and noise"
    matches = detect_occurrences("assistant", text, _rule(), _revision("NOISE"))
    assert len(matches) == 2
    assert matches[1].decision == "PROTECTED"


def test_protected_ranges_cover_fenced_code_math_and_asset_links() -> None:
    text = "```md\nNOISE\n``` and $NOISE$ and [asset](cr-asset://abc)"
    ranges = protected_ranges(text)
    assert len(ranges) == 3
    assert all(start < end for start, end in ranges)


def test_reader_scan_requires_active_conversation_and_applies_reviewed_match(client) -> None:
    created = client.post(
        "/api/conversations",
        json={
            "title": "cleanup fixture",
            "messages": [
                {"role": "user", "content_markdown": "safe question"},
                {"role": "assistant", "content_markdown": "Answer Cite turn2search1 remains."},
            ],
        },
    )
    assert created.status_code == 201, created.text
    conversation_id = created.json()["conversation"]["id"]
    scan = client.post(
        "/api/content-cleanup/scans",
        json={"source": "READER", "scope_type": "CURRENT_CONVERSATION", "conversation_ids": [conversation_id]},
    )
    assert scan.status_code == 202, scan.text
    scan_id = scan.json()["id"]

    override = app.dependency_overrides[get_db]
    generator = override()
    db = next(generator)
    try:
        while not process_scan_chunk(db, uuid.UUID(scan_id))["done"]:
            db.commit()
        db.commit()
    finally:
        db.close()
        generator.close()

    occurrences = client.get(f"/api/content-cleanup/scans/{scan_id}/occurrences?limit=1&offset=0")
    assert occurrences.status_code == 200
    item = occurrences.json()[0]
    assert item["conversation_title"] == "cleanup fixture"
    assert item["detector_id"] == "visible-turn-citation-v1"
    assert item["match_text"] == "Cite turn2search1"
    assert client.get(f"/api/content-cleanup/scans/{scan_id}/occurrences?limit=1&offset=1").json() == []
    applied = client.post(f"/api/content-cleanup/scans/{scan_id}/apply")
    assert applied.status_code == 200, applied.text
    assert applied.json() == {"applied": 1, "conflicts": 0}

    generator = override()
    db = next(generator)
    try:
        message = db.get(Message, uuid.UUID(item["message_id"]))
        version = db.get(MessageVersion, message.current_version_id)
        assert version.display_text == "Answer  remains."
    finally:
        db.close()
        generator.close()

    assert client.patch(f"/api/conversations/{conversation_id}", json={"status": "archived"}).status_code == 200
    rejected = client.post(
        "/api/content-cleanup/scans",
        json={"source": "READER", "scope_type": "CURRENT_CONVERSATION", "conversation_ids": [conversation_id]},
    )
    assert rejected.status_code == 422


def test_literal_rule_updates_create_an_immutable_revision(client) -> None:
    created = client.post("/api/content-cleanup/rules", json={"name": "literal fixture", "match_value": "remove me"})
    assert created.status_code == 201, created.text
    rule = created.json()
    updated = client.patch(
        f"/api/content-cleanup/rules/{rule['id']}",
        json={"match_value": "remove this instead", "case_sensitive": False},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["revision"] == 2
    assert updated.json()["match_value"] == "remove this instead"


def test_zero_match_scan_is_deleted_when_scanning_finishes(client) -> None:
    created = client.post(
        "/api/conversations",
        json={
            "title": "zero cleanup matches",
            "messages": [
                {"role": "user", "content_markdown": "Ordinary prompt."},
                {"role": "assistant", "content_markdown": "Ordinary response."},
            ],
        },
    )
    conversation_id = created.json()["conversation"]["id"]
    scan = client.post(
        "/api/content-cleanup/scans",
        json={"source": "READER", "scope_type": "CURRENT_CONVERSATION", "conversation_ids": [conversation_id]},
    )
    scan_id = scan.json()["id"]

    override = app.dependency_overrides[get_db]
    generator = override()
    db = next(generator)
    try:
        while not process_scan_chunk(db, uuid.UUID(scan_id))["done"]:
            db.commit()
        db.commit()
    finally:
        db.close()
        generator.close()

    assert client.get(f"/api/content-cleanup/scans/{scan_id}").status_code == 404


def test_source_selection_uses_code_point_offsets_and_deletes_scan_after_apply(client) -> None:
    source = "保留🙂前缀 NOISE 保留后缀"
    selected = "NOISE"
    start = source.index(selected)
    created = client.post(
        "/api/conversations",
        json={"title": "source selection cleanup", "messages": [{"role": "user", "content_markdown": "Keep this prompt."}, {"role": "assistant", "content_markdown": source}]},
    )
    assert created.status_code == 201, created.text
    response = created.json()
    conversation = response["conversation"]
    message_id = response["messages"][1]["id"]
    scan = client.post(
        "/api/content-cleanup/scans",
        json={
            "source": "READER",
            "scope_type": "CURRENT_CONVERSATION",
            "conversation_ids": [conversation["id"]],
            "message_id": message_id,
            "selection_start_offset": start,
            "selection_end_offset": start + len(selected),
        },
    )
    assert scan.status_code == 202, scan.text
    scan_id = scan.json()["id"]

    override = app.dependency_overrides[get_db]
    generator = override()
    db = next(generator)
    try:
        while not process_scan_chunk(db, uuid.UUID(scan_id))["done"]:
            db.commit()
        db.commit()
    finally:
        db.close()
        generator.close()

    occurrences = client.get(f"/api/content-cleanup/scans/{scan_id}/occurrences")
    assert occurrences.status_code == 200
    assert len(occurrences.json()) == 1
    item = occurrences.json()[0]
    assert item["reason_code"] == "MANUAL_SELECTION"
    assert item["match_text"] == selected
    assert item["start_offset"] == start
    assert client.post(f"/api/content-cleanup/scans/{scan_id}/apply").json() == {"applied": 1, "conflicts": 0}
    assert client.get(f"/api/content-cleanup/scans/{scan_id}").status_code == 404

    generator = override()
    db = next(generator)
    try:
        message = db.get(Message, uuid.UUID(message_id))
        version = db.get(MessageVersion, message.current_version_id)
        assert version.display_text == source.replace(selected, "")
    finally:
        db.close()
        generator.close()

    rules = client.get("/api/content-cleanup/rules")
    assert rules.status_code == 200
    assert all(rule["detector_id"] != "manual-selection-v1" for rule in rules.json())


def test_source_selection_rejects_partial_or_protected_ranges(client) -> None:
    created = client.post(
        "/api/conversations",
        json={"title": "protected selection cleanup", "messages": [{"role": "user", "content_markdown": "Keep this prompt."}, {"role": "assistant", "content_markdown": "Keep `NOISE` here."}]},
    )
    response = created.json()
    conversation = response["conversation"]
    message_id = response["messages"][1]["id"]
    partial = client.post(
        "/api/content-cleanup/scans",
        json={
            "source": "READER",
            "scope_type": "CURRENT_CONVERSATION",
            "conversation_ids": [conversation["id"]],
            "message_id": message_id,
        },
    )
    assert partial.status_code == 422

    source = "Keep `NOISE` here."
    start = source.index("NOISE")
    scan = client.post(
        "/api/content-cleanup/scans",
        json={
            "source": "READER",
            "scope_type": "CURRENT_CONVERSATION",
            "conversation_ids": [conversation["id"]],
            "message_id": message_id,
            "selection_start_offset": start,
            "selection_end_offset": start + len("NOISE"),
        },
    )
    scan_id = scan.json()["id"]
    override = app.dependency_overrides[get_db]
    generator = override()
    db = next(generator)
    try:
        while not process_scan_chunk(db, uuid.UUID(scan_id))["done"]:
            db.commit()
        db.commit()
    finally:
        db.close()
        generator.close()
    occurrence = client.get(f"/api/content-cleanup/scans/{scan_id}/occurrences").json()[0]
    assert occurrence["decision"] == "PROTECTED"
    assert client.delete(f"/api/content-cleanup/scans/{scan_id}").status_code == 204
    assert client.get(f"/api/content-cleanup/scans/{scan_id}").status_code == 404
