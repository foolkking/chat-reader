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
from test_cleanup_safety import MARKER, create_review, session


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


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize("source", [
    "[safe](<https://links.test/)NOISE>) NOISE",
    "[safe](<https://links.test/(NOISE>) NOISE",
    "[safe](</links/)NOISE>) NOISE",
    "[safe](</links/(NOISE>) NOISE",
    '[safe](https://links.test/path "retain ) NOISE") NOISE',
    "[safe](https://links.test/path 'retain ) NOISE') NOISE",
    '[safe](https://links.test/path "retain ( NOISE") NOISE',
    '[safe](https://links.test/path "retain\nNOISE") NOISE',
    "[safe](\n/links/NOISE\n) NOISE",
    '[safe](https://links.test/path\n "NOISE") NOISE',
    "[safe](<https://links.test/NOISE with spaces>) NOISE",
    "[safe](https://links.test/path (NOISE)) NOISE",
    "[safe](https://links.test/NOISE) NOISE",
    "[safe](https://links.test/(section)/NOISE) NOISE",
    r"[safe](https://links.test/escaped\)/NOISE) NOISE",
    "![safe](<https://links.test/)NOISE>) NOISE",
    '> [safe](https://links.test/path "retain\n> NOISE")\n> NOISE',
    "> [safe](\n> https://links.test/NOISE\n> ) NOISE",
    r'[safe](/links "retain \" ) NOISE") NOISE',
    r"[safe](/links 'retain \' ) NOISE') NOISE",
])
def test_inline_link_attributes_preserve_real_closer_and_following_prose(source, newline):
    source = source.replace("\n", newline)
    hits = detect(source, literal="NOISE")
    assert [source[hit.start:hit.end] for hit in hits] == ["NOISE", "NOISE"]
    assert [hit.decision for hit in hits] == ["PROTECTED", "KEEP"]
    assert ["PROTECTED_RANGE" in hit.evidence_codes for hit in hits] == [True, False]
    assert all("UNCERTAIN_CONTEXT" not in hit.evidence_codes for hit in hits)


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize("source,expected", [
    ("Plain ](/NOISE) NOISE", ["KEEP", "KEEP"]),
    (r"[safe\](/NOISE) NOISE", ["KEEP", "KEEP"]),
    (r"\[safe](/NOISE) NOISE", ["KEEP", "KEEP"]),
    ("[safe] ](/NOISE) NOISE", ["KEEP", "KEEP"]),
    ("[safe\n\n](/NOISE) NOISE", ["KEEP", "KEEP"]),
    ("[safe\n# ](/NOISE) NOISE", ["KEEP", "KEEP"]),
    ("[safe\n- ](/NOISE) NOISE", ["KEEP", "KEEP"]),
    ("[safe\n> ](/NOISE) NOISE", ["KEEP", "KEEP"]),
    ("`[safe` ](/NOISE) NOISE", ["KEEP", "KEEP"]),
    ("$[safe$ ](/NOISE) NOISE", ["KEEP", "KEEP"]),
    ("<https://links.test/[safe> ](/NOISE) NOISE", ["KEEP", "KEEP"]),
    ("[outer [inner](/keep)](/NOISE) NOISE", ["KEEP", "KEEP"]),
    (r"\[safe](</links/NOISE>) NOISE", ["KEEP", "KEEP"]),
    (r"[safe\]](/NOISE) NOISE", ["PROTECTED", "KEEP"]),
    (r"[sa\[fe](/NOISE) NOISE", ["PROTECTED", "KEEP"]),
    (r"\\[safe](/NOISE) NOISE", ["PROTECTED", "KEEP"]),
    (r"[safe\\](/NOISE) NOISE", ["PROTECTED", "KEEP"]),
    ("[[safe]](/NOISE) NOISE", ["PROTECTED", "KEEP"]),
    ("[outer [inner] plain](/NOISE) NOISE", ["PROTECTED", "KEEP"]),
    ("[safe\nlabel](/NOISE) NOISE", ["PROTECTED", "KEEP"]),
    ("> [safe\n> label](/NOISE) NOISE", ["PROTECTED", "KEEP"]),
    ("- [safe\n  label](/NOISE) NOISE", ["PROTECTED", "KEEP"]),
    ("[safe `]` text](/NOISE) NOISE", ["PROTECTED", "KEEP"]),
    ("[outer ![inner](/keep)](/NOISE) NOISE", ["PROTECTED", "KEEP"]),
    ("![outer [inner](/keep)](/NOISE) NOISE", ["PROTECTED", "KEEP"]),
    ("[outer ![image [inner](/keep)](/image)](/NOISE) NOISE", ["KEEP", "KEEP"]),
    ("Plain ](/NOISE) [safe](/NOISE) NOISE", ["KEEP", "PROTECTED", "KEEP"]),
    ("[safe](/NOISE) ](/NOISE) NOISE", ["PROTECTED", "KEEP", "KEEP"]),
    ("[](/NOISE) NOISE", ["PROTECTED", "KEEP"]),
    (r"[outer \![inner](/keep)](/NOISE) NOISE", ["KEEP", "KEEP"]),
    ("[outer [inner](/keep) ![image](/image)](/NOISE) NOISE", ["KEEP", "KEEP"]),
    ("[outer ![image [inner](/keep)] plain](/NOISE) NOISE", ["KEEP", "KEEP"]),
])
def test_link_attributes_require_an_active_unescaped_label_in_the_same_block(source, expected, newline):
    source = ("合成 🧪\n\n" + source).replace("\n", newline)
    hits = detect(source, literal="NOISE")
    assert [source[hit.start:hit.end] for hit in hits] == ["NOISE"] * len(expected)
    assert [hit.decision for hit in hits] == expected
    assert ["PROTECTED_RANGE" in hit.evidence_codes for hit in hits] == [value == "PROTECTED" for value in expected]
    assert all("UNCERTAIN_CONTEXT" not in hit.evidence_codes for hit in hits)


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize("source", [
    "Before `[safe](NOISE` NOISE after.",
    "Before ``[safe](NOISE`` NOISE after.",
    "$[safe](NOISE$ NOISE after.",
    r"\([safe](NOISE\) NOISE after.",
])
def test_literal_code_or_math_link_openers_cannot_extend_protection_into_prose(source, newline):
    source = source.replace("\n", newline)
    hits = detect(source, literal="NOISE")
    assert [source[hit.start:hit.end] for hit in hits] == ["NOISE", "NOISE"]
    assert [hit.decision for hit in hits] == ["PROTECTED", "KEEP"]
    assert ["PROTECTED_RANGE" in hit.evidence_codes for hit in hits] == [True, False]


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize("boundary", ["\n\nPlain ", "\n# ", "\n- ", "\n> "])
def test_unclosed_link_title_cannot_borrow_a_closer_from_another_block(newline, boundary):
    source = ('[safe](/links "NOISE' + boundary + 'NOISE")').replace("\n", newline)
    hits = detect(source, literal="NOISE")
    # Incomplete syntax retains the conservative same-line fallback, but does
    # not hide ordinary content in the next recognized block.
    assert [hit.decision for hit in hits] == ["PROTECTED", "KEEP"]
    assert ["PROTECTED_RANGE" in hit.evidence_codes for hit in hits] == [True, False]


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize("indent", ["\t", "    ", " \t", "  \t", "   \t", "\t "])
def test_indented_code_uses_markdown_tab_columns_without_shifting_offsets(newline, indent):
    source = f"合成前缀 🧪{newline}{newline}{indent}NOISE{newline}  \tNOISE{newline}{newline}NOISE"
    hits = detect(source, literal="NOISE")
    assert [source[hit.start:hit.end] for hit in hits] == ["NOISE", "NOISE", "NOISE"]
    assert [hit.decision for hit in hits] == ["PROTECTED", "PROTECTED", "KEEP"]
    assert ["PROTECTED_RANGE" in hit.evidence_codes for hit in hits] == [True, True, False]


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize("source,expected", [
    ("Retain paragraph.\n  \tNOISE\n\nNOISE", ["KEEP", "KEEP"]),
    ("Retain paragraph.\n    NOISE\n\nNOISE", ["KEEP", "KEEP"]),
    ("- ```text\n  NOISE\n  ```\n    NOISE\n\nNOISE", ["PROTECTED", "KEEP", "KEEP"]),
    ("- ```text\n  NOISE\n  ```\n  \tNOISE\n\nNOISE", ["PROTECTED", "KEEP", "KEEP"]),
    ("- > ```text\n  NOISE\n    ```\n  NOISE\n\nNOISE", ["KEEP", "PROTECTED", "KEEP"]),
    ("- Retain item.\n\n      NOISE\n\nNOISE", ["PROTECTED", "KEEP"]),
    ("- Retain item.\n\n  ```text\n  NOISE\n  ```\n\nNOISE", ["PROTECTED", "KEEP"]),
    ("> Retain quote.\n>\n>     NOISE\n\nNOISE", ["PROTECTED", "KEEP"]),
    ("> Retain quote.\n>     NOISE\n\nNOISE", ["KEEP", "KEEP"]),
    ("```text\n  \tNOISE\n```\n  \tNOISE\n\nNOISE", ["PROTECTED", "PROTECTED", "KEEP"]),
    ("- > ```text\n  > NOISE\n\n  > NOISE\n\nNOISE", ["PROTECTED", "KEEP", "KEEP"]),
    ("- > ```text\n\t> NOISE\n\n\t> NOISE\n\nNOISE", ["PROTECTED", "KEEP", "KEEP"]),
    ("# Retain heading\n  \tNOISE\n\nNOISE", ["PROTECTED", "KEEP"]),
    ("Retain heading\n---\n  \tNOISE\n\nNOISE", ["PROTECTED", "KEEP"]),
    ("---\n  \tNOISE\n\nNOISE", ["PROTECTED", "KEEP"]),
    ("> Retain quote.\nLazy continuation.\n>     NOISE\n\nNOISE", ["KEEP", "KEEP"]),
    ("- Retain item.\nLazy continuation.\n      NOISE\n\nNOISE", ["KEEP", "KEEP"]),
    ("Retain paragraph.\n2.     NOISE\n\nNOISE", ["KEEP", "KEEP"]),
    ("Retain paragraph.\n01.     NOISE\n\nNOISE", ["KEEP", "KEEP"]),
    ("Retain paragraph.\n1.     NOISE\n\nNOISE", ["PROTECTED", "KEEP"]),
    ("- Retain item.\n2.     NOISE\n\nNOISE", ["PROTECTED", "KEEP"]),
    ("1. Retain item.\n2.     NOISE\n\nNOISE", ["PROTECTED", "KEEP"]),
    ("- Retain item.\n  2.     NOISE\n\nNOISE", ["KEEP", "KEEP"]),
    ("- Retain item.\n\n  2.     NOISE\n\nNOISE", ["PROTECTED", "KEEP"]),
])
def test_code_indentation_is_relative_to_container_and_cannot_interrupt_paragraph(source, expected, newline):
    source = source.replace("\n", newline)
    hits = detect(source, literal="NOISE")
    assert [source[hit.start:hit.end] for hit in hits] == ["NOISE"] * len(expected)
    assert [hit.decision for hit in hits] == expected
    assert ["PROTECTED_RANGE" in hit.evidence_codes for hit in hits] == [value == "PROTECTED" for value in expected]


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize("source", [
    "- ```text\n  NOISE\n  ```\n\nNOISE",
    "1. ~~~text\n   NOISE\n   ~~~~\n\nNOISE",
    "123) ```text\n     NOISE\n     ````\n\nNOISE",
    "-\t~~~text\n\tNOISE\n\t~~~~\n\nNOISE",
    "> ```text\n> NOISE\n> ````\n\nNOISE",
    "> - ```text\n>   NOISE\n>   ```\n>\n> NOISE",
    "- > - ```text\n  >   NOISE\n  >   ````\n\nNOISE",
])
def test_fenced_code_inside_markdown_containers_stays_protected(source, newline):
    source = source.replace("\n", newline)
    hits = detect(source, literal="NOISE")
    assert [source[hit.start:hit.end] for hit in hits] == ["NOISE", "NOISE"]
    assert [hit.decision for hit in hits] == ["PROTECTED", "KEEP"]
    assert ["PROTECTED_RANGE" in hit.evidence_codes for hit in hits] == [True, False]


