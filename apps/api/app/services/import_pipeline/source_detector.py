import gzip
import hashlib
import json
import mimetypes
from io import BytesIO
from pathlib import Path
from typing import Any

from app.schemas.import_schema import SourceDetectionResult, SourceProfile


def detect_source_profile(filename: str, content: bytes) -> SourceDetectionResult:
    extension = _compound_extension(filename)
    mime_guess, _ = mimetypes.guess_type(filename)
    size_bytes = len(content)
    sha256 = hashlib.sha256(content).hexdigest()
    warnings: list[str] = []

    if extension == ".cr" and content.startswith(b"PK"):
        return _result(
            SourceProfile.chat_reader_cr_v2,
            1.0,
            "File is a Chat Reader ZIP64 archive container.",
            extension,
            "application/vnd.chat-reader.archive+zip",
            size_bytes,
            sha256,
            warnings,
        )

    jsonl_first = _first_jsonl_record(content, extension, warnings)
    if isinstance(jsonl_first, dict) and (
        jsonl_first.get("record_type") == "manifest"
        and jsonl_first.get("format") == "chat-reader-canonical-jsonl"
        and jsonl_first.get("version") == 2
    ):
        return _result(
            SourceProfile.chat_reader_canjson_v2,
            1.0,
            "First JSONL record is a Chat Reader CanJSON v2 manifest.",
            extension,
            "application/gzip" if extension.endswith(".gz") else "application/x-ndjson",
            size_bytes,
            sha256,
            warnings,
        )

    if extension in {".json", ".canonical.json"} or _looks_like_json(content):
        parsed = _parse_json(content, warnings)
        if parsed is None:
            return _result(SourceProfile.unknown, 0.0, "JSON content could not be decoded.", extension, mime_guess, size_bytes, sha256, warnings)
        if _looks_like_canjson_v1(parsed):
            return _result(
                SourceProfile.chat_reader_canjson_v1,
                1.0,
                "JSON contains the Chat Reader canonical export v1 marker.",
                extension,
                mime_guess,
                size_bytes,
                sha256,
                warnings,
            )
        if _looks_like_exporter_json(parsed):
            return _result(
                SourceProfile.chatgpt_exporter_json,
                0.98,
                "JSON contains a standardized metadata/messages projection with role and say fields.",
                extension,
                mime_guess,
                size_bytes,
                sha256,
                warnings,
            )
        if _looks_like_official_conversation(parsed):
            warnings.append("OpenAI official conversation graph input is no longer supported.")
        return _result(SourceProfile.unknown, 0.0, "JSON does not match a supported standardized input profile.", extension, mime_guess, size_bytes, sha256, warnings)

    if extension in {".md", ".markdown"}:
        text = _decode_text(content, warnings)
        if _looks_like_chatgpt_exporter_markdown(text):
            return _result(
                SourceProfile.chatgpt_exporter_markdown,
                0.95,
                "Markdown contains Prompt/Response sections outside the compatibility profile.",
                extension,
                mime_guess or "text/markdown",
                size_bytes,
                sha256,
                warnings,
            )

    return _result(SourceProfile.unknown, 0.0, "Input does not match one of the two supported import forms.", extension, mime_guess, size_bytes, sha256, warnings)


def _looks_like_exporter_json(value: Any) -> bool:
    if not isinstance(value, dict) or not isinstance(value.get("metadata"), dict):
        return False
    messages = value.get("messages")
    if not isinstance(messages, list):
        return False
    return all(
        isinstance(message, dict)
        and str(message.get("role") or "").strip().lower() in {"prompt", "response"}
        and "say" in message
        for message in messages
    )


def _looks_like_canjson_v1(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and value.get("format") == "chat-reader-canonical-export"
        and value.get("version") == 1
        and isinstance(value.get("messages"), list)
    )


def _looks_like_official_conversation(value: Any) -> bool:
    if isinstance(value, dict):
        return all(key in value for key in ("mapping", "current_node", "title"))
    if isinstance(value, list):
        return any(isinstance(item, dict) and _looks_like_official_conversation(item) for item in value)
    return False


def _first_jsonl_record(content: bytes, extension: str, warnings: list[str]) -> Any | None:
    try:
        if extension.endswith(".gz"):
            with gzip.GzipFile(fileobj=BytesIO(content)) as stream:
                first_line = stream.readline(32 * 1024 * 1024 + 1)
        else:
            first_line = BytesIO(content).readline(32 * 1024 * 1024 + 1)
        if not first_line or len(first_line) > 32 * 1024 * 1024:
            return None
        return json.loads(first_line.decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        if extension in {".jsonl.gz", ".canonical.jsonl.gz"}:
            warnings.append("Compressed CanJSON could not be decoded.")
        return None


def _parse_json(content: bytes, warnings: list[str]) -> Any | None:
    try:
        return json.loads(content.decode("utf-8"))
    except UnicodeDecodeError:
        warnings.append("File is not valid UTF-8 JSON.")
    except json.JSONDecodeError as exc:
        warnings.append(f"Invalid JSON: line {exc.lineno}, column {exc.colno}.")
    return None


def _decode_text(content: bytes, warnings: list[str]) -> str:
    try:
        return content.decode("utf-8")
    except UnicodeDecodeError:
        warnings.append("File is not valid UTF-8 text.")
        return content.decode("utf-8", errors="replace")


def _looks_like_json(content: bytes) -> bool:
    stripped = content.lstrip()
    return stripped.startswith(b"{") or stripped.startswith(b"[")


def _looks_like_chatgpt_exporter_markdown(text: str) -> bool:
    return "## Prompt:" in text and "## Response:" in text


def _compound_extension(filename: str) -> str:
    lowered = Path(filename).name.lower()
    for suffix in (".canonical.jsonl.gz", ".canonical.jsonl", ".canonical.json"):
        if lowered.endswith(suffix):
            return suffix
    return Path(lowered).suffix


def _result(
    source_profile: SourceProfile,
    confidence: float,
    reason: str,
    extension: str,
    mime_guess: str | None,
    size_bytes: int,
    sha256: str,
    warnings: list[str],
) -> SourceDetectionResult:
    return SourceDetectionResult(
        source_profile=source_profile,
        confidence=confidence,
        reason=reason,
        file_extension=extension,
        mime_guess=mime_guess,
        size_bytes=size_bytes,
        sha256=sha256,
        warnings=warnings,
    )
