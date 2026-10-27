from types import SimpleNamespace
import uuid

import pytest

from app.core.database import get_db
from app.main import app
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.content_cleanup import ContentCleanupRuleRevision, ContentCleanupScanRule
from app.services.content_cleanup import (
    MAX_APPROXIMATE_CANDIDATES_PER_MESSAGE,
    detect_occurrences,
    protected_ranges,
)
from app.services.content_cleanup import active_revisions, normalize_selection_offsets, process_scan_chunk
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
    assert matches[0].decision == "KEEP"
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
    assert matches[0].decision == "KEEP"


def test_private_citation_accepts_new_reference_kinds_inside_wrapper() -> None:
    text = "\ue200cite\ue202turn4finance1\ue202turn9image2\ue201"
    matches = detect_occurrences(
        "assistant",
        text,
        _rule("openai-private-citation-v1", "ASSISTANT_ONLY"),
        _revision(),
    )
    assert len(matches) == 1
    assert matches[0].decision == "KEEP"


def test_unknown_private_marker_is_surfaced_for_user_review() -> None:
    text = "before \ue200url\ue202opaque-resource-42\ue201 after"
    matches = detect_occurrences(
        "assistant",
        text,
        _rule("openai-private-marker-v1", "ASSISTANT_ONLY"),
        _revision(),
    )
    assert len(matches) == 1
    assert matches[0].reason_code == "PRIVATE_MARKER"
    assert matches[0].decision == "PROTECTED"
    assert "UNCERTAIN_CONTEXT" in matches[0].evidence_codes
    assert text[matches[0].start:matches[0].end] == "\ue200url\ue202opaque-resource-42\ue201"


def test_damaged_private_citation_is_surfaced_without_auto_delete() -> None:
    # Exporters occasionally lose one wrapper code point while preserving the
    # citation verb and stable turn reference. It must remain reviewable.
    text = "before cite\ue202turn115162search3 after"
    matches = detect_occurrences(
        "assistant",
        text,
        _rule("openai-private-citation-v1", "ASSISTANT_ONLY"),
        _revision(),
    )
    assert len(matches) == 1
    assert matches[0].reason_code == "PRIVATE_CITATION_FRAGMENT"
    assert matches[0].decision == "PROTECTED"


def test_generic_private_marker_is_reviewable_in_any_message_role() -> None:
    text = "user note \ue200url\ue202opaque-resource-42\ue201"
    matches = detect_occurrences(
        "user",
        text,
        _rule("openai-private-marker-v1", "MESSAGE"),
        _revision(),
    )
    assert len(matches) == 1
    assert matches[0].reason_code == "PRIVATE_MARKER"
    assert matches[0].decision == "PROTECTED"


def test_private_citation_variants_and_real_url_marker() -> None:
    text = "\ue200 cite \ue202 turn1search0 \ue201 and \ue200cite\u200bturn2news3"
    matches = detect_occurrences("assistant", text, _rule("openai-private-citation-v1", "ASSISTANT_ONLY"), _revision())
    assert [item.reason_code for item in matches] == ["PRIVATE_CITATION", "PRIVATE_CITATION_BROKEN"]
    assert matches[0].decision == "KEEP"
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
    assert full_width[0].decision == "KEEP"

    damaged = detect_occurrences(
        "assistant",
        "prefix c1te turn12search4 suffix",
        _rule("visible-turn-citation-v1", "ASSISTANT_ONLY"),
        _revision(),
    )
    assert len(damaged) == 1
    assert damaged[0].reason_code == "VISIBLE_CITATION_FUZZY_TOKEN"
    assert damaged[0].decision == "PROTECTED"

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
    assert matches and matches[0].decision == "PROTECTED"


def test_approximate_rules_have_a_bounded_candidate_budget() -> None:
    approximate = _revision("aaaaaab", True)
    approximate.matcher_mode = "APPROXIMATE"
    matches = detect_occurrences("assistant", "a" * 50_000, _rule(), approximate)
    assert len(matches) <= MAX_APPROXIMATE_CANDIDATES_PER_MESSAGE
    assert all(item.decision == "PROTECTED" for item in matches)


def test_literal_detector_is_case_sensitive_by_default_and_can_ignore_code() -> None:
    text = "keep NOISE and `NOISE` and noise"
    matches = detect_occurrences("assistant", text, _rule(), _revision("NOISE"))
    assert len(matches) == 2
    assert matches[1].decision == "PROTECTED"
    assert "PROTECTED_RANGE" in matches[1].evidence_codes


def test_protected_ranges_cover_fenced_code_math_and_asset_links() -> None:
    text = "```md\nNOISE\n```\nand $NOISE$ and [asset](cr-asset://abc)"
    ranges = protected_ranges(text)
    assert len(ranges) == 3
    assert all(start < end for start, end in ranges)


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize(("first", "continuation"), [
    ("", ""), ("> ", "> "), ("- ", "  "),
    ("> - ", ">   "), ("- > ", "  > "),
])
@pytest.mark.parametrize("fragment", [
    "left | `first\n--- | ---\nNOISE` | tail",
    "left | `first\n--- | ---\ncell | tail\nordinary NOISE`",
    "Retain `first\nleft | middle\n--- | ---\nNOISE` | tail",
    "left | middle\n--- | ---\n`first | NOISE`",
    "left | middle\n--- | ---\n`first\nNOISE` | tail",
    "`first | NOISE`\n--- | ---",
    "`first\n:-\nNOISE`",
    "`first\n|-|\nNOISE`",
    "left | middle\n--- | ---\n[first | tail](NOISE)",
    "left | middle\n--- | ---\n[first\nlast](/NOISE)",
    "left | middle\n--- | ---\n`NOISE|part` | tail",
])
def test_gfm_table_cells_cannot_borrow_inline_delimiters(
    fragment: str, first: str, continuation: str, newline: str,
) -> None:
    wrapped = newline.join(
        (first if index == 0 else continuation) + line
        for index, line in enumerate(fragment.split("\n"))
    )
    source = "合成 🧪" + newline + newline + wrapped + newline + newline + "adjacent NOISE"
    assert protected_ranges(source) == []
    hits = detect_occurrences("assistant", source, _rule(), _revision("NOISE"))
    assert len(hits) == 2
    assert not any("PROTECTED_RANGE" in hit.evidence_codes for hit in hits)
    # Keep the independent, conservative multi-pipe context policy.
    line = next(line for line in wrapped.split(newline) if "NOISE" in line)
    cautious = line.count("|") >= 2
    assert [hit.decision for hit in hits] == ["PROTECTED" if cautious else "KEEP", "KEEP"]
    assert ["UNCERTAIN_CONTEXT" in hit.evidence_codes for hit in hits] == [cautious, False]
    assert all(source[hit.start:hit.end] == "NOISE" for hit in hits)


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize(("first", "continuation"), [
    ("", ""), ("> ", "> "), ("- ", "  "),
    ("> - ", ">   "), ("- > ", "  > "),
])
@pytest.mark.parametrize(("fragment", "protected"), [
    ("left | `NOISE`\n-- | -", "`NOISE`"),
    ("`NOISE`\n:-", "`NOISE`"),
    ("left | middle\n--- | ---\n`NOISE` | tail", "`NOISE`"),
    (r"left | middle" + "\n--- | ---\n" + r"`NOISE\|part` | tail", r"`NOISE\|part`"),
    (r"left | middle" + "\n--- | ---\n" + r"`NOISE\\\|part` | tail", r"`NOISE\\\|part`"),
    ("left | `first\nnot | delimiter\nNOISE` | tail", "`first\nnot | delimiter\nNOISE`"),
    ("left | `first\n--- | --- | ---\nNOISE` | tail", "`first\n--- | --- | ---\nNOISE`"),
    ("left | `first\n    --- | ---\nNOISE` | tail", "`first\n    --- | ---\nNOISE`"),
])
def test_gfm_table_keeps_cell_code_and_non_table_paragraphs(
    fragment: str, protected: str, first: str, continuation: str, newline: str,
) -> None:
    wrapped = newline.join(
        (first if index == 0 else continuation) + line
        for index, line in enumerate(fragment.split("\n"))
    )
    source = wrapped + newline + newline + "adjacent NOISE"
    expected = protected.replace("\n", newline + continuation)
    start = source.index(expected)
    assert protected_ranges(source) == [(start, start + len(expected))]
    hits = detect_occurrences("assistant", source, _rule(), _revision("NOISE"))
    assert [hit.decision for hit in hits] == ["PROTECTED", "KEEP"]
    assert ["PROTECTED_RANGE" in hit.evidence_codes for hit in hits] == [True, False]


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize(("first", "continuation"), [
    ("", ""), ("> ", "> "), ("- ", "  "),
    ("> - ", ">   "), ("- > ", "  > "),
])
@pytest.mark.parametrize(("row", "retained"), [
    ("https://links.test/NOISE|NOISE", "https://links.test/NOISE"),
    ("www.links.test/NOISE|NOISE", "www.links.test/NOISE"),
    ("NOISE@links.test|NOISE", "NOISE@links.test"),
    ("[first|www.links.test/NOISE NOISE", "www.links.test/NOISE"),
    ("https://links.test/`first|`NOISE` NOISE", "`NOISE`"),
    ("www.links.test/`first|`NOISE` NOISE", "`NOISE`"),
])
def test_gfm_table_literal_urls_stop_at_their_cell(
    row: str, retained: str, first: str, continuation: str, newline: str,
) -> None:
    source = (
        first + "left | right" + newline + continuation + "--- | ---"
        + newline + continuation + row
    )
    hits = detect_occurrences("assistant", source, _rule(), _revision("NOISE"))
    # A line-leading https: still independently activates the field heuristic.
    cautious = row.startswith("https:") and ">" not in continuation
    assert [hit.decision for hit in hits] == ["PROTECTED", "PROTECTED" if cautious else "KEEP"]
    assert ["PROTECTED_RANGE" in hit.evidence_codes for hit in hits] == [True, False]
    left = source.index(retained)
    assert (left, left + len(retained)) in protected_ranges(source)


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize("row", ["[label](/first|NOISE)", "[label](/first|NOISE", "[label](|NOISE)"])
def test_gfm_table_incomplete_link_fallback_stays_in_its_cell(row: str, newline: str) -> None:
    source = ("left | right\n--- | ---\n" + row).replace("\n", newline)
    assert protected_ranges(source) == [(source.index("]("), source.index("|NOISE"))]
    hit, = detect_occurrences("assistant", source, _rule(), _revision("NOISE"))
    assert hit.decision == "KEEP" and "PROTECTED_RANGE" not in hit.evidence_codes


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize("definition", ["[re", '[ref]: /kept "first'])
def test_gfm_table_head_interrupts_a_continued_definition(definition: str, newline: str) -> None:
    import re
    from app.services.content_cleanup import _markdown_reference_definition

    source = (
        definition + "\nleft | right\n--- | ---\nNOISE]: /kept\n\nadjacent NOISE"
    ).replace("\n", newline)
    lines = list(re.finditer(r".*(?:\n|$)", source))
    assert _markdown_reference_definition(source, lines, 0, 0, ()) is None
    # Do not confuse the retained legacy definition-looking-source safeguard
    # with a successfully registered native reference definition.
    legacy = [
        (m.start(), m.end()) for m in re.finditer(
            r"(?m)^\s*\[[^\]]+\]:[ \t]*(?:<[^>\r\n]+>|\S+)(?:[ \t]+[^\r\n]*)?$", source,
        )
    ]
    assert protected_ranges(source) == legacy
    hits = detect_occurrences("assistant", source, _rule(), _revision("NOISE"))
    inside = any(left <= hits[0].start and hits[0].end <= right for left, right in legacy)
    assert [hit.decision for hit in hits] == ["PROTECTED" if inside else "KEEP", "KEEP"]


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Retain <NOISE@links.test> NOISE", [(7, 25)]),
        ("Retain <NOISE@retained> NOISE", [(7, 23)]),
        ("Retain <a+1:NOISE> NOISE", [(7, 18)]),
        ("Retain <xy:NOISE> NOISE", [(7, 17)]),
        ("Retain <http://links.test/NOISE> NOISE", [(7, 32)]),
        ("Retain <NOISE`@links.test> NOISE", [(7, 26)]),
        ("Retain [<NOISE@links.test>](/retained) NOISE", [(8, 38)]),
        ("Retain <NOISE@a-> NOISE", []),
        ("Retain <NOISE@a..b> NOISE", []),
        ("Retain <a:NOISE> NOISE", []),
    ],
)
def test_commonmark_angle_autolinks_protect_only_native_link_spans(
    text: str, expected: list[tuple[int, int]],
) -> None:
    assert protected_ranges(text) == expected


def test_commonmark_angle_autolinks_do_not_hide_adjacent_literal_matches() -> None:
    text = "Retain <NOISE@links.test> and NOISE"
    matches = detect_occurrences("assistant", text, _rule(), _revision("NOISE"))
    assert [(text[item.start:item.end], item.decision) for item in matches] == [
        ("NOISE", "PROTECTED"),
        ("NOISE", "KEEP"),
    ]
    assert text[matches[0].start:matches[0].end] == "NOISE"
    assert text[matches[1].start:matches[1].end] == "NOISE"


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
def test_multiline_reference_definitions_own_their_continuations(
    newline: str,
) -> None:
    source = (
        "Retain [retained][r*ef] "
        "[~retained *h&#116;tps://links.test/NOISE~NOISE* retained"
        + newline + newline
        + "[r*ef]:" + newline + " /retained"
    )
    ranges = protected_ranges(source)
    url_start = source.index("h&#116;")
    url_end = source.index("~NOISE", url_start)
    definition_start = source.index("[r*ef]:")
    link_start = source.index("[retained]")
    assert (link_start, source.index(" ", link_start)) in ranges
    assert (url_start, url_end) in ranges
    assert any(start <= definition_start and end >= len(source) for start, end in ranges)

    matches = detect_occurrences("assistant", source, _rule(), _revision("NOISE"))
    assert [source[item.start:item.end] for item in matches] == ["NOISE", "NOISE"]
    assert [item.decision for item in matches] == ["PROTECTED", "KEEP"]


def test_multiline_reference_title_does_not_extend_a_following_url() -> None:
    source = (
        "[ref]: /retained\n"
        ' "~*"\n'
        "Retain [a*b][ref] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained"
    )
    ranges = protected_ranges(source)
    assert (0, source.index("\nRetain")) in ranges
    url_start = source.index("h&#116;")
    url_end = source.index("*NOISE", url_start)
    assert (url_start, url_end) in ranges
    matches = detect_occurrences("assistant", source, _rule(), _revision("NOISE"))
    assert [item.decision for item in matches] == ["PROTECTED", "KEEP"]


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize("definition", [
    "[ref]:\n /NOISE",
    "   [ref]:\n    /NOISE",
    "[re\nf]: /NOISE",
    "[ref]: /retained\n \"NOISE\"",
    "[ref]: /retained \"first\n NOISE title\"",
    "> [ref]:\n> /NOISE",
    "> [ref]:\n/NOISE",
    "- [ref]:\n  /NOISE",
    "- [ref]:\n/NOISE",
    "> [ref]: /retained\n> \"first\n> NOISE title\"",
])
def test_multiline_definition_protects_exact_source_and_not_adjacent_noise(
    definition: str, newline: str,
) -> None:
    definition = definition.replace("\n", newline)
    source = definition + newline + "adjacent NOISE"
    assert protected_ranges(source) == [(0, len(definition))]
    matches = detect_occurrences("assistant", source, _rule(), _revision("NOISE"))
    assert [item.decision for item in matches] == ["PROTECTED", "KEEP"]
    assert source[matches[-1].start:matches[-1].end] == "NOISE"


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize("continuation", ["---", "***", "```", "<div>", "<!-- NOISE -->"])
def test_multiline_definition_cannot_register_through_an_interrupting_block(
    newline: str, continuation: str,
) -> None:
    import re
    from app.services.content_cleanup import _markdown_reference_definition

    source = "[ref]:" + newline + continuation + newline + newline + "NOISE"
    lines = list(re.finditer(r".*(?:\n|$)", source))
    assert _markdown_reference_definition(source, lines, 0, 0, ()) is None


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
def test_failed_continued_title_preserves_valid_definition_registration(
    newline: str,
) -> None:
    import re
    from app.services.content_cleanup import _markdown_reference_definition

    definition = "[ref]: /retained"
    source = definition + newline + '"NOISE" trailing' + newline + "NOISE"
    lines = list(re.finditer(r".*(?:\n|$)", source))
    assert _markdown_reference_definition(source, lines, 0, 0, ()) == (
        "REF", 0, len(definition),
    )
    assert protected_ranges(source) == [(0, len(definition))]
    matches = detect_occurrences("assistant", source, _rule(), _revision("NOISE"))
    assert [item.decision for item in matches] == ["KEEP", "KEEP"]


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
def test_multiline_reference_label_registers_without_quote_prefixes(
    newline: str,
) -> None:
    import re
    from app.services.content_cleanup import _markdown_reference_definition

    source = "> [r*" + newline + "> ef]: /retained"
    lines = list(re.finditer(r".*(?:\n|$)", source))
    assert _markdown_reference_definition(source, lines, 0, 2, (0,)) == (
        "R* EF", 1, len(source),
    )


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
def test_multiline_definition_label_does_not_extend_a_following_url(
    newline: str,
) -> None:
    source = (
        "Retain [retained][r* ef] "
        "[~retained *h&#116;tps://links.test/NOISE~NOISE* retained"
        + newline + newline + "[r*" + newline + "ef]: /retained"
    )
    url_start = source.index("h&#116;")
    url_end = source.index("~NOISE", url_start)
    assert (url_start, url_end) in protected_ranges(source)
    matches = detect_occurrences("assistant", source, _rule(), _revision("NOISE"))
    assert [item.decision for item in matches] == ["PROTECTED", "KEEP"]


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize(("definition", "identifier"), [
    ('[ref]: /retained "first\n2. NOISE title"', "REF"),
    ('[ref]: /retained "first\n001) NOISE title"', "REF"),
    ("[re\n2. NOISE]: /retained", "RE 2. NOISE"),
    ('> [ref]: /retained "first\n> 2. NOISE title"', "REF"),
    ("> > [ref]:\n> /NOISE", "REF"),
    ('> > [ref]: /retained "first\n> NOISE title"', "REF"),
    ('> - [ref]: /retained "first\n> NOISE title"', "REF"),
    ('2. [ref]: /retained "first\n    2. NOISE title"', "REF"),
])
def test_definition_continuation_uses_retained_parent_and_paragraph_rules(
    definition: str, identifier: str, newline: str,
) -> None:
    import re
    from app.services.content_cleanup import (
        _markdown_container_prefix, _markdown_reference_definition,
    )

    definition = definition.replace("\n", newline)
    source = definition + newline + newline + "adjacent NOISE"
    lines = list(re.finditer(r".*(?:\n|$)", source))
    prefix, containers, _opened = _markdown_container_prefix(
        lines[0].group(0).rstrip("\r\n"), (), False,
    )
    assert _markdown_reference_definition(source, lines, 0, prefix, containers) == (
        identifier, 1, len(definition),
    )
    assert protected_ranges(source) == [(0, len(definition))]
    hits = detect_occurrences("assistant", source, _rule(), _revision("NOISE"))
    assert [item.decision for item in hits] == ["PROTECTED", "KEEP"]


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize("definition", [
    '> [ref]: /retained "first\n2. NOISE title"',
    '> > [ref]: /retained "first\n> 2. NOISE title"',
    '> - [ref]: /retained "first\n> 2. NOISE title"',
    '- > [ref]: /retained "first\n    2. NOISE title"',
    '- > [ref]: /retained "first\n    # NOISE title"',
    '- > [re\n    2. NOISE]: /retained',
])
def test_missing_definition_parent_cannot_hide_a_new_block(
    definition: str, newline: str,
) -> None:
    import re
    from app.services.content_cleanup import (
        _markdown_container_prefix, _markdown_reference_definition,
    )

    source = definition.replace("\n", newline) + newline + newline + "adjacent NOISE"
    lines = list(re.finditer(r".*(?:\n|$)", source))
    prefix, containers, _opened = _markdown_container_prefix(
        lines[0].group(0).rstrip("\r\n"), (), False,
    )
    assert _markdown_reference_definition(source, lines, 0, prefix, containers) is None
    hits = detect_occurrences("assistant", source, _rule(), _revision("NOISE"))
    # The legacy conservative definition-looking policy can still protect
    # a malformed label; regardless, a later ordinary paragraph stays KEEP.
    assert hits[-1].decision == "KEEP"


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize(("first", "next_prefix"), [
    ("", ""), ("> ", "> "), ("- ", "  "), ("> - ", ">   "),
])
@pytest.mark.parametrize("marker", ["* ", "+\t", "1. ", "1)\t"])
def test_empty_new_list_item_cannot_interrupt_multiline_code(
    first: str, next_prefix: str, marker: str, newline: str,
) -> None:
    code = (
        first + "Retain `first" + newline + next_prefix + marker
        + newline + next_prefix + "NOISE`"
    )
    source = code + newline + newline + "adjacent NOISE"
    assert protected_ranges(source) == [(source.index("`"), len(code))]
    hits = detect_occurrences("assistant", source, _rule(), _revision("NOISE"))
    assert [item.decision for item in hits] == ["PROTECTED", "KEEP"]


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize("kind", ["label", "title"])
@pytest.mark.parametrize("marker", ["* ", "+\t", "1. ", "1)\t"])
def test_empty_new_list_item_cannot_interrupt_definition_continuation(
    kind: str, marker: str, newline: str,
) -> None:
    import re
    from app.services.content_cleanup import _markdown_reference_definition

    definition = (
        "[re" + newline + marker + newline + "NOISE]: /retained"
        if kind == "label" else
        '[ref]: /retained "first' + newline + marker + newline + 'NOISE title"'
    )
    source = definition + newline + newline + "adjacent NOISE"
    identifier = "RE " + marker.strip().upper() + " NOISE" if kind == "label" else "REF"
    lines = list(re.finditer(r".*(?:\n|$)", source))
    assert _markdown_reference_definition(source, lines, 0, 0, ()) == (
        identifier, 2, len(definition),
    )
    assert protected_ranges(source) == [(0, len(definition))]
    hits = detect_occurrences("assistant", source, _rule(), _revision("NOISE"))
    assert [item.decision for item in hits] == ["PROTECTED", "KEEP"]


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize(("first", "middle", "last"), [
    ("- ", "*", ""),              # A bare empty sibling is a real new item.
    ("> - ", "> 1.", "> "),       # A different sibling list also ends code.
    ("> ", "*", ""),              # Empty list after quote exit, not lazy text.
    ("> ", "2. item", ""),        # Non-one list after quote exit is a block.
    ("", "- ", ""),               # Setext underline still ends the first block.
    ("", "***", ""),              # Thematic break keeps its normal precedence.
    ("", "* item", ""),           # Nonempty list still interrupts a paragraph.
    ("", "", ""),                 # A blank line cannot bridge inline backticks.
])
def test_real_empty_sibling_and_other_blocks_do_not_borrow_inline_closers(
    first: str, middle: str, last: str, newline: str,
) -> None:
    source = (
        first + "Retain `first" + newline + middle + newline
        + last + "NOISE`" + newline + newline + "adjacent NOISE"
    )
    assert protected_ranges(source) == []
    hits = detect_occurrences("assistant", source, _rule(), _revision("NOISE"))
    assert [item.decision for item in hits] == ["KEEP", "KEEP"]


@pytest.mark.parametrize("marker", ["*", "+", "1.", "1)"])
@pytest.mark.parametrize("padding", ["", " ", "   "])
def test_empty_list_block_has_one_space_continuation_indent(
    marker: str, padding: str,
) -> None:
    from app.services.content_cleanup import _markdown_container_prefix

    line = marker + padding
    start, parents, opened = _markdown_container_prefix(line, (), False)
    assert opened and parents == (len(marker) + 1,)
    assert not line[start:].strip(" ")
    assert _markdown_container_prefix(line, (), True) == (0, (), False)


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize(("first", "continuation"), [
    ("", ""), ("> ", "> "), ("- ", "  "),
    ("> - ", ">   "), ("- > ", "  > "),
])
@pytest.mark.parametrize("marker", ["-", "*", "1.", "2)"])
@pytest.mark.parametrize("blank_count", [1, 2])
def test_blank_after_initial_empty_item_exits_only_that_list(
    first: str, continuation: str, marker: str, blank_count: int, newline: str,
) -> None:
    heading = first + marker + newline
    blanks = (continuation.rstrip(" ") + newline) * blank_count
    indent = " " * (len(marker) + 1)
    code = (
        continuation + indent + "```" + newline
        + continuation + "NOISE" + newline
        + continuation + indent + "```"
    )
    prefix = "合成 🧪" + newline + newline + heading + blanks
    source = prefix + code + newline + newline + "adjacent NOISE"
    assert protected_ranges(source) == [(len(prefix), len(prefix) + len(code))]
    hits = detect_occurrences("assistant", source, _rule(), _revision("NOISE"))
    assert [item.decision for item in hits] == ["PROTECTED", "KEEP"]
    assert ["PROTECTED_RANGE" in item.evidence_codes for item in hits] == [True, False]
    assert [source[item.start:item.end] for item in hits] == ["NOISE", "NOISE"]


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize(("first", "continuation"), [
    ("", ""), ("> ", "> "), ("- ", "  "),
    ("> - ", ">   "), ("- > ", "  > "),
])
@pytest.mark.parametrize("marker", ["-", "*", "1.", "2)"])
@pytest.mark.parametrize(("item", "blank_count"), [("", 0), ("item", 1), ("item", 2)])
def test_empty_item_immediate_content_and_nonempty_item_still_continue(
    first: str, continuation: str, marker: str, item: str,
    blank_count: int, newline: str,
) -> None:
    heading = first + marker + (" " + item if item else "") + newline
    blanks = (continuation.rstrip(" ") + newline) * blank_count
    fence = continuation + " " * (len(marker) + 1) + "```"
    source = (
        heading + blanks + fence + newline + continuation + "NOISE"
        + newline + fence + newline + fence + newline + newline + "adjacent NOISE"
    )
    hits = detect_occurrences("assistant", source, _rule(), _revision("NOISE"))
    assert [item.decision for item in hits] == ["KEEP", "KEEP"]
    assert not any("PROTECTED_RANGE" in item.evidence_codes for item in hits)


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Before https://links.test/NOISE NOISE", ["PROTECTED", "KEEP"]),
        ("Before https://links.test/path_(x)/NOISE. NOISE", ["PROTECTED", "KEEP"]),
        ("https://links.test/NOISE) NOISE", ["PROTECTED", "KEEP"]),
        (
            "[outer [inner][ref]](/NOISE) NOISE\n\n[ref]: /keep",
            ["KEEP", "KEEP"],
        ),
        (
            "[outer [inner][]](/NOISE) NOISE\n\n[inner]: /keep",
            ["KEEP", "KEEP"],
        ),
        (
            "[outer [inner]](/NOISE) NOISE\n\n[inner]: /keep",
            ["KEEP", "KEEP"],
        ),
        ("[outer [inner]](/NOISE) NOISE", ["PROTECTED", "KEEP"]),
        ("[outer [inner]](/NOISE) NOISE\n\n```\n[inner]: /keep\n```", ["PROTECTED", "KEEP"]),
        ("https://bad_domain.test/NOISE", ["KEEP"]),
    ],
)
def test_protected_ranges_follow_gfm_bare_urls_and_reference_link_labels(
    text: str, expected: list[str],
) -> None:
    matches = detect_occurrences("assistant", text, _rule(), _revision("NOISE"))
    actual = [match.decision for match in matches]
    if "bad_domain" in text:
        assert not any("NOISE" in text[start:end] for start, end in protected_ranges(text))
    elif text.startswith("https://") or text.startswith("Before https://"):
        # The surrounding URL context may independently trigger the
        # conservative uncertainty guard; assert link-span protection itself.
        first = matches[0]
        assert any(start <= first.start and first.end <= end for start, end in protected_ranges(text))
        assert not any(start <= matches[1].start < end for start, end in protected_ranges(text))
    else:
        assert actual == expected


@pytest.mark.parametrize(
    ("text", "expected_url"),
    [
        (
            "http://links.test:8080/NOISE NOISE",
            "http://links.test:8080/NOISE",
        ),
        (
            "http://links.test/NOISE&amp; NOISE",
            "http://links.test/NOISE",
        ),
        (
            "http://links.test/NOISE](x NOISE)",
            "http://links.test/NOISE",
        ),
        (
            "http://links.test/NOISE] NOISE",
            "http://links.test/NOISE",
        ),
        (
            "http://links.test/NOISE]x NOISE",
            "http://links.test/NOISE]x",
        ),
    ],
)
def test_gfm_url_protection_uses_renderer_destination_boundary(
    text: str, expected_url: str,
) -> None:
    start = text.index("http://")
    expected = (start, start + len(expected_url))
    assert expected in protected_ranges(text)


@pytest.mark.parametrize(
    "text",
    [
        "[https://links.test/NOISE] NOISE",
        "[https://links.test/NOISE",
        "[label https://links.test/NOISE NOISE",
    ],
)
def test_gfm_plain_brackets_preserve_text_transform_autolink_protection(
    text: str,
) -> None:
    url_start = text.index("https://")
    # These links are created by mdast's fallback transform, which does not
    # supply node.position. Missing coordinates do not mean missing anchors.
    assert protected_ranges(text) == [(url_start, text.index("NOISE") + 5)]


def test_gfm_does_not_autolink_the_visible_label_of_a_real_markdown_link() -> None:
    text = "[label https://links.test/NOISE](/target) NOISE"
    assert protected_ranges(text) == [(text.index("]("), text.index(") ") + 1)]


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize("separator", ["\n\n", "\n# Heading\n", "\n- "])
def test_gfm_unclosed_label_cannot_suppress_a_url_in_another_block(
    newline: str, separator: str,
) -> None:
    url = "https://links.test/NOISE"
    text = ("合成 🧪 [unclosed" + separator + url + " retained").replace("\n", newline)
    start = text.index(url)
    assert protected_ranges(text) == [(start, start + len(url))]


@pytest.mark.parametrize(
    ("source", "url"),
    [
        ("https://links.test/)NOISE( retained", "https://links.test/)NOISE("),
        ("https://links.test/(NOISE)) retained", "https://links.test/(NOISE)"),
        ("https://links.test/NOISE>TAIL retained", "https://links.test/NOISE>TAIL"),
        ("[https://links.test/NOISE_ retained", "https://links.test/NOISE_"),
        ("[https://links.test/NOISE~ retained", "https://links.test/NOISE~"),
        ("[https://links.test/NOISE* retained", "https://links.test/NOISE*"),
        ("https://-links.test/NOISE_ retained", "https://-links.test/NOISE_"),
        ("https://.links.test/NOISE](TAIL) retained", "https://.links.test/NOISE](TAIL)"),
        ("[https://localhost/NOISE retained", None),
        ("httpſ://links.test/NOISE retained", None),
    ],
)
def test_gfm_tokenizer_and_text_fallback_keep_their_own_url_boundaries(
    source: str, url: str | None,
) -> None:
    expected = [] if url is None else [(source.index(url), source.index(url) + len(url))]
    assert protected_ranges(source) == expected


