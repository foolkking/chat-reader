"""Mapped keys agree with the runtime Unicode database, not a handpicked subset."""
import random
import re
import unicodedata

import pytest

from app.services import cleanup_normalization as normalization


def check(text, case_sensitive):
    expected = unicodedata.normalize("NFKC", text)
    if not case_sensitive:
        expected = expected.casefold()
    expected = re.sub(r"\s+", " ", expected)
    actual, mapping = normalization.normalized_shadow(text, case_sensitive=case_sensitive)
    assert actual == expected, repr(text)
    assert len(actual) == len(mapping)
    assert all(0 <= start < end <= len(text) for start, end in mapping)
    if actual:
        assert normalization.source_span(mapping, 0, len(mapping)) == (0, len(text))
    return actual, mapping


def test_every_normalization_sensitive_scalar_in_context(record_property):
    selected = comparisons = 0
    for ordinal in range(0x110000):
        char = chr(ordinal)
        if not (
            unicodedata.decomposition(char) or unicodedata.combining(char)
            or 0xAC00 <= ordinal <= 0xD7A3 or char.casefold() != char
        ):
            continue
        selected += 1
        for text in (char, "a" + char + "\u0315\u0300", "\u0315" + char + "\u0327\u0301"):
            for case_sensitive in (False, True):
                check(text, case_sensitive)
                comparisons += 1
    assert selected >= 17000
    record_property("unicode_version", unicodedata.unidata_version)
    record_property("sensitive_scalars", selected)
    record_property("shadow_comparisons", comparisons)


@pytest.mark.parametrize("case_sensitive", [False, True])
def test_mixed_normalization_and_reordering_differential_cases(case_sensitive):
    generator = random.Random(20261017)
    alphabet = "AaÉéßﬃＡ \r\n\t\u00a0🙂中文\u0315\u0300\u0327\u05b0\u1100\u1161\u11a8\u3131\u09c7\u09be\u0f73\u212b"
    for _ in range(1000):
        check("".join(generator.choices(alphabet, k=generator.randrange(129))), case_sensitive)


def test_reordered_leading_marks_are_not_assumed_to_have_monotonic_offsets():
    key, mapping = check("\u0315\u0300\u0327", True)
    assert key == "\u0327\u0300\u0315"
    assert mapping == [(2, 3), (1, 2), (0, 1)]
    assert normalization.source_span(mapping, 0, 3) == (0, 3)
    assert normalization.source_span(mapping, 0, 2) == (1, 3)


def test_composition_tracks_interleaved_atoms_and_casefold_expansion():
    key, mapping = check("a\u0327\u0301", True)
    assert key == "\u00e1\u0327" and mapping == [(0, 3), (1, 2)]
    assert normalization.source_span(mapping, 0, 1) == (0, 3)
    key, mapping = check("ßﬃ", False)
    assert key == "ssffi"
    assert mapping == [(0, 1), (0, 1), (1, 2), (1, 2), (1, 2)]


def test_equal_combining_classes_keep_their_source_order():
    source = "a\u0301\u0300"
    key, mapping = check(source, True)
    assert key == "\u00e1\u0300"
    assert mapping == [(0, 2), (2, 3)]
    key, mapping = check("\u0301\u0300", True)
    assert key == "\u0301\u0300" and mapping == [(0, 1), (1, 2)]


def test_already_normalized_text_does_not_build_decomposition_provenance(monkeypatch):
    def forbidden(*args):
        pytest.fail("Already-normalized text should use direct raw provenance.")
    monkeypatch.setattr(normalization, "_ordered_decomposition", forbidden)
    for text in ("ASCII \r\n whitespace", "中文🙂 café ß", " \t"):
        check(text, False)


def test_long_combining_run_never_normalizes_a_growing_unordered_prefix(monkeypatch, record_property):
    source = "a" + "\u0315\u0300" * 4096
    original = unicodedata.normalize
    calls = {"NFKD": 0, "NFD": 0, "NFC": 0}

    def measured(form, value):
        calls[form] += 1
        if form == "NFC":
            previous = 0
            for char in value:
                combining_class = unicodedata.combining(char)
                assert not combining_class or combining_class >= previous
                previous = combining_class
            assert len(value) <= 18 * len(source)
        else:
            assert len(value) == 1
        return original(form, value)

    with monkeypatch.context() as context:
        context.setattr(normalization.unicodedata, "normalize", measured)
        key, mapping = normalization.normalized_shadow(source, case_sensitive=True)
    assert key == original("NFKC", source)
    assert normalization.source_span(mapping, 0, len(mapping)) == (0, len(source))
    assert calls["NFC"] == 1 and sum(calls.values()) <= 2 * len(source) + 1
    for form, count in calls.items():
        record_property("normalize_calls_" + form, count)
