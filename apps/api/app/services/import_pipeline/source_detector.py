import csv
import hashlib
import json
import mimetypes
from pathlib import Path
from typing import Any

from app.schemas.import_schema import SourceDetectionResult, SourceProfile


def detect_source_profile(filename: str, content: bytes) -> SourceDetectionResult:
    extension = Path(filename).suffix.lower()
    mime_guess, _ = mimetypes.guess_type(filename)
    size_bytes = len(content)
    sha256 = hashlib.sha256(content).hexdigest()
    warnings: list[str] = []

    if extension == ".json" or _looks_like_json(content):
        parsed = _parse_json(content, warnings)
        if parsed is None:
            return SourceDetectionResult(
                source_profile=SourceProfile.unknown,
                confidence=0.0,
                reason="JSON content could not be decoded.",
                file_extension=extension,
                mime_guess=mime_guess or "application/json",
                size_bytes=size_bytes,
                sha256=sha256,
                warnings=warnings,
            )
        return _detect_json_profile(parsed, extension, mime_guess, size_bytes, sha256, warnings)

    if extension == ".csv" or _looks_like_csv(content):
        return SourceDetectionResult(
            source_profile=SourceProfile.csv,
            confidence=0.9 if extension == ".csv" else 0.7,
            reason="CSV extension or comma-separated header detected.",
            file_extension=extension,
            mime_guess=mime_guess,
            size_bytes=size_bytes,
            sha256=sha256,
            warnings=warnings,
        )

    if extension == ".txt":
        return SourceDetectionResult(
            source_profile=SourceProfile.plain_text,
            confidence=0.8,
            reason="Plain text extension detected.",
            file_extension=extension,
            mime_guess=mime_guess,
            size_bytes=size_bytes,
            sha256=sha256,
            warnings=warnings,
        )

    if extension in {".md", ".markdown"}:
        text = _decode_text(content, warnings)
        if _looks_like_chatgpt_exporter_markdown(text):
            return SourceDetectionResult(
                source_profile=SourceProfile.chatgpt_exporter_markdown,
                confidence=0.9,
                reason="Markdown contains ChatGPT Exporter prompt/response sections and export metadata.",
                file_extension=extension,
                mime_guess=mime_guess or "text/markdown",
                size_bytes=size_bytes,
                sha256=sha256,
                warnings=warnings,
            )

    return SourceDetectionResult(
        source_profile=SourceProfile.unknown,
        confidence=0.0,
        reason="No Stage 01 source detection rule matched.",
        file_extension=extension,
        mime_guess=mime_guess,
        size_bytes=size_bytes,
        sha256=sha256,
        warnings=warnings,
    )


def _detect_json_profile(
    parsed: Any,
    extension: str,
    mime_guess: str | None,
    size_bytes: int,
    sha256: str,
    warnings: list[str],
) -> SourceDetectionResult:
    if isinstance(parsed, dict):
        metadata = parsed.get("metadata")
        if (
            isinstance(metadata, dict)
            and metadata.get("powered_by") == "ChatGPT Exporter"
            and isinstance(parsed.get("messages"), list)
        ):
            return _result(
                SourceProfile.chatgpt_exporter_json,
                0.95,
                "JSON contains ChatGPT Exporter metadata and messages.",
                extension,
                mime_guess,
                size_bytes,
                sha256,
                warnings,
            )

        if _looks_like_official_conversation(parsed):
            return _result(
                SourceProfile.official_conversation_json,
                0.95,
                "JSON object contains official conversation mapping/current_node/title.",
                extension,
                mime_guess,
                size_bytes,
                sha256,
                warnings,
            )

        if _looks_like_third_party_splitter(parsed):
            return _result(
                SourceProfile.third_party_splitter_json,
                0.55,
                "JSON object has conversation-like fields without official mapping or exporter metadata.",
                extension,
                mime_guess,
                size_bytes,
                sha256,
                warnings,
            )

    if isinstance(parsed, list):
        if parsed and all(isinstance(item, dict) and _looks_like_official_conversation(item) for item in parsed):
            return _result(
                SourceProfile.official_conversations_json,
                0.95,
                "JSON list contains official conversation objects.",
                extension,
                mime_guess,
                size_bytes,
                sha256,
                warnings,
            )

        if any(isinstance(item, dict) and _looks_like_third_party_splitter(item) for item in parsed):
            return _result(
                SourceProfile.third_party_splitter_json,
                0.5,
                "JSON list has conversation-like objects without official mapping.",
                extension,
                mime_guess,
                size_bytes,
                sha256,
                warnings,
            )

    return _result(
        SourceProfile.unknown,
        0.1,
        "JSON decoded but did not match a known Stage 01 source profile.",
        extension,
        mime_guess,
        size_bytes,
        sha256,
        warnings,
    )


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
        mime_guess=mime_guess or "application/json",
        size_bytes=size_bytes,
        sha256=sha256,
        warnings=warnings,
    )


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
    has_sections = "## Prompt:" in text and "## Response:" in text
    metadata_markers = ("Created", "Updated", "Exported", "Link")
    has_metadata = any(marker in text[:1000] for marker in metadata_markers)
    return has_sections and has_metadata


def _looks_like_official_conversation(value: dict[str, Any]) -> bool:
    return all(key in value for key in ("mapping", "current_node", "title"))


def _looks_like_third_party_splitter(value: dict[str, Any]) -> bool:
    keys = set(value.keys())
    conversation_like_keys = {
        "conversation",
        "conversations",
        "messages",
        "title",
        "role",
        "content",
        "prompt",
        "response",
    }
    return bool(keys & conversation_like_keys) and "mapping" not in keys


def _looks_like_csv(content: bytes) -> bool:
    sample = content[:4096].decode("utf-8", errors="ignore")
    if not sample.strip() or "," not in sample:
        return False
    try:
        dialect = csv.Sniffer().sniff(sample)
        return dialect.delimiter == ","
    except csv.Error:
        return False
