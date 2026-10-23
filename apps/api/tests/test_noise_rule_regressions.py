"""Synthetic safety and matching regressions; no user source or live services."""
import uuid
from types import SimpleNamespace

import pytest

from app.models.content_cleanup import ContentCleanupOccurrence, ContentCleanupScanRule
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.services import content_cleanup as cleanup
from app.services.cleanup_rule_access import available_versions
from app.services.ownership import OwnershipScope
from test_import_preview_api import client  # noqa: F401
from test_cleanup_learning import complete_scan
from test_cleanup_safety import create_review, session


def detect(source, detector=None, literal=None, mode="EXACT", boundary="ANYWHERE"):
    return cleanup.detect_occurrences("assistant", source, SimpleNamespace(detector_id=detector),
        SimpleNamespace(match_value=literal, matcher_mode=mode, case_sensitive=False, boundary_mode=boundary))


@pytest.mark.parametrize("source", [
    "recite turn12search4", "excite turn12search4", "_cite turn12search4",
    "cite_word turn12search4", "cite turn12search4suffix", "cite turn12search4_tail",
    "cite turn12search4é", "c1te turn12search4suffix", "ｃｉｔｅ turn12search4_tail",
])
def test_visible_citations_do_not_match_word_fragments(source):
    assert detect(source, "visible-turn-citation-v1") == []


@pytest.mark.parametrize("source", [
    "Keep (Cite turn12search4) after.", "Keep cite turn1search1 turn2view3.",
    "Keep ｃｉｔｅ turn12search4 after.",
])
def test_visible_citations_keep_precise_punctuation_boundaries(source):
    hits = detect(source, "visible-turn-citation-v1")
    assert len(hits) == 1
    assert source[hits[0].start:hits[0].end].lower().startswith(("cite", "ｃｉｔｅ"))
    assert not source[hits[0].start:hits[0].end].endswith((")", "."))


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize("tail", ["\n", "\r\n\r\n", " \t\r\n", "\u00a0\n"])
def test_footer_tolerates_trailing_whitespace_but_not_later_body(newline, tail):
    footer = f"{newline}{newline}---{newline}Powered by [ChatGPT Exporter](https://www.chatgptexporter.com){tail}"
    source = "Keep answer." + footer
    hits = detect(source, "chatgpt-exporter-footer-v1")
    assert len(hits) == 1 and source[hits[0].start:hits[0].end] == footer
    assert detect(source + "Ordinary final paragraph.", "chatgpt-exporter-footer-v1") == []
    assert detect("Ordinary prose Powered by [ChatGPT Exporter](https://www.chatgptexporter.com)", "chatgpt-exporter-footer-v1") == []


@pytest.mark.parametrize("source", ["abXcdefghijklmn", "acdefghijklmn"])
def test_fuzzy_anchor_position_accounts_for_insertion_and_deletion(source):
    hits = detect(source, literal="abcdefghijklmn", mode="APPROXIMATE")
    assert [(hit.start, hit.end) for hit in hits] == [(0, len(source))]
    assert hits[0].decision == "PROTECTED"


@pytest.mark.parametrize("source", ["abcdefgX", "Xabcdefg", "abcdefX"])
def test_fuzzy_lengths_are_filtered_by_boundary_before_ranking(source):
    hits = detect(source + "\r\n", literal="abcdefg", mode="APPROXIMATE", boundary="WHOLE_LINE")
    assert [(hit.start, hit.end) for hit in hits] == [(0, len(source))]


def test_normalization_expansion_and_fuzzy_windows_do_not_duplicate_candidates():
    hits = detect("ﬃ", literal="f", mode="NORMALIZED")
    assert [(hit.start, hit.end) for hit in hits] == [(0, 1)]
    source = "Keep abcdefghijklmn here."
    hits = detect(source, literal="abcdefghijklmn", mode="APPROXIMATE")
    assert [(hit.start, hit.end, hit.match_mode) for hit in hits] == [(5, 19, "NORMALIZED_EXACT")]


