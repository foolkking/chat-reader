"""Shared detection keeps raw ranges and protection while bounding reuse."""
import re
from types import SimpleNamespace

import pytest

from app.services import content_cleanup as cleanup


def revision(value, *, mode="NORMALIZED", case_sensitive=False, boundary="ANYWHERE"):
    return SimpleNamespace(
        match_value=value, matcher_mode=mode, case_sensitive=case_sensitive,
        boundary_mode=boundary, max_edit_distance=1,
    )


@pytest.mark.parametrize("source", [
    "🙂 Retained NOISE-token\r\nProtected `NOISE-token` and end.",
    "🙂 a\u0327\u0301 ＮＯＩＳＥ-token\r\nProtected `ＮＯＩＳＥ-token` and end.",
    " \tnoise-token \r\n[link](https://example.invalid/noise-token)\nnoise-token",
    " \u1100\u1161\u11a8 ß noise-token \r\n$$noise-token$$\nnoise-token",
])
@pytest.mark.parametrize("mode", ["EXACT", "NORMALIZED", "APPROXIMATE"])
@pytest.mark.parametrize("boundary", ["ANYWHERE", "WHOLE_LINE", "BLOCK_END"])
def test_reuse_is_identical_to_isolated_detection(source, mode, boundary):
    rule = SimpleNamespace(detector_id=None)
    context = cleanup._DetectionContext(source)
    for case_sensitive in (False, True, False):
        for value in ("noise-token", "NOISE-token", "a\u0327\u0301", "\uac01", "noisf-token"):
            config = revision(value, mode=mode, case_sensitive=case_sensitive, boundary=boundary)
            expected = cleanup.detect_occurrences("assistant", source, rule, config)
            assert cleanup.detect_occurrences("assistant", source, rule, config, context=context) == expected
    assert len(context._shadows) <= 2


def test_source_normalization_and_protection_are_once_per_message_profile(monkeypatch):
    source = "🙂 a\u0327\u0301 ＮＯＩＳＥ-token \r\nProtected `NOISE-token`."
    rule = SimpleNamespace(detector_id=None)
    counts = {"source": [], "protection": 0, "examples": 0}
    original_shadow, original_protected = cleanup._shadow, cleanup.protected_ranges
    original_examples = cleanup._ExplanatoryIndex

    def measured_shadow(value, *, case_sensitive):
        if value is source:
            counts["source"].append(case_sensitive)
        return original_shadow(value, case_sensitive=case_sensitive)

    def measured_protected(value):
        counts["protection"] += 1
        return original_protected(value)

    def measured_examples(value):
        assert value is source
        counts["examples"] += 1
        return original_examples(value)

    monkeypatch.setattr(cleanup, "_shadow", measured_shadow)
    monkeypatch.setattr(cleanup, "protected_ranges", measured_protected)
    monkeypatch.setattr(cleanup, "_ExplanatoryIndex", measured_examples)
    context = cleanup._DetectionContext(source)
    for _ in range(20):
        for case_sensitive in (False, True):
            matches = cleanup.detect_occurrences(
                "assistant", source, rule, revision("NOISE-token", case_sensitive=case_sensitive),
                context=context,
            )
            assert len(matches) == 2
            assert [item.decision for item in matches] == ["KEEP", "PROTECTED"]
    assert counts == {"source": [False, True], "protection": 1, "examples": 1}


def test_unmatched_rules_do_not_build_a_protection_index(monkeypatch):
    def forbidden(_):
        pytest.fail("No candidates means there is no protection decision to evaluate.")

    monkeypatch.setattr(cleanup, "protected_ranges", forbidden)
    monkeypatch.setattr(cleanup, "_ExplanatoryIndex", forbidden)
    assert cleanup.detect_occurrences(
        "assistant", "Retained ordinary text", SimpleNamespace(detector_id=None),
        revision("missing", mode="EXACT"),
    ) == []


