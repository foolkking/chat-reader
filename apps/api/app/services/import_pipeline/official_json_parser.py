import json
from dataclasses import dataclass, field
from typing import Any


class OfficialJsonParseError(ValueError):
    pass


@dataclass(frozen=True)
class OfficialConversationResult:
    title: str
    create_time: float | int | str | None
    update_time: float | int | str | None
    mapping: dict[str, Any]
    current_node: str | None
    external_conversation_id: str | None
    node_count: int
    message_node_count: int
    branch_count: int
    warnings: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class OfficialParseResult:
    conversations: list[OfficialConversationResult]
    conversation_count: int
    warnings: list[str]
    source_profile: str


def parse_official_json(content: bytes | str) -> OfficialParseResult:
    raw_text = content.decode("utf-8") if isinstance(content, bytes) else content
    try:
        payload = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        raise OfficialJsonParseError(f"Invalid JSON at line {exc.lineno}, column {exc.colno}.") from exc

    warnings: list[str] = []
    if isinstance(payload, list):
        conversations = [_parse_conversation(item, index, warnings) for index, item in enumerate(payload)]
        conversations = [conversation for conversation in conversations if conversation is not None]
        return OfficialParseResult(
            conversations=conversations,
            conversation_count=len(conversations),
            warnings=warnings,
            source_profile="official_conversations_json",
        )

    if isinstance(payload, dict):
        conversation = _parse_conversation(payload, 0, warnings)
        return OfficialParseResult(
            conversations=[conversation] if conversation else [],
            conversation_count=1 if conversation else 0,
            warnings=warnings,
            source_profile="official_conversation_json",
        )

    raise OfficialJsonParseError("Official conversations JSON must be an object or a list.")


def _parse_conversation(
    value: Any,
    index: int,
    global_warnings: list[str],
) -> OfficialConversationResult | None:
    if not isinstance(value, dict):
        global_warnings.append(f"Conversation {index} is not an object and was skipped.")
        return None

    warnings: list[str] = []
    raw_mapping = value.get("mapping")
    if not isinstance(raw_mapping, dict):
        warnings.append("mapping is missing or not an object.")
        raw_mapping = {}

    current_node = value.get("current_node")
    if current_node is not None:
        current_node = str(current_node)
    else:
        warnings.append("current_node is missing.")

    title = str(value.get("title") or "Untitled official conversation")
    node_count = len(raw_mapping)
    message_node_count = sum(1 for node in raw_mapping.values() if isinstance(node, dict) and isinstance(node.get("message"), dict))
    branch_count = sum(
        1
        for node in raw_mapping.values()
        if isinstance(node, dict) and isinstance(node.get("children"), list) and len(node.get("children", [])) > 1
    )

    return OfficialConversationResult(
        title=title,
        create_time=value.get("create_time"),
        update_time=value.get("update_time"),
        mapping=raw_mapping,
        current_node=current_node,
        external_conversation_id=str(value.get("id")) if value.get("id") is not None else None,
        node_count=node_count,
        message_node_count=message_node_count,
        branch_count=branch_count,
        warnings=warnings,
    )