def test_gfm_literal_url_brackets_do_not_become_markdown_label_openers() -> None:
    first = "https://links.test/NOISE[retained"
    second = "https://links.test/NOISE"
    source = first + " " + second + " retained"
    assert protected_ranges(source) == [(0, len(first)), (len(first) + 1, len(first) + 1 + len(second))]


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize("suffix,kept_suffix", [
    ("&amp;", ""),
    ("&#33;", ""),
    ("&#x29;", ""),
    (r"\)", ""),
    ("<stuff", "<stuff"),
    (r"\_", r"\_"),
    (r"\x", r"\x"),
    ("&NotEqualTilde;", "&NotEqualTilde;"),
    ("&#128;", "&#128;"),
    ("&#x1F9EA;", "&#x1F9EA;"),
    ("&Tab;tail", ""),
    ("&#32;tail", ""),
    ("&bogus;", "&bogus"),
    ("&amp", "&amp"),
    ("&#99999999;", "&#99999999"),
    ("&#40;part&#41;.", "&#40;part&#41;"),
])
def test_gfm_decoded_text_fallback_maps_kept_url_back_to_unchanged_source(
    suffix: str, kept_suffix: str, newline: str,
) -> None:
    url = "https://links.test/NOISE"
    text = "合成 🧪" + newline + "Retain [" + url + suffix + " retained"
    start = text.index(url)
    assert protected_ranges(text) == [(start, start + len(url + kept_suffix))]


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize("ticks", ["`", "``"])
@pytest.mark.parametrize("body,chunks", [
    ("Retain https://links.test/{t}NOISE keep{t} NOISE",
     ["https://links.test/{t}NOISE"]),
    ("Retain {t}https://links.test/NOISE keep{t} NOISE",
     ["{t}https://links.test/NOISE keep{t}"]),
    ("Retain {t}[keep{t} https://links.test/{t}NOISE keep{t} NOISE",
     ["{t}[keep{t}", "https://links.test/{t}NOISE"]),
    ("[label https://links.test/{t}NOISE keep{t}](/target) NOISE",
     ["{t}NOISE keep{t}](/target)"]),
])
def test_gfm_urls_and_inline_code_obey_source_order_not_independent_pairing(
    body: str, chunks: list[str], ticks: str, newline: str,
) -> None:
    source = "合成 🧪" + newline * 2 + body.format(t=ticks)
    expected = []
    for chunk in chunks:
        chunk = chunk.format(t=ticks)
        start = source.index(chunk)
        expected.append((start, start + len(chunk)))
    assert protected_ranges(source) == expected


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize("body,chunks", [
    ('Retain [https://links.test/NOISE retained', ['https://links.test/NOISE']),
    ('Retain [unclosed\nhttps://links.test/NOISE retained', ['https://links.test/NOISE']),
    ('Retain [http://links.test/NOISE retained', ['http://links.test/NOISE']),
    ('Retain [unclosed\nhttp://links.test/NOISE retained', ['http://links.test/NOISE']),
    ('Retain [h&#116;tps://links.test/NOISE retained', ['h&#116;tps://links.test/NOISE']),
    ('Retain [unclosed\nh&#116;tps://links.test/NOISE retained', ['h&#116;tps://links.test/NOISE']),
    ('Retain [&#104;ttps://links.test/NOISE retained', ['&#104;ttps://links.test/NOISE']),
    ('Retain [unclosed\n&#104;ttps://links.test/NOISE retained', ['&#104;ttps://links.test/NOISE']),
    ('Retain [h&#x74;tps://links.test/NOISE retained', ['h&#x74;tps://links.test/NOISE']),
    ('Retain [unclosed\nh&#x74;tps://links.test/NOISE retained', ['h&#x74;tps://links.test/NOISE']),
    ('Retain [http&#115;://links.test/NOISE retained', ['http&#115;://links.test/NOISE']),
    ('Retain [unclosed\nhttp&#115;://links.test/NOISE retained', ['http&#115;://links.test/NOISE']),
    ('Retain [https&colon;&sol;&sol;links.test/NOISE retained', ['https&colon;&sol;&sol;links.test/NOISE']),
    ('Retain [unclosed\nhttps&colon;&sol;&sol;links.test/NOISE retained', ['https&colon;&sol;&sol;links.test/NOISE']),
    ('Retain [https:\\/\\/links.test/NOISE retained', ['https:\\/\\/links.test/NOISE']),
    ('Retain [unclosed\nhttps:\\/\\/links.test/NOISE retained', ['https:\\/\\/links.test/NOISE']),
    ('Retain [&#72;TTP&#83;://links.test/NOISE retained', ['&#72;TTP&#83;://links.test/NOISE']),
    ('Retain [unclosed\n&#72;TTP&#83;://links.test/NOISE retained', ['&#72;TTP&#83;://links.test/NOISE']),
    ('Retain [&#104;&#116;&#116;&#112;&#115;&#58;&#47;&#47;links.test/NOISE retained', ['&#104;&#116;&#116;&#112;&#115;&#58;&#47;&#47;links.test/NOISE']),
    ('Retain [unclosed\n&#104;&#116;&#116;&#112;&#115;&#58;&#47;&#47;links.test/NOISE retained', ['&#104;&#116;&#116;&#112;&#115;&#58;&#47;&#47;links.test/NOISE']),
    ('Retain [h&#0000116;tps://links.test/NOISE retained', ['h&#0000116;tps://links.test/NOISE']),
    ('Retain [unclosed\nh&#0000116;tps://links.test/NOISE retained', ['h&#0000116;tps://links.test/NOISE']),
    ('Retain [h&#00000116;tps://links.test/NOISE retained', []),
    ('Retain [unclosed\nh&#00000116;tps://links.test/NOISE retained', []),
    ('Retain [&#65;https://links.test/NOISE retained', []),
    ('Retain [&#x41;https://links.test/NOISE retained', []),
    ('Retain [&#x1F9EA;https://links.test/NOISE retained', []),
    ('Retain [&amp;https://links.test/NOISE retained', ['https://links.test/NOISE']),
    ('Retain [&sol;https://links.test/NOISE retained', ['https://links.test/NOISE']),
    ('Retain [&colon;https://links.test/NOISE retained', ['https://links.test/NOISE']),
    ('Retain [&#32;https://links.test/NOISE retained', ['https://links.test/NOISE']),
    ('Retain [&Tab;https://links.test/NOISE retained', ['https://links.test/NOISE']),
    ('Retain [&NotEqualTilde;https://links.test/NOISE retained', []),
    ('Retain [&fjlig;https://links.test/NOISE retained', []),
    ('Retain [&bogus;https://links.test/NOISE retained', ['https://links.test/NOISE']),
    ('Retain [\\!https://links.test/NOISE retained', ['https://links.test/NOISE']),
    ('Retain [Ahttps://links.test/NOISE retained', []),
    ('Retain [!https://links.test/NOISE retained', ['https://links.test/NOISE']),
    ('Retain [<em>https://links.test/NOISE retained', ['https://links.test/NOISE']),
    ('Retain [&lt;em&gt;https://links.test/NOISE retained', ['https://links.test/NOISE']),
    ('Retain [https://links.test/NOISE<em>tail</em> retained', ['https://links.test/NOISE']),
    ('Retain [h&#116;tps://links.test/NOISE<em>tail</em> retained', ['h&#116;tps://links.test/NOISE']),
    ('Retain [https://links.test/NOISE<br/> retained', ['https://links.test/NOISE']),
    ('Retain [h&#116;tps://links.test/NOISE<br/> retained', ['h&#116;tps://links.test/NOISE']),
    ('Retain [https://links.test/NOISE<x-tag a="a>b">tail</x-tag> retained', ['https://links.test/NOISE']),
    ('Retain [h&#116;tps://links.test/NOISE<x-tag a="a>b">tail</x-tag> retained', ['h&#116;tps://links.test/NOISE']),
    ('Retain [https://links.test/NOISE<em x=plain>tail</em> retained', ['https://links.test/NOISE']),
    ('Retain [h&#116;tps://links.test/NOISE<em x=plain>tail</em> retained', ['h&#116;tps://links.test/NOISE']),
    ('Retain [https://links.test/NOISE<em disabled>tail</em> retained', ['https://links.test/NOISE']),
    ('Retain [h&#116;tps://links.test/NOISE<em disabled>tail</em> retained', ['h&#116;tps://links.test/NOISE']),
    ('Retain [https://links.test/NOISE<em x="NOISE">tail</em> retained', ['https://links.test/NOISE']),
    ('Retain [h&#116;tps://links.test/NOISE<em x="NOISE">tail</em> retained', ['h&#116;tps://links.test/NOISE']),
    ('Retain [https://links.test/NOISE</em>tail retained', ['https://links.test/NOISE']),
    ('Retain [h&#116;tps://links.test/NOISE</em>tail retained', ['h&#116;tps://links.test/NOISE']),
    ('Retain [https://links.test/NOISE<!--tail--> retained', ['https://links.test/NOISE']),
    ('Retain [h&#116;tps://links.test/NOISE<!--tail--> retained', ['h&#116;tps://links.test/NOISE']),
    ('Retain [https://links.test/NOISE<!-->tail retained', ['https://links.test/NOISE']),
    ('Retain [h&#116;tps://links.test/NOISE<!-->tail retained', ['h&#116;tps://links.test/NOISE']),
    ('Retain [https://links.test/NOISE<!--->tail retained', ['https://links.test/NOISE']),
    ('Retain [h&#116;tps://links.test/NOISE<!--->tail retained', ['h&#116;tps://links.test/NOISE']),
    ('Retain [https://links.test/NOISE<!DOCTYPE tail> retained', ['https://links.test/NOISE']),
    ('Retain [h&#116;tps://links.test/NOISE<!DOCTYPE tail> retained', ['h&#116;tps://links.test/NOISE']),
    ('Retain [https://links.test/NOISE<![CDATA[tail]]> retained', ['https://links.test/NOISE']),
    ('Retain [h&#116;tps://links.test/NOISE<![CDATA[tail]]> retained', ['h&#116;tps://links.test/NOISE']),
    ('Retain [https://links.test/NOISE<?tail?> retained', ['https://links.test/NOISE']),
    ('Retain [h&#116;tps://links.test/NOISE<?tail?> retained', ['h&#116;tps://links.test/NOISE']),
    ('Retain [https://links.test/NOISE<em\nx="retained">tail</em> retained', ['https://links.test/NOISE']),
    ('Retain [h&#116;tps://links.test/NOISE<em\nx="retained">tail</em> retained', ['h&#116;tps://links.test/NOISE']),
    ('Retain [https://links.test/NOISE<stuff retained', ['https://links.test/NOISE<stuff']),
    ('Retain [h&#116;tps://links.test/NOISE<stuff retained', ['h&#116;tps://links.test/NOISE<stuff']),
    ('Retain [https://links.test/NOISE<em x=>tail retained', ['https://links.test/NOISE<em']),
    ('Retain [h&#116;tps://links.test/NOISE<em x=>tail retained', ['h&#116;tps://links.test/NOISE<em']),
    ('Retain [https://links.test/NOISE<em x="missing retained', ['https://links.test/NOISE<em']),
    ('Retain [h&#116;tps://links.test/NOISE<em x="missing retained', ['h&#116;tps://links.test/NOISE<em']),
    ('Retain [https://links.test/NOISE<em!>tail retained', ['https://links.test/NOISE<em!>tail']),
    ('Retain [h&#116;tps://links.test/NOISE<em!>tail retained', ['h&#116;tps://links.test/NOISE<em!>tail']),
    ('Retain [https://links.test/NOISE<1em>tail retained', ['https://links.test/NOISE<1em>tail']),
    ('Retain [h&#116;tps://links.test/NOISE<1em>tail retained', ['h&#116;tps://links.test/NOISE<1em>tail']),
    ('Retain [https://links.test/NOISE\\<em>tail retained', ['https://links.test/NOISE\\<em>tail']),
    ('Retain [h&#116;tps://links.test/NOISE\\<em>tail retained', ['h&#116;tps://links.test/NOISE\\<em>tail']),
    ('Retain [https://links.test/NOISE&lt;em&gt;tail retained', ['https://links.test/NOISE&lt;em&gt;tail']),
    ('Retain [h&#116;tps://links.test/NOISE&lt;em&gt;tail retained', ['h&#116;tps://links.test/NOISE&lt;em&gt;tail']),
    ('Retain [https://links.test/NOISE<em x="<b>">tail</em> retained', ['https://links.test/NOISE']),
    ('Retain [h&#116;tps://links.test/NOISE<em x="<b>">tail</em> retained', ['h&#116;tps://links.test/NOISE']),
    ('Retain [https://links.test/NOISE<em x="https://links.test/NOISE">tail</em> retained', ['https://links.test/NOISE']),
    ('Retain [h&#116;tps://links.test/NOISE<em x="https://links.test/NOISE">tail</em> retained', ['h&#116;tps://links.test/NOISE']),
    ('Retain [https://links.test/NOISE<em x="`">tail</em> retained', ['https://links.test/NOISE']),
    ('Retain [h&#116;tps://links.test/NOISE<em x="`">tail</em> retained', ['h&#116;tps://links.test/NOISE']),
    ('Retain `h&#116;tps://links.test/NOISE` retained', ['`h&#116;tps://links.test/NOISE`']),
    ('Retain $h&#116;tps://links.test/NOISE$ retained', ['$h&#116;tps://links.test/NOISE$']),
    ('Retain [h&#116;tps://links.test/NOISE`kept` retained', ['h&#116;tps://links.test/NOISE`kept`']),
    ('Retain [https://links.test/NOISE<em>`code`</em> retained', ['https://links.test/NOISE', '`code`']),
    ('Retain `<em x="` https://links.test/NOISE retained', ['`<em x="`', 'https://links.test/NOISE']),
    ('Retain [h&#116;tps://links.test/NOISE\n\nretained', ['h&#116;tps://links.test/NOISE']),
    ('Retain [https://links.test/NOISE\n\n<em>retained', ['https://links.test/NOISE']),
    ('Retain <em x="https://links.test/NOISE">tail</em> retained', []),
    ('Retain [https://links.test/NOISE<em x=/>tail retained', ['https://links.test/NOISE']),
    ('Retain [https://links.test/NOISE<em x=a/b>tail retained', ['https://links.test/NOISE<em']),
    ('Retain [h&#116;tps://links.test/NOISE<em x="a"y=tail> retained', ['h&#116;tps://links.test/NOISE<em']),
    ('Retain [h&#116;tps://links.test/NOISE<em x="a" y=tail> retained', ['h&#116;tps://links.test/NOISE']),
    ('Retain https://links.test/NOISE\\<em>tail</em> retained', ['https://links.test/NOISE\\']),
])
def test_gfm_fallback_decodes_heads_and_prefixes_with_html_node_boundaries(
    body: str, chunks: list[str], newline: str,
) -> None:
    # Frozen expectations from the installed ReactMarkdown/GFM renderer, not
    # a second invocation of the detector or a decoded-text rewrite.
    source = "合成 🧪" + newline * 2 + body.replace("\n", newline)
    expected = []
    for chunk in chunks:
        chunk = chunk.replace("\n", newline)
        start = source.index(chunk)
        expected.append((start, start + len(chunk)))
    assert protected_ranges(source) == expected


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize("ticks", ["`", "``"])
@pytest.mark.parametrize("body,chunks", [
    ('Retain <em x="`">tail</em> ordinary `NOISE` NOISE', ['`NOISE`']),
    ('Retain \\<em x="`">tail</em> ordinary `NOISE` NOISE', ['`">tail</em> ordinary `']),
    ("Retain <em x='`'>tail</em> ordinary `NOISE` NOISE", ['`NOISE`']),
    ("Retain \\<em x='`'>tail</em> ordinary `NOISE` NOISE", ["`'>tail</em> ordinary `"]),
    ('Retain <!--`--> ordinary `NOISE` NOISE', ['`NOISE`']),
    ('Retain \\<!--`--> ordinary `NOISE` NOISE', ['`--> ordinary `']),
    ('Retain <?`?> ordinary `NOISE` NOISE', ['`NOISE`']),
    ('Retain \\<?`?> ordinary `NOISE` NOISE', ['`?> ordinary `']),
    ('Retain <![CDATA[`]]> ordinary `NOISE` NOISE', ['`NOISE`']),
    ('Retain \\<![CDATA[`]]> ordinary `NOISE` NOISE', ['`]]> ordinary `']),
    ('Retain <!THING `> ordinary `NOISE` NOISE', ['`NOISE`']),
    ('Retain \\<!THING `> ordinary `NOISE` NOISE', ['`> ordinary `']),
    ('Retain <em\nx="`">tail</em> ordinary `NOISE` NOISE', ['`NOISE`']),
    ('Retain \\<em\nx="`">tail</em> ordinary `NOISE` NOISE', ['`">tail</em> ordinary `']),
    ('Retain <em x="`"><b>tail</b></em> ordinary `NOISE` NOISE', ['`NOISE`']),
    ('Retain \\<em x="`"><b>tail</b></em> ordinary `NOISE` NOISE', ['`"><b>tail</b></em> ordinary `']),
    ('Retain <em x="https://links.test/`retained">tail</em> ordinary `NOISE` NOISE', ['`NOISE`']),
    ('Retain \\<em x="https://links.test/`retained">tail</em> ordinary `NOISE` NOISE', ['https://links.test/`retained">tail', '`NOISE`']),
    ('Retain <em x="[`]">tail</em> ordinary `NOISE` NOISE', ['`NOISE`']),
    ('Retain \\<em x="[`]">tail</em> ordinary `NOISE` NOISE', ['`]">tail</em> ordinary `']),
    ('Retain <em x="`" missing=\'quote>tail</em> ordinary `NOISE` NOISE', ['`" missing=\'quote>tail</em> ordinary `']),
    ('Retain \\<em x="`" missing=\'quote>tail</em> ordinary `NOISE` NOISE', ['`" missing=\'quote>tail</em> ordinary `']),
    ('Retain <em! x="`">tail</em> ordinary `NOISE` NOISE', ['`">tail</em> ordinary `']),
    ('Retain \\<em! x="`">tail</em> ordinary `NOISE` NOISE', ['`">tail</em> ordinary `']),
    ('Retain [h&#116;tps://links.test/retained<em x="`">tail</em> ordinary `NOISE` NOISE', ['h&#116;tps://links.test/retained', '`NOISE`']),
    ('Retain [h&#116;tps://links.test/retained\\<em x="`">tail</em> ordinary `NOISE` NOISE', ['h&#116;tps://links.test/retained\\<em', '`">tail</em> ordinary `']),
    ("Retain [h&#116;tps://links.test/retained<em x='`'>tail</em> ordinary `NOISE` NOISE", ['h&#116;tps://links.test/retained', '`NOISE`']),
    ("Retain [h&#116;tps://links.test/retained\\<em x='`'>tail</em> ordinary `NOISE` NOISE", ['h&#116;tps://links.test/retained\\<em', "`'>tail</em> ordinary `"]),
    ('Retain [h&#116;tps://links.test/retained<!--`--> ordinary `NOISE` NOISE', ['h&#116;tps://links.test/retained', '`NOISE`']),
    ('Retain [h&#116;tps://links.test/retained\\<!--`--> ordinary `NOISE` NOISE', ['h&#116;tps://links.test/retained\\<!--`--> ordinary `']),
    ('Retain [h&#116;tps://links.test/retained<?`?> ordinary `NOISE` NOISE', ['h&#116;tps://links.test/retained', '`NOISE`']),
    ('Retain [h&#116;tps://links.test/retained\\<?`?> ordinary `NOISE` NOISE', ['h&#116;tps://links.test/retained', '`?> ordinary `']),
    ('Retain [h&#116;tps://links.test/retained<![CDATA[`]]> ordinary `NOISE` NOISE', ['h&#116;tps://links.test/retained', '`NOISE`']),
    ('Retain [h&#116;tps://links.test/retained\\<![CDATA[`]]> ordinary `NOISE` NOISE', ['h&#116;tps://links.test/retained\\<![CDATA[`]]> ordinary `']),
    ('Retain [h&#116;tps://links.test/retained<!THING `> ordinary `NOISE` NOISE', ['h&#116;tps://links.test/retained', '`NOISE`']),
    ('Retain [h&#116;tps://links.test/retained\\<!THING `> ordinary `NOISE` NOISE', ['h&#116;tps://links.test/retained\\<!THING', '`> ordinary `']),
    ('Retain [h&#116;tps://links.test/retained<em\nx="`">tail</em> ordinary `NOISE` NOISE', ['h&#116;tps://links.test/retained', '`NOISE`']),
    ('Retain [h&#116;tps://links.test/retained\\<em\nx="`">tail</em> ordinary `NOISE` NOISE', ['h&#116;tps://links.test/retained\\<em', '`">tail</em> ordinary `']),
    ('Retain [h&#116;tps://links.test/retained<em x="`"><b>tail</b></em> ordinary `NOISE` NOISE', ['h&#116;tps://links.test/retained', '`NOISE`']),
    ('Retain [h&#116;tps://links.test/retained\\<em x="`"><b>tail</b></em> ordinary `NOISE` NOISE', ['h&#116;tps://links.test/retained\\<em', '`"><b>tail</b></em> ordinary `']),
    ('Retain [h&#116;tps://links.test/retained<em x="https://links.test/`retained">tail</em> ordinary `NOISE` NOISE', ['h&#116;tps://links.test/retained', '`NOISE`']),
    ('Retain [h&#116;tps://links.test/retained\\<em x="https://links.test/`retained">tail</em> ordinary `NOISE` NOISE', ['h&#116;tps://links.test/retained\\<em', 'https://links.test/`retained">tail</em> ordinary `']),
    ('Retain [h&#116;tps://links.test/retained<em x="[`]">tail</em> ordinary `NOISE` NOISE', ['h&#116;tps://links.test/retained', '`NOISE`']),
    ('Retain [h&#116;tps://links.test/retained\\<em x="[`]">tail</em> ordinary `NOISE` NOISE', ['h&#116;tps://links.test/retained\\<em', '`]">tail</em> ordinary `']),
    ('Retain [h&#116;tps://links.test/retained<em x="`" missing=\'quote>tail</em> ordinary `NOISE` NOISE', ['h&#116;tps://links.test/retained<em', '`" missing=\'quote>tail</em> ordinary `']),
    ('Retain [h&#116;tps://links.test/retained\\<em x="`" missing=\'quote>tail</em> ordinary `NOISE` NOISE', ['h&#116;tps://links.test/retained\\<em', '`" missing=\'quote>tail</em> ordinary `']),
    ('Retain [h&#116;tps://links.test/retained<em! x="`">tail</em> ordinary `NOISE` NOISE', ['h&#116;tps://links.test/retained<em', '`">tail</em> ordinary `']),
    ('Retain [h&#116;tps://links.test/retained\\<em! x="`">tail</em> ordinary `NOISE` NOISE', ['h&#116;tps://links.test/retained\\<em', '`">tail</em> ordinary `']),
    ('Retain https://links.test/retained\\<em x="`">tail</em> ordinary `NOISE` NOISE', ['https://links.test/retained\\', '`NOISE`']),
    ('Retain https://links.test/retained\\\\<em x="`">tail</em> ordinary `NOISE` NOISE', ['https://links.test/retained\\\\', '`NOISE`']),
    ("Retain https://links.test/retained\\<em x='`'>tail</em> ordinary `NOISE` NOISE", ['https://links.test/retained\\', '`NOISE`']),
    ("Retain https://links.test/retained\\\\<em x='`'>tail</em> ordinary `NOISE` NOISE", ['https://links.test/retained\\\\', '`NOISE`']),
    ('Retain https://links.test/retained\\<!--`--> ordinary `NOISE` NOISE', ['https://links.test/retained\\', '`NOISE`']),
    ('Retain https://links.test/retained\\\\<!--`--> ordinary `NOISE` NOISE', ['https://links.test/retained\\\\', '`NOISE`']),
    ('Retain https://links.test/retained\\<?`?> ordinary `NOISE` NOISE', ['https://links.test/retained\\', '`NOISE`']),
    ('Retain https://links.test/retained\\\\<?`?> ordinary `NOISE` NOISE', ['https://links.test/retained\\\\', '`NOISE`']),
    ('Retain https://links.test/retained\\<![CDATA[`]]> ordinary `NOISE` NOISE', ['https://links.test/retained\\', '`NOISE`']),
    ('Retain https://links.test/retained\\\\<![CDATA[`]]> ordinary `NOISE` NOISE', ['https://links.test/retained\\\\', '`NOISE`']),
    ('Retain https://links.test/retained\\<!THING `> ordinary `NOISE` NOISE', ['https://links.test/retained\\', '`NOISE`']),
    ('Retain https://links.test/retained\\\\<!THING `> ordinary `NOISE` NOISE', ['https://links.test/retained\\\\', '`NOISE`']),
    ('Retain https://links.test/retained\\<em\nx="`">tail</em> ordinary `NOISE` NOISE', ['https://links.test/retained\\', '`NOISE`']),
    ('Retain https://links.test/retained\\\\<em\nx="`">tail</em> ordinary `NOISE` NOISE', ['https://links.test/retained\\\\', '`NOISE`']),
    ('Retain https://links.test/retained\\<em x="`"><b>tail</b></em> ordinary `NOISE` NOISE', ['https://links.test/retained\\', '`NOISE`']),
    ('Retain https://links.test/retained\\\\<em x="`"><b>tail</b></em> ordinary `NOISE` NOISE', ['https://links.test/retained\\\\', '`NOISE`']),
    ('Retain https://links.test/retained\\<em x="https://links.test/`retained">tail</em> ordinary `NOISE` NOISE', ['https://links.test/retained\\', '`NOISE`']),
    ('Retain https://links.test/retained\\\\<em x="https://links.test/`retained">tail</em> ordinary `NOISE` NOISE', ['https://links.test/retained\\\\', '`NOISE`']),
    ('Retain https://links.test/retained\\<em x="[`]">tail</em> ordinary `NOISE` NOISE', ['https://links.test/retained\\', '`NOISE`']),
    ('Retain https://links.test/retained\\\\<em x="[`]">tail</em> ordinary `NOISE` NOISE', ['https://links.test/retained\\\\', '`NOISE`']),
    ('Retain https://links.test/retained\\<em x="`" missing=\'quote>tail</em> ordinary `NOISE` NOISE', ['https://links.test/retained\\', '`" missing=\'quote>tail</em> ordinary `']),
    ('Retain https://links.test/retained\\\\<em x="`" missing=\'quote>tail</em> ordinary `NOISE` NOISE', ['https://links.test/retained\\\\', '`" missing=\'quote>tail</em> ordinary `']),
    ('Retain https://links.test/retained\\<em! x="`">tail</em> ordinary `NOISE` NOISE', ['https://links.test/retained\\', '`">tail</em> ordinary `']),
    ('Retain https://links.test/retained\\\\<em! x="`">tail</em> ordinary `NOISE` NOISE', ['https://links.test/retained\\\\', '`">tail</em> ordinary `']),
    ('Retain `<em x="`">tail</em> ordinary `NOISE` NOISE', ['`<em x="`', '`NOISE`']),
    ('Retain `<a x="` earlier <em x=\'`\'>tail</em> ordinary `NOISE` NOISE', ['`<a x="`', '`NOISE`']),
    ('Retain <em x="`">tail</em> `NOISE` NOISE', ['`NOISE`']),
    ('Retain <em x="`\n\nNOISE` NOISE', []),
    ('Retain `<em>NOISE</em>` NOISE', ['`<em>NOISE</em>`']),
    ('Retain <em x="`">tail</em>\n\n`NOISE` NOISE', ['`NOISE`']),
])
def test_inline_html_and_code_own_delimiters_in_source_order(
    body: str, chunks: list[str], ticks: str, newline: str,
) -> None:
    # Frozen renderer spans; both tick lengths and actual CRLF/astral prefixes
    # were checked independently against rendered code/links/HTML nodes.
    source = "合成 🧪" + newline * 2 + body.replace("`", ticks).replace("\n", newline)
    expected = []
    for chunk in chunks:
        chunk = chunk.replace("`", ticks).replace("\n", newline)
        start = source.index(chunk)
        expected.append((start, start + len(chunk)))
    assert protected_ranges(source) == expected


_COMMONMARK_PROTOCOL_SLASHES = (
    ["/", "&sol;"]
    + [f"&#{'0' * count}47;" for count in range(6)]
    + [
        f"&#{marker}{'0' * count}2{letter};"
        for count in range(5) for marker in ("x", "X") for letter in ("f", "F")
    ]
)


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize("slashes", sorted({
    pair for slash in _COMMONMARK_PROTOCOL_SLASHES
    for pair in (slash + slash, slash + "/", "/" + slash)
}))
def test_gfm_protocol_slash_filter_keeps_all_commonmark_slash_origins(
    slashes: str, newline: str,
) -> None:
    prefix = "合成 🧪" + newline * 2 + "Retain ["
    # No incidental literal slash in the path can hide a broken origin filter.
    url = "h&#116;tps:" + slashes + "NOISE.links.test"
    source = prefix + url + " retained"
    assert protected_ranges(source) == [(len(prefix), len(prefix + url))]


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize("non_slash", [
    "&SOL;", "&sol", "&#00000047;", "&#x000002f;", "&#xff0f;", r"\&sol;",
])
def test_gfm_protocol_slash_filter_does_not_normalize_or_recursively_decode(
    non_slash: str, newline: str,
) -> None:
    source = "合成 🧪" + newline * 2 + "Retain [h&#116;tps:" + non_slash * 2 + "NOISE.links.test"
    assert protected_ranges(source) == []


def test_gfm_protocol_slash_filter_covers_every_named_reference_alias() -> None:
    from html.entities import html5
    from app.services import content_cleanup as cleanup

    # The complete installed named table was independently compared with the
    # renderer's CommonMark decoder. A new slash alias must update the filter.
    aliases = {name for name, value in html5.items() if name.endswith(";") and "/" in value}
    assert aliases == {"sol;"}
    assert all(cleanup._GFM_PROTOCOL_SLASH.search("&" + name) for name in aliases)


@pytest.mark.parametrize("separator,range_count,second_decision", [
    ("\n", 1, "KEEP"),
    ("\n\n", 2, "PROTECTED"),
])
def test_variable_code_spans_and_indentation_follow_paragraph_boundaries(
    separator: str, range_count: int, second_decision: str,
) -> None:
    text = chr(96) * 2 + "code " + chr(96) + " NOISE" + chr(96) * 2 + " and" + separator + "    NOISE\n"
    ranges = protected_ranges(text)
    assert len(ranges) == range_count
    matches = detect_occurrences("assistant", text, _rule(), _revision("NOISE"))
    assert [text[match.start:match.end] for match in matches] == ["NOISE", "NOISE"]
    assert [match.decision for match in matches] == ["PROTECTED", second_decision]


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
    assert client.patch(
        f"/api/content-cleanup/scans/{scan_id}/decisions",
        json={"decisions": [{"occurrence_id": item["id"], "decision": "DELETE"}]},
    ).status_code == 200
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
    assert all(item["decision"] == "KEEP" for item in occurrences)
    assert client.patch(
        f"/api/content-cleanup/scans/{scan_id}/decisions",
        json={"decisions": [{"occurrence_id": item["id"], "decision": "DELETE"} for item in occurrences]},
    ).status_code == 200
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


