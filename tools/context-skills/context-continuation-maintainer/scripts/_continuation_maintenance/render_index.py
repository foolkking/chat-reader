from __future__ import annotations

from typing import Any
from bisect import bisect_left, bisect_right

from _context_package.fingerprints import fingerprint_messages
from _context_package.model import StreamSnapshot, CanonicalMessage

from .model import MaintenanceError

VALID_SEGMENT_KINDS = {
    "orientation", "exploration", "planning", "decision", "design", "implementation", "verification",
    "troubleshooting", "research", "learning", "maintenance", "transition", "handoff", "synthesis", "mixed", "other",
}


def render_index_model(
    index_candidate: dict[str, Any], *, conversation_id: str, revision: int,
    coverage: dict[str, Any], source_fingerprint: dict[str, Any],
    messages: list[CanonicalMessage], snapshot: StreamSnapshot,
) -> dict[str, Any]:
    by_seq = {m.descriptor.sequence: m for m in messages}
    covered_seqs = [m.descriptor.sequence for m in messages if coverage["seq_start"] <= m.descriptor.sequence <= coverage["seq_end"]]
    if covered_seqs != sorted(set(covered_seqs)):
        raise MaintenanceError('Covered message order is ambiguous', 'candidate_index_invalid')
    ownership = {s: 0 for s in covered_seqs}
    segments_out: list[dict[str, Any]] = []
    prev_end = None
    for seg in index_candidate.get("segments", []) if isinstance(index_candidate.get("segments"), list) else []:
        if not isinstance(seg, dict):
            raise MaintenanceError("Index Segment candidate must be an object", "candidate_index_invalid")
        sid = seg.get("id")
        if not isinstance(sid, str) or not sid.startswith("SEG-"):
            raise MaintenanceError(f"invalid final Segment ID: {sid}", "candidate_segment_id_invalid")
        ss, se = seg.get("seq_start"), seg.get("seq_end")
        if not isinstance(ss, int) or not isinstance(se, int) or ss > se:
            raise MaintenanceError(f"invalid Segment range: {sid}", "candidate_segment_range_invalid")
        if ss < coverage["seq_start"] or se > coverage["seq_end"]:
            raise MaintenanceError(f"Segment {sid} lies outside target coverage", "candidate_segment_outside_coverage")
        if prev_end is not None and ss <= prev_end:
            raise MaintenanceError(f"Segment {sid} overlaps or is non-monotonic", "candidate_segment_overlap")
        prev_end = se
        seg_seqs = covered_seqs[bisect_left(covered_seqs, ss):bisect_right(covered_seqs, se)]
        if not seg_seqs:
            raise MaintenanceError(f"Segment {sid} contains no Canonical Current Messages", "candidate_segment_empty")
        for s in seg_seqs:
            ownership[s] += 1
        kind = seg.get("kind")
        if kind not in VALID_SEGMENT_KINDS:
            raise MaintenanceError(f"unknown Segment kind for {sid}: {kind}", "candidate_segment_kind_invalid")
        key_refs = []
        for kr in seg.get("key_refs", []) if isinstance(seg.get("key_refs"), list) else []:
            if not isinstance(kr, dict):
                raise MaintenanceError(f"KeyRef in {sid} must be an object", "candidate_key_ref_invalid")
            seq = kr.get("sequence")
            if not isinstance(seq, int) or seq not in by_seq or seq not in seg_seqs:
                raise MaintenanceError(f"KeyRef sequence in {sid} does not resolve inside Segment", "candidate_key_ref_invalid")
            d = by_seq[seq].descriptor
            out = dict(kr)
            out.setdefault("type", "message")
            if d.message_id is not None:
                out["message_id"] = d.message_id
            if d.version_id is not None:
                out["version_id"] = d.version_id
            key_refs.append(out)
        attachment_refs = seg.get("attachment_refs", []) if isinstance(seg.get("attachment_refs"), list) else []
        seg_msgs = [by_seq[s] for s in seg_seqs]
        out = {
            "id": sid,
            "seq_start": ss,
            "seq_end": se,
            "message_count": len(seg_seqs),
            "kind": kind,
            "title": seg.get("title"),
            "about": seg.get("about"),
            "topics": seg.get("topics") if isinstance(seg.get("topics"), list) else [],
            "key_refs": key_refs,
            "attachment_refs": attachment_refs,
            "fingerprint": fingerprint_messages(seg_msgs, snapshot, "segment"),
        }
        segments_out.append(out)
    gaps = [s for s, n in ownership.items() if n == 0]
    overlaps = [s for s, n in ownership.items() if n > 1]
    if gaps:
        raise MaintenanceError(f"Segment partition leaves covered messages unowned: {gaps[:20]}", "candidate_segment_partition_gap")
    if overlaps:
        raise MaintenanceError(f"Segment partition double-owns covered messages: {overlaps[:20]}", "candidate_segment_partition_overlap")

    seg_by_id = {s["id"]: s for s in segments_out}
    segment_positions = {segment["id"]: index for index, segment in enumerate(segments_out)}
    chapters_out: list[dict[str, Any]] = []
    for ch in index_candidate.get("chapters", []) if isinstance(index_candidate.get("chapters"), list) else []:
        if not isinstance(ch, dict):
            raise MaintenanceError("Index Chapter candidate must be an object", "candidate_index_invalid")
        cid = ch.get("id")
        if not isinstance(cid, str) or not cid.startswith("CH-"):
            raise MaintenanceError(f"invalid final Chapter ID: {cid}", "candidate_chapter_id_invalid")
        sids = ch.get("segment_ids") if isinstance(ch.get("segment_ids"), list) else []
        if not sids or any(sid not in seg_by_id for sid in sids):
            raise MaintenanceError(f"Chapter {cid} references missing Segments", "candidate_chapter_ref_invalid")
        positions = [segment_positions[sid] for sid in sids]
        if positions != list(range(min(positions), max(positions) + 1)):
            raise MaintenanceError(f"Chapter {cid} Segment list is not consecutive", "candidate_chapter_nonconsecutive")
        chapters_out.append({
            "id": cid,
            "seq_start": seg_by_id[sids[0]]["seq_start"],
            "seq_end": seg_by_id[sids[-1]]["seq_end"],
            "title": ch.get("title"),
            "about": ch.get("about"),
            "segment_ids": list(sids),
        })
    return {
        "schema": "chat-reader-continuation-index",
        "schema_version": "1.0.0",
        "conversation_id": conversation_id,
        "continuation_revision": revision,
        "coverage": {**coverage, "source_fingerprint": source_fingerprint},
        "chapters": chapters_out,
        "segments": segments_out,
    }
