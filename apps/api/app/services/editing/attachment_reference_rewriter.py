"""Shared, fail-closed rewriting for conversation attachment references."""

import re
import uuid
import html
from bisect import bisect_left, bisect_right
from dataclasses import dataclass, field, replace
from html.parser import HTMLParser
from typing import Any

from app.services.editing.markdown_attachment_references import (
    AttachmentReference, attachment_definitions, attachment_references,
)

_ATTACHMENT_ID_KEYS = {"attachmentId", "attachment_id"}


ASSET_REFERENCE_RE = re.compile(
    r"cr-asset://(?P<id>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})",
    re.IGNORECASE,
)


def rewrite_attachment_text(value: str, attachment_id_map: dict[uuid.UUID, uuid.UUID]) -> str:
    if not value or not attachment_id_map:
        return value

    def replace(match: re.Match[str]) -> str:
        source_id = uuid.UUID(match.group("id"))
        target_id = attachment_id_map.get(source_id)
        return f"cr-asset://{target_id}" if target_id is not None else match.group(0)

    return ASSET_REFERENCE_RE.sub(replace, value)


def attachment_reference_ids(value: Any) -> set[uuid.UUID]:
    found: set[uuid.UUID] = set()
    if isinstance(value, str):
        found.update(uuid.UUID(match.group("id")) for match in ASSET_REFERENCE_RE.finditer(value))
    elif isinstance(value, list):
        for item in value:
            found.update(attachment_reference_ids(item))
    elif isinstance(value, dict):
        for item in value.values():
            found.update(attachment_reference_ids(item))
    return found


def attachment_data_ids(value: Any) -> set[uuid.UUID]:
    """Collect URI and structured attachment IDs from block data or HTML."""
    found: set[uuid.UUID] = set()
    if isinstance(value, str):
        found.update(uuid.UUID(match.group("id")) for match in ASSET_REFERENCE_RE.finditer(value))
    elif isinstance(value, list):
        for item in value:
            found.update(attachment_data_ids(item))
    elif isinstance(value, dict):
        for key, item in value.items():
            if key in _ATTACHMENT_ID_KEYS:
                try:
                    found.add(uuid.UUID(str(item)))
                except (TypeError, ValueError):
                    pass
            found.update(attachment_data_ids(item))
    return found


def assert_attachment_references_mapped(value: Any, attachment_id_map: dict[uuid.UUID, uuid.UUID]) -> None:
    """Reject copied data that still points at an attachment outside the copy set."""
    if isinstance(value, str):
        for match in ASSET_REFERENCE_RE.finditer(value):
            source_id = uuid.UUID(match.group("id"))
            if source_id not in attachment_id_map:
                raise ValueError(f"Attachment reference {source_id} cannot be mapped during merge.")
        return
    if isinstance(value, list):
        for item in value:
            assert_attachment_references_mapped(item, attachment_id_map)
        return
    if isinstance(value, dict):
        for key in _ATTACHMENT_ID_KEYS:
            raw_id = value.get(key)
            if not raw_id:
                continue
            try:
                source_id = uuid.UUID(str(raw_id))
            except (TypeError, ValueError):
                continue
            if source_id not in attachment_id_map:
                raise ValueError(f"Attachment id {source_id} cannot be mapped during merge.")
        for item in value.values():
            assert_attachment_references_mapped(item, attachment_id_map)


def rewrite_attachment_data(value: Any, attachment_id_map: dict[uuid.UUID, uuid.UUID]) -> Any:
    if isinstance(value, list):
        return [rewrite_attachment_data(item, attachment_id_map) for item in value]
    if isinstance(value, dict):
        output = {key: rewrite_attachment_data(item, attachment_id_map) for key, item in value.items()}
        for key in _ATTACHMENT_ID_KEYS:
            attachment_id = output.get(key)
            try:
                source_id = uuid.UUID(str(attachment_id)) if attachment_id else None
            except (TypeError, ValueError):
                source_id = None
            if source_id in attachment_id_map:
                output[key] = str(attachment_id_map[source_id])
        return output
    if isinstance(value, str):
        return rewrite_attachment_text(value, attachment_id_map)
    return value


@dataclass(frozen=True)
class MarkdownReferenceContext:
    definitions: dict[str, tuple[str, int, int]]
    used_labels: frozenset[str]
    source: str | None = None
    html_references: tuple[AttachmentReference, ...] = ()
    projection_source: str | None = None
    projection_html_references: tuple[AttachmentReference, ...] = ()
    block_spans: dict[int, tuple[int, int]] = field(default_factory=dict)
    block_scope: tuple[int, int] | None = None


