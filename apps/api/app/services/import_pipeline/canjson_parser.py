from __future__ import annotations

import gzip
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from io import BytesIO
from collections.abc import Iterator
from typing import Any

from app.core.config import get_settings
from app.services.import_pipeline.canonical_draft import (
    BLOCK_BUILDER_VERSION,
    MARKDOWN_PARSER_VERSION,
    NORMALIZER_VERSION,
    PARSER_VERSION,
    SEARCH_DOCUMENT_VERSION,
    CanonicalDraftConversation,
    CanonicalDraftMessage,
    CanonicalDraftVersion,
    content_hash,
    normalize_text,
)


class CanJsonParseError(ValueError):
    pass


@dataclass(frozen=True)
class CanJsonParseResult:
    conversation: CanonicalDraftConversation
    warnings: list[str] = field(default_factory=list)


def parse_canjson_v1(content: bytes | str) -> CanJsonParseResult:
    try:
        payload = json.loads(content.decode("utf-8") if isinstance(content, bytes) else content)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CanJsonParseError("CanJSON v1 is not valid UTF-8 JSON.") from exc
    if not isinstance(payload, dict) or payload.get("format") != "chat-reader-canonical-export" or payload.get("version") != 1:
        raise CanJsonParseError("CanJSON v1 manifest is invalid.")
    settings = get_settings()
    if _json_depth(payload) > settings.canjson_max_json_depth:
        raise CanJsonParseError("CanJSON v1 exceeds the configured JSON depth.")
    conversation = payload.get("conversation")
    raw_messages = payload.get("messages")
    if not isinstance(conversation, dict) or not isinstance(raw_messages, list):
        raise CanJsonParseError("CanJSON v1 requires conversation and messages.")
    if len(raw_messages) > settings.canjson_max_messages:
        raise CanJsonParseError("CanJSON message count exceeds the configured limit.")
    messages: list[CanonicalDraftMessage] = []
    warnings: list[str] = []
    for index, raw_message in enumerate(raw_messages):
        if not isinstance(raw_message, dict):
            raise CanJsonParseError(f"CanJSON v1 message {index} is not an object.")
        raw_current = raw_message.get("current_version")
        if not isinstance(raw_current, dict):
            raise CanJsonParseError(f"CanJSON v1 message {index} has no current version.")
        role = _role(raw_message.get("role"))
        markdown = _content_markdown(raw_current)
        versions = _v1_versions(raw_message, role)
        current_source_id = _optional_str(raw_current.get("id")) or (versions[0].source_id if versions else None)
        messages.append(
            CanonicalDraftMessage(
                role=role,
                order_key=str(raw_message.get("order_key") or f"{index + 1:06d}"),
                turn_index=_optional_int(raw_message.get("turn_index")),
                created_at=_optional_str(raw_message.get("created_at")),
                plain_text=_plain_text(markdown),
                display_text=markdown,
                content_hash=content_hash(markdown, role),
                source_json_index=index,
                source_markdown_index=None,
                display_source="canjson_v1",
                alignment_status="exact",
                source_message_id=_optional_str(raw_message.get("id")),
                source_current_version_id=current_source_id,
                versions=versions,
            )
        )
    warnings.append("CanJSON v1 derived blocks, TOC, and plain text were ignored and will be rebuilt.")
    return CanJsonParseResult(
        conversation=_conversation_draft(
            conversation=conversation,
            messages=messages,
            source_profile="chat_reader_canjson_v1",
            exported_at=_optional_str(payload.get("exported_at")),
            warnings=warnings,
            annotations=payload.get("annotations") if isinstance(payload.get("annotations"), list) else [],
            notebooks=[payload["notebook"]] if isinstance(payload.get("notebook"), dict) else [],
            source_refs=[],
        ),
        warnings=warnings,
    )


