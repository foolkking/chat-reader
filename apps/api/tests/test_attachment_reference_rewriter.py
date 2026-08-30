import uuid

import pytest

from app.services.editing.attachment_reference_rewriter import (
    assert_attachment_references_mapped,
    attachment_data_ids,
    attachment_reference_ids,
    rewrite_attachment_data,
    rewrite_attachment_text,
)


SOURCE_ID = uuid.UUID("79a9b0b5-e3a1-4fd8-b9d4-3a8658ab8f8c")
TARGET_ID = uuid.UUID("2cf6e48c-00f2-4dd5-a80a-69e7b696c129")


def test_attachment_uri_rewrite_preserves_markdown_query_and_fragment() -> None:
    source_upper = str(SOURCE_ID).upper()
    text = (
        f"[download](CR-ASSET://{source_upper}?download=1) "
        f"and <cr-asset://{SOURCE_ID}#preview>"
    )

    rewritten = rewrite_attachment_text(text, {SOURCE_ID: TARGET_ID})

    assert rewritten == (
        f"[download](cr-asset://{TARGET_ID}?download=1) "
        f"and <cr-asset://{TARGET_ID}#preview>"
    )
    assert attachment_reference_ids(text) == {SOURCE_ID}


def test_nested_attachment_data_rewrites_structured_and_text_references() -> None:
    data = {
        "attachmentId": str(SOURCE_ID).upper(),
        "children": [
            {"src": f"cr-asset://{SOURCE_ID}?inline=true"},
            {"attachment_id": str(SOURCE_ID)},
        ],
    }

    rewritten = rewrite_attachment_data(data, {SOURCE_ID: TARGET_ID})

    assert rewritten["attachmentId"] == str(TARGET_ID)
    assert rewritten["children"][0]["src"] == f"cr-asset://{TARGET_ID}?inline=true"
    assert rewritten["children"][1]["attachment_id"] == str(TARGET_ID)
    assert attachment_data_ids(rewritten) == {TARGET_ID}


def test_unmapped_attachment_reference_fails_closed() -> None:
    text = f"No closing Markdown delimiter cr-asset://{SOURCE_ID} remains"

    with pytest.raises(ValueError, match="cannot be mapped during merge"):
        assert_attachment_references_mapped(text, {})

