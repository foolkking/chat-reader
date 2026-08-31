from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.api.routes.attachments import MAX_RANGE_RESPONSE_BYTES, _resolve_range


def test_full_attachment_response_remains_available_without_range() -> None:
    size = MAX_RANGE_RESPONSE_BYTES * 3
    assert _resolve_range(None, size) == (0, size - 1, 200)


def test_open_and_explicit_ranges_are_bounded_to_one_response_window() -> None:
    size = MAX_RANGE_RESPONSE_BYTES * 3
    assert _resolve_range("bytes=0-", size) == (0, MAX_RANGE_RESPONSE_BYTES - 1, 206)
    start = MAX_RANGE_RESPONSE_BYTES + 17
    assert _resolve_range(f"bytes={start}-{size - 1}", size) == (
        start,
        start + MAX_RANGE_RESPONSE_BYTES - 1,
        206,
    )


def test_oversized_suffix_range_returns_only_the_last_bounded_window() -> None:
    size = MAX_RANGE_RESPONSE_BYTES * 3
    assert _resolve_range(f"bytes=-{size}", size) == (
        size - MAX_RANGE_RESPONSE_BYTES,
        size - 1,
        206,
    )


@pytest.mark.parametrize(
    "header",
    [
        "bytes=0-1,4-5",
        "bytes=-",
        "bytes=999999999999999999999-",
        "bytes=0-999999999999999999999",
    ],
)
def test_invalid_or_pathological_ranges_fail_with_416(header: str) -> None:
    with pytest.raises(HTTPException) as caught:
        _resolve_range(header, 1024)
    assert caught.value.status_code == 416
    assert caught.value.headers == {"Content-Range": "bytes */1024"}