def _projection_text(source: str) -> str:
    # Stored block text joins source lines with LF; no whitespace or HTML
    # normalization is permitted when matching a source fragment.
    return source.replace("\r\n", "\n").replace("\r", "\n")


def _removed_cr(source: str) -> list[int]:
    return [match.start() for match in re.finditer("\r(?=\n)", source)]


def _projection_offset(offset: int, removed: list[int]) -> int:
    return offset - bisect_left(removed, offset)


def _block_anchor(block: dict) -> str:
    data = block.get("data") or {}
    if isinstance(data, dict):
        for key in ("text", "title", "code"):
            if isinstance(data.get(key), str) and data[key]:
                return _projection_text(data[key])
    value = block.get("plain_text")
    return _projection_text(value) if isinstance(value, str) else ""


def _ordered_block_spans(source: str, blocks: list[dict]) -> dict[int, tuple[int, int]]:
    """Locate persisted projections without rebuilding or changing blocks.

    Earliest and latest monotone alignments must agree. This prevents an
    incomplete/ambiguous sequence from guessing which duplicate was literal.
    Unresolved blocks use the same fail-closed fragment resolver as callers
    without a complete block sequence.
    """
    anchors = [
        (block.get("block_index", ordinal), _block_anchor(block))
        for ordinal, block in enumerate(blocks) if isinstance(block, dict)
    ]
    anchors = [(index, text) for index, text in anchors if text]
    if len({index for index, _ in anchors}) != len(anchors):
        raise ValueError("Ambiguous block indices in attachment source context.")
    earliest: dict[int, tuple[int, int]] = {}
    cursor = 0
    for index, text in anchors:
        start = source.find(text, cursor)
        if start < 0:
            return {}
        earliest[index] = (start, start + len(text))
        cursor = start + len(text)
    latest = {}
    cursor = len(source)
    for index, text in reversed(anchors):
        start = source.rfind(text, 0, cursor)
        if start < 0:
            return {}
        latest[index] = (start, start + len(text))
        cursor = start
    return {index: span for index, span in earliest.items() if latest[index] == span}


def markdown_reference_context(source: str, *, blocks: list[dict] | None = None) -> MarkdownReferenceContext:
    """Resolve whole-source syntax once; optional blocks must be complete and ordered."""
    references = tuple(html_attachment_references(source))
    projected_source = _projection_text(source)
    removed = _removed_cr(source)
    projected_refs = references if not removed else tuple(replace(
        ref, start=_projection_offset(ref.start, removed), end=_projection_offset(ref.end, removed),
        destination_start=_projection_offset(ref.destination_start, removed),
        destination_end=_projection_offset(ref.destination_end, removed),
    ) for ref in references)
    return MarkdownReferenceContext(
        attachment_definitions(source),
        frozenset(ref.definition_label for ref in attachment_references(source) if ref.definition_label is not None),
        source, references, projected_source, projected_refs,
        _ordered_block_spans(projected_source, blocks) if blocks else {},
    )


def _block_reference_context(block: dict, context: MarkdownReferenceContext | None):
    if context is None or context.source is None:
        return context
    start, end = block.get("source_start"), block.get("source_end")
    if isinstance(start, int) and isinstance(end, int):
        if not 0 <= start <= end <= len(context.source):
            raise ValueError("Attachment block source range is invalid.")
        removed = _removed_cr(context.source)
        span = (_projection_offset(start, removed), _projection_offset(end, removed))
    else:
        span = context.block_spans.get(block.get("block_index"))
    return replace(context, block_scope=span)


def _project_html_references(value: str, context: MarkdownReferenceContext | None):
    if context is None or context.source is None:
        return html_attachment_references(value)
    if value == context.source and context.block_scope is None:
        return context.html_references
    if "<" not in value or "cr-asset" not in html.unescape(value).lower():
        return ()
    source = context.projection_source
    fragment = _projection_text(value)
    lower, upper = context.block_scope or (0, len(source))
    signature = None
    cursor = lower
    while (start := source.find(fragment, cursor, upper)) >= 0:
        end = start + len(fragment)
        references = context.projection_html_references
        first = bisect_left(references, start, key=lambda ref: ref.start)
        last = bisect_left(references, end, key=lambda ref: ref.start)
        current = tuple(
            (ref.identifier, ref.start - start, ref.end - start,
             ref.destination_start - start, ref.destination_end - start)
            for ref in references[first:last] if ref.end <= end
        )
        if signature is not None and signature != current:
            raise ValueError("Ambiguous attachment fragment source context.")
        signature = current
        cursor = start + 1
    if signature is None:
        # A typed text projection that cannot be tied to its source must never
        # promote an HTML-looking literal to a live attachment.
        raise ValueError("Attachment fragment cannot be located in its source context.")
    removed = _removed_cr(value)
    normalized_removals = [position - index for index, position in enumerate(removed)]

    def original(offset):
        return offset + bisect_left(normalized_removals, offset)

    return tuple(AttachmentReference(
        identifier, original(start), original(end), value.count("\n", 0, original(start)) + 1,
        original(destination_start), original(destination_end),
    ) for identifier, start, end, destination_start, destination_end in signature)


