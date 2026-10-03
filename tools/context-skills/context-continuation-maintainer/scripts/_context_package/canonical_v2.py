from __future__ import annotations

from .safety import load_protocol_json
from dataclasses import replace
from typing import Any, Iterator

from .model import (
    AttachmentDescriptor,
    AttachmentRefDescriptor,
    CanonicalMessage,
    CanonicalMessageDescriptor,
    Finding,
    SourceRefDescriptor,
    StreamSnapshot,
)
from .source import PackageSource, PackageError


SUPPORTED_CANONICAL_FORMAT = "chat-reader-canonical-jsonl"
SUPPORTED_CANONICAL_VERSION = 2
FIXTURE_SIMPLE_FORMAT = "chat-reader-fixture-simple-jsonl"
FIXTURE_SIMPLE_VERSION = 1


def _iter_json_lines(source: PackageSource, entrypoint: str) -> Iterator[tuple[int, dict[str, Any] | None, str | None]]:
    legacy_21 = False
    for line_no, raw in enumerate(source.iter_record_lines(entrypoint), 1):
        if not raw.strip():
            continue
        try:
            text = raw.decode("utf-8")
            obj = load_protocol_json(text)
            if not isinstance(obj, dict):
                yield line_no, None, "record is not a JSON object"
            else:
                if line_no == 1 and obj.get("record_type") == "header" and obj.get("schema") == "chat-reader-canjson" and obj.get("version") == "2.1":
                    legacy_21 = True
                    continue
                if legacy_21:
                    kind = obj.get("record_type")
                    if kind == "conversation":
                        obj = {"record_type": "manifest", "format": SUPPORTED_CANONICAL_FORMAT,
                               "version": 2, "conversation": obj,
                               "content": {"versions": "current_only"}}
                    elif kind == "message":
                        cv = dict(obj.get("current_version") or {})
                        # Adapt the historical projection in memory only; never rewrite Raw.
                        cv["content_markdown"] = cv.get("display_text")
                        cv["number"] = cv.get("version_number")
                        obj = {**obj, "current_version": cv}
                        yield line_no, obj, None
                        for ref in obj.get("attachment_refs", []):
                            yield line_no, {**ref, "record_type": "attachment_ref",
                                           "message_id": obj.get("id"), "message_version_id": cv.get("id"),
                                           "alt_text": ref.get("alt")}, None
                        continue
                yield line_no, obj, None
        except Exception as e:
            yield line_no, None, str(e)


def detect_stream_format(source: PackageSource, entrypoint: str) -> tuple[str, str | int | None, bool]:
    for _, obj, err in _iter_json_lines(source, entrypoint):
        if err:
            continue
        assert obj is not None
        if obj.get("record_type") == "manifest" and obj.get("format") == SUPPORTED_CANONICAL_FORMAT:
            version = obj.get("version")
            return SUPPORTED_CANONICAL_FORMAT, version, version == SUPPORTED_CANONICAL_VERSION
        if "sequence" in obj and "role" in obj and "content" in obj and "record_type" not in obj:
            return FIXTURE_SIMPLE_FORMAT, FIXTURE_SIMPLE_VERSION, True
        return "unknown", None, False
    return "unknown", None, False