def test_detection_context_is_not_reused_for_another_source():
    source = "NOISE-token"
    with pytest.raises(ValueError, match="different source"):
        cleanup.detect_occurrences(
            "assistant", source + " changed", SimpleNamespace(detector_id=None),
            revision(source), context=cleanup._DetectionContext(source),
        )


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize("kind", ["inline", "fenced", "mixed"])
@pytest.mark.parametrize("count", [64, 256])
def test_code_protection_does_not_revisit_all_previous_ranges(monkeypatch, record_property, newline, kind, count):
    """Count coordinate work, not machine-dependent elapsed-time thresholds."""
    segments = {
        "inline": ["Retain `value` text.\n"],
        "fenced": ["```text\nvalue\n```\n\n"],
        "mixed": [
            "Retain `value` text.\n\n",
            "> ```text\n> retained `tick`\n> ```\n\n",
            "Retain `tail` text.\n\n",
        ],
    }[kind]
    segments = [value.replace("\n", newline) for value in segments]
    source = "合成前缀 🧪" + newline * 2
    expected = []
    for _ in range(count):
        for segment in segments:
            offset = len(source)
            if "```" in segment:
                expected.append((offset, offset + segment.rindex("```") + 3))
            else:
                expected.append((offset + segment.index("`"), offset + segment.rindex("`") + 1))
            source += segment
    work = {"comparisons": 0}

    class Position(int):
        def __lt__(self, other):
            work["comparisons"] += 1
            return int.__lt__(self, other)

        def __le__(self, other):
            work["comparisons"] += 1
            return int.__le__(self, other)

        def __gt__(self, other):
            work["comparisons"] += 1
            return int.__gt__(self, other)

        def __ge__(self, other):
            work["comparisons"] += 1
            return int.__ge__(self, other)

    class MeasuredMatch:
        def __init__(self, match):
            self.match = match

        def __getattr__(self, name):
            return getattr(self.match, name)

        def start(self, *args):
            return Position(self.match.start(*args))

        def end(self, *args):
            return Position(self.match.end(*args))

        def group(self, *args):
            return self.match.group(*args)

    original = cleanup.re.finditer

    def measured_finditer(*args, **kwargs):
        return (MeasuredMatch(match) for match in original(*args, **kwargs))

    monkeypatch.setattr(cleanup.re, "finditer", measured_finditer)
    ranges = cleanup.protected_ranges(source)
    comparisons = work["comparisons"]
    assert ranges == expected
    record_property("coordinate_comparisons", comparisons)
    assert comparisons <= 64 * len(expected)


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize("kind", ["ordinary", "field", "table"])
@pytest.mark.parametrize("count", [64, 256])
def test_explanatory_review_does_not_copy_whole_line_per_hit(record_property, newline, kind, count):
    work = {"copied": 0}

    class MeasuredSource(str):
        def __getitem__(self, index):
            if isinstance(index, slice):
                work["copied"] += len(range(*index.indices(len(self))))
            return super().__getitem__(index)

    prefix, suffix = {"ordinary": ("", ""), "field": ("citation: ", ""), "table": ("| ", " |")}[kind]
    source = MeasuredSource("合成前缀 🧪" + newline * 2 + prefix + "Keep NOISE after. " * count + suffix)
    hits = cleanup.detect_occurrences(
        "assistant", source, SimpleNamespace(detector_id=None),
        revision("NOISE", mode="EXACT", case_sensitive=True),
    )
    copied = work["copied"]
    assert len(hits) == count
    assert {item.decision for item in hits} == {"KEEP" if kind == "ordinary" else "PROTECTED"}
    assert all(("UNCERTAIN_CONTEXT" in item.evidence_codes) == (kind != "ordinary") for item in hits)
    assert [source[item.start:item.end] for item in hits] == ["NOISE"] * count
    record_property("source_slice_codepoints", copied)
    assert copied <= 16 * len(source)