def _markdown_destinations(value: str, context: MarkdownReferenceContext | None = None):
    references = attachment_references(value, definitions=context.definitions if context else None)
    destinations = {
        (ref.destination_start, ref.destination_end): f"cr-asset://{ref.identifier}"
        for ref in references if ref.destination_start is not None
    }
    if context:
        # A definition can be in a different paragraph from its actual use.
        # Only definitions used by the canonical document are binding.
        for label, (url, start, end) in attachment_definitions(value).items():
            canonical = context.definitions.get(label)
            if label in context.used_labels and canonical and canonical[0] == url:
                destinations[(start, end)] = url
    return references, destinations


def attachment_markdown_ids(value: str, context: MarkdownReferenceContext | None = None) -> set[uuid.UUID]:
    refs, destinations = _markdown_destinations(value, context)
    return {
        uuid.UUID(match["id"])
        for url in [
            *(f"cr-asset://{ref.identifier}" for ref in [*refs, *_project_html_references(value, context)]),
            *destinations.values(),
        ]
        if (match := ASSET_REFERENCE_RE.match(url))
    }


def rewrite_attachment_markdown(
    value: str, attachment_id_map: dict[uuid.UUID, uuid.UUID],
    context: MarkdownReferenceContext | None = None,
) -> str:
    if not attachment_id_map:
        return value
    _, markdown_destinations = _markdown_destinations(value, context)
    destinations = {span: False for span in markdown_destinations}
    destinations.update({
        (ref.destination_start, ref.destination_end): True
        for ref in _project_html_references(value, context)
    })
    parts, cursor = [], 0
    for start, end in sorted(destinations):
        if start < cursor:
            continue
        original = value[start:end]
        if destinations[(start, end)]:
            decoded = html.unescape(original)
            rewritten = rewrite_attachment_text(decoded, attachment_id_map)
            rewritten = html.escape(rewritten, quote=True) if rewritten != decoded else original
        else:
            rewritten = rewrite_attachment_text(original, attachment_id_map)
        parts.extend((value[cursor:start], rewritten))
        cursor = end
    parts.append(value[cursor:])
    return "".join(parts)


def assert_attachment_ids_mapped(ids: set[uuid.UUID], attachment_id_map: dict[uuid.UUID, uuid.UUID]) -> None:
    if ids - attachment_id_map.keys():
        raise ValueError("Attachment reference cannot be mapped during merge.")


_HTML_ATTRIBUTE_RE = re.compile(r"""(?P<name>[^\s=/>]+)\s*=\s*(?:"(?P<double>[^"]*)"|'(?P<single>[^']*)'|(?P<bare>[^\s>]+))""")
_HTML_LITERAL_TAGS = {"code", "pre", "script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes", "plaintext"}
_HTML_BLOCK_OPEN = re.compile(
    r"^ {0,3}</?(?:address|article|aside|base|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|/?>|$)",
    re.IGNORECASE,
)
_MARKDOWN_LINK_DESTINATION = r"(?:<(?:\\.|[^<>\\\r\n])*>|(?:\\.|[^\s()\\]|\((?:\\.|[^\s()\\])*\))+)"
_MARKDOWN_LINK_TITLE = r"""(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\((?:\\.|[^)\\])*\))"""
_HTML_SOURCE_TOKEN = re.compile(
    r"(?m:^ {0,3}\[(?:\\.|[^\]\\\r\n])+\]:[ \t]*)" + _MARKDOWN_LINK_DESTINATION
    + r"[ \t\r\n]+(?P<reference_title>" + _MARKDOWN_LINK_TITLE + r")[ \t]*(?=\r?$)"
    + r"|\]\([ \t\r\n]*" + _MARKDOWN_LINK_DESTINATION
    + r"[ \t\r\n]+(?P<inline_title>" + _MARKDOWN_LINK_TITLE + r")[ \t\r\n]*\)"
    + r"""|\\[\s\S]|<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<\?[\s\S]*?(?:\?>|$)"""
    + r"""|<![A-Z][^>]*>|</?[A-Za-z][A-Za-z0-9-]*(?=[\s/>])(?:[^<>"']|"[^"]*"|'[^']*')*>|`+|[\[\]]""",
    re.IGNORECASE | re.MULTILINE,
)


