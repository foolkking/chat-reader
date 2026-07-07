from app.services.canonical.block_builder import build_basic_render_blocks


def test_plain_paragraph_builds_paragraph_block() -> None:
    blocks = build_basic_render_blocks("hello\nworld")

    assert len(blocks) == 1
    assert blocks[0].block_type == "paragraph"
    assert blocks[0].plain_text == "hello\nworld"


def test_heading_builds_heading_block() -> None:
    blocks = build_basic_render_blocks("# Title")

    assert len(blocks) == 1
    assert blocks[0].block_type == "heading"
    assert blocks[0].data == {"level": 1, "title": "Title"}


def test_fenced_code_builds_code_block() -> None:
    blocks = build_basic_render_blocks("```python\nprint('hi')\n```")

    assert len(blocks) == 1
    assert blocks[0].block_type == "code"
    assert blocks[0].data["language"] == "python"
    assert blocks[0].data["code"] == "print('hi')"


def test_empty_text_returns_no_blocks() -> None:
    assert build_basic_render_blocks("   ") == []
