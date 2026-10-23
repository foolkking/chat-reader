"""Normalization is display-only; exact raw offsets remain deletion authority."""
import re
import unicodedata
import uuid
from types import SimpleNamespace

import pytest

from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.content_cleanup import ContentCleanupOccurrence
from app.services import content_cleanup as cleanup
from test_import_preview_api import client  # noqa: F401
from test_cleanup_safety import create_review, session


VECTORS = [
    ("NOISE cafe\u0301", "NOISE caf\u00e9"),
    ("NOISE a\u0315\u0300", "NOISE \u00e0\u0315"),
    ("NOISE \u1100\u1161\u11a8", "NOISE \uac01"),
    ("NOISE \u09c7\u09be", "NOISE \u09cb"),
    ("NOISE a\u0327\u0301", "NOISE \u00e1\u0327"),
]
VECTOR_IDS = ["accent", "mark-order", "hangul", "zero-class-composition", "interleaved-composition"]


def reference(text, case_sensitive):
    value = unicodedata.normalize("NFKC", text)
    return re.sub(r"\s+", " ", value if case_sensitive else value.casefold())


@pytest.mark.parametrize("raw,literal", VECTORS, ids=VECTOR_IDS)
@pytest.mark.parametrize("case_sensitive", [False, True])
@pytest.mark.parametrize("mode", ["NORMALIZED", "APPROXIMATE"])
def test_equivalent_forms_keep_complete_original_candidate_offsets(raw, literal, case_sensitive, mode):
    assert reference(raw, case_sensitive) == reference(literal, case_sensitive)
    prefix = "🙂 Retain\r\n"
    source = prefix + raw + "\r\nAfter. Code `" + raw + "` kept."
    revision = SimpleNamespace(match_value=literal, matcher_mode=mode, case_sensitive=case_sensitive, boundary_mode="ANYWHERE")
    matches = cleanup.detect_occurrences("assistant", source, SimpleNamespace(detector_id=None), revision)
    exact = [item for item in matches if item.match_mode == "NORMALIZED_EXACT"]
    assert [(item.start, item.end) for item in exact] == [
        (len(prefix), len(prefix) + len(raw)),
        (source.rindex(raw), source.rindex(raw) + len(raw)),
    ]
    assert [item.decision for item in exact] == ["KEEP", "PROTECTED"]
    assert all(source[item.start:item.end] == raw for item in exact)


@pytest.mark.parametrize("raw,literal", VECTORS, ids=VECTOR_IDS)
def test_raw_exact_mode_does_not_start_normalizing_equivalent_forms(raw, literal):
    revision = SimpleNamespace(match_value=literal, matcher_mode="EXACT", case_sensitive=True, boundary_mode="ANYWHERE")
    assert cleanup.detect_occurrences("assistant", raw, SimpleNamespace(detector_id=None), revision) == []


@pytest.mark.parametrize("raw,literal", VECTORS, ids=VECTOR_IDS)
def test_fuzzy_candidates_use_the_complete_reordered_raw_envelope(raw, literal):
    source = raw + "\r\nCode `" + raw + "` kept."
    revision = SimpleNamespace(match_value=literal.replace("NOISE", "NOISX"),
        matcher_mode="APPROXIMATE", case_sensitive=True, boundary_mode="ANYWHERE", max_edit_distance=1)
    matches = cleanup.detect_occurrences("assistant", source, SimpleNamespace(detector_id=None), revision)
    fuzzy = [item for item in matches if item.match_mode == "BOUNDED_FUZZY"]
    assert [(item.start, item.end) for item in fuzzy] == [
        (0, len(raw)), (source.rindex(raw), source.rindex(raw) + len(raw)),
    ]
    assert [item.decision for item in fuzzy] == ["PROTECTED", "PROTECTED"]


@pytest.mark.parametrize("raw,literal",
    VECTORS[:3] + [("NOISE a\u0327\u0301", "NOISE \u00e1")],
    ids=VECTOR_IDS[:3] + ["partial-composition-envelope"])
