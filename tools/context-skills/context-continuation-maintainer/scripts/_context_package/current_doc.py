from __future__ import annotations

import ast
import re
from typing import Any

from .model import CurrentDocument, CurrentEvidenceLocator

_ID_RE = re.compile(r"\b(?:EV|G|REQ|CON|NG|CONV|DEC|TC|WS|MIL|OPEN|DEF|VD|BLK|NEXT|ASM|UNK|CF|RET|AD|E|SEG|CH)-\d+\b")
_HEADING_RE = re.compile(r"^#{2,6}\s+([A-Z][A-Z0-9]*-\d+)\b")
_FIELD_RE = re.compile(r"^(Parent|Goal|Related|Supersedes|Evidence|History|Supports):\s*(.*)$")
_EVIDENCE_FIELD_RE = re.compile(r"^(Type|Sequence|Message-ID|Version-ID|Attachment-ID):\s*(.*)$")


def _parse_scalar(text: str) -> Any:
    s = text.strip()
    if not s:
        return None
    if s in {"null", "Null", "NULL", "~"}:
        return None
    if s.lower() in {"true", "false"}:
        return s.lower() == "true"
    if re.fullmatch(r"-?\d+", s):
        try:
            return int(s)
        except ValueError:
            pass
    if (s.startswith('"') and s.endswith('"')) or (s.startswith("'") and s.endswith("'")):
        try:
            return ast.literal_eval(s)
        except Exception:
            return s[1:-1]
    return s


def parse_simple_yaml_mapping(text: str) -> dict[str, Any]:
    root: dict[str, Any] = {}
    stack: list[tuple[int, dict[str, Any]]] = [(-1, root)]
    for raw in text.splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        indent = len(raw) - len(raw.lstrip(" "))
        stripped = raw.strip()
        if ":" not in stripped:
            continue
        key, value = stripped.split(":", 1)
        while len(stack) > 1 and indent <= stack[-1][0]:
            stack.pop()
        parent = stack[-1][1]
        if value.strip() == "":
            child: dict[str, Any] = {}
            parent[key] = child
            stack.append((indent, child))
        else:
            parent[key] = _parse_scalar(value)
    return root


def split_frontmatter(markdown: str) -> tuple[dict[str, Any], str]:
    if not markdown.startswith("---\n") and not markdown.startswith("---\r\n"):
        return {}, markdown
    lines = markdown.splitlines()
    end = None
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            end = i
            break
    if end is None:
        return {}, markdown
    fm = "\n".join(lines[1:end])
    body = "\n".join(lines[end + 1:])
    return parse_simple_yaml_mapping(fm), body


def parse_current_document(markdown: str) -> CurrentDocument:
    frontmatter, body = split_frontmatter(markdown)
    lines = body.splitlines()
    object_ids: set[str] = set()
    duplicates: list[str] = []
    refs: list[tuple[str, str, str]] = []
    evidence_locators: list[CurrentEvidenceLocator] = []

    blocks: list[tuple[str, list[str]]] = []
    current_id: str | None = None
    current_lines: list[str] = []
    for line in lines:
        m = _HEADING_RE.match(line)
        if m:
            if current_id is not None:
                blocks.append((current_id, current_lines))
            current_id = m.group(1)
            current_lines = []
            if current_id in object_ids:
                duplicates.append(current_id)
            object_ids.add(current_id)
        elif current_id is not None:
            current_lines.append(line)
    if current_id is not None:
        blocks.append((current_id, current_lines))

    for oid, blines in blocks:
        evidence_fields: dict[str, Any] = {}
        active_field: str | None = None
        for line in blines:
            stripped = line.strip()
            fm = _FIELD_RE.match(stripped)
            if fm:
                field, rest = fm.group(1), fm.group(2)
                active_field = field
                for target in _ID_RE.findall(rest):
                    refs.append((oid, field, target))
                continue
            if active_field and stripped.startswith("-"):
                for target in _ID_RE.findall(stripped):
                    refs.append((oid, active_field, target))
                continue
            em = _EVIDENCE_FIELD_RE.match(stripped) if oid.startswith("E-") else None
            if em:
                evidence_fields[em.group(1)] = _parse_scalar(em.group(2))
                active_field = None
            elif stripped and not stripped.startswith("-"):
                active_field = None
        if oid.startswith("E-"):
            seq = evidence_fields.get("Sequence")
            evidence_locators.append(CurrentEvidenceLocator(
                evidence_id=oid,
                evidence_type=str(evidence_fields.get("Type")) if evidence_fields.get("Type") is not None else None,
                sequence=int(seq) if isinstance(seq, int) or (isinstance(seq, str) and seq.isdigit()) else None,
                message_id=str(evidence_fields.get("Message-ID")) if evidence_fields.get("Message-ID") is not None else None,
                version_id=str(evidence_fields.get("Version-ID")) if evidence_fields.get("Version-ID") is not None else None,
                attachment_id=str(evidence_fields.get("Attachment-ID")) if evidence_fields.get("Attachment-ID") is not None else None,
            ))
    return CurrentDocument(frontmatter, body, object_ids, refs, evidence_locators, duplicates)
