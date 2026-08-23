from types import SimpleNamespace
import uuid

from app.core.database import get_db
from app.main import app
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.services.content_cleanup import MAX_APPROXIMATE_CANDIDATES_PER_MESSAGE, detect_occurrences, protected_ranges
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


def test_selection_uses_builtin_detector_before_manual_fallback() -> None:
    text = "prefix \ue200cite\ue202turn115162search3\ue201 suffix"
    matches = detect_occurrences("assistant", text, _rule("openai-private-citation-v1", "ASSISTANT_ONLY"), _revision())
    assert len(matches) == 1
    assert matches[0].reason_code == "PRIVATE_CITATION"
    assert matches[0].match_mode == "STRUCTURAL"


def test_private_citation_detector_covers_repeated_reference_separators() -> None:
    text = (
        "before "
        "\ue200cite\ue202turn800379search4\ue202turn800379search9"
        "\ue202turn800379search24\ue202turn115162search7\ue201"
        " after"
    )
    matches = detect_occurrences(
        "assistant",
        text,
        _rule("openai-private-citation-v1", "ASSISTANT_ONLY"),
        _revision(),
    )
    assert len(matches) == 1
    assert matches[0].reason_code == "PRIVATE_CITATION"
    assert matches[0].confidence == "HIGH"
    assert matches[0].decision == "DELETE"
    assert text[matches[0].start:matches[0].end].count("turn") == 4


def test_private_memcite_without_references_is_noise() -> None:
    text = "before \ue200memcite\ue201 after"
    matches = detect_occurrences(
        "assistant",
        text,
        _rule("openai-private-citation-v1", "ASSISTANT_ONLY"),
        _revision(),
    )
    assert len(matches) == 1
    assert matches[0].reason_code == "PRIVATE_CITATION"
    assert matches[0].confidence == "HIGH"


def test_private_citation_accepts_new_reference_kinds_inside_wrapper() -> None:
    text = "\ue200cite\ue202turn4finance1\ue202turn9image2\ue201"
    matches = detect_occurrences(
        "assistant",
        text,
        _rule("openai-private-citation-v1", "ASSISTANT_ONLY"),
        _revision(),
    )
    assert len(matches) == 1
    assert matches[0].confidence == "HIGH"
    assert matches[0].decision == "DELETE"


def test_private_citation_variants_and_real_url_marker() -> None:
    text = "\ue200 cite \ue202 turn1search0 \ue201 and \ue200cite\u200bturn2news3"
    matches = detect_occurrences("assistant", text, _rule("openai-private-citation-v1", "ASSISTANT_ONLY"), _revision())
    assert [item.reason_code for item in matches] == ["PRIVATE_CITATION", "PRIVATE_CITATION_BROKEN"]
    assert matches[0].decision == "DELETE"
    assert matches[1].decision == "KEEP"
    url = "\ue200 url \ue202 Example \ue202 https://example.test \ue201"
    assert detect_occurrences("assistant", url, _rule("openai-private-citation-v1", "ASSISTANT_ONLY"), _revision()) == []
    mixed = f"{url} then Cite turn4search2"
    assert detect_occurrences("assistant", mixed, _rule("openai-private-citation-v1", "ASSISTANT_ONLY"), _revision()) == []


def test_visible_citation_tolerates_only_bounded_syntax_damage() -> None:
    full_width = detect_occurrences(
        "assistant",
        "prefix \uff43\uff49\uff54\uff45 turn12search4 suffix",
        _rule("visible-turn-citation-v1", "ASSISTANT_ONLY"),
        _revision(),
    )
    assert len(full_width) == 1
    assert full_width[0].reason_code == "VISIBLE_CITATION_NORMALIZED"
    assert full_width[0].confidence == "HIGH"
    assert full_width[0].decision == "DELETE"

    damaged = detect_occurrences(
        "assistant",
        "prefix c1te turn12search4 suffix",
        _rule("visible-turn-citation-v1", "ASSISTANT_ONLY"),
        _revision(),
    )
    assert len(damaged) == 1
    assert damaged[0].reason_code == "VISIBLE_CITATION_FUZZY_TOKEN"
    assert damaged[0].confidence == "MEDIUM"
    assert damaged[0].decision == "KEEP"

    ordinary = detect_occurrences(
        "assistant",
        "We were excited to turn12search4 into a clearer identifier.",
        _rule("visible-turn-citation-v1", "ASSISTANT_ONLY"),
        _revision(),
    )
    assert ordinary == []