def test_normalized_rule_review_refinement_and_apply_preserve_unnormalized_source(client, raw, literal):
    prefix = "🙂 Retain\r\n"
    source = prefix + raw + "\r\nAfter. Code `" + raw + "` kept."
    previous_scan, message_ids = create_review(client, [source])
    config = {"name": "Synthetic Unicode rule", "match_value": literal, "matcher_mode": "NORMALIZED", "role_filter": "assistant"}
    trial = client.post("/api/content-cleanup/rules/trial", json=config)
    assert trial.status_code == 200, trial.text
    assert trial.json()["matches"] == 2 and trial.json()["protected_matches"] == 1
    learned = client.post("/api/content-cleanup/rules/learn", json={
        **config, "confirmed": True, "preview_token": trial.json()["preview_token"],
    })
    assert learned.status_code == 200, learned.text
    response = client.post(f"/api/content-cleanup/scans/{previous_scan}/rescan")
    assert response.status_code == 202, response.text
    scan_id = uuid.UUID(response.json()["id"])
    with session() as db:
        while not cleanup.process_scan_chunk(db, scan_id)["done"]:
            db.commit()
        db.commit()
        original_version = db.get(Message, message_ids[0]).current_version_id
    path = f"/api/content-cleanup/scans/{scan_id}"
    rows = client.get(path + "/occurrences").json()
    assert len(rows) == 2
    assert [row["decision"] for row in rows] == ["KEEP", "PROTECTED"]
    item = rows[0]
    assert item["match_text"] == raw
    assert item["start_offset"] == len(prefix) and item["end_offset"] == len(prefix) + len(raw)
    ranges = [
        {"start_offset": item["start_offset"], "end_offset": item["start_offset"] + 1},
        {"start_offset": item["end_offset"] - 1, "end_offset": item["end_offset"]},
    ]
    saved = client.put(path + f"/occurrences/{item['id']}/removal-ranges", json={
        "base_edit_token": item["edit_token"], "ranges": ranges,
    })
    assert saved.status_code == 200, saved.text
    assert saved.json()["delete_count"] == 1
    preview = client.get(path + "/preview").json()
    assert preview["summary"] == {"conversations": 1, "messages": 1, "fragments": 2, "protected_confirmed": 0}
    proposed = preview["items"][0]
    assert not proposed["conflict"] and proposed["before"] == source
    assert proposed["removed_ranges"] == ranges
    expected = source
    for span in reversed(ranges):
        expected = expected[:span["start_offset"]] + expected[span["end_offset"]:]
    assert proposed["after"] == expected
    assert f"Code `{raw}` kept." in expected
    assert expected != unicodedata.normalize("NFKC", expected)
    with session() as db:
        assert db.get(Message, message_ids[0]).current_version_id == original_version
        assert db.query(MessageVersion).filter_by(message_id=message_ids[0]).count() == 1
    applied = client.post(path + "/apply", json={"preview_token": preview["preview_token"]})
    assert applied.status_code == 200, applied.text
    assert applied.json() == {"applied": 1, "conflicts": 0}
    with session() as db:
        message = db.get(Message, message_ids[0])
        assert message.current_version_id != original_version
        assert db.get(MessageVersion, message.current_version_id).display_text == expected
        assert db.get(MessageVersion, original_version).display_text == source
        assert db.query(MessageVersion).filter_by(message_id=message_ids[0]).count() == 2


def test_preexisting_partial_match_does_not_expand_consent_after_normalization_repair(client, monkeypatch):
    # Reproduce the previous per-code-point shadow only while recording an old
    # candidate/choice; current preview/apply must validate its exact old bounds.
    def old_shadow(text, *, case_sensitive):
        output, mapping = [], []
        for index, char in enumerate(text):
            value = unicodedata.normalize("NFKC", char)
            if not case_sensitive:
                value = value.casefold()
            if value.isspace():
                value = " "
            for item in value:
                if item == " " and output and output[-1] == " ":
                    mapping[-1] = (mapping[-1][0], index + 1)
                else:
                    output.append(item)
                    mapping.append((index, index + 1))
        return "".join(output), mapping

    source = "Retain NOISE a\u0327\u0301 after."
    with session() as db:
        cleanup.create_literal_rule(db, name="Synthetic previous match",
            match_value="NOISE a\u0327", matcher_mode="NORMALIZED")
        db.commit()
    with monkeypatch.context() as context:
        context.setattr(cleanup, "_shadow", old_shadow)
        scan_id, message_ids = create_review(client, [source])
        with session() as db:
            row = db.query(ContentCleanupOccurrence).filter_by(scan_id=scan_id).one()
            assert source[row.start_offset:row.end_offset] == "NOISE a\u0327"
            cleanup.update_decisions(db, scan_id, {row.id: "DELETE"})
            original_version = db.get(Message, message_ids[0]).current_version_id
            db.commit()
    path = f"/api/content-cleanup/scans/{scan_id}"
    preview = client.get(path + "/preview")
    assert preview.status_code == 200, preview.text
    item = preview.json()["items"][0]
    assert item["conflict"] and item["before"] == item["after"] == source
    assert item["removed_ranges"] == []
    with session() as db:
        assert cleanup.apply_scan(db, scan_id) == {"applied": 0, "conflicts": 1}
        db.commit()
        message = db.get(Message, message_ids[0])
        assert message.current_version_id == original_version
        assert db.get(MessageVersion, original_version).display_text == source
        assert db.query(MessageVersion).filter_by(message_id=message.id).count() == 1