@pytest.mark.parametrize("prefix,match,suffix,protected", [
    ("Before Example: " + "x" * 99, "NOISE", "", True),
    ("Before Example: " + "x" * 100, "NOISE", "", False),
    ("Example" + " " * 1000, "NOISE", "", True),
    ("Example" + " " * 1000 + "x" * 101, "NOISE", "", False),
    ("Before examplexample" + "x" * 100, "NOISE", "", True),
    ("Before example" + "x" * 101, "NOISE", "", False),
    ("例如为" + "x" * 100, "NOISE", "", True),
    ("例如为" + "x" * 101, "NOISE", "", False),
    ("标记说明是", "NOISE", "", True),
    ("E.G.：", "NOISE", "", True),
    ("syntax\u2028\u00a0\t", "NOISE", "", True),
    ('"citation": ' + "x" * 1000, "NOISE", "", True),
    ("'citation': " + "x" * 1000, "NOISE", "", False),
    ('\u00a0引用.值-1"\t= ' + "x" * 1000, "NOISE", "", True),
    ("citation:", "NOISE", "", True),
    ("Plain prose: ", "NOISE", "", False),
    ("Example:\nplain ", "NOISE", "", False),
    ("citation:\r\nplain ", "NOISE", "", False),
    ("合成 🧪\r\n\r\nExample:\t", "NOISE", "", True),
    ("| lead ", "NOISE\nend", " |", True),
    ("| lead ", "NOISE\r\nend", " |", True),
    ("| lead ", "NOISE\nend", "", False),
    ("| | prior\nplain ", "NOISE", " tail", False),
    ("plain ", "NOISE", "\n| | later", False),
    ("| | prior", "\nNOISE", "", True),
    ("plain ", "NOISE\n", "| | later", True),
    ("plain ", "NOISE", "\n", False),
    ("Example", "\nNOISE", "", True),
    ("Example\n", "NOISE", "", False),
    ("", "example", "", False),
])
def test_explanatory_index_preserves_source_line_and_prefix_boundaries(prefix, match, suffix, protected):
    source = prefix + match + suffix
    start, end = len(prefix), len(prefix) + len(match)
    assert cleanup._ExplanatoryIndex(source).protects(start, end) is protected
    hits = cleanup.detect_occurrences(
        "assistant", source, SimpleNamespace(detector_id=None),
        revision(match, mode="EXACT", case_sensitive=True),
    )
    assert len(hits) == 1
    assert (hits[0].start, hits[0].end) == (start, end)
    assert hits[0].decision == ("PROTECTED" if protected else "KEEP")
    assert ("UNCERTAIN_CONTEXT" in hits[0].evidence_codes) is protected


def test_explanatory_code_retains_both_protection_evidence_codes():
    hits = cleanup.detect_occurrences(
        "assistant", "Example: `NOISE`", SimpleNamespace(detector_id=None),
        revision("NOISE", mode="EXACT", case_sensitive=True),
    )
    assert len(hits) == 1
    assert hits[0].decision == "PROTECTED"
    assert "PROTECTED_RANGE" in hits[0].evidence_codes
    assert "UNCERTAIN_CONTEXT" in hits[0].evidence_codes


def test_explanatory_indexes_are_not_shared_between_message_contexts(monkeypatch):
    original = cleanup._ExplanatoryIndex
    sources = []

    def measured(value):
        sources.append(value)
        return original(value)

    monkeypatch.setattr(cleanup, "_ExplanatoryIndex", measured)
    for source, expected in (("Example: NOISE", True), ("Ordinary NOISE", False)):
        context = cleanup._DetectionContext(source)
        for _ in range(3):
            assert context.explanatory(source.index("NOISE"), len(source)) is expected
    assert sources == ["Example: NOISE", "Ordinary NOISE"]