def _mask_source_ranges(source: str, ranges: list[tuple[int, int]]) -> str:
    """Keep exact source offsets/newlines without allocating one object per character."""
    if not ranges:
        return source
    parts, cursor = [], 0
    for start, end in ranges:
        parts.extend((source[cursor:start], re.sub(r"[^\r\n]", " ", source[start:end])))
        cursor = end
    parts.append(source[cursor:])
    return "".join(parts)


def _markdown_html_source(source: str) -> str:
    """Expose actual HTML, but not Markdown code or escaped opening brackets."""
    hidden = []
    fence = None
    fence_quotes = fence_indent = 0
    list_indents = []
    html_block, html_end = False, None
    html_ranges, html_start = [], None
    for match in re.finditer(r"[^\r\n]*(?:\r\n?|\n)|[^\r\n]+$", source):
        line = match[0].rstrip("\r\n")
        structural, quote_depth = line, 0
        while quote := re.match(r"^ {0,3}> ?", structural):
            structural = structural[quote.end():]
            quote_depth += 1
        indent = len(structural) - len(structural.lstrip(" "))
        if fence and structural.strip() and (quote_depth < fence_quotes or indent < fence_indent):
            fence = None
        marker = re.match(r"^( *)(?:[-+*]|\d{1,9}[.)])([ \t]+)", structural)
        if marker and not fence:
            while list_indents and indent < list_indents[-1]:
                list_indents.pop()
            list_indents.append(marker.end())
            structural = structural[marker.end():]
        elif structural.strip():
            while list_indents and indent < list_indents[-1]:
                list_indents.pop()
            if list_indents:
                structural = structural[list_indents[-1]:]
        if html_block and not structural.strip():
            html_ranges.append((html_start, match.start()))
            html_block, html_start = False, None
        if not fence and not html_block and html_end is None:
            raw_tag = re.match(r"^ {0,3}<(script|style|pre|textarea)(?:\s|>|$)", structural, re.I)
            if raw_tag:
                html_end, html_start = f"</{raw_tag[1].lower()}>", match.start()
            elif structural.lstrip(" ").startswith(("<!--", "<?", "<![CDATA[")) and not structural.startswith("    "):
                html_end = "-->" if "<!--" in structural else "?>" if "<?" in structural else "]]>"
                html_start = match.start()
            elif _HTML_BLOCK_OPEN.match(structural):
                html_block, html_start = True, match.start()
        if html_block or html_end:
            if html_end and html_end in structural.lower():
                html_ranges.append((html_start, match.end()))
                html_end, html_start = None, None
            continue
        marker = re.match(r"^ {0,3}(`{3,}|~{3,})(.*)$", structural)
        literal = bool(fence or marker) or structural.startswith(("    ", "\t"))
        if fence and marker and marker[1][0] == fence[0] and len(marker[1]) >= len(fence) and not marker[2].strip():
            fence = None
        elif not fence and marker:
            fence, fence_quotes = marker[1], quote_depth
            fence_indent = list_indents[-1] if list_indents else 0
        if literal:
            hidden.append((match.start(), match.end()))
    if html_start is not None:
        html_ranges.append((html_start, len(source)))
    visible = _mask_source_ranges(source, hidden)
    # A tag's quoted attribute can contain backticks: those are not Markdown
    # openers. Once a code span starts, however, HTML-looking text is literal.
    ticks = {}
    for run in re.finditer(r"`+", visible):
        ticks.setdefault(len(run[0]), []).append(run.start())
    blanks = [match.start() for match in re.finditer(r"\n[ \t\r]*\n", visible)]
    hidden, until, literal_tags, html_range_index, brackets = [], 0, [], 0, []
    for token in _HTML_SOURCE_TOKEN.finditer(visible):
        if token.start() < until:
            continue
        value = token[0]
        if tag := re.match(r"<(/?)([A-Za-z][A-Za-z0-9-]*)(?=[\s/>])", value):
            name = tag[2].lower()
            if tag[1] and name in literal_tags:
                del literal_tags[len(literal_tags) - 1 - literal_tags[::-1].index(name):]
            elif not tag[1] and name in _HTML_LITERAL_TAGS and not value.endswith("/>"):
                literal_tags.append(name)
            continue
        if literal_tags:
            continue
        while html_range_index < len(html_ranges) and html_ranges[html_range_index][1] <= token.start():
            html_range_index += 1
        if html_range_index < len(html_ranges) and html_ranges[html_range_index][0] <= token.start():
            continue
        if token.group("reference_title") is not None:
            hidden.append(token.span())
        elif token.group("inline_title") is not None and brackets:
            brackets.pop()
            hidden.append(token.span())
        elif value == "[":
            brackets.append(token.start())
        elif value == "]":
            if brackets:
                brackets.pop()
        elif value.startswith("\\<"):
            hidden.append(token.span())
        elif value.startswith("`"):
            positions = ticks[len(value)]
            next_index = bisect_right(positions, token.start())
            blank = bisect_left(blanks, token.end())
            if next_index < len(positions):
                end = positions[next_index] + len(value)
                if blank >= len(blanks) or blanks[blank] >= end:
                    hidden.append((token.start(), end))
                    until = end
    return _mask_source_ranges(visible, hidden)