@pytest.mark.parametrize("fence", ["```", "~~~~"])
def test_crlf_fence_closer_does_not_protect_later_prose(fence):
    source = f"{fence}text\r\nNOISE\r\n{fence}\r\nNOISE"
    hits = detect(source, literal="NOISE")
    assert [hit.decision for hit in hits] == ["PROTECTED", "KEEP"]


def test_escaped_ticks_and_unclosed_spans_do_not_bridge_fenced_blocks():
    assert detect(r"\` NOISE \`", literal="NOISE")[0].decision == "KEEP"
    source = "Unclosed ` NOISE\n\n```text\nNOISE\n```\n\nNOISE `"
    hits = detect(source, literal="NOISE")
    assert [hit.decision for hit in hits] == ["KEEP", "PROTECTED", "KEEP"]


def test_thinking_rule_defaults_off_explicit_preference_and_snapshots_are_kept(client):
    source = "分析合成示例\r\n思考了 7s\r\n\r\nKeep answer."
    old_scan, messages = create_review(client, [source])
    rules = client.get("/api/content-cleanup/rules").json()
    rule = next(rule for rule in rules if rule["detector_id"] == "thinking-summary-v1")
    assert rule["status"] == "DISABLED"
    with session() as db:
        version = db.get(Message, messages[0]).current_version_id
        pinned = {item[0] for item in db.query(ContentCleanupScanRule.rule_revision_id).filter_by(scan_id=old_scan)}
        assert uuid.UUID(rule["revision_id"]) not in pinned
    assert client.get(f"/api/content-cleanup/scans/{old_scan}/occurrences").json() == []
    enabled = client.patch(f"/api/content-cleanup/rules/{rule['id']}", json={"status": "ACTIVE"})
    assert enabled.status_code == 200 and enabled.json()["status"] == "ACTIVE"
    # Re-reading/reseeding cannot overwrite explicit preferences; unrelated
    # accounts still use the default without creating preference rows.
    assert next(value for value in client.get("/api/content-cleanup/rules").json() if value["id"] == rule["id"])["status"] == "ACTIVE"
    with session() as db:
        assert uuid.UUID(rule["id"]) not in available_versions(db, OwnershipScope(uuid.uuid4()))
    scan = client.post(f"/api/content-cleanup/scans/{old_scan}/rescan").json()["id"]
    complete_scan(scan)
    hits = client.get(f"/api/content-cleanup/scans/{scan}/occurrences").json()
    assert len(hits) == 1 and hits[0]["match_text"] == source[:source.index("Keep answer.")]
    assert client.patch(f"/api/content-cleanup/rules/{rule['id']}", json={"status": "DISABLED"}).status_code == 200
    with session() as db:
        assert db.get(Message, messages[0]).current_version_id == version
        assert db.get(MessageVersion, version).display_text == source
        assert db.query(MessageVersion).filter_by(message_id=messages[0]).count() == 1
    # Disabling affects new scans, never the pinned ready scan.
    assert len(client.get(f"/api/content-cleanup/scans/{scan}/occurrences").json()) == 1


def test_trial_reports_coverage_and_saved_exceptions_without_hiding_raw_hits(client):
    config = {"name": "Synthetic literal", "match_value": "NOISE", "role_filter": None,
        "case_sensitive": True, "matcher_mode": "EXACT", "boundary_mode": "ANYWHERE"}
    rule = client.post("/api/content-cleanup/rules", json=config).json()
    scan, _ = create_review(client, ["Keep NOISE after.", "Keep Cite turn12search4 after."])
    hit = next(row for row in client.get(f"/api/content-cleanup/scans/{scan}/occurrences").json() if row["match_text"] == "NOISE")
    prefix = f"/api/content-cleanup/scans/{scan}/occurrences/{hit['id']}/exception"
    preview = client.get(prefix).json()
    assert client.post(prefix, json={"confirmed": True, "preview_token": preview["preview_token"]}).status_code == 201
    edit = {**config, "rule_id": rule["id"], "base_revision": rule["revision"], "base_revision_id": rule["revision_id"]}
    trial = client.post("/api/content-cleanup/rules/trial", json=edit)
    assert trial.status_code == 200, trial.text
    assert trial.json()["matches"] == trial.json()["suppressed_by_exception"] == 1
    assert trial.json()["samples"][0]["suppressed_by_exception"]
    changed = client.post("/api/content-cleanup/rules/trial", json={**edit, "case_sensitive": False}).json()
    assert changed["matches"] == 1 and changed["suppressed_by_exception"] == 0
    covered = client.post("/api/content-cleanup/rules/trial", json={**config, "match_value": "Cite turn12search4"}).json()
    assert covered["matches"] == covered["covered_by_other_rule"] == 1
    assert covered["samples"][0]["covered_by_other_rule"]