def parse_canjson_v2(content: bytes, *, compressed: bool = False) -> CanJsonParseResult:
    settings = get_settings()
    manifest: dict[str, Any] | None = None
    messages: dict[str, dict[str, Any]] = {}
    versions_by_message: dict[str, list[dict[str, Any]]] = {}
    annotations: list[dict] = []
    notebooks: list[dict] = []
    source_refs: list[dict] = []
    attachments: list[dict] = []
    warnings: list[str] = []
    end_record: dict[str, Any] | None = None
    record_count = 0

    try:
        for line_number, line in _iter_jsonl_lines(content, compressed=compressed):
            if not line.strip():
                continue
            if end_record is not None:
                raise CanJsonParseError("CanJSON end record must be the final non-empty record.")
            try:
                record = json.loads(line)
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise CanJsonParseError(f"CanJSON line {line_number} is invalid JSON.") from exc
            if _json_depth(record) > settings.canjson_max_json_depth:
                raise CanJsonParseError(f"CanJSON line {line_number} exceeds the configured JSON depth.")
            if not isinstance(record, dict):
                raise CanJsonParseError(f"CanJSON line {line_number} must be an object.")
            record_count += 1
            record_type = record.get("record_type")
            if manifest is None:
                if record_type != "manifest" or record.get("format") != "chat-reader-canonical-jsonl" or record.get("version") != 2:
                    raise CanJsonParseError("The first CanJSON v2 record must be a valid manifest.")
                manifest = record
                continue
            if record_type == "manifest":
                raise CanJsonParseError("CanJSON v2 contains more than one manifest record.")
            if record_type == "message":
                source_id = _required_id(record, "message", line_number)
                if source_id in messages:
                    raise CanJsonParseError(f"Duplicate CanJSON message id {source_id}.")
                messages[source_id] = record
                if len(messages) > settings.canjson_max_messages:
                    raise CanJsonParseError("CanJSON message count exceeds the configured limit.")
            elif record_type == "message_version":
                message_id = _required_str(record, "message_id", line_number)
                versions_by_message.setdefault(message_id, []).append(record)
            elif record_type == "annotation":
                annotations.append(record)
            elif record_type == "notebook":
                notebooks.append(record)
            elif record_type == "source_ref":
                source_refs.append(record)
            elif record_type in {"attachment", "attachment_ref"}:
                attachments.append(record)
            elif record_type == "end":
                end_record = record
            elif record.get("required") is True:
                raise CanJsonParseError(f"Required CanJSON record type {record_type!r} is not supported.")
            else:
                warnings.append(f"Skipped optional CanJSON record type {record_type!r} at line {line_number}.")
    except (EOFError, OSError) as exc:
        raise CanJsonParseError("CanJSON gzip stream is invalid.") from exc

    if manifest is None:
        raise CanJsonParseError("CanJSON v2 manifest is missing.")
    conversation = manifest.get("conversation")
    if not isinstance(conversation, dict):
        raise CanJsonParseError("CanJSON v2 manifest conversation is missing.")
    _validate_v2_references(messages, versions_by_message, annotations, notebooks, source_refs, attachments)

    order_keys = [str(item.get("order_key") or "") for item in messages.values()]
    if any(not value for value in order_keys) or len(order_keys) != len(set(order_keys)):
        raise CanJsonParseError("CanJSON message order_key values must be present and unique.")

    drafts: list[CanonicalDraftMessage] = []
    ordered_messages = sorted(messages.values(), key=lambda item: (str(item.get("order_key") or ""), int(item.get("seq") or 0)))
    for index, raw_message in enumerate(ordered_messages):
        source_id = str(raw_message["id"])
        current = raw_message.get("current_version")
        if not isinstance(current, dict):
            raise CanJsonParseError(f"CanJSON message {source_id} has no current_version.")
        current_source_id = _required_str(current, "id", index + 1, "current_version")
        role = _role(raw_message.get("role"))
        markdown = _content_markdown(current)
        all_versions = [current, *versions_by_message.get(source_id, [])]
        versions = _deduplicate_versions(all_versions, role)
        drafts.append(
            CanonicalDraftMessage(
                role=role,
                order_key=str(raw_message.get("order_key") or f"{index + 1:06d}"),
                turn_index=_optional_int(raw_message.get("turn_index")),
                created_at=_optional_str(raw_message.get("created_at")),
                plain_text=_plain_text(markdown),
                display_text=markdown,
                content_hash=content_hash(markdown, role),
                source_json_index=index,
                source_markdown_index=None,
                display_source="canjson_v2",
                alignment_status="exact",
                source_message_id=source_id,
                source_current_version_id=current_source_id,
                versions=versions,
            )
        )
    selection = manifest.get("selection") if isinstance(manifest.get("selection"), dict) else {}
    expected_count = selection.get("message_count")
    if isinstance(expected_count, int) and expected_count != len(drafts):
        raise CanJsonParseError("CanJSON manifest message_count does not match message records.")
    if end_record is not None:
        if isinstance(end_record.get("record_count"), int) and end_record["record_count"] != record_count:
            raise CanJsonParseError("CanJSON end record_count does not match parsed records.")
        if isinstance(end_record.get("message_count"), int) and end_record["message_count"] != len(drafts):
            raise CanJsonParseError("CanJSON end message_count does not match message records.")
    return CanJsonParseResult(
        conversation=_conversation_draft(
            conversation=conversation,
            messages=drafts,
            source_profile="chat_reader_canjson_v2",
            exported_at=_optional_str(manifest.get("exported_at")),
            warnings=warnings,
            annotations=annotations,
            notebooks=notebooks,
            source_refs=source_refs,
            attachments=attachments,
        ),
        warnings=warnings,
    )


