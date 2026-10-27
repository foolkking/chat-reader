"""Small shared fixtures checked independently against the actual app renderer."""
import json
from pathlib import Path
import re
from types import SimpleNamespace

import pytest

from app.services.content_cleanup import detect_occurrences


FIXTURES = json.loads(
    (Path(__file__).resolve().parents[3] / "scripts/ux/fixtures/noise-renderer-protection.json")
    .read_text(encoding="utf-8")
)


@pytest.mark.parametrize("newline", ["\n", "\r\n"], ids=["LF", "CRLF"])
@pytest.mark.parametrize("fixture", FIXTURES, ids=lambda item: item["name"])
def test_noise_protection_agrees_with_application_renderer_fixture(fixture, newline):
    source = fixture["source"].replace("\n", newline)
    hits = detect_occurrences(
        "assistant",
        source,
        SimpleNamespace(detector_id=None),
        SimpleNamespace(
            match_value="NOISE", matcher_mode="EXACT", case_sensitive=True,
            boundary_mode="ANYWHERE", role_filter=None,
        ),
    )
    expected_spans = [match.span() for match in re.finditer("NOISE", source)]
    assert len(expected_spans) == len(fixture["protected"])
    assert [(hit.start, hit.end) for hit in hits] == expected_spans
    assert ["PROTECTED_RANGE" in hit.evidence_codes for hit in hits] == fixture["protected"]
    assert [hit.decision for hit in hits] == [
        "PROTECTED" if protected else "KEEP" for protected in fixture["protected"]
    ]
