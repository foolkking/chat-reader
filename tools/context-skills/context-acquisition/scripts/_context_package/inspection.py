from __future__ import annotations

import json
import math
from collections import Counter
from typing import Any

from .canonical_v2 import detect_stream_format, select_adapter
from .manifest import load_package_manifest
from .model import Finding
from .source import AmbiguousPackageRoot, PackageError, PackageSource

REPORT_SCHEMA = "chat-reader-package-inspection"
REPORT_VERSION = "1.0.0"
TOOL_VERSION = "1.0.0"
SUPPORTED_PACKAGE_FORMAT = "chat-reader-context-package"
SUPPORTED_PACKAGE_MAJOR = 1


def _major(version: str | None) -> int | None:
    if version is None:
        return None
    try:
        return int(str(version).split(".", 1)[0])
    except Exception:
        return None


def _ranges(values: list[int]) -> list[list[int]]:
    if not values:
        return []
    vals = sorted(set(values))
    out: list[list[int]] = []
    start = prev = vals[0]
    for v in vals[1:]:
        if v == prev + 1:
            prev = v
            continue
        out.append([start, prev])
        start = prev = v
    out.append([start, prev])
    return out


def _missing_ranges(values: list[int]) -> list[list[int]]:
    if not values:
        return []
    vals = sorted(set(values))
    # Sequence values are untrusted: never enumerate the numeric span.
    return [[left + 1, right - 1] for left, right in zip(vals, vals[1:])
            if right > left + 1]



def _percentile(values: list[int], q: float) -> int:
    if not values:
        return 0
    vals = sorted(values)
    if len(vals) == 1:
        return vals[0]
    pos = (len(vals) - 1) * q
    lo = math.floor(pos)
    hi = math.ceil(pos)
    if lo == hi:
        return vals[lo]
    return int(round(vals[lo] + (vals[hi] - vals[lo]) * (pos - lo)))


def _continuation_presence(source: PackageSource, manifest_cont: dict[str, Any] | None) -> dict[str, Any]:
    current_path = "continuation/current.md"
    index_path = "continuation/index.json"
    if manifest_cont:
        if isinstance(manifest_cont.get("current"), str):
            current_path = manifest_cont["current"]
        if isinstance(manifest_cont.get("index"), str):
            index_path = manifest_cont["index"]
    c = source.exists(current_path)
    i = source.exists(index_path)
    if c and i:
        presence = "pair"
    elif c:
        presence = "current_only"
    elif i:
        presence = "index_only"
    else:
        presence = "none"
    out: dict[str, Any] = {"presence": presence}
    if c:
        out["current"] = {"path": current_path, "byte_size": source.byte_size(current_path)}
    if i:
        out["index"] = {"path": index_path, "byte_size": source.byte_size(index_path)}
    if manifest_cont:
        out["manifest_hint"] = {
            k: manifest_cont.get(k)
            for k in ("schema_version", "continuation_revision", "trust", "coverage", "source_fingerprint")
            if k in manifest_cont
        }
    return out


