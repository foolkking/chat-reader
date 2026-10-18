"""Shared detection keeps raw ranges and protection while bounding reuse."""
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
    counts = {"source": [], "protection": 0}
    original_shadow, original_protected = cleanup._shadow, cleanup.protected_ranges

    def measured_shadow(value, *, case_sensitive):
        if value is source:
            counts["source"].append(case_sensitive)
        return original_shadow(value, case_sensitive=case_sensitive)

    def measured_protected(value):
        counts["protection"] += 1
        return original_protected(value)

    monkeypatch.setattr(cleanup, "_shadow", measured_shadow)
    monkeypatch.setattr(cleanup, "protected_ranges", measured_protected)
    context = cleanup._DetectionContext(source)
    for _ in range(20):
        for case_sensitive in (False, True):
            matches = cleanup.detect_occurrences(
                "assistant", source, rule, revision("NOISE-token", case_sensitive=case_sensitive),
                context=context,
            )
            assert len(matches) == 2
            assert [item.decision for item in matches] == ["KEEP", "PROTECTED"]
    assert counts == {"source": [False, True], "protection": 1}


def test_unmatched_rules_do_not_build_a_protection_index(monkeypatch):
    def forbidden(_):
        pytest.fail("No candidates means there is no protection decision to evaluate.")

    monkeypatch.setattr(cleanup, "protected_ranges", forbidden)
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