@pytest.mark.parametrize("keyword", [
    "示例", "例如", "比如", "字段", "语法", "标记说明",
    "example", "e.g.", "field", "syntax", "literal",
])
def test_explanatory_keyword_prefilter_preserves_every_unicode_initial(record_property, keyword):
    """Use the original full regex as oracle, without normalizing source."""
    reference = re.compile(
        r"(?=(示例|例如|比如|字段|语法|标记说明|example|e\.g\.|field|syntax|literal))",
        re.IGNORECASE,
    )
    tail = keyword[1:]
    # Small chunks bound test memory, including non-BMP and surrogate initials.
    for first in range(0, 0x110000, 4096):
        source = "".join(chr(point) + tail + "\n" for point in range(first, first + 4096))
        expected = [(match.span(), match.span(1)) for match in reference.finditer(source)]
        actual = [(match.span(), match.span(1)) for match in cleanup._EXAMPLE_KEYWORD.finditer(source)]
        assert actual == expected, f"keyword={keyword}, initial block U+{first:04X}"
    record_property("unicode_initial_codepoints", 0x110000)


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize("complete", [False, True])
@pytest.mark.parametrize("count", [128, 512])
def test_link_title_search_does_not_rescan_remaining_paragraph_per_opener(record_property, newline, complete, count):
    work = {"characters": 0}

    class MeasuredSource(str):
        def __getitem__(self, index):
            if isinstance(index, int):
                work["characters"] += 1
            return super().__getitem__(index)

    unit = "[safe](/links (NOISE" + ("))" if complete else "") + newline
    source = MeasuredSource("合成 🧪" + newline * 2 + unit * count)
    ranges = cleanup.protected_ranges(source)
    reads = work["characters"]
    hits = list(re.finditer("NOISE", str(source)))
    assert len(hits) == count
    assert all(any(start <= hit.start() and hit.end() <= end for start, end in ranges) for hit in hits)
    record_property("link_title_character_reads", reads)
    assert reads <= 32 * len(source)


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize("count", [128, 512])
def test_link_titles_reuse_a_shared_failed_closing_tail(record_property, newline, count):
    work = {"characters": 0}

    class MeasuredSource(str):
        def __getitem__(self, index):
            if isinstance(index, int):
                work["characters"] += 1
            return super().__getitem__(index)

    source = MeasuredSource(
        "合成 🧪" + newline * 2 + ("[safe](/links (NOISE" + newline) * count
        + ")" + " " * (count * 32) + "retained"
    )
    ranges = cleanup.protected_ranges(source)
    reads = work["characters"]
    hits = list(re.finditer("NOISE", str(source)))
    assert len(hits) == count
    assert all(any(start <= hit.start() and hit.end() <= end for start, end in ranges) for hit in hits)
    record_property("link_tail_character_reads", reads)
    assert reads <= 32 * len(source)


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize("kind", ["closed_labels", "inactive_outer_labels"])
@pytest.mark.parametrize("count", [128, 512])
def test_link_labels_do_not_rescan_the_prefix_per_closing_marker(record_property, newline, kind, count):
    work = {"codepoints": 0}

    class MeasuredSource(str):
        def __getitem__(self, index):
            result = super().__getitem__(index)
            work["codepoints"] += 1 if isinstance(index, int) else len(result)
            return result

    prefix = "合成 🧪" + newline * 2
    expected = []
    if kind == "closed_labels":
        source = prefix + ("[safe] retained." + newline + "](/NOISE) retained." + newline) * count
    else:
        prefix += "[" * count
        unit = "[safe](/NOISE) retained." + newline
        source = prefix + unit * count + ("](/NOISE) retained." + newline) * count
        expected = [
            (len(prefix) + index * len(unit) + unit.index("]("),
             len(prefix) + index * len(unit) + unit.index(")") + 1)
            for index in range(count)
        ]
    source = MeasuredSource(source)
    assert cleanup.protected_ranges(source) == expected
    record_property("label_source_codepoints_read", work["codepoints"])
    assert work["codepoints"] <= 32 * len(source)


@pytest.mark.parametrize("count", [128, 512, 2048])
@pytest.mark.parametrize("kind", ["tokenizer_tail", "fallback_tail", "failed_heads"])
def test_gfm_urls_do_not_copy_or_count_the_full_prefix_per_closing_parenthesis(
    record_property, count, kind,
):
    work = {"codepoints": 0}

    class MeasuredSource(str):
        def __getitem__(self, index):
            result = super().__getitem__(index)
            work["codepoints"] += 1 if isinstance(index, int) else len(result)
            return result

        def count(self, value, start=0, end=None):
            end = len(self) if end is None else end
            work["codepoints"] += max(0, end - start)
            return super().count(value, start, end)

    url = "https://links.test/NOISE"
    if kind == "failed_heads":
        source = MeasuredSource("https://bad_domain.test/" * count + "NOISE")
        expected = []
    else:
        prefix = "[" if kind == "fallback_tail" else ""
        source = MeasuredSource(prefix + url + ")" * count + "." * count + " retained")
        expected = [(len(prefix), len(prefix) + len(url))]
    assert cleanup.protected_ranges(source) == expected
    record_property("url_source_codepoints_read", work["codepoints"])
    assert work["codepoints"] <= 32 * len(source)


