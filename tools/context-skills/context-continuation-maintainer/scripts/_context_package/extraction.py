from __future__ import annotations

import hashlib
import json
import os
import tempfile
from collections import defaultdict
from pathlib import Path
from typing import Any

from .canonical_v2 import select_adapter
from .continuation_index import index_catalog, load_index_json
from .manifest import load_package_manifest
from .safety import safe_materialized_filename
from .source import PackageSource

REPORT_SCHEMA = "chat-reader-context-extraction"
REPORT_VERSION = "1.0.0"
TOOL_VERSION = "1.0.0"


class ExtractionError(Exception):
    pass


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _ranges(values: list[int]) -> list[list[int]]:
    if not values:
        return []
    vals = sorted(set(values))
    out = []
    start = prev = vals[0]
    for v in vals[1:]:
        if v == prev + 1:
            prev = v
        else:
            out.append([start, prev])
            start = prev = v
    out.append([start, prev])
    return out


def _parse_range(value: str) -> tuple[int, int]:
    if ":" not in value:
        raise ExtractionError(f"range must be START:END: {value}")
    a, b = value.split(":", 1)
    try:
        start, end = int(a), int(b)
    except ValueError as e:
        raise ExtractionError(f"range must contain integers: {value}") from e
    if start > end:
        raise ExtractionError(f"range start is greater than end: {value}")
    return start, end


def _split_text_by_utf8_bytes(text: str, target_bytes: int) -> list[str]:
    if target_bytes <= 0:
        return [text]
    parts: list[str] = []
    buf: list[str] = []
    size = 0
    for ch in text:
        b = len(ch.encode("utf-8"))
        if buf and size + b > target_bytes:
            parts.append("".join(buf))
            buf = []
            size = 0
        buf.append(ch)
        size += b
    if buf or not parts:
        parts.append("".join(buf))
    return parts


def _load_validation(path: str | None) -> dict[str, Any] | None:
    if not path:
        return None
    obj = json.loads(Path(path).read_text(encoding="utf-8"))
    if obj.get("report_schema") != "chat-reader-continuation-validation":
        raise ExtractionError("validation report has unsupported report_schema")
    return obj


def _verify_validation_binding(source: PackageSource, manifest, report: dict[str, Any]) -> None:
    b = report.get("binding") if isinstance(report.get("binding"), dict) else None
    if not b:
        raise ExtractionError("validation report does not contain a binding")
    if b.get("conversation_id") != manifest.conversation.get("id"):
        raise ExtractionError("stale_validation_report: conversation identity differs")
    entry = b.get("source_entrypoint")
    if entry != manifest.entrypoint:
        raise ExtractionError("stale_validation_report: source entrypoint differs")
    expected = b.get("source_entrypoint_sha256")
    if expected != f"sha256:{source.sha256(manifest.entrypoint)}":
        raise ExtractionError("stale_validation_report: source entrypoint content changed")
    for key, path_key, hash_key in [
        ("current", "current_path", "current_sha256"),
        ("index", "index_path", "index_sha256"),
    ]:
        rel = b.get(path_key)
        digest = b.get(hash_key)
        if not isinstance(rel, str) or not source.exists(rel):
            raise ExtractionError(f"stale_validation_report: {key} path missing")
        if digest != f"sha256:{source.sha256(rel)}":
            raise ExtractionError(f"stale_validation_report: {key} content changed")


def _continuation_paths(source: PackageSource, manifest) -> tuple[str, str]:
    current_path = "continuation/current.md"
    index_path = "continuation/index.json"
    if manifest.continuation:
        if isinstance(manifest.continuation.get("current"), str):
            current_path = manifest.continuation["current"]
        if isinstance(manifest.continuation.get("index"), str):
            index_path = manifest.continuation["index"]
    return current_path, index_path


