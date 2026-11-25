"""Synthetic regressions for imported HTML cards in canonical Markdown."""

import copy
import uuid

import pytest

from app.services.editing.attachment_reference_rewriter import (
    assert_attachment_ids_mapped,
    attachment_block_ids,
    attachment_blocks_ids,
    attachment_html_ids,
    attachment_markdown_ids,
    attachment_source_references,
    html_attachment_references,
    markdown_reference_context,
    rewrite_attachment_block,
    rewrite_attachment_html,
    rewrite_attachment_markdown,
)


SOURCE_IDS = tuple(uuid.UUID(int=100 + index) for index in range(4))
TARGET_IDS = tuple(uuid.UUID(int=200 + index) for index in range(4))
MAPPING = dict(zip(SOURCE_IDS, TARGET_IDS))
HTML_CARDS = "\n".join(
    f'<div class="card"><a href="cr-asset://{SOURCE_IDS[index]}">File {index}</a></div>'
    if index % 2 == 0
    else f'<div class="card"><img src="cr-asset://{SOURCE_IDS[index]}" alt="Image {index}"></div>'
    for index in range(4)
)


def _mapped(source):
    for source_id, target_id in MAPPING.items():
        source = source.replace(str(source_id), str(target_id))
    return source


def _paragraph(text):
    return {"block_type": "paragraph", "plain_text": text, "data": {"text": text}, "sanitized_html": ""}


def _built_projections(source, *, include_spans=False):
    from app.services.canonical.block_builder import build_basic_render_blocks

    result = []
    for index, draft in enumerate(build_basic_render_blocks(source)):
        block = {
            "block_index": index,
            "block_type": draft.block_type,
            "plain_text": draft.plain_text,
            "data": draft.data,
            "sanitized_html": "",
        }
        if include_spans:
            block.update(source_start=draft.source_start, source_end=draft.source_end)
        result.append(block)
    return result


@pytest.mark.parametrize("wrapper", ["pre", "code", "comment"])
@pytest.mark.parametrize("real_sibling", [False, True])
def test_actual_builder_fragments_project_html_bindings_from_whole_source(wrapper, real_sibling):
    tag = f'<img src="cr-asset://{SOURCE_IDS[0]}" alt="same fragment">'
    literal = f"<!--\n\n{tag}\n\n-->" if wrapper == "comment" else f"<{wrapper}>\n\n{tag}\n\n</{wrapper}>"
    source = literal + ("\n\n" + tag if real_sibling else "")
    blocks = _built_projections(source)
    context = markdown_reference_context(source, blocks=blocks)
    expected = copy.deepcopy(blocks)
    if real_sibling:
        expected[-1]["plain_text"] = _mapped(tag)
        expected[-1]["data"]["text"] = _mapped(tag)
    assert attachment_blocks_ids(blocks, context) == ({SOURCE_IDS[0]} if real_sibling else set())
    assert attachment_block_ids(blocks[1], context) == set()
    assert [rewrite_attachment_block(block, MAPPING, context) for block in blocks] == expected
    # Repeated validation and reverse-order copying cannot move a shared cursor.
    assert [rewrite_attachment_block(block, MAPPING, context) for block in reversed(blocks)] == list(reversed(expected))


def test_ambiguous_html_fragment_without_block_context_fails_closed():
    tag = f'<img src="cr-asset://{SOURCE_IDS[0]}">'
    source = f"<pre>\n\n{tag}\n\n</pre>\n\n{tag}"
    context = markdown_reference_context(source)
    block = _paragraph(tag)
    with pytest.raises(ValueError, match="(?i)ambiguous.*source"):
        attachment_block_ids(block, context)
    with pytest.raises(ValueError, match="(?i)ambiguous.*source"):
        rewrite_attachment_block(block, MAPPING, context)


def test_actual_builder_source_ranges_disambiguate_identical_html_fragments():
    tag = f'<img src="cr-asset://{SOURCE_IDS[0]}">'
    source = f"<!--\n\n{tag}\n\n-->\n\n{tag}"
    blocks = _built_projections(source, include_spans=True)
    context = markdown_reference_context(source)
    assert attachment_block_ids(blocks[1], context) == set()
    assert rewrite_attachment_block(blocks[1], MAPPING, context) == blocks[1]
    assert attachment_block_ids(blocks[-1], context) == {SOURCE_IDS[0]}
    assert rewrite_attachment_block(blocks[-1], MAPPING, context)["data"]["text"] == _mapped(tag)


