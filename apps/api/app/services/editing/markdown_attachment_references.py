"""Source-coordinate attachment destinations, not arbitrary URI substrings.

No rendering or URL fetching. Literal examples and unused definitions do not
create occurrences. Keep the cross-runtime fixtures in sync with the editor.
"""
import re
from bisect import bisect_right, bisect_left
from dataclasses import dataclass

@dataclass(frozen=True)
class AttachmentReference:
    identifier: str
    start: int
    end: int
    line_number: int
    destination_start: int | None = None
    destination_end: int | None = None
    definition_label: str | None = None


def _key(value: str) -> str:
    return " ".join(re.sub(r"\\([!\"#$%&'()*+,\-./:;<=>?@\[\\\]^_`{|}~])", r"\1", value).split()).lower()


def _visible(source: str) -> str:
    chars = list(source)
    offset = 0
    fence = None
    fence_quotes = 0
    fence_indent = 0
    html_end = None
    html_block = False
    list_indents = []
    for raw in source.splitlines(keepends=True):
        line = raw.rstrip("\r\n")
        structural = line
        quote_depth = 0
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
        match = re.match(r"^ {0,3}(`{3,}|~{3,})(.*)$", structural)
        html = re.match(r"^ {0,3}<(script|style|pre|textarea)(?:\s|>|$)", structural, re.I)
        if html:
            html_end = f"</{html[1].lower()}>"
        if structural.lstrip().startswith("<!--"):
            html_end = "-->"
        if structural.lstrip().startswith("<?"):
            html_end = "?>"
        if structural.lstrip().startswith("<![CDATA["):
            html_end = "]]>"
        if not structural.strip():
            html_block = False
        elif re.match(r"^ {0,3}</?(?:address|article|aside|base|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|/?>|$)", structural, re.I):
            html_block = True
        literal = bool(fence or match or html_end or html_block) or structural.startswith(("    ", "\t"))
        if fence and match and match[1][0] == fence[0] and len(match[1]) >= len(fence) and not match[2].strip():
            fence = None
        elif not fence and match:
            fence = match[1]
            fence_quotes = quote_depth
            fence_indent = list_indents[-1] if list_indents else 0
        if html_end and html_end in line.lower():
            html_end = None
        if literal:
            chars[offset:offset + len(line)] = " " * len(line)
        else:
            # Normalize container prefixes only in the parser view, retaining
            # exact original offsets for references/definitions and mutations.
            prefix = len(line) - len(structural)
            chars[offset:offset + prefix] = " " * prefix
        offset += len(raw)
    text = "".join(chars)
    runs = list(re.finditer(r"(?<!\\)`+", text))
    by_length = {}
    for index, run in enumerate(runs):
        by_length.setdefault(len(run[0]), []).append(index)
    blank_lines = [match.start() for match in re.finditer(r"\n[ \t\r]*\n", text)]
    index = 0
    while index < len(runs):
        opening = runs[index]
        same = by_length[len(opening[0])]
        next_index = bisect_right(same, index)
        closing = same[next_index] if next_index < len(same) else None
        blank = bisect_left(blank_lines, opening.end())
        if closing is not None and (blank >= len(blank_lines) or blank_lines[blank] >= runs[closing].start()):
            for pos in range(opening.start(), runs[closing].end()):
                if chars[pos] not in "\r\n":
                    chars[pos] = " "
            index = closing + 1
        else:
            index += 1
    return "".join(chars)


_DEFINITION_RE = re.compile(r"(?m)^ *\[((?:\\.|[^\]\\\r\n])+)\]:[ \t]*<?(cr-(?:asset|upload)://[^\s<>]+)>?[^\r\n]*", re.I)


def attachment_definitions(source: str) -> dict[str, tuple[str, int, int]]:
    if "cr-asset://" not in source.lower() and "cr-upload://" not in source.lower():
        return {}
    definitions = {}
    for match in _DEFINITION_RE.finditer(_visible(source)):
        url = match[2].rstrip(">")
        definitions.setdefault(_key(match[1]), (url, match.start(2), match.start(2) + len(url)))
    return definitions


def attachment_references(
    source: str, scheme: str = "cr-asset",
    *, definitions: dict[str, tuple[str, int, int]] | None = None,
) -> list[AttachmentReference]:
    if scheme + "://" not in source.lower() and not definitions:
        return []
    newlines = [match.start() for match in re.finditer("\n", source)]
    text = _visible(source)
    local_definitions = {}
    chars = list(text)
    for match in _DEFINITION_RE.finditer(text):
        url = match[2].rstrip(">")
        local_definitions.setdefault(_key(match[1]), (url, match.start(2), match.start(2) + len(url)))
        chars[match.start():match.end()] = " " * len(match[0])
    lookup = definitions if definitions is not None else local_definitions
    text = "".join(chars)
    destination = re.compile(r"\(\s*<?(cr-(?:asset|upload)://[^\s)<>'\"]+)>?(?:\s+(?:\"[^\"]*\"|'[^']*'))?\s*\)", re.I)
    refs = []
    brackets = []
    cursor = 0
    while cursor < len(text):
        char = text[cursor]
        if char == "\\":
            cursor += 2
            continue
        if char == "[":
            brackets.append(cursor)
        elif char == "]" and brackets:
            start = brackets.pop()
            end = cursor + 1
            label = text[start + 1:cursor]
            url = None
            destination_start = destination_end = None
            definition_label = None
            inline = destination.match(text, end)
            if inline:
                url, end = inline[1], inline.end()
                destination_start, destination_end = inline.span(1)
            elif end < len(text) and text[end] == "[":
                reference = re.match(r"\[((?:\\.|[^\]\\\r\n])*)\]", text[end:])
                if reference:
                    definition_label = _key(reference[1] or label)
                    end += len(reference[0])
            elif end >= len(text) or text[end] != "(":
                definition_label = _key(label)
            if definition_label in lookup:
                url = lookup[definition_label][0]
                local = local_definitions.get(definition_label)
                if local and local[0] == url:
                    destination_start, destination_end = local[1:]
            if url and url.lower().startswith(scheme + "://"):
                if start and text[start - 1] == "!" and (start < 2 or text[start - 2] != "\\"):
                    start -= 1
                refs.append(AttachmentReference(
                    url.split("://", 1)[1], start, end, bisect_left(newlines, start) + 1,
                    destination_start, destination_end, definition_label,
                ))
                cursor = end - 1
        cursor += 1
    return refs