def test_full_conversation_scan_finds_markers_across_all_messages(client) -> None:
    marker = "\ue200cite\ue202turn800379search0\ue201"
    source = f"first {marker}\n\nsecond {marker}\n\nthird {marker}"
    user_marker = "\ue200url\ue202opaque-resource-42\ue201"
    created = client.post(
        "/api/conversations",
        json={
            "title": "whole conversation coverage",
            "messages": [
                {"role": "user", "content_markdown": f"Question {user_marker}"},
                {"role": "assistant", "content_markdown": source},
            ],
        },
    )
    assert created.status_code == 201, created.text
    conversation_id = created.json()["conversation"]["id"]
    scan = client.post(
        "/api/content-cleanup/scans",
        json={
            "source": "READER",
            "scope_type": "CURRENT_CONVERSATION",
            "conversation_ids": [conversation_id],
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
    occurrences = client.get(f"/api/content-cleanup/scans/{scan_id}/occurrences?limit=500").json()
    assert len(occurrences) == 4
    assert {item["reason_code"] for item in occurrences} == {"PRIVATE_CITATION", "PRIVATE_MARKER"}
    assert any(item["role"] == "user" and item["decision"] == "PROTECTED" for item in occurrences)


def test_rule_library_scan_covers_project_and_unclassified_active_conversations(client) -> None:
    marker = "\ue200cite\ue202turn800379search0\ue201"
    project_conversation = client.post(
        "/api/conversations",
        json={"title": "project cleanup fixture", "messages": [{"role": "user", "content_markdown": "Question"}, {"role": "assistant", "content_markdown": marker}]},
    ).json()
    unclassified_conversation = client.post(
        "/api/conversations",
        json={"title": "unclassified cleanup fixture", "messages": [{"role": "user", "content_markdown": "Question"}, {"role": "assistant", "content_markdown": marker}]},
    ).json()
    archived_conversation = client.post(
        "/api/conversations",
        json={"title": "archived cleanup fixture", "messages": [{"role": "user", "content_markdown": "Question"}, {"role": "assistant", "content_markdown": marker}]},
    ).json()
    project_id = client.post("/api/projects", json={"name": "Cleanup scope fixture"}).json()["id"]
    assert client.post(f"/api/projects/{project_id}/conversations/{project_conversation['conversation']['id']}").status_code == 200
    assert client.put(f"/api/conversations/{unclassified_conversation['conversation']['id']}/project", json={"project_id": None}).status_code == 200
    assert client.patch(f"/api/conversations/{archived_conversation['conversation']['id']}", json={"status": "archived"}).status_code == 200

    scan = client.post("/api/content-cleanup/rules/scan-existing")
    assert scan.status_code == 202, scan.text
    payload = scan.json()
    assert payload["scope_type"] == "ALL_ACTIVE"
    assert payload["source"] == "BATCH"
    assert payload["project_target_count"] >= 1
    assert payload["unassigned_target_count"] >= 1
    assert payload["excluded_archived_count"] >= 1

    scan_id = payload["id"]
    override = app.dependency_overrides[get_db]
    generator = override()
    db = next(generator)
    try:
        while not process_scan_chunk(db, uuid.UUID(scan_id)) ["done"]:
            db.commit()
        db.commit()
    finally:
        db.close()
        generator.close()

    occurrences = client.get(f"/api/content-cleanup/scans/{scan_id}/occurrences?limit=500").json()
    assert {item["conversation_id"] for item in occurrences} == {
        project_conversation["conversation"]["id"],
        unclassified_conversation["conversation"]["id"],
    }
    assert all(item["decision"] == "KEEP" for item in occurrences)
    assert all("confidence" not in item and "similarity_score" not in item for item in occurrences)


def test_rule_library_scan_reuses_same_snapshot_but_new_revision_starts_new_scan(client) -> None:
    conversation = client.post(
        "/api/conversations",
        json={
            "title": "snapshot conversation",
            "messages": [
                {"role": "user", "content_markdown": "Question"},
                {"role": "assistant", "content_markdown": "Answer"},
            ],
        },
    )
    assert conversation.status_code == 201, conversation.text
    created_rule = client.post(
        "/api/content-cleanup/rules",
        json={"name": "snapshot fixture", "match_value": "snapshot marker"},
    )
    assert created_rule.status_code == 201, created_rule.text
    first = client.post("/api/content-cleanup/rules/scan-existing")
    assert first.status_code == 202, first.text
    second = client.post("/api/content-cleanup/rules/scan-existing")
    assert second.status_code == 202, second.text
    assert second.json()["id"] == first.json()["id"]

    rule_id = created_rule.json()["id"]
    updated = client.patch(
        f"/api/content-cleanup/rules/{rule_id}",
        json={"match_value": "snapshot marker v2"},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["revision"] == 2
    override = app.dependency_overrides[get_db]
    generator = override()
    db = next(generator)
    try:
        revision_ids = [
            row[0]
            for row in db.query(ContentCleanupRuleRevision.id)
            .filter(ContentCleanupRuleRevision.rule_id == uuid.UUID(rule_id))
            .order_by(ContentCleanupRuleRevision.revision)
            .all()
        ]
        snapshot_ids = [
            row[0]
            for row in db.query(ContentCleanupScanRule.rule_revision_id)
            .filter(ContentCleanupScanRule.scan_id == uuid.UUID(first.json()["id"]))
            .all()
        ]
        current_revision_ids = {revision.id for revision in active_revisions(db)}
    finally:
        db.close()
        generator.close()
    assert len(revision_ids) == 2
    assert set(revision_ids) != set(snapshot_ids)
    assert revision_ids[-1] in current_revision_ids
    third = client.post("/api/content-cleanup/rules/scan-existing")
    assert third.status_code == 202, third.text
    assert third.json()["id"] != first.json()["id"]


def test_selection_scan_does_not_reuse_stale_full_scan(client) -> None:
    created = client.post(
        "/api/conversations",
        json={
            "title": "scan identity",
            "messages": [
                {"role": "user", "content_markdown": "Question"},
                {"role": "assistant", "content_markdown": "Answer Cite turn2search1"},
            ],
        },
    )
    assert created.status_code == 201
    payload = created.json()
    conversation_id = payload["conversation"]["id"]
    message_id = payload["messages"][1]["id"]
    full = client.post(
        "/api/content-cleanup/scans",
        json={"source": "READER", "scope_type": "CURRENT_CONVERSATION", "conversation_ids": [conversation_id]},
    )
    assert full.status_code == 202
    selected = client.post(
        "/api/content-cleanup/scans",
        json={
            "source": "READER",
            "scope_type": "CURRENT_CONVERSATION",
            "conversation_ids": [conversation_id],
            "message_id": message_id,
            "selection_start_offset": 7,
            "selection_end_offset": 23,
        },
    )
    assert selected.status_code == 202
    assert selected.json()["id"] != full.json()["id"]


def test_selection_offsets_recover_utf16_ranges_after_emoji() -> None:
    source = "前😀后 memcite 尾"
    selected = "尾"
    code_point_start = source.index(selected)
    code_point_end = code_point_start + len(selected)
    utf16_start = len(source[:code_point_start].encode("utf-16-le")) // 2
    utf16_end = len(source[:code_point_end].encode("utf-16-le")) // 2
    assert normalize_selection_offsets(source, utf16_start, utf16_end) == (code_point_start, code_point_end)


def test_selection_text_recovers_a_valid_manual_selection_when_offsets_drift(client) -> None:
    source = "前😀后 memcite 尾"
    created = client.post(
        "/api/conversations",
        json={"title": "manual selection recovery", "messages": [{"role": "user", "content_markdown": "Question"}, {"role": "assistant", "content_markdown": source}]},
    ).json()
    message_id = created["messages"][1]["id"]
    scan = client.post(
        "/api/content-cleanup/scans",
        json={
            "source": "READER",
            "scope_type": "CURRENT_CONVERSATION",
            "conversation_ids": [created["conversation"]["id"]],
            "message_id": message_id,
            "selection_start_offset": 999,
            "selection_end_offset": 1005,
            "selection_text": "memcite",
        },
    )
    assert scan.status_code == 202, scan.text
    override = app.dependency_overrides[get_db]
    generator = override()
    db = next(generator)
    try:
        while not process_scan_chunk(db, uuid.UUID(scan.json()["id"]))["done"]:
            db.commit()
        db.commit()
    finally:
        db.close()
        generator.close()
    occurrences = client.get(f"/api/content-cleanup/scans/{scan.json()['id']}/occurrences").json()
    assert len(occurrences) == 1
    assert occurrences[0]["reason_code"] == "MANUAL_SELECTION"
    assert occurrences[0]["match_text"] == "memcite"


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


def test_zero_match_scan_retains_a_readable_completion_until_dismissed(client) -> None:
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

    completed = client.get(f"/api/content-cleanup/scans/{scan_id}")
    assert completed.status_code == 200
    assert completed.json()["status"] == "READY"
    assert completed.json()["occurrence_count"] == 0
    assert client.delete(f"/api/content-cleanup/scans/{scan_id}").status_code == 204


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
    assert client.patch(
        f"/api/content-cleanup/scans/{scan_id}/decisions",
        json={"decisions": [{"occurrence_id": item["id"], "decision": "DELETE"}]},
    ).status_code == 200
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


def test_partial_selection_expands_to_candidate_and_keeps_it(client) -> None:
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
    assert "PROTECTED_RANGE" in occurrence["evidence_codes"]
    updated = client.patch(
        f"/api/content-cleanup/scans/{scan_id}/decisions",
        json={"decisions": [{"occurrence_id": occurrence["id"], "decision": "DELETE"}]},
    )
    assert updated.status_code == 422, updated.text
    assert client.post(f"/api/content-cleanup/scans/{scan_id}/apply").json() == {"applied": 0, "conflicts": 0}
    generator = override()
    db = next(generator)
    try:
        message = db.get(Message, uuid.UUID(message_id))
        assert db.get(MessageVersion, message.current_version_id).display_text == source
    finally:
        db.close()
        generator.close()


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
def test_html_flow_fallback_is_protected_without_suppressing_following_markdown(newline):
    source = newline.join([
        "<div>",
        "h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$",
        "</div>",
        "",
        "Retain `NOISE`",
    ])
    assert protected_ranges(source) == [
        (0, source.index("</div>") + len("</div>") + len(newline)),
        (source.rindex("`NOISE`"), source.rindex("`NOISE`") + len("`NOISE`")),
    ]
    hits = detect_occurrences(
        "assistant",
        source,
        SimpleNamespace(detector_id=None),
        SimpleNamespace(
            match_value="NOISE",
            matcher_mode="EXACT",
            case_sensitive=True,
            boundary_mode="ANYWHERE",
        ),
    )
    assert [source[hit.start:hit.end] for hit in hits] == ["NOISE"] * 5
    assert [hit.decision for hit in hits] == ["PROTECTED"] * 5


def test_html_code_fallback_and_supported_rich_projection_have_distinct_protection():
    fallback = "<div>\nNOISE\n</div>\n\nordinary NOISE"
    fallback_hits = detect_occurrences("assistant", fallback, _rule(), _revision("NOISE"))
    assert [hit.decision for hit in fallback_hits] == ["PROTECTED", "KEEP"]

    supported_rich_layout = (
        '<box border radius="xl"><text>NOISE</text>'
        '<divider color="subtle"/></box>\n\nordinary NOISE'
    )
    rich_hits = detect_occurrences(
        "assistant", supported_rich_layout, _rule(), _revision("NOISE"),
    )
    assert [hit.decision for hit in rich_hits] == ["KEEP", "KEEP"]

    unsupported_rich_layout = '<box unknown="x">\nNOISE\n</box>\n\nordinary NOISE'
    unsupported_hits = detect_occurrences(
        "assistant", unsupported_rich_layout, _rule(), _revision("NOISE"),
    )
    assert [hit.decision for hit in unsupported_hits] == ["PROTECTED", "KEEP"]


@pytest.mark.parametrize(("source", "expected_decisions"), [
    ("$a +\nNOISE + b$\n\nordinary NOISE", ("PROTECTED", "KEEP")),
    ("[\n\\text{NOISE}\n]\n\nordinary NOISE", ("PROTECTED", "KEEP")),
    ("before $$$a $$ NOISE b$$$ ordinary NOISE", ("PROTECTED", "KEEP")),
    ("before $$$a $$ NOISE b$$ ordinary NOISE", ("PROTECTED", "KEEP")),
    ("[\njust some words\n]\n\nordinary NOISE", ("KEEP",)),
    ("```\n[\n\\text{NOISE}\n]\n```\n\nordinary NOISE", ("PROTECTED", "KEEP")),
])
def test_math_renderer_source_ranges_protect_supported_math_without_swallowing_prose(
    source, expected_decisions,
):
    hits = detect_occurrences("assistant", source, _rule(), _revision("NOISE"))
    assert tuple(hit.decision for hit in hits) == expected_decisions
    assert tuple("PROTECTED_RANGE" in hit.evidence_codes for hit in hits) == tuple(
        decision == "PROTECTED" for decision in expected_decisions
    )


def test_link_title_delimiters_do_not_steal_following_inline_code():
    source = '[label](/keep "`") ordinary NOISE `NOISE`'
    hits = detect_occurrences("assistant", source, _rule(), _revision("NOISE"))
    assert [hit.decision for hit in hits] == ["KEEP", "PROTECTED"]

    code_source = '`NOISE [x](/keep "`") ordinary NOISE'
    code_hits = detect_occurrences("assistant", code_source, _rule(), _revision("NOISE"))
    assert [hit.decision for hit in code_hits] == ["PROTECTED", "KEEP"]


@pytest.mark.parametrize("source", [
    "left | right\n--- | ---\n$start | `prefix $ NOISE`\n\nordinary NOISE",
    "# $$head\n\n`prefix $$ NOISE`\n\nordinary NOISE",
    "$a +\nNOISE + b$\n\nordinary NOISE",
    "[\n\\text{NOISE}\n]\n\nordinary NOISE",
    "before $$$a $$ NOISE b$$$ ordinary NOISE",
    '[label](/keep "`") ordinary NOISE `NOISE`',
    "<div>\nNOISE\n</div>\n\nordinary NOISE",
    "<!--\n[retained](/NOISE)\n-->\n\nordinary NOISE",
    "<box padding={١}>\n<text>NOISE</text>\n</box>\n\nordinary NOISE",
    "<box>\n<text>NOISE</text>\n</box>\n\n$x\n<box>\ny$\n\nordinary NOISE",
])
@pytest.mark.parametrize("legacy_choice", [False, True])
def test_ordinary_batch_apply_preserves_renderer_protected_noise(client, source, legacy_choice):
    created = client.post(
        "/api/conversations",
        json={"title": "Renderer protection", "messages": [
            {"role": "user", "content_markdown": "Question"},
            {"role": "assistant", "content_markdown": source},
        ]},
    )
    assert created.status_code == 201, created.text
    conversation_id = created.json()["conversation"]["id"]
    rule = client.post(
        "/api/content-cleanup/rules",
        json={"name": "Renderer noise fixture", "match_value": "NOISE"},
    )
    assert rule.status_code == 201, rule.text
    scan = client.post(
        "/api/content-cleanup/scans",
        json={
            "source": "BATCH",
            "scope_type": "CURRENT_CONVERSATION",
            "conversation_ids": [conversation_id],
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

    occurrences = client.get(f"/api/content-cleanup/scans/{scan_id}/occurrences").json()
    noise_occurrences = [item for item in occurrences if item["match_text"] == "NOISE"]
    assert sorted(item["decision"] for item in noise_occurrences) == ["KEEP", "PROTECTED"]
    protected = next(item for item in noise_occurrences if item["decision"] == "PROTECTED")
    ordinary = next(item for item in noise_occurrences if item["decision"] == "KEEP")
    rejected = client.patch(
        f"/api/content-cleanup/scans/{scan_id}/decisions",
        json={"decisions": [{"occurrence_id": protected["id"], "decision": "DELETE"}]},
    )
    assert rejected.status_code == 422, rejected.text
    if legacy_choice:
        from app.models.content_cleanup import ContentCleanupOccurrence
        generator = override()
        db = next(generator)
        try:
            row = db.get(ContentCleanupOccurrence, uuid.UUID(protected["id"]))
            row.decision = "KEEP"
            row.evidence_codes = []
            db.commit()
        finally:
            db.close()
            generator.close()
    filtered = client.patch(
        f"/api/content-cleanup/scans/{scan_id}/decisions/filter",
        json={
            "decision": "DELETE",
            "all_matching": True,
            "rule_id": rule.json()["id"],
            "conversation_id": conversation_id,
        },
    )
    assert filtered.status_code == 200, filtered.text
    assert filtered.json()["matched"] == 1
    assert filtered.json()["skipped_protected"] == 1
    preview = client.get(f"/api/content-cleanup/scans/{scan_id}/preview")
    assert preview.status_code == 200, preview.text
    expected = source[:ordinary["start_offset"]] + source[ordinary["end_offset"]:]
    assert preview.json()["items"][0]["after"] == expected
    assert not preview.json()["items"][0]["conflict"]
    applied = client.post(
        f"/api/content-cleanup/scans/{scan_id}/apply",
        json={"preview_token": preview.json()["preview_token"]},
    )
    assert applied.status_code == 200, applied.text
    assert applied.json() == {"applied": 1, "conflicts": 0}

    generator = override()
    db = next(generator)
    try:
        message = db.query(Message).filter(
            Message.conversation_id == uuid.UUID(conversation_id),
            Message.role == "assistant",
        ).one()
        version = db.get(MessageVersion, message.current_version_id)
        assert version.display_text == expected
    finally:
        db.close()
        generator.close()


@pytest.mark.parametrize(("source", "protected_flags"), [
    ("<!--\n`NOISE` https://links.test/NOISE\n--> `NOISE`\nRetain", (True, True, True)),
    ("<pre>\n`NOISE` https://links.test/NOISE\n</style> `NOISE`\nRetain", (True, True, True)),
    ("<widget a=\"retained\">\n`NOISE` [retained](/NOISE)\n\nRetain `NOISE`", (True, True, True)),
])
def test_html_flow_terminators_and_blank_lines_restore_markdown(source, protected_flags):
    hits = detect_occurrences("assistant", source, _rule(), _revision("NOISE"))
    assert tuple("PROTECTED_RANGE" in hit.evidence_codes for hit in hits) == protected_flags


@pytest.mark.parametrize(("source", "expected_count"), [
    ("$$\n<div>\nNOISE\n$$\n\nRetain `NOISE`", 2),
    ("$$NOISE$$\n<div>\nNOISE", 2),
    ("$$\n<div>\nNOISE\nRetain `NOISE`", 2),
])
def test_math_flow_owns_html_looking_lines_and_keeps_following_code(source, expected_count):
    ranges = protected_ranges(source)
    hits = detect_occurrences(
        "assistant",
        source,
        SimpleNamespace(detector_id=None),
        SimpleNamespace(
            match_value="NOISE",
            matcher_mode="EXACT",
            case_sensitive=True,
            boundary_mode="ANYWHERE",
        ),
    )
    assert len(hits) == expected_count
    if source.startswith("$$\n") and "$$\n" not in source[3:]:
        assert all("PROTECTED_RANGE" in hit.evidence_codes for hit in hits)
        assert ranges[-1] == (0, len(source))
    elif source.startswith("$$NOISE$$"):
        assert all(hit.decision == "PROTECTED" for hit in hits)
        assert all("PROTECTED_RANGE" in hit.evidence_codes for hit in hits)
    else:
        assert "PROTECTED_RANGE" in hits[-1].evidence_codes
        assert ranges[-1] == (source.rindex("`NOISE`"), source.rindex("`NOISE`") + len("`NOISE`"))


@pytest.mark.parametrize("opening", ["<div>", "<pre>", "<!--", "<widget>"])
def test_html_flow_keeps_global_asset_safeguards_but_not_fake_definitions(opening):
    asset = "cr-asset://00000000-0000-0000-0000-000000000000"
    source = (
        opening + "\n" + asset + "\n"
        "[NOISE](attachment://retained)\n"
        "[NOISE]: /retained\n[^NOISE] [retained][NOISE]\n"
    )
    ranges = protected_ranges(source)
    assert any(left <= source.index(asset) and right >= source.index(asset) + len(asset)
               for left, right in ranges)
    hits = detect_occurrences("assistant", source, _rule(), _revision("NOISE"))
    assert ["PROTECTED_RANGE" in hit.evidence_codes for hit in hits] == [True, True, True, True]


def test_html_flow_fake_definition_cannot_resolve_an_outer_link_label():
    source = "<div>\n[fake]: /retained\n\n[outer [fake]](/NOISE)"
    hit = detect_occurrences("assistant", source, _rule(), _revision("NOISE"))[0]
    assert hit.decision == "PROTECTED"
    assert "PROTECTED_RANGE" in hit.evidence_codes
    assert protected_ranges(source) == [
        (0, source.index("\n\n") + 1),
        (source.index("](/NOISE)"), len(source)),
    ]


# Frozen installed application-renderer decisions, including literal HTML
# code fallback; existing conservative true flags are retained. NOISE is synthetic.
@pytest.mark.parametrize(("source", "protected_flags"), [
    ('合成 🧪\n\n<pre>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n</pre> `NOISE` h&#116;tps://links.test/NOISE\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, True, True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\nordinary\r\n    <pre>\r\n    h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\n\r\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\n   <SCRIPT x="retained">\r\n   h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\n   </style> `NOISE` h&#116;tps://links.test/NOISE\r\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, True, True, True, True, True, True, True)),
    ('合成 🧪\n\nordinary `\n<SCRIPT x="retained">\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\n\t<style\r\n\th&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\n\t</STYLE> `NOISE` h&#116;tps://links.test/NOISE\r\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, True, True, True, True, True, True, True)),
    ('合成 🧪\n\nordinary `\n   <style\n   h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, True, True, True, True, True)),
    ('合成 🧪\n\nordinary\n <textarea>\n h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\nordinary `\r\n\t<textarea>\r\n\th&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, False, True, True, False, True)),
    ('合成 🧪\n\n<!--\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n--> `NOISE` h&#116;tps://links.test/NOISE\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, True, True, True, True, True, True, True)),
    ('合成 🧪\n\n\t<!--\n\th&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\nordinary\r\n    <!--\r\n    h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\n\r\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\nordinary `\r\n   <!--\r\n   h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, True, True, True, True, True)),
    ('合成 🧪\n\n   <!-->\n   h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n   --> `NOISE` h&#116;tps://links.test/NOISE\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, True, True, True, True, True, True, True)),
    ('合成 🧪\n\nordinary\n <!-->\n h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\nordinary `\r\n<!-->\r\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\n\r\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\nordinary `\r\n\t<!-->\r\n\th&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, False, True, True, False, True)),
    ('合成 🧪\n\n<?\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n?> `NOISE` h&#116;tps://links.test/NOISE\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, True, True, True, True, True, True, True)),
    ('合成 🧪\n\n\t<?\n\th&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\nordinary\r\n    <?\r\n    h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\n\r\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\nordinary `\r\n   <?\r\n   h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, True, True, True, True, True)),
    ('合成 🧪\n\n   <?>\n   h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n   ?> `NOISE` h&#116;tps://links.test/NOISE\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, True, True, True, True, True, True, True)),
    ('合成 🧪\n\nordinary\n <?>\n h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\nordinary `\r\n<?>\r\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\n\r\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\nordinary `\r\n\t<?>\r\n\th&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, False, True, True, False, True)),
    ('合成 🧪\n\n<!doctype\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n> `NOISE` h&#116;tps://links.test/NOISE\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, True, True, True, True, True, True, True)),
    ('合成 🧪\n\n\t<!doctype\n\th&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\nordinary\r\n    <!doctype\r\n    h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\n\r\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\nordinary `\r\n   <!doctype\r\n   h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, True, True, True, True, True)),
    ('合成 🧪\n\n   <!a\n   h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n   > `NOISE` h&#116;tps://links.test/NOISE\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, True, True, True, True, True, True, True)),
    ('合成 🧪\n\nordinary\n <!a\n h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\nordinary `\r\n<!a\r\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\n\r\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\nordinary `\r\n\t<!a\r\n\th&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, False, True, True, False, True)),
    ('合成 🧪\n\n<![CDATA[\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n]]> `NOISE` h&#116;tps://links.test/NOISE\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, True, True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\n   <![CDATA[\r\n   h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\n   ]]> `NOISE` h&#116;tps://links.test/NOISE\r\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, True, True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\n\t<![CDATA[\r\n\th&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\n\t]]> `NOISE` h&#116;tps://links.test/NOISE\r\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, True, True, True, True, True, True, True)),
    ('合成 🧪\n\nordinary\n <![CDATA[\n h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\nordinary\r\n    <![CDATA[\r\n    h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\n\r\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, True, True, True, True, True)),
    ('合成 🧪\n\nordinary `\n<![CDATA[\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, True, True, True, True, True)),
    ('合成 🧪\n\nordinary `\n   <![CDATA[\n   h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\nordinary `\r\n\t<![CDATA[\r\n\th&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, False, True, True, False, True)),
    ('合成 🧪\n\n<div>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n</div> `NOISE` h&#116;tps://links.test/NOISE\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, True, True, True, True, True, True, True)),
    ('合成 🧪\n\nordinary\n <div>\n h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\nordinary `\r\n   <div>\r\n   h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\n\t</div>\r\n\th&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\n\t</div> `NOISE` h&#116;tps://links.test/NOISE\r\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, True, True, True, True, True, True, True)),
    ('合成 🧪\n\nordinary `\n</div>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, True, True, True, True, True)),
    ('合成 🧪\n\n   <div /foo\n   h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n   </div> `NOISE` h&#116;tps://links.test/NOISE\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, True, True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\nordinary\r\n    <div /foo\r\n    h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\n\r\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\nordinary `\r\n\t<div /foo\r\n\th&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, False, True, True, False, True)),
    ('合成 🧪\n\n<widget x="retained">\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n</widget> `NOISE` h&#116;tps://links.test/NOISE\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, True, True, True, True, True, True, True)),
    ('合成 🧪\n\nordinary\n <widget x="retained">\n h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\nordinary `\r\n   <widget x="retained">\r\n   h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, False, True, True, False, True)),
    ('合成 🧪\r\n\r\n\t</widget >\r\n\th&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\n\t</widget> `NOISE` h&#116;tps://links.test/NOISE\r\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, True, True, True, True, True, True, True)),
    ('合成 🧪\n\nordinary `\n</widget >\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, False, True, True, False, True)),
    ('合成 🧪\n\n   <widget/>\n   h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n   </widget> `NOISE` h&#116;tps://links.test/NOISE\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, True, True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\nordinary\r\n    <widget/>\r\n    h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\n\r\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\nordinary `\r\n\t<widget/>\r\n\th&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\nRetain `NOISE` h&#116;tps://links.test/NOISE', (True, False, True, True, False, True)),
    ('ordinary\n<address\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</address>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<ADDRESS/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<address /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<article\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</article>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<ARTICLE/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<article /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<aside\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</aside>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<ASIDE/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<aside /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<base\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</base>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<BASE/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<base /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<basefont\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</basefont>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<BASEFONT/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<basefont /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<blockquote\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</blockquote>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<BLOCKQUOTE/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<blockquote /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<body\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</body>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<BODY/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<body /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<caption\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</caption>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<CAPTION/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<caption /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<center\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</center>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<CENTER/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<center /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<col\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</col>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<COL/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<col /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<colgroup\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</colgroup>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<COLGROUP/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<colgroup /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<dd\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</dd>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<DD/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<dd /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<details\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</details>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<DETAILS/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<details /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<dialog\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</dialog>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<DIALOG/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<dialog /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<dir\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</dir>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<DIR/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<dir /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<div\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</div>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<DIV/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<div /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<dl\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</dl>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<DL/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<dl /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<dt\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</dt>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<DT/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<dt /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<fieldset\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</fieldset>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<FIELDSET/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<fieldset /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<figcaption\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</figcaption>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<FIGCAPTION/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<figcaption /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<figure\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</figure>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<FIGURE/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<figure /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<footer\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</footer>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<FOOTER/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<footer /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<form\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</form>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<FORM/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<form /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<frame\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</frame>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<FRAME/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<frame /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<frameset\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</frameset>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<FRAMESET/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<frameset /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<h1\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</h1>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<H1/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<h1 /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<h2\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</h2>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<H2/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<h2 /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<h3\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</h3>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<H3/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<h3 /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<h4\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</h4>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<H4/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<h4 /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<h5\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</h5>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<H5/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<h5 /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<h6\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</h6>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<H6/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<h6 /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<head\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</head>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<HEAD/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<head /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<header\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</header>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<HEADER/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<header /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<hr\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</hr>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<HR/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<hr /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<html\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</html>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<HTML/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<html /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<iframe\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</iframe>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<IFRAME/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<iframe /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<legend\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</legend>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<LEGEND/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<legend /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<li\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</li>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<LI/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<li /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<link\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</link>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<LINK/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<link /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<main\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</main>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<MAIN/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<main /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<menu\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</menu>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<MENU/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<menu /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<menuitem\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</menuitem>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<MENUITEM/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<menuitem /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<nav\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</nav>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<NAV/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<nav /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<noframes\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</noframes>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<NOFRAMES/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<noframes /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<ol\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</ol>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<OL/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<ol /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<optgroup\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</optgroup>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<OPTGROUP/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<optgroup /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<option\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</option>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<OPTION/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<option /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<p\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</p>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<P/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<p /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<param\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</param>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<PARAM/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<param /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<search\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</search>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<SEARCH/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<search /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<section\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</section>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<SECTION/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<section /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<summary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</summary>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<SUMMARY/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<summary /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<table\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</table>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<TABLE/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<table /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<tbody\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</tbody>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<TBODY/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<tbody /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<td\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</td>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<TD/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<td /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<tfoot\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</tfoot>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<TFOOT/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<tfoot /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<th\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</th>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<TH/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<th /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<thead\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</thead>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<THEAD/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<thead /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<title\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</title>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<TITLE/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<title /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<tr\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</tr>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<TR/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<tr /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<track\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</track>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<TRACK/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<track /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<ul\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n</ul>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<UL/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<ul /arbitrary\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('合成 🧪\n\n> <pre>\n> h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n> </pre> `NOISE`\n> Retain `NOISE`\n\nRetain `NOISE`', (True, True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\n> - <pre>\r\n>   h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\nRetain `NOISE`\r\n\r\nRetain `NOISE`', (True, True, True, True, True, True)),
    ('合成 🧪\n\n> <SCRIPT x="retained">\n> h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\nRetain `NOISE`\n\nRetain `NOISE`', (True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\n- > <SCRIPT x="retained">\r\n  > h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\n  >\r\n  > Retain `NOISE`\r\n\r\nRetain `NOISE`', (True, True, True, True, True, True)),
    ('合成 🧪\n\n- <style\n  h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\n  Retain `NOISE`\n\nRetain `NOISE`', (True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\n> > <style\r\n> > h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\n> > </STYLE> `NOISE`\r\n> > Retain `NOISE`\r\n\r\nRetain `NOISE`', (True, True, True, True, True, True, True)),
    ('合成 🧪\n\n> - <textarea>\n>   h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n>   </textarea> `NOISE`\n>   Retain `NOISE`\n\nRetain `NOISE`', (True, True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\n> > <textarea>\r\n> > h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\nRetain `NOISE`\r\n\r\nRetain `NOISE`', (True, True, True, True, True, True)),
    ('合成 🧪\n\n> <!--\n> h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n> --> `NOISE`\n> Retain `NOISE`\n\nRetain `NOISE`', (True, True, True, True, True, True, True)),
    ('合成 🧪\n\n- <!--\n  h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\n  Retain `NOISE`\n\nRetain `NOISE`', (True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\n> - <!--\r\n>   h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\nRetain `NOISE`\r\n\r\nRetain `NOISE`', (True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\n> > <!--\r\n> > h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\n> > --> `NOISE`\r\n> > Retain `NOISE`\r\n\r\nRetain `NOISE`', (True, True, True, True, True, True, True)),
    ('合成 🧪\n\n> <!-->\n> h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\nRetain `NOISE`\n\nRetain `NOISE`', (True, True, True, True, True, True)),
    ('合成 🧪\n\n> - <!-->\n>   h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n>   --> `NOISE`\n>   Retain `NOISE`\n\nRetain `NOISE`', (True, True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\n- > <!-->\r\n  > h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\n  >\r\n  > Retain `NOISE`\r\n\r\nRetain `NOISE`', (True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\n> > <!-->\r\n> > h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\nRetain `NOISE`\r\n\r\nRetain `NOISE`', (True, True, True, True, True, True)),
    ('合成 🧪\n\n> <?\n> h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n> ?> `NOISE`\n> Retain `NOISE`\n\nRetain `NOISE`', (True, True, True, True, True, True, True)),
    ('合成 🧪\n\n- <?\n  h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\n  Retain `NOISE`\n\nRetain `NOISE`', (True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\n> - <?\r\n>   h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\nRetain `NOISE`\r\n\r\nRetain `NOISE`', (True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\n> > <?\r\n> > h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\n> > ?> `NOISE`\r\n> > Retain `NOISE`\r\n\r\nRetain `NOISE`', (True, True, True, True, True, True, True)),
    ('合成 🧪\n\n> <?>\n> h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\nRetain `NOISE`\n\nRetain `NOISE`', (True, True, True, True, True, True)),
    ('合成 🧪\n\n> - <?>\n>   h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n>   ?> `NOISE`\n>   Retain `NOISE`\n\nRetain `NOISE`', (True, True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\n- > <?>\r\n  > h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\n  >\r\n  > Retain `NOISE`\r\n\r\nRetain `NOISE`', (True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\n> > <?>\r\n> > h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\nRetain `NOISE`\r\n\r\nRetain `NOISE`', (True, True, True, True, True, True)),
    ('合成 🧪\n\n> <!doctype\n> h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n> > `NOISE`\n> Retain `NOISE`\n\nRetain `NOISE`', (True, True, True, True, True, True, True)),
    ('合成 🧪\n\n- <!doctype\n  h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\n  Retain `NOISE`\n\nRetain `NOISE`', (True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\n> - <!doctype\r\n>   h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\nRetain `NOISE`\r\n\r\nRetain `NOISE`', (True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\n> > <!doctype\r\n> > h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\n> > > `NOISE`\r\n> > Retain `NOISE`\r\n\r\nRetain `NOISE`', (True, True, True, True, True, True, True)),
    ('合成 🧪\n\n> <!a\n> h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\nRetain `NOISE`\n\nRetain `NOISE`', (True, True, True, True, True, True)),
    ('合成 🧪\n\n> - <!a\n>   h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n>   > `NOISE`\n>   Retain `NOISE`\n\nRetain `NOISE`', (True, True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\n- > <!a\r\n  > h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\n  >\r\n  > Retain `NOISE`\r\n\r\nRetain `NOISE`', (True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\n> > <!a\r\n> > h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\nRetain `NOISE`\r\n\r\nRetain `NOISE`', (True, True, True, True, True, True)),
    ('合成 🧪\n\n> <![CDATA[\n> h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n> ]]> `NOISE`\n> Retain `NOISE`\n\nRetain `NOISE`', (True, True, True, True, True, True, True)),
    ('合成 🧪\n\n> <![CDATA[\n> h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\nRetain `NOISE`\n\nRetain `NOISE`', (True, True, True, True, True, True)),
    ('合成 🧪\n\n- <![CDATA[\n  h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\n  Retain `NOISE`\n\nRetain `NOISE`', (True, True, True, True, True, True)),
    ('合成 🧪\n\n> - <![CDATA[\n>   h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n>   ]]> `NOISE`\n>   Retain `NOISE`\n\nRetain `NOISE`', (True, True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\n> - <![CDATA[\r\n>   h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\nRetain `NOISE`\r\n\r\nRetain `NOISE`', (True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\n- > <![CDATA[\r\n  > h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\n  >\r\n  > Retain `NOISE`\r\n\r\nRetain `NOISE`', (True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\n> > <![CDATA[\r\n> > h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\n> > ]]> `NOISE`\r\n> > Retain `NOISE`\r\n\r\nRetain `NOISE`', (True, True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\n> > <![CDATA[\r\n> > h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\nRetain `NOISE`\r\n\r\nRetain `NOISE`', (True, True, True, True, True, True)),
    ('合成 🧪\n\n> <div>\n> h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n> </div> `NOISE`\n> Retain `NOISE`\n\nRetain `NOISE`', (True, True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\n> - <div>\r\n>   h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\n>   </div> `NOISE`\r\n>   Retain `NOISE`\r\n\r\nRetain `NOISE`', (True, True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\n> > <div>\r\n> > h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\n> > </div> `NOISE`\r\n> > Retain `NOISE`\r\n\r\nRetain `NOISE`', (True, True, True, True, True, True, True)),
    ('合成 🧪\n\n- </div>\n  h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\n  Retain `NOISE`\n\nRetain `NOISE`', (True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\n- > </div>\r\n  > h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\n  >\r\n  > Retain `NOISE`\r\n\r\nRetain `NOISE`', (True, True, True, True, True, True)),
    ('合成 🧪\n\n> <div /foo\n> h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\nRetain `NOISE`\n\nRetain `NOISE`', (True, True, True, True, True, True)),
    ('合成 🧪\n\n> - <div /foo\n>   h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\nRetain `NOISE`\n\nRetain `NOISE`', (True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\n> > <div /foo\r\n> > h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\nRetain `NOISE`\r\n\r\nRetain `NOISE`', (True, True, True, True, True, True)),
    ('合成 🧪\n\n> <widget x="retained">\n> h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n> </widget> `NOISE`\n> Retain `NOISE`\n\nRetain `NOISE`', (True, True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\n> - <widget x="retained">\r\n>   h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\n>   </widget> `NOISE`\r\n>   Retain `NOISE`\r\n\r\nRetain `NOISE`', (True, True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\n> > <widget x="retained">\r\n> > h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\n> > </widget> `NOISE`\r\n> > Retain `NOISE`\r\n\r\nRetain `NOISE`', (True, True, True, True, True, True, True)),
    ('合成 🧪\n\n- </widget >\n  h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\n  Retain `NOISE`\n\nRetain `NOISE`', (True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\n- > </widget >\r\n  > h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\n  >\r\n  > Retain `NOISE`\r\n\r\nRetain `NOISE`', (True, True, True, True, True, True)),
    ('合成 🧪\n\n> <widget/>\n> h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\nRetain `NOISE`\n\nRetain `NOISE`', (True, True, True, True, True, True)),
    ('合成 🧪\n\n> - <widget/>\n>   h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\nRetain `NOISE`\n\nRetain `NOISE`', (True, True, True, True, True, True)),
    ('合成 🧪\r\n\r\n> > <widget/>\r\n> > h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\nRetain `NOISE`\r\n\r\nRetain `NOISE`', (True, True, True, True, True, True)),
    ('合成 🧪\n\n<div/foo>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('合成 🧪\n\nordinary\n<diver> tail\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('合成 🧪\r\n\r\nordinary\r\n<widget a=bad`value>\r\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\n\r\nRetain `NOISE`', (True, False, True, True, True)),
    ('合成 🧪\r\n\r\n<widget/> trailing\r\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\n\r\nRetain `NOISE`', (True, True, True, True, True)),
    ('合成 🧪\n\nordinary\n<pre/foo>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('合成 🧪\n\n<!5>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('合成 🧪\r\n\r\n&lt;div>\r\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\n\r\nRetain `NOISE`', (True, True, True, True, True)),
    ('合成 🧪\r\n\r\nordinary\r\n<x:y>\r\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\n\r\nRetain `NOISE`', (True, True, True, True, True)),
    ('```\n<pre>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n</pre>\n```\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('- > ~~~\n  > <style\n  > h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n  > </STYLE>\n  > ~~~\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('- $$$ meta\n  <!--\n  h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n  -->\n  $$$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('~~~\n<?>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n?>\n~~~\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('> > $$\n> > <!a\n> > h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n> > >\n> > $$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('> - ```\n>   </div>\n>   h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n>   </div>\n>   ```\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('> $$\n> <widget x="retained">\n> h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n> </widget>\n> $$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('> > $$$ meta\n> > <widget/>\n> > h&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n> > </widget>\n> > $$$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('<pre>\nNOISE\n</pre >\n`NOISE`\n</script> `NOISE`\n`NOISE`', (True, True, True, True)),
    ('<pre>\r\nNOISE\r\n</pre >\r\n`NOISE`\r\n</script> `NOISE`\r\n`NOISE`', (True, True, True, True)),
    ('<!--\n\n`NOISE`\n--> `NOISE`\n`NOISE`', (True, True, True)),
    ('<!--\r\n\r\n`NOISE`\r\n--> `NOISE`\r\n`NOISE`', (True, True, True)),
    ('<?\n\n`NOISE`\n?> `NOISE`\n`NOISE`', (True, True, True)),
    ('<?\r\n\r\n`NOISE`\r\n?> `NOISE`\r\n`NOISE`', (True, True, True)),
    ('<![CDATA[\n\n`NOISE`\n]]> `NOISE`\n`NOISE`', (True, True, True)),
    ('<![CDATA[\r\n\r\n`NOISE`\r\n]]> `NOISE`\r\n`NOISE`', (True, True, True)),
    ('<div>\n```\nNOISE\n\nNOISE\n```\nNOISE', (True, False, True)),
    ('<div>\r\n```\r\nNOISE\r\n\r\nNOISE\r\n```\r\nNOISE', (True, False, True)),
    ('> ordinary\n<widget>\n`NOISE`', (True,)),
    ('> ordinary\r\n<widget>\r\n`NOISE`', (True,)),
    ('- ordinary\n<widget>\n`NOISE`', (True,)),
    ('- ordinary\r\n<widget>\r\n`NOISE`', (True,)),
    ('<div>\n[fake]: /retained\n\n[outer [fake]](/NOISE)', (True,)),
    ('<div>\r\n[fake]: /retained\r\n\r\n[outer [fake]](/NOISE)', (True,)),
    ('$$\n<div>\nNOISE\n$$\n`NOISE`', (True, True)),
    ('$$\r\n<div>\r\nNOISE\r\n$$\r\n`NOISE`', (True, True)),
    ('$$\n<div>\nNOISE', (True,)),
    ('$$\r\n<div>\r\nNOISE', (True,)),
    ('> $$\n> <div>\n> NOISE\nNOISE', (True, False)),
    ('> $$\r\n> <div>\r\n> NOISE\r\nNOISE', (True, False)),

])
def test_html_flow_renderer_hit_membership(source, protected_flags):
    hits = detect_occurrences("assistant", source, _rule(), _revision("NOISE"))
    assert tuple("PROTECTED_RANGE" in hit.evidence_codes for hit in hits) == protected_flags
    assert [source[hit.start:hit.end] for hit in hits] == ["NOISE"] * len(protected_flags)
    assert all(hit.match_mode == "RAW_EXACT" for hit in hits)
    assert tuple(hit.decision for hit in hits) == tuple(
        "PROTECTED" if flag else "KEEP" for flag in protected_flags
    )


@pytest.mark.parametrize(("source", "protected_flags"), [
    ('合成 🧪\n\n<widget a=b>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('合成 🧪\r\n\r\nordinary\r\n<widget a=/>\r\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\n\r\nRetain `NOISE`', (True, True, True, True, True)),
    ('合成 🧪\r\n\r\n<widget a=//>\r\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\n\r\nRetain `NOISE`', (True, True, True, True, True)),
    ("合成 🧪\n\n<widget a='/b'>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`", (True, True, True, True, True)),
    ('合成 🧪\n\nordinary\n<widget a=b c=d>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('合成 🧪\r\n\r\n<widget a= bad>\r\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\n\r\nRetain `NOISE`', (True, True, True, True, True)),
    ('合成 🧪\r\n\r\nordinary\r\n<widget _b=retained>\r\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\n\r\nRetain `NOISE`', (True, True, True, True, True)),
    ('合成 🧪\n\nordinary\n<widget a=b\\c>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('合成 🧪\n\n<widget a="unterminated>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('合成 🧪\r\n\r\nordinary\r\n<widget a="retained"/>\r\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\n\r\nRetain `NOISE`', (True, True, True, True, True)),
    ('<pre\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<pre\t>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<script/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('<style\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('<style\t>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<textarea/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<textarea-suffix>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('<div\t>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('<widget/>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('ordinary\n<widget-suffix>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('$$\n<div>\nNOISE\n$$\n\nRetain `NOISE`', (True, True)),
    ('- $$\n  <div>\n  NOISE\n   $$\n\nRetain `NOISE`', (True, True)),
    ('> $$$\n> <div>\n> NOISE\n> $$\n\nRetain `NOISE`', (True, True)),
    ('> $$$\n> <div>\n> NOISE\n>     $$\n\nRetain `NOISE`', (True, True)),
    ('$$ meta\n<div>\nNOISE\n$$$\n\nRetain `NOISE`', (True, True)),
    ('- $$ meta\n  <div>\n  NOISE\n      $$\n\nRetain `NOISE`', (True, True)),
    ('> $$NOISE$$\n> <div>\n> NOISE\n> $$$\n\nRetain `NOISE`', (True, True, True)),
    ('> $$NOISE$$\n> <div>\n> NOISE\n> $$ meta\n\nRetain `NOISE`', (True, True, True)),
    ('$\n<div>\nNOISE\n $$\n\nRetain `NOISE`', (True, True)),
    ('- $\n  <div>\n  NOISE\n  $$ meta\n\nRetain `NOISE`', (True, True)),
    ('合成 🧪\n\n<widget a=/b>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('合成 🧪\r\n\r\n<widget a=/b>\r\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\n\r\nRetain `NOISE`', (True, True, True, True, True)),
    ('合成 🧪\n\n<widget a=//>\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\n\nRetain `NOISE`', (True, True, True, True, True)),
    ('合成 🧪\r\n\r\n<widget a=//>\r\nh&#116;tps://links.test/NOISE `NOISE` [retained](/NOISE) $NOISE$\r\n\r\nRetain `NOISE`', (True, True, True, True, True)),

])
def test_html_flow_strict_attributes_and_math_renderer_membership(source, protected_flags):
    hits = detect_occurrences("assistant", source, _rule(), _revision("NOISE"))
    assert tuple("PROTECTED_RANGE" in hit.evidence_codes for hit in hits) == protected_flags
    assert tuple(hit.decision for hit in hits) == tuple(
        "PROTECTED" if flag else "KEEP" for flag in protected_flags
    )


# Frozen installed-renderer source intervals; delimiters are not automatically protected.
@pytest.mark.parametrize(("source", "expected_ranges"), [
    ('合成 🧪\n\nRetain [*h&#116;tps://links.test/NOISE*NOISE retained', [(15, 44)]),
    ('合成 🧪\n\nRetain [*h&#116;tps://links.test/NOISE**NOISE retained', [(15, 51)]),
    ('合成 🧪\n\nRetain [*h&#116;tps://links.test/NOISE***NOISE retained', [(15, 44)]),
    ('合成 🧪\n\nRetain [*h&#116;tps://links.test/NOISE****NOISE retained', [(15, 44)]),
    ('合成 🧪\n\nRetain [*h&#116;tps://links.test/NOISE*****NOISE retained', [(15, 54)]),
    ('合成 🧪\n\nRetain [*h&#116;tps://links.test/NOISE******NOISE retained', [(15, 44)]),
    ('合成 🧪\n\nRetain [**h&#116;tps://links.test/NOISE*NOISE retained', [(16, 51)]),
    ('合成 🧪\n\nRetain [**h&#116;tps://links.test/NOISE**NOISE retained', [(16, 45)]),
    ('合成 🧪\n\nRetain [**h&#116;tps://links.test/NOISE***NOISE retained', [(16, 45)]),
    ('合成 🧪\n\nRetain [**h&#116;tps://links.test/NOISE****NOISE retained', [(16, 54)]),
    ('合成 🧪\n\nRetain [**h&#116;tps://links.test/NOISE*****NOISE retained', [(16, 45)]),
    ('合成 🧪\n\nRetain [**h&#116;tps://links.test/NOISE******NOISE retained', [(16, 45)]),
    ('合成 🧪\n\nRetain [***h&#116;tps://links.test/NOISE*NOISE retained', [(17, 46)]),
    ('合成 🧪\n\nRetain [***h&#116;tps://links.test/NOISE**NOISE retained', [(17, 46)]),
    ('合成 🧪\n\nRetain [***h&#116;tps://links.test/NOISE***NOISE retained', [(17, 46)]),
    ('合成 🧪\n\nRetain [***h&#116;tps://links.test/NOISE****NOISE retained', [(17, 46)]),
    ('合成 🧪\n\nRetain [***h&#116;tps://links.test/NOISE*****NOISE retained', [(17, 46)]),
    ('合成 🧪\n\nRetain [***h&#116;tps://links.test/NOISE******NOISE retained', [(17, 46)]),
    ('合成 🧪\n\nRetain [****h&#116;tps://links.test/NOISE*NOISE retained', [(18, 47)]),
    ('合成 🧪\n\nRetain [****h&#116;tps://links.test/NOISE**NOISE retained', [(18, 54)]),
    ('合成 🧪\n\nRetain [****h&#116;tps://links.test/NOISE***NOISE retained', [(18, 47)]),
    ('合成 🧪\n\nRetain [****h&#116;tps://links.test/NOISE****NOISE retained', [(18, 47)]),
    ('合成 🧪\n\nRetain [****h&#116;tps://links.test/NOISE*****NOISE retained', [(18, 57)]),
    ('合成 🧪\n\nRetain [****h&#116;tps://links.test/NOISE******NOISE retained', [(18, 47)]),
    ('合成 🧪\n\nRetain [*****h&#116;tps://links.test/NOISE*NOISE retained', [(19, 54)]),
    ('合成 🧪\n\nRetain [*****h&#116;tps://links.test/NOISE**NOISE retained', [(19, 48)]),
    ('合成 🧪\n\nRetain [*****h&#116;tps://links.test/NOISE***NOISE retained', [(19, 48)]),
    ('合成 🧪\n\nRetain [*****h&#116;tps://links.test/NOISE****NOISE retained', [(19, 57)]),
    ('合成 🧪\n\nRetain [*****h&#116;tps://links.test/NOISE*****NOISE retained', [(19, 48)]),
    ('合成 🧪\n\nRetain [*****h&#116;tps://links.test/NOISE******NOISE retained', [(19, 48)]),
    ('合成 🧪\n\nRetain [******h&#116;tps://links.test/NOISE*NOISE retained', [(20, 49)]),
    ('合成 🧪\n\nRetain [******h&#116;tps://links.test/NOISE**NOISE retained', [(20, 49)]),
    ('合成 🧪\n\nRetain [******h&#116;tps://links.test/NOISE***NOISE retained', [(20, 49)]),
    ('合成 🧪\n\nRetain [******h&#116;tps://links.test/NOISE****NOISE retained', [(20, 49)]),
    ('合成 🧪\n\nRetain [******h&#116;tps://links.test/NOISE*****NOISE retained', [(20, 49)]),
    ('合成 🧪\n\nRetain [******h&#116;tps://links.test/NOISE******NOISE retained', [(20, 49)]),
    ('合成 🧪\n\nRetain [_h&#116;tps://links.test/NOISE_NOISE retained', [(15, 50)]),
    ('合成 🧪\n\nRetain [_h&#116;tps://links.test/NOISE__NOISE retained', [(15, 51)]),
    ('合成 🧪\n\nRetain [_h&#116;tps://links.test/NOISE___NOISE retained', [(15, 52)]),
    ('合成 🧪\n\nRetain [_h&#116;tps://links.test/NOISE____NOISE retained', [(15, 53)]),
    ('合成 🧪\n\nRetain [_h&#116;tps://links.test/NOISE_____NOISE retained', [(15, 54)]),
    ('合成 🧪\n\nRetain [_h&#116;tps://links.test/NOISE______NOISE retained', [(15, 55)]),
    ('合成 🧪\n\nRetain [__h&#116;tps://links.test/NOISE_NOISE retained', [(16, 51)]),
    ('合成 🧪\n\nRetain [__h&#116;tps://links.test/NOISE__NOISE retained', [(16, 52)]),
    ('合成 🧪\n\nRetain [__h&#116;tps://links.test/NOISE___NOISE retained', [(16, 53)]),
    ('合成 🧪\n\nRetain [__h&#116;tps://links.test/NOISE____NOISE retained', [(16, 54)]),
    ('合成 🧪\n\nRetain [__h&#116;tps://links.test/NOISE_____NOISE retained', [(16, 55)]),
    ('合成 🧪\n\nRetain [__h&#116;tps://links.test/NOISE______NOISE retained', [(16, 56)]),
    ('合成 🧪\n\nRetain [___h&#116;tps://links.test/NOISE_NOISE retained', [(17, 52)]),
    ('合成 🧪\n\nRetain [___h&#116;tps://links.test/NOISE__NOISE retained', [(17, 53)]),
    ('合成 🧪\n\nRetain [___h&#116;tps://links.test/NOISE___NOISE retained', [(17, 54)]),
    ('合成 🧪\n\nRetain [___h&#116;tps://links.test/NOISE____NOISE retained', [(17, 55)]),
    ('合成 🧪\n\nRetain [___h&#116;tps://links.test/NOISE_____NOISE retained', [(17, 56)]),
    ('合成 🧪\n\nRetain [___h&#116;tps://links.test/NOISE______NOISE retained', [(17, 57)]),
    ('合成 🧪\n\nRetain [____h&#116;tps://links.test/NOISE_NOISE retained', [(18, 53)]),
    ('合成 🧪\n\nRetain [____h&#116;tps://links.test/NOISE__NOISE retained', [(18, 54)]),
    ('合成 🧪\n\nRetain [____h&#116;tps://links.test/NOISE___NOISE retained', [(18, 55)]),
    ('合成 🧪\n\nRetain [____h&#116;tps://links.test/NOISE____NOISE retained', [(18, 56)]),
    ('合成 🧪\n\nRetain [____h&#116;tps://links.test/NOISE_____NOISE retained', [(18, 57)]),
    ('合成 🧪\n\nRetain [____h&#116;tps://links.test/NOISE______NOISE retained', [(18, 58)]),
    ('合成 🧪\n\nRetain [_____h&#116;tps://links.test/NOISE_NOISE retained', [(19, 54)]),
    ('合成 🧪\n\nRetain [_____h&#116;tps://links.test/NOISE__NOISE retained', [(19, 55)]),
    ('合成 🧪\n\nRetain [_____h&#116;tps://links.test/NOISE___NOISE retained', [(19, 56)]),
    ('合成 🧪\n\nRetain [_____h&#116;tps://links.test/NOISE____NOISE retained', [(19, 57)]),
    ('合成 🧪\n\nRetain [_____h&#116;tps://links.test/NOISE_____NOISE retained', [(19, 58)]),
    ('合成 🧪\n\nRetain [_____h&#116;tps://links.test/NOISE______NOISE retained', [(19, 59)]),
    ('合成 🧪\n\nRetain [______h&#116;tps://links.test/NOISE_NOISE retained', [(20, 55)]),
    ('合成 🧪\n\nRetain [______h&#116;tps://links.test/NOISE__NOISE retained', [(20, 56)]),
    ('合成 🧪\n\nRetain [______h&#116;tps://links.test/NOISE___NOISE retained', [(20, 57)]),
    ('合成 🧪\n\nRetain [______h&#116;tps://links.test/NOISE____NOISE retained', [(20, 58)]),
    ('合成 🧪\n\nRetain [______h&#116;tps://links.test/NOISE_____NOISE retained', [(20, 59)]),
    ('合成 🧪\n\nRetain [______h&#116;tps://links.test/NOISE______NOISE retained', [(20, 60)]),
    ('Retain [*https://links.test/NOISE* retained', [(9, 33)]),
    ('Retain [ *h&#116;tps://links.test/NOISE*a retained', [(10, 39)]),
    ('Retain [a*h&#116;tps://links.test/NOISE*🧪 retained', [(10, 39)]),
    ('Retain [0*h&#116;tps://links.test/NOISE*) retained', [(10, 39)]),
    ('Retain [中*h&#116;tps://links.test/NOISE*~ retained', [(10, 39)]),
    ('Retain [🧪*https://links.test/NOISE*\u202f retained', [(10, 34)]),
    ('Retain [!*https://links.test/NOISE*\x1c retained', [(10, 34)]),
    ('Retain [)*https://links.test/NOISE*a retained', [(10, 34)]),
    ('Retain [**https://links.test/NOISE*🧪 retained', [(10, 36)]),
    ('Retain [_*h&#116;tps://links.test/NOISE*（ retained', [(10, 39)]),
    ('Retain [~*h&#116;tps://links.test/NOISE*_ retained', [(10, 39)]),
    ('Retain [\t*h&#116;tps://links.test/NOISE*\xa0 retained', [(10, 39)]),
    ('Retain [\xa0*h&#116;tps://links.test/NOISE*\ufeff retained', [(10, 39)]),
    ('Retain [\u2028*h&#116;tps://links.test/NOISE*  retained', [(10, 39)]),
    ('Retain [\ufeff*https://links.test/NOISE*中 retained', [(10, 34)]),
    ('Retain [\x1c*https://links.test/NOISE*（ retained', [(10, 34)]),
    ('Retain [_https://links.test/NOISE__ retained', [(9, 33)]),
    ('Retain [ _https://links.test/NOISE_\xa0 retained', [(10, 34)]),
    ('Retain [a_h&#116;tps://links.test/NOISE_\u2028 retained', [(10, 41)]),
    ('Retain [中_h&#116;tps://links.test/NOISE_ retained', [(10, 40)]),
    ('Retain [🧪_h&#116;tps://links.test/NOISE_0 retained', [(10, 41)]),
    ('Retain [!_h&#116;tps://links.test/NOISE_! retained', [(10, 39)]),
    ('Retain [（_h&#116;tps://links.test/NOISE_* retained', [(10, 39)]),
    ('Retain [)_https://links.test/NOISE_\t retained', [(10, 34)]),
    ('Retain [*_https://links.test/NOISE_\u2028 retained', [(10, 34)]),
    ('Retain [~_https://links.test/NOISE_ retained', [(10, 34)]),
    ('Retain [\t_https://links.test/NOISE_0 retained', [(10, 36)]),
    ('Retain [\xa0_h&#116;tps://links.test/NOISE_🧪 retained', [(10, 41)]),
    ('Retain [\u202f_h&#116;tps://links.test/NOISE_) retained', [(10, 39)]),
    ('Retain [\u2028_h&#116;tps://links.test/NOISE_~ retained', [(10, 39)]),
    ('Retain [\ufeff_h&#116;tps://links.test/NOISE_\u202f retained', [(10, 39)]),
    ('Retain [\x1c_h&#116;tps://links.test/NOISE_\x1c retained', [(10, 41)]),
    ('Retain [*https://links.test/NOISE*NOISE retained', [(9, 33)]),
    ('Retain [*https://links.test/NOISE *retained*\n*NOISE retained', [(9, 33)]),
    ('Retain [*https://links.test/*NOISE*tail*NOISE retained', [(9, 28)]),
    ('Retain [*h&#116;tps://links.test/NOISE\n*NOISE retained', [(9, 38)]),
    ('Retain [*h&#116;tps://links.test/**NOISE***NOISE retained', [(9, 33)]),
    ('Retain [*h&#116;tps://links.test/*NOISE*tail\r\n*NOISE retained', [(9, 33)]),
    ('Retain [*https&colon;&sol;&sol;links.test/NOISE*tail*NOISE retained', [(9, 47)]),
    ('Retain [*https&colon;&sol;&sol;links.test/**NOISE**\n*NOISE retained', [(9, 42)]),
    ('Retain [*https&colon;&sol;&sol;links.test/NOISE *retained**NOISE retained', [(9, 47)]),
    ('Retain [_https://links.test/NOISE_tail\n_NOISE retained', [(9, 38)]),
    ('Retain [_https://links.test/NOISE_NOISE retained', [(9, 39)]),
    ('Retain [_https://links.test/NOISE _retained_\r\n_NOISE retained', [(9, 33)]),
    ('Retain [_h&#116;tps://links.test/_NOISE_tail_NOISE retained', [(9, 50)]),
    ('Retain [_h&#116;tps://links.test/NOISE\r\n_NOISE retained', [(9, 38)]),
    ('Retain [_h&#116;tps://links.test/__NOISE___NOISE retained', [(9, 48)]),
    ('Retain [_https&colon;&sol;&sol;links.test/_NOISE_tail\n_NOISE retained', [(9, 53)]),
    ('Retain [_https&colon;&sol;&sol;links.test/NOISE_tail_NOISE retained', [(9, 58)]),
    ('Retain [_https&colon;&sol;&sol;links.test/__NOISE__\r\n\r\n_NOISE retained', [(9, 42)]),
    ('Retain [\\*https://links.test/NOISE*NOISE retained', [(10, 40)]),
    ('Retain [\\*h&#116;tps://links.test/NOISE__NOISE retained', [(10, 46)]),
    ('Retain [\\_https://links.test/NOISE_NOISE retained', [(10, 40)]),
    ('Retain [\\_h&#116;tps://links.test/NOISE***NOISE retained', [(10, 47)]),
    ('Retain [\\\\*https://links.test/NOISE**NOISE retained', [(11, 42)]),
    ('Retain [\\\\*h&#116;tps://links.test/NOISE___NOISE retained', [(11, 48)]),
    ('Retain [\\\\_https://links.test/NOISE__NOISE retained', [(11, 42)]),
    ('Retain [&ast;h&#116;tps://links.test/NOISE*NOISE retained', [(13, 48)]),
    ('Retain [&ast;https://links.test/NOISE***NOISE retained', [(13, 45)]),
    ('Retain [&#42;h&#116;tps://links.test/NOISE_NOISE retained', [(13, 48)]),
    ('Retain [&#42;https://links.test/NOISE___NOISE retained', [(13, 45)]),
    ('Retain [&lowbar;h&#116;tps://links.test/NOISE**NOISE retained', [(16, 52)]),
    ('Retain [&#95;https://links.test/NOISE*NOISE retained', [(13, 43)]),
    ('Retain [&#95;h&#116;tps://links.test/NOISE__NOISE retained', [(13, 49)]),
    ('Retain [\\***https://links.test/NOISE_NOISE retained', [(12, 42)]),
    ('Retain [\\***h&#116;tps://links.test/NOISE***NOISE retained', [(12, 41)]),
    ('Retain [\\___https://links.test/NOISE**NOISE retained', [(12, 43)]),
    ('Retain [\\___https&colon;&sol;&sol;links.test/NOISE___NOISE retained', [(12, 58)]),
    ('Retain [*`*retained*` https://links.test/NOISE*NOISE retained', [(9, 21), (22, 46)]),
    ('Retain [*<!--*retained*--> https://links.test/NOISE*NOISE retained', [(27, 51)]),
    ('Retain [*<https://links.test/*retained> https://links.test/NOISE*NOISE retained', [(9, 39), (40, 64)]),
    ('Retain [*h&#116;tps://links.test/NOISE <em x="*">retained</em>*NOISE retained', [(9, 38)]),
    ('Retain [*h&#116;tps://links.test/NOISE ![retained*](/retained)*NOISE retained', [(9, 38), (50, 62)]),
    ('Retain [*https&colon;&sol;&sol;links.test/NOISE $*retained*$*NOISE retained', [(9, 47), (48, 60)]),
    ('Retain [*![retained*](/retained) https&colon;&sol;&sol;links.test/NOISE*NOISE retained', [(20, 32), (33, 71)]),
    ('Retain [_$*retained*$ https://links.test/NOISE_NOISE retained', [(9, 21), (22, 52)]),
    ('Retain [_https://links.test/NOISE [retained*](/retained)_NOISE retained', [(9, 33), (44, 56)]),
    ('Retain [_h&#116;tps://links.test/NOISE `*retained*`_NOISE retained', [(9, 38), (39, 51)]),
    ('Retain [_h&#116;tps://links.test/NOISE <!--*retained*-->_NOISE retained', [(9, 38)]),
    ('Retain [_`*retained*` https&colon;&sol;&sol;links.test/NOISE_NOISE retained', [(9, 21), (22, 66)]),
    ('Retain [_<!--*retained*--> https&colon;&sol;&sol;links.test/NOISE_NOISE retained', [(27, 71)]),
    ('Retain [_https&colon;&sol;&sol;links.test/NOISE <https://links.test/*retained>_NOISE retained', [(9, 47), (48, 78)]),
    ('> Retain [*https://links.test/NOISE\n> retained*NOISE', [(11, 35)]),
    ('> Retain [*https://links.test/NOISE\r\n> retained*NOISE', [(11, 35)]),
    ('> Retain [*h&#116;tps://links.test/NOISE\n> retained*NOISE', [(11, 40)]),
    ('> Retain [*h&#116;tps://links.test/NOISE\r\n> retained*NOISE', [(11, 40)]),
    ('> Retain [*https&colon;&sol;&sol;links.test/NOISE\n> retained*NOISE', [(11, 49)]),
    ('> Retain [*https&colon;&sol;&sol;links.test/NOISE\r\n> retained*NOISE', [(11, 49)]),
    ('- Retain [_https://links.test/NOISE\n  retained_NOISE', [(11, 35)]),
    ('- Retain [_https://links.test/NOISE\r\n  retained_NOISE', [(11, 35)]),
    ('- Retain [_h&#116;tps://links.test/NOISE\n  retained_NOISE', [(11, 40)]),
    ('- Retain [_h&#116;tps://links.test/NOISE\r\n  retained_NOISE', [(11, 40)]),
    ('- Retain [_https&colon;&sol;&sol;links.test/NOISE\n  retained_NOISE', [(11, 49)]),
    ('> - Retain [_https&colon;&sol;&sol;links.test/NOISE\r\n>   retained_NOISE', [(13, 51)]),
    ('Retain *https://links.test/NOISE* retained', [(8, 32)]),
    ('Retain *https://links.test/NOISE*****!NOISE retained', [(8, 43)]),
    ('Retain **h&#116;tps://links.test/NOISE***NOISE retained', [(9, 38)]),
    ('Retain ***https&colon;&sol;&sol;links.test/NOISE* retained', [(10, 48)]),
    ('Retain ***https&colon;&sol;&sol;links.test/NOISE*****!NOISE retained', [(10, 48)]),
    ('Retain ****https://links.test/NOISE****NOISE retained', [(11, 44)]),
    ('Retain *****h&#116;tps://links.test/NOISE** retained', [(12, 41)]),
    ('Retain *****h&#116;tps://links.test/NOISE******!NOISE retained', [(12, 41)]),
    ('Retain ******https&colon;&sol;&sol;links.test/NOISE****NOISE retained', [(13, 51)]),
    ('Retain _https://links.test/NOISE___ retained', [(8, 32)]),
    ('Retain __https://links.test/NOISE_!NOISE retained', [(9, 40)]),
    ('Retain __h&#116;tps://links.test/NOISE_____NOISE retained', [(9, 48)]),
    ('Retain ___https&colon;&sol;&sol;links.test/NOISE___ retained', [(10, 48)]),
    ('Retain ____https&colon;&sol;&sol;links.test/NOISE_!NOISE retained', [(11, 49)]),
    ('Retain ____https://links.test/NOISE______NOISE retained', [(11, 46)]),
    ('Retain _____h&#116;tps://links.test/NOISE____ retained', [(12, 41)]),
    ('Retain ______h&#116;tps://links.test/NOISE__!NOISE retained', [(13, 42)]),
    ('Retain ______https&colon;&sol;&sol;links.test/NOISE______!NOISE retained', [(13, 51)]),
    ('Retain [*retained _https://links.test/NOISE_NOISE* retained', [(19, 49)]),
    ('Retain [a*https&colon;&sol;&sol;links.test/NOISE*_NOISE_ retained', [(10, 48)]),
    ('Retain [__retained *https&colon;&sol;&sol;links.test/NOISE__NOISE* retained', [(20, 65)]),
    ('Retain [*retained ___https&colon;&sol;&sol;links.test/NOISE*NOISE___ retained', [(21, 59)]),
    ('Retain [*____h&#116;tps://links.test/NOISE*NOISE retained', [(13, 42)]),
    ('Retain [a**h&#116;tps://links.test/NOISE**_NOISE_ retained', [(11, 40)]),
    ('Retain [__retained **h&#116;tps://links.test/NOISE__NOISE** retained', [(21, 57)]),
    ('Retain [**retained ___h&#116;tps://links.test/NOISE___NOISE** retained', [(22, 59)]),
    ('Retain [**____https://links.test/NOISE**NOISE retained', [(14, 38)]),
    ('Retain [a***https://links.test/NOISE***_NOISE_ retained', [(12, 36)]),
    ('Retain [***retained __https://links.test/NOISE***NOISE__ retained', [(22, 46)]),
    ('Retain [***retained ___https://links.test/NOISE___NOISE*** retained', [(23, 55)]),
    ('Retain [***___https&colon;&sol;&sol;links.test/NOISE***NOISE retained', [(14, 52)]),
    ('Retain [____retained ***https&colon;&sol;&sol;links.test/NOISE____NOISE*** retained', [(24, 71)]),
    ('Retain [****retained _https&colon;&sol;&sol;links.test/NOISE****NOISE_ retained', [(22, 60)]),
    ('Retain [****retained __https&colon;&sol;&sol;links.test/NOISE__NOISE**** retained', [(23, 68)]),
    ('Retain [a****h&#116;tps://links.test/NOISE****___NOISE___ retained', [(13, 42)]),
    ('Retain [____retained ****h&#116;tps://links.test/NOISE____NOISE**** retained', [(25, 63)]),
    ('Retain [_retained *h&#116;tps://links.test/NOISE_NOISE* retained', [(19, 54)]),
    ('Retain [_retained **h&#116;tps://links.test/NOISE**NOISE_ retained', [(20, 49)]),
    ('Retain [a_https://links.test/NOISE_***NOISE*** retained', [(10, 35)]),
    ('Retain [****retained _https://links.test/NOISE****NOISE_ retained', [(22, 46)]),
    ('Retain [__retained *https://links.test/NOISE__NOISE* retained', [(20, 51)]),
    ('Retain [__*https&colon;&sol;&sol;links.test/NOISE__NOISE retained', [(11, 56)]),
    ('Retain [a__https&colon;&sol;&sol;links.test/NOISE__**NOISE** retained', [(11, 51)]),
    ('Retain [***retained __https&colon;&sol;&sol;links.test/NOISE***NOISE__ retained', [(22, 60)]),
    ('Retain [__retained ****https&colon;&sol;&sol;links.test/NOISE****NOISE__ retained', [(23, 61)]),
    ('Retain [___*h&#116;tps://links.test/NOISE___NOISE retained', [(12, 49)]),
    ('Retain [a___h&#116;tps://links.test/NOISE___**NOISE** retained', [(12, 44)]),
    ('Retain [___retained ***h&#116;tps://links.test/NOISE___NOISE*** retained', [(23, 60)]),
    ('Retain [___retained ****h&#116;tps://links.test/NOISE****NOISE___ retained', [(24, 53)]),
    ('Retain [____*https://links.test/NOISE____NOISE retained', [(13, 46)]),
    ('Retain [**retained ____https://links.test/NOISE**NOISE____ retained', [(23, 47)]),
    ('Retain [____retained ***https://links.test/NOISE____NOISE*** retained', [(24, 57)]),
    ('Retain [____retained ****https://links.test/NOISE****NOISE____ retained', [(25, 49)]),
    ('Retain [____****https&colon;&sol;&sol;links.test/NOISE____NOISE retained', [(16, 63)]),
])
def test_emphasis_text_nodes_bound_protocol_protection(source, expected_ranges):
    assert protected_ranges(source) == expected_ranges


# Frozen installed-renderer intervals, including mixed resolver registration order.
@pytest.mark.parametrize(("source", "expected_ranges"), [
    ('合成 🧪\n\nRetain [~h&#116;tps://links.test/NOISE~NOISE retained', [(15, 44)]),
    ('合成 🧪\n\nRetain [~h&#116;tps://links.test/NOISE~~NOISE retained', [(15, 51)]),
    ('合成 🧪\n\nRetain [~h&#116;tps://links.test/NOISE~~~NOISE retained', [(15, 52)]),
    ('合成 🧪\n\nRetain [~h&#116;tps://links.test/NOISE~~~~NOISE retained', [(15, 53)]),
    ('合成 🧪\n\nRetain [~h&#116;tps://links.test/NOISE~~~~~NOISE retained', [(15, 54)]),
    ('合成 🧪\n\nRetain [~~h&#116;tps://links.test/NOISE~NOISE retained', [(16, 51)]),
    ('合成 🧪\n\nRetain [~~h&#116;tps://links.test/NOISE~~NOISE retained', [(16, 45)]),
    ('合成 🧪\n\nRetain [~~h&#116;tps://links.test/NOISE~~~NOISE retained', [(16, 53)]),
    ('合成 🧪\n\nRetain [~~h&#116;tps://links.test/NOISE~~~~NOISE retained', [(16, 54)]),
    ('合成 🧪\n\nRetain [~~h&#116;tps://links.test/NOISE~~~~~NOISE retained', [(16, 55)]),
    ('合成 🧪\n\nRetain [~~~h&#116;tps://links.test/NOISE~NOISE retained', [(17, 52)]),
    ('合成 🧪\n\nRetain [~~~h&#116;tps://links.test/NOISE~~NOISE retained', [(17, 53)]),
    ('合成 🧪\n\nRetain [~~~h&#116;tps://links.test/NOISE~~~NOISE retained', [(17, 54)]),
    ('合成 🧪\n\nRetain [~~~h&#116;tps://links.test/NOISE~~~~NOISE retained', [(17, 55)]),
    ('合成 🧪\n\nRetain [~~~h&#116;tps://links.test/NOISE~~~~~NOISE retained', [(17, 56)]),
    ('合成 🧪\n\nRetain [~~~~h&#116;tps://links.test/NOISE~NOISE retained', [(18, 53)]),
    ('合成 🧪\n\nRetain [~~~~h&#116;tps://links.test/NOISE~~NOISE retained', [(18, 54)]),
    ('合成 🧪\n\nRetain [~~~~h&#116;tps://links.test/NOISE~~~NOISE retained', [(18, 55)]),
    ('合成 🧪\n\nRetain [~~~~h&#116;tps://links.test/NOISE~~~~NOISE retained', [(18, 56)]),
    ('合成 🧪\n\nRetain [~~~~h&#116;tps://links.test/NOISE~~~~~NOISE retained', [(18, 57)]),
    ('合成 🧪\n\nRetain [~~~~~h&#116;tps://links.test/NOISE~NOISE retained', [(19, 54)]),
    ('合成 🧪\n\nRetain [~~~~~h&#116;tps://links.test/NOISE~~NOISE retained', [(19, 55)]),
    ('合成 🧪\n\nRetain [~~~~~h&#116;tps://links.test/NOISE~~~NOISE retained', [(19, 56)]),
    ('合成 🧪\n\nRetain [~~~~~h&#116;tps://links.test/NOISE~~~~NOISE retained', [(19, 57)]),
    ('合成 🧪\n\nRetain [~~~~~h&#116;tps://links.test/NOISE~~~~~NOISE retained', [(19, 58)]),
    ('Retain [~https://links.test/NOISE~ retained', [(9, 33)]),
    ('Retain [~~https://links.test/NOISE~~_ retained', [(10, 34)]),
    ('Retain [ ~~h&#116;tps://links.test/NOISE~~a retained', [(11, 40)]),
    ('Retain [ ~~https://links.test/NOISE~~\xa0 retained', [(11, 35)]),
    ('Retain [a~~h&#116;tps://links.test/NOISE~~🧪 retained', [(11, 40)]),
    ('Retain [a~https://links.test/NOISE~\ufeff retained', [(10, 34)]),
    ('Retain [0~h&#116;tps://links.test/NOISE~) retained', [(10, 39)]),
    ('Retain [中~https://links.test/NOISE~  retained', [(10, 34)]),
    ('Retain [中~h&#116;tps://links.test/NOISE~~ retained', [(10, 41)]),
    ('Retain [🧪~~h&#116;tps://links.test/NOISE~~0 retained', [(11, 40)]),
    ('Retain [🧪~~https://links.test/NOISE~~\u202f retained', [(11, 35)]),
    ('Retain [!~~h&#116;tps://links.test/NOISE~~! retained', [(11, 40)]),
    ('Retain [!~~https://links.test/NOISE~~\x1c retained', [(11, 35)]),
    ('Retain [（~~h&#116;tps://links.test/NOISE~~* retained', [(11, 40)]),
    ('Retain [)~https://links.test/NOISE~a retained', [(10, 34)]),
    ('Retain [)~h&#116;tps://links.test/NOISE~\t retained', [(10, 39)]),
    ('Retain [*~https://links.test/NOISE~🧪 retained', [(10, 34)]),
    ('Retain [*~h&#116;tps://links.test/NOISE~\u2028 retained', [(10, 39)]),
    ('Retain [_~~h&#116;tps://links.test/NOISE~~（ retained', [(11, 40)]),
    ('Retain [~~~https://links.test/NOISE~~ retained', [(11, 37)]),
    ('Retain [~~~h&#116;tps://links.test/NOISE~~_ retained', [(11, 43)]),
    ('Retain [\t~~https://links.test/NOISE~~0 retained', [(11, 35)]),
    ('Retain [\t~~h&#116;tps://links.test/NOISE~~\xa0 retained', [(11, 40)]),
    ('Retain [\xa0~https://links.test/NOISE~! retained', [(10, 34)]),
    ('Retain [\xa0~h&#116;tps://links.test/NOISE~\ufeff retained', [(10, 39)]),
    ('Retain [\u202f~https://links.test/NOISE~* retained', [(10, 34)]),
    ('Retain [\u2028~h&#116;tps://links.test/NOISE~  retained', [(10, 39)]),
    ('Retain [\u2028~~h&#116;tps://links.test/NOISE~~~ retained', [(11, 43)]),
    ('Retain [\ufeff~~https://links.test/NOISE~~中 retained', [(11, 35)]),
    ('Retain [\ufeff~~h&#116;tps://links.test/NOISE~~\u202f retained', [(11, 40)]),
    ('Retain [\x1c~~https://links.test/NOISE~~（ retained', [(11, 35)]),
    ('Retain [\x1c~~h&#116;tps://links.test/NOISE~~\x1c retained', [(11, 40)]),
    ('Retain [*retained ~https://links.test/NOISE~NOISE* retained', [(19, 43)]),
    ('Retain [*~retained https://links.test/NOISE*NOISE~ retained', [(19, 43)]),
    ('Retain [*~h&#116;tps://links.test/NOISE*NOISE retained', [(10, 39)]),
    ('Retain [~retained *https&colon;&sol;&sol;links.test/NOISE~NOISE* retained', [(19, 57)]),
    ('Retain [*retained ~~https://links.test/NOISE~~NOISE* retained', [(20, 44)]),
    ('Retain [*~~retained https://links.test/NOISE*NOISE~~ retained', [(20, 44)]),
    ('Retain [*~~h&#116;tps://links.test/NOISE*NOISE retained', [(11, 40)]),
    ('Retain [~~retained *https&colon;&sol;&sol;links.test/NOISE~~NOISE* retained', [(20, 58)]),
    ('Retain [**retained ~https://links.test/NOISE~NOISE** retained', [(20, 44)]),
    ('Retain [**~retained https://links.test/NOISE**NOISE~ retained', [(20, 44)]),
    ('Retain [**~h&#116;tps://links.test/NOISE**NOISE retained', [(11, 40)]),
    ('Retain [~retained **https&colon;&sol;&sol;links.test/NOISE~NOISE** retained', [(20, 58)]),
    ('Retain [**retained ~~https://links.test/NOISE~~NOISE** retained', [(21, 45)]),
    ('Retain [** retained ~~https://links.test/NOISE~~NOISE retained', [(22, 46)]),
    ('Retain [~~retained **h&#116;tps://links.test/NOISE**NOISE~~ retained', [(21, 50)]),
    ('Retain [a**https&colon;&sol;&sol;links.test/NOISE**~~NOISE~~ retained', [(11, 49)]),
    ('Retain [***retained ~https://links.test/NOISE***NOISE~ retained', [(21, 45)]),
    ('Retain [*** retained ~https://links.test/NOISE~NOISE retained', [(22, 46)]),
    ('Retain [~retained ***h&#116;tps://links.test/NOISE***NOISE~ retained', [(21, 50)]),
    ('Retain [a***https&colon;&sol;&sol;links.test/NOISE***~NOISE~ retained', [(12, 50)]),
    ('Retain [***retained ~~https://links.test/NOISE***NOISE~~ retained', [(22, 46)]),
    ('Retain [*** retained ~~https://links.test/NOISE~~NOISE retained', [(23, 47)]),
    ('Retain [~~retained ***h&#116;tps://links.test/NOISE***NOISE~~ retained', [(22, 51)]),
    ('Retain [a***https&colon;&sol;&sol;links.test/NOISE***~~NOISE~~ retained', [(12, 50)]),
    ('Retain [****retained ~https://links.test/NOISE****NOISE~ retained', [(22, 46)]),
    ('Retain [**** retained ~https://links.test/NOISE~NOISE retained', [(23, 47)]),
    ('Retain [****~retained h&#116;tps://links.test/NOISE****NOISE~ retained', [(22, 51)]),
    ('Retain [****~https&colon;&sol;&sol;links.test/NOISE****NOISE retained', [(13, 51)]),
    ('Retain [~~retained ****https://links.test/NOISE~~NOISE**** retained', [(23, 47)]),
    ('Retain [****retained ~~h&#116;tps://links.test/NOISE~~NOISE**** retained', [(23, 52)]),
    ('Retain [****~~retained h&#116;tps://links.test/NOISE****NOISE~~ retained', [(23, 52)]),
    ('Retain [****~~https&colon;&sol;&sol;links.test/NOISE****NOISE retained', [(14, 52)]),
    ('Retain [~retained _https://links.test/NOISE~NOISE_ retained', [(19, 43)]),
    ('Retain [_retained ~h&#116;tps://links.test/NOISE~NOISE_ retained', [(19, 48)]),
    ('Retain [_~retained h&#116;tps://links.test/NOISE_NOISE~ retained', [(19, 54)]),
    ('Retain [_~https&colon;&sol;&sol;links.test/NOISE_NOISE retained', [(10, 54)]),
    ('Retain [~~retained _https://links.test/NOISE~~NOISE_ retained', [(20, 44)]),
    ('Retain [_retained ~~h&#116;tps://links.test/NOISE~~NOISE_ retained', [(20, 49)]),
    ('Retain [_ retained ~~h&#116;tps://links.test/NOISE~~NOISE retained', [(21, 50)]),
    ('Retain [~~retained _https&colon;&sol;&sol;links.test/NOISE_NOISE~~ retained', [(20, 64)]),
    ('Retain [a__https://links.test/NOISE__~NOISE~ retained', [(11, 37)]),
    ('Retain [__retained ~h&#116;tps://links.test/NOISE__NOISE~ retained', [(20, 56)]),
    ('Retain [__ retained ~h&#116;tps://links.test/NOISE~NOISE retained', [(21, 50)]),
    ('Retain [~retained __https&colon;&sol;&sol;links.test/NOISE__NOISE~ retained', [(20, 65)]),
    ('Retain [a__https://links.test/NOISE__~~NOISE~~ retained', [(11, 37)]),
    ('Retain [__retained ~~h&#116;tps://links.test/NOISE__NOISE~~ retained', [(21, 57)]),
    ('Retain [__ retained ~~h&#116;tps://links.test/NOISE~~NOISE retained', [(22, 51)]),
    ('Retain [~~retained __https&colon;&sol;&sol;links.test/NOISE__NOISE~~ retained', [(21, 66)]),
    ('Retain [a___https://links.test/NOISE___~NOISE~ retained', [(12, 39)]),
    ('Retain [___retained ~h&#116;tps://links.test/NOISE___NOISE~ retained', [(21, 58)]),
    ('Retain [___ retained ~h&#116;tps://links.test/NOISE~NOISE retained', [(22, 51)]),
    ('Retain [___~retained https&colon;&sol;&sol;links.test/NOISE___NOISE~ retained', [(21, 67)]),
    ('Retain [___~~https://links.test/NOISE___NOISE retained', [(13, 45)]),
    ('Retain [~~retained ___h&#116;tps://links.test/NOISE~~NOISE___ retained', [(22, 51)]),
    ('Retain [___retained ~~https&colon;&sol;&sol;links.test/NOISE~~NOISE___ retained', [(22, 60)]),
    ('Retain [___~~retained https&colon;&sol;&sol;links.test/NOISE___NOISE~~ retained', [(22, 68)]),
    ('Retain [____~https://links.test/NOISE____NOISE retained', [(13, 46)]),
    ('Retain [~retained ____h&#116;tps://links.test/NOISE~NOISE____ retained', [(22, 51)]),
    ('Retain [____retained ~https&colon;&sol;&sol;links.test/NOISE~NOISE____ retained', [(22, 60)]),
    ('Retain [____~retained https&colon;&sol;&sol;links.test/NOISE____NOISE~ retained', [(22, 69)]),
    ('Retain [____~~https://links.test/NOISE____NOISE retained', [(14, 47)]),
    ('Retain [~~retained ____h&#116;tps://links.test/NOISE~~NOISE____ retained', [(23, 52)]),
    ('Retain [____retained ~~https&colon;&sol;&sol;links.test/NOISE~~NOISE____ retained', [(23, 61)]),
    ('Retain [____ retained ~~https&colon;&sol;&sol;links.test/NOISE~~NOISE retained', [(24, 62)]),
    ('Retain [~https://links.test/NOISE~NOISE retained', [(9, 33)]),
    ('Retain [~https://links.test/NOISE~~~NOISE retained', [(9, 41)]),
    ('Retain [~~https://links.test/NOISE~NOISE retained', [(10, 40)]),
    ('Retain [~~https://links.test/NOISE~~~NOISE retained', [(10, 42)]),
    ('Retain [~~~h&#116;tps://links.test/NOISE~NOISE retained', [(11, 46)]),
    ('Retain [~~~h&#116;tps://links.test/NOISE~~~NOISE retained', [(11, 48)]),
    ('Retain [~~~~h&#116;tps://links.test/NOISE~NOISE retained', [(12, 47)]),
    ('Retain [~~~~https&colon;&sol;&sol;links.test/NOISE~~~NOISE retained', [(12, 58)]),
    ('Retain [\\~https&colon;&sol;&sol;links.test/NOISE~NOISE retained', [(10, 54)]),
    ('Retain [\\~https&colon;&sol;&sol;links.test/NOISE~~~NOISE retained', [(10, 56)]),
    ('Retain [\\~~https&colon;&sol;&sol;links.test/NOISE~NOISE retained', [(11, 49)]),
    ('Retain [\\~~https://links.test/NOISE~~~~NOISE retained', [(11, 44)]),
    ('Retain [&tilde;https://links.test/NOISE~~NOISE retained', [(15, 46)]),
    ('Retain [&tilde;https://links.test/NOISE~~~~NOISE retained', [(15, 48)]),
    ('Retain [&#126;h&#116;tps://links.test/NOISE~~NOISE retained', [(14, 50)]),
    ('Retain [&#126;h&#116;tps://links.test/NOISE~~~~NOISE retained', [(14, 52)]),
    ('Retain [&sim;h&#116;tps://links.test/NOISE~~NOISE retained', [(13, 49)]),
    ('Retain [&sim;https&colon;&sol;&sol;links.test/NOISE~~~~NOISE retained', [(13, 60)]),
    ('Retain [~`~retained~` https://links.test/NOISE~NOISE retained', [(9, 21), (22, 46)]),
    ('Retain [~<!--~retained~--> https://links.test/NOISE~NOISE retained', [(27, 51)]),
    ('Retain [~<https://links.test/~retained> https://links.test/NOISE~NOISE retained', [(9, 39), (40, 64)]),
    ('Retain [~h&#116;tps://links.test/NOISE <em x="~">retained</em>~NOISE retained', [(9, 38)]),
    ('Retain [~h&#116;tps://links.test/NOISE ![retained~](/retained)~NOISE retained', [(9, 38), (50, 62)]),
    ('Retain [~https&colon;&sol;&sol;links.test/NOISE $~retained~$~NOISE retained', [(9, 47), (48, 60)]),
    ('Retain [~![retained~](/retained) https&colon;&sol;&sol;links.test/NOISE~NOISE retained', [(20, 32), (33, 71)]),
    ('Retain [~~$~retained~$ https://links.test/NOISE~~NOISE retained', [(10, 22), (23, 47)]),
    ('Retain [~~https://links.test/NOISE [retained~](/retained)~~NOISE retained', [(10, 34), (45, 57)]),
    ('Retain [~~h&#116;tps://links.test/NOISE `~retained~`~~NOISE retained', [(10, 39), (40, 52)]),
    ('Retain [~~h&#116;tps://links.test/NOISE <!--~retained~-->~~NOISE retained', [(10, 39)]),
    ('Retain [~~`~retained~` https&colon;&sol;&sol;links.test/NOISE~~NOISE retained', [(10, 22), (23, 61)]),
    ('Retain [~~<!--~retained~--> https&colon;&sol;&sol;links.test/NOISE~~NOISE retained', [(28, 66)]),
    ('Retain [~~https&colon;&sol;&sol;links.test/NOISE <https://links.test/~retained>~~NOISE retained', [(10, 48), (49, 79)]),
    ('Retain [~https://links.test/NOISEretained~NOISE', [(9, 41)]),
    ('Retain [~h&#116;tps://links.test/NOISEretained~NOISE', [(9, 46)]),
    ('> Retain [~h&#116;tps://links.test/NOISEretained~NOISE', [(11, 48)]),
    ('> Retain [~https&colon;&sol;&sol;links.test/NOISEretained~NOISE', [(11, 57)]),
    ('- Retain [~https&colon;&sol;&sol;links.test/NOISEretained~NOISE', [(11, 57)]),
    ('- Retain [~~https://links.test/NOISEretained~~NOISE', [(12, 44)]),
    ('Retain [~~https://links.test/NOISE\r\nretained~~NOISE', [(10, 34)]),
    ('Retain [~~h&#116;tps://links.test/NOISE\nretained~~NOISE', [(10, 39)]),
    ('> Retain [~~h&#116;tps://links.test/NOISE\r\n> retained~~NOISE', [(12, 41)]),
    ('> Retain [~~https&colon;&sol;&sol;links.test/NOISE\n> retained~~NOISE', [(12, 50)]),
    ('- Retain [~~https&colon;&sol;&sol;links.test/NOISE\r\n  retained~~NOISE', [(12, 50)]),
    ('- Retain [~~~https://links.test/NOISE\n  retained~~~NOISE', [(13, 37)]),
    ('Retain [~~~https://links.test/NOISE\r\n\r\nretained~~~NOISE', [(11, 35)]),
    ('Retain [~~~h&#116;tps://links.test/NOISE\n\nretained~~~NOISE', [(11, 40)]),
    ('> Retain [~~~h&#116;tps://links.test/NOISE\r\n\r\n> retained~~~NOISE', [(13, 42)]),
    ('> Retain [~~~https&colon;&sol;&sol;links.test/NOISE\n\n> retained~~~NOISE', [(13, 51)]),
    ('- Retain [~~~https&colon;&sol;&sol;links.test/NOISE\r\n\r\n  retained~~~NOISE', [(13, 51)]),
    ('Retain ~https://links.test/NOISE~ retained', [(8, 32)]),
    ('Retain ~h&#116;tps://links.test/NOISE~NOISE retained', [(8, 37)]),
    ('Retain ~https://links.test/NOISE~~ retained', [(8, 32)]),
    ('Retain ~h&#116;tps://links.test/NOISE~~NOISE retained', [(8, 44)]),
    ('Retain ~https://links.test/NOISE~~~ retained', [(8, 32)]),
    ('Retain ~h&#116;tps://links.test/NOISE~~~NOISE retained', [(8, 45)]),
    ('Retain ~~https://links.test/NOISE~ retained', [(9, 33)]),
    ('Retain ~~h&#116;tps://links.test/NOISE~NOISE retained', [(9, 44)]),
    ('Retain ~~https://links.test/NOISE~~ retained', [(9, 33)]),
    ('Retain ~~https&colon;&sol;&sol;links.test/NOISE~~ retained', [(9, 47)]),
    ('Retain ~~https://links.test/NOISE~~~NOISE retained', [(9, 41)]),
    ('Retain ~~https&colon;&sol;&sol;links.test/NOISE~~~ retained', [(9, 50)]),
    ('Retain ~~~https://links.test/NOISE~NOISE retained', [(10, 40)]),
    ('Retain ~~~https&colon;&sol;&sol;links.test/NOISE~ retained', [(10, 49)]),
    ('Retain ~~~https://links.test/NOISE~~NOISE retained', [(10, 41)]),
    ('Retain ~~~https&colon;&sol;&sol;links.test/NOISE~~ retained', [(10, 50)]),
    ('Retain ~~~https://links.test/NOISE~~~NOISE retained', [(10, 42)]),
    ('Retain ~~~https&colon;&sol;&sol;links.test/NOISE~~~NOISE retained', [(10, 56)]),
    ('Retain [_🧪* a ~*https://links.test/NOISE! ~中 ~中* NOISE retained', [(16, 40)]),
    ('Retain [!*!_  中 _https://links.test/NOISE*~中! ~🧪🧪中!  !!a NOISE retained', [(17, 41)]),
    ('Retain [!a**__!!*!ah&#116;tps://links.test/NOISE中🧪~~ *~! a中_!中!  中_a~中** *!_中 NOISE retained', []),
    ('Retain [_~ *🧪!__~~a中 https&colon;&sol;&sol;links.test/NOISE中 _!!!中! 🧪*~!~!  ~ NOISE retained', [(21, 60)]),
    ('Retain [ !🧪 _aa🧪a~*中a_https&colon;&sol;&sol;links.test/NOISE~*!aa~~中~中! __~ 中a🧪a~🧪!_中 NOISE retained', [(22, 61)]),
    ('Retain [*~中🧪!!!~~*~_🧪_~ahttps://links.test/NOISE中中🧪!中 *a !__!! NOISE retained', []),
    ('Retain [ !a!~_*_ * _🧪~🧪~! h&#116;tps://links.test/NOISE !a 🧪~a🧪!!_a  !🧪  中中_🧪🧪中! *_ NOISE retained', [(26, 55)]),
    ('Retain [🧪 __🧪a!*~*🧪a🧪🧪 🧪~aah&#116;tps://links.test/NOISE*~🧪*~!🧪中*_ NOISE retained', []),
    ('Retain [!中!a_🧪~!🧪中* !中🧪🧪a!a!中https&colon;&sol;&sol;links.test/NOISE!~ a_ *中🧪🧪 ~**~ *! a_!中🧪 NOISE retained', []),
    ('Retain [_*   ~*!_🧪__🧪a中 a*~🧪 中!https://links.test/NOISE a _🧪🧪*!* a~* NOISE retained', [(31, 55)]),
    ('Retain [中a🧪_*~中aa* !~🧪~!!a_*!~*~https://links.test/NOISEa🧪_*!!_**!_~中🧪中*中🧪🧪  NOISE retained', [(32, 59)]),
    ('Retain [a中中!!中 🧪 _* _🧪*!🧪中🧪~**🧪!中 h&#116;tps://links.test/NOISE中 _中中_中中* NOISE retained', [(34, 64)]),
    ('Retain [_*中🧪___!~中!🧪🧪!中!_a*  *a*_中🧪🧪https&colon;&sol;&sol;links.test/NOISE~!a中*中🧪*~ !~🧪_🧪!a!中* 🧪! NOISE retained', []),
    ('Retain [🧪!~!中a 🧪 *~*🧪! a*!🧪🧪_中_🧪*_中*中https&colon;&sol;&sol;links.test/NOISE**~ 🧪中~aa !中a 中a_中🧪中🧪!a!🧪**~!* NOISE retained', []),
    ('Retain [中*🧪~**_! ~a!a~🧪_*中🧪🧪🧪_!a_a~ _a_https://links.test/NOISE*中 ! aa!*🧪!🧪a!中!🧪*! NOISE retained', [(39, 65)]),
    ('Retain [_ a*中~!!h&#116;tps://links.test/NOISE🧪🧪_! _a_ NOISE retained', [(16, 48)]),
    ('Retain [*! _*! a🧪 https&colon;&sol;&sol;links.test/NOISE_中中~a ! aa~*中**🧪_ _~中  NOISE retained', [(18, 59)]),
    ('Retain [🧪*~*!!a*! _https&colon;&sol;&sol;links.test/NOISE**~🧪中*🧪 ~中 中~~🧪🧪!a~! *!🧪! ~中* NOISE retained', [(19, 64)]),
    ('Retain [*_中 中 🧪a_!🧪~~https://links.test/NOISE~a~🧪a_!aa中🧪~!* _a! NOISE retained', [(21, 45)]),
    ('Retain [🧪 ~ ~ 🧪🧪*🧪aa中中🧪h&#116;tps://links.test/NOISE*a中 _~ a*~**_!aaa*aa!  _a!_**~🧪_ NOISE retained', []),
    ('Retain [中  a🧪中🧪~ 中~中!!_ah&#116;tps://links.test/NOISE_!!** !~中!*中 中 NOISE retained', []),
    ('Retain [~~_*_a__中__a中中🧪中🧪~https&colon;&sol;&sol;links.test/NOISE中~ 中a中*!🧪中  🧪!~ 中中_~ ~!!* a~ NOISE retained', [(26, 65)]),
    ('Retain [ * 中🧪! ~!_~~*__a~_a_https://links.test/NOISE🧪 ~🧪a中_a🧪 中🧪_🧪aa* NOISE retained', [(28, 53)]),
    ('Retain [a🧪a中**!!*🧪🧪_a🧪~中中 !~!https://links.test/NOISE~🧪*~*🧪 中🧪_ 🧪中中_ ~_!~!* 中 NOISE retained', [(29, 55)]),
    ('Retain [*_🧪🧪🧪🧪*🧪中*_~中aa~~!🧪 ~ 🧪h&#116;tps://links.test/NOISE🧪** 🧪_ **中*🧪! NOISE retained', []),
    ('Retain [*中🧪_  !~a~!_a*~中~ a🧪~_a!中https&colon;&sol;&sol;links.test/NOISE!_~a🧪🧪*🧪 a🧪a~ a~a~a~~ ~! *~ NOISE retained', []),
    ('Retain [~ *a🧪 a*中*_🧪*a中!!~!~_🧪!🧪🧪!https&colon;&sol;&sol;links.test/NOISE 🧪 🧪 ~~ 中 NOISE retained', [(34, 72)]),
    ('Retain [~ ~*~中 aa🧪中a中🧪🧪_中 **中中~~🧪a中 https://links.test/NOISEa!_a~a*中! 🧪~*~!中* 中__ 中 NOISE retained', [(36, 64)]),
    ('Retain [_!!中*!*中**中🧪a*a!!a!_!*!**a _中_h&#116;tps://links.test/NOISE!!_中 🧪_~_~a~ NOISE retained', [(38, 67)]),
    ('Retain [中!🧪~中!中🧪_a_🧪*🧪_a_! * 🧪a*~ 中 ~a🧪ahttps&colon;&sol;&sol;links.test/NOISE🧪_🧪a!~*_ ~中!中*!a a🧪*中_~中~_ NOISE retained', []),
    ('Retain [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(19, 48)]),
    ('Retain [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained', [(19, 48)]),
    ('Retain a*b [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(23, 58)]),
    ('Retain a*b [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained', [(23, 52)]),
    ('Retain a_b [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(23, 58)]),
    ('Retain a_b [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained', [(23, 52)]),
    ('Retain a~b [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(23, 52)]),
    ('Retain a~b [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained', [(23, 58)]),
    ('Retain a~~b [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(24, 53)]),
    ('Retain a~~b [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained', [(24, 59)]),
    ('Retain a~~~b [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(25, 54)]),
    ('Retain a~~~b [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained', [(25, 54)]),
    ('Retain * [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(21, 56)]),
    ('Retain * [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained', [(21, 50)]),
    ('Retain ~ [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(21, 50)]),
    ('Retain ~ [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained', [(21, 56)]),
    ('Retain `*` [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(7, 10), (23, 52)]),
    ('Retain `*` [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained', [(7, 10), (23, 52)]),
    ('Retain `~` [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(7, 10), (23, 52)]),
    ('Retain `~` [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained', [(7, 10), (23, 52)]),
    ('Retain $*$ [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(7, 10), (23, 52)]),
    ('Retain $*$ [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained', [(7, 10), (23, 52)]),
    ('Retain $~$ [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(7, 10), (23, 52)]),
    ('Retain $~$ [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained', [(7, 10), (23, 52)]),
    ('Retain <em x="*">retained</em> [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(43, 72)]),
    ('Retain <em x="*">retained</em> [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained', [(43, 72)]),
    ('Retain <!--~--> [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(28, 57)]),
    ('Retain <!--~--> [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained', [(28, 57)]),
    ('Retain [a*b](/retained) [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(11, 23), (36, 71)]),
    ('Retain [a*b](/retained) [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained', [(11, 23), (36, 65)]),
    ('Retain [a~b](/retained) [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(11, 23), (36, 65)]),
    ('Retain [a~b](/retained) [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained', [(11, 23), (36, 71)]),
    ('Retain ![a*b](/retained) [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(12, 24), (37, 72)]),
    ('Retain ![a*b](/retained) [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained', [(12, 24), (37, 66)]),
    ('Retain ![a~b](/retained) [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(12, 24), (37, 66)]),
    ('Retain ![a~b](/retained) [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained', [(12, 24), (37, 72)]),
    ('Retain [a`*`b](/retained) [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(9, 12), (13, 25), (38, 67)]),
    ('Retain [a`*`b](/retained) [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained', [(9, 12), (13, 25), (38, 67)]),
    ('Retain [a$~$b](/retained) [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(9, 12), (13, 25), (38, 67)]),
    ('Retain [a$~$b](/retained) [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained', [(9, 12), (13, 25), (38, 67)]),
    ('Retain [a<em x="~">b](/retained) [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(20, 32), (45, 74)]),
    ('Retain [a<em x="~">b](/retained) [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained', [(20, 32), (45, 74)]),
])
def test_strikethrough_text_nodes_bound_protocol_protection(source, expected_ranges):
    assert protected_ranges(source) == expected_ranges


# Frozen installed-renderer intervals: escaped runs, atomic labels and list prefixes.
@pytest.mark.parametrize(("source", "expected_ranges"), [
    ('* Retain [~retained *https://links.test/NOISE~NOISE* retained', [(21, 45)]),
    ('* Retain [*retained ~~https://links.test/NOISE*NOISE~~ retained', [(22, 46)]),
    ('* Retain [~~retained *h&#116;tps://links.test/NOISE~~NOISE* retained', [(22, 51)]),
    ('* Retain [*retained ~https&colon;&sol;&sol;links.test/NOISE*NOISE~ retained', [(21, 59)]),
    ('> * Retain [~retained *https://links.test/NOISE~NOISE* retained', [(23, 47)]),
    ('> * Retain [*retained ~~https://links.test/NOISE*NOISE~~ retained', [(24, 48)]),
    ('> * Retain [~~retained *h&#116;tps://links.test/NOISE~~NOISE* retained', [(24, 53)]),
    ('> * Retain [*retained ~https&colon;&sol;&sol;links.test/NOISE*NOISE~ retained', [(23, 61)]),
    ('* > Retain [~retained *https://links.test/NOISE~NOISE* retained', [(23, 47)]),
    ('* > Retain [*retained ~~https://links.test/NOISE*NOISE~~ retained', [(24, 48)]),
    ('* > Retain [~~retained *h&#116;tps://links.test/NOISE~~NOISE* retained', [(24, 53)]),
    ('* > Retain [*retained ~https&colon;&sol;&sol;links.test/NOISE*NOISE~ retained', [(23, 61)]),
    ('1. * Retain [~retained *https://links.test/NOISE~NOISE* retained', [(24, 48)]),
    ('1. * Retain [*retained ~~https://links.test/NOISE*NOISE~~ retained', [(25, 49)]),
    ('1. * Retain [~~retained *h&#116;tps://links.test/NOISE~~NOISE* retained', [(25, 54)]),
    ('1. * Retain [*retained ~https&colon;&sol;&sol;links.test/NOISE*NOISE~ retained', [(24, 62)]),
    ('*\tRetain [~retained *https://links.test/NOISE~NOISE* retained', [(21, 45)]),
    ('*\tRetain [*retained ~~https://links.test/NOISE*NOISE~~ retained', [(22, 46)]),
    ('*\tRetain [~~retained *h&#116;tps://links.test/NOISE~~NOISE* retained', [(22, 51)]),
    ('*\tRetain [*retained ~https&colon;&sol;&sol;links.test/NOISE*NOISE~ retained', [(21, 59)]),
    ('>\t*\tRetain [~retained *https://links.test/NOISE~NOISE* retained', [(23, 47)]),
    ('>\t*\tRetain [*retained ~~https://links.test/NOISE*NOISE~~ retained', [(24, 48)]),
    ('>\t*\tRetain [~~retained *h&#116;tps://links.test/NOISE~~NOISE* retained', [(24, 53)]),
    ('>\t*\tRetain [*retained ~https&colon;&sol;&sol;links.test/NOISE*NOISE~ retained', [(23, 61)]),
    ('Retain \\* [~retained *https://links.test/NOISE~NOISE* retained', [(22, 46)]),
    ('Retain \\* [~~retained *https://links.test/NOISE~~NOISE* retained', [(23, 47)]),
    ('Retain \\* [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained', [(22, 51)]),
    ('Retain \\* [*retained ~~h&#116;tps://links.test/NOISE*NOISE~~ retained', [(23, 52)]),
    ('Retain \\* [~~retained *https&colon;&sol;&sol;links.test/NOISE~~NOISE* retained', [(23, 61)]),
    ('Retain \\~ [~retained *https://links.test/NOISE~NOISE* retained', [(22, 46)]),
    ('Retain \\~ [*retained ~~https://links.test/NOISE*NOISE~~ retained', [(23, 47)]),
    ('Retain \\~ [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained', [(22, 51)]),
    ('Retain \\~ [~retained *https&colon;&sol;&sol;links.test/NOISE~NOISE* retained', [(22, 60)]),
    ('Retain \\~ [~~retained *https&colon;&sol;&sol;links.test/NOISE~~NOISE* retained', [(23, 61)]),
    ('Retain [retained](/a*b) [*retained ~https://links.test/NOISE*NOISE~ retained', [(16, 23), (36, 60)]),
    ('Retain [retained](/a*b) [*retained ~~https://links.test/NOISE*NOISE~~ retained', [(16, 23), (37, 61)]),
    ('Retain [retained](/a*b) [~~retained *h&#116;tps://links.test/NOISE~~NOISE* retained', [(16, 23), (37, 66)]),
    ('Retain [retained](/a*b) [~retained *https&colon;&sol;&sol;links.test/NOISE~NOISE* retained', [(16, 23), (36, 74)]),
    ('Retain [retained](/a*b) [*retained ~~https&colon;&sol;&sol;links.test/NOISE*NOISE~~ retained', [(16, 23), (37, 75)]),
    ('Retain [retained](/a~b) [*retained ~https://links.test/NOISE*NOISE~ retained', [(16, 23), (36, 60)]),
    ('Retain [retained](/a~b) [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(16, 23), (36, 65)]),
    ('Retain [retained](/a~b) [~~retained *h&#116;tps://links.test/NOISE~~NOISE* retained', [(16, 23), (37, 66)]),
    ('Retain [retained](/a~b) [*retained ~https&colon;&sol;&sol;links.test/NOISE*NOISE~ retained', [(16, 23), (36, 74)]),
    ('Retain [retained](/a~b) [*retained ~~https&colon;&sol;&sol;links.test/NOISE*NOISE~~ retained', [(16, 23), (37, 75)]),
    ('Retain [retained](/a "*~") [~~retained *https://links.test/NOISE~~NOISE* retained', [(16, 26), (40, 64)]),
    ('Retain [retained](/a "*~") [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(16, 26), (39, 68)]),
    ('Retain [retained](/a "*~") [*retained ~~h&#116;tps://links.test/NOISE*NOISE~~ retained', [(16, 26), (40, 69)]),
    ('Retain [retained](/a "*~") [*retained ~https&colon;&sol;&sol;links.test/NOISE*NOISE~ retained', [(16, 26), (39, 77)]),
    ('Retain [retained](/a "~*") [~retained *https://links.test/NOISE~NOISE* retained', [(16, 26), (39, 63)]),
    ('Retain [retained](/a "~*") [~~retained *https://links.test/NOISE~~NOISE* retained', [(16, 26), (40, 64)]),
    ('Retain [retained](/a "~*") [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained', [(16, 26), (39, 68)]),
    ('Retain [retained](/a "~*") [*retained ~~h&#116;tps://links.test/NOISE*NOISE~~ retained', [(16, 26), (40, 69)]),
    ('Retain [retained](/a "~*") [~~retained *https&colon;&sol;&sol;links.test/NOISE~~NOISE* retained', [(16, 26), (40, 78)]),
    ('Retain [![a*b](/a~b)](/outer) [~retained *https://links.test/NOISE~NOISE* retained', [(13, 29), (42, 72)]),
    ('Retain [![a*b](/a~b)](/outer) [*retained ~~https://links.test/NOISE*NOISE~~ retained', [(13, 29), (43, 67)]),
    ('Retain [![a*b](/a~b)](/outer) [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained', [(13, 29), (42, 71)]),
    ('Retain [![a*b](/a~b)](/outer) [~retained *https&colon;&sol;&sol;links.test/NOISE~NOISE* retained', [(13, 29), (42, 86)]),
    ('Retain [![a*b](/a~b)](/outer) [~~retained *https&colon;&sol;&sol;links.test/NOISE~~NOISE* retained', [(13, 29), (43, 88)]),
    ('Retain [![a~b](/a*b)](/outer) [*retained ~https://links.test/NOISE*NOISE~ retained', [(13, 29), (42, 72)]),
    ('Retain [![a~b](/a*b)](/outer) [*retained ~~https://links.test/NOISE*NOISE~~ retained', [(13, 29), (43, 73)]),
    ('Retain [![a~b](/a*b)](/outer) [~~retained *h&#116;tps://links.test/NOISE~~NOISE* retained', [(13, 29), (43, 72)]),
    ('Retain [![a~b](/a*b)](/outer) [~retained *https&colon;&sol;&sol;links.test/NOISE~NOISE* retained', [(13, 29), (42, 80)]),
    ('Retain [![a~b](/a*b)](/outer) [*retained ~~https&colon;&sol;&sol;links.test/NOISE*NOISE~~ retained', [(13, 29), (43, 87)]),
    ('Retain [a\\*b](/a) [*retained ~https://links.test/NOISE*NOISE~ retained', [(12, 17), (30, 54)]),
    ('Retain [a\\*b](/a) [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(12, 17), (30, 59)]),
    ('Retain [a\\*b](/a) [~~retained *h&#116;tps://links.test/NOISE~~NOISE* retained', [(12, 17), (31, 60)]),
    ('Retain [a\\*b](/a) [*retained ~https&colon;&sol;&sol;links.test/NOISE*NOISE~ retained', [(12, 17), (30, 68)]),
    ('Retain [a\\*b](/a) [*retained ~~https&colon;&sol;&sol;links.test/NOISE*NOISE~~ retained', [(12, 17), (31, 69)]),
    ('Retain [a\\~b](/a) [~~retained *https://links.test/NOISE~~NOISE* retained', [(12, 17), (31, 55)]),
    ('Retain [a\\~b](/a) [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(12, 17), (30, 59)]),
    ('Retain [a\\~b](/a) [*retained ~~h&#116;tps://links.test/NOISE*NOISE~~ retained', [(12, 17), (31, 60)]),
    ('Retain [a\\~b](/a) [*retained ~https&colon;&sol;&sol;links.test/NOISE*NOISE~ retained', [(12, 17), (30, 68)]),
    ('Retain [\\~h&#116;tps://links.test/NOISE~NOISE retained', [(10, 45)]),
    ('Retain [\\~https&colon;&sol;&sol;links.test/NOISE~~NOISE retained', [(10, 55)]),
    ('Retain [\\~~h&#116;tps://links.test/NOISE~NOISE retained', [(11, 40)]),
    ('Retain [\\~~https&colon;&sol;&sol;links.test/NOISE~~NOISE retained', [(11, 56)]),
    ('Retain [\\~~~h&#116;tps://links.test/NOISE~NOISE retained', [(12, 47)]),
    ('Retain [\\~~~https&colon;&sol;&sol;links.test/NOISE~~NOISE retained', [(12, 50)]),
    ('Retain [\\~~~~h&#116;tps://links.test/NOISE~NOISE retained', [(13, 48)]),
    ('Retain [\\~~~~https&colon;&sol;&sol;links.test/NOISE~~NOISE retained', [(13, 58)]),
    ('Retain [\\~~~~~h&#116;tps://links.test/NOISE~NOISE retained', [(14, 49)]),
    ('Retain [\\~~~~~https&colon;&sol;&sol;links.test/NOISE~~NOISE retained', [(14, 59)]),
    ('Retain [\\~~~~~~h&#116;tps://links.test/NOISE~NOISE retained', [(15, 50)]),
    ('Retain [\\~~~~~~https&colon;&sol;&sol;links.test/NOISE~~NOISE retained', [(15, 60)]),
    ('Retain [\\\\~h&#116;tps://links.test/NOISE~NOISE retained', [(11, 40)]),
    ('Retain [\\\\~https&colon;&sol;&sol;links.test/NOISE~~NOISE retained', [(11, 56)]),
    ('Retain [\\\\~~h&#116;tps://links.test/NOISE~NOISE retained', [(12, 47)]),
    ('Retain [\\\\~~https&colon;&sol;&sol;links.test/NOISE~~NOISE retained', [(12, 50)]),
    ('Retain [\\\\~~~h&#116;tps://links.test/NOISE~NOISE retained', [(13, 48)]),
    ('Retain [\\\\~~~https&colon;&sol;&sol;links.test/NOISE~~NOISE retained', [(13, 58)]),
    ('Retain [\\\\~~~~h&#116;tps://links.test/NOISE~NOISE retained', [(14, 49)]),
    ('Retain [\\\\~~~~https&colon;&sol;&sol;links.test/NOISE~~NOISE retained', [(14, 59)]),
    ('Retain [\\\\~~~~~h&#116;tps://links.test/NOISE~NOISE retained', [(15, 50)]),
    ('Retain [\\\\~~~~~https&colon;&sol;&sol;links.test/NOISE~~NOISE retained', [(15, 60)]),
    ('Retain [\\\\~~~~~~h&#116;tps://links.test/NOISE~NOISE retained', [(16, 51)]),
    ('Retain [\\\\~~~~~~https&colon;&sol;&sol;links.test/NOISE~~NOISE retained', [(16, 61)]),
    ('Retain [\\\\\\~h&#116;tps://links.test/NOISE~NOISE retained', [(12, 47)]),
    ('Retain [\\\\\\~https&colon;&sol;&sol;links.test/NOISE~~NOISE retained', [(12, 57)]),
    ('Retain [\\\\\\~~h&#116;tps://links.test/NOISE~NOISE retained', [(13, 42)]),
    ('Retain [\\\\\\~~https&colon;&sol;&sol;links.test/NOISE~~NOISE retained', [(13, 58)]),
    ('Retain [\\\\\\~~~h&#116;tps://links.test/NOISE~NOISE retained', [(14, 49)]),
    ('Retain [\\\\\\~~~https&colon;&sol;&sol;links.test/NOISE~~NOISE retained', [(14, 52)]),
    ('Retain [\\\\\\~~~~h&#116;tps://links.test/NOISE~NOISE retained', [(15, 50)]),
    ('Retain [\\\\\\~~~~https&colon;&sol;&sol;links.test/NOISE~~NOISE retained', [(15, 60)]),
    ('Retain [\\\\\\~~~~~h&#116;tps://links.test/NOISE~NOISE retained', [(16, 51)]),
    ('Retain [\\\\\\~~~~~https&colon;&sol;&sol;links.test/NOISE~~NOISE retained', [(16, 61)]),
    ('Retain [\\\\\\~~~~~~h&#116;tps://links.test/NOISE~NOISE retained', [(17, 52)]),
    ('Retain [\\\\\\~~~~~~https&colon;&sol;&sol;links.test/NOISE~~NOISE retained', [(17, 62)]),
    ('Retain [\\\\\\\\~h&#116;tps://links.test/NOISE~NOISE retained', [(13, 42)]),
    ('Retain [\\\\\\\\~https&colon;&sol;&sol;links.test/NOISE~~NOISE retained', [(13, 58)]),
    ('Retain [\\\\\\\\~~h&#116;tps://links.test/NOISE~NOISE retained', [(14, 49)]),
    ('Retain [\\\\\\\\~~https&colon;&sol;&sol;links.test/NOISE~~NOISE retained', [(14, 52)]),
    ('Retain [\\\\\\\\~~~h&#116;tps://links.test/NOISE~NOISE retained', [(15, 50)]),
    ('Retain [\\\\\\\\~~~https&colon;&sol;&sol;links.test/NOISE~~NOISE retained', [(15, 60)]),
    ('Retain [\\\\\\\\~~~~h&#116;tps://links.test/NOISE~NOISE retained', [(16, 51)]),
    ('Retain [\\\\\\\\~~~~https&colon;&sol;&sol;links.test/NOISE~~NOISE retained', [(16, 61)]),
    ('Retain [\\\\\\\\~~~~~h&#116;tps://links.test/NOISE~NOISE retained', [(17, 52)]),
    ('Retain [\\\\\\\\~~~~~https&colon;&sol;&sol;links.test/NOISE~~NOISE retained', [(17, 62)]),
    ('Retain [\\\\\\\\~~~~~~h&#116;tps://links.test/NOISE~NOISE retained', [(18, 53)]),
    ('Retain [\\\\\\\\~~~~~~https&colon;&sol;&sol;links.test/NOISE~~NOISE retained', [(18, 63)]),
    ('Retain [\\~https://links.test/NOISE~NOISE retained', [(10, 40)]),
    ('Retain [\\~https://links.test/NOISE~~~NOISE retained', [(10, 42)]),
    ('Retain [\\~~https://links.test/NOISE~NOISE retained', [(11, 35)]),
    ('Retain [\\~~https://links.test/NOISE~~~NOISE retained', [(11, 43)]),
    ('Retain [\\~~~https://links.test/NOISE~NOISE retained', [(12, 42)]),
    ('Retain [\\~~~https://links.test/NOISE~~~NOISE retained', [(12, 44)]),
    ('Retain [\\~~~~https://links.test/NOISE~NOISE retained', [(13, 43)]),
    ('Retain [\\~~~~https://links.test/NOISE~~~NOISE retained', [(13, 45)]),
    ('Retain [\\\\~https://links.test/NOISE~NOISE retained', [(11, 35)]),
    ('Retain [\\\\~https://links.test/NOISE~~~NOISE retained', [(11, 43)]),
    ('Retain [\\\\~~https://links.test/NOISE~NOISE retained', [(12, 42)]),
    ('Retain [\\\\~~https://links.test/NOISE~~~NOISE retained', [(12, 44)]),
    ('Retain [&tilde;https://links.test/NOISE~NOISE retained', [(15, 45)]),
    ('Retain [&tilde;https://links.test/NOISE~~~NOISE retained', [(15, 47)]),
    ('Retain [&#126;https://links.test/NOISE~NOISE retained', [(14, 44)]),
    ('Retain [&#126;https://links.test/NOISE~~~NOISE retained', [(14, 46)]),
    ('Retain [&sim;https://links.test/NOISE~NOISE retained', [(13, 43)]),
    ('Retain [&sim;https://links.test/NOISE~~~NOISE retained', [(13, 45)]),
    ('Retain [~retained *https://links.test/NOISE~NOISE* retained', [(19, 43)]),
    ('Retain a*b [***retained ~h&#116;tps://links.test/NOISE***NOISE~ retained', [(25, 54)]),
    ('Retain a_b [~~retained **https&colon;&sol;&sol;links.test/NOISE~~NOISE** retained', [(25, 70)]),
    ('Retain a~b [~~retained **https://links.test/NOISE~~NOISE** retained', [(25, 49)]),
    ('Retain a~~b [**retained ~https://links.test/NOISE**NOISE~ retained', [(25, 56)]),
    ('Retain a~~~b [*retained ~~h&#116;tps://links.test/NOISE*NOISE~~ retained', [(26, 55)]),
    ('Retain \\* [~retained *https&colon;&sol;&sol;links.test/NOISE~NOISE* retained', [(22, 60)]),
    ('Retain \\~ [***retained ~~https://links.test/NOISE***NOISE~~ retained', [(25, 49)]),
    ('Retain `*` [***retained ~h&#116;tps://links.test/NOISE***NOISE~ retained', [(7, 10), (25, 54)]),
    ('Retain `~` [~~retained **https&colon;&sol;&sol;links.test/NOISE~~NOISE** retained', [(7, 10), (25, 63)]),
    ('Retain $*$ [~~retained **https://links.test/NOISE~~NOISE** retained', [(7, 10), (25, 49)]),
    ('Retain $~$ [**retained ~https://links.test/NOISE**NOISE~ retained', [(7, 10), (24, 48)]),
    ('Retain <em x="*">retained</em> [*retained ~~h&#116;tps://links.test/NOISE*NOISE~~ retained', [(44, 73)]),
    ('Retain <!--~--> [~retained *https&colon;&sol;&sol;links.test/NOISE~NOISE* retained', [(28, 66)]),
    ('Retain [a*b](/retained) [~retained *https://links.test/NOISE~NOISE* retained', [(11, 23), (36, 66)]),
    ('Retain [a*b](/retained) [***retained ~~https://links.test/NOISE***NOISE~~ retained', [(11, 23), (39, 63)]),
    ('Retain [a~b](/retained) [***retained ~h&#116;tps://links.test/NOISE***NOISE~ retained', [(11, 23), (38, 75)]),
    ('Retain ![a*b](/retained) [~~retained **https&colon;&sol;&sol;links.test/NOISE~~NOISE** retained', [(12, 24), (39, 84)]),
    ('Retain ![a~b](/retained) [~~retained **https://links.test/NOISE~~NOISE** retained', [(12, 24), (39, 63)]),
    ('Retain [a`*`b](/retained) [**retained ~https://links.test/NOISE**NOISE~ retained', [(9, 12), (13, 25), (39, 63)]),
    ('Retain [a$~$b](/retained) [*retained ~~h&#116;tps://links.test/NOISE*NOISE~~ retained', [(9, 12), (13, 25), (39, 68)]),
    ('Retain [a<em x="~">b](/retained) [~retained *https&colon;&sol;&sol;links.test/NOISE~NOISE* retained', [(20, 32), (45, 83)]),
])
def test_strikethrough_registration_and_containers_preserve_source_boundaries(source, expected_ranges):
    assert protected_ranges(source) == expected_ranges


# Native URL ranges plus the unchanged conservative reference-protection policy.
# Native URL/token spans plus explicit conservative reference protection.
@pytest.mark.parametrize(("source", "expected_ranges"), [
    ('合成 🧪\n\nRetain [a*b][ref] [~retained *https://links.test/NOISE~NOISE* retained\n\n[ref]: /retained', [(13, 23), (36, 66), (77, 94)]),
    ('合成 🧪\r\n\r\nRetain [a~b][ref] [~retained **https://links.test/NOISE~NOISE** retained\r\n\r\n[ref]: /retained', [(15, 25), (39, 63), (82, 100)]),
    ('合成 🧪\r\n\r\nRetain [a_b][ref] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\r\n\r\n[ref]: /retained', [(15, 25), (38, 67), (85, 103)]),
    ('合成 🧪\n\nRetain [a~~~b][ref] [**retained ~https&colon;&sol;&sol;links.test/NOISE**NOISE~ retained\n\n[ref]: /retained', [(13, 25), (39, 77), (95, 112)]),
    ('合成 🧪\n\nRetain [a$~$b][ref] [~retained **https://links.test/NOISE~NOISE** retained\n\n[ref]: /retained', [(13, 25), (39, 63), (81, 98)]),
    ('合成 🧪\r\n\r\nRetain [a<em x="~">b][ref] [*retained ~https://links.test/NOISE*NOISE~ retained\r\n\r\n[ref]: /retained', [(47, 71), (89, 107)]),
    ('合成 🧪\r\n\r\nRetain [a*b][] [**retained ~h&#116;tps://links.test/NOISE**NOISE~ retained\r\n\r\n[a*b]: /retained', [(15, 22), (36, 65), (84, 102)]),
    ('合成 🧪\n\nRetain [a_b][] [~retained *https&colon;&sol;&sol;links.test/NOISE~NOISE* retained\n\n[a_b]: /retained', [(13, 20), (33, 77), (88, 105)]),
    ('合成 🧪\n\nRetain [a~~~b][] [*retained ~https://links.test/NOISE*NOISE~ retained\n\n[a~~~b]: /retained', [(13, 22), (35, 59), (76, 95)]),
    ('合成 🧪\r\n\r\nRetain [a`*`b][] [**retained ~https://links.test/NOISE**NOISE~ retained\r\n\r\n[a`*`b]: /retained', [(15, 24), (38, 62), (81, 101)]),
    ('合成 🧪\r\n\r\nRetain [a<em x="~">b][] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\r\n\r\n[a<em x="~">b]: /retained', [(44, 73), (91, 118)]),
    ('合成 🧪\n\nRetain [a*b] [~retained **https&colon;&sol;&sol;links.test/NOISE~NOISE** retained\n\n[a*b]: /retained', [(32, 76), (88, 105)]),
    ('合成 🧪\n\nRetain [a~b] [**retained ~https://links.test/NOISE**NOISE~ retained\n\n[a~b]: /retained', [(32, 63), (74, 91)]),
    ('合成 🧪\r\n\r\nRetain [a~~~b] [~retained *https://links.test/NOISE~NOISE* retained\r\n\r\n[a~~~b]: /retained', [(35, 59), (77, 97)]),
    ('合成 🧪\r\n\r\nRetain [a`*`b] [~retained **h&#116;tps://links.test/NOISE~NOISE** retained\r\n\r\n[a`*`b]: /retained', [(17, 20), (36, 65), (84, 104)]),
    ('合成 🧪\n\nRetain [a$~$b] [*retained ~https&colon;&sol;&sol;links.test/NOISE*NOISE~ retained\n\n[a$~$b]: /retained', [(15, 18), (33, 71), (88, 107)]),
    ('合成 🧪\n\nRetain ![a*b][ref] [~retained *https://links.test/NOISE~NOISE* retained\n\n[ref]: /retained', [(13, 24), (37, 67), (78, 95)]),
    ('合成 🧪\r\n\r\nRetain ![a~b][ref] [~retained **https://links.test/NOISE~NOISE** retained\r\n\r\n[ref]: /retained', [(15, 26), (40, 64), (83, 101)]),
    ('合成 🧪\r\n\r\nRetain ![a_b][ref] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\r\n\r\n[ref]: /retained', [(15, 26), (39, 68), (86, 104)]),
    ('合成 🧪\n\nRetain ![a~~~b][ref] [**retained ~https&colon;&sol;&sol;links.test/NOISE**NOISE~ retained\n\n[ref]: /retained', [(13, 26), (40, 78), (96, 113)]),
    ('合成 🧪\n\nRetain ![a$~$b][ref] [~retained **https://links.test/NOISE~NOISE** retained\n\n[ref]: /retained', [(13, 26), (40, 64), (82, 99)]),
    ('合成 🧪\r\n\r\nRetain ![a<em x="~">b][ref] [*retained ~https://links.test/NOISE*NOISE~ retained\r\n\r\n[ref]: /retained', [(48, 72), (90, 108)]),
    ('合成 🧪\r\n\r\nRetain ![a*b][] [**retained ~h&#116;tps://links.test/NOISE**NOISE~ retained\r\n\r\n[a*b]: /retained', [(15, 23), (37, 66), (85, 103)]),
    ('合成 🧪\n\nRetain ![a_b][] [~retained *https&colon;&sol;&sol;links.test/NOISE~NOISE* retained\n\n[a_b]: /retained', [(13, 21), (34, 78), (89, 106)]),
    ('合成 🧪\n\nRetain ![a~~~b][] [*retained ~https://links.test/NOISE*NOISE~ retained\n\n[a~~~b]: /retained', [(13, 23), (36, 60), (77, 96)]),
    ('合成 🧪\r\n\r\nRetain ![a`*`b][] [**retained ~https://links.test/NOISE**NOISE~ retained\r\n\r\n[a`*`b]: /retained', [(15, 25), (39, 63), (82, 102)]),
    ('合成 🧪\r\n\r\nRetain ![a<em x="~">b][] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\r\n\r\n[a<em x="~">b]: /retained', [(45, 74), (92, 119)]),
    ('合成 🧪\n\nRetain ![a*b] [~retained **https&colon;&sol;&sol;links.test/NOISE~NOISE** retained\n\n[a*b]: /retained', [(33, 77), (89, 106)]),
    ('合成 🧪\n\nRetain ![a~b] [**retained ~https://links.test/NOISE**NOISE~ retained\n\n[a~b]: /retained', [(33, 64), (75, 92)]),
    ('合成 🧪\r\n\r\nRetain ![a~~~b] [~retained *https://links.test/NOISE~NOISE* retained\r\n\r\n[a~~~b]: /retained', [(36, 60), (78, 98)]),
    ('合成 🧪\r\n\r\nRetain ![a`*`b] [~retained **h&#116;tps://links.test/NOISE~NOISE** retained\r\n\r\n[a`*`b]: /retained', [(18, 21), (37, 66), (85, 105)]),
    ('合成 🧪\n\nRetain ![a$~$b] [*retained ~https&colon;&sol;&sol;links.test/NOISE*NOISE~ retained\n\n[a$~$b]: /retained', [(16, 19), (34, 72), (89, 108)]),
    ('Retain [a~b][ref] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n[ref]: /retained', [(7, 17), (30, 59), (76, 93)]),
    ('Retain [ref][] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n[ref]: /retained', [(7, 14), (27, 56), (73, 90)]),
    ('Retain [ref] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n[ref]: /retained', [(25, 54), (71, 88)]),
    ('Retain [a~b][REF] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n[REF]: /retained', [(7, 17), (30, 59), (76, 93)]),
    ('Retain [REF][] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n[REF]: /retained', [(7, 14), (27, 56), (73, 90)]),
    ('Retain [REF] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n[REF]: /retained', [(25, 54), (71, 88)]),
    ('Retain [a~b][rEf] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n[rEf]: /retained', [(7, 17), (30, 59), (76, 93)]),
    ('Retain [rEf][] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n[rEf]: /retained', [(7, 14), (27, 56), (73, 90)]),
    ('Retain [rEf] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[rEf]: /retained', [(25, 54), (71, 88)]),
    ('Retain [a~b][a*b] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[a*b]: /retained', [(7, 17), (30, 65), (76, 93)]),
    ('Retain [a*b][] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[a*b]: /retained', [(7, 14), (27, 56), (73, 90)]),
    ('Retain [a*b] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[a*b]: /retained', [(25, 54), (71, 88)]),
    ('Retain [a~b][a\\*b] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[a\\*b]: /retained', [(7, 18), (31, 66), (77, 95)]),
    ('Retain [a\\*b][] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[a\\*b]: /retained', [(7, 15), (28, 57), (74, 92)]),
    ('Retain [a\\*b] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[a\\*b]: /retained', [(26, 55), (72, 90)]),
    ('Retain [a~b][a&amp;b] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[a&amp;b]: /retained', [(7, 21), (34, 69), (80, 101)]),
    ('Retain ![a&amp;b][] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n[a&amp;b]: /retained', [(7, 19), (32, 61), (78, 99)]),
    ('Retain ![a&amp;b] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n[a&amp;b]: /retained', [(30, 59), (76, 97)]),
    ('Retain ![a~b][a&b] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n[a&b]: /retained', [(7, 18), (31, 60), (77, 94)]),
    ('Retain ![a&b][] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n[a&b]: /retained', [(7, 15), (28, 57), (74, 91)]),
    ('Retain ![a&b] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n[a&b]: /retained', [(26, 55), (72, 89)]),
    ('Retain ![a~b][a  b] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n[a  b]: /retained', [(7, 19), (32, 61), (78, 96)]),
    ('Retain ![a  b][] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n[a  b]: /retained', [(7, 16), (29, 58), (75, 93)]),
    ('Retain ![a  b] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n[a  b]: /retained', [(27, 56), (73, 91)]),
    ('Retain ![a~b][a\tb] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[a\tb]: /retained', [(7, 18), (31, 66), (77, 94)]),
    ('Retain ![a\tb][] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[a\tb]: /retained', [(7, 15), (28, 57), (74, 91)]),
    ('Retain ![a\tb] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[a\tb]: /retained', [(26, 55), (72, 89)]),
    ('Retain ![a~b][ϴ] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[ϴ]: /retained', [(7, 16), (29, 64), (75, 90)]),
    ('Retain ![ϴ][] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[ϴ]: /retained', [(7, 13), (26, 55), (72, 87)]),
    ('Retain ![ϴ] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[ϴ]: /retained', [(24, 53), (70, 85)]),
    ('Retain ![a~b][θ] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[θ]: /retained', [(7, 16), (29, 64), (75, 90)]),
    ('Retain ![θ][] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[θ]: /retained', [(7, 13), (26, 55), (72, 87)]),
    ('Retain [a*b][ref] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n[ref]: /retained', [(7, 17), (30, 65), (76, 93)]),
    ('Retain [a*b][ref] [~retained *https&colon;&sol;&sol;links.test/NOISE~NOISE* retained\n\n[ref]: /retained', [(7, 17), (30, 74), (85, 102)]),
    ('Retain [a*b][ref] [*retained ~https&colon;&sol;&sol;links.test/NOISE*NOISE~ retained\n\n[ref]: /retained', [(7, 17), (30, 68), (85, 102)]),
    ('Retain [a*b][ref] [~retained *https&colon;&sol;&sol;links.test/NOISE~NOISE* retained\n\n[other]: /retained', [(7, 17), (30, 74), (85, 104)]),
    ('Retain [a*b][ref] [*retained ~https&colon;&sol;&sol;links.test/NOISE*NOISE~ retained\n\n[other]: /retained', [(7, 17), (30, 68), (85, 104)]),
    ('Retain [a*b][missing] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n[missing]: /retained', [(7, 21), (34, 69), (80, 101)]),
    ('Retain [a*b][missing] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[missing]: /retained', [(7, 21), (34, 63), (80, 101)]),
    ('Retain [a*b][missing] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n[other]: /retained', [(7, 21), (34, 69), (80, 99)]),
    ('Retain [a*b][missing] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[other]: /retained', [(7, 21), (34, 63), (80, 99)]),
    ('Retain [a*b][missing] [*retained ~https&colon;&sol;&sol;links.test/NOISE*NOISE~ retained\n\n[other]: /retained', [(7, 21), (34, 72), (89, 108)]),
    ('Retain [a*b][a*b] [~retained *https&colon;&sol;&sol;links.test/NOISE~NOISE* retained\n\n[a*b]: /retained', [(7, 17), (30, 74), (85, 102)]),
    ('Retain [a*b][a*b] [*retained ~https&colon;&sol;&sol;links.test/NOISE*NOISE~ retained\n\n[a*b]: /retained', [(7, 17), (30, 68), (85, 102)]),
    ('Retain [a*b][a*b] [~retained *https&colon;&sol;&sol;links.test/NOISE~NOISE* retained\n\n[other]: /retained', [(7, 17), (30, 74), (85, 104)]),
    ('Retain [a*b][a*b] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[other]: /retained', [(7, 17), (30, 59), (76, 95)]),
    ('Retain [a*b][a~b] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n[a~b]: /retained', [(7, 17), (30, 65), (76, 93)]),
    ('Retain [a*b][a~b] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[a~b]: /retained', [(7, 17), (30, 59), (76, 93)]),
    ('Retain [a*b][a~b] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n[other]: /retained', [(7, 17), (30, 65), (76, 95)]),
    ('Retain [a*b][a~b] [~retained *https&colon;&sol;&sol;links.test/NOISE~NOISE* retained\n\n[other]: /retained', [(7, 17), (30, 74), (85, 104)]),
    ('Retain [a*b][a~b] [*retained ~https&colon;&sol;&sol;links.test/NOISE*NOISE~ retained\n\n[other]: /retained', [(7, 17), (30, 68), (85, 104)]),
    ('Retain [a*b][a\\*b] [~retained *https&colon;&sol;&sol;links.test/NOISE~NOISE* retained\n\n[a\\*b]: /retained', [(7, 18), (31, 75), (86, 104)]),
    ('Retain [a*b][a\\*b] [*retained ~https&colon;&sol;&sol;links.test/NOISE*NOISE~ retained\n\n[a\\*b]: /retained', [(7, 18), (31, 69), (86, 104)]),
    ('Retain [a*b][a\\*b] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n[other]: /retained', [(7, 18), (31, 66), (77, 96)]),
    ('Retain [a*b][a\\*b] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[other]: /retained', [(7, 18), (31, 60), (77, 96)]),
    ('Retain [a*b][a&amp;b] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n[a&amp;b]: /retained', [(7, 21), (34, 69), (80, 101)]),
    ('Retain [a*b][a&amp;b] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[a&amp;b]: /retained', [(7, 21), (34, 63), (80, 101)]),
    ('Retain [a*b][a&amp;b] [*retained ~https&colon;&sol;&sol;links.test/NOISE*NOISE~ retained\n\n[a&amp;b]: /retained', [(7, 21), (34, 72), (89, 110)]),
    ('Retain [a*b][a&amp;b] [~retained *https&colon;&sol;&sol;links.test/NOISE~NOISE* retained\n\n[other]: /retained', [(7, 21), (34, 78), (89, 108)]),
    ('Retain [a*b][a&amp;b] [*retained ~https&colon;&sol;&sol;links.test/NOISE*NOISE~ retained\n\n[other]: /retained', [(7, 21), (34, 72), (89, 108)]),
    ('Retain [a*b][a\\[b] [~retained *https&colon;&sol;&sol;links.test/NOISE~NOISE* retained\n\n[a\\[b]: /retained', [(7, 18), (31, 75), (86, 104)]),
    ('Retain [a*b][a\\[b] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[a\\[b]: /retained', [(7, 18), (31, 60), (77, 95)]),
    ('Retain [a*b][a\\[b] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n[other]: /retained', [(7, 18), (31, 66), (77, 96)]),
    ('Retain [a*b][a\\[b] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[other]: /retained', [(7, 18), (31, 60), (77, 96)]),
    ('Retain [ref](/retained) [~retained *https://links.test/NOISE~NOISE* retained\n\n[ref]: /retained\n[ref]: /retained', [(11, 23), (36, 60), (77, 94), (95, 111)]),
    ('Retain [ref](/retained) [~retained *https&colon;&sol;&sol;links.test/NOISE~NOISE* retained\n\n[ref]: /retained\n[ref]: /retained', [(11, 23), (36, 74), (91, 108), (109, 125)]),
    ('Retain [ref](/retained "title") [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[ref]: /retained\n[ref]: /retained', [(11, 31), (44, 73), (90, 107), (108, 124)]),
    ('Retain [ref](/retained "unterminated [*retained ~https://links.test/NOISE*NOISE~ retained\n\n[ref]: /retained\n[ref]: /retained', [(49, 73), (90, 107), (108, 124)]),
    ('Retain [ref][ref] [~retained *https://links.test/NOISE~NOISE* retained\n\n[ref]: /retained\n[ref]: /retained', [(7, 17), (30, 54), (71, 88), (89, 105)]),
    ('Retain [ref][ref] [~retained *https&colon;&sol;&sol;links.test/NOISE~NOISE* retained\n\n[ref]: /retained\n[ref]: /retained', [(7, 17), (30, 68), (85, 102), (103, 119)]),
    ('Retain [ref][missing] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[ref]: /retained\n[ref]: /retained', [(7, 21), (34, 63), (80, 97), (98, 114)]),
    ('Retain [ref][] [*retained ~https://links.test/NOISE*NOISE~ retained\n\n[ref]: /retained\n[ref]: /retained', [(7, 14), (27, 51), (68, 85), (86, 102)]),
    ('Retain [ref][ [~retained *https://links.test/NOISE~NOISE* retained\n\n[ref]: /retained\n[ref]: /retained', [(26, 50), (67, 84), (85, 101)]),
    ('Retain [ref][ [~retained *https&colon;&sol;&sol;links.test/NOISE~NOISE* retained\n\n[ref]: /retained\n[ref]: /retained', [(26, 64), (81, 98), (99, 115)]),
    ('Retain [ref](/retained extra) [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[ref]: /retained\n[ref]: /retained', [(42, 71), (88, 105), (106, 122)]),
    ('Retain [a*b](/retained) [*retained ~https://links.test/NOISE*NOISE~ retained\n\n[a*b]: /retained\n[ref]: /retained', [(11, 23), (36, 60), (77, 94), (95, 111)]),
    ('Retain [a*b](/retained "title") [~retained *https://links.test/NOISE~NOISE* retained\n\n[a*b]: /retained\n[ref]: /retained', [(11, 31), (44, 74), (85, 102), (103, 119)]),
    ('Retain [a*b](/retained "title") [~retained *https&colon;&sol;&sol;links.test/NOISE~NOISE* retained\n\n[a*b]: /retained\n[ref]: /retained', [(11, 31), (44, 88), (99, 116), (117, 133)]),
    ('Retain [a*b](/retained "unterminated [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[a*b]: /retained\n[ref]: /retained', [(49, 78), (95, 112), (113, 129)]),
    ('Retain [a*b][ref] [*retained ~https://links.test/NOISE*NOISE~ retained\n\n[a*b]: /retained\n[ref]: /retained', [(7, 17), (30, 54), (71, 88), (89, 105)]),
    ('Retain [a*b][missing] [~retained *https://links.test/NOISE~NOISE* retained\n\n[a*b]: /retained\n[ref]: /retained', [(7, 21), (34, 64), (75, 92), (93, 109)]),
    ('Retain [a*b][missing] [~retained *https&colon;&sol;&sol;links.test/NOISE~NOISE* retained\n\n[a*b]: /retained\n[ref]: /retained', [(7, 21), (34, 78), (89, 106), (107, 123)]),
    ('Retain [a*b][] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[a*b]: /retained\n[ref]: /retained', [(7, 14), (27, 56), (73, 90), (91, 107)]),
    ('Retain [a*b][ [*retained ~https://links.test/NOISE*NOISE~ retained\n\n[a*b]: /retained\n[ref]: /retained', [(26, 50), (67, 84), (85, 101)]),
    ('Retain [a*b](/retained extra) [~retained *https://links.test/NOISE~NOISE* retained\n\n[a*b]: /retained\n[ref]: /retained', [(42, 72), (83, 100), (101, 117)]),
    ('Retain [a*b](/retained extra) [~retained *https&colon;&sol;&sol;links.test/NOISE~NOISE* retained\n\n[a*b]: /retained\n[ref]: /retained', [(42, 86), (97, 114), (115, 131)]),
    ('Retain [a~b](/retained) [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[a~b]: /retained\n[ref]: /retained', [(11, 23), (36, 71), (82, 99), (100, 116)]),
    ('Retain [a~b](/retained "title") [*retained ~https://links.test/NOISE*NOISE~ retained\n\n[a~b]: /retained\n[ref]: /retained', [(11, 31), (44, 74), (85, 102), (103, 119)]),
    ('Retain [a~b](/retained "unterminated [~retained *https://links.test/NOISE~NOISE* retained\n\n[a~b]: /retained\n[ref]: /retained', [(49, 73), (90, 107), (108, 124)]),
    ('Retain [a~b](/retained "unterminated [~retained *https&colon;&sol;&sol;links.test/NOISE~NOISE* retained\n\n[a~b]: /retained\n[ref]: /retained', [(49, 87), (104, 121), (122, 138)]),
    ('Retain [a~b][ref] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[a~b]: /retained\n[ref]: /retained', [(7, 17), (30, 65), (76, 93), (94, 110)]),
    ('Retain [a~b][missing] [*retained ~https://links.test/NOISE*NOISE~ retained\n\n[a~b]: /retained\n[ref]: /retained', [(7, 21), (34, 64), (75, 92), (93, 109)]),
    ('Retain [a~b][] [~retained *https://links.test/NOISE~NOISE* retained\n\n[a~b]: /retained\n[ref]: /retained', [(7, 14), (27, 51), (68, 85), (86, 102)]),
    ('Retain [a~b][] [~retained *https&colon;&sol;&sol;links.test/NOISE~NOISE* retained\n\n[a~b]: /retained\n[ref]: /retained', [(7, 14), (27, 65), (82, 99), (100, 116)]),
    ('Retain [a~b][ [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[a~b]: /retained\n[ref]: /retained', [(26, 61), (72, 89), (90, 106)]),
    ('Retain [a~b](/retained extra) [*retained ~https://links.test/NOISE*NOISE~ retained\n\n[a~b]: /retained\n[ref]: /retained', [(42, 72), (83, 100), (101, 117)]),
    ('Retain [a*b][ref] [~retained *https://links.test/NOISE~NOISE* retained\n\n`[ref]: /retained`', [(7, 17), (30, 60), (72, 90)]),
    ('Retain [a*b][ref] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n`[ref]: /retained`', [(7, 17), (30, 65), (77, 95)]),
    ('Retain [a*b][ref] [~retained *https&colon;&sol;&sol;links.test/NOISE~NOISE* retained\n\n`[ref]: /retained`', [(7, 17), (30, 74), (86, 104)]),
    ('Retain [a*b][ref] [*retained ~https://links.test/NOISE*NOISE~ retained\n\n`[ref]: /retained`', [(7, 17), (30, 54), (72, 90)]),
    ('Retain [a*b][ref] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n`[ref]: /retained`', [(7, 17), (30, 59), (77, 95)]),
    ('Retain [a*b][ref] [*retained ~https&colon;&sol;&sol;links.test/NOISE*NOISE~ retained\n\n`[ref]: /retained`', [(7, 17), (30, 68), (86, 104)]),
    ('Retain [a*b][ref] [~retained *https://links.test/NOISE~NOISE* retained\n\n```text\n[ref]: /retained\n```', [(7, 17), (30, 60), (72, 100)]),
    ('Retain [a*b][ref] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n```text\n[ref]: /retained\n```', [(7, 17), (30, 65), (77, 105)]),
    ('Retain [a*b][ref] [~retained *https&colon;&sol;&sol;links.test/NOISE~NOISE* retained\n\n```text\n[ref]: /retained\n```', [(7, 17), (30, 74), (86, 114)]),
    ('Retain [a*b][ref] [*retained ~https://links.test/NOISE*NOISE~ retained\n\n```text\n[ref]: /retained\n```', [(7, 17), (30, 54), (72, 100)]),
    ('Retain [a*b][ref] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n```text\n[ref]: /retained\n```', [(7, 17), (30, 59), (77, 105)]),
    ('Retain [a*b][ref] [*retained ~https&colon;&sol;&sol;links.test/NOISE*NOISE~ retained\n\n```text\n[ref]: /retained\n```', [(7, 17), (30, 68), (86, 114)]),
    ('Retain [a*b][ref] [~retained *https://links.test/NOISE~NOISE* retained\n\n$[ref]: /retained$', [(7, 17), (30, 60), (72, 90)]),
    ('Retain [a*b][ref] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n$[ref]: /retained$', [(7, 17), (30, 65), (77, 95)]),
    ('Retain [a*b][ref] [~retained *https&colon;&sol;&sol;links.test/NOISE~NOISE* retained\n\n$[ref]: /retained$', [(7, 17), (30, 74), (86, 104)]),
    ('Retain [a*b][ref] [*retained ~https://links.test/NOISE*NOISE~ retained\n\n$[ref]: /retained$', [(7, 17), (30, 54), (72, 90)]),
    ('Retain [a*b][ref] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n$[ref]: /retained$', [(7, 17), (30, 59), (77, 95)]),
    ('Retain [a*b][ref] [*retained ~https&colon;&sol;&sol;links.test/NOISE*NOISE~ retained\n\n$[ref]: /retained$', [(7, 17), (30, 68), (86, 104)]),
    ('Retain [a*b][ref] [~retained *https://links.test/NOISE~NOISE* retained\n\n<!--\n[ref]: /retained\n-->', [(7, 17), (30, 60), (72, 97)]),
    ('Retain [a*b][ref] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n<!--\n[ref]: /retained\n-->', [(7, 17), (30, 65), (77, 102)]),
    ('Retain [a*b][ref] [~retained *https&colon;&sol;&sol;links.test/NOISE~NOISE* retained\n\n<!--\n[ref]: /retained\n-->', [(7, 17), (30, 74), (86, 111)]),
    ('Retain [a*b][ref] [*retained ~https://links.test/NOISE*NOISE~ retained\n\n<!--\n[ref]: /retained\n-->', [(7, 17), (30, 54), (72, 97)]),
    ('Retain [a*b][ref] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n<!--\n[ref]: /retained\n-->', [(7, 17), (30, 59), (77, 102)]),
    ('Retain [a*b][ref] [*retained ~https&colon;&sol;&sol;links.test/NOISE*NOISE~ retained\n\n<!--\n[ref]: /retained\n-->', [(7, 17), (30, 68), (86, 111)]),
    ('Retain [a*b][rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n[rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr]: /retained', [(7, 1012), (1025, 1060), (1071, 2083)]),
    ('Retain ![a*b][rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n[rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr]: /retained', [(7, 1013), (1026, 1061), (1072, 2084)]),
    ('Retain [a*b][rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr]: /retained', [(7, 1012), (1025, 1054), (1071, 2083)]),
    ('Retain ![a*b][rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr]: /retained', [(7, 1013), (1026, 1055), (1072, 2084)]),
    ('Retain [a*b][rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n[rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr]: /retained', [(7, 1013), (1026, 1061), (1072, 2085)]),
    ('Retain ![a*b][rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n[rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr]: /retained', [(7, 1014), (1027, 1062), (1073, 2086)]),
    ('Retain [a*b][rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr]: /retained', [(7, 1013), (1026, 1055), (1072, 2085)]),
    ('Retain ![a*b][rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr]: /retained', [(7, 1014), (1027, 1056), (1073, 2086)]),
    ('Retain [a*b][rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n[rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr]: /retained', [(7, 1014), (1027, 1062), (1073, 2087)]),
    ('Retain ![a*b][rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n[rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr]: /retained', [(7, 1015), (1028, 1063), (1074, 2088)]),
    ('Retain [a*b][rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr]: /retained', [(7, 1014), (1027, 1056), (1073, 2087)]),
    ('Retain ![a*b][rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr]: /retained', [(7, 1015), (1028, 1057), (1074, 2088)]),
    ('[ref]: /retained\nRetain [a*b][ref] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(0, 16), (24, 34), (47, 82)]),
    ('> [ref]: /retained\nRetain [a*b][ref] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(0, 18), (26, 36), (49, 84)]),
    ('[ref]: /retained "title"\nRetain [a*b][ref] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(0, 24), (32, 42), (55, 90)]),
    ('> [ref]: /retained "title"\nRetain [a*b][ref] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(0, 26), (34, 44), (57, 92)]),
    ('[ref]: <a b>\nRetain [a*b][ref] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(0, 12), (20, 30), (43, 78)]),
    ('> [ref]: <a b>\nRetain [a*b][ref] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(0, 14), (22, 32), (45, 80)]),
    ('[ref]: <>\nRetain [a*b][ref] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(0, 9), (17, 27), (40, 75)]),
    ('> [ref]: <>\nRetain [a*b][ref] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(0, 11), (19, 29), (42, 77)]),
    ('[ref]: a(b)c\nRetain [a*b][ref] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(0, 12), (20, 30), (43, 78)]),
    ('> [ref]: a(b)c\nRetain [a*b][ref] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(0, 14), (22, 32), (45, 80)]),
    ('[ref]: a\\)b\nRetain [a*b][ref] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(0, 11), (19, 29), (42, 77)]),
    ('> [ref]: a\\)b\nRetain [a*b][ref] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(0, 13), (21, 31), (44, 79)]),
    ('[ref]: a(b\nRetain [a*b][ref] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(0, 10), (18, 28), (41, 76)]),
    ('> [ref]: a(b\nRetain [a*b][ref] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(20, 30), (43, 78)]),
    ('[ref]: a)b\nRetain [a*b][ref] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(0, 10), (18, 28), (41, 76)]),
    ('> [ref]: a)b\nRetain [a*b][ref] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(20, 30), (43, 78)]),
    ('[ref]: <unfinished\nRetain [a*b][ref] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(0, 18), (26, 36), (49, 84)]),
    ('> [ref]: <unfinished\nRetain [a*b][ref] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(28, 38), (51, 86)]),
    ('[ref]: /retained extra\nRetain [a*b][ref] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(0, 22), (30, 40), (53, 88)]),
    ('> [ref]: /retained extra\nRetain [a*b][ref] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(32, 42), (55, 90)]),
    ('[ref]: /retained"title"\nRetain [a*b][ref] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(0, 23), (31, 41), (54, 89)]),
    ('> [ref]: /retained"title"\nRetain [a*b][ref] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(0, 25), (33, 43), (56, 91)]),
    ('[ref]: /retained "unterminated\nRetain [a*b][ref] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(0, 30), (38, 48), (61, 96)]),
    ('> [ref]: /retained "unterminated\nRetain [a*b][ref] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(40, 50), (63, 98)]),
    ('[ref]: /retained "~*"\nRetain [a*b][ref] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(0, 21), (29, 39), (52, 87)]),
    ('> [ref]: /retained "~*"\nRetain [a*b][ref] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(0, 23), (31, 41), (54, 89)]),
    ('[ref]: /retained`\nRetain [a*b][ref] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(0, 17), (25, 35), (48, 83)]),
    ('> [ref]: /retained`\nRetain [a*b][ref] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(0, 19), (27, 37), (50, 85)]),
    ('[ref]: /retained<em>\nRetain [a*b][ref] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(0, 20), (28, 38), (51, 86)]),
    ('> [ref]: /retained<em>\nRetain [a*b][ref] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(0, 22), (30, 40), (53, 88)]),
    ('[ref]: /retained$\nRetain [a*b][ref] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(0, 17), (25, 35), (48, 83)]),
    ('> [ref]: /retained$\nRetain [a*b][ref] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained', [(0, 19), (27, 37), (50, 85)]),
    ('Retain [a*b][a\\[b] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n[a\\[b]: /retained', [(7, 18), (31, 66), (77, 95)]),
    ('Retain [a\\[b] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n[a\\[b]: /retained', [(26, 55), (72, 90)]),
    ('Retain [a*b][a\\]b] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n[a\\]b]: /retained', [(7, 16), (31, 66), (78, 95)]),
    ('Retain [a\\]b] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n[a\\]b]: /retained', [(26, 55), (73, 90)]),
    ('Retain [a*b][a\\]b] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[a\\]b]: /retained', [(7, 16), (31, 60), (78, 95)]),
    ('Retain [a*b][a\\\\b] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n[a\\\\b]: /retained', [(7, 18), (31, 66), (77, 95)]),
    ('Retain [a\\\\b] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n[a\\\\b]: /retained', [(26, 55), (72, 90)]),
    ('Retain [a\\\\b] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[a\\\\b]: /retained', [(26, 55), (72, 90)]),
    ('Retain [a&amp;b] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n[a&amp;b]: /retained', [(29, 58), (75, 96)]),
    ('Retain [a&amp;b] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[a&amp;b]: /retained', [(29, 58), (75, 96)]),
    ('Retain [a*b][a&b] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n[a&b]: /retained', [(7, 17), (30, 65), (76, 93)]),
    ('Retain [a&b] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n[a&b]: /retained', [(25, 54), (71, 88)]),
    ('Retain [a&b] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[a&b]: /retained', [(25, 54), (71, 88)]),
    ('Retain [a*b][a b] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n[a b]: /retained', [(7, 17), (30, 65), (76, 93)]),
    ('Retain [a*b][a b] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[a b]: /retained', [(7, 17), (30, 59), (76, 93)]),
    ('Retain [a b] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[a b]: /retained', [(25, 54), (71, 88)]),
    ('Retain [a*b][a\tb] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n[a\tb]: /retained', [(7, 17), (30, 65), (76, 93)]),
    ('Retain [a*b][a\tb] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[a\tb]: /retained', [(7, 17), (30, 59), (76, 93)]),
    ('Retain [a\tb] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[a\tb]: /retained', [(25, 54), (71, 88)]),
    ('Retain [a*b][\xa0ref] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n[\xa0ref]: /retained', [(7, 18), (31, 66), (77, 95)]),
    ('Retain [a*b][\xa0ref] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[\xa0ref]: /retained', [(7, 18), (31, 60), (77, 95)]),
    ('Retain [\xa0ref] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[\xa0ref]: /retained', [(26, 55), (72, 90)]),
    ('Retain [ref\xa0] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n[ref\xa0]: /retained', [(26, 55), (72, 90)]),
    ('Retain [a*b][ref\xa0] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[ref\xa0]: /retained', [(7, 18), (31, 60), (77, 95)]),
    ('Retain [ref\xa0] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[ref\xa0]: /retained', [(26, 55), (72, 90)]),
    ('Retain [🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪r] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n[🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪r]: /retained', [(522, 551), (568, 1082)]),
    ('Retain [a*b][🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪r] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪r]: /retained', [(7, 514), (527, 556), (573, 1087)]),
    ('Retain [🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪r] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪r]: /retained', [(522, 551), (568, 1082)]),
    ('Retain [🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪] [~retained *h&#116;tps://links.test/NOISE~NOISE* retained\n\n[🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪]: /retained', [(522, 551), (568, 1082)]),
    ('Retain [a*b][🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪] [*retained ~h&#116;tps://links.test/NOISE*NOISE~ retained\n\n[🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪]: /retained', [(7, 514), (527, 556), (573, 1087)]),
    ('[ref]: /retained`\n\nRetain `NOISE` NOISE retained', [(0, 17), (26, 33)]),
    ('[ref]: /retained`\r\n\r\nRetain `NOISE` NOISE retained', [(0, 17), (28, 35)]),
    ('[ref]: /retained<em x="`">\n\nRetain `NOISE` NOISE retained', [(35, 42)]),
    ('[ref]: /retained<em x="`">\r\n\r\nRetain `NOISE` NOISE retained', [(37, 44)]),
    ('[ref]: /retained<!--\n\nRetain `NOISE` NOISE retained', [(0, 20), (29, 36)]),
    ('[ref]: /retained<!--\r\n\r\nRetain `NOISE` NOISE retained', [(0, 20), (31, 38)]),
    ('[ref]: /retained$\n\nRetain `NOISE` NOISE retained', [(0, 17), (26, 33)]),
    ('[ref]: /retained$\r\n\r\nRetain `NOISE` NOISE retained', [(0, 17), (28, 35)]),
    ('[ref]: /retained[\n\nRetain `NOISE` NOISE retained', [(0, 17), (26, 33)]),
    ('[ref]: /retained[\r\n\r\nRetain `NOISE` NOISE retained', [(0, 17), (28, 35)]),
    ('[ref]: /retained~*\n\nRetain `NOISE` NOISE retained', [(0, 18), (27, 34)]),
    ('[ref]: /retained~*\r\n\r\nRetain `NOISE` NOISE retained', [(0, 18), (29, 36)]),
], ids=[f"reference-{index}" for index in range(238)])
def test_reference_label_registration_preserves_fallback_text_boundaries(source, expected_ranges):
    assert protected_ranges(source) == expected_ranges

# Installed native GFM token/render spans plus the existing reference/asset policy.
@pytest.mark.parametrize("source,expected_ranges", [
    ('合成 🧪\n\nRetain www.links.test/NOISE NOISE retained', [(13, 33)]),
    ('合成 🧪\n\nRetain ![www.links.test/NOISE]NOISE retained', [(15, 41)]),
    ('合成 🧪\r\n\r\nRetain 9www.links.test/NOISE`NOISE` NOISE retained', [(36, 43)]),
    ('合成 🧪\n\nRetain *www.links.test/NOISE`NOISE` NOISE retained', [(14, 41)]),
    ('合成 🧪\r\n\r\nRetain ~~www.links.test/NOISE<em>NOISE</em> retained', [(17, 37)]),
    ('合成 🧪\r\n\r\nRetain &#97;www.links.test/NOISE~NOISE retained', []),
    ('合成 🧪\n\nRetain \\[www.links.test/NOISE~NOISE retained', [(15, 41)]),
    ('合成 🧪\r\n\r\nRetain [WWW.links.test/NOISE*NOISE retained', [(16, 42)]),
    ('合成 🧪\n\nRetain aWWW.links.test/NOISE*NOISE retained', []),
    ('合成 🧪\n\nRetain /WWW.links.test/NOISE NOISE retained', [(14, 34)]),
    ('合成 🧪\r\n\r\nRetain **WWW.links.test/NOISE]NOISE retained', [(17, 43)]),
    ('合成 🧪\n\nRetain 漢字WWW.links.test/NOISE]NOISE retained', []),
    ('合成 🧪\r\n\r\nRetain &#47;WWW.links.test/NOISE`NOISE` NOISE retained', [(20, 47)]),
    ('合成 🧪\r\n\r\nRetain [retained](/keep) WWW.links.test/NOISE<em>NOISE</em> retained', [(24, 32), (33, 53)]),
    ('合成 🧪\n\nRetain ![w&#119;w.links.test/NOISE<em>NOISE</em> retained', [(15, 40)]),
    ('合成 🧪\r\n\r\nRetain 9w&#119;w.links.test/NOISE~NOISE retained', []),
    ('合成 🧪\n\nRetain *w&#119;w.links.test/NOISE~NOISE retained', [(14, 45)]),
    ('合成 🧪\n\nRetain ~~w&#119;w.links.test/NOISE*NOISE retained', [(15, 46)]),
    ('合成 🧪\r\n\r\nRetain &#97;w&#119;w.links.test/NOISE NOISE retained', []),
    ('合成 🧪\n\nRetain \\[w&#119;w.links.test/NOISE NOISE retained', [(15, 40)]),
    ('合成 🧪\r\n\r\nRetain &#119;&#x57;w&period;links.test/NOISE]NOISE retained', [(15, 58)]),
    ('合成 🧪\n\nRetain (&#119;&#x57;w&period;links.test/NOISE]NOISE retained', [(14, 57)]),
    ('合成 🧪\n\nRetain _&#119;&#x57;w&period;links.test/NOISE`NOISE` NOISE retained', [(14, 58)]),
    ('合成 🧪\r\n\r\nRetain **&#119;&#x57;w&period;links.test/NOISE<em>NOISE</em> retained', [(17, 54)]),
    ('合成 🧪\n\nRetain 漢字&#119;&#x57;w&period;links.test/NOISE<em>NOISE</em> retained', []),
    ('合成 🧪\r\n\r\nRetain &#47;&#119;&#x57;w&period;links.test/NOISE~NOISE retained', [(20, 63)]),
    ('合成 🧪\r\n\r\nRetain [retained](/keep) &#119;&#x57;w&period;links.test/NOISE*NOISE retained', [(24, 32), (33, 76)]),
    ('合成 🧪\n\nRetain ![NOISE@links.test*NOISE retained', [(15, 31)]),
    ('合成 🧪\r\n\r\nRetain 9NOISE@links.test NOISE retained', [(15, 32)]),
    ('合成 🧪\n\nRetain *NOISE@links.test NOISE retained', [(14, 30)]),
    ('合成 🧪\n\nRetain ~NOISE@links.test]NOISE retained', [(14, 30)]),
    ('合成 🧪\r\n\r\nRetain 🧪NOISE@links.test`NOISE` NOISE retained', [(16, 39)]),
    ('合成 🧪\n\nRetain &ast;NOISE@links.test`NOISE` NOISE retained', [(18, 41)]),
    ('合成 🧪\r\n\r\nRetain NOISE&commat;links.test<em>NOISE</em> retained', [(15, 38)]),
    ('合成 🧪\r\n\r\nRetain (NOISE&commat;links.test~NOISE retained', [(16, 39)]),
    ('合成 🧪\n\nRetain _NOISE&commat;links.test~NOISE retained', [(13, 37)]),
    ('合成 🧪\r\n\r\nRetain **NOISE&commat;links.test*NOISE retained', [(17, 40)]),
    ('合成 🧪\n\nRetain 漢字NOISE&commat;links.test*NOISE retained', []),
    ('合成 🧪\n\nRetain &#47;NOISE&commat;links.test NOISE retained', []),
    ('合成 🧪\r\n\r\nRetain \\[NOISE&commat;links.test]NOISE retained', [(17, 40)]),
    ('合成 🧪\n\nRetain [NOISE&#64;links.test]NOISE retained', [(14, 34)]),
    ('合成 🧪\r\n\r\nRetain aNOISE&#64;links.test`NOISE` NOISE retained', [(15, 43)]),
    ('合成 🧪\n\nRetain /NOISE&#64;links.test`NOISE` NOISE retained', [(34, 41)]),
    ('合成 🧪\n\nRetain ~NOISE&#64;links.test<em>NOISE</em> retained', [(14, 34)]),
    ('合成 🧪\r\n\r\nRetain 🧪NOISE&#64;links.test~NOISE retained', []),
    ('合成 🧪\n\nRetain &ast;NOISE&#64;links.test~NOISE retained', [(18, 38)]),
    ('合成 🧪\r\n\r\nRetain &fjlig;NOISE@links.test*NOISE retained', [(22, 38)]),
    ('合成 🧪\r\n\r\nRetain (&fjlig;NOISE@links.test NOISE retained', [(23, 39)]),
    ('合成 🧪\n\nRetain _&fjlig;NOISE@links.test NOISE retained', [(21, 37)]),
    ('合成 🧪\r\n\r\nRetain *&fjlig;NOISE@links.test]NOISE retained', [(23, 39)]),
    ('合成 🧪\n\nRetain ~~&fjlig;NOISE@links.test]NOISE retained', [(22, 38)]),
    ('合成 🧪\n\nRetain &#97;&fjlig;NOISE@links.test`NOISE` NOISE retained', [(25, 48)]),
    ('合成 🧪\r\n\r\nRetain \\[&fjlig;NOISE@links.test<em>NOISE</em> retained', [(24, 40)]),
    ('合成 🧪\n\nRetain [https://links.test/NOISE<em>NOISE</em> retained', [(14, 38)]),
    ('合成 🧪\r\n\r\nRetain ahttps://links.test/NOISE~NOISE retained', []),
    ('合成 🧪\r\n\r\nRetain /https://links.test/NOISE*NOISE retained', [(16, 46)]),
    ('合成 🧪\n\nRetain ~https://links.test/NOISE*NOISE retained', [(14, 44)]),
    ('合成 🧪\r\n\r\nRetain 🧪https://links.test/NOISE NOISE retained', [(16, 40)]),
    ('合成 🧪\n\nRetain &ast;https://links.test/NOISE NOISE retained', [(18, 42)]),
    ('合成 🧪\r\n\r\nRetain [retained](/keep) https://links.test/NOISE]NOISE retained', [(24, 32), (33, 63)]),
    ('Retain www./NOISENOISE retained', [(7, 22)]),
    ('Retain ~w&#119;w./NOISE~NOISE retained', [(8, 23)]),
    ('Retain *w&#119;w../NOISE*NOISE retained', [(8, 24)]),
    ('Retain [w&#119;w.links/NOISE[NOISE retained', [(8, 34)]),
    ('Retain w&#119;w.links.test/NOISENOISE retained', [(7, 37)]),
    ('Retain ~www.links.test./NOISE~NOISE retained', [(8, 35)]),
    ('Retain *www._bad.test/NOISE*NOISE retained', []),
    ('Retain [www.links._test/NOISE[NOISE retained', []),
    ('Retain www.first_bad.links.test/NOISENOISE retained', [(7, 42)]),
    ('Retain ~w&#119;w.first_bad.links.test/NOISE~NOISE retained', [(8, 43)]),
    ('Retain ~w&#119;w.链接.测试/NOISE~NOISE retained', [(8, 28)]),
    ('Retain *w&#119;w.🧪.test/NOISE*NOISE retained', [(8, 29)]),
    ('Retain [w&#119;w.-links.test/NOISE[NOISE retained', [(8, 40)]),
    ('Retain w&#119;w.links.tes0/NOISENOISE retained', [(7, 37)]),
    ('Retain ~www.foo..test/NOISE~NOISE retained', [(8, 33)]),
    ('Retain *www.www/NOISE*NOISE retained', [(8, 27)]),
    ('Retain [www.www./NOISE[NOISE retained', [(8, 28)]),
    ('Retain www.foo+bar.test/NOISENOISE retained', [(7, 34)]),
    ('Retain ~w&#119;w.foo+bar.test/NOISE~NOISE retained', [(8, 35)]),
    ('Retain ~w&#119;w.foo~bar.test/NOISE~NOISE retained', [(8, 20)]),
    ('Retain NOISE@links.test NOISE retained', [(7, 23)]),
    ('Retain [NOISE@links.test- NOISE retained', []),
    ('Retain NOISE&commat;links..test NOISE retained', []),
    ('Retain [NOISE&commat;links.-test NOISE retained', [(8, 32)]),
    ('Retain +NOISE@links.test NOISE retained', [(7, 24)]),
    ('Retain +NOISE&commat;links.test- NOISE retained', []),
    ('Retain [+NOISE&commat;links..test NOISE retained', []),
    ('Retain +NOISE@links._test NOISE retained', [(7, 25)]),
    ('Retain [-NOISE@links.test NOISE retained', [(8, 25)]),
    ('Retain -NOISE&commat;links.test- NOISE retained', []),
    ('Retain -NOISE@.links NOISE retained', [(7, 20)]),
    ('Retain [-NOISE@links._test NOISE retained', [(8, 26)]),
    ('Retain .NOISE&commat;links.test NOISE retained', [(7, 31)]),
    ('Retain [.NOISE&commat;links.test- NOISE retained', []),
    ('Retain .NOISE@.links NOISE retained', [(7, 20)]),
    ('Retain .NOISE&commat;links._test NOISE retained', [(7, 32)]),
    ('Retain [_NOISE&commat;links.test NOISE retained', [(8, 32)]),
    ('Retain _NOISE@links.test0 NOISE retained', []),
    ('Retain [_NOISE@.links NOISE retained', []),
    ('Retain _NOISE&commat;links._test NOISE retained', [(7, 32)]),
    ('Retain a.NOISE@links.t0 NOISE retained', []),
    ('Retain [a.NOISE@links.test0 NOISE retained', []),
    ('Retain a.NOISE&commat;.links NOISE retained', []),
    ('Retain [a.NOISE&commat;links._test NOISE retained', [(8, 34)]),
    ('Retain a+NOISE@links.t0 NOISE retained', []),
    ('Retain a+NOISE&commat;links.test0 NOISE retained', []),
    ('Retain [a+NOISE&commat;.links NOISE retained', []),
    ('Retain a+NOISE@links.test._next NOISE retained', [(7, 25)]),
    ('Retain [a--NOISE@links.t0 NOISE retained', []),
    ('Retain a--NOISE&commat;links.test0 NOISE retained', []),
    ('Retain a--NOISE@_links.test NOISE retained', [(7, 27)]),
    ('Retain [a--NOISE@links.test._next NOISE retained', [(8, 33)]),
    ('Retain NOISE...&commat;links.t0 NOISE retained', []),
    ('Retain [NOISE...&commat;links.test0 NOISE retained', []),
    ('Retain NOISE...@_links.test NOISE retained', [(7, 27)]),
    ('Retain NOISE...&commat;links.test._next NOISE retained', [(7, 39)]),
    ('Retain [NOISE!&commat;links.t0 NOISE retained', []),
    ('Retain NOISE!@links.测试 NOISE retained', []),
    ('Retain [NOISE!@_links.test NOISE retained', []),
    ('Retain NOISE!&commat;links.test._next NOISE retained', []),
    ('Retain NOISE/@links.test_ NOISE retained', []),
    ('Retain [NOISE/@links.测试 NOISE retained', []),
    ('Retain NOISE/&commat;_links.test NOISE retained', []),
    ('Retain [NOISE/&commat;links.test._next NOISE retained', []),
    ('Retain 汉字NOISE@links.test_ NOISE retained', []),
    ('Retain 汉字NOISE&commat;links.测试 NOISE retained', []),
    ('Retain [汉字NOISE&commat;_links.test NOISE retained', []),
    ('Retain 汉字NOISE@links.test.@again.test NOISE retained', [(9, 37)]),
    ('Retain [🧪NOISE@links.test_ NOISE retained', []),
    ('Retain 🧪NOISE&commat;links.测试 NOISE retained', []),
    ('Retain 🧪NOISE@links.-test NOISE retained', []),
    ('Retain [🧪NOISE@links.test.@again.test NOISE retained', [(15, 37)]),
    ('Retain &#78;OISE&commat;links.test_ NOISE retained', []),
    ('Retain [&#78;OISE&commat;links.测试 NOISE retained', []),
    ('Retain &#78;OISE@links.-test NOISE retained', [(7, 28)]),
    ('Retain &#78;OISE&commat;links.test.@again.test NOISE retained', [(24, 46)]),
    ('Retain [\\+NOISE&commat;links.test_ NOISE retained', []),
    ('Retain \\+NOISE@links..test NOISE retained', []),
    ('Retain [\\+NOISE@links.-test NOISE retained', [(8, 27)]),
    ('Retain [\\+NOISE&commat;links.test.@again.test NOISE retained', [(8, 33)]),
    ('合成 🧪\n\nwww.links.test/`NOISE keep` NOISE', [(6, 27)]),
    ('合成 🧪\n\n> www.links.test/`NOISE keep` NOISE', [(8, 29)]),
    ('合成 🧪\n\n\\[www.links.test/<em x="`">tail`NOISE retained', [(8, 23)]),
    ('合成 🧪\n\n[www.links.test/\\<em x="`">NOISE `NOISE`', [(7, 26), (30, 40)]),
    ('合成 🧪\n\nNOISE@links.test`NOISE`', [(6, 29)]),
    ('合成 🧪\n\n> NOISE@links.test`NOISE`', [(8, 31)]),
    ('合成 🧪\n\n\\[www.links.test@NOISE.test', [(8, 33)]),
    ('合成 🧪\n\n[_www.links.test@NOISE.test0', [(8, 34)]),
    ('合成 🧪\n\nhttp://links.test/NOISE@else.test', [(6, 39)]),
    ('合成 🧪\n\n> http://links.test/NOISE@else.test', [(8, 41)]),
    ('合成 🧪\n\n\\[https://NOISE@links.test/retained', [(8, 41)]),
    ('合成 🧪\n\n[www.links.test/NOISE@else.test', [(7, 37)]),
    ('合成 🧪\n\nNOISE@www.links.test/NOISE', [(6, 26)]),
    ('合成 🧪\n\n> NOISE@www.links.test/NOISE', [(8, 28)]),
    ('合成 🧪\n\n\\[NOISE@links.test@NOISE.test', [(8, 24)]),
    ('合成 🧪\n\n[漢字.foo.NOISE@links.test', [(10, 30)]),
    ('合成 🧪\n\n/a.NOISE@links.test', [(9, 25)]),
    ('合成 🧪\n\n> /a.NOISE@links.test', [(11, 27)]),
    ('合成 🧪\n\n\\[&sol;a.NOISE&commat;links.test', [(15, 38)]),
    ('合成 🧪\n\n[x@links.test0.NOISE@other.test', [(7, 26)]),
    ('合成 🧪\n\n[www.links.test/`NOISE keep` NOISE](/retained)', [(22, 34), (40, 52)]),
    ('合成 🧪\n\n> [www.links.test/`NOISE keep` NOISE](/retained)', [(24, 36), (42, 54)]),
    ('合成 🧪\n\n\\[[a](www.links.test/NOISE "NOISE")', [(10, 41)]),
    ('合成 🧪\n\n[[NOISE@links.test](/retained)', [(24, 36)]),
    ('合成 🧪\n\n`www.links.test/NOISE` NOISE', [(6, 28)]),
    ('合成 🧪\n\n> `www.links.test/NOISE` NOISE', [(8, 30)]),
    ('合成 🧪\n\n\\[$NOISE@links.test$ NOISE', [(8, 26)]),
    ('合成 🧪\n\n[<em x="www.links.test/NOISE">NOISE</em>', []),
    ('合成 🧪\n\n<!--NOISE@links.test--> NOISE', [(6, 35)]),
    ('合成 🧪\n\n> <!--NOISE@links.test--> NOISE', [(6, 37)]),
    ('合成 🧪\n\n\\[![NOISE@links.test](attachment://retained) NOISE', [(7, 50)]),
    ('合成 🧪\n\n[www.links.test/NOISE)NOISE@else.test', [(7, 43)]),
    ('合成 🧪\n\n[https://bad_domain.test/www.links.test/NOISE NOISE', [(31, 51)]),
    ('合成 🧪\n\n> [https://bad_domain.test/www.links.test/NOISE NOISE', [(33, 53)]),
    ('合成 🧪\n\n\\[www.links.test/NOISE&amp;NOISE@else.test', [(8, 48)]),
    ('合成 🧪\n\n[NOISE@links.test\\_NOISE', [(7, 30)]),
    ('合成 🧪\n\nNOISE@links.test&amp;NOISE@else.test', [(6, 22), (27, 42)]),
    ('合成 🧪\r\n\r\n> NOISE@links.test&amp;NOISE@else.test', [(10, 26), (31, 46)]),
    ('Retain [~retained *www.links.test/NOISE~NOISE* retained\n\n[ref]: /retained', [(19, 39), (56, 73)]),
    ('Retain [*www.links.test/NOISE*NOISE retained\n\n[ref]: /retained', [(9, 29), (45, 62)]),
    ('Retain [**www.links.test/NOISE**NOISE retained\n\n[ref]: /retained', [(10, 30), (47, 64)]),
    ('Retain [a*b][ref] [~retained *www.links.test/NOISE~NOISE* retained\n\n[ref]: /retained', [(7, 17), (30, 56), (67, 84)]),
    ('Retain [~retained *WWW.links.test/NOISE~NOISE* retained\n\n[ref]: /retained', [(19, 39), (56, 73)]),
    ('Retain [*WWW.links.test/NOISE*NOISE retained\n\n[ref]: /retained', [(9, 29), (45, 62)]),
    ('Retain [**WWW.links.test/NOISE**NOISE retained\n\n[ref]: /retained', [(10, 30), (47, 64)]),
    ('Retain [a*b][ref] [~retained *WWW.links.test/NOISE~NOISE* retained\n\n[ref]: /retained', [(7, 17), (30, 56), (67, 84)]),
    ('Retain [~retained *w&#119;w.links.test/NOISE~NOISE* retained\n\n[ref]: /retained', [(19, 44), (61, 78)]),
    ('Retain [*w&#119;w.links.test/NOISE*NOISE retained\n\n[ref]: /retained', [(9, 34), (50, 67)]),
    ('Retain [**w&#119;w.links.test/NOISE**NOISE retained\n\n[ref]: /retained', [(10, 35), (52, 69)]),
    ('Retain [a*b][ref] [~retained *w&#119;w.links.test/NOISE~NOISE* retained\n\n[ref]: /retained', [(7, 17), (30, 61), (72, 89)]),
    ('Retain [~retained *&#119;&#x57;w&period;links.test/NOISE~NOISE* retained\r\n\r\n[ref]: /retained', [(19, 56), (74, 92)]),
    ('Retain [*&#119;&#x57;w&period;links.test/NOISE*NOISE retained\r\n\r\n[ref]: /retained', [(9, 46), (63, 81)]),
    ('Retain [**&#119;&#x57;w&period;links.test/NOISE**NOISE retained\r\n\r\n[ref]: /retained', [(10, 47), (65, 83)]),
    ('Retain [a*b][ref] [~retained *&#119;&#x57;w&period;links.test/NOISE~NOISE* retained\r\n\r\n[ref]: /retained', [(7, 17), (30, 73), (85, 103)]),
    ('Retain [~retained *NOISE@links.test~NOISE* retained\r\n\r\n[ref]: /retained', [(19, 35), (53, 71)]),
    ('Retain [*NOISE@links.test*NOISE retained\r\n\r\n[ref]: /retained', [(9, 25), (42, 60)]),
    ('Retain [**NOISE@links.test**NOISE retained\r\n\r\n[ref]: /retained', [(10, 26), (44, 62)]),
    ('Retain [a*b][ref] [~retained *NOISE@links.test~NOISE* retained\r\n\r\n[ref]: /retained', [(7, 17), (30, 46), (64, 82)]),
    ('Retain [~retained *NOISE&commat;links.test~NOISE* retained\r\n\r\n[ref]: /retained', [(19, 42), (60, 78)]),
    ('Retain [*NOISE&commat;links.test*NOISE retained\r\n\r\n[ref]: /retained', [(9, 32), (49, 67)]),
    ('Retain [**NOISE&commat;links.test**NOISE retained\r\n\r\n[ref]: /retained', [(10, 33), (51, 69)]),
    ('Retain [a*b][ref] [~retained *NOISE&commat;links.test~NOISE* retained\r\n\r\n[ref]: /retained', [(7, 17), (30, 53), (71, 89)]),
    ('Retain [*retained ~NOISE&#64;links.test*NOISE~ retained\n\n[ref]: /retained', [(19, 39), (56, 73)]),
    ('Retain [~NOISE&#64;links.test~NOISE retained\n\n[ref]: /retained', [(9, 29), (45, 62)]),
    ('Retain [~~NOISE&#64;links.test~~NOISE retained\n\n[ref]: /retained', [(10, 30), (47, 64)]),
    ('Retain ![a~b][ref] [*retained ~NOISE&#64;links.test*NOISE~ retained\n\n[ref]: /retained', [(7, 18), (31, 51), (68, 85)]),
    ('Retain [*retained ~&fjlig;NOISE@links.test*NOISE~ retained\n\n[ref]: /retained', [(19, 42), (59, 76)]),
    ('Retain [~&fjlig;NOISE@links.test~NOISE retained\n\n[ref]: /retained', [(9, 32), (48, 65)]),
    ('Retain [~~&fjlig;NOISE@links.test~~NOISE retained\n\n[ref]: /retained', [(10, 33), (50, 67)]),
    ('Retain ![a~b][ref] [*retained ~&fjlig;NOISE@links.test*NOISE~ retained\n\n[ref]: /retained', [(7, 18), (31, 54), (71, 88)]),
    ('Retain [*retained ~https://links.test/NOISE*NOISE~ retained\n\n[ref]: /retained', [(19, 43), (60, 77)]),
    ('Retain [~https://links.test/NOISE~NOISE retained\n\n[ref]: /retained', [(9, 33), (49, 66)]),
    ('Retain [~~https://links.test/NOISE~~NOISE retained\n\n[ref]: /retained', [(10, 34), (51, 68)]),
    ('Retain ![a~b][ref] [*retained ~https://links.test/NOISE*NOISE~ retained\r\n\r\n[ref]: /retained', [(7, 18), (31, 61), (73, 91)]),
    ('Retain [~NOISE&#64;links.test~NOISE retained', [(9, 29)]),
    ('Retain [~+NOISE&#64;links.test~NOISE retained', [(9, 30)]),
    ('Retain [~&#78;OISE&#64;links.test~NOISE retained', [(9, 33)]),
    ('Retain [~NOISE&#064;links.test~NOISE retained', [(9, 30)]),
    ('Retain [~+NOISE&#064;links.test~NOISE retained', [(9, 31)]),
    ('Retain [~&#78;OISE&#064;links.test~NOISE retained', [(9, 34)]),
    ('Retain [~NOISE&#0000064;links.test~NOISE retained', [(9, 34)]),
    ('Retain [~+NOISE&#0000064;links.test~NOISE retained', [(9, 35)]),
    ('Retain [~&#78;OISE&#0000064;links.test~NOISE retained', [(9, 38)]),
    ('Retain [~NOISE&#00000064;links.test~NOISE retained', []),
    ('Retain [~+NOISE&#00000064;links.test~NOISE retained', []),
    ('Retain [~&#78;OISE&#00000064;links.test~NOISE retained', []),
    ('Retain [~NOISE&#x40;links.test~NOISE retained', [(9, 30)]),
    ('Retain [~+NOISE&#x40;links.test~NOISE retained', [(9, 31)]),
    ('Retain [~&#78;OISE&#x40;links.test~NOISE retained', [(9, 34)]),
    ('Retain [~NOISE&#X0040;links.test~NOISE retained', [(9, 32)]),
    ('Retain [~+NOISE&#X0040;links.test~NOISE retained', [(9, 33)]),
    ('Retain [~&#78;OISE&#X0040;links.test~NOISE retained', [(9, 36)]),
    ('Retain [~NOISE&#x000040;links.test~NOISE retained', [(9, 34)]),
    ('Retain [~+NOISE&#x000040;links.test~NOISE retained', [(9, 35)]),
    ('Retain [~&#78;OISE&#x000040;links.test~NOISE retained', [(9, 38)]),
    ('Retain [~NOISE&#x0000040;links.test~NOISE retained', []),
    ('Retain [~+NOISE&#x0000040;links.test~NOISE retained', []),
    ('Retain [~&#78;OISE&#x0000040;links.test~NOISE retained', []),
    ('Retain [~w&#119;w.links.test/NOISE~NOISE retained', [(9, 34)]),
    ('Retain [~w&#119;w&#46;links.test/NOISE~NOISE retained', [(9, 38)]),
    ('Retain [~w&#119;w&#x00002E;links.test/NOISE~NOISE retained', [(9, 43)]),
    ('Retain [~w&#0000119;w&period;links.test/NOISE~NOISE retained', [(9, 45)]),
    ('Retain [~w&#0000119;w&#x2e;links.test/NOISE~NOISE retained', [(9, 43)]),
    ('Retain [~w&#00000119;w\\.links.test/NOISE~NOISE retained', []),
    ('Retain [~w&#00000119;w&#0000046;links.test/NOISE~NOISE retained', []),
    ('Retain [~w&#87;w.links.test/NOISE~NOISE retained', [(9, 33)]),
    ('Retain [~w&#87;w&#46;links.test/NOISE~NOISE retained', [(9, 37)]),
    ('Retain [~w&#87;w&#x00002E;links.test/NOISE~NOISE retained', [(9, 42)]),
    ('Retain [~w&#0000087;w&period;links.test/NOISE~NOISE retained', [(9, 45)]),
    ('Retain [~w&#0000087;w&#x2e;links.test/NOISE~NOISE retained', [(9, 43)]),
    ('Retain [~w&#x77;w\\.links.test/NOISE~NOISE retained', [(9, 35)]),
    ('Retain [~w&#x77;w&#0000046;links.test/NOISE~NOISE retained', [(9, 43)]),
    ('Retain [~w&#X0077;w.links.test/NOISE~NOISE retained', [(9, 36)]),
    ('Retain [~w&#X0077;w&#46;links.test/NOISE~NOISE retained', [(9, 40)]),
    ('Retain [~w&#X0077;w&#x00002E;links.test/NOISE~NOISE retained', [(9, 45)]),
    ('Retain [~w&#x000077;w&period;links.test/NOISE~NOISE retained', [(9, 45)]),
    ('Retain [~w&#x000077;w&#x2e;links.test/NOISE~NOISE retained', [(9, 43)]),
    ('Retain [~w&#x0000077;w\\.links.test/NOISE~NOISE retained', []),
    ('Retain [~w&#x0000077;w&#0000046;links.test/NOISE~NOISE retained', []),
    ('Retain [~w&#x57;w.links.test/NOISE~NOISE retained', [(9, 34)]),
    ('Retain [~w&#x57;w&#46;links.test/NOISE~NOISE retained', [(9, 38)]),
    ('Retain [~w&#x57;w&#00000046;links.test/NOISE~NOISE retained', []),
    ('Retain [漢字NOISE----------------------------------------------------------------@links.test NOISE retained', [(16, 90)]),
    ('Retain [漢字NOISE----------------------------------------------------------------@links.test0 NOISE retained', []),
    ('Retain [漢字NOISE________________________________________________________________@links.test NOISE retained', [(16, 90)]),
    ('Retain [漢字NOISE________________________________________________________________@links.test0 NOISE retained', []),
    ('Retain [漢字NOISE................................................................@links.test NOISE retained', [(16, 90)]),
    ('Retain [漢字NOISE................................................................@links.test0 NOISE retained', []),
    ('Retain [漢字NOISE++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++@links.test NOISE retained', [(16, 90)]),
    ('Retain [漢字NOISE++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++@links.test0 NOISE retained', []),
    ('Retain [漢字NOISE----------------------------------------------------------------&commat;links.test NOISE retained', [(16, 97)]),
    ('Retain [漢字NOISE----------------------------------------------------------------&commat;links.test0 NOISE retained', []),
    ('Retain [漢字NOISE________________________________________________________________&commat;links.test NOISE retained', [(16, 97)]),
    ('Retain [漢字NOISE________________________________________________________________&commat;links.test0 NOISE retained', []),
    ('Retain [漢字NOISE................................................................&commat;links.test NOISE retained', [(16, 97)]),
    ('Retain [漢字NOISE................................................................&commat;links.test0 NOISE retained', []),
    ('Retain [漢字NOISE++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++&commat;links.test NOISE retained', [(16, 97)]),
    ('Retain [漢字NOISE++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++&commat;links.test0 NOISE retained', []),
    ('Retain [漢字NOISE----------------------------------------------------------------&#64;links.test NOISE retained', [(16, 94)]),
    ('Retain [漢字NOISE----------------------------------------------------------------&#64;links.test0 NOISE retained', []),
    ('Retain [漢字NOISE________________________________________________________________&#64;links.test NOISE retained', [(16, 94)]),
    ('Retain [漢字NOISE________________________________________________________________&#64;links.test0 NOISE retained', []),
    ('Retain [漢字NOISE................................................................&#64;links.test NOISE retained', [(16, 94)]),
    ('Retain [漢字NOISE................................................................&#64;links.test0 NOISE retained', []),
    ('Retain [漢字NOISE++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++&#64;links.test NOISE retained', [(16, 94)]),
    ('Retain [漢字NOISE++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++&#64;links.test0.NOISE&#64;other.test NOISE retained', [(16, 101)]),
    ('Retain NOISE@ NOISE retained', []),
    ('Retain [NOISE&commat; NOISE retained', []),
    ('Retain [NOISE&commat;. NOISE retained', []),
    ('Retain [NOISE@- NOISE retained', []),
    ('Retain [NOISE@_ NOISE retained', []),
    ('Retain NOISE&commat;.a NOISE retained', []),
    ('Retain NOISE&commat;..a NOISE retained', []),
    ('Retain NOISE@a. NOISE retained', []),
    ('Retain NOISE@a.b NOISE retained', [(7, 16)]),
    ('Retain [NOISE&commat;a.b NOISE retained', [(8, 24)]),
    ('Retain [NOISE&commat;a.-b NOISE retained', [(8, 25)]),
    ('Retain [NOISE@a._b NOISE retained', [(8, 18)]),
    ('Retain [NOISE@a..b NOISE retained', []),
    ('Retain NOISE&commat;1.a NOISE retained', [(7, 23)]),
    ('Retain NOISE&commat;.a1 NOISE retained', []),
    ('Retain NOISE@.a_ NOISE retained', []),
    ('Retain NOISE@.a- NOISE retained', []),
    ('Retain [NOISE&commat;.a- NOISE retained', []),
    ('Retain [NOISE&commat;a.b1.c NOISE retained', [(8, 27)]),
    ('Retain [NOISE&commat;a.b. NOISE retained', [(8, 24)]),
    ('Retain \x0bwww.NOISE.test NOISE retained', [(8, 22)]),
    ('Retain \x85www.NOISE.test NOISE retained', []),
    ('Retain \u2000www.NOISE.test NOISE retained', [(8, 22)]),
    ('Retain [\u202fwww.NOISE.test NOISE retained', [(9, 23)]),
    ('Retain [→www.NOISE.test NOISE retained', [(9, 23)]),
    ('Retain &nbsp;www.NOISE.test NOISE retained', [(13, 27)]),
    ('Retain \\_www.NOISE.test NOISE retained', [(9, 23)]),
    ('Retain \x1cw&#119;w.NOISE.test NOISE retained', []),
    ('Retain [\u1680w&#119;w.NOISE.test NOISE retained', [(9, 28)]),
    ('Retain [\u2029w&#119;w.NOISE.test NOISE retained', [(9, 28)]),
    ('Retain →w&#119;w.NOISE.test NOISE retained', [(8, 27)]),
    ('Retain 0w&#119;w.NOISE.test NOISE retained', []),
    ('Retain [&sol;w&#119;w.NOISE.test NOISE retained', [(13, 32)]),
    ('Retain [\x0cNOISE@links.test NOISE retained', [(9, 25)]),
    ('Retain [\xa0NOISE@links.test NOISE retained', [(9, 25)]),
    ('Retain \u2029NOISE@links.test NOISE retained', [(8, 24)]),
    ('Retain 。NOISE@links.test NOISE retained', [(8, 24)]),
    ('Retain [漢NOISE@links.test NOISE retained', []),
    ('Retain [&#x1c;NOISE@links.test NOISE retained', [(14, 30)]),
    ('Retain [\x0bNOISE&commat;links.test NOISE retained', [(9, 32)]),
    ('Retain \xa0NOISE&commat;links.test NOISE retained', [(8, 31)]),
    ('Retain \u2028NOISE&commat;links.test NOISE retained', [(8, 31)]),
    ('Retain [\ufeffNOISE&commat;links.test NOISE retained', [(9, 32)]),
    ('Retain [🧪NOISE&commat;links.test NOISE retained', []),
    ('Retain &#x1c;NOISE&commat;links.test NOISE retained', [(13, 36)]),
    ('Retain \x0bhttps://links.test/NOISE NOISE retained', [(8, 32)]),
    ('Retain \x85https://links.test/NOISE NOISE retained', [(8, 32)]),
    ('Retain [\u2000https://links.test/NOISE NOISE retained', [(9, 33)]),
    ('Retain [\u202fhttps://links.test/NOISE NOISE retained', [(9, 33)]),
    ('Retain 🧪https://links.test/NOISE NOISE retained', [(8, 32)]),
    ('Retain &nbsp;https://links.test/NOISE NOISE retained', [(13, 37)]),
    ('Retain [\\_https://links.test/NOISE NOISE retained', [(10, 34)]),
    ('Retain [~&#119;ww.NOISE.test~NOISE retained', [(9, 28)]),
    ('Retain [~ww&#119;\\.NOISE.test~NOISE retained', [(9, 29)]),
    ('Retain [~w&#119;w&#46;NOISE.test~NOISE retained', [(9, 32)]),
    ('Retain [~&#119;ww&#x2e;NOISE.test~NOISE retained', [(9, 33)]),
    ('Retain [~ww&#119;&#x00002E;NOISE.test~NOISE retained', [(9, 37)]),
    ('Retain [~w&#0000119;w.NOISE.test~NOISE retained', [(9, 32)]),
    ('Retain [~&#0000119;ww&period;NOISE.test~NOISE retained', [(9, 39)]),
    ('Retain [~ww&#0000119;&#46;NOISE.test~NOISE retained', [(9, 36)]),
    ('Retain [~w&#0000119;w&#x2e;NOISE.test~NOISE retained', [(9, 37)]),
    ('Retain [~&#0000119;ww&#00000046;NOISE.test~NOISE retained', []),
    ('Retain [~ww&#00000119;.NOISE.test~NOISE retained', []),
    ('Retain [~w&#00000119;w&period;NOISE.test~NOISE retained', []),
    ('Retain [~w&#00000119;w&#0000046;NOISE.test~NOISE retained', []),
    ('Retain [~&#00000119;ww&#x00002E;NOISE.test~NOISE retained', []),
    ('Retain [~ww&#00000119;&#00000046;NOISE.test~NOISE retained', []),
    ('Retain [~w&#87;w\\.NOISE.test~NOISE retained', [(9, 28)]),
    ('Retain [~&#87;ww&#46;NOISE.test~NOISE retained', [(9, 31)]),
    ('Retain [~ww&#87;&#0000046;NOISE.test~NOISE retained', [(9, 36)]),
    ('Retain [~w&#87;w&#x00002E;NOISE.test~NOISE retained', [(9, 36)]),
    ('Retain [~&#0000087;ww.NOISE.test~NOISE retained', [(9, 32)]),
    ('Retain [~ww&#0000087;\\.NOISE.test~NOISE retained', [(9, 33)]),
    ('Retain [~w&#0000087;w&#46;NOISE.test~NOISE retained', [(9, 36)]),
    ('Retain [~&#0000087;ww&#x2e;NOISE.test~NOISE retained', [(9, 37)]),
    ('Retain [~ww&#0000087;&#x00002E;NOISE.test~NOISE retained', [(9, 41)]),
    ('Retain [~ww&#x77;.NOISE.test~NOISE retained', [(9, 28)]),
    ('Retain [~w&#x77;w&period;NOISE.test~NOISE retained', [(9, 35)]),
    ('Retain [~&#x77;ww&#0000046;NOISE.test~NOISE retained', [(9, 37)]),
    ('Retain [~ww&#x77;&#x2e;NOISE.test~NOISE retained', [(9, 33)]),
    ('Retain [~w&#x77;w&#00000046;NOISE.test~NOISE retained', []),
    ('Retain [~&#X0077;ww\\.NOISE.test~NOISE retained', [(9, 31)]),
    ('Retain [~ww&#X0077;&period;NOISE.test~NOISE retained', [(9, 37)]),
    ('Retain [~w&#X0077;w&#0000046;NOISE.test~NOISE retained', [(9, 39)]),
    ('Retain [~&#X0077;ww&#x00002E;NOISE.test~NOISE retained', [(9, 39)]),
    ('Retain [~ww&#X0077;&#00000046;NOISE.test~NOISE retained', []),
    ('Retain [~w&#x000077;w\\.NOISE.test~NOISE retained', [(9, 33)]),
    ('Retain [~&#x000077;ww&#46;NOISE.test~NOISE retained', [(9, 36)]),
    ('Retain [~&#x000077;ww&#x2e;NOISE.test~NOISE retained', [(9, 37)]),
    ('Retain [~ww&#x000077;&#x00002E;NOISE.test~NOISE retained', [(9, 41)]),
    ('Retain [~w&#x0000077;w.NOISE.test~NOISE retained', []),
    ('Retain [~&#x0000077;ww&period;NOISE.test~NOISE retained', []),
    ('Retain [~ww&#x0000077;&#46;NOISE.test~NOISE retained', []),
    ('Retain [~w&#x0000077;w&#x2e;NOISE.test~NOISE retained', []),
    ('Retain [~&#x0000077;ww&#00000046;NOISE.test~NOISE retained', []),
    ('Retain [~ww&#x57;.NOISE.test~NOISE retained', [(9, 28)]),
    ('Retain [~w&#x57;w&period;NOISE.test~NOISE retained', [(9, 35)]),
    ('Retain [~&#x57;ww&#0000046;NOISE.test~NOISE retained', [(9, 37)]),
    ('Retain [~ww&#x57;&#x2e;NOISE.test~NOISE retained', [(9, 33)]),
    ('Retain [~ww&#x57;&#00000046;NOISE.test~NOISE retained', []),
    ('Retain www.', [(7, 10)]),
    ('Retain www. NOISE', [(7, 10)]),
    ('Retain www.\nNOISE', [(7, 10)]),
    ('Retain www..NOISE', [(7, 17)]),
    ('Retain www._NOISE', []),
    ('Retain www.🧪.test NOISE', [(7, 17)]),
    ('Retain [www.] NOISE', [(8, 11)]),
    ('Retain w&#119;w&period; NOISE', [(7, 15)]),
    ('Retain _www._www.bad_domain.test/NOISE NOISE', []),
    ('Retain [w&#119;w._www.bad_domain.test/NOISE NOISE', []),
    ('Retain NOISE@links.test..NOISE@other.test', [(7, 41)]),
    ('Retain [NOISE&commat;links.test..NOISE&commat;other.test', [(8, 31), (32, 56)]),
    ('Retain /NOISE@links.test', []),
    ('Retain /a.NOISE&commat;links.test', [(10, 33)]),
    ('Retain [https://. NOISE', []),
    ('Retain [http://.. NOISE', []),
    ('Retain [www. NOISE', [(8, 11)]),
    ('Retain [www.bad_https://links.test/NOISE NOISE', [(16, 40)]),
    ('Retain _www._www.bad_domain.test/_www.NOISE.test NOISE', [(34, 48)]),
    ('Retain [www.bad_domain.test/_www.NOISE.test NOISE', [(29, 43)]),
    ('Retain [www._www.bad_domain.test/NOISE NOISE', []),
    ('Retain [http://www._www.bad_domain.test/NOISE NOISE', []),
    ('Retain [www.---.test/NOISE NOISE', []),
    ('Retain [www.test.---/NOISE NOISE', []),
    ('Retain [www.___._www.NOISE.test NOISE', [(8, 31)]),
    ('Retain [www._www.NOISE.test NOISE', [(8, 27)]),
], ids=[f"autolink-{index}" for index in range(412)])
def test_literal_autolink_families_match_native_token_and_policy_spans(source, expected_ranges):
    assert protected_ranges(source) == expected_ranges
