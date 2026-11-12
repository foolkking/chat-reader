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


def test_markdown_rewrite_preserves_literal_bytes_and_updates_used_definition_once():
    from app.services.editing.attachment_reference_rewriter import attachment_markdown_ids, rewrite_attachment_markdown
    literals = f"`[example](cr-asset://{SOURCE_ID})`\r\n\r\n```md\r\ncr-asset://{SOURCE_ID}\r\n```\r\n\r\n"
    source = literals + f"[图][shared] and ![图][shared]\r\n\r\n[shared]: <CR-ASSET://{str(SOURCE_ID).upper()}?x=1#view> \"标题\"\r\n"
    assert attachment_markdown_ids(source) == {SOURCE_ID}
    assert rewrite_attachment_markdown(source, {SOURCE_ID: TARGET_ID}) == (
        literals + f"[图][shared] and ![图][shared]\r\n\r\n[shared]: <cr-asset://{TARGET_ID}?x=1#view> \"标题\"\r\n"
    )


def test_html_projection_only_remaps_real_attributes_not_escaped_examples():
    from app.services.editing.attachment_reference_rewriter import attachment_html_ids, rewrite_attachment_html
    unknown = uuid.uuid4()
    literal = f"<pre>&lt;a href=\"cr-asset://{unknown}\"&gt;</pre><code>cr-asset://{SOURCE_ID}</code>"
    source = literal + f'<a href="cr-asset://{SOURCE_ID}?a=1&amp;b=2">File</a><img src=\'cr-asset://{SOURCE_ID}\'/>'
    assert attachment_html_ids(source) == {SOURCE_ID}
    assert rewrite_attachment_html(source, {SOURCE_ID: TARGET_ID}) == (
        literal + f'<a href="cr-asset://{TARGET_ID}?a=1&amp;b=2">File</a><img src=\'cr-asset://{TARGET_ID}\'/>'
    )


def test_projection_uses_canonical_definition_context_and_keeps_code_payload_literal():
    from app.services.editing.attachment_reference_rewriter import (
        attachment_blocks_ids, markdown_reference_context, rewrite_attachment_block,
    )
    source = f"[File][x]\n\n[x]: cr-asset://{SOURCE_ID}"
    context = markdown_reference_context(source)
    blocks = [
        {"block_type": "paragraph", "plain_text": "[File][x]", "data": {"text": "[File][x]"}},
        {"block_type": "paragraph", "plain_text": f"[x]: cr-asset://{SOURCE_ID}", "data": {"text": f"[x]: cr-asset://{SOURCE_ID}"}},
        {"block_type": "code", "plain_text": f"[x]: cr-asset://{SOURCE_ID}", "data": {"code": source}},
    ]
    assert attachment_blocks_ids(blocks, context) == {SOURCE_ID}
    rewritten = [rewrite_attachment_block(block, {SOURCE_ID: TARGET_ID}, context) for block in blocks]
    assert rewritten[0] == blocks[0]
    assert rewritten[1]["data"]["text"] == f"[x]: cr-asset://{TARGET_ID}"
    assert rewritten[2] == blocks[2]
