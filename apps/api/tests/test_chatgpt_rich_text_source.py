import pytest

from app.services.canonical.block_builder import build_basic_render_blocks, extract_markdown_tasks
from app.services.import_pipeline.exporter_markdown_parser import parse_exporter_markdown


@pytest.mark.parametrize("body", [
    '<box border radius="xl"><text>**Synthetic focus**</text><divider color="subtle"/></box>',
    "\\# Synthetic heading\n\n"
    "\\\\\\<box padding={3}>\n"
    "&#x20; \\\\\\<text>\\\\\\*\\\\\\*Synthetic focus\\\\\\*\\\\\\*\\\\\\</text>\n"
    "\\\\\\</box>\n\n1\\. Synthetic step",
    "```html\n<box><text>Synthetic code example</text></box>\n```\n\n"
    "- [ ] Synthetic task",
])
def test_rich_export_import_and_block_building_preserve_canonical_source(body: str) -> None:
    transcript = "# Synthetic transcript\n\n## Prompt\nSynthetic question\n\n## Response\n" + body
    parsed = parse_exporter_markdown(transcript)
    assert parsed.section_count == 2
    assert parsed.sections[1].markdown_text == body
    before = parsed.sections[1].content_hash
    blocks = build_basic_render_blocks(parsed.sections[1].markdown_text)
    assert blocks
    assert parsed.sections[1].markdown_text == body
    assert parsed.sections[1].content_hash == before
    assert all("chatGptRichTextProfile" not in block.data for block in blocks)
    if "- [ ]" in body:
        tasks = extract_markdown_tasks(body)
        assert len(tasks) == 1
        assert body[tasks[0].checked_offset] == " "
        assert tasks[0].label == "Synthetic task"