@pytest.mark.parametrize("count", [128, 512])
@pytest.mark.parametrize("kind", ["entity_tail", "invalid_encoded_heads", "url_code_order"])
def test_gfm_decoded_provenance_and_code_order_do_not_rescan_shared_source(
    record_property, count, kind,
):
    work = {"codepoints": 0}

    class MeasuredSource(str):
        def __getitem__(self, index):
            result = super().__getitem__(index)
            work["codepoints"] += 1 if isinstance(index, int) else len(result)
            return result

    url = "https://links.test/NOISE"
    if kind == "entity_tail":
        prefix = "Retain ["
        source = MeasuredSource(prefix + url + "&amp;" * count + " retained")
        expected = [(len(prefix), len(prefix) + len(url))]
    elif kind == "invalid_encoded_heads":
        source = MeasuredSource("[" + "https://bad_domain.test/&#33;" * count + " retained")
        expected = []
    else:
        unit = "Retain https://links.test/`NOISE keep` retained.\n\n"
        source = MeasuredSource(unit * count)
        expected = [
            (index * len(unit) + unit.index("https://"), index * len(unit) + unit.index(" keep"))
            for index in range(count)
        ]
    assert cleanup.protected_ranges(source) == expected
    record_property("decoded_url_source_codepoints_read", work["codepoints"])
    assert work["codepoints"] <= 32 * len(source)


@pytest.mark.parametrize("count", [128, 512])
@pytest.mark.parametrize("kind", [
    "encoded_heads", "encoded_prefixes", "incomplete_html_quotes",
    "incomplete_comments", "html_partitions",
])
def test_gfm_text_node_partitioning_reuses_decoding_and_html_closers(
    record_property, count, kind,
):
    work = {"codepoints": 0}

    class MeasuredSource(str):
        def __getitem__(self, index):
            result = super().__getitem__(index)
            work["codepoints"] += 1 if isinstance(index, int) else len(result)
            return result

        def find(self, value, start=0, end=None):
            end = len(self) if end is None else end
            result = super().find(value, start, end)
            work["codepoints"] += (end if result < 0 else result + len(value)) - start
            return result

    url = "h&#116;tps://links.test/NOISE"
    prefix = "Retain ["
    if kind == "encoded_heads":
        source = "h&#116;tps://bad_domain.test/" * count + " retained"
        expected = []
    elif kind == "encoded_prefixes":
        source = ("[&#65;https://links.test/NOISE retained.\n\n") * count
        expected = []
    elif kind == "incomplete_html_quotes":
        source = prefix + url + '<em a="' * count + " retained"
        expected = [(len(prefix), len(prefix + url + "<em"))]
    elif kind == "incomplete_comments":
        source = prefix + url + "<!--" * count + " retained"
        expected = [(len(prefix), len(source) - len(" retained"))]
    else:
        unit = prefix + url + '<em x="retained">tail</em> retained.\n\n'
        source = unit * count
        expected = [
            (index * len(unit) + len(prefix), index * len(unit) + len(prefix + url))
            for index in range(count)
        ]
    source = MeasuredSource(source)
    assert cleanup.protected_ranges(source) == expected
    record_property("text_node_source_codepoints_read", work["codepoints"])
    # Counts explicit source reads plus find's inspected prefixes, not every
    # regex/decoded-array operation or peak process memory.
    assert work["codepoints"] <= 32 * len(source)