class CanonicalV2Adapter:
    def __init__(self, source: PackageSource, entrypoint: str):
        self.source = source
        self.entrypoint = entrypoint

    def scan(self) -> StreamSnapshot:
        snap = StreamSnapshot(
            stream_format=SUPPORTED_CANONICAL_FORMAT,
            stream_version=SUPPORTED_CANONICAL_VERSION,
            supported=True,
        )
        ordinal = 0
        message_by_id: dict[str, CanonicalMessageDescriptor] = {}
        refs_by_message: dict[str, int] = {}
        known = {"manifest", "message", "source_ref", "attachment", "attachment_ref", "end"}

        for line_no, obj, err in _iter_json_lines(self.source, self.entrypoint):
            snap.total_records += 1
            if err:
                snap.parse_errors.append(Finding("error", "jsonl_parse_error", err, location=f"{self.entrypoint}:{line_no}"))
                continue
            assert obj is not None
            rt = str(obj.get("record_type") or "unknown")
            snap.records_by_type[rt] = snap.records_by_type.get(rt, 0) + 1
            if rt not in known:
                snap.unknown_record_types[rt] = snap.unknown_record_types.get(rt, 0) + 1
                continue
            if rt == "manifest":
                if snap.header is None:
                    snap.header = obj
                continue
            if rt == "message":
                ordinal += 1
                cv = obj.get("current_version") if isinstance(obj.get("current_version"), dict) else {}
                body_present = "content_markdown" in cv and cv.get("content_markdown") is not None
                body = cv.get("content_markdown") if body_present else None
                if body is not None and not isinstance(body, str):
                    body = str(body)
                desc = CanonicalMessageDescriptor(
                    sequence=int(obj.get("seq")),
                    ordinal=ordinal,
                    line=line_no,
                    role=str(obj.get("role") or "unknown"),
                    message_id=str(obj.get("id")) if obj.get("id") is not None else None,
                    version_id=str(cv.get("id")) if cv.get("id") is not None else None,
                    version_number=int(cv.get("number")) if isinstance(cv.get("number"), int) else None,
                    order_key=str(obj.get("order_key")) if obj.get("order_key") is not None else None,
                    turn_index=int(obj.get("turn_index")) if isinstance(obj.get("turn_index"), int) else None,
                    created_at=str(obj.get("created_at")) if obj.get("created_at") is not None else None,
                    body_available=body_present,
                    body_empty=(body == "") if body_present else False,
                    body_chars=len(body) if isinstance(body, str) else 0,
                    body_utf8_bytes=len(body.encode("utf-8")) if isinstance(body, str) else 0,
                    exporter_content_hash=str(cv.get("content_hash")) if cv.get("content_hash") is not None else None,
                )
                snap.messages.append(desc)
                if desc.message_id:
                    message_by_id[desc.message_id] = desc
                continue
            if rt == "source_ref":
                snap.source_refs.append(SourceRefDescriptor(
                    message_id=str(obj.get("message_id")) if obj.get("message_id") is not None else None,
                    source_type=str(obj.get("source_type")) if obj.get("source_type") is not None else None,
                    source_profile=str(obj.get("source_profile")) if obj.get("source_profile") is not None else None,
                    source_conversation_id=str(obj.get("source_conversation_id")) if obj.get("source_conversation_id") is not None else None,
                    source_message_id=str(obj.get("source_message_id")) if obj.get("source_message_id") is not None else None,
                    source_index=obj.get("source_index"),
                ))
                continue
            if rt == "attachment":
                aid = str(obj.get("id"))
                asset = obj.get("asset_object") if isinstance(obj.get("asset_object"), dict) else {}
                object_info = obj.get("object") if isinstance(obj.get("object"), dict) else {}
                snap.attachments[aid] = AttachmentDescriptor(
                    attachment_id=aid,
                    original_filename=obj.get("original_filename"),
                    display_name=obj.get("display_name"),
                    declared_mime_type=obj.get("declared_mime_type"),
                    detected_mime_type=obj.get("detected_mime_type") or asset.get("detected_mime_type"),
                    status=obj.get("status"),
                    resolution_status=obj.get("resolution_status"),
                    object_path=object_info.get("path"),
                    object_sha256=object_info.get("sha256") or asset.get("sha256"),
                    object_byte_size=object_info.get("byte_size") or asset.get("byte_size"),
                )
                continue
            if rt == "attachment_ref":
                ref = AttachmentRefDescriptor(
                    attachment_id=str(obj.get("attachment_id")),
                    message_id=str(obj.get("message_id")) if obj.get("message_id") is not None else None,
                    message_version_id=str(obj.get("message_version_id")) if obj.get("message_version_id") is not None else None,
                    occurrence_key=str(obj.get("occurrence_key")) if obj.get("occurrence_key") is not None else None,
                    placement=str(obj.get("placement")) if obj.get("placement") is not None else None,
                    relation_type=str(obj.get("relation_type")) if obj.get("relation_type") is not None else None,
                    display_order=int(obj.get("display_order")) if isinstance(obj.get("display_order"), int) else None,
                    block_index=int(obj.get("block_index")) if isinstance(obj.get("block_index"), int) else None,
                    display_mode=str(obj.get("display_mode")) if obj.get("display_mode") is not None else None,
                    alt_text=obj.get("alt_text"),
                    caption=obj.get("caption"),
                )
                snap.attachment_refs.append(ref)
                if ref.message_id:
                    refs_by_message[ref.message_id] = refs_by_message.get(ref.message_id, 0) + 1
                continue
            if rt == "end":
                snap.end = obj

        if refs_by_message:
            snap.messages = [replace(m, attachment_ref_count=refs_by_message.get(m.message_id or "", 0)) for m in snap.messages]
        return snap

    def iter_messages(self) -> Iterator[CanonicalMessage]:
        ordinal = 0
        for line_no, obj, err in _iter_json_lines(self.source, self.entrypoint):
            if err or obj is None or obj.get("record_type") != "message":
                continue
            ordinal += 1
            cv = obj.get("current_version") if isinstance(obj.get("current_version"), dict) else {}
            body_present = "content_markdown" in cv and cv.get("content_markdown") is not None
            body = cv.get("content_markdown") if body_present else None
            if body is not None and not isinstance(body, str):
                body = str(body)
            desc = CanonicalMessageDescriptor(
                sequence=int(obj.get("seq")), ordinal=ordinal, line=line_no,
                role=str(obj.get("role") or "unknown"),
                message_id=str(obj.get("id")) if obj.get("id") is not None else None,
                version_id=str(cv.get("id")) if cv.get("id") is not None else None,
                version_number=int(cv.get("number")) if isinstance(cv.get("number"), int) else None,
                order_key=str(obj.get("order_key")) if obj.get("order_key") is not None else None,
                turn_index=int(obj.get("turn_index")) if isinstance(obj.get("turn_index"), int) else None,
                created_at=str(obj.get("created_at")) if obj.get("created_at") is not None else None,
                body_available=body_present,
                body_empty=(body == "") if body_present else False,
                body_chars=len(body) if isinstance(body, str) else 0,
                body_utf8_bytes=len(body.encode("utf-8")) if isinstance(body, str) else 0,
                exporter_content_hash=str(cv.get("content_hash")) if cv.get("content_hash") is not None else None,
            )
            parts = [{"type": "text", "text": body}] if body_present else []
            yield CanonicalMessage(desc, body, "markdown", parts)