@pytest.mark.parametrize("source", [
    "- ```text\n  NOISE\n\nNOISE",
    "> ```text\n> NOISE\n\nNOISE",
    "> - ~~~text\n>   NOISE\n> NOISE",
    "- > - ```text\n  >   NOISE\n  > NOISE",
])
def test_unclosed_container_fence_does_not_protect_source_outside_container(source):
    assert [hit.decision for hit in detect(source, literal="NOISE")] == ["PROTECTED", "KEEP"]


@pytest.mark.parametrize("opener,body_prefix", [("```", ""), ("- ```", "  "), ("> ```", "> ")])
def test_only_blank_same_container_fence_suffix_can_close_code(opener, body_prefix):
    source = f"{opener}text\n{body_prefix}NOISE\n{body_prefix}```not-a-closer\n{body_prefix}NOISE\n{body_prefix}````\n\nNOISE"
    assert [hit.decision for hit in detect(source, literal="NOISE")] == ["PROTECTED", "PROTECTED", "KEEP"]


def test_escaped_ticks_and_unclosed_spans_do_not_bridge_fenced_blocks():
    assert detect(r"\` NOISE \`", literal="NOISE")[0].decision == "KEEP"
    source = "Unclosed ` NOISE\n\n```text\nNOISE\n```\n\nNOISE `"
    hits = detect(source, literal="NOISE")
    assert [hit.decision for hit in hits] == ["KEEP", "PROTECTED", "KEEP"]


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize("source,expected", [
    ("Before `NOISE\n\nAfter `NOISE` end.", ["KEEP", "PROTECTED"]),
    ("Before `NOISE\n# Heading `NOISE`\n\nNOISE", ["KEEP", "PROTECTED", "KEEP"]),
    ("# Heading `NOISE\nParagraph `NOISE`", ["KEEP", "PROTECTED"]),
    ("- Before `NOISE\n- After `NOISE`", ["KEEP", "PROTECTED"]),
    ("> Before `NOISE\n\n> After `NOISE`", ["KEEP", "PROTECTED"]),
    ("`NOISE\nsoft NOISE`", ["PROTECTED", "PROTECTED"]),
    ("> `NOISE\n> NOISE`", ["PROTECTED", "PROTECTED"]),
    ("- `NOISE\n  NOISE`", ["PROTECTED", "PROTECTED"]),
    ("Before ``NOISE\n# Heading NOISE``", ["KEEP", "KEEP"]),
    ("> `NOISE\n>\n> NOISE`", ["KEEP", "KEEP"]),
    ("- `NOISE\n  - `NOISE`", ["KEEP", "PROTECTED"]),
    ("Before `NOISE\n---\nNOISE`", ["KEEP", "KEEP"]),
    ("Before `NOISE\n---\nAfter `NOISE`", ["KEEP", "PROTECTED"]),
    ("Before `NOISE\n***\nAfter `NOISE`", ["KEEP", "PROTECTED"]),
    ("Before `NOISE\n> After `NOISE`", ["KEEP", "PROTECTED"]),
    ("> `NOISE\nlazy NOISE`", ["PROTECTED", "PROTECTED"]),
    ("- `NOISE\nlazy NOISE`", ["PROTECTED", "PROTECTED"]),
])
def test_inline_code_respects_block_boundaries_but_allows_paragraph_soft_lines(source, expected, newline):
    source = source.replace("\n", newline)
    hits = detect(source, literal="NOISE")
    assert [source[hit.start:hit.end] for hit in hits] == ["NOISE"] * len(expected)
    assert [hit.decision for hit in hits] == expected
    assert ["PROTECTED_RANGE" in hit.evidence_codes for hit in hits] == [value == "PROTECTED" for value in expected]