def test_ordered_html_projection_maps_crlf_source_to_lf_blocks():
    tag = f'<div>\r\n<img src="cr-asset://{SOURCE_IDS[0]}">\r\n</div>'
    source = f"<pre>\r\n\r\n{tag}\r\n\r\n</pre>\r\n\r\n{tag}"
    blocks = _built_projections(source)
    context = markdown_reference_context(source, blocks=blocks)
    expected_tag = tag.replace("\r\n", "\n")
    assert blocks[1]["data"]["text"] == expected_tag
    assert attachment_block_ids(blocks[1], context) == set()
    assert rewrite_attachment_block(blocks[1], MAPPING, context) == blocks[1]
    assert rewrite_attachment_block(blocks[-1], MAPPING, context)["data"]["text"] == _mapped(expected_tag)


def test_duplicate_fragments_with_identical_binding_positions_do_not_require_guessing():
    tag = f'<img src="cr-asset://{SOURCE_IDS[0]}">'
    context = markdown_reference_context(tag + "\n\n" + tag)
    assert attachment_block_ids(_paragraph(tag), context) == {SOURCE_IDS[0]}
    assert rewrite_attachment_block(_paragraph(tag), MAPPING, context) == _paragraph(_mapped(tag))


def test_fragment_not_present_in_whole_source_is_not_promoted_to_binding():
    tag = f'<img src="cr-asset://{SOURCE_IDS[0]}">'
    context = markdown_reference_context("No tag in this source.")
    with pytest.raises(ValueError, match="cannot be located"):
        rewrite_attachment_block(_paragraph(tag), MAPPING, context)


def test_incomplete_ordered_blocks_do_not_guess_between_literal_and_real():
    tag = f'<img src="cr-asset://{SOURCE_IDS[0]}">'
    block = {**_paragraph(tag), "block_index": 1}
    context = markdown_reference_context(f"<pre>\n\n{tag}\n\n</pre>\n\n{tag}", blocks=[block])
    with pytest.raises(ValueError, match="(?i)ambiguous.*source"):
        rewrite_attachment_block(block, MAPPING, context)


def test_four_html_card_bindings_are_found_in_source_and_paragraph_without_sanitized_html():
    context = markdown_reference_context(HTML_CARDS)
    block = _paragraph(HTML_CARDS)
    assert attachment_html_ids(HTML_CARDS) == set(SOURCE_IDS)
    assert attachment_markdown_ids(HTML_CARDS) == set(SOURCE_IDS)
    assert attachment_block_ids(block, context) == set(SOURCE_IDS)
    assert attachment_blocks_ids([block], context) == set(SOURCE_IDS)
    with pytest.raises(ValueError, match="cannot be mapped"):
        assert_attachment_ids_mapped(attachment_block_ids(block, context), {SOURCE_IDS[0]: TARGET_IDS[0]})


def test_four_html_cards_are_rewritten_in_every_canonical_projection_without_mutating_source():
    block = _paragraph(HTML_CARDS)
    original = copy.deepcopy(block)
    context = markdown_reference_context(HTML_CARDS)
    assert rewrite_attachment_markdown(HTML_CARDS, MAPPING) == _mapped(HTML_CARDS)
    assert rewrite_attachment_block(block, MAPPING, context) == _paragraph(_mapped(HTML_CARDS))
    assert block == original
    assert attachment_markdown_ids(_mapped(HTML_CARDS)) == set(TARGET_IDS)