@pytest.mark.parametrize("count", [128, 512])
@pytest.mark.parametrize("kind", [
    "entities_without_slashes", "unknown_refs_without_slashes",
    "mixed_url_and_entities", "slash_but_no_url",
])
def test_gfm_protocol_slash_origin_precheck_avoids_unnecessary_shadows(
    monkeypatch, record_property, count, kind,
):
    original = cleanup._markdown_text_shadow
    calls = []

    def measured(text, start, end):
        calls.append((start, end))
        return original(text, start, end)

    monkeypatch.setattr(cleanup, "_markdown_text_shadow", measured)
    if kind == "mixed_url_and_entities":
        prefix = "Retain ["
        url = "h&#116;tps://NOISE.links.test"
        source = prefix + url + " retained. " + "&amp; " * count
        expected = [(len(prefix), len(prefix + url))]
        expected_calls = 1
    else:
        unit = {
            "entities_without_slashes": "Retain &amp; text.\n",
            "unknown_refs_without_slashes": "Retain &bogus; \\! text.\n",
            "slash_but_no_url": "Retain &amp;/ text.\n",
        }[kind]
        source = unit * count
        expected = []
        expected_calls = count if kind == "slash_but_no_url" else 0
    assert cleanup.protected_ranges(source) == expected
    assert len(calls) == expected_calls
    record_property("protocol_shadow_constructions", len(calls))


@pytest.mark.parametrize("count", [128, 512])
@pytest.mark.parametrize("with_url", [False, True])
def test_inline_html_code_precedence_does_not_revisit_source_per_tick(
    record_property, count, with_url,
):
    work = {"codepoints": 0}

    class MeasuredSource(str):
        def __getitem__(self, index):
            result = super().__getitem__(index)
            work["codepoints"] += 1 if isinstance(index, int) else len(result)
            return result

        def find(self, value, start=0, end=None):
            end = len(self) if end is None else end
            result = super().find(value, start, end)
            work["codepoints"] += (end if result < 0 else result + len(value)) - start
            return result

    prefix = "Retain [h&#116;tps://links.test/retained" if with_url else "Retain "
    unit = prefix + '<em x="`">tail</em> ordinary `NOISE` end.\n\n'
    expected = []
    for index in range(count):
        offset = index * len(unit)
        if with_url:
            expected.append((offset + len("Retain ["), offset + len(prefix)))
        start = offset + unit.index("`NOISE`")
        expected.append((start, start + len("`NOISE`")))
    assert cleanup.protected_ranges(MeasuredSource(unit * count)) == expected
    record_property("html_code_source_codepoints_read", work["codepoints"])
    assert work["codepoints"] <= 32 * len(unit) * count


@pytest.mark.parametrize("count", [128, 512])
@pytest.mark.parametrize("kind", ["closed_flow", "blank_flow", "inline_comment", "math_flow"])
def test_html_flow_exclusions_bound_repeated_source_reads(record_property, count, kind):
    work = {"codepoints": 0}

    class MeasuredSource(str):
        def __getitem__(self, index):
            result = super().__getitem__(index)
            work["codepoints"] += 1 if isinstance(index, int) else len(result)
            return result

        def find(self, value, start=0, end=None):
            end = len(self) if end is None else end
            result = super().find(value, start, end)
            work["codepoints"] += (end if result < 0 else result + len(value)) - start
            return result

    body = "[retained](/NOISE) $NOISE$ h&#116;tps://links.test/NOISE"
    unit = {
        "closed_flow": f"<!--\n{body}\n-->\nRetain `NOISE`\n\n",
        "blank_flow": f"<div>\n{body}\n\nRetain `NOISE`\n\n",
        "inline_comment": f"Retain <!--{body}--> ordinary `NOISE`\n\n",
        "math_flow": f"$$\n<div>\nNOISE\n$$\nRetain `NOISE`\n\n",
    }[kind]
    expected = []
    for index in range(count):
        offset = index * len(unit)
        if kind == "math_flow":
            expected.append((offset, offset + unit.index("\n$$") + 3))
        elif kind == "closed_flow":
            expected.append((offset, offset + unit.index("-->") + 4))
        elif kind == "blank_flow":
            expected.append((offset, offset + unit.index("\n\n") + 1))
        start = offset + unit.index("`NOISE`")
        expected.append((start, start + len("`NOISE`")))
    assert cleanup.protected_ranges(MeasuredSource(unit * count)) == expected
    record_property("html_flow_source_codepoints_read", work["codepoints"])
    # Explicit indexed/sliced source and inspected find prefixes only; not
    # regex/group internals, expanded-line work, decoded arrays or process RSS.
    assert work["codepoints"] <= 48 * len(unit) * count


