"""Shared, fail-closed rewriting for conversation attachment references."""

import re
import uuid
import html
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Any

from app.services.editing.markdown_attachment_references import attachment_definitions, attachment_references

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


def markdown_reference_context(source: str) -> MarkdownReferenceContext:
    """Resolve definitions once for projections split across render blocks."""
    return MarkdownReferenceContext(
        attachment_definitions(source),
        frozenset(ref.definition_label for ref in attachment_references(source) if ref.definition_label is not None),
    )


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
        for url in [*(f"cr-asset://{ref.identifier}" for ref in refs), *destinations.values()]
        if (match := ASSET_REFERENCE_RE.match(url))
    }


def rewrite_attachment_markdown(
    value: str, attachment_id_map: dict[uuid.UUID, uuid.UUID],
    context: MarkdownReferenceContext | None = None,
) -> str:
    if not attachment_id_map:
        return value
    _, destinations = _markdown_destinations(value, context)
    parts, cursor = [], 0
    for start, end in sorted(destinations):
        parts.extend((value[cursor:start], rewrite_attachment_text(value[start:end], attachment_id_map)))
        cursor = end
    parts.append(value[cursor:])
    return "".join(parts)


def assert_attachment_ids_mapped(ids: set[uuid.UUID], attachment_id_map: dict[uuid.UUID, uuid.UUID]) -> None:
    if ids - attachment_id_map.keys():
        raise ValueError("Attachment reference cannot be mapped during merge.")


_HTML_ATTRIBUTE_RE = re.compile(r"""(?P<name>[^\s=/>]+)\s*=\s*(?:"(?P<double>[^"]*)"|'(?P<single>[^']*)'|(?P<bare>[^\s>]+))""")


class _HtmlAttachmentDestinations(HTMLParser):
    def __init__(self, source: str):
        super().__init__(convert_charrefs=False)
        self.line_offsets = [0]
        self.line_offsets.extend(match.end() for match in re.finditer("\n", source))
        self.destinations: list[tuple[int, int, str]] = []
        self.feed(source)

    def handle_starttag(self, tag, attrs):
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
            if ASSET_REFERENCE_RE.match(url):
                self.destinations.append((offset + match.start(field), offset + match.end(field), url))


def attachment_html_ids(value: str) -> set[uuid.UUID]:
    return {uuid.UUID(ASSET_REFERENCE_RE.match(url)["id"]) for _, _, url in _HtmlAttachmentDestinations(value).destinations}


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
    return {identity for block in blocks if isinstance(block, dict) for identity in attachment_block_ids(block, context)}


def rewrite_attachment_block(
    block: dict, attachment_id_map: dict[uuid.UUID, uuid.UUID],
    context: MarkdownReferenceContext | None = None,
) -> dict:
    if not attachment_id_map or block.get("block_type") == "code":
        return dict(block)

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