@pytest.mark.parametrize("source", [
    "Example: Cite turn12search4 is syntax.",
    "Keep c1te turn12search4 after.",
    "Keep \ue200url\ue202opaque-synthetic\ue201 after.",
])
def test_uncertain_hits_require_extra_confirmation_even_after_legacy_keep_or_forged_delete(client, source):
    scan, messages = create_review(client, [source])
    prefix = f"/api/content-cleanup/scans/{scan}"
    hit = client.get(prefix + "/occurrences").json()[0]
    assert hit["decision"] == "PROTECTED" and hit["protection_types"] == ["uncertain_or_example"]
    assert client.patch(prefix + "/decisions", json={"decisions": [{"occurrence_id": hit["id"], "decision": "DELETE"}]}).status_code == 422
    with session() as db:
        row = db.get(ContentCleanupOccurrence, uuid.UUID(hit["id"]))
        row.decision = "KEEP"
        db.commit()
    bulk = client.patch(prefix + "/decisions/filter", json={"decision": "DELETE", "all_matching": True})
    assert bulk.json()["matched"] == 0 and bulk.json()["skipped_protected"] == 1
    with session() as db:
        row = db.get(ContentCleanupOccurrence, uuid.UUID(hit["id"]))
        row.decision = "DELETE"
        row.decision_updated_at = cleanup.utc_now()
        db.commit()
        assert cleanup.apply_scan(db, scan) == {"applied": 0, "conflicts": 1}
        db.commit()
        assert db.get(MessageVersion, db.get(Message, messages[0]).current_version_id).display_text == source


@pytest.mark.parametrize("source", [
    "Example: Cite turn12search4 is syntax.",
    "Keep c1te turn12search4 after.",
    "Keep \ue200url\ue202opaque-synthetic\ue201 after.",
])
def test_uncertain_candidates_remain_actionable_after_explicit_risk_confirmation(client, source):
    scan, messages = create_review(client, [source])
    prefix = f"/api/content-cleanup/scans/{scan}"
    row = client.get(prefix + "/occurrences").json()[0]
    preview = client.post(prefix + "/protection-preview", json={"occurrence_ids": [row["id"]]}).json()
    assert preview["protected"] == preview["total"] == 1
    assert preview["items"][0]["protection_types"] == ["uncertain_or_example"]
    chosen = client.patch(prefix + "/decisions", json={
        "decisions": [{"occurrence_id": row["id"], "decision": "DELETE"}],
        "protection_token": preview["preview_token"],
    })
    assert chosen.status_code == 200
    saved = client.get(prefix + f"/occurrences/{row['id']}").json()
    assert saved["protection_confirmed"] and saved["decision"] == "DELETE"
    diff = client.get(prefix + "/preview").json()
    result = client.post(prefix + "/apply", json={"preview_token": diff["preview_token"]})
    assert result.status_code == 200 and result.json() == {"applied": 1, "conflicts": 0}
    with session() as db:
        current = db.get(MessageVersion, db.get(Message, messages[0]).current_version_id)
        assert current.display_text == source[:row["start_offset"]] + source[row["end_offset"]:]