def test_normalized_and_approximate_rules_have_distinct_evidence() -> None:
    normalized = _revision("NOISE", False)
    normalized.matcher_mode = "NORMALIZED"
    assert detect_occurrences("assistant", "noise", _rule(), normalized)[0].match_mode == "NORMALIZED_EXACT"
    approximate = _revision("citation marker", True)
    approximate.matcher_mode = "APPROXIMATE"
    matches = detect_occurrences("assistant", "citation markeX", _rule(), approximate)
    assert matches and matches[0].confidence == "LOW" and matches[0].decision == "KEEP"


def test_approximate_rules_have_a_bounded_candidate_budget() -> None:
    approximate = _revision("aaaaaab", True)
    approximate.matcher_mode = "APPROXIMATE"
    matches = detect_occurrences("assistant", "a" * 50_000, _rule(), approximate)
    assert len(matches) <= MAX_APPROXIMATE_CANDIDATES_PER_MESSAGE
    assert all(item.decision == "KEEP" for item in matches)


def test_literal_detector_is_case_sensitive_by_default_and_can_ignore_code() -> None:
    text = "keep NOISE and `NOISE` and noise"
    matches = detect_occurrences("assistant", text, _rule(), _revision("NOISE"))
    assert len(matches) == 2
    assert matches[1].decision == "PROTECTED"


def test_protected_ranges_cover_fenced_code_math_and_asset_links() -> None:
    text = "```md\nNOISE\n```\nand $NOISE$ and [asset](cr-asset://abc)"
    ranges = protected_ranges(text)
    assert len(ranges) == 3
    assert all(start < end for start, end in ranges)


def test_protected_ranges_cover_variable_code_spans_and_indented_code() -> None:
    text = chr(96) * 2 + "code " + chr(96) + " NOISE" + chr(96) * 2 + " and\n    NOISE\n"
    ranges = protected_ranges(text)
    assert len(ranges) == 2


def test_separate_inline_code_spans_do_not_protect_text_between_them() -> None:
    text = "`keep` REMOVE THIS `keep too`"
    ranges = protected_ranges(text)
    start = text.index("REMOVE THIS")
    end = start + len("REMOVE THIS")
    assert len(ranges) == 2
    assert not any(start < protected_end and end > protected_start for protected_start, protected_end in ranges)


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


def test_reader_scan_applies_all_multi_reference_private_markers(client) -> None:
    marker = (
        "\ue200cite\ue202turn800379search4\ue202turn800379search9"
        "\ue202turn800379search24\ue202turn115162search7\ue201"
    )
    source = f"Keep this sentence. {marker} Also remove \ue200memcite\ue201."
    created = client.post(
        "/api/conversations",
        json={
            "title": "multi-reference cleanup fixture",
            "messages": [
                {"role": "user", "content_markdown": "Keep."},
                {"role": "assistant", "content_markdown": source},
            ],
        },
    )
    assert created.status_code == 201, created.text
    response = created.json()
    conversation_id = response["conversation"]["id"]
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

    occurrences = client.get(f"/api/content-cleanup/scans/{scan_id}/occurrences").json()
    assert len(occurrences) == 2
    assert all(item["confidence"] == "HIGH" and item["decision"] == "DELETE" for item in occurrences)
    assert client.post(f"/api/content-cleanup/scans/{scan_id}/apply").json() == {"applied": 2, "conflicts": 0}

    generator = override()
    db = next(generator)
    try:
        message = db.query(Message).filter(Message.conversation_id == uuid.UUID(conversation_id), Message.role == "assistant").one()
        version = db.get(MessageVersion, message.current_version_id)
        assert version.display_text == "Keep this sentence.  Also remove ."
    finally:
        db.close()
        generator.close()


