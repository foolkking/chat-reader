from __future__ import annotations

import hashlib
import json
from typing import Any, Iterable
from types import SimpleNamespace

from .model import AttachmentRefDescriptor, CanonicalMessage, StreamSnapshot

PROFILE = "chat-reader-content-v1"
ALGORITHM = "sha256"
DOMAINS = {
    "prefix_content": "chat-reader-continuation-prefix-content-v1",
    "prefix_locators": "chat-reader-continuation-prefix-locators-v1",
    "segment_content": "chat-reader-continuation-segment-content-v1",
    "segment_locators": "chat-reader-continuation-segment-locators-v1",
}


def _normalize_text(s: str) -> str:
    return s.replace("\r\n", "\n").replace("\r", "\n")


def normalize_for_canonical_json(value: Any) -> Any:
    if isinstance(value, str):
        return _normalize_text(value)
    if isinstance(value, list):
        return [normalize_for_canonical_json(v) for v in value]
    if isinstance(value, dict):
        return {str(k): normalize_for_canonical_json(v) for k, v in value.items()}
    return value


def canonical_json_bytes(value: Any) -> bytes:
    # JCS-compatible for the JSON subset used by Continuation v1 fixtures.
    normalized = normalize_for_canonical_json(value)
    return json.dumps(normalized, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def ordered_attachment_refs(message: CanonicalMessage, snapshot: StreamSnapshot) -> list[AttachmentRefDescriptor]:
    refs = []
    mid = message.descriptor.message_id
    vid = message.descriptor.version_id
    for ref in snapshot.attachment_refs:
        if mid and ref.message_id == mid and (ref.message_version_id is None or vid is None or ref.message_version_id == vid):
            refs.append(ref)
    return sorted(
        refs,
        key=lambda r: (
            r.block_index if r.block_index is not None else 10**12,
            r.display_order if r.display_order is not None else 10**12,
            r.occurrence_key or "",
            r.attachment_id,
        ),
    )


def message_content_projection(message: CanonicalMessage, snapshot: StreamSnapshot | None = None) -> dict[str, Any]:
    parts = [dict(p) for p in message.content_parts]
    if snapshot is not None:
        for ref in ordered_attachment_refs(message, snapshot):
            att = snapshot.attachments.get(ref.attachment_id)
            digest = att.object_sha256 if att else None
            if digest:
                parts.append({"type": "attachment", "content_digest": f"sha256:{digest}"})
            else:
                # Missing attachment content cannot be silently ignored. A stable marker
                # keeps hashing deterministic while validation separately reports the gap.
                parts.append({"type": "attachment", "content_digest": None})
    return {"role": message.descriptor.role, "content": parts}


def message_locator_projection(message: CanonicalMessage, snapshot: StreamSnapshot | None = None) -> dict[str, Any]:
    d: dict[str, Any] = {"sequence": message.descriptor.sequence}
    if message.descriptor.message_id is not None:
        d["message_id"] = message.descriptor.message_id
    if message.descriptor.version_id is not None:
        d["version_id"] = message.descriptor.version_id
    if snapshot is not None:
        refs = ordered_attachment_refs(message, snapshot)
        if refs:
            d["attachment_locators"] = [r.attachment_id for r in refs]
    return d


def message_content_digest(message: CanonicalMessage, snapshot: StreamSnapshot | None = None) -> str:
    return sha256_hex(canonical_json_bytes(message_content_projection(message, snapshot)))


def message_locator_digest(message: CanonicalMessage, snapshot: StreamSnapshot | None = None) -> str:
    return sha256_hex(canonical_json_bytes(message_locator_projection(message, snapshot)))


def compose_digest(domain: str, child_digests: Iterable[str]) -> str:
    bare = [d.split(":", 1)[1] if d.startswith("sha256:") else d for d in child_digests]
    payload = (domain + "\n" + "\n".join(bare)).encode("utf-8")
    return sha256_hex(payload)


def fingerprint_messages(messages: Iterable[CanonicalMessage], snapshot: StreamSnapshot, scope: str) -> dict[str, str]:
    msgs = list(messages)
    if scope not in {"prefix", "segment"}:
        raise ValueError("scope must be prefix or segment")
    refs_by_message: dict[str | None, list[AttachmentRefDescriptor]] = {}
    for ref in snapshot.attachment_refs:
        refs_by_message.setdefault(ref.message_id, []).append(ref)
    content_children = []
    locator_children = []
    for message in msgs:
        # Avoid scanning every attachment occurrence twice per message. Keep
        # the existing projections and ordering byte-for-byte unchanged.
        local = SimpleNamespace(attachments=snapshot.attachments,
                                attachment_refs=refs_by_message.get(message.descriptor.message_id, []))
        content_children.append(message_content_digest(message, local))
        locator_children.append(message_locator_digest(message, local))
    return {
        "profile": PROFILE,
        "algorithm": ALGORITHM,
        "content": compose_digest(DOMAINS[f"{scope}_content"], content_children),
        "locators": compose_digest(DOMAINS[f"{scope}_locators"], locator_children),
    }