def inspect_package(path: str, verify_hashes: str = "core", detail: str = "summary") -> dict[str, Any]:
    findings: list[Finding] = []
    try:
        source = PackageSource(path)
    except AmbiguousPackageRoot as e:
        return {
            "report_schema": REPORT_SCHEMA,
            "report_version": REPORT_VERSION,
            "tool": {"name": "inspect_context_package", "version": TOOL_VERSION},
            "status": "ambiguous",
            "input": {"source_name": str(path)},
            "anomalies": [Finding("error", "ambiguous_package_root", str(e)).to_dict()],
        }
    except Exception as e:
        return {
            "report_schema": REPORT_SCHEMA,
            "report_version": REPORT_VERSION,
            "tool": {"name": "inspect_context_package", "version": TOOL_VERSION},
            "status": "invalid",
            "input": {"source_name": str(path)},
            "anomalies": [Finding("error", "package_open_failed", str(e)).to_dict()],
        }

    with source:
        security = source.zip_resource_summary()
        security.update({"unsafe_member_paths": source.unsafe_member_paths, "guard_triggered": bool(source.unsafe_member_paths)})
        if source.unsafe_member_paths:
            findings.append(Finding("error", "unsafe_member_path", "archive contains unsafe member paths", observed=source.unsafe_member_paths[:20]))
        try:
            manifest = load_package_manifest(source)
        except PackageError as e:
            return {
                "report_schema": REPORT_SCHEMA,
                "report_version": REPORT_VERSION,
                "tool": {"name": "inspect_context_package", "version": TOOL_VERSION},
                "status": "invalid",
                "input": {"kind": source.kind, "source_name": source.path.name, "package_root": source.package_root},
                "security": security,
                "anomalies": [Finding("error", "manifest_invalid", str(e)).to_dict()],
            }

        pkg_supported = manifest.format == SUPPORTED_PACKAGE_FORMAT and _major(manifest.format_version) == SUPPORTED_PACKAGE_MAJOR
        if not source.exists(manifest.entrypoint):
            findings.append(Finding("error", "entrypoint_missing", "manifest entrypoint does not exist", location=manifest.entrypoint))
            stream_fmt = ("unknown", None, False)
            snap = None
        else:
            stream_fmt = ("unknown", None, False)
            try:
                stream_fmt = detect_stream_format(source, manifest.entrypoint)
                adapter = select_adapter(source, manifest.entrypoint)
                snap = adapter.scan()
            except Exception as e:
                snap = None
                findings.append(Finding("error", "stream_scan_failed", str(e), location=manifest.entrypoint))

        if not pkg_supported:
            findings.append(Finding("error", "unsupported_package_format", "package format/version is unsupported", observed={"format": manifest.format, "version": manifest.format_version}))
        if not stream_fmt[2]:
            findings.append(Finding("error", "unsupported_stream_format", "stream format/version is unsupported", observed={"format": stream_fmt[0], "version": stream_fmt[1]}))

        declared_missing: list[str] = []
        size_mismatches: list[dict[str, Any]] = []
        hash_mismatches: list[dict[str, Any]] = []
        files_checked_hash: list[str] = []
        for rel, meta in manifest.files.items():
            if not isinstance(meta, dict):
                continue
            if not source.exists(rel):
                declared_missing.append(rel)
                continue
            if isinstance(meta.get("byte_size"), int):
                actual = source.byte_size(rel)
                if actual != meta["byte_size"]:
                    size_mismatches.append({"path": rel, "expected": meta["byte_size"], "observed": actual})
            should_hash = verify_hashes == "all" or (verify_hashes == "core" and rel == manifest.entrypoint)
            if should_hash and isinstance(meta.get("sha256"), str):
                actual_hash = source.sha256(rel)
                files_checked_hash.append(rel)
                if actual_hash.lower() != meta["sha256"].lower():
                    hash_mismatches.append({"path": rel, "expected": meta["sha256"], "observed": actual_hash})
        for p in declared_missing:
            findings.append(Finding("warning", "declared_file_missing", "manifest-declared file is missing", location=p))
        for m in size_mismatches:
            findings.append(Finding("warning", "declared_file_size_mismatch", "manifest-declared file size does not match source", location=m["path"], expected=m["expected"], observed=m["observed"]))
        for m in hash_mismatches:
            findings.append(Finding("error", "declared_file_hash_mismatch", "manifest-declared SHA-256 does not match source", location=m["path"], expected=m["expected"], observed=m["observed"]))

        canonical: dict[str, Any] = {"supported": bool(snap and snap.supported)}
        source_refs: dict[str, Any] = {"count": 0, "dangling_message_refs": [], "source_types": {}}
        attachments: dict[str, Any] = {
            "record_count": 0, "reference_count": 0, "available_attachment_count": 0,
            "physical_object_count": 0, "unique_content_hash_count": 0,
            "declared_missing_object_count": manifest.attachments.get("missing_object_count", 0) if manifest.attachments else 0,
            "observed_missing_object_count": 0, "dangling_attachment_refs": [],
            "dangling_message_refs": [], "dangling_version_refs": [], "mime_types": {},
        }
        consistency: dict[str, Any] = {}
        stream_out: dict[str, Any] = {
            "path": manifest.entrypoint,
            "format": {"name": stream_fmt[0], "version": stream_fmt[1], "supported": stream_fmt[2]},
        }

        if snap is not None:
            seqs = [m.sequence for m in snap.messages]
            role_counts = Counter(m.role for m in snap.messages)
            body_sizes = [m.body_chars for m in snap.messages if m.body_available]
            utf8_total = sum(m.body_utf8_bytes for m in snap.messages if m.body_available)
            seq_counts = Counter(seqs)
            dup_seq = sorted([s for s, c in seq_counts.items() if c > 1])
            mids = [m.message_id for m in snap.messages if m.message_id]
            vids = [m.version_id for m in snap.messages if m.version_id]
            dup_mid = sorted([x for x, c in Counter(mids).items() if c > 1])
            dup_vid = sorted([x for x, c in Counter(vids).items() if c > 1])
            order_keys = [m.order_key for m in snap.messages]
            nonmono = 0
            last = None
            for ok in order_keys:
                if ok is None:
                    continue
                if last is not None and ok < last:
                    nonmono += 1
                last = ok
            canonical.update({
                "message_count": len(snap.messages),
                "body_available_count": sum(1 for m in snap.messages if m.body_available),
                "body_missing_count": sum(1 for m in snap.messages if not m.body_available),
                "body_empty_count": sum(1 for m in snap.messages if m.body_available and m.body_empty),
                "role_counts": dict(sorted(role_counts.items())),
                "sequence": {
                    "min": min(seqs) if seqs else None, "max": max(seqs) if seqs else None,
                    "ranges": _ranges(seqs), "missing_within_span": _missing_ranges(seqs),
                    "duplicate_sequences": dup_seq,
                },
                "identities": {"duplicate_message_ids": dup_mid, "duplicate_version_ids": dup_vid},
                "ordering": {"missing_order_keys": sum(1 for x in order_keys if x is None), "nonmonotonic_order_keys": nonmono},
                "body_size": {
                    "chars_total": sum(body_sizes), "chars_max": max(body_sizes, default=0),
                    "chars_p50": _percentile(body_sizes, .50), "chars_p95": _percentile(body_sizes, .95),
                    "utf8_bytes_total": utf8_total,
                },
            })
            if detail == "index":
                canonical["message_index"] = [m.compact_dict() for m in snap.ordered_messages()]

            msg_ids = set(mids)
            ver_ids = set(vids)
            dangling_src = sorted({r.message_id for r in snap.source_refs if r.message_id and r.message_id not in msg_ids})
            source_refs = {
                "count": len(snap.source_refs),
                "dangling_message_refs": dangling_src,
                "source_types": dict(sorted(Counter(r.source_type or "unknown" for r in snap.source_refs).items())),
            }

            att_refs = snap.attachment_refs
            att_ids = set(snap.attachments)
            missing_objects = []
            physical_paths = []
            hashes = []
            mimes = Counter()
            for aid, att in snap.attachments.items():
                if att.detected_mime_type or att.declared_mime_type:
                    mimes[att.detected_mime_type or att.declared_mime_type or "unknown"] += 1
                if att.object_path:
                    physical_paths.append(att.object_path)
                    if not source.exists(att.object_path):
                        missing_objects.append(aid)
                elif att.status == "available" or att.resolution_status == "available":
                    missing_objects.append(aid)
                if att.object_sha256:
                    hashes.append(att.object_sha256)
            dangling_att = sorted({r.attachment_id for r in att_refs if r.attachment_id not in att_ids})
            dangling_msg = sorted({r.message_id for r in att_refs if r.message_id and r.message_id not in msg_ids})
            dangling_ver = sorted({r.message_version_id for r in att_refs if r.message_version_id and r.message_version_id not in ver_ids})
            attachments = {
                "record_count": len(snap.attachments), "reference_count": len(att_refs),
                "available_attachment_count": sum(1 for a in snap.attachments.values() if a.status == "available" or a.resolution_status == "available"),
                "physical_object_count": len(set(physical_paths)), "unique_content_hash_count": len(set(hashes)),
                "declared_missing_object_count": manifest.attachments.get("missing_object_count", 0) if manifest.attachments else 0,
                "observed_missing_object_count": len(missing_objects), "observed_missing_attachment_ids": sorted(missing_objects),
                "dangling_attachment_refs": dangling_att, "dangling_message_refs": dangling_msg, "dangling_version_refs": dangling_ver,
                "mime_types": dict(sorted(mimes.items())),
            }

            header_conv_id = None
            header_declared_count = None
            header_versions = None
            header_scope = None
            content_format = None
            if snap.header:
                conv = snap.header.get("conversation") if isinstance(snap.header.get("conversation"), dict) else {}
                sel = snap.header.get("selection") if isinstance(snap.header.get("selection"), dict) else {}
                content = snap.header.get("content") if isinstance(snap.header.get("content"), dict) else {}
                header_conv_id = conv.get("id")
                header_declared_count = sel.get("message_count")
                header_versions = content.get("versions")
                header_scope = sel.get("scope")
                content_format = content.get("format")
            stream_out.update({
                "header": {"present": snap.header is not None, "conversation_id": header_conv_id,
                           "selection_scope": header_scope, "declared_message_count": header_declared_count,
                           "versions": header_versions, "content_format": content_format},
                "end": {"present": snap.end is not None, "last_record": snap.end is not None,
                        "declared_record_count": snap.end.get("record_count") if snap.end else None,
                        "declared_message_count": snap.end.get("message_count") if snap.end else None},
                "records": {"total": snap.total_records, "by_type": snap.records_by_type, "unknown_types": snap.unknown_record_types},
                "parse_errors": [f.to_dict() for f in snap.parse_errors],
            })

            manifest_conv_id = manifest.conversation.get("id")
            manifest_count = manifest.conversation.get("message_count")
            values = [x for x in [manifest_count, header_declared_count, len(snap.messages), snap.end.get("message_count") if snap.end else None] if x is not None]
            consistency = {
                "conversation_id": "match" if not header_conv_id or not manifest_conv_id or header_conv_id == manifest_conv_id else "mismatch",
                "message_counts": "match" if len(set(values)) <= 1 else "mismatch",
                "version_scope": "match" if not header_versions or manifest.conversation.get("current_versions_only") is None or (header_versions == "current_only") == bool(manifest.conversation.get("current_versions_only")) else "mismatch",
                "record_count": "match" if not snap.end or snap.end.get("record_count") in (None, snap.total_records) else "mismatch",
            }
            if consistency["conversation_id"] == "mismatch":
                findings.append(Finding("error", "conversation_id_mismatch", "package manifest and stream header conversation IDs differ", expected=manifest_conv_id, observed=header_conv_id))
            if consistency["message_counts"] == "mismatch":
                findings.append(Finding("warning", "message_count_mismatch", "declared and observed message counts differ", observed=values))
            if consistency["version_scope"] == "mismatch":
                findings.append(Finding("warning", "version_scope_mismatch", "package and stream current-version declarations differ"))
            if consistency["record_count"] == "mismatch":
                findings.append(Finding("warning", "record_count_mismatch", "end record count differs from observed record count", expected=snap.end.get("record_count") if snap.end else None, observed=snap.total_records))
            for f in snap.parse_errors:
                findings.append(f)
            if snap.unknown_record_types:
                findings.append(Finding("warning", "unknown_additive_record_type", "stream contains unknown additive record types", observed=snap.unknown_record_types))
            header_versions_value = stream_out.get("header", {}).get("versions")
            if manifest.conversation.get("current_versions_only") is False or (header_versions_value not in (None, "current_only")):
                canonical["supported"] = False
                canonical["unsupported_reason"] = "unsupported_version_model"
                findings.append(Finding("error", "unsupported_version_model", "canonical current-message projection cannot be inferred for a non-current-only source"))
            if dup_seq:
                findings.append(Finding("error", "duplicate_sequence", "duplicate canonical message sequences observed", observed=dup_seq[:50]))
            if missing_objects:
                findings.append(Finding("warning", "attachment_object_missing", "one or more attachment objects are missing", observed=sorted(missing_objects)))
            if dangling_att or dangling_msg or dangling_ver:
                findings.append(Finding("warning", "dangling_attachment_reference", "one or more attachment references do not resolve"))

        continuation = _continuation_presence(source, manifest.continuation)
        status = "ok"
        if source.unsafe_member_paths or any(f.code == "stream_scan_failed" for f in findings):
            status = "invalid"
        elif any(f.severity == "error" for f in findings):
            if not pkg_supported or not stream_fmt[2] or any(f.code == "unsupported_version_model" for f in findings):
                status = "unsupported"
            else:
                status = "degraded" if canonical.get("supported") and canonical.get("message_count", 0) > 0 else "invalid"
        elif findings:
            status = "degraded"

        entrypoint_hash_status = "not_checked"
        if verify_hashes in {"core", "all"} and manifest.entrypoint in manifest.files and source.exists(manifest.entrypoint):
            declared = manifest.files.get(manifest.entrypoint, {}).get("sha256")
            if declared:
                entrypoint_hash_status = "mismatch" if any(m["path"] == manifest.entrypoint for m in hash_mismatches) else "match"

        report = {
            "report_schema": REPORT_SCHEMA,
            "report_version": REPORT_VERSION,
            "tool": {"name": "inspect_context_package", "version": TOOL_VERSION},
            "status": status,
            "input": {"kind": source.kind, "source_name": source.path.name, "package_root": source.package_root},
            "security": security,
            "package_format": {"name": manifest.format, "version": manifest.format_version, "supported": pkg_supported},
            "package_manifest": {
                "entrypoint": manifest.entrypoint, "entrypoint_source": manifest.entrypoint_source,
                "conversation": {
                    "id": manifest.conversation.get("id"), "title": manifest.conversation.get("title"),
                    "declared_message_count": manifest.conversation.get("message_count"),
                    "conversation_revision": manifest.conversation.get("conversation_revision"),
                    "current_versions_only": manifest.conversation.get("current_versions_only"),
                },
                "conversation_completeness": manifest.conversation_completeness,
                "asset_completeness": manifest.asset_completeness,
                "included_content": manifest.included_content,
                "declared_files": {"count": len(manifest.files), "missing": declared_missing, "size_mismatches": size_mismatches},
            },
            "stream": stream_out,
            "canonical_messages": canonical,
            "source_refs": source_refs,
            "attachments": attachments,
            "continuation": continuation,
            "integrity": {
                "verify_hashes": verify_hashes,
                "entrypoint_hash": entrypoint_hash_status,
                "declared_file_presence": "match" if not declared_missing else "mismatch",
                "declared_file_sizes": "match" if not size_mismatches else "mismatch",
                "hash_mismatches": hash_mismatches,
                "hashed_files": files_checked_hash,
            },
            "consistency": consistency,
            "anomalies": [f.to_dict() for f in findings],
        }
        return report
