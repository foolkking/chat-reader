"""Synthetic narrowed selections use the same source/preview/apply authority."""
import uuid

import pytest

from app.models.content_cleanup import ContentCleanupOccurrence
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.services.cleanup_ranges import validated_ranges
from test_import_preview_api import client  # noqa: F401
from test_cleanup_safety import MARKER, create_review, session


def candidate(client, scan_id):
    rows = client.get(f"/api/content-cleanup/scans/{scan_id}/occurrences").json()
    return next(row for row in rows if row["decision"] != "PROTECTED")


def save(client, scan_id, item, ranges):
    return client.put(f"/api/content-cleanup/scans/{scan_id}/occurrences/{item['id']}/removal-ranges",
                      json={"base_edit_token": item["edit_token"], "ranges": ranges})


def bounds(start, end):
    return {"start_offset": start, "end_offset": end}


@pytest.mark.parametrize("ranges", [
    [], {}, [{"start_offset": 2, "end_offset": 5}],
    [bounds(3, 8), bounds(7, 10)], [bounds(6, 8), bounds(3, 5)],
    [bounds(3, 3)], [bounds(3, 15)], [bounds(True, 5)],
    [bounds(3.5, 8)], [{**bounds(3, 5), "text": "not accepted"}],
    [bounds(3, 4)] * 21,
])
def test_invalid_range_shapes_and_boundaries_fail_closed(ranges):
    with pytest.raises(ValueError):
        validated_ranges(3, 12, ranges)


def test_null_preserves_legacy_whole_match_and_adjacent_ranges_are_valid():
    assert validated_ranges(3, 12, None) == [(3, 12)]
    assert validated_ranges(3, 12, [bounds(3, 5), bounds(5, 8)]) == [(3, 5), (5, 8)]


def test_multiple_user_ranges_preserve_source_and_detector_until_confirmed_apply(client):
    source = "🙂 before " + MARKER + " retained."
    scan_id, messages = create_review(client, [source])
    item = candidate(client, scan_id)
    left, right = item["start_offset"], item["end_offset"]
    ranges = [bounds(left, left + 1), bounds(right - 1, right)]
    original = client.get(f"/api/messages/{messages[0]}").json()["current_version"]["id"]
    result = save(client, scan_id, item, ranges)
    assert result.status_code == 200 and result.json()["delete_count"] == 1
    prefix = f"/api/content-cleanup/scans/{scan_id}"
    saved = client.get(prefix + f"/occurrences/{item['id']}").json()
    assert saved["reviewed_ranges"] == ranges
    for field in ("start_offset", "end_offset", "detector_id", "rule_id", "message_version_id", "match_text"):
        assert saved[field] == item[field]
    assert saved["edit_token"] != item["edit_token"]
    assert client.get(f"/api/messages/{messages[0]}").json()["current_version"]["id"] == original
    preview = client.get(prefix + "/preview").json()
    assert preview["summary"]["fragments"] == 2
    proposed = preview["items"][0]
    assert not proposed["conflict"] and proposed["removed_ranges"] == ranges
    expected = source[:left] + source[left + 1:right - 1] + source[right:]
    assert proposed["after"] == expected
    assert client.post(prefix + "/apply", json={"preview_token": preview["preview_token"]}).json() == {"applied": 1, "conflicts": 0}
    with session() as db:
        message = db.get(Message, messages[0])
        assert message.current_version_id != uuid.UUID(original)
        assert db.get(MessageVersion, message.current_version_id).display_text == expected
        assert db.query(MessageVersion).filter_by(message_id=messages[0]).count() == 2