def extract_context(
    package: str,
    *,
    validation_report: str | None = None,
    current: bool = False,
    index_catalog_requested: bool = False,
    all_messages: bool = False,
    tail: bool = False,
    ranges: list[str] | None = None,
    messages: list[int] | None = None,
    segments: list[str] | None = None,
    key_refs: list[str] | None = None,
    around: list[int] | None = None,
    neighbors: int = 0,
    attachments: list[str] | None = None,
    output_dir: str | None = None,
    chunk_max_bytes: int = 512 * 1024,
    inline_body_max_bytes: int = 128 * 1024,
    body_part_max_bytes: int = 128 * 1024,
) -> dict[str, Any]:
    ranges = ranges or []
    messages = messages or []
    segments = segments or []
    key_refs = key_refs or []
    around = around or []
    attachments = attachments or []
    if not any([current, index_catalog_requested, all_messages, tail, ranges, messages, segments, key_refs, around, attachments]):
        raise ExtractionError("at least one extraction selector is required")
    if neighbors < 0:
        raise ExtractionError("neighbors must be >= 0")

    report = _load_validation(validation_report)
    with PackageSource(package) as source:
        manifest = load_package_manifest(source)
        adapter = select_adapter(source, manifest.entrypoint)
        snap = adapter.scan()
        ordered_desc = snap.ordered_messages()
        seq_to_pos = {m.sequence: i for i, m in enumerate(ordered_desc)}
        seq_to_desc = {m.sequence: m for m in ordered_desc}
        current_path, index_path = _continuation_paths(source, manifest)

        validation_state = "unvalidated"
        if report is not None:
            _verify_validation_binding(source, manifest, report)
            validation_state = str(report.get("runtime_state"))

        continuation_selectors = bool(tail or segments or key_refs)
        if continuation_selectors:
            if report is None:
                raise ExtractionError("validation report is required for --tail, --segment, or --key-refs")
            if validation_state not in {"valid_verified", "valid_provisional", "locator_only_mismatch"}:
                raise ExtractionError(f"validation state is not eligible for continuation-derived extraction: {validation_state}")
            if validation_state == "locator_only_mismatch":
                if not report.get("usable_for_restore") or not (report.get("locator_repair") or {}).get("safe"):
                    raise ExtractionError("locator-only mismatch is not safely repairable")

        index_obj: dict[str, Any] | None = None
        if index_catalog_requested or segments or key_refs:
            if not source.exists(index_path):
                raise ExtractionError("index.json is not available")
            index_obj = load_index_json(source.read_text(index_path))

        if output_dir:
            bundle = Path(output_dir).resolve()
            if bundle.exists() and any(bundle.iterdir()):
                raise ExtractionError("output directory exists and is not empty")
            bundle.mkdir(parents=True, exist_ok=True)
        else:
            bundle = Path(tempfile.mkdtemp(prefix="chat-reader-extract-"))
        if source.kind == "directory":
            try:
                bundle.relative_to(Path(source.package_root).resolve())
            except ValueError:
                pass
            else:
                raise ExtractionError("output directory must not be inside the source package")

        findings: list[dict[str, Any]] = []
        selector_results: list[dict[str, Any]] = []
        reasons: dict[int, list[dict[str, Any]]] = defaultdict(list)
        selected: set[int] = set()
        selector_counter = 0

        def add_selector(kind: str, seqs: list[int], **extra: Any) -> None:
            nonlocal selector_counter
            selector_counter += 1
            sid = f"SEL-{selector_counter:03d}"
            for seq in seqs:
                selected.add(seq)
                reason = {"kind": kind, **extra}
                if reason not in reasons[seq]:
                    reasons[seq].append(reason)
            selector_results.append({
                "selector_id": sid, "kind": kind, "status": "resolved",
                "selected_message_count": len(set(seqs)), "sequence_ranges": _ranges(seqs), **extra,
            })

        if all_messages:
            add_selector("all_messages", [m.sequence for m in ordered_desc])
        for r in ranges:
            a, b = _parse_range(r)
            seqs = [m.sequence for m in ordered_desc if a <= m.sequence <= b]
            add_selector("range", seqs, requested=[a, b])
        for seq in messages:
            if seq not in seq_to_desc:
                raise ExtractionError(f"requested message sequence does not exist: {seq}")
            add_selector("message", [seq], sequence=seq)
        for seq in around:
            if seq not in seq_to_pos:
                raise ExtractionError(f"around anchor sequence does not exist: {seq}")
            pos = seq_to_pos[seq]
            lo = max(0, pos - neighbors)
            hi = min(len(ordered_desc), pos + neighbors + 1)
            seqs = [m.sequence for m in ordered_desc[lo:hi]]
            add_selector("around", seqs, anchor_sequence=seq, neighbors=neighbors)

        if tail:
            raw_tail = ((report.get("coverage") or {}).get("raw_tail") or {}) if report else {}
            seqs = raw_tail.get("sequences") if isinstance(raw_tail.get("sequences"), list) else None
            if seqs is None:
                boundary = ((report.get("coverage") or {}).get("boundary") or {}).get("sequence") if report else None
                if boundary not in seq_to_pos:
                    raise ExtractionError("validated boundary cannot be resolved in Raw source")
                seqs = [m.sequence for m in ordered_desc[seq_to_pos[boundary] + 1:]]
            add_selector("tail", [int(x) for x in seqs])

        seg_by_id = {}
        if index_obj is not None:
            seg_by_id = {s.get("id"): s for s in index_obj.get("segments", []) if isinstance(s, dict) and isinstance(s.get("id"), str)}
        for seg_id in segments:
            seg = seg_by_id.get(seg_id)
            if not seg:
                raise ExtractionError(f"Segment does not exist: {seg_id}")
            a, b = seg.get("seq_start"), seg.get("seq_end")
            if not isinstance(a, int) or not isinstance(b, int):
                raise ExtractionError(f"Segment has invalid range: {seg_id}")
            seqs = [m.sequence for m in ordered_desc if a <= m.sequence <= b]
            add_selector("segment", seqs, segment_id=seg_id)

        repair_map: dict[tuple[int, str], Any] = {}
        if report and validation_state == "locator_only_mismatch":
            for m in (report.get("locator_repair") or {}).get("mappings", []) or []:
                if isinstance(m, dict) and isinstance(m.get("sequence"), int) and isinstance(m.get("field"), str):
                    repair_map[(m["sequence"], m["field"])] = m.get("resolved")
        for seg_id in key_refs:
            seg = seg_by_id.get(seg_id)
            if not seg:
                raise ExtractionError(f"Segment does not exist: {seg_id}")
            anchors: list[int] = []
            for ref in seg.get("key_refs", []) if isinstance(seg.get("key_refs"), list) else []:
                if not isinstance(ref, dict) or ref.get("type", "message") != "message":
                    continue
                seq = ref.get("sequence")
                if not isinstance(seq, int) or seq not in seq_to_pos:
                    raise ExtractionError(f"Key Ref cannot be resolved for {seg_id}: {ref}")
                anchors.append(seq)
                pos = seq_to_pos[seq]
                lo, hi = max(0, pos - neighbors), min(len(ordered_desc), pos + neighbors + 1)
                seqs = [m.sequence for m in ordered_desc[lo:hi]]
                declared_ref = {k: ref.get(k) for k in ("sequence", "message_id", "version_id", "purpose", "note") if ref.get(k) is not None}
                resolved_ref = {
                    "sequence": seq,
                    "message_id": repair_map.get((seq, "message_id"), seq_to_desc[seq].message_id),
                    "version_id": repair_map.get((seq, "version_id"), seq_to_desc[seq].version_id),
                }
                add_selector("key_ref", seqs, segment_id=seg_id, anchor_sequence=seq, purpose=ref.get("purpose"), declared_ref=declared_ref, resolved_ref=resolved_ref, repair_applied=(declared_ref.get("message_id") not in (None, resolved_ref.get("message_id")) or declared_ref.get("version_id") not in (None, resolved_ref.get("version_id"))))
            selector_results.append({"selector_id": f"SEL-{selector_counter + 1:03d}", "kind": "key_refs_summary", "status": "resolved", "segment_id": seg_id, "anchors": len(anchors), "anchor_sequences": anchors})
            selector_counter += 1

        # Deliver Current exactly.
        current_delivery: dict[str, Any] = {"requested": current, "delivered": False}
        if current:
            if not source.exists(current_path):
                raise ExtractionError("current.md is not available")
            data = source.read_bytes(current_path)
            out = bundle / "current.md"
            out.write_bytes(data)
            current_delivery.update({
                "delivered": True, "complete": True, "path": "current.md",
                "byte_size": len(data), "sha256": f"sha256:{_sha256_bytes(data)}",
                "validation_state": validation_state,
            })

        catalog_delivery: dict[str, Any] = {"requested": index_catalog_requested, "delivered": False}
        if index_catalog_requested:
            assert index_obj is not None
            catalog = index_catalog(index_obj)
            p = bundle / "index-catalog.json"
            p.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            persisted_count = len(index_obj.get("segments", []) if isinstance(index_obj.get("segments"), list) else [])
            catalog_count = len(catalog.get("segments", []))
            catalog_delivery.update({
                "delivered": True,
                "complete_for_persisted_segments": persisted_count == catalog_count,
                "persisted_segment_count": persisted_count,
                "catalog_segment_count": catalog_count,
                "path": "index-catalog.json",
                "sha256": f"sha256:{_sha256_file(p)}",
                "validation_state": validation_state,
            })

        # Deliver selected messages.
        msg_dir = bundle / "messages"
        body_dir = bundle / "bodies"
        if selected:
            msg_dir.mkdir(parents=True, exist_ok=True)
        selected_messages = [m for m in adapter.iter_messages() if m.descriptor.sequence in selected]
        selected_messages.sort(key=lambda m: m.descriptor.ordinal)
        chunk_records: list[bytes] = []
        chunk_meta: list[dict[str, Any]] = []
        current_chunk: list[bytes] = []
        current_seqs: list[int] = []
        current_bytes = 0
        full_body_delivered = 0
        source_unavailable = 0
        delivery_incomplete = 0

        source_refs_by_message: dict[str, list[Any]] = defaultdict(list)
        for sr in snap.source_refs:
            if sr.message_id:
                source_refs_by_message[sr.message_id].append(sr)
        att_refs_by_message: dict[str, list[Any]] = defaultdict(list)
        for ar in snap.attachment_refs:
            if ar.message_id:
                att_refs_by_message[ar.message_id].append(ar)

        def flush_chunk() -> None:
            nonlocal current_chunk, current_seqs, current_bytes
            if not current_chunk:
                return
            idx = len(chunk_meta) + 1
            path = msg_dir / f"chunk-{idx:04d}.jsonl"
            data = b"".join(current_chunk)
            path.write_bytes(data)
            chunk_meta.append({
                "id": f"MSG-CHUNK-{idx:04d}", "path": f"messages/{path.name}",
                "message_count": len(current_chunk), "sequence_ranges": _ranges(current_seqs),
                "byte_size": len(data), "sha256": f"sha256:{_sha256_bytes(data)}",
            })
            current_chunk, current_seqs, current_bytes = [], [], 0

        for msg in selected_messages:
            d = msg.descriptor
            body_info: dict[str, Any] = {
                "representation": msg.representation,
                "available": d.body_available,
                "source_complete": d.body_available,
                "storage": None,
                "chars": d.body_chars,
                "utf8_bytes": d.body_utf8_bytes,
            }
            structured_parts = msg.content_parts if msg.representation != "markdown" else None
            if not d.body_available:
                source_unavailable += 1
            else:
                body = msg.body_text or ""
                raw_bytes = body.encode("utf-8")
                body_info["delivery_sha256"] = f"sha256:{_sha256_bytes(raw_bytes)}"
                if len(raw_bytes) <= inline_body_max_bytes:
                    body_info["storage"] = "inline"
                    body_info["text"] = body
                    full_body_delivered += 1
                else:
                    body_info["storage"] = "parts"
                    parts = _split_text_by_utf8_bytes(body, body_part_max_bytes)
                    pdir = body_dir / f"seq-{d.sequence:06d}"
                    pdir.mkdir(parents=True, exist_ok=True)
                    body_info["parts"] = []
                    rebuilt = bytearray()
                    for i, part in enumerate(parts, 1):
                        pp = pdir / f"part-{i:04d}.txt"
                        pb = part.encode("utf-8")
                        pp.write_bytes(pb)
                        rebuilt.extend(pb)
                        body_info["parts"].append({
                            "index": i, "path": pp.relative_to(bundle).as_posix(),
                            "utf8_bytes": len(pb), "sha256": f"sha256:{_sha256_bytes(pb)}",
                        })
                    if bytes(rebuilt) == raw_bytes:
                        full_body_delivered += 1
                    else:
                        delivery_incomplete += 1
                        findings.append({"severity": "error", "code": "body_part_reassembly_mismatch", "sequence": d.sequence})
            rec: dict[str, Any] = {
                "record_type": "extracted_message",
                "sequence": d.sequence,
                "message_id": d.message_id,
                "version_id": d.version_id,
                "version_number": d.version_number,
                "order_key": d.order_key,
                "role": d.role,
                "turn_index": d.turn_index,
                "created_at": d.created_at,
                "raw_locator": {"entrypoint": manifest.entrypoint, "line": d.line},
                "body": body_info,
                "attachment_refs": [ar.__dict__ for ar in att_refs_by_message.get(d.message_id or "", [])],
                "source_refs": [sr.__dict__ for sr in source_refs_by_message.get(d.message_id or "", [])],
                "selection_reasons": reasons.get(d.sequence, []),
            }
            if structured_parts is not None:
                rec["structured_content_parts"] = structured_parts
            line = (json.dumps(rec, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
            if current_chunk and current_bytes + len(line) > chunk_max_bytes:
                flush_chunk()
            current_chunk.append(line)
            current_seqs.append(d.sequence)
            current_bytes += len(line)
        flush_chunk()

        missing_selected = sorted(selected - {m.descriptor.sequence for m in selected_messages})
        if missing_selected:
            raise ExtractionError(f"selected messages disappeared during delivery: {missing_selected[:20]}")
        message_delivery = {
            "requested": bool(selected),
            "selected_message_count": len(selected),
            "emitted_descriptor_count": len(selected_messages),
            "source_available_body_count": sum(1 for m in selected_messages if m.descriptor.body_available),
            "source_unavailable_body_count": source_unavailable,
            "full_body_delivered_count": full_body_delivered,
            "delivery_incomplete_body_count": delivery_incomplete,
            "all_selected_existing_messages_emitted": len(selected) == len(selected_messages),
            "canonical_order": [m.descriptor.ordinal for m in selected_messages] == sorted(m.descriptor.ordinal for m in selected_messages),
            "sequence_ranges": _ranges([m.descriptor.sequence for m in selected_messages]),
            "chunks": chunk_meta,
        }

        # Deliver requested attachments exactly, never unpack them.
        att_root = bundle / "attachments"
        att_deliveries: list[dict[str, Any]] = []
        for aid in attachments:
            att = snap.attachments.get(aid)
            if att is None:
                raise ExtractionError(f"attachment ID does not exist: {aid}")
            if not att.object_path or not source.exists(att.object_path):
                att_deliveries.append({"attachment_id": aid, "available": False, "reason": "physical_object_missing"})
                findings.append({"severity": "warning", "code": "attachment_object_missing", "attachment_id": aid})
                continue
            name = safe_materialized_filename(att.original_filename or att.display_name, fallback="attachment.bin")
            out_dir = att_root / aid
            out_dir.mkdir(parents=True, exist_ok=True)
            dest = out_dir / name
            source.copy_member(att.object_path, dest)
            actual = _sha256_file(dest)
            declared_status = "not_declared"
            if att.object_sha256:
                declared_status = "match" if actual.lower() == att.object_sha256.lower() else "mismatch"
            att_deliveries.append({
                "attachment_id": aid, "available": True,
                "original_filename": att.original_filename,
                "mime_type": att.detected_mime_type or att.declared_mime_type,
                "materialized_path": dest.relative_to(bundle).as_posix(),
                "byte_size": dest.stat().st_size,
                "sha256": f"sha256:{actual}",
                "declared_sha256_status": declared_status,
            })

        status = "ok"
        if source_unavailable or delivery_incomplete or any(not x.get("available") for x in att_deliveries):
            status = "degraded"

        receipt = {
            "report_schema": REPORT_SCHEMA,
            "report_version": REPORT_VERSION,
            "tool": {"name": "extract_context_ranges", "version": TOOL_VERSION},
            "status": status,
            "semantic_read_performed": False,
            "bundle_path": str(bundle),
            "source": {
                "conversation_id": manifest.conversation.get("id"),
                "source_completeness": manifest.conversation_completeness,
                "canonical_message_count": len(ordered_desc),
            },
            "validation_binding": {
                "provided": report is not None,
                "matched": report is not None,
                "runtime_state": validation_state if report is not None else None,
                "continuation_revision": (report.get("binding") or {}).get("continuation_revision") if report else None,
            },
            "request": {
                "current": current, "index_catalog": index_catalog_requested,
                "all_messages": all_messages, "tail": tail, "ranges": ranges,
                "messages": messages, "segments": segments, "key_refs": key_refs,
                "around": around, "neighbors": neighbors, "attachments": attachments,
            },
            "selector_results": selector_results,
            "deliveries": {
                "current": current_delivery,
                "index_catalog": catalog_delivery,
                "messages": message_delivery,
                "attachments": {"requested_count": len(attachments), "materialized_count": sum(1 for x in att_deliveries if x.get("available")), "items": att_deliveries},
            },
            "findings": findings,
        }
        receipt_path = bundle / "receipt.json"
        receipt_path.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return receipt