def _conversation_draft(
    *,
    conversation: dict[str, Any],
    messages: list[CanonicalDraftMessage],
    source_profile: str,
    exported_at: str | None,
    warnings: list[str],
    annotations: list[dict],
    notebooks: list[dict],
    source_refs: list[dict],
    attachments: list[dict] | None = None,
) -> CanonicalDraftConversation:
    title = str(conversation.get("display_title") or conversation.get("title") or "Untitled conversation").strip()
    return CanonicalDraftConversation(
        title=title,
        display_title=title,
        source_type=source_profile,
        source_profile=source_profile,
        external_source_id=_optional_str(conversation.get("id")),
        created_at=_optional_str(conversation.get("created_at")),
        updated_at=_optional_str(conversation.get("updated_at")),
        imported_at=exported_at or datetime.now(timezone.utc).isoformat(),
        message_count=len(messages),
        turn_count=sum(message.role == "user" for message in messages),
        first_user_message=next((message.plain_text for message in messages if message.role == "user"), None),
        parser_version=PARSER_VERSION,
        render_version=2,
        warnings=warnings,
        alignment_status="exact",
        prompt_count=sum(message.role == "user" for message in messages),
        response_count=sum(message.role == "assistant" for message in messages),
        empty_message_count=sum(not message.display_text.strip() for message in messages),
        cleaned_thinking_summary_count=0,
        messages=messages,
        annotations=annotations,
        notebooks=notebooks,
        source_refs=source_refs,
        attachments=attachments or [],
    )


def _v1_versions(message: dict[str, Any], role: str) -> list[CanonicalDraftVersion]:
    raw_versions = message.get("versions")
    if not isinstance(raw_versions, list):
        raw_versions = []
    return _deduplicate_versions(
        [message["current_version"], *[item for item in raw_versions if isinstance(item, dict)]],
        role,
    )