class _HtmlAttachmentDestinations(HTMLParser):
    def __init__(self, source: str):
        super().__init__(convert_charrefs=False)
        self.line_offsets = [0]
        self.line_offsets.extend(match.end() for match in re.finditer("\n", source))
        self.destinations: list[tuple[int, int, str]] = []
        self.references: list[AttachmentReference] = []
        self.literal_tags: list[str] = []
        self.feed(source)

    def parse_marked_section(self, i, report=1):
        # HTMLParser's SGML compatibility parser asserts on unknown <![...]
        # names. They are opaque declarations, not URI-binding containers.
        # Consume just that declaration, so a later real tag is still parsed.
        name = re.compile(r"[a-zA-Z][-.a-zA-Z0-9:_]*").match(self.rawdata, i + 3)
        if name and name[0].lower() in {"temp", "cdata", "ignore", "include", "rcdata", "if", "else", "endif"}:
            return super().parse_marked_section(i, report)
        closing = re.compile(r"\]\s*\]?\s*>").search(self.rawdata, i + 3)
        return closing.end() if closing else self.parse_bogus_comment(i, report)

    def handle_starttag(self, tag, attrs):
        if tag in _HTML_LITERAL_TAGS:
            self.literal_tags.append(tag)
        if self.literal_tags:
            return
        raw = self.get_starttag_text()
        start = re.match(r"<[^\s/>]+", raw)
        if not start:
            return
        line, column = self.getpos()
        offset = self.line_offsets[line - 1] + column
        for match in _HTML_ATTRIBUTE_RE.finditer(raw, start.end()):
            if match["name"].lower() not in {"href", "src", "poster"}:
                continue
            field = next(name for name in ("double", "single", "bare") if match[name] is not None)
            url = html.unescape(match[field])
            if url.lower().startswith("cr-asset://"):
                start, end = offset + match.start(field), offset + match.end(field)
                self.destinations.append((start, end, url))
                self.references.append(AttachmentReference(
                    re.split(r"[?#]", url.split("://", 1)[1], maxsplit=1)[0],
                    offset, offset + len(raw), line, start, end,
                ))

    def handle_endtag(self, tag):
        if tag in self.literal_tags:
            del self.literal_tags[len(self.literal_tags) - 1 - self.literal_tags[::-1].index(tag):]


def html_attachment_references(source: str) -> list[AttachmentReference]:
    """Source-coordinate HTML URI bindings, not authorization to use a file.

    Callers combine these with the existing Markdown references and still
    enforce ownership, availability, scan status and occurrence integrity.
    The identifier excludes query/fragment, which stay in the source. Invalid
    identifiers are retained so write paths can reject them, not silently lose
    an attempted binding.
    """
    if "<" not in source or "cr-asset" not in html.unescape(source).lower():
        return []
    return _HtmlAttachmentDestinations(_markdown_html_source(source)).references


def attachment_source_references(
    source: str, *, definitions: dict[str, tuple[str, int, int]] | None = None,
) -> list[AttachmentReference]:
    """Markdown + raw HTML bindings with original source/block coordinates."""
    return sorted(
        [*attachment_references(source, definitions=definitions), *html_attachment_references(source)],
        key=lambda ref: (ref.start, ref.destination_start if ref.destination_start is not None else ref.start),
    )


