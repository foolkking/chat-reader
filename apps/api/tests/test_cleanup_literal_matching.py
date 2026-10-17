"""Literal matching keeps exact consent and avoids per-candidate source copies."""
import random
import uuid
from types import SimpleNamespace

import pytest

from app.models.message import Message
from app.models.message_version import MessageVersion
from app.services import content_cleanup as cleanup
from test_import_preview_api import client  # noqa: F401
from test_cleanup_safety import create_review, session


@pytest.mark.parametrize("literal", ["A    B", "Ｎ\t \r\nＯ", "A \t \r\nB"])
@pytest.mark.parametrize("case_sensitive", [False, True])
def test_short_normalized_approximate_rule_keeps_exact_matches_only(
    monkeypatch, literal, case_sensitive,
):
    cleanup.validate_literal_rule(literal, "APPROXIMATE")
    normalized, _ = cleanup._shadow(literal, case_sensitive=case_sensitive)
    assert len(normalized) < 6

    def no_fuzzy_scan(*args, **kwargs):
        pytest.fail("A short normalized literal must not enter fuzzy matching.")

    monkeypatch.setattr(cleanup, "_fuzzy_anchor_starts", no_fuzzy_scan)
    source = f"🙂 Retained {literal} end. Protected `{literal}`."
    revision = SimpleNamespace(
        match_value=literal, matcher_mode="APPROXIMATE",
        case_sensitive=case_sensitive, boundary_mode="ANYWHERE",
    )
    matches = cleanup.detect_occurrences(
        "assistant", source, SimpleNamespace(detector_id=None), revision,
    )
    assert len(matches) == 2
    assert [source[item.start:item.end] for item in matches] == [literal, literal]
    assert [item.decision for item in matches] == ["KEEP", "PROTECTED"]
    assert all(item.match_mode == "NORMALIZED_EXACT" for item in matches)


class _SliceProbe(str):
    sliced_characters = 0
    visited_characters = 0
    max_search_span = 0

    def __getitem__(self, key):
        if isinstance(key, slice):
            self.sliced_characters += len(range(*key.indices(len(self))))
        elif isinstance(key, int):
            self.visited_characters += 1
        return super().__getitem__(key)

    def rfind(self, sub, start=0, end=None):
        end = len(self) if end is None else end
        self.max_search_span = max(self.max_search_span, end - start)
        return super().rfind(sub, start, end)


def _reference_boundary(text, start, end, mode):
    if mode == "WHOLE_LINE":
        line_end = text.find("\n", end)
        return not text[text.rfind("\n", 0, start) + 1:start].strip() and not text[
            end:line_end if line_end != -1 else len(text)
        ].strip()
    if mode == "BLOCK_END":
        return not text[end:].strip()
    return True


@pytest.mark.parametrize("unit", [
    "\t\u3000NOISE \u00a0\n", "NOISE",
    " \t" * 160 + "NOISE" + " \t" * 160 + "\n",
    "NOISE" + " " * 320,
], ids=["short-lines", "adjacent", "wide-lines", "wide-one-line"])
@pytest.mark.parametrize("mode", ["WHOLE_LINE", "BLOCK_END"])
def test_boundary_checks_do_not_copy_source_per_candidate(unit, mode):
    text = _SliceProbe(unit * 512)
    plain = str(text)
    starts = cleanup._find_all(plain, "NOISE")
    expected = [_reference_boundary(plain, start, start + 5, mode) for start in starts]
    assert [cleanup._boundary_allows(text, start, start + 5, mode) for start in starts] == expected
    assert text.sliced_characters == 0
    assert text.visited_characters <= 2 * len(text)
    assert text.max_search_span <= 256


@pytest.mark.parametrize("mode", ["ANYWHERE", "WHOLE_LINE", "BLOCK_END"])
def test_boundary_checks_preserve_unicode_whitespace_and_line_semantics(mode):
    generator = random.Random(20261017)
    alphabet = "A🙂 \n\r\t\v\f\u0085\u00a0\u1680\u2000\u2028\u2029\u3000"
    for _ in range(1000):
        text = "".join(generator.choices(alphabet, k=generator.randrange(100)))
        start = generator.randrange(len(text) + 1)
        end = generator.randrange(start, len(text) + 1)
        assert cleanup._boundary_allows(text, start, end, mode) == _reference_boundary(text, start, end, mode)


def test_normalized_short_rule_trial_to_bulk_refinement_and_canonical_apply(client):
    literal = "A    B"
    source = (f"🙂 Retained {literal} after.\n" * 51) + f"Protected `{literal}`."
    previous_scan, message_ids = create_review(client, [source])
    config = {
        "name": "Synthetic whitespace rule", "match_value": literal,
        "matcher_mode": "APPROXIMATE", "role_filter": "assistant",
    }
    trial = client.post("/api/content-cleanup/rules/trial", json=config)
    assert trial.status_code == 200, trial.text
    assert trial.json()["matches"] == 52
    assert trial.json()["protected_matches"] == 1
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

    prefix = f"/api/content-cleanup/scans/{scan_id}"
    pages = [client.get(prefix + "/review", params={
        "rule_id": learned.json()["id"], "limit": 50, "offset": offset,
    }).json() for offset in (0, 50)]
    assert [page["total"] for page in pages] == [52, 52]
    assert [len(page["items"]) for page in pages] == [50, 2]
    assert all(page["selection_summary"] == {
        "selected": 0, "selected_elsewhere": 0, "protected": 1,
    } for page in pages)
    first = next(row for row in pages[0]["items"] if row["decision"] == "KEEP")
    refined = [
        {"start_offset": first["start_offset"], "end_offset": first["start_offset"] + 1},
        {"start_offset": first["end_offset"] - 1, "end_offset": first["end_offset"]},
    ]
    saved = client.put(prefix + f"/occurrences/{first['id']}/removal-ranges", json={
        "base_edit_token": first["edit_token"], "ranges": refined,
    })
    assert saved.status_code == 200, saved.text
    assert saved.json()["delete_count"] == 1
    selected = client.patch(prefix + "/decisions/filter", json={
        "decision": "DELETE", "all_matching": True, "rule_id": learned.json()["id"],
    })
    assert selected.status_code == 200, selected.text
    assert selected.json()["matched"] == 51
    assert selected.json()["scan"]["delete_count"] == 51
    current = client.get(prefix + f"/occurrences/{first['id']}").json()
    assert current["reviewed_ranges"] == refined
    preview = client.get(prefix + "/preview").json()
    assert preview["summary"] == {"conversations": 1, "messages": 1, "fragments": 52}
    proposed = preview["items"][0]
    assert not proposed["conflict"]
    assert all(span in proposed["removed_ranges"] for span in refined)
    expected = source
    for span in reversed(proposed["removed_ranges"]):
        expected = expected[:span["start_offset"]] + expected[span["end_offset"]:]
    assert proposed["after"] == expected
    assert f"Protected `{literal}`." in expected
    with session() as db:
        assert db.get(Message, message_ids[0]).current_version_id == original_version
        assert db.query(MessageVersion).filter_by(message_id=message_ids[0]).count() == 1
    applied = client.post(prefix + "/apply", json={"preview_token": preview["preview_token"]})
    assert applied.status_code == 200, applied.text
    assert applied.json() == {"applied": 51, "conflicts": 0}
    with session() as db:
        message = db.get(Message, message_ids[0])
        assert message.current_version_id != original_version
        assert db.get(MessageVersion, message.current_version_id).display_text == expected
        assert db.query(MessageVersion).filter_by(message_id=message_ids[0]).count() == 2
