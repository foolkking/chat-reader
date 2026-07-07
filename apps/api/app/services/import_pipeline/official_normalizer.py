import json
from typing import Any

from app.schemas.import_schema import ConversationPreview, MessagePreview
from app.services.import_pipeline.canonical_draft import preview_text
from app.services.import_pipeline.official_json_parser import OfficialConversationResult
from app.services.import_pipeline.official_primary_path import resolve_primary_path

PREVIEW_MESSAGE_LIMIT = 20


def build_official_conversation_preview(
    conversation: OfficialConversationResult,
    source_profile: str,
) -> ConversationPreview:
    primary_path = resolve_primary_path(conversation.mapping, conversation.current_node)
    messages: list[MessagePreview] = []
    warnings = list(conversation.warnings) + list(primary_path.warnings)
    empty_count = 0
    turn_index = 0

    for order_index, node_id in enumerate(primary_path.primary_message_node_ids, start=1):
        node = conversation.mapping.get(node_id, {})
        message = node.get("message") if isinstance(node, dict) else {}
        if not isinstance(message, dict):
            continue

        role = _map_role(message.get("author", {}).get("role") if isinstance(message.get("author"), dict) else None)
        if role == "user":
            turn_index += 1
        content_text, content_warnings = _extract_content(message.get("content"))
        metadata_preview = _metadata_preview(message.get("metadata"))
        if not content_text.strip():
            empty_count += 1
            warnings.append(f"Filtered empty official message node {node_id}.")
            continue

        messages.append(
            MessagePreview(
                role=role,
                order_key=f"{len(messages) + 1:06d}",
                plain_text_preview=preview_text(content_text),
                display_text_preview=preview_text(content_text),
                source_json_index=None,
                source_markdown_index=None,
                created_at=_optional_str(message.get("create_time")),
                source_node_id=node_id,
                source_message_id=_optional_str(message.get("id")),
                source_parent_node_id=_optional_str(node.get("parent")) if isinstance(node, dict) else None,
                source_child_node_ids=[str(child) for child in node.get("children", [])] if isinstance(node, dict) and isinstance(node.get("children"), list) else [],
                is_primary_path=True,
                metadata_preview=metadata_preview,
                warnings=content_warnings,
            )
        )

    if len(messages) > PREVIEW_MESSAGE_LIMIT:
        warnings.append(f"Preview messages capped at {PREVIEW_MESSAGE_LIMIT}.")
    capped_messages = messages[:PREVIEW_MESSAGE_LIMIT]
    first_user_message = next((message.plain_text_preview for message in messages if message.role == "user"), None)
    response_count = sum(1 for message in messages if message.role == "assistant")
    prompt_count = sum(1 for message in messages if message.role == "user")

    return ConversationPreview(
        title=conversation.title,
        source_type="official_chatgpt_export" if source_profile == "official_conversations_json" else "official_chatgpt_conversation",
        source_profile=source_profile,
        alignment_status="official_primary_path",
        message_count=len(messages),
        prompt_count=prompt_count,
        response_count=response_count,
        empty_message_count=empty_count,
        cleaned_thinking_summary_count=0,
        first_user_message=first_user_message,
        node_count=conversation.node_count,
        message_node_count=conversation.message_node_count,
        primary_path_length=len(primary_path.primary_node_ids),
        branch_count=primary_path.branch_count,
        branch_node_count=len(primary_path.branch_node_ids),
        has_branches=primary_path.branch_count > 0,
        warnings=warnings,
        messages=capped_messages,
    )


def _map_role(role: Any) -> str:
    if role == "user":
        return "user"
    if role == "assistant":
        return "assistant"
    if role == "system":
        return "system"
    if role == "tool":
        return "tool"
    return "unknown"


def _extract_content(content: Any) -> tuple[str, list[str]]:
    warnings: list[str] = []
    if not isinstance(content, dict):
        return "", ["Official message content is missing or invalid."]

    content_type = content.get("content_type")
    if content_type and content_type != "text":
        return f"[非文本内容: {content_type}]", [f"Non-text official content downgraded: {content_type}."]

    if isinstance(content.get("text"), str):
        return content["text"], warnings

    parts = content.get("parts")
    if isinstance(parts, list):
        extracted = [_part_to_text(part) for part in parts]
        return "\n".join(part for part in extracted if part).strip(), warnings

    return "", ["Official text content has no parts."]


def _part_to_text(part: Any) -> str:
    if isinstance(part, str):
        return part
    if isinstance(part, dict):
        if isinstance(part.get("text"), str):
            return part["text"]
        return json.dumps(part, ensure_ascii=False, sort_keys=True)
    return str(part)


def _metadata_preview(metadata: Any) -> dict:
    if not isinstance(metadata, dict):
        return {}
    keys = [
        "model_slug",
        "default_model_slug",
        "attachments",
        "tool_calls",
        "invoked_plugin",
        "aggregate_result",
    ]
    return {key: metadata[key] for key in keys if key in metadata}


def _optional_str(value: Any) -> str | None:
    return str(value) if value is not None else None