def attachment_html_ids(value: str) -> set[uuid.UUID]:
    return {
        uuid.UUID(match["id"]) for _, _, url in _HtmlAttachmentDestinations(value).destinations
        if (match := ASSET_REFERENCE_RE.match(url))
    }


def rewrite_attachment_html(value: str, attachment_id_map: dict[uuid.UUID, uuid.UUID]) -> str:
    if not attachment_id_map:
        return value
    parts, cursor = [], 0
    for start, end, url in _HtmlAttachmentDestinations(value).destinations:
        rewritten = rewrite_attachment_text(url, attachment_id_map)
        parts.extend((value[cursor:start], html.escape(rewritten, quote=True) if rewritten != url else value[start:end]))
        cursor = end
    parts.append(value[cursor:])
    return "".join(parts)


_MARKDOWN_FIELDS = {"text", "title", "markdown", "content_markdown", "comment_markdown", "description_markdown"}
_HTML_FIELDS = {"html", "sanitized_html"}
_URI_FIELDS = {"src", "href", "url", "poster"}


def _map_block_data(value, context, visit_markdown, visit_html, visit_uri, visit_id, field=None):
    """Typed payloads: prose/code/labels are not arbitrary URI bindings."""
    if isinstance(value, list):
        return [_map_block_data(item, context, visit_markdown, visit_html, visit_uri, visit_id, field) for item in value]
    if isinstance(value, dict):
        return {key: _map_block_data(item, context, visit_markdown, visit_html, visit_uri, visit_id, key)
                for key, item in value.items()}
    if isinstance(value, str):
        if field in _ATTACHMENT_ID_KEYS:
            return visit_id(value)
        if field in _MARKDOWN_FIELDS:
            return visit_markdown(value, context)
        if field in _HTML_FIELDS:
            return visit_html(value)
        if field in _URI_FIELDS:
            return visit_uri(value)
    return value


def attachment_block_ids(block: dict, context: MarkdownReferenceContext | None = None) -> set[uuid.UUID]:
    if block.get("block_type") == "code":
        return set()
    context = _block_reference_context(block, context)
    found = set()

    def collect(ids):
        found.update(ids)

    def identifier(value):
        try:
            found.add(uuid.UUID(value))
        except ValueError:
            pass

    _map_block_data(block.get("data") or {}, context,
                    lambda text, ctx: collect(attachment_markdown_ids(text, ctx)),
                    lambda text: collect(attachment_html_ids(text)),
                    lambda text: collect(attachment_reference_ids(text)), identifier)
    # Image alt / file captions are labels, not parsed Markdown destinations.
    if block.get("block_type") not in {"image", "attachment"}:
        found.update(attachment_markdown_ids(block.get("plain_text") or "", context))
    found.update(attachment_html_ids(block.get("sanitized_html") or ""))
    return found


def attachment_blocks_ids(blocks: list[dict], context: MarkdownReferenceContext | None = None) -> set[uuid.UUID]:
    return {
        identity for index, block in enumerate(blocks) if isinstance(block, dict)
        for identity in attachment_block_ids(
            block if "block_index" in block else {**block, "block_index": index}, context,
        )
    }


def rewrite_attachment_block(
    block: dict, attachment_id_map: dict[uuid.UUID, uuid.UUID],
    context: MarkdownReferenceContext | None = None,
) -> dict:
    if not attachment_id_map or block.get("block_type") == "code":
        return dict(block)
    context = _block_reference_context(block, context)

    def identifier(value):
        try:
            identity = uuid.UUID(value)
        except ValueError:
            return value
        return str(attachment_id_map[identity]) if identity in attachment_id_map else value

    output = dict(block)
    if "data" in output:
        output["data"] = _map_block_data(
            output["data"], context,
            lambda text, ctx: rewrite_attachment_markdown(text, attachment_id_map, ctx),
            lambda text: rewrite_attachment_html(text, attachment_id_map),
            lambda text: rewrite_attachment_text(text, attachment_id_map), identifier,
        )
    if isinstance(output.get("plain_text"), str) and block.get("block_type") not in {"image", "attachment"}:
        output["plain_text"] = rewrite_attachment_markdown(output["plain_text"], attachment_id_map, context)
    if isinstance(output.get("sanitized_html"), str):
        output["sanitized_html"] = rewrite_attachment_html(output["sanitized_html"], attachment_id_map)
    return output