@pytest.mark.parametrize("template", [
    "`{tag}`",
    "``before `{tag}` after``",
    "```html\n{tag}\n```",
    "~~~html\n{tag}\n~~~",
    "> ```html\n> {tag}\n> ```",
    "- ```html\n  {tag}\n  ```",
    "    {tag}",
    "\t{tag}",
    "\\{tag}",
    "&lt;a href=\"{url}\"&gt;example&lt;/a&gt;",
    "<!-- {tag} -->",
    "<!--\n{tag}\n-->",
    "<pre>{tag}</pre>",
    "before <pre>{tag}</pre> after",
    "<code>{tag}</code>",
    "<pre>\n{tag}\n</pre>",
    "<script>{tag}</script>",
    "<style>{tag}</style>",
    "<textarea>{tag}</textarea>",
    "<![CDATA[{tag}]]>",
    "<![CDATA[not closed by ]> {tag}]]>",
    "<?example {tag} ?>",
    "Literal URI {url}.",
    "The attributes href=\"{url}\" and src='{url}' are text, not tags.",
    '<span title=\'{tag}\'>attribute prose</span>',
])
def test_html_looking_literals_remain_byte_exact_and_do_not_create_bindings(template):
    url = f"cr-asset://{SOURCE_IDS[0]}"
    source = template.format(tag=f'<a href="{url}">example</a>', url=url)
    block = _paragraph(source)
    assert attachment_markdown_ids(source) == set()
    assert attachment_block_ids(block, markdown_reference_context(source)) == set()
    assert rewrite_attachment_markdown(source, MAPPING) == source
    assert rewrite_attachment_block(block, MAPPING, markdown_reference_context(source)) == block


def test_used_markdown_definitions_and_html_cards_share_canonical_reference_context():
    use = "[File][shared]"
    definition = f'[shared]: <cr-asset://{SOURCE_IDS[0]}?download=1#page> "label"'
    unused = f"[unused]: cr-asset://{SOURCE_IDS[1]}"
    source = "\n\n".join([use, HTML_CARDS, definition, unused])
    context = markdown_reference_context(source)
    blocks = [_paragraph(use), _paragraph(HTML_CARDS), _paragraph(definition), _paragraph(unused)]
    assert attachment_markdown_ids(source) == set(SOURCE_IDS)
    assert attachment_block_ids(blocks[0], context) == {SOURCE_IDS[0]}
    assert attachment_blocks_ids(blocks, context) == set(SOURCE_IDS)
    rewritten = [rewrite_attachment_block(block, MAPPING, context) for block in blocks]
    assert rewritten == [_paragraph(use), _paragraph(_mapped(HTML_CARDS)), _paragraph(_mapped(definition)), _paragraph(unused)]
    assert rewrite_attachment_markdown(source, MAPPING) == "\n\n".join([use, _mapped(HTML_CARDS), _mapped(definition), unused])


def test_code_blocks_and_non_markdown_metadata_are_not_html_projections():
    block = {"block_type": "code", "plain_text": HTML_CARDS, "data": {"code": HTML_CARDS}}
    metadata = {"block_type": "paragraph", "plain_text": "A label", "data": {"label": HTML_CARDS}}
    assert attachment_block_ids(block) == set()
    assert rewrite_attachment_block(block, MAPPING) == block
    assert attachment_block_ids(metadata) == set()
    assert rewrite_attachment_block(metadata, MAPPING) == metadata


@pytest.mark.parametrize("source", [
    '<a href="cr-asset://{id}?a=1&amp;b=2#preview">download</a>',
    "<IMG SRC='CR-ASSET://{id}' alt='image'/>",
    "<video poster=cr-asset://{id}>video</video>",
])
def test_html_attribute_rewrite_preserves_escaping_suffix_and_unmapped_source(source):
    source = source.format(id=SOURCE_IDS[0])
    expected = source.replace(f"CR-ASSET://{SOURCE_IDS[0]}", f"cr-asset://{TARGET_IDS[0]}")
    expected = expected.replace(str(SOURCE_IDS[0]), str(TARGET_IDS[0]))
    assert attachment_markdown_ids(source) == {SOURCE_IDS[0]}
    assert rewrite_attachment_markdown(source, MAPPING) == expected
    assert rewrite_attachment_markdown(source, {SOURCE_IDS[1]: TARGET_IDS[1]}) == source


def test_real_html_projection_keeps_comments_and_preformatted_examples():
    literal = f"<!-- {HTML_CARDS} --><pre>{HTML_CARDS}</pre><code>{HTML_CARDS}</code>"
    actual = f'<a href="cr-asset://{SOURCE_IDS[0]}">download</a>'
    assert attachment_html_ids(literal + actual) == {SOURCE_IDS[0]}
    assert rewrite_attachment_html(literal + actual, MAPPING) == literal + _mapped(actual)


