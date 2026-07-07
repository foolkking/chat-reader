import json
import re
from dataclasses import dataclass, field
from typing import Any

from app.services.import_pipeline.canonical_draft import content_hash, normalize_text


class ExporterJsonParseError(ValueError):
    pass


@dataclass(frozen=True)
class ExporterJsonMessage:
    role: str
    source_role: str
    text: str
    time: str | None
    index: int
    content_hash: str
    is_empty: bool


@dataclass(frozen=True)
class ExporterJsonParseResult:
    title: str | None
    metadata: dict[str, Any]
    created_at: str | None
    updated_at: str | None
    exported_at: str | None
    link: str | None
    external_conversation_id: str | None
    messages: list[ExporterJsonMessage]
    warnings: list[str] = field(default_factory=list)
    empty_message_count: int = 0
    prompt_count: int = 0
    response_count: int = 0
    message_count: int = 0


def parse_exporter_json(content: bytes | str) -> ExporterJsonParseResult:
    warnings: list[str] = []
    raw_text = content.decode("utf-8") if isinstance(content, bytes) else content

    try:
        payload = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        raise ExporterJsonParseError(f"Invalid JSON at line {exc.lineno}, column {exc.colno}.") from exc

    if not isinstance(payload, dict):
        raise ExporterJsonParseError("ChatGPT Exporter JSON must be a JSON object.")

    metadata = payload.get("metadata")
    if not isinstance(metadata, dict):
        metadata = {}
        warnings.append("metadata is missing or not an object.")

    if metadata.get("powered_by") != "ChatGPT Exporter":
        warnings.append("metadata.powered_by is not ChatGPT Exporter.")

    raw_messages = payload.get("messages")
    if not isinstance(raw_messages, list):
        raise ExporterJsonParseError("messages is missing or not a list.")

    messages: list[ExporterJsonMessage] = []
    empty_message_count = 0
    prompt_count = 0
    response_count = 0

    for index, raw_message in enumerate(raw_messages):
        if not isinstance(raw_message, dict):
            warnings.append(f"message {index} is not an object and was skipped.")
            continue

        source_role = str(raw_message.get("role") or "unknown")
        role = _map_role(source_role)
        text = str(raw_message.get("say") or "")
        normalized = normalize_text(text)
        is_empty = normalized == ""

        if is_empty:
            empty_message_count += 1
        if role == "user":
            prompt_count += 1
        elif role == "assistant":
            response_count += 1

        messages.append(
            ExporterJsonMessage(
                role=role,
                source_role=source_role,
                text=text,
                time=str(raw_message.get("time")) if raw_message.get("time") is not None else None,
                index=index,
                content_hash=content_hash(text),
                is_empty=is_empty,
            )
        )

    dates = metadata.get("dates") if isinstance(metadata.get("dates"), dict) else {}
    link = str(metadata.get("link")) if metadata.get("link") is not None else None

    return ExporterJsonParseResult(
        title=str(metadata.get("title")) if metadata.get("title") is not None else None,
        metadata=metadata,
        created_at=_optional_str(dates.get("created")),
        updated_at=_optional_str(dates.get("updated")),
        exported_at=_optional_str(dates.get("exported")),
        link=link,
        external_conversation_id=extract_conversation_id(link),
        messages=messages,
        warnings=warnings,
        empty_message_count=empty_message_count,
        prompt_count=prompt_count,
        response_count=response_count,
        message_count=len(messages),
    )


def extract_conversation_id(link: str | None) -> str | None:
    if not link:
        return None
    match = re.search(r"/c/([^/?#]+)", link)
    return match.group(1) if match else None


def _map_role(source_role: str) -> str:
    normalized = source_role.strip().lower()
    if normalized == "prompt":
        return "user"
    if normalized == "response":
        return "assistant"
    if normalized == "system":
        return "system"
    return "unknown"


def _optional_str(value: Any) -> str | None:
    return str(value) if value is not None else None