def test_literal_rule_updates_create_an_immutable_revision(client) -> None:
    created = client.post("/api/content-cleanup/rules", json={"name": "literal fixture", "match_value": "remove me", "matcher_mode": "NORMALIZED", "boundary_mode": "WHOLE_LINE"})
    assert created.status_code == 201, created.text
    rule = created.json()
    assert rule["matcher_mode"] == "NORMALIZED"
    assert rule["boundary_mode"] == "WHOLE_LINE"
    updated = client.patch(
        f"/api/content-cleanup/rules/{rule['id']}",
        json={"match_value": "remove this instead", "case_sensitive": False},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["revision"] == 2
    assert updated.json()["match_value"] == "remove this instead"

    approximate = client.patch(
        f"/api/content-cleanup/rules/{rule['id']}",
        json={"matcher_mode": "APPROXIMATE"},
    )
    assert approximate.status_code == 200, approximate.text
    assert approximate.json()["revision"] == 3
    assert approximate.json()["normalization_profile"] == "NFKC_CASEFOLD_WHITESPACE"

    rejected = client.post(
        "/api/content-cleanup/rules",
        json={"name": "too broad", "match_value": "tiny", "matcher_mode": "APPROXIMATE"},
    )
    assert rejected.status_code == 422


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


def test_source_selection_classifies_builtin_noise_instead_of_manual_fallback(client) -> None:
    marker = "\ue200cite\ue202turn115162search3\ue201"
    source = f"保留🙂前缀 {marker} 保留后缀"
    created = client.post(
        "/api/conversations",
        json={"title": "classified selection cleanup", "messages": [{"role": "user", "content_markdown": "Keep."}, {"role": "assistant", "content_markdown": source}]},
    ).json()
    message_id = created["messages"][1]["id"]
    start = source.index(marker)
    scan = client.post(
        "/api/content-cleanup/scans",
        json={
            "source": "READER",
            "scope_type": "CURRENT_CONVERSATION",
            "conversation_ids": [created["conversation"]["id"]],
            "message_id": message_id,
            "selection_start_offset": start,
            "selection_end_offset": start + len(marker),
        },
    ).json()
    override = app.dependency_overrides[get_db]
    generator = override()
    db = next(generator)
    try:
        while not process_scan_chunk(db, uuid.UUID(scan["id"]))["done"]:
            db.commit()
        db.commit()
    finally:
        db.close()
        generator.close()
    item = client.get(f"/api/content-cleanup/scans/{scan['id']}/occurrences").json()[0]
    assert item["detector_id"] == "openai-private-citation-v1"
    assert item["reason_code"] == "PRIVATE_CITATION"
    assert item["match_mode"] == "STRUCTURAL"
    assert "REFERENCE_SEQUENCE" in item["evidence_codes"]


def test_partial_selection_expands_to_candidate_without_preselecting_delete(client) -> None:
    marker = "\ue200cite\ue202turn8search3\ue201"
    source = f"before {marker} after"
    created = client.post(
        "/api/conversations",
        json={"title": "partial selection cleanup", "messages": [{"role": "user", "content_markdown": "Keep."}, {"role": "assistant", "content_markdown": source}]},
    ).json()
    start = source.index("turn8")
    scan = client.post(
        "/api/content-cleanup/scans",
        json={
            "source": "READER",
            "scope_type": "CURRENT_CONVERSATION",
            "conversation_ids": [created["conversation"]["id"]],
            "message_id": created["messages"][1]["id"],
            "selection_start_offset": start,
            "selection_end_offset": start + len("turn8"),
        },
    ).json()
    override = app.dependency_overrides[get_db]
    generator = override()
    db = next(generator)
    try:
        while not process_scan_chunk(db, uuid.UUID(scan["id"]))["done"]:
            db.commit()
        db.commit()
    finally:
        db.close()
        generator.close()
    item = client.get(f"/api/content-cleanup/scans/{scan['id']}/occurrences").json()[0]
    assert item["reason_code"] == "PARTIAL_SELECTION"
    assert item["match_text"] == marker
    assert item["decision"] == "KEEP"
    assert item["confidence"] == "LOW"


def test_source_selection_surfaces_protected_ranges_for_explicit_review(client) -> None:
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
    updated = client.patch(
        f"/api/content-cleanup/scans/{scan_id}/decisions",
        json={"decisions": [{"occurrence_id": occurrence["id"], "decision": "DELETE"}]},
    )
    assert updated.status_code == 200, updated.text
    assert client.post(f"/api/content-cleanup/scans/{scan_id}/apply").json() == {"applied": 1, "conflicts": 0}
    assert client.get(f"/api/content-cleanup/scans/{scan_id}").status_code == 404