@pytest.mark.parametrize("count", [128, 512])
@pytest.mark.parametrize("kind", ["paired", "nested", "unmatched", "rule_of_three"])
def test_emphasis_fallback_does_not_revisit_source_per_closer(record_property, count, kind):
    work = {"codepoints": 0}

    class MeasuredSource(str):
        def __getitem__(self, index):
            result = super().__getitem__(index)
            work["codepoints"] += 1 if isinstance(index, int) else len(result)
            return result

        def find(self, value, start=0, end=None):
            end = len(self) if end is None else end
            result = super().find(value, start, end)
            work["codepoints"] += (end if result < 0 else result + len(value)) - start
            return result

    url = "h&#116;tps://links.test/NOISE"
    if kind == "rule_of_three":
        prefix = "Retain [" + " **a" * count + " b*a" * count + " "
        source = prefix + url + " retained"
        expected = [(len(prefix), len(prefix + url))]
    else:
        marker = "***" if kind == "nested" else "*"
        prefix = "Retain [" + ("" if kind == "unmatched" else marker)
        unit = prefix + url + marker + "NOISE retained.\n\n"
        source = unit * count
        tail = marker + "NOISE" if kind == "unmatched" else ""
        expected = [
            (index * len(unit) + len(prefix), index * len(unit) + len(prefix + url + tail))
            for index in range(count)
        ]
    assert cleanup.protected_ranges(MeasuredSource(source)) == expected
    record_property("emphasis_source_codepoints_read", work["codepoints"])
    # Explicit source reads only, not regex internals, bucket operations or RSS.
    assert work["codepoints"] <= 48 * len(source)


@pytest.mark.parametrize("count", [128, 512])
@pytest.mark.parametrize("kind", ["paired", "crossing", "invalid_run", "deep_nested"])
def test_strikethrough_fallback_bounds_source_reads_without_recursive_resolution(record_property, count, kind):
    work = {"codepoints": 0}

    class MeasuredSource(str):
        def __getitem__(self, index):
            result = super().__getitem__(index)
            work["codepoints"] += 1 if isinstance(index, int) else len(result)
            return result

        def find(self, value, start=0, end=None):
            end = len(self) if end is None else end
            result = super().find(value, start, end)
            work["codepoints"] += (end if result < 0 else result + len(value)) - start
            return result

    url = "h&#116;tps://links.test/NOISE"
    if kind == "deep_nested":
        prefix = "Retain [" + "~retained *retained " * count
        source = prefix + url + "*~" * count + " NOISE retained"
        expected = [(len(prefix), len(prefix + url))]
    else:
        marker = "~~~" if kind == "invalid_run" else "~~" if kind == "paired" else "~"
        prefix = "Retain [" + marker + ("retained *" if kind == "crossing" else "")
        unit = prefix + url + marker + "NOISE" + ("*" if kind == "crossing" else "") + " retained.\n\n"
        source = unit * count
        tail = marker + "NOISE" if kind == "invalid_run" else ""
        expected = [
            (index * len(unit) + len(prefix), index * len(unit) + len(prefix + url + tail))
            for index in range(count)
        ]
    assert cleanup.protected_ranges(MeasuredSource(source)) == expected
    record_property("strikethrough_source_codepoints_read", work["codepoints"])
    # Indexed/sliced source and find prefixes only, not all bucket/regex work
    # or peak RSS. The nested control also exercises nonrecursive resolution.
    assert work["codepoints"] <= 64 * len(source)


