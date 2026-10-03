from __future__ import annotations

import json
import re
from collections import defaultdict
from typing import Any

from .canonical_v2 import select_adapter
from .continuation_index import load_index_json
from .current_doc import parse_current_document
from .fingerprints import fingerprint_messages
from .inspection import inspect_package
from .manifest import load_package_manifest
from .model import Finding
from .source import PackageSource

REPORT_SCHEMA = "chat-reader-continuation-validation"
REPORT_VERSION = "1.0.0"
TOOL_VERSION = "1.0.1"
SUPPORTED_CONTINUATION_MAJOR = 1
VALID_SEGMENT_KINDS = {
    "orientation", "exploration", "planning", "decision", "design", "implementation",
    "verification", "troubleshooting", "research", "learning", "maintenance",
    "transition", "handoff", "synthesis", "mixed", "other",
}
_ID_RE = re.compile(r"^(?:EV|G|REQ|CON|NG|CONV|DEC|TC|WS|MIL|OPEN|DEF|VD|BLK|NEXT|ASM|UNK|CF|RET|AD|E|SEG|CH)-\d+$")


def _major(v: Any) -> int | None:
    if v is None:
        return None
    try:
        return int(str(v).split(".", 1)[0])
    except Exception:
        return None


def _fp_tuple(fp: Any) -> tuple[Any, Any, Any, Any] | None:
    if not isinstance(fp, dict):
        return None
    return (fp.get("profile"), fp.get("algorithm"), fp.get("content"), fp.get("locators"))


def _coverage_tuple(c: Any) -> tuple[Any, Any, Any] | None:
    if not isinstance(c, dict):
        return None
    return (c.get("seq_start"), c.get("seq_end"), c.get("message_count"))


def _find_cycles(edges: list[tuple[str, str]]) -> list[list[str]]:
    graph: dict[str, list[str]] = defaultdict(list)
    for a, b in edges:
        graph[a].append(b)
    visited: set[str] = set()
    positions: dict[str, int] = {}
    path: list[str] = []
    cycles: list[list[str]] = []
    # Iterative DFS handles long valid dependency chains without Python recursion.
    # Bound diagnostic output too: malformed dense graphs can contain many cycles.
    for node in graph:
        if node in visited:
            continue
        positions[node] = 0
        path.append(node)
        pending = [iter(graph.get(node, []))]
        while pending:
            nxt = next(pending[-1], None)
            if nxt is None:
                pending.pop()
                visited.add(path[-1])
                del positions[path.pop()]
            elif nxt in positions:
                if len(cycles) < 100:
                    start = positions[nxt]
                    cycles.append(path[start:start + 1000] + [nxt])
            elif nxt not in visited:
                positions[nxt] = len(path)
                path.append(nxt)
                pending.append(iter(graph.get(nxt, [])))
    return cycles



def _status_counts(findings: list[Finding]) -> dict[str, int]:
    out = {"info": 0, "warning": 0, "error": 0}
    for f in findings:
        out[f.severity] = out.get(f.severity, 0) + 1
    return out


