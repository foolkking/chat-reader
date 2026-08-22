from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from app.services.adaptive_import.contracts import AdaptiveImportError, CANONICAL_ROLES, SourceDocument
from app.services.adaptive_import.selector import evaluate_selector, select_one
from app.services.import_pipeline.canonical_draft import (
    PARSER_VERSION,
    CanonicalDraftConversation,
    CanonicalDraftMessage,
    content_hash,
    normalize_text,
)

NORMALIZER_VERSION = "adaptive-normalizer-v1"


def normalize_group(documents: list[SourceDocument], mapping_spec: dict[str, Any], profile_name: str) -> list[CanonicalDraftConversation]:
    mode = mapping_spec.get("source_mode")
    json_doc = next((item for item in documents if item.extension in {".json", ".jsonl", ".gz"}), None)
    markdown_doc = next((item for item in documents if item.extension in {".md", ".markdown"}), None)
    if mode == "JSON" and json_doc:
        return [_normalize_json(json_doc, mapping_spec, profile_name)]
    if mode == "MARKDOWN" and markdown_doc:
        return [_normalize_markdown(markdown_doc, mapping_spec, profile_name)]
    if mode == "JSON_MARKDOWN" and json_doc and markdown_doc:
        json_draft = _normalize_json(json_doc, mapping_spec["json"], profile_name)
        markdown_draft = _normalize_markdown(markdown_doc, mapping_spec["markdown"], profile_name)
        return [_merge_pair(json_draft, markdown_draft, mapping_spec.get("relation", {}), profile_name)]
    raise AdaptiveImportError("MAPPING_SOURCE_MISMATCH", "The mapping source mode does not match this input group.", layer="mapping")


def validate_drafts(drafts: list[CanonicalDraftConversation], validation_spec: dict[str, Any] | None = None) -> dict[str, Any]:
    spec = {"minimum_messages": 1, "content_non_empty": True, "role_coverage": True, **(validation_spec or {})}
    issues: list[dict[str, Any]] = []
    for conversation_index, draft in enumerate(drafts):
        if len(draft.messages) < int(spec["minimum_messages"]):
            issues.append(_issue("MINIMUM_MESSAGES", conversation_index, None, "Conversation has too few messages."))
        for message_index, message in enumerate(draft.messages):
            if spec["role_coverage"] and message.role not in CANONICAL_ROLES:
                issues.append(_issue("UNKNOWN_ROLE", conversation_index, message_index, "A message role is not mapped."))
            if spec["content_non_empty"] and not message.plain_text.strip():
                issues.append(_issue("EMPTY_CONTENT", conversation_index, message_index, "A message has empty content."))
    return {
        "valid": not issues,
        "conversation_count": len(drafts),
        "message_count": sum(len(draft.messages) for draft in drafts),
        "issues": issues,
    }