@pytest.mark.parametrize("count", [128, 512])
@pytest.mark.parametrize("kind", ["full", "undefined", "long_id", "definition_inert"])
def test_reference_resolution_bounds_explicit_source_reads(record_property, count, kind):
    work = {"codepoints": 0}

    class MeasuredSource(str):
        def __getitem__(self, index):
            result = super().__getitem__(index)
            work["codepoints"] += 1 if isinstance(index, int) else len(result)
            return result

        def find(self, value, start=0, end=None):
            end = len(self) if end is None else end
            result = super().find(value, start, end)
            work["codepoints"] += (end if result < 0 else result + len(value)) - start
            return result

    if kind == "definition_inert":
        definition = "[ref]: /retained`"
        unit = "Retain `NOISE` NOISE retained.\n\n"
        prefix = definition + "\n\n"
        source = prefix + unit * count
        expected = [(0, len(definition))] + [
            (len(prefix) + index * len(unit) + 7, len(prefix) + index * len(unit) + 14)
            for index in range(count)
        ]
    else:
        identifier = "r" * 1000 if kind == "long_id" else "ref"
        label = f"[a*b][{identifier}]"
        prefix = f"Retain {label} [~retained *"
        url = "h&#116;tps://links.test/NOISE"
        unit = prefix + url + "~NOISE* retained.\n\n"
        definition = f"[{'other' if kind == 'undefined' else identifier}]: /retained"
        source = unit * count + definition
        expected = []
        for index in range(count):
            offset = index * len(unit)
            expected.extend([
                (offset + 7, offset + 7 + len(label)),
                (offset + len(prefix), offset + len(prefix + url + "~NOISE")),
            ])
        expected.append((len(unit) * count - 1, len(source)))
    assert cleanup.protected_ranges(MeasuredSource(source)) == expected
    record_property("reference_source_codepoints_read", work["codepoints"])
    # Includes explicit source reads/find prefixes, not regex internals,
    # total bucket work, every possible input or process RSS.
    assert work["codepoints"] <= 80 * len(source)


@pytest.mark.parametrize("count", [128, 512])
@pytest.mark.parametrize("kind", [
    "www_valid", "email_valid", "www_failed", "www_fallback_failed", "email_retry", "email_chain",
])
def test_literal_autolink_families_bound_explicit_source_reads(record_property, count, kind):
    work = {"codepoints": 0}

    class MeasuredSource(str):
        def __getitem__(self, index):
            result = super().__getitem__(index)
            work["codepoints"] += 1 if isinstance(index, int) else len(result)
            return result

        def find(self, value, start=0, end=None):
            end = len(self) if end is None else end
            result = super().find(value, start, end)
            work["codepoints"] += (end if result < 0 else result + len(value)) - start
            return result

    if kind in ("www_valid", "email_valid"):
        prefix = "Retain " if kind == "www_valid" else "Retain ["
        address = "www.links.test/NOISE" if kind == "www_valid" else "NOISE&commat;links.test"
        unit = prefix + address + " NOISE retained.\n\n"
        source = unit * count
        expected = [
            (index * len(unit) + len(prefix), index * len(unit) + len(prefix + address))
            for index in range(count)
        ]
    elif kind == "www_failed":
        source = "Retain " + "_www." * count + "bad_domain.test/NOISE NOISE"
        expected = []
    elif kind == "www_fallback_failed":
        source = "Retain [" + "www." * count + "bad_domain.test/NOISE NOISE"
        expected = []
    elif kind == "email_retry":
        source = "Retain [漢字" + "a." * count + "NOISE&commat;links.test0 NOISE"
        expected = []
    else:
        prefix = "Retain ["
        unit = "NOISE&commat;links.test."
        source = prefix + unit * count + "NOISE"
        expected = [
            (
                len(prefix) if index == 0 else len(prefix) + (2 * index - 1) * len(unit) + len("NOISE&commat;"),
                len(prefix) + (2 * index + 1) * len(unit) + len("NOISE"),
            )
            for index in range(count // 2)
        ]
    assert cleanup.protected_ranges(MeasuredSource(source)) == expected
    record_property("autolink_source_codepoints_read", work["codepoints"])
    # Explicit source indexing/slicing/find-prefix reads only. Regex internals,
    # decoded-text work, bucket work and process RSS are not measured here.
    assert work["codepoints"] <= 64 * len(source)