@pytest.mark.parametrize("ticks", ["`", "``", "```", "````"])
@pytest.mark.parametrize("backslash_count", [1, 2, 3])
@pytest.mark.parametrize("following_code", [False, True])
def test_backslashes_inside_code_do_not_escape_closing_ticks(ticks, backslash_count, following_code):
    suffix = " after `NOISE`" if following_code else " after NOISE"
    source = "Before " + ticks + "NOISE" + "\\" * backslash_count + ticks + suffix
    hits = detect(source, literal="NOISE")
    assert [source[hit.start:hit.end] for hit in hits] == ["NOISE", "NOISE"]
    assert [hit.decision for hit in hits] == ["PROTECTED", "PROTECTED" if following_code else "KEEP"]
    assert ["PROTECTED_RANGE" in hit.evidence_codes for hit in hits] == [True, following_code]


@pytest.mark.parametrize("backslash_count", [1, 2, 3, 4])
def test_backslash_parity_still_controls_opening_ticks(backslash_count):
    source = "Before " + "\\" * backslash_count + "` NOISE ` after NOISE"
    hits = detect(source, literal="NOISE")
    assert [hit.decision for hit in hits] == [
        "KEEP" if backslash_count % 2 else "PROTECTED",
        "KEEP",
    ]


@pytest.mark.parametrize("source,protected_index", [
    ("Before `NOISE\\` after NOISE.", 0),
    ("Before ``NOISE\\`` after NOISE.", 0),
    ("- ```text\n  NOISE\n  ```\n\nNOISE", 0),
    ("> ~~~text\n> NOISE\n> ~~~~\n\nNOISE", 0),
    ("- > - ```text\n  >   NOISE\n  >   ````\n\nNOISE", 0),
    ("Synthetic retained.\n\n  \tNOISE\n\nNOISE", 0),
    ("> Synthetic retained.\n>\n>     NOISE\n\nNOISE", 0),
    ("- Synthetic retained.\n\n    ```text\n  NOISE\n  ```\n\nNOISE", 0),
    ("Before `NOISE\n\nAfter `NOISE` end.", 1),
    ("# Heading `NOISE\nParagraph `NOISE`.", 1),
    ("- Before `NOISE\n- After `NOISE`.", 1),
    ("> Before `NOISE\n>\n> After `NOISE`.", 1),
    ("Before `NOISE`.\n\nOrdinary `NOISE\n\nRetained `tick`.", 0),
    ("[safe](</links/)NOISE>) NOISE", 0),
    ('合成 🧪\n\n[safe](/links "retain ) NOISE") NOISE', 0),
    ('[safe](/links "retain\nNOISE") NOISE', 0),
    ("[safe](\n/links/NOISE\n) NOISE", 0),
    ("> [safe](\n> /links/NOISE\n> ) NOISE", 0),
    ("Before `[safe](NOISE` NOISE after.", 0),
    (r"[safe\]](/NOISE) NOISE", 0),
    ("[outer ![inner](/keep)](/NOISE) NOISE", 0),
    ("[safe `]` text](/NOISE) NOISE", 0),
    ("[safe\nlabel](/NOISE) NOISE", 0),
    ("Keep [https://links.test/NOISE] NOISE", 0),
    ("Retain [unclosed\n\nRetain https://links.test/NOISE NOISE", 0),
    ("Retain https://links.test/NOISE>TAIL NOISE", 0),
    ("Retain [https://links.test/NOISE_ NOISE", 0),
    ("Retain [https://links.test/NOISE&amp; NOISE", 0),
    ("Retain [https://links.test/NOISE&#33; NOISE", 0),
    (r"Retain [https://links.test/NOISE\) NOISE", 0),
    ("Retain [https://links.test/NOISE<stuff NOISE", 0),
    ("Retain https://links.test/`NOISE keep` NOISE", 0),
    ("Retain [h&#116;tps://links.test/NOISE NOISE", 0),
    ("Retain [https&colon;&sol;&sol;links.test/NOISE NOISE", 0),
    (r"Retain [https:\/\/links.test/NOISE NOISE", 0),
    ("Retain [&#104;&#116;&#116;&#112;&#115;&#58;&#47;&#47;links.test/NOISE NOISE", 0),
    ("Retain [https://links.test/NOISE<em>NOISE</em>", 0),
    ('Retain [h&#116;tps://links.test/NOISE<em data-marker="NOISE">retained</em>', 0),
    ('Retain <em x="`">NOISE</em> ordinary `NOISE` end', 1),
    ('Retain <!--`--> NOISE `NOISE` end', 1),
    ('Retain `before <em x="`">NOISE</em> ordinary `NOISE` end', 1),
    ('Retain https://links.test/retained\\<em x="`">NOISE</em> ordinary `NOISE` end', 1),
    ('Retain <em x="`">tail</em> ordinary `NOISE` NOISE', 0),
    ('Retain <!THING `>NOISE `NOISE` end', 1),
    ("<div>\nh&#116;tps://links.test/NOISE\n\nRetain NOISE", 0),
    ("<!--\n[retained](/NOISE)\n-->\nRetain NOISE", 0),
    ("> <pre>\n> $NOISE$\n> </pre>\n\nRetain NOISE", 0),
    ("- <widget>\n  `NOISE`\n\nRetain NOISE", 0),
    ("ordinary\n    <!--\n[retained](/NOISE)\n-->\nRetain `NOISE`", 1),
    ("Retain [*h&#116;tps://links.test/NOISE*NOISE retained", 0),
    ("Retain [**h&#116;tps://links.test/NOISE**NOISE retained", 0),
    ("Retain [***https&colon;&sol;&sol;links.test/NOISE***NOISE retained", 0),
    ("Retain [_h&#116;tps://links.test/NOISE_ NOISE retained", 0),
    ("Retain [__h&#116;tps://links.test/NOISE__!NOISE retained", 0),
    ("Retain [*h&#116;tps://links.test/NOISE*!NOISE retained", 0),
    ("Retain [~h&#116;tps://links.test/NOISE~NOISE retained", 0),
    ("Retain [~~h&#116;tps://links.test/NOISE~~NOISE retained", 0),
    ("Retain [~retained *h&#116;tps://links.test/NOISE~NOISE* retained", 0),
    ("Retain [*retained ~~h&#116;tps://links.test/NOISE*NOISE~~ retained", 0),
    ("Retain [a~b](/retained) [~retained *h&#116;tps://links.test/NOISE~NOISE* retained", 0),
    ("* Retain [~h&#116;tps://links.test/NOISE~NOISE retained", 0),
    ("[ref]: /retained`\n\nRetain `NOISE` NOISE", 0),
    ("[ref]: /retained<!--\n\nRetain `NOISE` NOISE", 0),
    ('[ref]: /retained "`<em>"\n\nRetain `NOISE` NOISE', 0),
    ("[ref]: /retained$\n\nRetain `NOISE` NOISE", 0),
    ("Retain [~www.links.test/NOISE~NOISE retained", 0),
    ("Retain [~w&#119;w.links.test/NOISE~NOISE retained", 0),
    ("Retain [~NOISE@links.test~NOISE retained", 0),
    ("Retain [~NOISE&commat;links.test~NOISE retained", 0),
])
def test_trial_and_apply_preserve_syntax_and_only_remove_ordinary_match(client, source, protected_index):
    config = {
        "name": "Synthetic protection boundary", "match_value": "NOISE",
        "case_sensitive": True, "matcher_mode": "EXACT",
        "boundary_mode": "ANYWHERE", "role_filter": "assistant",
    }
    created = client.post("/api/content-cleanup/rules", json=config)
    assert created.status_code == 201, created.text
    scan, messages = create_review(client, [source])
    trial = client.post("/api/content-cleanup/rules/trial", json=config)
    assert trial.status_code == 200, trial.text
    result = trial.json()
    assert result["matches"] == 2 and result["protected_matches"] == 1
    assert [sample["protected"] for sample in result["samples"]] == [index == protected_index for index in range(2)]
    prefix = f"/api/content-cleanup/scans/{scan}"
    rows = client.get(prefix + "/occurrences").json()
    assert [row["decision"] for row in rows] == [
        "PROTECTED" if index == protected_index else "KEEP" for index in range(2)
    ]
    code, ordinary = rows[protected_index], rows[1 - protected_index]
    assert code["protection_types"] == ["markdown_code_link_or_math"]
    assert client.patch(prefix + "/decisions", json={
        "decisions": [{"occurrence_id": code["id"], "decision": "DELETE"}],
    }).status_code == 422
    chosen = client.patch(prefix + "/decisions/filter", json={
        "decision": "DELETE", "all_matching": True,
    })
    assert chosen.status_code == 200, chosen.text
    assert chosen.json()["matched"] == chosen.json()["skipped_protected"] == 1
    preview = client.get(prefix + "/preview").json()
    expected = source[:ordinary["start_offset"]] + source[ordinary["end_offset"]:]
    assert preview["items"][0]["before"] == source
    assert preview["items"][0]["after"] == expected
    assert not preview["items"][0]["conflict"]
    applied = client.post(prefix + "/apply", json={"preview_token": preview["preview_token"]})
    assert applied.status_code == 200 and applied.json() == {"applied": 1, "conflicts": 0}
    with session() as db:
        message = db.get(Message, messages[0])
        assert db.get(MessageVersion, message.current_version_id).display_text == expected
        assert db.query(MessageVersion).filter_by(message_id=message.id).count() == 2