def _deduplicate_versions(raw_versions: list[dict[str, Any]], role: str) -> list[CanonicalDraftVersion]:
    versions: dict[str, CanonicalDraftVersion] = {}
    for index, raw in enumerate(raw_versions):
        markdown = _content_markdown(raw)
        source_id = _optional_str(raw.get("id")) or f"version-{index + 1}"
        version = CanonicalDraftVersion(
            source_id=source_id,
            version_number=_optional_int(raw.get("number")) or _optional_int(raw.get("version_number")) or index + 1,
            display_text=markdown,
            plain_text=_plain_text(markdown),
            content_hash=content_hash(markdown, role),
            edit_type=str(raw.get("edit_type") or "imported"),
            edit_reason=_optional_str(raw.get("edit_reason")),
            created_at=_optional_str(raw.get("created_at")),
            based_on_source_version_id=_optional_str(raw.get("based_on_version_id")),
        )
        existing = versions.get(source_id)
        if existing is not None and existing != version:
            raise CanJsonParseError(f"CanJSON version id {source_id} is duplicated with different content.")
        versions.setdefault(source_id, version)
    ordered = sorted(versions.values(), key=lambda item: item.version_number)
    version_numbers = [item.version_number for item in ordered]
    if any(number < 1 for number in version_numbers) or len(version_numbers) != len(set(version_numbers)):
        raise CanJsonParseError("CanJSON version numbers must be positive and unique within each message.")
    return ordered


def _iter_jsonl_lines(content: bytes, *, compressed: bool) -> Iterator[tuple[int, bytes]]:
    settings = get_settings()
    stream = BytesIO(content)
    reader = gzip.GzipFile(fileobj=stream) if compressed else stream
    total_uncompressed = 0
    line_number = 0
    try:
        while True:
            line = reader.readline(settings.canjson_max_line_bytes + 1)
            if not line:
                break
            line_number += 1
            if len(line) > settings.canjson_max_line_bytes:
                raise CanJsonParseError(f"CanJSON line {line_number} exceeds the configured 32 MiB limit.")
            total_uncompressed += len(line)
            if compressed and total_uncompressed > max(len(content), 1) * settings.canjson_max_compression_ratio:
                raise CanJsonParseError("CanJSON gzip compression ratio exceeds the configured limit.")
            yield line_number, line
    finally:
        if compressed:
            reader.close()