def validate_continuation(path: str, detail: str = "summary") -> dict[str, Any]:
    inspect = inspect_package(path, verify_hashes="core", detail="summary")
    base = {
        "report_schema": REPORT_SCHEMA,
        "report_version": REPORT_VERSION,
        "tool": {"name": "validate_continuation", "version": TOOL_VERSION},
    }
    # Raw can remain readable in degraded mode, but integrity errors never
    # qualify a derived Pair for fast restore.
    if inspect.get("status") in {"invalid", "ambiguous", "unsupported"} or any(
        finding.get("severity") == "error" for finding in inspect.get("anomalies", [])
    ):
        base.update({
            "runtime_state": "invalid",
            "usable_for_restore": False,
            "validation_layers": {
                "V0_package": {"status": "fail"},
                "V1_structural": {"status": "not_performed"},
                "V2_pair_identity": {"status": "not_performed"},
                "V3_coverage": {"status": "not_performed"},
                "V4_referential_integrity": {"status": "not_performed"},
                "V5_fingerprint": {"status": "not_performed"},
                "V6_semantic": {"status": "not_performed", "reason": "requires-semantic-review"},
                "V7_trust": {"status": "not_eligible"},
            },
            "findings": inspect.get("anomalies", []),
        })
        return base

    with PackageSource(path) as source:
        manifest = load_package_manifest(source)
        cont_probe = inspect.get("continuation", {})
        presence = cont_probe.get("presence", "none")
        if presence == "none":
            base.update({"runtime_state": "no_continuation", "usable_for_restore": False,
                         "continuation": {"presence": "none"}, "findings": []})
            return base
        if presence == "current_only":
            base.update({"runtime_state": "current_only", "usable_for_restore": False,
                         "continuation": cont_probe, "findings": []})
            return base
        if presence == "index_only":
            base.update({"runtime_state": "index_only", "usable_for_restore": False,
                         "continuation": cont_probe, "findings": []})
            return base

        current_path = cont_probe["current"]["path"]
        index_path = cont_probe["index"]["path"]
        findings: list[Finding] = []
        layer = {
            "V0_package": {"status": "pass"},
            "V1_structural": {"status": "pass"},
            "V2_pair_identity": {"status": "pass"},
            "V3_coverage": {"status": "pass"},
            "V4_referential_integrity": {"status": "pass"},
            "V5_fingerprint": {"status": "pass"},
            "V6_semantic": {"status": "not_performed", "reason": "requires-semantic-review"},
            "V7_trust": {"status": "not_eligible"},
        }
        try:
            current_text = source.read_text(current_path)
            current = parse_current_document(current_text)
        except Exception as e:
            findings.append(Finding("error", "current_parse_error", str(e), location=current_path))
            layer["V1_structural"]["status"] = "fail"
            current = None
            current_text = ""
        try:
            index_text = source.read_text(index_path)
            index = load_index_json(index_text)
        except Exception as e:
            findings.append(Finding("error", "index_parse_error", str(e), location=index_path))
            layer["V1_structural"]["status"] = "fail"
            index = None
            index_text = ""

        if current is None or index is None:
            base.update({
                "runtime_state": "invalid", "usable_for_restore": False,
                "continuation": {"presence": "pair", "current": {"path": current_path}, "index": {"path": index_path}},
                "validation_layers": layer, "findings": [f.to_dict() for f in findings],
            })
            return base

        cf = current.frontmatter
        c_schema = cf.get("schema_version")
        i_schema = index.get("schema_version")
        if _major(c_schema) != SUPPORTED_CONTINUATION_MAJOR or _major(i_schema) != SUPPORTED_CONTINUATION_MAJOR:
            base.update({
                "runtime_state": "unsupported_major", "usable_for_restore": False,
                "continuation": {
                    "presence": "pair",
                    "current": {"schema_version": c_schema, "path": current_path},
                    "index": {"schema_version": i_schema, "path": index_path},
                },
                "validation_layers": {**layer, "V1_structural": {"status": "unsupported"}},
                "findings": [Finding("error", "unsupported_continuation_major", "unsupported continuation schema major", observed={"current": c_schema, "index": i_schema}).to_dict()],
            })
            return base
        if c_schema != i_schema:
            findings.append(Finding("warning", "schema_minor_mismatch", "Current and Index schema versions differ within the supported major", expected=c_schema, observed=i_schema))

        # Basic structure.
        for key in ("schema", "schema_version", "conversation_id", "continuation_revision", "trust", "coverage", "index"):
            if key not in cf:
                findings.append(Finding("error", "current_required_field_missing", f"missing Current frontmatter field: {key}", location=f"current.{key}"))
                layer["V1_structural"]["status"] = "fail"
        for key in ("schema", "schema_version", "conversation_id", "continuation_revision", "coverage", "segments", "chapters"):
            if key not in index:
                findings.append(Finding("error", "index_required_field_missing", f"missing Index field: {key}", location=f"index.{key}"))
                layer["V1_structural"]["status"] = "fail"
        if cf.get("schema") != "chat-reader-continuation":
            findings.append(Finding("error", "current_schema_name_invalid", "unexpected Current schema name", observed=cf.get("schema")))
            layer["V1_structural"]["status"] = "fail"
        if index.get("schema") != "chat-reader-continuation-index":
            findings.append(Finding("error", "index_schema_name_invalid", "unexpected Index schema name", observed=index.get("schema")))
            layer["V1_structural"]["status"] = "fail"
        if current.duplicate_ids:
            findings.append(Finding("error", "duplicate_current_ids", "duplicate stable IDs in Current", observed=current.duplicate_ids))
            layer["V1_structural"]["status"] = "fail"
        bad_ids = [x for x in current.object_ids if not _ID_RE.match(x)]
        if bad_ids:
            findings.append(Finding("error", "invalid_current_id", "invalid stable ID format", observed=bad_ids))
            layer["V1_structural"]["status"] = "fail"

        # Pair identity.
        raw_conv_id = manifest.conversation.get("id")
        c_conv = cf.get("conversation_id")
        i_conv = index.get("conversation_id")
        c_rev = cf.get("continuation_revision")
        i_rev = index.get("continuation_revision")
        identity_mismatch = False
        if c_conv != i_conv or (raw_conv_id is not None and c_conv != raw_conv_id):
            identity_mismatch = True
            findings.append(Finding("error", "conversation_identity_mismatch", "Current, Index, and Raw conversation identity must agree", expected=raw_conv_id, observed={"current": c_conv, "index": i_conv}))
        if c_rev != i_rev:
            identity_mismatch = True
            findings.append(Finding("error", "continuation_revision_mismatch", "Current and Index continuation revisions differ", expected=c_rev, observed=i_rev))
        if cf.get("index") != index_path:
            identity_mismatch = True
            findings.append(Finding("error", "current_index_path_mismatch", "Current frontmatter index path does not identify the loaded Index", expected=index_path, observed=cf.get("index")))
        if manifest.continuation:
            mh = manifest.continuation
            if mh.get("continuation_revision") is not None and mh.get("continuation_revision") != c_rev:
                identity_mismatch = True
                findings.append(Finding("error", "manifest_continuation_revision_mismatch", "manifest continuation revision differs from pair", expected=c_rev, observed=mh.get("continuation_revision")))
            if isinstance(mh.get("current"), str) and mh.get("current") != current_path:
                identity_mismatch = True
                findings.append(Finding("error", "manifest_current_path_mismatch", "manifest continuation Current path differs", expected=current_path, observed=mh.get("current")))
            if isinstance(mh.get("index"), str) and mh.get("index") != index_path:
                identity_mismatch = True
                findings.append(Finding("error", "manifest_index_path_mismatch", "manifest continuation Index path differs", expected=index_path, observed=mh.get("index")))
        if identity_mismatch:
            layer["V2_pair_identity"]["status"] = "fail"

        # Raw source snapshot.
        try:
            adapter = select_adapter(source, manifest.entrypoint)
            snap = adapter.scan()
        except Exception as e:
            findings.append(Finding("error", "raw_stream_unusable", str(e)))
            layer["V0_package"]["status"] = "fail"
            snap = None

        coverage_mismatch = False
        current_cov = cf.get("coverage") if isinstance(cf.get("coverage"), dict) else {}
        index_cov = index.get("coverage") if isinstance(index.get("coverage"), dict) else {}
        if _coverage_tuple(current_cov) != _coverage_tuple(index_cov):
            coverage_mismatch = True
            findings.append(Finding("error", "coverage_pair_mismatch", "Current and Index must describe the same Stable Prefix", expected=_coverage_tuple(current_cov), observed=_coverage_tuple(index_cov)))
        if manifest.continuation and isinstance(manifest.continuation.get("coverage"), dict):
            if _coverage_tuple(manifest.continuation.get("coverage")) != _coverage_tuple(current_cov):
                coverage_mismatch = True
                findings.append(Finding("error", "manifest_coverage_mismatch", "manifest continuation coverage differs from pair", expected=_coverage_tuple(current_cov), observed=_coverage_tuple(manifest.continuation.get("coverage"))))

        segments = index.get("segments") if isinstance(index.get("segments"), list) else []
        chapters = index.get("chapters") if isinstance(index.get("chapters"), list) else []
        segment_ids: set[str] = set()
        chapter_ids: set[str] = set()
        per_segment: list[dict[str, Any]] = []
        raw_tail: list[int] = []
        raw_covered: list[int] = []
        raw_by_seq: dict[int, Any] = {}
        ordered_seqs: list[int] = []
        if snap is not None:
            raw_by_seq = snap.message_by_sequence
            ordered_seqs = [m.sequence for m in snap.ordered_messages()]
            cs, ce, cc = current_cov.get("seq_start"), current_cov.get("seq_end"), current_cov.get("message_count")
            if not all(isinstance(x, int) for x in (cs, ce, cc)):
                coverage_mismatch = True
                findings.append(Finding("error", "coverage_fields_invalid", "coverage seq_start, seq_end, and message_count must be integers"))
            else:
                raw_covered = [s for s in ordered_seqs if cs <= s <= ce]
                if ce not in raw_by_seq:
                    coverage_mismatch = True
                    findings.append(Finding("error", "coverage_boundary_missing", "coverage boundary does not resolve to a Canonical Current Message", observed=ce))
                if len(raw_covered) != cc:
                    coverage_mismatch = True
                    findings.append(Finding("error", "coverage_message_count_mismatch", "coverage message_count differs from observed covered Canonical Messages", expected=cc, observed=len(raw_covered)))
                boundary_pos = None
                for idx_pos, seq in enumerate(ordered_seqs):
                    if seq == ce:
                        boundary_pos = idx_pos
                        break
                if boundary_pos is not None:
                    raw_tail = ordered_seqs[boundary_pos + 1:]

            prev_end = None
            ownership: dict[int, int] = {s: 0 for s in raw_covered}
            for seg in segments:
                if not isinstance(seg, dict):
                    coverage_mismatch = True
                    findings.append(Finding("error", "segment_not_object", "Index Segment must be an object"))
                    continue
                sid = seg.get("id")
                if not isinstance(sid, str) or not sid.startswith("SEG-") or sid in segment_ids:
                    coverage_mismatch = True
                    findings.append(Finding("error", "segment_id_invalid", "Segment ID missing, malformed, or duplicated", observed=sid))
                    continue
                segment_ids.add(sid)
                ss, se, smc = seg.get("seq_start"), seg.get("seq_end"), seg.get("message_count")
                if seg.get("kind") not in VALID_SEGMENT_KINDS:
                    findings.append(Finding("error", "segment_kind_invalid", "unknown Segment kind", location=sid, observed=seg.get("kind")))
                    layer["V1_structural"]["status"] = "fail"
                if not isinstance(ss, int) or not isinstance(se, int) or ss > se:
                    coverage_mismatch = True
                    findings.append(Finding("error", "segment_range_invalid", "Segment seq range is invalid", location=sid))
                    continue
                if prev_end is not None and ss <= prev_end:
                    coverage_mismatch = True
                    findings.append(Finding("error", "segment_overlap_or_nonmonotonic", "Segments overlap or are not chronologically monotonic", location=sid, expected=f"> {prev_end}", observed=ss))
                prev_end = se
                actual_seqs = [s for s in raw_covered if ss <= s <= se]
                if smc != len(actual_seqs):
                    coverage_mismatch = True
                    findings.append(Finding("error", "segment_message_count_mismatch", "Segment message_count differs from actual covered Canonical Messages", location=sid, expected=smc, observed=len(actual_seqs)))
                for s in actual_seqs:
                    ownership[s] += 1
                per_segment.append({"id": sid, "seq_start": ss, "seq_end": se, "message_count": smc, "actual_message_count": len(actual_seqs)})
            uncovered = [s for s, n in ownership.items() if n == 0]
            double = [s for s, n in ownership.items() if n > 1]
            if uncovered:
                coverage_mismatch = True
                findings.append(Finding("error", "segment_partition_gap", "one or more covered Canonical Messages are not owned by a Segment", observed=uncovered[:100]))
            if double:
                coverage_mismatch = True
                findings.append(Finding("error", "segment_partition_overlap", "one or more covered Canonical Messages are owned by multiple Segments", observed=double[:100]))

        if coverage_mismatch:
            layer["V3_coverage"]["status"] = "fail"

        # Chapters and explicit internal references.
        internal_invalid = False
        seg_by_id = {seg.get("id"): seg for seg in segments if isinstance(seg, dict) and isinstance(seg.get("id"), str)}
        for ch in chapters:
            if not isinstance(ch, dict):
                internal_invalid = True
                findings.append(Finding("error", "chapter_not_object", "Index Chapter must be an object"))
                continue
            cid = ch.get("id")
            if not isinstance(cid, str) or not cid.startswith("CH-") or cid in chapter_ids:
                internal_invalid = True
                findings.append(Finding("error", "chapter_id_invalid", "Chapter ID missing, malformed, or duplicated", observed=cid))
                continue
            chapter_ids.add(cid)
            sids = ch.get("segment_ids") if isinstance(ch.get("segment_ids"), list) else []
            missing = [sid for sid in sids if sid not in seg_by_id]
            if missing:
                internal_invalid = True
                findings.append(Finding("error", "chapter_segment_ref_missing", "Chapter references missing Segment IDs", location=cid, observed=missing))
            existing = [seg_by_id[sid] for sid in sids if sid in seg_by_id]
            if existing:
                if ch.get("seq_start") != existing[0].get("seq_start") or ch.get("seq_end") != existing[-1].get("seq_end"):
                    findings.append(Finding("warning", "chapter_range_mismatch", "Chapter range differs from first/last listed Segment", location=cid))

        all_current_ids = current.object_ids
        parent_edges: list[tuple[str, str]] = []
        supersede_edges: list[tuple[str, str]] = []
        for src, field, target in current.refs:
            if target.startswith("SEG-"):
                exists = target in segment_ids
            elif target.startswith("CH-"):
                exists = target in chapter_ids
            else:
                exists = target in all_current_ids
            if not exists:
                internal_invalid = True
                findings.append(Finding("error", "current_internal_ref_missing", "Current explicit reference target does not exist", location=src, observed={"field": field, "target": target}))
            if field == "Parent":
                parent_edges.append((src, target))
            elif field == "Supersedes":
                supersede_edges.append((src, target))
        for cyc in _find_cycles(parent_edges):
            internal_invalid = True
            findings.append(Finding("error", "goal_parent_cycle", "Parent reference cycle detected", observed=cyc))
        for cyc in _find_cycles(supersede_edges):
            internal_invalid = True
            findings.append(Finding("error", "supersedes_cycle", "Supersedes reference cycle detected", observed=cyc))

        # Raw locator validation; mismatched IDs may be repairable without invalidating semantics.
        raw_locator_mismatches: list[dict[str, Any]] = []
        raw_locator_missing: list[dict[str, Any]] = []
        if snap is not None:
            by_seq = snap.message_by_sequence
            by_id = snap.message_by_id
            by_version = snap.version_by_id
            for ev in current.evidence_locators:
                if ev.evidence_type == "attachment" or ev.attachment_id:
                    if ev.attachment_id and ev.attachment_id not in snap.attachments:
                        raw_locator_missing.append({"kind": "evidence_attachment", "id": ev.evidence_id, "attachment_id": ev.attachment_id})
                    continue
                if ev.sequence is not None:
                    msg = by_seq.get(ev.sequence)
                    if msg is None:
                        raw_locator_missing.append({"kind": "evidence_message", "id": ev.evidence_id, "sequence": ev.sequence})
                        continue
                    if ev.message_id and ev.message_id != msg.message_id:
                        raw_locator_mismatches.append({"kind": "message", "owner": ev.evidence_id, "sequence": ev.sequence, "field": "message_id", "stored": ev.message_id, "resolved": msg.message_id})
                    if ev.version_id and ev.version_id != msg.version_id:
                        raw_locator_mismatches.append({"kind": "message", "owner": ev.evidence_id, "sequence": ev.sequence, "field": "version_id", "stored": ev.version_id, "resolved": msg.version_id})
                elif ev.message_id or ev.version_id:
                    msg = by_id.get(ev.message_id) if ev.message_id else by_version.get(ev.version_id)
                    if msg is None or (ev.version_id and ev.version_id != msg.version_id):
                        raw_locator_missing.append({"kind": "evidence_message", "id": ev.evidence_id, "reason": "id_without_sequence_unresolved"})
            for seg in segments:
                if not isinstance(seg, dict):
                    continue
                sid = seg.get("id")
                ss, se = seg.get("seq_start"), seg.get("seq_end")
                for ref in seg.get("key_refs", []) if isinstance(seg.get("key_refs"), list) else []:
                    if not isinstance(ref, dict) or ref.get("type", "message") != "message":
                        continue
                    seq = ref.get("sequence")
                    if not isinstance(seq, int):
                        raw_locator_missing.append({"kind": "key_ref", "segment_id": sid, "reason": "sequence_missing"})
                        continue
                    msg = by_seq.get(seq)
                    if msg is None:
                        raw_locator_missing.append({"kind": "key_ref", "segment_id": sid, "sequence": seq})
                        continue
                    if isinstance(ss, int) and isinstance(se, int) and not (ss <= seq <= se):
                        internal_invalid = True
                        findings.append(Finding("error", "key_ref_outside_segment", "Key Ref sequence is outside its owning Segment", location=str(sid), observed=seq))
                    if ref.get("message_id") is not None and ref.get("message_id") != msg.message_id:
                        raw_locator_mismatches.append({"kind": "message", "owner": sid, "sequence": seq, "field": "message_id", "stored": ref.get("message_id"), "resolved": msg.message_id})
                    if ref.get("version_id") is not None and ref.get("version_id") != msg.version_id:
                        raw_locator_mismatches.append({"kind": "message", "owner": sid, "sequence": seq, "field": "version_id", "stored": ref.get("version_id"), "resolved": msg.version_id})
                for aref in seg.get("attachment_refs", []) if isinstance(seg.get("attachment_refs"), list) else []:
                    aid = aref if isinstance(aref, str) else aref.get("attachment_id") if isinstance(aref, dict) else None
                    if aid and aid not in snap.attachments:
                        raw_locator_missing.append({"kind": "segment_attachment", "segment_id": sid, "attachment_id": aid})
        if raw_locator_missing:
            findings.append(Finding("error", "raw_locator_missing", "one or more explicit Raw locators do not resolve", observed=raw_locator_missing[:100]))
            layer["V4_referential_integrity"]["status"] = "fail"
            internal_invalid = True
        if internal_invalid:
            layer["V4_referential_integrity"]["status"] = "fail"

        # Fingerprints.
        current_fp = current_cov.get("source_fingerprint") if isinstance(current_cov, dict) else None
        index_fp = index_cov.get("source_fingerprint") if isinstance(index_cov, dict) else None
        manifest_fp = manifest.continuation.get("source_fingerprint") if manifest.continuation else None
        pair_fp_disagree = _fp_tuple(current_fp) != _fp_tuple(index_fp)
        if pair_fp_disagree:
            findings.append(Finding("error", "pair_fingerprint_disagreement", "Current and Index stored source fingerprints differ", expected=current_fp, observed=index_fp))
            layer["V5_fingerprint"]["status"] = "fail"
        if manifest_fp is not None and _fp_tuple(manifest_fp) != _fp_tuple(current_fp):
            findings.append(Finding("error", "manifest_fingerprint_disagreement", "manifest continuation fingerprint differs from pair", expected=current_fp, observed=manifest_fp))
            layer["V5_fingerprint"]["status"] = "fail"
            pair_fp_disagree = True

        prefix_recomputed = None
        segment_details: list[dict[str, Any]] = []
        content_mismatch = False
        locator_mismatch = False
        segment_internal_fp_bad = False
        if snap is not None and not coverage_mismatch and isinstance(current_cov.get("seq_start"), int) and isinstance(current_cov.get("seq_end"), int):
            all_messages = list(adapter.iter_messages())
            covered_msgs = [m for m in all_messages if current_cov["seq_start"] <= m.descriptor.sequence <= current_cov["seq_end"]]
            prefix_recomputed = fingerprint_messages(covered_msgs, snap, "prefix")
            if isinstance(current_fp, dict):
                content_mismatch = current_fp.get("content") != prefix_recomputed.get("content")
                locator_mismatch = current_fp.get("locators") != prefix_recomputed.get("locators")
            else:
                findings.append(Finding("error", "source_fingerprint_missing", "Current source fingerprint is missing or malformed"))
                layer["V5_fingerprint"]["status"] = "fail"
                pair_fp_disagree = True
            for seg in segments:
                if not isinstance(seg, dict) or not isinstance(seg.get("seq_start"), int) or not isinstance(seg.get("seq_end"), int):
                    continue
                smsgs = [m for m in covered_msgs if seg["seq_start"] <= m.descriptor.sequence <= seg["seq_end"]]
                recomputed = fingerprint_messages(smsgs, snap, "segment")
                stored = seg.get("fingerprint") if isinstance(seg.get("fingerprint"), dict) else {}
                sc = stored.get("content") == recomputed.get("content")
                sl = stored.get("locators") == recomputed.get("locators")
                segment_details.append({"id": seg.get("id"), "stored": stored, "recomputed": recomputed, "content_status": "match" if sc else "mismatch", "locator_status": "match" if sl else "mismatch"})
                # A segment inconsistency while prefix of same dimension matches means Index internal corruption.
                if not content_mismatch and not sc:
                    segment_internal_fp_bad = True
                    findings.append(Finding("error", "segment_content_fingerprint_inconsistent_with_valid_prefix", "Segment content fingerprint mismatches while prefix content fingerprint matches", location=str(seg.get("id"))))
                if not locator_mismatch and not sl:
                    segment_internal_fp_bad = True
                    findings.append(Finding("error", "segment_locator_fingerprint_inconsistent_with_valid_prefix", "Segment locator fingerprint mismatches while prefix locator fingerprint matches", location=str(seg.get("id"))))
            if content_mismatch:
                findings.append(Finding("error", "prefix_content_fingerprint_mismatch", "covered Raw semantic content differs from stored continuation fingerprint", expected=current_fp.get("content") if isinstance(current_fp, dict) else None, observed=prefix_recomputed.get("content")))
                layer["V5_fingerprint"]["status"] = "fail"
            if locator_mismatch:
                findings.append(Finding("warning", "prefix_locator_fingerprint_mismatch", "covered Raw locators differ from stored continuation fingerprint", expected=current_fp.get("locators") if isinstance(current_fp, dict) else None, observed=prefix_recomputed.get("locators")))
            if segment_internal_fp_bad:
                layer["V5_fingerprint"]["status"] = "fail"

        # Determine whether locator-only mismatch can be mapped safely.
        locator_repair = {"required": False, "safe": False, "ambiguous": False, "mapping_count": 0, "mappings": []}
        # Fingerprints bind the Raw projection, not the written Evidence/KeyRef
        # IDs. Fresh fingerprints cannot turn stale explicit references valid.
        locator_repair_required = locator_mismatch or bool(raw_locator_mismatches)
        if raw_locator_mismatches and not raw_locator_missing:
            layer["V4_referential_integrity"]["status"] = "repair_required"
        if locator_repair_required and not content_mismatch and not coverage_mismatch and not pair_fp_disagree and not segment_internal_fp_bad:
            locator_repair["required"] = True
            # Conservative V1 rule: require at least one explicit stale locator and every such locator maps uniquely by stable sequence.
            mappings = raw_locator_mismatches
            safe = bool(mappings) and not raw_locator_missing
            locator_repair.update({"safe": safe, "ambiguous": not safe, "mapping_count": len(mappings), "mappings": mappings if detail == "full" else []})

        # Runtime state precedence.
        persisted_trust = cf.get("trust")
        runtime_state: str
        if layer["V1_structural"]["status"] == "fail" or pair_fp_disagree or segment_internal_fp_bad or internal_invalid:
            runtime_state = "invalid"
        elif identity_mismatch:
            runtime_state = "pair_identity_mismatch"
        elif coverage_mismatch:
            runtime_state = "coverage_mismatch"
        elif content_mismatch:
            runtime_state = "content_mismatch"
        elif locator_repair_required:
            runtime_state = "locator_only_mismatch"
        elif persisted_trust == "verified":
            runtime_state = "valid_verified"
        elif persisted_trust == "provisional":
            runtime_state = "valid_provisional"
        else:
            runtime_state = "invalid"
            findings.append(Finding("error", "persisted_trust_invalid", "Current trust must be verified or provisional", observed=persisted_trust))

        usable = runtime_state in {"valid_verified", "valid_provisional"} or (runtime_state == "locator_only_mismatch" and bool(locator_repair.get("safe")))
        inheritance = runtime_state == "valid_verified" or (runtime_state == "locator_only_mismatch" and persisted_trust == "verified" and bool(locator_repair.get("safe")))
        if runtime_state == "valid_verified":
            layer["V7_trust"]["status"] = "inheritance_eligible"
        elif runtime_state == "valid_provisional":
            layer["V7_trust"]["status"] = "provisional_only"
        elif runtime_state == "locator_only_mismatch" and locator_repair.get("safe"):
            layer["V7_trust"]["status"] = "inheritance_eligible_after_in_memory_locator_remap"
        else:
            layer["V7_trust"]["status"] = "not_eligible"

        # Binding used by extractor to reject stale validation reports.
        binding = {
            "conversation_id": raw_conv_id,
            "source_entrypoint": manifest.entrypoint,
            "source_entrypoint_sha256": f"sha256:{source.sha256(manifest.entrypoint)}",
            "current_path": current_path,
            "current_sha256": f"sha256:{source.sha256(current_path)}",
            "index_path": index_path,
            "index_sha256": f"sha256:{source.sha256(index_path)}",
            "continuation_revision": c_rev,
        }

        fp_report = {
            "profile": current_fp.get("profile") if isinstance(current_fp, dict) else None,
            "algorithm": current_fp.get("algorithm") if isinstance(current_fp, dict) else None,
            "prefix": {
                "content": {"stored": current_fp.get("content") if isinstance(current_fp, dict) else None, "recomputed": prefix_recomputed.get("content") if prefix_recomputed else None, "status": "mismatch" if content_mismatch else "match" if prefix_recomputed else "not_checked"},
                "locators": {"stored": current_fp.get("locators") if isinstance(current_fp, dict) else None, "recomputed": prefix_recomputed.get("locators") if prefix_recomputed else None, "status": "mismatch" if locator_mismatch else "match" if prefix_recomputed else "not_checked"},
            },
            "segments": {
                "checked": len(segment_details),
                "content_mismatch_count": sum(1 for x in segment_details if x["content_status"] == "mismatch"),
                "locator_mismatch_count": sum(1 for x in segment_details if x["locator_status"] == "mismatch"),
            },
        }
        if detail == "full":
            fp_report["segments"]["details"] = segment_details

        coverage_report = {
            "current": {k: current_cov.get(k) for k in ("seq_start", "seq_end", "message_count")},
            "index": {k: index_cov.get(k) for k in ("seq_start", "seq_end", "message_count")},
            "raw_observed_covered_messages": len(raw_covered),
            "partition": {
                "complete": not coverage_mismatch,
                "overlap_count": len([f for f in findings if f.code in {"segment_overlap_or_nonmonotonic", "segment_partition_overlap"}]),
                "uncovered_message_count": next((len(f.observed) for f in findings if f.code == "segment_partition_gap" and isinstance(f.observed, list)), 0),
            },
            "boundary": {"valid": not any(f.code == "coverage_boundary_missing" for f in findings), "sequence": current_cov.get("seq_end")},
            "raw_tail": {
                "message_count": len(raw_tail),
                "sequences": raw_tail if detail == "full" else None,
            },
        }
        if coverage_report["raw_tail"]["sequences"] is None:
            coverage_report["raw_tail"].pop("sequences")

        trust_report = {
            "persisted": persisted_trust,
            "semantic_validation": {
                "performed_now": False,
                "basis": "persisted-verified-continuation" if persisted_trust == "verified" else "persisted-provisional-continuation",
            },
            "runtime_integrity": "pass" if runtime_state in {"valid_verified", "valid_provisional"} else "conditional" if runtime_state == "locator_only_mismatch" and locator_repair.get("safe") else "fail",
            "inheritance_eligible": inheritance,
            "effective_for_restore": "verified" if inheritance else "provisional" if runtime_state == "valid_provisional" else None,
        }

        refs_report = {
            "current_object_count": len(current.object_ids),
            "explicit_internal_ref_count": len(current.refs),
            "evidence_locator_count": len(current.evidence_locators),
            "raw_locator_mismatch_count": len(raw_locator_mismatches),
            "raw_locator_missing_count": len(raw_locator_missing),
        }
        if detail == "full":
            refs_report["raw_locator_mismatches"] = raw_locator_mismatches
            refs_report["raw_locator_missing"] = raw_locator_missing

        report = {
            **base,
            "runtime_state": runtime_state,
            "usable_for_restore": usable,
            "binding": binding,
            "source": {
                "conversation_id": raw_conv_id,
                "canonical_message_count": len(snap.messages) if snap is not None else None,
                "source_completeness": manifest.conversation_completeness,
                "current_versions_only": manifest.conversation.get("current_versions_only"),
            },
            "continuation": {
                "presence": "pair",
                "current": {"path": current_path, "schema_version": c_schema, "conversation_id": c_conv, "continuation_revision": c_rev, "persisted_trust": persisted_trust},
                "index": {"path": index_path, "schema_version": i_schema, "conversation_id": i_conv, "continuation_revision": i_rev, "segment_count": len(segments), "chapter_count": len(chapters)},
            },
            "trust": trust_report,
            "coverage": coverage_report,
            "references": refs_report,
            "fingerprints": fp_report,
            "locator_repair": locator_repair,
            "validation_layers": layer,
            "finding_counts": _status_counts(findings),
            "findings": [f.to_dict() for f in findings],
        }
        return report