@pytest.mark.parametrize("source,literal", [(source, "NOISE") for source in [
    "Plain ](/NOISE) NOISE",
    r"\[safe](/NOISE) NOISE",
    r"[safe\](/NOISE) NOISE",
    "[safe] ](/NOISE) NOISE",
    "`[safe` ](/NOISE) NOISE",
    "[safe\n\n](/NOISE) NOISE",
    "[outer [inner](/keep)](/NOISE) NOISE",
    r"[outer \![inner](/keep)](/NOISE) NOISE",
]] + [
    ("Retain [https://links.test/retained&amp; ordinary &amp;", "&amp;"),
    ("Retain [https://links.test/retained&#33; ordinary &#33;", "&#33;"),
    ("Retain [&#65;https://links.test/NOISE ordinary NOISE", "NOISE"),
    ("Retain [&#x1F9EA;https://links.test/NOISE ordinary NOISE", "NOISE"),
    ("Retain [&fjlig;https://links.test/NOISE ordinary NOISE", "NOISE"),
    ('Retain <em x="https://links.test/NOISE">tail</em> NOISE', "NOISE"),
    ('Retain <em x="`">NOISE</em> ordinary `NOISE end', "NOISE"),
    ('Retain <!--`--> NOISE ordinary `NOISE end', "NOISE"),
    ('Retain https://links.test/retained\\<em x="`">NOISE</em> ordinary `NOISE end', "NOISE"),
    ("Retain [*h&#116;tps://links.test/retained*NOISE NOISE", "NOISE"),
    ("Retain [__h&#116;tps://links.test/retained__!NOISE NOISE", "NOISE"),
    ("Retain [*h&#116;tps://links.test/retained*NOISE<em>NOISE</em>", "NOISE"),
    ("Retain [*h&#116;tps://links.test/retained*NOISE\r\nNOISE", "NOISE"),
    ("Retain [*h&#116;tps://links.test/retained* retained", "*"),
    ("Retain [_h&#116;tps://links.test/retained_ retained", "_"),
    ("Retain [~h&#116;tps://links.test/retained~NOISE NOISE", "NOISE"),
    ("Retain [~~h&#116;tps://links.test/retained~~NOISE NOISE", "NOISE"),
    ("Retain [~h&#116;tps://links.test/retained~ retained", "~"),
    ("Retain [~~h&#116;tps://links.test/retained~~ retained", "~~"),
    ('[ref]: /retained "~*"\nRetain [a*b][ref] [*retained ~h&#116;tps://links.test/retained*NOISE~ NOISE', "NOISE"),
    ('[ref]: /retained "~*"\nRetain ![a*b][ref] [*retained ~h&#116;tps://links.test/retained*NOISE~ NOISE', "NOISE"),
    ("Retain [~www.links.test/retained~NOISE NOISE", "NOISE"),
    ("Retain [~w&#119;w.links.test/retained~NOISE NOISE", "NOISE"),
    ("Retain [~retained@links.test~NOISE NOISE", "NOISE"),
    ("Retain [~retained&commat;links.test~NOISE NOISE", "NOISE"),
])
def test_nonlink_attributes_trial_and_apply_remain_ordinary_candidates(client, source, literal):
    source = "合成 🧪\r\n\r\n" + source.replace("\n", "\r\n")
    config = {
        "name": "Synthetic label boundary", "match_value": literal,
        "case_sensitive": True, "matcher_mode": "EXACT",
        "boundary_mode": "ANYWHERE", "role_filter": "assistant",
    }
    created = client.post("/api/content-cleanup/rules", json=config)
    assert created.status_code == 201, created.text
    scan, messages = create_review(client, [source])
    trial = client.post("/api/content-cleanup/rules/trial", json=config)
    assert trial.status_code == 200, trial.text
    assert trial.json()["matches"] == 2 and trial.json()["protected_matches"] == 0
    assert all(not sample["protected"] for sample in trial.json()["samples"])
    prefix = f"/api/content-cleanup/scans/{scan}"
    rows = client.get(prefix + "/occurrences").json()
    assert len(rows) == 2 and all(row["decision"] == "KEEP" for row in rows)
    assert all("PROTECTED_RANGE" not in row["evidence_codes"] for row in rows)
    chosen = client.patch(prefix + "/decisions/filter", json={"decision": "DELETE", "all_matching": True})
    assert chosen.status_code == 200, chosen.text
    assert chosen.json()["matched"] == 2 and chosen.json()["skipped_protected"] == 0
    preview = client.get(prefix + "/preview").json()
    expected = source.replace(literal, "")
    assert preview["items"][0]["before"] == source
    assert preview["items"][0]["after"] == expected and not preview["items"][0]["conflict"]
    applied = client.post(prefix + "/apply", json={"preview_token": preview["preview_token"]})
    assert applied.status_code == 200 and applied.json() == {"applied": 2, "conflicts": 0}
    with session() as db:
        message = db.get(Message, messages[0])
        assert db.get(MessageVersion, message.current_version_id).display_text == expected
        assert db.query(MessageVersion).filter_by(message_id=message.id).count() == 2


@pytest.mark.parametrize("source", [
    "<div>\nh&#116;tps://links.test/NOISE `NOISE`\n</div>",
    "<pre>\n$NOISE$ [retained](/NOISE)\n</style>",
    "<widget>\n[^NOISE] [retained][NOISE]\n</widget>",
    "<!--\n[retained](/NOISE) $NOISE$\n-->",
])
def test_html_literal_fallback_trial_and_apply_preserve_the_complete_body(client, source):
    source = "合成 🧪\r\n\r\n" + source.replace("\n", "\r\n")
    config = {
        "name": "Synthetic HTML fallback", "match_value": "NOISE",
        "case_sensitive": True, "matcher_mode": "EXACT",
        "boundary_mode": "ANYWHERE", "role_filter": "assistant",
    }
    created = client.post("/api/content-cleanup/rules", json=config)
    assert created.status_code == 201, created.text
    scan, messages = create_review(client, [source])
    trial = client.post("/api/content-cleanup/rules/trial", json=config)
    assert trial.status_code == 200, trial.text
    assert trial.json()["matches"] == trial.json()["protected_matches"] == 2
    assert all(sample["protected"] for sample in trial.json()["samples"])
    prefix = f"/api/content-cleanup/scans/{scan}"
    rows = client.get(prefix + "/occurrences").json()
    assert len(rows) == 2 and all(row["decision"] == "PROTECTED" for row in rows)
    assert all("PROTECTED_RANGE" in row["evidence_codes"] for row in rows)
    chosen = client.patch(
        prefix + "/decisions/filter", json={"decision": "DELETE", "all_matching": True},
    )
    assert chosen.status_code == 200, chosen.text
    assert chosen.json()["matched"] == 0 and chosen.json()["skipped_protected"] == 2
    preview = client.get(prefix + "/preview").json()
    assert preview["items"] == []
    applied = client.post(prefix + "/apply", json={"preview_token": preview["preview_token"]})
    assert applied.status_code == 200 and applied.json() == {"applied": 0, "conflicts": 0}
    with session() as db:
        message = db.get(Message, messages[0])
        assert db.get(MessageVersion, message.current_version_id).display_text == source
        assert db.query(MessageVersion).filter_by(message_id=message.id).count() == 1