def test_bulk_keep_reselect_does_not_expand_refinement_and_old_preview_is_rejected(client):
    source = f"Before {MARKER} after."
    scan_id, _ = create_review(client, [source])
    item = candidate(client, scan_id)
    ranges = [bounds(item["start_offset"] + 1, item["end_offset"] - 1)]
    assert save(client, scan_id, item, ranges).status_code == 200
    prefix = f"/api/content-cleanup/scans/{scan_id}"
    old = client.get(prefix + "/preview").json()["preview_token"]
    for decision in ("KEEP", "DELETE"):
        assert client.patch(prefix + "/decisions/filter", json={"decision": decision, "all_matching": True}).status_code == 200
        assert client.get(prefix + f"/occurrences/{item['id']}").json()["reviewed_ranges"] == ranges
    current = client.get(prefix + f"/occurrences/{item['id']}").json()
    assert save(client, scan_id, current, None).status_code == 200
    assert client.post(prefix + "/apply", json={"preview_token": old}).status_code == 409
    preview = client.get(prefix + "/preview").json()
    assert preview["summary"]["fragments"] == 1
    assert preview["items"][0]["after"] == "Before  after."


def test_many_candidates_across_pages_preserve_refinements_and_apply_together(client):
    sources = ["🙂 Synthetic " + (MARKER + " retained.\n") * 30 + "End." for _ in range(2)]
    scan_id, _ = create_review(client, sources)
    prefix = f"/api/content-cleanup/scans/{scan_id}"
    rows = client.get(prefix + "/occurrences", params={"limit": 100}).json()
    assert len(rows) == 60 and all(row["decision"] == "KEEP" for row in rows)
    refinements = {}
    for index, item in enumerate((rows[0], rows[-1])):
        left, right = item["start_offset"], item["end_offset"]
        ranges = [bounds(left, left + 1), bounds(right - 1, right)] if index == 0 else [bounds(left + 1, right - 1)]
        assert save(client, scan_id, item, ranges).status_code == 200
        refinements[item["id"]] = ranges
    bulk = client.patch(prefix + "/decisions/filter", json={"decision": "DELETE", "all_matching": True})
    assert bulk.status_code == 200 and bulk.json()["scan"]["delete_count"] == 60
    first = client.get(prefix + "/review", params={"limit": 50}).json()
    last = client.get(prefix + "/review", params={"limit": 50, "offset": 50}).json()
    assert first["total"] == last["total"] == 60
    reviewed = first["items"] + last["items"]
    assert len({item["id"] for item in reviewed}) == 60
    for item in reviewed:
        assert item["decision"] == "DELETE"
        assert item["reviewed_ranges"] == refinements.get(item["id"])
    proposed = client.get(prefix + "/preview").json()
    assert proposed["summary"] == {"conversations": 2, "messages": 2, "fragments": 61, "protected_confirmed": 0}
    for message in proposed["items"]:
        spans = sorted(
            (span["start_offset"], span["end_offset"])
            for item in reviewed if item["message_id"] == message["message_id"]
            for span in (item["reviewed_ranges"] or [bounds(item["start_offset"], item["end_offset"])])
        )
        expected = message["before"]
        for left, right in reversed(spans):
            expected = expected[:left] + expected[right:]
        assert not message["conflict"] and message["after"] == expected
    result = client.post(prefix + "/apply", json={"preview_token": proposed["preview_token"]})
    assert result.status_code == 200 and result.json() == {"applied": 60, "conflicts": 0}
    for message in proposed["items"]:
        stored = client.get(f"/api/messages/{message['message_id']}").json()
        assert stored["current_version"]["display_text"] == message["after"]


@pytest.mark.parametrize("extra", [
    {},
    {"ranges": [{"start_offset": True, "end_offset": 5}]},
    {"ranges": None, "text": "not accepted"},
])
def test_missing_ranges_or_unaccepted_fields_never_reset_a_saved_refinement(client, extra):
    scan_id, _ = create_review(client, [f"Before {MARKER} after."])
    item = candidate(client, scan_id)
    ranges = [bounds(item["start_offset"] + 1, item["end_offset"] - 1)]
    assert save(client, scan_id, item, ranges).status_code == 200
    prefix = f"/api/content-cleanup/scans/{scan_id}/occurrences/{item['id']}"
    current = client.get(prefix).json()
    response = client.put(prefix + "/removal-ranges", json={"base_edit_token": current["edit_token"], **extra})
    assert response.status_code == 422
    unchanged = client.get(prefix).json()
    assert unchanged["reviewed_ranges"] == ranges and unchanged["edit_token"] == current["edit_token"]