def _validate_v2_references(
    messages: dict[str, dict[str, Any]],
    versions_by_message: dict[str, list[dict[str, Any]]],
    annotations: list[dict],
    notebooks: list[dict],
    source_refs: list[dict],
    attachments: list[dict],
) -> None:
    message_ids = set(messages)
    missing_version_messages = set(versions_by_message) - message_ids
    if missing_version_messages:
        raise CanJsonParseError("CanJSON message_version references an unknown message.")

    version_ids_by_message: dict[str, set[str]] = {}
    all_version_ids: set[str] = set()
    for message_id, message in messages.items():
        current = message.get("current_version")
        if not isinstance(current, dict):
            continue
        current_id = current.get("id")
        version_ids = {str(current_id)} if isinstance(current_id, str) and current_id else set()
        for version in versions_by_message.get(message_id, []):
            version_id = version.get("id")
            if not isinstance(version_id, str) or not version_id:
                raise CanJsonParseError("CanJSON message_version requires id.")
            if version_id in all_version_ids and version_id not in version_ids:
                raise CanJsonParseError(f"CanJSON version id {version_id} is reused across messages.")
            version_ids.add(version_id)
        if all_version_ids.intersection(version_ids):
            raise CanJsonParseError("CanJSON version ids must be globally unique.")
        all_version_ids.update(version_ids)
        version_ids_by_message[message_id] = version_ids
        for version in [current, *versions_by_message.get(message_id, [])]:
            based_on_id = version.get("based_on_version_id")
            if based_on_id is not None and str(based_on_id) not in version_ids:
                raise CanJsonParseError("CanJSON version references an unknown based_on_version_id.")

    annotation_ids: set[str] = set()
    for annotation in annotations:
        annotation_id = annotation.get("id")
        message_id = annotation.get("message_id")
        if not isinstance(annotation_id, str) or not annotation_id or annotation_id in annotation_ids:
            raise CanJsonParseError("CanJSON annotation ids must be present and unique.")
        annotation_ids.add(annotation_id)
        if not isinstance(message_id, str) or message_id not in message_ids:
            raise CanJsonParseError("CanJSON annotation references an unknown message.")
        version_id = annotation.get("version_id") or annotation.get("message_version_id")
        if version_id is not None and str(version_id) not in version_ids_by_message.get(message_id, set()):
            raise CanJsonParseError("CanJSON annotation references an unknown message version.")

    for ref in source_refs:
        if not isinstance(ref.get("message_id"), str) or ref["message_id"] not in message_ids:
            raise CanJsonParseError("CanJSON source_ref references an unknown message.")

    attachment_ids: set[str] = set()
    for attachment in attachments:
        if attachment.get("record_type") == "attachment":
            attachment_id = attachment.get("id")
            if not isinstance(attachment_id, str) or not attachment_id or attachment_id in attachment_ids:
                raise CanJsonParseError("CanJSON attachment ids must be present and unique.")
            attachment_ids.add(attachment_id)
    ref_keys: set[tuple[str, str, str, int]] = set()
    for ref in attachments:
        if ref.get("record_type") != "attachment_ref":
            continue
        attachment_id = str(ref.get("attachment_id") or "")
        message_id = str(ref.get("message_id") or "")
        version_id = str(ref.get("message_version_id") or "")
        display_order = _optional_int(ref.get("display_order")) or 0
        if attachment_id not in attachment_ids or message_id not in message_ids:
            raise CanJsonParseError("CanJSON attachment_ref references an unknown attachment or message.")
        if version_id and version_id not in version_ids_by_message.get(message_id, set()):
            raise CanJsonParseError("CanJSON attachment_ref references an unknown message version.")
        key = (attachment_id, message_id, version_id, display_order)
        if key in ref_keys:
            raise CanJsonParseError("CanJSON attachment_ref records must be unique.")
        ref_keys.add(key)

    notebook_ids: set[str] = set()
    for notebook in notebooks:
        notebook_id = notebook.get("id")
        if not isinstance(notebook_id, str) or not notebook_id or notebook_id in notebook_ids:
            raise CanJsonParseError("CanJSON notebook ids must be present and unique.")
        notebook_ids.add(notebook_id)
        blocks = notebook.get("blocks")
        if not isinstance(blocks, list):
            continue
        for block in blocks:
            if not isinstance(block, dict) or not block.get("annotation_id"):
                continue
            if str(block["annotation_id"]) not in annotation_ids:
                raise CanJsonParseError("CanJSON notebook references an unknown annotation.")


def _content_markdown(value: dict[str, Any]) -> str:
    content = value.get("content_markdown")
    if content is None:
        content = value.get("display_text")
    if not isinstance(content, str):
        raise CanJsonParseError("CanJSON message version content_markdown is missing.")
    if len(content.encode("utf-8")) > get_settings().canjson_max_line_bytes:
        raise CanJsonParseError("CanJSON message content exceeds the configured 32 MiB limit.")
    return content.replace("\r\n", "\n").replace("\r", "\n")


def _plain_text(markdown: str) -> str:
    return normalize_text(markdown)


def _role(value: Any) -> str:
    role = str(value or "unknown").strip().lower()
    return role if role in {"user", "assistant", "system", "tool", "developer", "unknown"} else "unknown"


def _json_depth(value: Any) -> int:
    if isinstance(value, dict):
        return 1 + max((_json_depth(item) for item in value.values()), default=0)
    if isinstance(value, list):
        return 1 + max((_json_depth(item) for item in value), default=0)
    return 1


def _required_id(record: dict[str, Any], label: str, line_number: int) -> str:
    return _required_str(record, "id", line_number, label)


def _required_str(record: dict[str, Any], key: str, line_number: int, label: str = "record") -> str:
    value = record.get(key)
    if not isinstance(value, str) or not value:
        raise CanJsonParseError(f"CanJSON {label} at line {line_number} requires {key}.")
    return value


def _optional_str(value: Any) -> str | None:
    return str(value) if value is not None else None


def _optional_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None