@pytest.mark.parametrize("source", [
    "Before `NOISE\\` after.",
    "Before ``NOISE\\`` after.",
    "- ```text\n  NOISE\n  ````",
    "> ~~~text\n> NOISE\n> ~~~~",
    "Synthetic retained.\n\n  \tNOISE",
    "> Synthetic retained.\n>\n>     NOISE",
    "Before `unclosed\n\nAfter `NOISE` end.",
    "# Heading `unclosed\nParagraph `NOISE`.",
    "- Before `unclosed\n- After `NOISE`.",
    '[safe](/links "retain ) NOISE")',
    '[safe](/links "retain\nNOISE")',
    "[safe](\n/links/NOISE\n)",
    "[safe](</links/)NOISE>)",
    r"[safe\]](/NOISE)",
    "[outer ![inner](/keep)](/NOISE)",
    "Keep [https://links.test/NOISE]",
    "Retain [unclosed\n\nRetain https://links.test/NOISE",
    'Retain <em x="`">tail</em> ordinary `NOISE` end',
    'Retain <!--`--> ordinary `NOISE` end',
    'Retain <?`?> ordinary `NOISE` end',
    'Retain <![CDATA[`]]> ordinary `NOISE` end',
    'Retain <em x="``">tail</em> ordinary ``NOISE`` end',
    'Retain `<a x="` earlier <em x=\'`\'>tail</em> ordinary `NOISE` end',
    'Retain [h&#116;tps://links.test/NOISE',
    'Retain [https&colon;&sol;&sol;links.test/NOISE',
    '$$\n<div>\nNOISE',
    '> $$$ meta\n> <div>\n> NOISE',
    '<div>\nretained\n\n`NOISE`',
    'Retain [*h&#116;tps://links.test/NOISE* retained',
    'Retain [__h&#116;tps://links.test/NOISE__ retained',
    'Retain [~h&#116;tps://links.test/NOISE~ retained',
    'Retain [~~h&#116;tps://links.test/NOISE~~ retained',
    'Retain [a*b](/retained) [~retained *h&#116;tps://links.test/NOISE~ retained*',
])
def test_legacy_syntax_choice_without_protection_evidence_cannot_bypass_revalidation(client, source):
    source = source.replace("NOISE", MARKER)
    scan, messages = create_review(client, [source])
    prefix = f"/api/content-cleanup/scans/{scan}"
    hit = client.get(prefix + "/occurrences").json()[0]
    assert hit["decision"] == "PROTECTED"
    with session() as db:
        original_version = db.get(Message, messages[0]).current_version_id
        row = db.get(ContentCleanupOccurrence, uuid.UUID(hit["id"]))
        # Emulate a pre-fix scan: neither stored decision nor evidence knows
        # that this source range belongs to protected Markdown syntax.
        row.decision = "KEEP"
        row.evidence_codes = [code for code in row.evidence_codes if code != "PROTECTED_RANGE"]
        row.protection_review = None
        db.commit()
    assert client.patch(prefix + "/decisions", json={
        "decisions": [{"occurrence_id": hit["id"], "decision": "DELETE"}],
    }).status_code == 422
    chosen = client.patch(prefix + "/decisions/filter", json={
        "decision": "DELETE", "all_matching": True,
    })
    assert chosen.status_code == 200, chosen.text
    assert chosen.json()["matched"] == 0 and chosen.json()["skipped_protected"] == 1
    with session() as db:
        row = db.get(ContentCleanupOccurrence, uuid.UUID(hit["id"]))
        row.decision = "DELETE"
        row.decision_updated_at = cleanup.utc_now()
        db.commit()
    preview = client.get(prefix + "/preview").json()
    assert preview["items"][0]["conflict"]
    assert preview["items"][0]["before"] == preview["items"][0]["after"] == source
    assert preview["items"][0]["removed_ranges"] == []
    applied = client.post(prefix + "/apply", json={"preview_token": preview["preview_token"]})
    assert applied.status_code == 200 and applied.json() == {"applied": 0, "conflicts": 1}
    with session() as db:
        message = db.get(Message, messages[0])
        assert message.current_version_id == original_version
        assert db.get(MessageVersion, original_version).display_text == source
        assert db.query(MessageVersion).filter_by(message_id=message.id).count() == 1


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
    "Before example" + " " * 1000 + "Cite turn12search4 after.",
    '"citation": ' + "x" * 150 + " Cite turn12search4 after.",
    "| lead Cite\nturn12search4 end |",
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
    "Before example" + " " * 1000 + "Cite turn12search4 after.",
    '"citation": ' + "x" * 150 + " Cite turn12search4 after.",
    "| lead Cite\nturn12search4 end |",
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


@pytest.mark.parametrize("source", [
    '[safe](/links "retain ) NOISE")',
    "[safe](</links/)NOISE>)",
    r"[sa\[fe](/NOISE)",
    "[[safe]](/NOISE)",
    "Keep [https://links.test/NOISE]",
    "Retain [unclosed\n\nRetain https://links.test/NOISE",
    'Retain <em x="`">tail</em> ordinary `NOISE` end',
    'Retain [h&#116;tps://links.test/NOISE',
    '$$\n<div>\nNOISE',
    '<div>\nretained\n\n`NOISE`',
    'Retain [*h&#116;tps://links.test/NOISE* retained',
    'Retain [__h&#116;tps://links.test/NOISE__ retained',
    'Retain [~h&#116;tps://links.test/NOISE~ retained',
    'Retain [~~h&#116;tps://links.test/NOISE~~ retained',
    'Retain [a*b](/retained) [~retained *h&#116;tps://links.test/NOISE~ retained*',
])
def test_link_attribute_candidates_can_apply_only_after_explicit_confirmation(client, source):
    source = source.replace("NOISE", MARKER)
    scan, messages = create_review(client, [source])
    prefix = f"/api/content-cleanup/scans/{scan}"
    row = client.get(prefix + "/occurrences").json()[0]
    assert row["decision"] == "PROTECTED"
    assert row["protection_types"] == ["markdown_code_link_or_math"]
    preview = client.post(prefix + "/protection-preview", json={"occurrence_ids": [row["id"]]}).json()
    assert preview["protected"] == preview["total"] == 1
    chosen = client.patch(prefix + "/decisions", json={
        "decisions": [{"occurrence_id": row["id"], "decision": "DELETE"}],
        "protection_token": preview["preview_token"],
    })
    assert chosen.status_code == 200
    diff = client.get(prefix + "/preview").json()
    result = client.post(prefix + "/apply", json={"preview_token": diff["preview_token"]})
    assert result.status_code == 200 and result.json() == {"applied": 1, "conflicts": 0}
    with session() as db:
        current = db.get(MessageVersion, db.get(Message, messages[0]).current_version_id)
        assert current.display_text == source[:row["start_offset"]] + source[row["end_offset"]:]


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize("marker", ["*", "~", "~~"])
def test_emphasis_rescan_reclassifies_old_false_protection_without_rewriting_snapshot(client, newline, marker):
    source = f"合成 🧪\n\nRetain [{marker}h&#116;tps://links.test/retained{marker}NOISE".replace("\n", newline)
    config = {
        "name": "Synthetic emphasis boundary", "match_value": "NOISE",
        "case_sensitive": True, "matcher_mode": "EXACT",
        "boundary_mode": "ANYWHERE", "role_filter": "assistant",
    }
    assert client.post("/api/content-cleanup/rules", json=config).status_code == 201
    scan, messages = create_review(client, [source])
    prefix = f"/api/content-cleanup/scans/{scan}"
    hit = client.get(prefix + "/occurrences").json()[0]
    assert hit["decision"] == "KEEP" and "PROTECTED_RANGE" not in hit["evidence_codes"]
    with session() as db:
        original_version = db.get(Message, messages[0]).current_version_id
        row = db.get(ContentCleanupOccurrence, uuid.UUID(hit["id"]))
        row.decision = "PROTECTED"
        row.evidence_codes = [*row.evidence_codes, "PROTECTED_RANGE"]
        db.commit()
    new_scan = client.post(prefix + "/rescan")
    assert new_scan.status_code == 202, new_scan.text
    complete_scan(new_scan.json()["id"])
    fresh = client.get(f"/api/content-cleanup/scans/{new_scan.json()['id']}/occurrences").json()
    assert len(fresh) == 1 and fresh[0]["decision"] == "KEEP"
    assert "PROTECTED_RANGE" not in fresh[0]["evidence_codes"]
    # The old ready snapshot and canonical text are not silently rewritten.
    old = client.get(prefix + "/occurrences").json()
    assert len(old) == 1 and old[0]["decision"] == "PROTECTED"
    assert "PROTECTED_RANGE" in old[0]["evidence_codes"]
    with session() as db:
        assert db.get(Message, messages[0]).current_version_id == original_version
        assert db.get(MessageVersion, original_version).display_text == source
        assert db.query(MessageVersion).filter_by(message_id=messages[0]).count() == 1


