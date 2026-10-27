"""Bounded edit-distance correctness and work; synthetic, service-free inputs."""
import itertools
import sys
from types import SimpleNamespace

import pytest

from app.services import content_cleanup as cleanup


def _full_distance(left: str, right: str) -> int:
    """Independent unbanded matrix oracle, not the production recurrence."""
    matrix = [[0] * (len(right) + 1) for _ in range(len(left) + 1)]
    for row in range(len(left) + 1):
        matrix[row][0] = row
    for column in range(len(right) + 1):
        matrix[0][column] = column
    for row, a in enumerate(left, 1):
        for column, b in enumerate(right, 1):
            matrix[row][column] = min(
                matrix[row - 1][column] + 1,
                matrix[row][column - 1] + 1,
                matrix[row - 1][column - 1] + (a != b),
            )
    return matrix[-1][-1]


@pytest.mark.parametrize("alphabet", ["ab", "é🧪"])
@pytest.mark.parametrize("limit", [0, 1, 2, 3])
def test_bounded_distance_agrees_with_unbanded_oracle(alphabet, limit):
    strings = [
        "".join(chars)
        for width in range(5)
        for chars in itertools.product(alphabet, repeat=width)
    ]
    for left in strings:
        for right in strings:
            distance = _full_distance(left, right)
            assert cleanup._levenshtein_bounded(left, right, limit) == (
                distance if distance <= limit else None
            ), (left, right, limit)


@pytest.mark.parametrize("length", [128, 512, 2048])
@pytest.mark.parametrize("limit", [1, 2])
def test_bounded_distance_retains_only_edit_band(length, limit):
    left = ("abcdefg" * (length // 7 + 1))[:length]
    right = left[:-1] + "X"
    maximum_row = 0
    maximum_live = 0

    def measure(frame, event, _arg):
        nonlocal maximum_row, maximum_live
        if frame.f_code is cleanup._levenshtein_bounded.__code__:
            if event == "line":
                rows = [value for value in frame.f_locals.values() if isinstance(value, list)]
                if rows:
                    maximum_row = max(maximum_row, max(map(len, rows)))
                    maximum_live = max(maximum_live, sum(map(len, rows)))
            return measure
        return None

    prior_trace = sys.gettrace()
    sys.settrace(measure)
    try:
        assert cleanup._levenshtein_bounded(left, right, limit) == 1
    finally:
        sys.settrace(prior_trace)
    # Include sentinel cells; the width may depend on edit distance, not text length.
    assert maximum_row <= 2 * limit + 3
    assert maximum_live <= 2 * (2 * limit + 3)


@pytest.mark.parametrize("length", [128, 4096])
@pytest.mark.parametrize("limit", [0, 1, 2, 3])
def test_bounded_distance_rejects_failed_prefix_without_reading_full_candidate(length, limit):
    class CountedText(str):
        reads = 0

        def __getitem__(self, key):
            self.reads += 1
            return super().__getitem__(key)

    left = CountedText("a" * length)
    right = CountedText("b" * length)
    assert cleanup._levenshtein_bounded(left, right, limit) is None
    assert 0 < left.reads + right.reads <= (limit + 1) * (2 * limit + 1)


@pytest.mark.parametrize("limit", [1, 2])
@pytest.mark.parametrize("boundary", ["ANYWHERE", "WHOLE_LINE", "BLOCK_END"])
@pytest.mark.parametrize("newline", ["\n", "\r\n"])
def test_fuzzy_band_preserves_raw_unicode_ranges_and_protection(limit, boundary, newline):
    literal = "ＮＯＩＳＥ marker"
    fragment = "NOISE markeX" if limit == 1 else "NOISE marXXr"
    prefix = "合成 🧪" + newline + newline
    source = prefix + fragment + newline
    revision = SimpleNamespace(
        match_value=literal, matcher_mode="APPROXIMATE", case_sensitive=False,
        boundary_mode=boundary, max_edit_distance=limit,
    )
    hit, = cleanup.detect_occurrences(
        "assistant", source, SimpleNamespace(detector_id=None), revision,
    )
    assert (hit.start, hit.end) == (len(prefix), len(prefix) + len(fragment))
    assert source[hit.start:hit.end] == fragment
    assert (hit.reason_code, hit.match_mode, hit.decision) == (
        "USER_LITERAL_APPROXIMATE", "BOUNDED_FUZZY", "PROTECTED",
    )
    assert hit.evidence_codes == (
        "LITERAL_ANCHORED", f"EDIT_DISTANCE_{limit}", "UNCERTAIN_CONTEXT",
    )
