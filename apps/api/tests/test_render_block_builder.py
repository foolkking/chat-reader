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


def test_fenced_code_accepts_exporter_attributes() -> None:
    blocks = build_basic_render_blocks(
        '```ts id="c8s69a" title="Experiment"\nconst run: ExperimentRun = {};\n```\n\nAfter code.'
    )

    assert [block.block_type for block in blocks] == ["code", "paragraph"]
    assert blocks[0].data == {
        "language": "ts",
        "code": "const run: ExperimentRun = {};",
        "metadata": {"id": "c8s69a", "title": "Experiment"},
    }
    assert blocks[1].plain_text == "After code."


def test_tilde_and_long_fences_require_matching_closer() -> None:
    blocks = build_basic_render_blocks("~~~~typescript title=demo\n```\nconst value = 1;\n~~~~~")

    assert len(blocks) == 1
    assert blocks[0].block_type == "code"
    assert blocks[0].data["language"] == "typescript"
    assert blocks[0].data["code"] == "```\nconst value = 1;"


def test_unclosed_attribute_fence_is_safe() -> None:
    blocks = build_basic_render_blocks("```powershell id=setup\npnpm typecheck")

    assert len(blocks) == 1
    assert blocks[0].data["language"] == "powershell"
    assert blocks[0].data["closed"] is False
    assert blocks[0].data["metadata"] == {"id": "setup"}


def test_empty_text_returns_no_blocks() -> None:
    assert build_basic_render_blocks("   ") == []


def test_thinking_summary_paragraph_is_collapsed_by_default() -> None:
    blocks = build_basic_render_blocks("> 已思考 9s\n> checking approach")

    assert len(blocks) == 1
    assert blocks[0].block_type == "paragraph"
    assert blocks[0].collapsed_by_default is True


def test_english_thinking_marker_is_collapsed_by_default() -> None:
    blocks = build_basic_render_blocks("Reasoning:\nchecking approach")

    assert len(blocks) == 1
    assert blocks[0].collapsed_by_default is True


def test_plain_paragraph_is_not_collapsed_by_default() -> None:
    blocks = build_basic_render_blocks("This answer discusses thinking as a topic.")

    assert len(blocks) == 1
    assert blocks[0].collapsed_by_default is False