class FixtureSimpleAdapter:
    """Adapter used by executable conformance fixtures.

    Records are one canonical message per JSON line with fields
    `sequence`, `role`, and ordered `content` parts.
    """

    def __init__(self, source: PackageSource, entrypoint: str):
        self.source = source
        self.entrypoint = entrypoint

    def scan(self) -> StreamSnapshot:
        snap = StreamSnapshot(FIXTURE_SIMPLE_FORMAT, FIXTURE_SIMPLE_VERSION, True)
        ordinal = 0
        for line_no, obj, err in _iter_json_lines(self.source, self.entrypoint):
            snap.total_records += 1
            if err:
                snap.parse_errors.append(Finding("error", "jsonl_parse_error", err, location=f"{self.entrypoint}:{line_no}"))
                continue
            assert obj is not None
            if not {"sequence", "role", "content"}.issubset(obj):
                snap.unknown_record_types["unknown"] = snap.unknown_record_types.get("unknown", 0) + 1
                continue
            ordinal += 1
            parts = obj.get("content") if isinstance(obj.get("content"), list) else []
            texts = [p.get("text") for p in parts if isinstance(p, dict) and p.get("type") == "text" and isinstance(p.get("text"), str)]
            body = "".join(texts)
            seq = int(obj.get("sequence"))
            desc = CanonicalMessageDescriptor(
                sequence=seq, ordinal=ordinal, line=line_no, role=str(obj.get("role") or "unknown"),
                message_id=str(obj.get("message_id")) if obj.get("message_id") is not None else None,
                version_id=str(obj.get("version_id")) if obj.get("version_id") is not None else None,
                version_number=int(obj.get("version_number")) if isinstance(obj.get("version_number"), int) else None,
                order_key=str(obj.get("order_key")) if obj.get("order_key") is not None else None,
                turn_index=int(obj.get("turn_index")) if isinstance(obj.get("turn_index"), int) else None,
                created_at=str(obj.get("created_at")) if obj.get("created_at") is not None else None,
                body_available=True,
                body_empty=(body == ""),
                body_chars=len(body),
                body_utf8_bytes=len(body.encode("utf-8")),
            )
            snap.messages.append(desc)
            snap.records_by_type["message"] = snap.records_by_type.get("message", 0) + 1
        return snap

    def iter_messages(self) -> Iterator[CanonicalMessage]:
        ordinal = 0
        for line_no, obj, err in _iter_json_lines(self.source, self.entrypoint):
            if err or obj is None or not {"sequence", "role", "content"}.issubset(obj):
                continue
            ordinal += 1
            parts = obj.get("content") if isinstance(obj.get("content"), list) else []
            texts = [p.get("text") for p in parts if isinstance(p, dict) and p.get("type") == "text" and isinstance(p.get("text"), str)]
            body = "".join(texts)
            desc = CanonicalMessageDescriptor(
                sequence=int(obj.get("sequence")), ordinal=ordinal, line=line_no,
                role=str(obj.get("role") or "unknown"),
                message_id=str(obj.get("message_id")) if obj.get("message_id") is not None else None,
                version_id=str(obj.get("version_id")) if obj.get("version_id") is not None else None,
                version_number=int(obj.get("version_number")) if isinstance(obj.get("version_number"), int) else None,
                order_key=str(obj.get("order_key")) if obj.get("order_key") is not None else None,
                turn_index=int(obj.get("turn_index")) if isinstance(obj.get("turn_index"), int) else None,
                created_at=str(obj.get("created_at")) if obj.get("created_at") is not None else None,
                body_available=True, body_empty=(body == ""), body_chars=len(body), body_utf8_bytes=len(body.encode("utf-8")),
            )
            yield CanonicalMessage(desc, body, "structured_parts", parts)


def select_adapter(source: PackageSource, entrypoint: str):
    fmt, version, supported = detect_stream_format(source, entrypoint)
    if fmt == SUPPORTED_CANONICAL_FORMAT and version == SUPPORTED_CANONICAL_VERSION:
        return CanonicalV2Adapter(source, entrypoint)
    if fmt == FIXTURE_SIMPLE_FORMAT:
        return FixtureSimpleAdapter(source, entrypoint)
    raise PackageError(f"unsupported stream format/version: {fmt} {version}")
