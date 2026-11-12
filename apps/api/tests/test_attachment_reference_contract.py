import json
from pathlib import Path
import pytest
from app.services.editing.markdown_attachment_references import attachment_references

CASES = json.loads((Path(__file__).resolve().parents[3] / "scripts/fixtures/attachment-reference-cases.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("fixture", CASES, ids=lambda item: item["name"])
def test_shared_grammar(fixture):
    refs = attachment_references(fixture["source"], fixture.get("scheme", "cr-asset"))
    assert len(refs) == fixture["count"]
    for ref in refs:
        assert fixture["source"][ref.start:ref.end].startswith(("[", "!["))