REFERENCE_REGISTRATION_PREFIXES = ["[a*b][ref]", "![a*b][ref]", "[a*b][missing]"]


def reference_registration_review(client, prefix, newline):
    source = (
        f"合成 🧪\n\nRetain {prefix} [~retained *h&#116;tps://links.test/NOISE~NOISE* retained"
        "\n\n[ref]: /retained"
    ).replace("\n", newline)
    config = {
        "name": "Synthetic reference boundary", "match_value": "NOISE",
        "case_sensitive": True, "matcher_mode": "EXACT",
        "boundary_mode": "ANYWHERE", "role_filter": "assistant",
    }
    assert client.post("/api/content-cleanup/rules", json=config).status_code == 201
    scan, messages = create_review(client, [source])
    trial = client.post("/api/content-cleanup/rules/trial", json=config)
    assert trial.status_code == 200, trial.text
    assert trial.json()["matches"] == trial.json()["protected_matches"] == 2
    path = f"/api/content-cleanup/scans/{scan}"
    rows = client.get(path + "/occurrences").json()
    assert len(rows) == 2 and all(row["decision"] == "PROTECTED" for row in rows)
    assert all("PROTECTED_RANGE" in row["evidence_codes"] for row in rows)
    return source, scan, messages, path, rows


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize("label", REFERENCE_REGISTRATION_PREFIXES)
def test_reference_registration_revalidates_the_formerly_unprotected_tail(client, newline, label):
    source, scan, messages, path, rows = reference_registration_review(client, label, newline)
    tail = rows[1]
    with session() as db:
        version = db.get(Message, messages[0]).current_version_id
        old = db.get(ContentCleanupOccurrence, uuid.UUID(tail["id"]))
        old.decision = "KEEP"
        old.evidence_codes = [code for code in old.evidence_codes if code != "PROTECTED_RANGE"]
        old.protection_review = None
        db.commit()
    assert client.patch(path + "/decisions", json={
        "decisions": [{"occurrence_id": tail["id"], "decision": "DELETE"}],
    }).status_code == 422
    bulk = client.patch(path + "/decisions/filter", json={"decision": "DELETE", "all_matching": True})
    assert bulk.status_code == 200 and bulk.json()["matched"] == 0
    assert bulk.json()["skipped_protected"] == 2
    with session() as db:
        old = db.get(ContentCleanupOccurrence, uuid.UUID(tail["id"]))
        old.decision = "DELETE"
        old.decision_updated_at = cleanup.utc_now()
        db.commit()
        assert cleanup.apply_scan(db, scan) == {"applied": 0, "conflicts": 1}
        db.commit()
        assert db.get(Message, messages[0]).current_version_id == version
        assert db.get(MessageVersion, version).display_text == source


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize("label", REFERENCE_REGISTRATION_PREFIXES)
def test_reference_registration_tail_requires_its_own_confirmation_before_apply(client, newline, label):
    source, _scan, messages, path, rows = reference_registration_review(client, label, newline)
    tail = rows[1]
    preview = client.post(path + "/protection-preview", json={"occurrence_ids": [tail["id"]]})
    assert preview.status_code == 200, preview.text
    assert preview.json()["total"] == preview.json()["protected"] == 1
    chosen = client.patch(path + "/decisions", json={
        "decisions": [{"occurrence_id": tail["id"], "decision": "DELETE"}],
        "protection_token": preview.json()["preview_token"],
    })
    assert chosen.status_code == 200
    diff = client.get(path + "/preview").json()
    expected = source[:tail["start_offset"]] + source[tail["end_offset"]:]
    assert diff["items"][0]["after"] == expected
    applied = client.post(path + "/apply", json={"preview_token": diff["preview_token"]})
    assert applied.status_code == 200 and applied.json() == {"applied": 1, "conflicts": 0}
    with session() as db:
        current = db.get(MessageVersion, db.get(Message, messages[0]).current_version_id)
        assert current.display_text == expected
        assert current.display_text.count("NOISE") == 1


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize("label", REFERENCE_REGISTRATION_PREFIXES[:2])
def test_reference_rescan_restores_protection_without_rewriting_old_snapshot(client, newline, label):
    source, _scan, messages, path, rows = reference_registration_review(client, label, newline)
    with session() as db:
        version = db.get(Message, messages[0]).current_version_id
        old = db.get(ContentCleanupOccurrence, uuid.UUID(rows[1]["id"]))
        old.decision = "KEEP"
        old.evidence_codes = [code for code in old.evidence_codes if code != "PROTECTED_RANGE"]
        db.commit()
    rescan = client.post(path + "/rescan")
    assert rescan.status_code == 202, rescan.text
    complete_scan(rescan.json()["id"])
    fresh = client.get(f"/api/content-cleanup/scans/{rescan.json()['id']}/occurrences").json()
    assert len(fresh) == 2 and all(row["decision"] == "PROTECTED" for row in fresh)
    assert all(not row["protection_confirmed"] for row in fresh)
    old = client.get(path + "/occurrences").json()
    assert [row["decision"] for row in old] == ["PROTECTED", "KEEP"]
    with session() as db:
        assert db.get(Message, messages[0]).current_version_id == version
        assert db.get(MessageVersion, version).display_text == source


LITERAL_AUTOLINK_ADDRESSES = [
    "www.links.test/NOISE", "w&#119;w.links.test/NOISE",
    "NOISE@links.test", "NOISE&commat;links.test",
]