def test_unified_refs_retain_source_offsets_lines_and_invalid_html_identities_for_write_validation():
    source = (
        "Synthetic source\r\n"
        f'<div><a href="cr-asset://{SOURCE_IDS[0]}?download=1#page">one</a>\r\n'
        '<img src="cr-asset://not-a-uuid"></div>\r\n\r\n'
        f"[two](cr-asset://{SOURCE_IDS[1]})"
    )
    refs = attachment_source_references(source)
    assert [ref.identifier for ref in refs] == [str(SOURCE_IDS[0]), "not-a-uuid", str(SOURCE_IDS[1])]
    assert [ref.line_number for ref in refs] == [2, 3, 5]
    assert [source[ref.start:ref.end] for ref in refs[:2]] == [
        f'<a href="cr-asset://{SOURCE_IDS[0]}?download=1#page">',
        '<img src="cr-asset://not-a-uuid">',
    ]
    assert [source[ref.destination_start:ref.destination_end] for ref in refs[:2]] == [
        f"cr-asset://{SOURCE_IDS[0]}?download=1#page", "cr-asset://not-a-uuid",
    ]
    with pytest.raises(ValueError):
        uuid.UUID(refs[1].identifier)


@pytest.mark.parametrize("identifier", ["", "missing", str(SOURCE_IDS[0]) + "trailing", "../file"])
def test_invalid_html_identities_are_not_silently_filtered_from_source_references(identifier):
    source = f'<a href="cr-asset://{identifier}">file</a>'
    refs = html_attachment_references(source)
    assert len(refs) == 1
    assert refs[0].identifier == identifier
    with pytest.raises(ValueError):
        uuid.UUID(refs[0].identifier)


def test_unified_refs_keep_original_markdown_query_contract():
    from app.services.editing.markdown_attachment_references import attachment_references

    source = f"[one](cr-asset://{SOURCE_IDS[0]}?download=1#page)"
    assert attachment_source_references(source) == attachment_references(source)


@pytest.mark.parametrize("source", [
    "<div>\n    <a href=\"cr-asset://{id}\">file</a>\n</div>",
    "<div>\n\t<img src=\"cr-asset://{id}\">\n</div>",
    "<div>\n```\n<a href=\"cr-asset://{id}\">file</a>\n```\n</div>",
    '<div title="a `literal` label"><a href="cr-asset://{id}">file</a></div>',
])
def test_html_block_children_are_not_mistaken_for_markdown_code(source):
    source = source.format(id=SOURCE_IDS[0])
    assert attachment_markdown_ids(source) == {SOURCE_IDS[0]}
    assert rewrite_attachment_markdown(source, MAPPING) == _mapped(source)


@pytest.mark.parametrize("source", [
    '<a href="cr&#45;asset://{id}?a=1&amp;b=2">file</a>',
    '<a href="cr-asset&#58;//{id}?a=1&amp;b=2">file</a>',
    '<a href="cr-asset&#x3a;//{id}?a=1&amp;b=2">file</a>',
    '<a href="cr-asset://&#48;0000000-0000-0000-0000-000000000064">file</a>',
])
def test_encoded_html_destinations_are_rewritten_without_rewriting_labels(source):
    source = source.format(id=SOURCE_IDS[0])
    expected_url = f"cr-asset://{TARGET_IDS[0]}" + ("?a=1&amp;b=2" if "?a=1" in source else "")
    expected = f'<a href="{expected_url}">file</a>'
    assert attachment_markdown_ids(source) == {SOURCE_IDS[0]}
    assert rewrite_attachment_markdown(source, MAPPING) == expected
    assert attachment_block_ids(_paragraph(expected)) == {TARGET_IDS[0]}
    assert rewrite_attachment_block(_paragraph(source), MAPPING) == _paragraph(expected)
    assert rewrite_attachment_markdown(source, {SOURCE_IDS[1]: TARGET_IDS[1]}) == source


def test_inline_code_after_a_closed_pre_does_not_mask_later_real_html():
    source = f"<pre>` unmatched in pre</pre>\n\n{HTML_CARDS}\n\n`code`"
    assert attachment_markdown_ids(source) == set(SOURCE_IDS)
    assert rewrite_attachment_markdown(source, MAPPING) == _mapped(source)