@pytest.mark.parametrize("save_mode", ["create_version", "replace_current"])
def test_concurrent_choice_base_and_changed_source_reject_without_overwriting(client, save_mode):
    source = f"Before {MARKER} after."
    scan_id, messages = create_review(client, [source])
    if save_mode == "replace_current":
        from app.services.content_cleanup import process_scan_chunk
        # The initial version is intentionally immutable. Create version 2
        # before testing same-ID source replacement; do not relax that guard.
        first = client.get(f"/api/messages/{messages[0]}").json()["current_version"]["id"]
        source += "\n\nRevision two."
        assert client.patch(f"/api/messages/{messages[0]}", json={
            "content_markdown": source, "base_version_id": first, "save_mode": "create_version",
        }).status_code == 200
        response = client.post(f"/api/content-cleanup/scans/{scan_id}/rescan")
        assert response.status_code == 202
        scan_id = uuid.UUID(response.json()["id"])
        with session() as db:
            while not process_scan_chunk(db, scan_id)["done"]:
                db.commit()
            db.commit()
    item = candidate(client, scan_id)
    ranges = [bounds(item["start_offset"] + 1, item["end_offset"] - 1)]
    assert save(client, scan_id, item, ranges).status_code == 200
    assert save(client, scan_id, item, None).status_code == 409
    current = client.get(f"/api/content-cleanup/scans/{scan_id}/occurrences/{item['id']}").json()
    assert current["reviewed_ranges"] == ranges
    version = client.get(f"/api/messages/{messages[0]}").json()["current_version"]["id"]
    assert client.patch(f"/api/messages/{messages[0]}", json={
        "content_markdown": "Later " + source, "base_version_id": version, "save_mode": save_mode,
    }).status_code == 200
    assert save(client, scan_id, current, None).status_code == 409
    after = client.get(f"/api/messages/{messages[0]}").json()["current_version"]["display_text"]
    assert after == "Later " + source


@pytest.mark.parametrize("ranges", [[], [bounds(0, 999999)], [bounds(1, 3), bounds(2, 4)]])
def test_invalid_edit_does_not_change_saved_choice_or_source(client, ranges):
    scan_id, messages = create_review(client, [f"Before {MARKER} after."])
    item = candidate(client, scan_id)
    assert save(client, scan_id, item, ranges).status_code in (409, 422)
    current = candidate(client, scan_id)
    assert current["decision"] == "KEEP" and current["reviewed_ranges"] is None
    assert current["edit_token"] == item["edit_token"]
    with session() as db:
        assert db.query(MessageVersion).filter_by(message_id=messages[0]).count() == 1


def test_protected_ranges_cannot_be_adjusted_and_corrupt_ranges_never_expand(client):
    source = f"Before {MARKER} and protected `{MARKER}`."
    scan_id, messages = create_review(client, [source])
    prefix = f"/api/content-cleanup/scans/{scan_id}"
    rows = client.get(prefix + "/occurrences").json()
    protected = next(row for row in rows if row["decision"] == "PROTECTED")
    assert save(client, scan_id, protected, None).status_code == 409
    ordinary = next(row for row in rows if row["decision"] == "KEEP")
    assert save(client, scan_id, ordinary, None).status_code == 200
    with session() as db:
        row = db.get(ContentCleanupOccurrence, uuid.UUID(ordinary["id"]))
        row.reviewed_ranges = [bounds(0, len(source))]
        db.commit()
    proposed = client.get(prefix + "/preview").json()
    assert proposed["items"][0]["conflict"]
    assert proposed["items"][0]["removed_ranges"] == []
    result = client.post(prefix + "/apply", json={"preview_token": proposed["preview_token"]}).json()
    assert result == {"applied": 0, "conflicts": 1}
    assert client.get(f"/api/messages/{messages[0]}").json()["current_version"]["display_text"] == source