def _normalize_json(document: SourceDocument, spec: dict[str, Any], profile_name: str) -> CanonicalDraftConversation:
    try:
        payload = json.loads(document.content.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise AdaptiveImportError("JSON_INVALID", "The JSON file cannot be normalized.", layer="normalization") from exc
    conversation_selector = spec.get("conversation", {}).get("locator")
    roots = evaluate_selector(payload, conversation_selector) if conversation_selector else [payload]
    if len(roots) != 1:
        raise AdaptiveImportError(
            "CONVERSATION_COUNT_UNSUPPORTED",
            "Each input group must normalize to exactly one conversation.",
            layer="normalization",
            pointer=conversation_selector or "$",
        )
    root = roots[0]
    messages_spec = spec.get("messages") or {}
    locator = messages_spec.get("locator")
    if not locator:
        raise AdaptiveImportError("MESSAGE_LOCATOR_REQUIRED", "Message locator is required.", layer="mapping", pointer="messages.locator")
    raw_messages = evaluate_selector(root, locator)
    role_selector = messages_spec.get("role")
    content_selector = messages_spec.get("content")
    if not role_selector or not content_selector:
        raise AdaptiveImportError("MESSAGE_FIELDS_REQUIRED", "Role and content mappings are required.", layer="mapping")
    role_mapping = {str(key).casefold(): value for key, value in (spec.get("role_mapping") or {}).items()}
    messages: list[CanonicalDraftMessage] = []
    for index, raw in enumerate(raw_messages):
        source_role = _string(select_one(raw, role_selector, ""))
        role = role_mapping.get(source_role.casefold())
        if role not in CANONICAL_ROLES:
            raise AdaptiveImportError(
                "ROLE_UNMAPPED", f"Role {source_role!r} is not mapped.", layer="normalization",
                pointer=f"{locator}[{index}].{role_selector.removeprefix('$.')}", action="map_roles",
            )
        selected_content = evaluate_selector(raw, content_selector)
        text = _join_content(selected_content)
        text = _apply_transforms(text, (spec.get("transforms") or {}).get("content", []))
        if _ignored(raw, spec.get("noise_rules") or []):
            continue
        created = _string(select_one(raw, messages_spec.get("timestamp"))) or None
        external_id = _string(select_one(raw, messages_spec.get("external_id"))) or None
        messages.append(_draft_message(role, text, len(messages), created, external_id, source_json_index=index))
    title_selector = (spec.get("conversation") or {}).get("title")
    title = _string(select_one(root, title_selector)) if title_selector else ""
    title = title.strip() or Path(document.filename).stem
    return _draft_conversation(title, messages, profile_name, source_type="adaptive_json")


def _normalize_markdown(document: SourceDocument, spec: dict[str, Any], profile_name: str) -> CanonicalDraftConversation:
    try:
        text = document.content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise AdaptiveImportError("MARKDOWN_ENCODING_INVALID", "Markdown must be UTF-8.", layer="normalization") from exc
    boundary = (spec.get("messages") or {}).get("boundary") or {}
    role_mapping = {str(key).casefold(): value for key, value in (spec.get("role_mapping") or {}).items()}
    sections, preamble = _markdown_sections(text, boundary, allowed_labels=set(role_mapping))
    messages: list[CanonicalDraftMessage] = []
    for source_index, section in enumerate(sections):
        role = role_mapping.get(section["label"].casefold())
        if role not in CANONICAL_ROLES:
            raise AdaptiveImportError(
                "ROLE_UNMAPPED", f"Role {section['label']!r} is not mapped.", layer="normalization",
                pointer=f"line:{section['line']}", action="map_roles",
            )
        body = section["body"].strip()
        message_spec = spec.get("messages") or {}
        created_at = section["timestamp"] if message_spec.get("timestamp") == "BOUNDARY_METADATA_TIMESTAMP" else None
        external_id = section["external_id"] if message_spec.get("external_id") == "BOUNDARY_METADATA_ID" else None
        messages.append(_draft_message(role, body, len(messages), created_at, external_id, source_markdown_index=source_index))
    preamble_action = next(
        (rule.get("action") for rule in spec.get("noise_rules", []) if rule.get("region") == "PREAMBLE"), "IGNORE"
    )
    if preamble.strip() and preamble_action == "KEEP" and messages:
        first = messages[0]
        combined = f"{preamble.strip()}\n\n{first.display_text}".strip()
        messages[0] = _draft_message(first.role, combined, 0, first.created_at, first.source_message_id, source_markdown_index=0)
    title = _markdown_title(text) or Path(document.filename).stem
    return _draft_conversation(title, messages, profile_name, source_type="adaptive_markdown")


def _merge_pair(
    json_draft: CanonicalDraftConversation,
    markdown_draft: CanonicalDraftConversation,
    relation: dict[str, Any],
    profile_name: str,
) -> CanonicalDraftConversation:
    relation_type = relation.get("type", "ORDER")
    pairs: list[tuple[CanonicalDraftMessage, CanonicalDraftMessage]] = []
    if relation_type == "ORDER":
        if len(json_draft.messages) != len(markdown_draft.messages):
            raise AdaptiveImportError("RELATION_COUNT_MISMATCH", "JSON and Markdown message counts differ.", layer="normalization", action="review_relation")
        pairs = list(zip(json_draft.messages, markdown_draft.messages, strict=True))
    elif relation_type == "ID":
        json_ids = [message.source_message_id for message in json_draft.messages]
        markdown_ids = [message.source_message_id for message in markdown_draft.messages]
        markdown_by_id = {message.source_message_id: message for message in markdown_draft.messages if message.source_message_id}
        if (
            not json_ids
            or any(not item for item in json_ids + markdown_ids)
            or len(set(json_ids)) != len(json_ids)
            or len(set(markdown_ids)) != len(markdown_ids)
            or set(json_ids) != set(markdown_ids)
        ):
            raise AdaptiveImportError("RELATION_ID_MISMATCH", "JSON and Markdown message IDs do not form a complete relation.", layer="normalization", action="review_relation")
        pairs = [(message, markdown_by_id[message.source_message_id]) for message in json_draft.messages]
    elif relation_type == "ROLE_TIMESTAMP":
        remaining = list(markdown_draft.messages)
        for message in json_draft.messages:
            matches = [candidate for candidate in remaining if candidate.role == message.role and candidate.created_at == message.created_at]
            if len(matches) != 1:
                raise AdaptiveImportError("RELATION_ROLE_TIMESTAMP_AMBIGUOUS", "Role and timestamp do not uniquely align both sources.", layer="normalization", action="review_relation")
            pairs.append((message, matches[0]))
            remaining.remove(matches[0])
        if remaining:
            raise AdaptiveImportError("RELATION_ROLE_TIMESTAMP_AMBIGUOUS", "Role and timestamp do not uniquely align both sources.", layer="normalization", action="review_relation")
    else:
        raise AdaptiveImportError("RELATION_INVALID", "Unsupported JSON/Markdown relation.", layer="mapping")

    output: list[CanonicalDraftMessage] = []
    content_source = relation.get("content_source", "MARKDOWN")
    role_source = relation.get("role_source", "JSON")
    timestamp_source = relation.get("timestamp_source", "JSON")
    for index, (json_message, markdown_message) in enumerate(pairs):
        if json_message.role != markdown_message.role:
            raise AdaptiveImportError("RELATION_ROLE_CONFLICT", f"Message {index + 1} has conflicting roles.", layer="normalization", action="review_relation")
        source_content = markdown_message if content_source == "MARKDOWN" else json_message
        source_role = markdown_message if role_source == "MARKDOWN" else json_message
        source_time = markdown_message if timestamp_source == "MARKDOWN" else json_message
        output.append(_draft_message(
            source_role.role, source_content.display_text, index, source_time.created_at,
            json_message.source_message_id or markdown_message.source_message_id,
            source_json_index=index, source_markdown_index=index,
        ))
    return _draft_conversation(json_draft.title or markdown_draft.title, output, profile_name, source_type="adaptive_json_markdown")


def _markdown_sections(
    text: str,
    boundary: dict[str, Any],
    *,
    allowed_labels: set[str] | None = None,
) -> tuple[list[dict[str, Any]], str]:
    kind = boundary.get("kind")
    level = boundary.get("level")
    heading = re.compile(rf"^ {{0,3}}#{{{int(level)}}}[ \t]+(.+?)\s*#*\s*$") if kind == "HEADING" and level else None
    line_label = re.compile(r"^\s*([^:#：]{1,40})\s*[:：]\s*$") if kind == "LINE_LABEL" else None
    lines = text.splitlines()
    boundaries: list[dict[str, Any]] = []
    active: tuple[str, int] | None = None
    for index, line in enumerate(lines):
        fence = re.match(r"^ {0,3}(`{3,}|~{3,})", line)
        if active:
            if fence and fence.group(1)[0] == active[0] and len(fence.group(1)) >= active[1] and not line[fence.end():].strip():
                active = None
            continue
        if fence:
            active = (fence.group(1)[0], len(fence.group(1)))
            continue
        match = heading.match(line) if heading else line_label.match(line) if line_label else None
        if match:
            metadata = _boundary_metadata(match.group(1))
            if allowed_labels is not None and metadata["label"].casefold() not in allowed_labels:
                continue
            boundaries.append({"index": index, **metadata})
    if not boundaries:
        raise AdaptiveImportError("MARKDOWN_BOUNDARY_MISSING", "Configured Markdown boundaries were not found.", layer="normalization")
    sections = []
    for ordinal, boundary_item in enumerate(boundaries):
        start = int(boundary_item["index"])
        end = int(boundaries[ordinal + 1]["index"]) if ordinal + 1 < len(boundaries) else len(lines)
        sections.append({**boundary_item, "line": start + 1, "body": "\n".join(lines[start + 1:end])})
    return sections, "\n".join(lines[:int(boundaries[0]["index"])])


def _boundary_role_label(label: str) -> str:
    return str(_boundary_metadata(label)["label"])


def _boundary_metadata(label: str) -> dict[str, str | None]:
    value = re.split(r"\s+(?:[-–—·]|\|)\s+", label.strip(), maxsplit=1)[0]
    value = re.sub(r"\s*[*_]{0,3}\s*\([^)]*\)\s*[*_]{0,3}\s*$", "", value)
    value = re.sub(r"^[*_]{1,3}|[*_]{1,3}$", "", value).strip()
    role = re.sub(r"\s*\([^)]*\)\s*$", "", value).strip().rstrip(":：").strip()
    external_id_match = re.search(
        r"(?:^|[\s|,;\[(])(?:id|message[_\s-]?id|uuid)\s*[:=]\s*([A-Za-z0-9._:-]{1,200})",
        label,
        re.IGNORECASE,
    )
    timestamp_match = re.search(
        r"\b(\d{4}-\d{2}-\d{2}[T ][0-2]\d:[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-][0-2]\d(?::?[0-5]\d)?)?)\b",
        label,
    )
    return {
        "label": role,
        "external_id": external_id_match.group(1) if external_id_match else None,
        "timestamp": timestamp_match.group(1) if timestamp_match else None,
    }


def _draft_message(
    role: str,
    text: str,
    index: int,
    created_at: str | None,
    external_id: str | None,
    *,
    source_json_index: int | None = None,
    source_markdown_index: int | None = None,
) -> CanonicalDraftMessage:
    plain = _plain_text(text)
    return CanonicalDraftMessage(
        role=role,
        order_key=f"{index + 1:08d}",
        turn_index=index if role in {"user", "assistant"} else None,
        created_at=created_at,
        plain_text=plain,
        display_text=text,
        content_hash=content_hash(text, role),
        source_json_index=source_json_index,
        source_markdown_index=source_markdown_index,
        display_source="adaptive_import",
        warnings=[],
        alignment_status="normalized",
        source_message_id=external_id,
    )


def _draft_conversation(title: str, messages: list[CanonicalDraftMessage], profile_name: str, *, source_type: str) -> CanonicalDraftConversation:
    first_user = next((message.plain_text for message in messages if message.role == "user"), None)
    return CanonicalDraftConversation(
        title=title,
        display_title=title,
        source_type=source_type,
        source_profile=profile_name,
        external_source_id=None,
        created_at=None,
        updated_at=None,
        imported_at=None,
        message_count=len(messages),
        turn_count=sum(message.role == "user" for message in messages),
        first_user_message=first_user,
        parser_version=PARSER_VERSION,
        render_version=1,
        warnings=[],
        alignment_status="normalized",
        prompt_count=sum(message.role == "user" for message in messages),
        response_count=sum(message.role == "assistant" for message in messages),
        empty_message_count=sum(not message.plain_text.strip() for message in messages),
        cleaned_thinking_summary_count=0,
        messages=messages,
    )


def _join_content(values: list[Any]) -> str:
    parts: list[str] = []
    for value in values:
        if isinstance(value, str):
            parts.append(value)
        elif isinstance(value, (int, float, bool)):
            parts.append(str(value))
        elif isinstance(value, list):
            parts.extend(_join_content(value).split("\n\n"))
        elif isinstance(value, dict):
            for key in ("text", "content", "value"):
                if key in value:
                    parts.append(_string(value[key]))
                    break
    return "\n\n".join(part for part in parts if part != "")


def _apply_transforms(value: str, transforms: list[str]) -> str:
    output = value
    for transform in transforms:
        if transform == "TRIM": output = output.strip()
        elif transform == "STRING": output = str(output)
        elif transform == "IDENTITY": continue
        else: raise AdaptiveImportError("TRANSFORM_INVALID", f"Unsupported transform: {transform}", layer="mapping")
    return output


def _ignored(raw: Any, rules: list[dict[str, Any]]) -> bool:
    for rule in rules:
        if rule.get("action") != "IGNORE" or rule.get("region") == "PREAMBLE":
            continue
        selector = rule.get("selector")
        expected = rule.get("equals")
        if selector and any(value == expected for value in evaluate_selector(raw, selector)):
            return True
    return False


def _plain_text(markdown: str) -> str:
    text = re.sub(r"```[^\n]*\n(.*?)```", r"\1", markdown, flags=re.DOTALL)
    text = re.sub(r"!\[([^]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"\[([^]]+)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"^\s{0,3}#{1,6}\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"[*_~`]", "", text)
    return normalize_text(text)


def _markdown_title(text: str) -> str | None:
    match = re.search(r"^#\s+(.+?)\s*#*\s*$", text, re.MULTILINE)
    return match.group(1).strip() if match else None


def _issue(code: str, conversation_index: int, message_index: int | None, message: str) -> dict[str, Any]:
    return {"code": code, "conversation_index": conversation_index, "message_index": message_index, "message": message, "blocking": True}


def _string(value: Any) -> str:
    if value is None: return ""
    if isinstance(value, str): return value
    if isinstance(value, (int, float, bool)): return str(value)
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