@pytest.mark.parametrize("literal", [
    "`<a href='{url}'>code</a>`",
    "\\<img src='{url}'>",
    "<!-- <img src='{url}'> -->",
    "<code><img src='{url}'></code>",
    "&lt;img src='{url}'&gt;",
    "href='{url}'",
])
def test_literal_and_real_html_in_same_paragraph_are_not_conflated(literal):
    literal = literal.format(url=f"cr-asset://{SOURCE_IDS[1]}")
    actual = f'<a href="cr-asset://{SOURCE_IDS[0]}">live</a>'
    source = "Before " + literal + " after " + actual
    assert attachment_markdown_ids(source) == {SOURCE_IDS[0]}
    assert [ref.identifier for ref in attachment_source_references(source)] == [str(SOURCE_IDS[0])]
    assert rewrite_attachment_markdown(source, MAPPING) == "Before " + literal + " after " + _mapped(actual)


def test_html_refs_preserve_repeated_occurrences_and_exact_unicode_crlf_coordinates():
    source = f'图像\r\n<div><a href="cr-asset://{SOURCE_IDS[0]}"><img src="cr-asset://{SOURCE_IDS[0]}"></a></div>'
    refs = attachment_source_references(source)
    assert len(refs) == 2
    assert [ref.identifier for ref in refs] == [str(SOURCE_IDS[0])] * 2
    assert [ref.line_number for ref in refs] == [2, 2]
    assert source[refs[0].start:refs[0].end] == f'<a href="cr-asset://{SOURCE_IDS[0]}">'
    assert source[refs[1].start:refs[1].end] == f'<img src="cr-asset://{SOURCE_IDS[0]}">'
    assert all(source[ref.destination_start:ref.destination_end] == f"cr-asset://{SOURCE_IDS[0]}" for ref in refs)


@pytest.mark.parametrize("literal", [
    "<![unknown]>",
    "<![unknown[<img src='cr-asset://{id}'>]]>",
    "<![unknown[<a href='cr-asset://{id}'>literal</a>]]>",
    "<![broken",
])
def test_unknown_marked_declarations_do_not_throw_or_hide_later_real_bindings(literal):
    literal = literal.format(id=SOURCE_IDS[1])
    # The incomplete form terminates at the following '>', before the real tag.
    if literal == "<![broken":
        literal += ">"
    actual = f'<a href="cr-asset://{SOURCE_IDS[0]}">live</a>'
    source = literal + "\n\n" + actual
    assert attachment_markdown_ids(source) == {SOURCE_IDS[0]}
    assert [ref.identifier for ref in attachment_source_references(source)] == [str(SOURCE_IDS[0])]
    assert rewrite_attachment_markdown(source, MAPPING) == literal + "\n\n" + _mapped(actual)
    assert attachment_html_ids(source) == {SOURCE_IDS[0]}
    assert rewrite_attachment_html(source, MAPPING) == literal + "\n\n" + _mapped(actual)


@pytest.mark.parametrize("literal", [
    """[Link](https://example.invalid "<img src='cr-asset://{id}'>")""",
    """[Link](https://example.invalid '<img src="cr-asset://{id}">')""",
    """![Image](https://example.invalid/image "<a href='cr-asset://{id}'>label</a>")""",
    """[Link][resource]\n\n[resource]: https://example.invalid "<img src='cr-asset://{id}'>" """,
    """[resource]: https://example.invalid '<img src="cr-asset://{id}">' """,
    """[Link](https://example.invalid "<![unknown[<img src='cr-asset://{id}'>]]>")""",
])
@pytest.mark.parametrize("with_later_binding", [False, True])
def test_markdown_link_titles_are_literal_without_hiding_later_html(literal, with_later_binding):
    literal = literal.format(id=SOURCE_IDS[1]).rstrip()
    actual = f'\n\n<a href="cr-asset://{SOURCE_IDS[0]}">live</a>' if with_later_binding else ""
    source = literal + actual
    expected_ids = {SOURCE_IDS[0]} if with_later_binding else set()
    assert attachment_markdown_ids(source) == expected_ids
    assert {uuid.UUID(ref.identifier) for ref in attachment_source_references(source)} == expected_ids
    assert attachment_block_ids(_paragraph(source)) == expected_ids
    assert rewrite_attachment_markdown(source, MAPPING) == literal + _mapped(actual)
    assert rewrite_attachment_block(_paragraph(source), MAPPING) == _paragraph(literal + _mapped(actual))