def literal_autolink_review(client, address, newline):
    source = f"合成 🧪\n\nRetain [~{address}~NOISE retained".replace("\n", newline)
    config = {
        "name": "Synthetic literal autolink", "match_value": "NOISE",
        "case_sensitive": True, "matcher_mode": "EXACT",
        "boundary_mode": "ANYWHERE", "role_filter": "assistant",
    }
    assert client.post("/api/content-cleanup/rules", json=config).status_code == 201
    scan, messages = create_review(client, [source])
    trial = client.post("/api/content-cleanup/rules/trial", json=config)
    assert trial.status_code == 200, trial.text
    assert trial.json()["matches"] == 2 and trial.json()["protected_matches"] == 1
    path = f"/api/content-cleanup/scans/{scan}"
    rows = client.get(path + "/occurrences").json()
    assert [row["decision"] for row in rows] == ["PROTECTED", "KEEP"]
    assert ["PROTECTED_RANGE" in row["evidence_codes"] for row in rows] == [True, False]
    assert [source[row["start_offset"]:row["end_offset"]] for row in rows] == ["NOISE", "NOISE"]
    return source, scan, messages, path, rows


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize("address", LITERAL_AUTOLINK_ADDRESSES)
def test_literal_autolink_revalidates_legacy_choices_before_writing(client, address, newline):
    source, scan, messages, path, rows = literal_autolink_review(client, address, newline)
    with session() as db:
        version = db.get(Message, messages[0]).current_version_id
        row = db.get(ContentCleanupOccurrence, uuid.UUID(rows[0]["id"]))
        row.decision = "KEEP"
        row.evidence_codes = [code for code in row.evidence_codes if code != "PROTECTED_RANGE"]
        row.protection_review = None
        db.commit()
    assert client.patch(path + "/decisions", json={
        "decisions": [{"occurrence_id": rows[0]["id"], "decision": "DELETE"}],
    }).status_code == 422
    bulk = client.patch(path + "/decisions/filter", json={"decision": "DELETE", "all_matching": True})
    assert bulk.status_code == 200, bulk.text
    assert bulk.json()["matched"] == bulk.json()["skipped_protected"] == 1
    with session() as db:
        ordinary = db.get(ContentCleanupOccurrence, uuid.UUID(rows[1]["id"]))
        ordinary.decision = "KEEP"
        protected = db.get(ContentCleanupOccurrence, uuid.UUID(rows[0]["id"]))
        protected.decision = "DELETE"
        protected.decision_updated_at = cleanup.utc_now()
        db.commit()
        assert cleanup.apply_scan(db, scan) == {"applied": 0, "conflicts": 1}
        db.commit()
        assert db.get(Message, messages[0]).current_version_id == version
        assert db.get(MessageVersion, version).display_text == source
        assert db.query(MessageVersion).filter_by(message_id=messages[0]).count() == 1


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize("address", LITERAL_AUTOLINK_ADDRESSES)
def test_literal_autolink_requires_explicit_confirmation_for_its_exact_span(client, address, newline):
    source, _scan, messages, path, rows = literal_autolink_review(client, address, newline)
    protected = rows[0]
    preview = client.post(path + "/protection-preview", json={"occurrence_ids": [protected["id"]]})
    assert preview.status_code == 200 and preview.json()["protected"] == preview.json()["total"] == 1
    selected = client.patch(path + "/decisions", json={
        "decisions": [{"occurrence_id": protected["id"], "decision": "DELETE"}],
        "protection_token": preview.json()["preview_token"],
    })
    assert selected.status_code == 200, selected.text
    diff = client.get(path + "/preview").json()
    expected = source[:protected["start_offset"]] + source[protected["end_offset"]:]
    assert diff["items"][0]["after"] == expected
    applied = client.post(path + "/apply", json={"preview_token": diff["preview_token"]})
    assert applied.status_code == 200 and applied.json() == {"applied": 1, "conflicts": 0}
    with session() as db:
        current = db.get(MessageVersion, db.get(Message, messages[0]).current_version_id)
        assert current.display_text == expected
        assert current.display_text.count("NOISE") == 1


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize("address", LITERAL_AUTOLINK_ADDRESSES)
def test_literal_autolink_rescan_reclassifies_without_rewriting_old_snapshot(client, address, newline):
    source, _scan, messages, path, rows = literal_autolink_review(client, address, newline)
    with session() as db:
        version = db.get(Message, messages[0]).current_version_id
        row = db.get(ContentCleanupOccurrence, uuid.UUID(rows[0]["id"]))
        row.decision = "KEEP"
        row.evidence_codes = [code for code in row.evidence_codes if code != "PROTECTED_RANGE"]
        db.commit()
    rescan = client.post(path + "/rescan")
    assert rescan.status_code == 202, rescan.text
    complete_scan(rescan.json()["id"])
    fresh = client.get(f"/api/content-cleanup/scans/{rescan.json()['id']}/occurrences").json()
    assert [row["decision"] for row in fresh] == ["PROTECTED", "KEEP"]
    assert not fresh[0]["protection_confirmed"]
    old = client.get(path + "/occurrences").json()
    assert [row["decision"] for row in old] == ["KEEP", "KEEP"]
    with session() as db:
        assert db.get(Message, messages[0]).current_version_id == version
        assert db.get(MessageVersion, version).display_text == source
        assert db.query(MessageVersion).filter_by(message_id=messages[0]).count() == 1


CONTAINER_BOUNDARY_SOURCES = [
    '[ref]: /retained "first\n2. NOISE title"',
    "> > [ref]:\n> /NOISE",
    "Retain `first\n* \nNOISE`",
    '[ref]: /retained "first\n1) \nNOISE title"',
    "-\n\n  ```\nNOISE\n  ```",
    "> +\n>\n>   ```\n> NOISE\n>   ```",
]


def container_boundary_review(client, fragment, newline):
    source = ("合成 🧪\n\n" + fragment + "\n\nadjacent NOISE").replace("\n", newline)
    config = {
        "name": "Synthetic container boundary", "match_value": "NOISE",
        "case_sensitive": True, "matcher_mode": "EXACT",
        "boundary_mode": "ANYWHERE", "role_filter": "assistant",
    }
    assert client.post("/api/content-cleanup/rules", json=config).status_code == 201
    scan, messages = create_review(client, [source])
    trial = client.post("/api/content-cleanup/rules/trial", json=config)
    assert trial.status_code == 200, trial.text
    assert trial.json()["matches"] == 2 and trial.json()["protected_matches"] == 1
    path = f"/api/content-cleanup/scans/{scan}"
    rows = client.get(path + "/occurrences").json()
    assert [row["decision"] for row in rows] == ["PROTECTED", "KEEP"]
    assert ["PROTECTED_RANGE" in row["evidence_codes"] for row in rows] == [True, False]
    assert [source[row["start_offset"]:row["end_offset"]] for row in rows] == ["NOISE", "NOISE"]
    return source, scan, messages, path, rows


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize("fragment", CONTAINER_BOUNDARY_SOURCES)
def test_container_boundary_bulk_apply_leaves_protected_source_unchanged(client, fragment, newline):
    source, _scan, messages, path, rows = container_boundary_review(client, fragment, newline)
    selected = client.patch(path + "/decisions/filter", json={"decision": "DELETE", "all_matching": True})
    assert selected.status_code == 200
    assert selected.json()["matched"] == selected.json()["skipped_protected"] == 1
    diff = client.get(path + "/preview").json()
    ordinary = rows[1]
    expected = source[:ordinary["start_offset"]] + source[ordinary["end_offset"]:]
    assert diff["items"][0]["after"] == expected
    applied = client.post(path + "/apply", json={"preview_token": diff["preview_token"]})
    assert applied.status_code == 200 and applied.json() == {"applied": 1, "conflicts": 0}
    with session() as db:
        current = db.get(MessageVersion, db.get(Message, messages[0]).current_version_id)
        assert current.display_text == expected
        assert current.display_text.count("NOISE") == 1


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize("fragment", CONTAINER_BOUNDARY_SOURCES)
def test_container_boundary_legacy_delete_is_revalidated_before_write(client, fragment, newline):
    source, scan, messages, path, rows = container_boundary_review(client, fragment, newline)
    with session() as db:
        version = db.get(Message, messages[0]).current_version_id
        protected = db.get(ContentCleanupOccurrence, uuid.UUID(rows[0]["id"]))
        protected.decision = "KEEP"
        protected.evidence_codes = [code for code in protected.evidence_codes if code != "PROTECTED_RANGE"]
        protected.protection_review = None
        db.commit()
    assert client.patch(path + "/decisions", json={
        "decisions": [{"occurrence_id": rows[0]["id"], "decision": "DELETE"}],
    }).status_code == 422
    with session() as db:
        protected = db.get(ContentCleanupOccurrence, uuid.UUID(rows[0]["id"]))
        protected.decision = "DELETE"
        protected.decision_updated_at = cleanup.utc_now()
        db.commit()
        assert cleanup.apply_scan(db, scan) == {"applied": 0, "conflicts": 1}
        db.commit()
        assert db.get(Message, messages[0]).current_version_id == version
        assert db.get(MessageVersion, version).display_text == source
        assert db.query(MessageVersion).filter_by(message_id=messages[0]).count() == 1


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize("fragment", CONTAINER_BOUNDARY_SOURCES)
def test_container_boundary_requires_confirmation_for_the_exact_span(client, fragment, newline):
    source, _scan, messages, path, rows = container_boundary_review(client, fragment, newline)
    protected = rows[0]
    preview = client.post(path + "/protection-preview", json={"occurrence_ids": [protected["id"]]})
    assert preview.status_code == 200 and preview.json()["total"] == preview.json()["protected"] == 1
    selected = client.patch(path + "/decisions", json={
        "decisions": [{"occurrence_id": protected["id"], "decision": "DELETE"}],
        "protection_token": preview.json()["preview_token"],
    })
    assert selected.status_code == 200, selected.text
    diff = client.get(path + "/preview").json()
    expected = source[:protected["start_offset"]] + source[protected["end_offset"]:]
    assert diff["items"][0]["after"] == expected
    applied = client.post(path + "/apply", json={"preview_token": diff["preview_token"]})
    assert applied.status_code == 200 and applied.json() == {"applied": 1, "conflicts": 0}
    with session() as db:
        current = db.get(MessageVersion, db.get(Message, messages[0]).current_version_id)
        assert current.display_text == expected
        assert current.display_text.count("NOISE") == 1


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize("fragment", CONTAINER_BOUNDARY_SOURCES)
def test_container_boundary_rescan_keeps_old_snapshot_and_canonical_source(client, fragment, newline):
    source, _scan, messages, path, rows = container_boundary_review(client, fragment, newline)
    with session() as db:
        version = db.get(Message, messages[0]).current_version_id
        protected = db.get(ContentCleanupOccurrence, uuid.UUID(rows[0]["id"]))
        protected.decision = "KEEP"
        protected.evidence_codes = [code for code in protected.evidence_codes if code != "PROTECTED_RANGE"]
        db.commit()
    rescan = client.post(path + "/rescan")
    assert rescan.status_code == 202, rescan.text
    complete_scan(rescan.json()["id"])
    fresh = client.get(f"/api/content-cleanup/scans/{rescan.json()['id']}/occurrences").json()
    assert [row["decision"] for row in fresh] == ["PROTECTED", "KEEP"]
    assert not fresh[0]["protection_confirmed"]
    old = client.get(path + "/occurrences").json()
    assert [row["decision"] for row in old] == ["KEEP", "KEEP"]
    with session() as db:
        assert db.get(Message, messages[0]).current_version_id == version
        assert db.get(MessageVersion, version).display_text == source
        assert db.query(MessageVersion).filter_by(message_id=messages[0]).count() == 1


