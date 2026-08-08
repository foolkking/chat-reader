from __future__ import annotations

import base64
import codecs
import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from pathlib import Path

from app.core.config import get_settings

SCAN_LIMIT = 8 * 1024 * 1024
CHUNK_SIZE = 256 * 1024
RESULT_LIMIT = 200
RESPONSE_LIMIT = 256 * 1024
DEADLINE_SECONDS = 0.750
CURSOR_TTL_SECONDS = 15 * 60


class AttachmentTextSearchError(ValueError):
    def __init__(self, message: str, code: str = "invalid_search"):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class TextMatch:
    byte_offset: int
    preview: str


@dataclass(frozen=True)
class TextSearchPage:
    matches: list[TextMatch]
    scanned_bytes: int
    complete: bool
    next_cursor: str | None


def search_text_file(*, attachment_id: str, sha256: str, byte_size: int, path: Path, query: str, limit: int, cursor: str | None) -> TextSearchPage:
    normalized_query = query.strip()
    if not normalized_query or len(normalized_query) > 256:
        raise AttachmentTextSearchError("Query must contain 1-256 Unicode code points.")
    limit = max(1, min(limit, RESULT_LIMIT))
    encoding, bom_bytes = _detect_encoding(path)
    query_hash = hashlib.sha256(normalized_query.casefold().encode("utf-8")).hexdigest()
    offset = bom_bytes
    if cursor:
        payload = _decode_cursor(cursor)
        expected = {
            "attachment_id": attachment_id,
            "sha256": sha256,
            "byte_size": byte_size,
            "query_hash": query_hash,
            "encoding": encoding,
        }
        if any(payload.get(key) != value for key, value in expected.items()):
            raise AttachmentTextSearchError("The search cursor no longer matches this attachment or query.", "cursor_stale")
        offset = int(payload.get("offset", -1))
        if offset < bom_bytes or offset > byte_size:
            raise AttachmentTextSearchError("The search cursor is outside the attachment.", "cursor_stale")

    decoder = codecs.getincrementaldecoder(encoding)(errors="replace")
    deadline = time.monotonic() + DEADLINE_SECONDS
    scanned = 0
    matches: list[TextMatch] = []
    response_bytes = 0
    carry = ""
    carry_bytes = 0
    with path.open("rb") as source:
        source.seek(offset)
        while scanned < SCAN_LIMIT and len(matches) < limit and response_bytes < RESPONSE_LIMIT and time.monotonic() < deadline:
            chunk = source.read(min(CHUNK_SIZE, SCAN_LIMIT - scanned))
            if not chunk:
                break
            if encoding == "utf-8" and b"\x00" in chunk[:4096]:
                raise AttachmentTextSearchError("Binary attachments cannot be searched as text.", "binary_attachment")
            decoded = decoder.decode(chunk, final=False)
            haystack = carry + decoded
            folded = haystack.casefold()
            needle = normalized_query.casefold()
            cursor_index = 0
            while len(matches) < limit:
                found = folded.find(needle, cursor_index)
                if found < 0:
                    break
                preview = haystack[max(0, found - 80): min(len(haystack), found + len(normalized_query) + 120)].replace("\x00", "")
                encoded_prefix = haystack[:found].encode(encoding, errors="replace")
                byte_offset = max(offset, offset + scanned - carry_bytes + len(encoded_prefix))
                matches.append(TextMatch(byte_offset=byte_offset, preview=preview))
                response_bytes += len(preview.encode("utf-8")) + 32
                cursor_index = found + max(1, len(needle))
                if response_bytes >= RESPONSE_LIMIT:
                    break
            carry = haystack[-512:]
            carry_bytes = len(carry.encode(encoding, errors="replace"))
            scanned += len(chunk)

    next_offset = min(byte_size, offset + scanned)
    complete = next_offset >= byte_size
    next_cursor = None if complete else _encode_cursor({
        "attachment_id": attachment_id,
        "sha256": sha256,
        "byte_size": byte_size,
        "query_hash": query_hash,
        "encoding": encoding,
        "offset": next_offset,
        "exp": int(time.time()) + CURSOR_TTL_SECONDS,
    })
    return TextSearchPage(matches=matches, scanned_bytes=scanned, complete=complete, next_cursor=next_cursor)


def _detect_encoding(path: Path) -> tuple[str, int]:
    with path.open("rb") as source:
        prefix = source.read(4)
    if prefix.startswith(codecs.BOM_UTF8):
        return "utf-8-sig", len(codecs.BOM_UTF8)
    if prefix.startswith(codecs.BOM_UTF16_LE):
        return "utf-16-le", len(codecs.BOM_UTF16_LE)
    if prefix.startswith(codecs.BOM_UTF16_BE):
        return "utf-16-be", len(codecs.BOM_UTF16_BE)
    return "utf-8", 0


def _encode_cursor(payload: dict) -> str:
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    signature = hmac.new(get_settings().attachment_cursor_secret.encode("utf-8"), raw, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(raw + signature).decode("ascii").rstrip("=")


def _decode_cursor(cursor: str) -> dict:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        packed = base64.urlsafe_b64decode(padded.encode("ascii"))
        raw, signature = packed[:-32], packed[-32:]
        expected = hmac.new(get_settings().attachment_cursor_secret.encode("utf-8"), raw, hashlib.sha256).digest()
        if not hmac.compare_digest(signature, expected):
            raise ValueError
        payload = json.loads(raw)
        if int(payload.get("exp", 0)) < int(time.time()):
            raise AttachmentTextSearchError("The search cursor has expired.", "cursor_stale")
        return payload
    except AttachmentTextSearchError:
        raise
    except Exception as exc:
        raise AttachmentTextSearchError("The search cursor is invalid.", "cursor_stale") from exc