TABLE_BOUNDARY_SOURCES = [
    "left | `first\n--- | ---\nNOISE` | tail\n`NOISE` | tail",
    "left | right\n--- | ---\nwww.links.test/first|NOISE\n`NOISE` | tail",
]


def table_boundary_review(client, fragment, newline):
    source = ("合成 🧪\n\n" + fragment + "\n\nadjacent NOISE").replace("\n", newline)
    config = {
        "name": "Synthetic table boundary", "match_value": "NOISE",
        "case_sensitive": True, "matcher_mode": "EXACT",
        "boundary_mode": "ANYWHERE", "role_filter": "assistant",
    }
    assert client.post("/api/content-cleanup/rules", json=config).status_code == 201
    scan, messages = create_review(client, [source])
    trial = client.post("/api/content-cleanup/rules/trial", json=config)
    assert trial.status_code == 200, trial.text
    assert trial.json()["matches"] == 3 and trial.json()["protected_matches"] == 1
    path = f"/api/content-cleanup/scans/{scan}"
    rows = client.get(path + "/occurrences").json()
    assert [row["decision"] for row in rows] == ["KEEP", "PROTECTED", "KEEP"]
    assert ["PROTECTED_RANGE" in row["evidence_codes"] for row in rows] == [False, True, False]
    assert [source[row["start_offset"]:row["end_offset"]] for row in rows] == ["NOISE"] * 3
    return source, scan, messages, path, rows


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize("fragment", TABLE_BOUNDARY_SOURCES)
def test_table_boundary_bulk_apply_keeps_real_cell_code(client, fragment, newline):
    source, _scan, messages, path, rows = table_boundary_review(client, fragment, newline)
    selected = client.patch(path + "/decisions/filter", json={"decision": "DELETE", "all_matching": True})
    assert selected.status_code == 200
    assert selected.json()["matched"] == 2 and selected.json()["skipped_protected"] == 1
    expected = source
    for row in reversed([rows[0], rows[2]]):
        expected = expected[:row["start_offset"]] + expected[row["end_offset"]:]
    diff = client.get(path + "/preview").json()
    assert diff["items"][0]["after"] == expected
    applied = client.post(path + "/apply", json={"preview_token": diff["preview_token"]})
    assert applied.status_code == 200 and applied.json() == {"applied": 2, "conflicts": 0}
    with session() as db:
        current = db.get(MessageVersion, db.get(Message, messages[0]).current_version_id)
        assert current.display_text == expected and current.display_text.count("NOISE") == 1


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize("fragment", TABLE_BOUNDARY_SOURCES)
def test_table_boundary_revalidates_legacy_cell_code_before_write(client, fragment, newline):
    source, scan, messages, path, rows = table_boundary_review(client, fragment, newline)
    with session() as db:
        version = db.get(Message, messages[0]).current_version_id
        row = db.get(ContentCleanupOccurrence, uuid.UUID(rows[1]["id"]))
        row.decision = "KEEP"
        row.evidence_codes = []
        row.protection_review = None
        db.commit()
    assert client.patch(path + "/decisions", json={
        "decisions": [{"occurrence_id": rows[1]["id"], "decision": "DELETE"}],
    }).status_code == 422
    with session() as db:
        row = db.get(ContentCleanupOccurrence, uuid.UUID(rows[1]["id"]))
        row.decision = "DELETE"
        row.decision_updated_at = cleanup.utc_now()
        db.commit()
        assert cleanup.apply_scan(db, scan) == {"applied": 0, "conflicts": 1}
        db.commit()
        assert db.get(Message, messages[0]).current_version_id == version
        assert db.get(MessageVersion, version).display_text == source
        assert db.query(MessageVersion).filter_by(message_id=messages[0]).count() == 1


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize("fragment", TABLE_BOUNDARY_SOURCES)
def test_table_boundary_cell_code_requires_exact_confirmation(client, fragment, newline):
    source, _scan, messages, path, rows = table_boundary_review(client, fragment, newline)
    row = rows[1]
    preview = client.post(path + "/protection-preview", json={"occurrence_ids": [row["id"]]})
    assert preview.status_code == 200 and preview.json()["protected"] == preview.json()["total"] == 1
    chosen = client.patch(path + "/decisions", json={
        "decisions": [{"occurrence_id": row["id"], "decision": "DELETE"}],
        "protection_token": preview.json()["preview_token"],
    })
    assert chosen.status_code == 200, chosen.text
    diff = client.get(path + "/preview").json()
    expected = source[:row["start_offset"]] + source[row["end_offset"]:]
    assert diff["items"][0]["after"] == expected
    applied = client.post(path + "/apply", json={"preview_token": diff["preview_token"]})
    assert applied.status_code == 200 and applied.json() == {"applied": 1, "conflicts": 0}
    with session() as db:
        current = db.get(MessageVersion, db.get(Message, messages[0]).current_version_id)
        assert current.display_text == expected and current.display_text.count("NOISE") == 2


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize("fragment", TABLE_BOUNDARY_SOURCES)
def test_table_boundary_rescan_reclassifies_without_rewriting_history(client, fragment, newline):
    source, _scan, messages, path, rows = table_boundary_review(client, fragment, newline)
    with session() as db:
        version = db.get(Message, messages[0]).current_version_id
        row = db.get(ContentCleanupOccurrence, uuid.UUID(rows[0]["id"]))
        row.decision = "PROTECTED"
        row.evidence_codes = [*row.evidence_codes, "PROTECTED_RANGE"]
        db.commit()
    rescan = client.post(path + "/rescan")
    assert rescan.status_code == 202, rescan.text
    complete_scan(rescan.json()["id"])
    fresh = client.get(f"/api/content-cleanup/scans/{rescan.json()['id']}/occurrences").json()
    assert [row["decision"] for row in fresh] == ["KEEP", "PROTECTED", "KEEP"]
    assert ["PROTECTED_RANGE" in row["evidence_codes"] for row in fresh] == [False, True, False]
    assert not any(row["protection_confirmed"] for row in fresh)
    old = client.get(path + "/occurrences").json()
    assert [row["decision"] for row in old] == ["PROTECTED", "PROTECTED", "KEEP"]
    with session() as db:
        assert db.get(Message, messages[0]).current_version_id == version
        assert db.get(MessageVersion, version).display_text == source
        assert db.query(MessageVersion).filter_by(message_id=messages[0]).count() == 1
