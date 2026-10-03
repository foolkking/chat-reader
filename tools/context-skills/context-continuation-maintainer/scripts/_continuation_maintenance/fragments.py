from __future__ import annotations

from pathlib import Path
from typing import Any
import re

from _context_package.canonical_v2 import select_adapter
from _context_package.fingerprints import compose_digest, message_content_digest, message_locator_digest
from _context_package.manifest import load_package_manifest
from _context_package.source import PackageSource

from .model import (
    LOCAL_CANDIDATE_ID_RE,
    MaintenanceError,
    VALID_EFFECTS,
    atomic_write_json,
    load_json,
    normalize_sha256,
    require_dict,
    require_int,
    require_list,
    require_str,
    sequence_set_for_range,
)

FRAGMENT_CANDIDATE_SCHEMA = "chat-reader-maintenance-fragment-candidate"
FRAGMENT_SCHEMA = "chat-reader-maintenance-fragment"
SCHEMA_VERSION = "1.0.0"
FRAGMENT_ID_RE = re.compile(r"^FRAG-\d+$")

DOMAINS = {
    "input_content": "chat-reader-maintenance-fragment-input-content-v1",
    "input_locators": "chat-reader-maintenance-fragment-input-locators-v1",
    "sealed_content": "chat-reader-maintenance-fragment-sealed-content-v1",
    "sealed_locators": "chat-reader-maintenance-fragment-sealed-locators-v1",
    "dependency_content": "chat-reader-maintenance-fragment-dependency-content-v1",
    "dependency_locators": "chat-reader-maintenance-fragment-dependency-locators-v1",
}


def _range_fp(messages, snapshot, kind: str) -> dict[str, Any]:
    if kind not in {"input", "sealed", "dependency"}:
        raise ValueError(kind)
    content = [message_content_digest(m, snapshot) for m in messages]
    locators = [message_locator_digest(m, snapshot) for m in messages]
    return {
        "profile": "chat-reader-content-v1",
        "algorithm": "sha256",
        "content": compose_digest(DOMAINS[f"{kind}_content"], content),
        "locators": compose_digest(DOMAINS[f"{kind}_locators"], locators),
    }


def _range_obj(obj: Any, name: str, *, allow_none: bool = False) -> tuple[int, int] | None:
    if obj is None and allow_none:
        return None
    d = require_dict(obj, name)
    start = require_int(d.get("seq_start"), f"{name}.seq_start")
    end = require_int(d.get("seq_end"), f"{name}.seq_end")
    if start > end:
        raise MaintenanceError(f"{name}.seq_start must be <= seq_end", "range_invalid")
    return start, end


def _validation_revision(report: dict[str, Any]) -> int | None:
    b = report.get("binding") if isinstance(report.get("binding"), dict) else {}
    rev = b.get("continuation_revision")
    if isinstance(rev, int):
        return rev
    c = report.get("continuation") if isinstance(report.get("continuation"), dict) else {}
    cur = c.get("current") if isinstance(c.get("current"), dict) else {}
    rev = cur.get("continuation_revision")
    return rev if isinstance(rev, int) else None


def _validate_validation_report(report: dict[str, Any], source: PackageSource, manifest, conversation_id: str) -> None:
    if report.get("report_schema") != "chat-reader-continuation-validation":
        raise MaintenanceError("validation report schema is not recognized", "validation_report_invalid")
    binding = report.get("binding") if isinstance(report.get("binding"), dict) else None
    if binding:
        if binding.get("conversation_id") not in {None, conversation_id}:
            raise MaintenanceError("validation report conversation_id does not match source", "stale_validation_report")
        entrypoint = binding.get("source_entrypoint")
        if isinstance(entrypoint, str) and entrypoint != manifest.entrypoint:
            raise MaintenanceError("validation report entrypoint does not match source", "stale_validation_report")
        stored = normalize_sha256(binding.get("source_entrypoint_sha256"))
        if stored and stored != source.sha256(manifest.entrypoint):
            raise MaintenanceError("validation report source hash does not match current Raw", "stale_validation_report")


def _validate_candidate_changes(candidate: dict[str, Any]) -> None:
    local_ids: set[str] = set()
    for collection in ("candidate_segments", "current_changes", "durable_knowledge", "operational_changes"):
        arr = candidate.get(collection, [])
        if not isinstance(arr, list):
            raise MaintenanceError(f"{collection} must be an array", "schema_invalid")
        for item in arr:
            if not isinstance(item, dict):
                raise MaintenanceError(f"{collection} items must be objects", "schema_invalid")
            if collection in {"candidate_segments", "durable_knowledge", "operational_changes"}:
                defined_id = item.get("id")
                if isinstance(defined_id, str) and not LOCAL_CANDIDATE_ID_RE.fullmatch(defined_id):
                    raise MaintenanceError(
                        f"new staged object definitions must use local *-CAND-* IDs: {defined_id}",
                        "candidate_id_invalid",
                    )
            for key in ("id", "candidate_local_id"):
                value = item.get(key)
                if isinstance(value, str) and "-CAND-" in value:
                    if not LOCAL_CANDIDATE_ID_RE.match(value):
                        raise MaintenanceError(f"invalid local candidate ID: {value}", "candidate_id_invalid")
                    if value in local_ids:
                        raise MaintenanceError(f"duplicate local candidate ID: {value}", "candidate_id_duplicate")
                    local_ids.add(value)
    for change in candidate.get("current_changes", []):
        effect = change.get("effect")
        if effect not in VALID_EFFECTS:
            raise MaintenanceError(f"unknown reconciliation effect: {effect}", "reconciliation_effect_invalid")
        target = change.get("target_id")
        local = change.get("candidate_local_id")
        if effect == "ADD":
            if target not in {None, ""}:
                raise MaintenanceError("ADD change must not target an existing stable ID", "change_target_invalid")
            if not isinstance(local, str) or not LOCAL_CANDIDATE_ID_RE.match(local):
                raise MaintenanceError("ADD change requires candidate_local_id", "candidate_id_required")
        elif effect != "NO_CHANGE" and (not isinstance(target, str) or not target):
            raise MaintenanceError(f"{effect} change requires target_id", "change_target_required")


def _validate_evidence(candidate: dict[str, Any], snap, input_range: tuple[int, int], sealed_range: tuple[int, int], validation_report: dict[str, Any] | None) -> None:
    evidences = candidate.get("evidence_refs", [])
    if not isinstance(evidences, list):
        raise MaintenanceError("evidence_refs must be an array", "schema_invalid")
    seen: set[str] = set()
    by_seq = snap.message_by_sequence
    old_cov = None
    if validation_report:
        cov = validation_report.get("coverage") if isinstance(validation_report.get("coverage"), dict) else {}
        cur = cov.get("current") if isinstance(cov.get("current"), dict) else None
        if cur and isinstance(cur.get("seq_start"), int) and isinstance(cur.get("seq_end"), int):
            old_cov = (cur["seq_start"], cur["seq_end"])
    for ev in evidences:
        if not isinstance(ev, dict):
            raise MaintenanceError("evidence_refs items must be objects", "schema_invalid")
        eid = require_str(ev.get("id"), "evidence_refs[].id")
        if eid in seen:
            raise MaintenanceError(f"duplicate fragment evidence ID: {eid}", "evidence_id_duplicate")
        seen.add(eid)
        kind = ev.get("kind")
        scope = ev.get("source_scope")
        if scope not in {"sealed", "inherited", "cross_boundary"}:
            raise MaintenanceError(f"invalid evidence source_scope for {eid}: {scope}", "evidence_scope_invalid")
        loc = require_dict(ev.get("locator"), f"{eid}.locator")
        if kind == "message":
            seq = require_int(loc.get("sequence"), f"{eid}.locator.sequence")
            desc = by_seq.get(seq)
            if desc is None:
                raise MaintenanceError(f"evidence message sequence does not exist: {seq}", "evidence_locator_missing")
            if scope == "sealed" and not (sealed_range[0] <= seq <= sealed_range[1]):
                raise MaintenanceError(f"sealed evidence {eid} lies outside sealed_range", "sealed_evidence_outside_range")
            if scope == "inherited" and (old_cov is None or not (old_cov[0] <= seq <= old_cov[1])):
                raise MaintenanceError(f"inherited evidence {eid} is not within validated inherited coverage", "inherited_evidence_outside_coverage")
            if scope == "cross_boundary" and not (input_range[0] <= seq <= input_range[1]):
                raise MaintenanceError(f"cross-boundary evidence {eid} lies outside input_range", "cross_boundary_evidence_outside_input")
            mid = loc.get("message_id")
            vid = loc.get("version_id")
            if isinstance(mid, str) and desc.message_id != mid:
                raise MaintenanceError(f"evidence message_id mismatch at sequence {seq}", "evidence_locator_mismatch")
            if isinstance(vid, str) and desc.version_id != vid:
                raise MaintenanceError(f"evidence version_id mismatch at sequence {seq}", "evidence_locator_mismatch")
        elif kind == "attachment":
            aid = require_str(loc.get("attachment_id"), f"{eid}.locator.attachment_id")
            if aid not in snap.attachments:
                raise MaintenanceError(f"evidence attachment does not exist: {aid}", "evidence_attachment_missing")
        else:
            raise MaintenanceError(f"unsupported evidence kind for {eid}: {kind}", "evidence_kind_invalid")


def write_maintenance_fragment(
    package: str,
    *,
    candidate_path: str,
    output_path: str,
    validation_report_path: str | None = None,
) -> dict[str, Any]:
    candidate = load_json(candidate_path)
    if candidate.get("schema") != FRAGMENT_CANDIDATE_SCHEMA or candidate.get("schema_version") != SCHEMA_VERSION:
        raise MaintenanceError("fragment candidate schema/version is unsupported", "fragment_candidate_schema_unsupported")
    if "trust" in candidate or "persisted_trust" in candidate:
        raise MaintenanceError("Maintenance Fragment candidates must not claim persisted trust", "fragment_trust_forbidden")

    fragment_id = require_str(candidate.get("fragment_id"), "fragment_id")
    if not FRAGMENT_ID_RE.fullmatch(fragment_id):
        raise MaintenanceError("fragment_id must match FRAG-<integer>", "fragment_id_invalid")

    input_range = _range_obj(candidate.get("input_range"), "input_range")
    assert input_range is not None
    sealed_range = _range_obj(candidate.get("sealed_range"), "sealed_range", allow_none=True)
    if sealed_range is not None and not (input_range[0] <= sealed_range[0] <= sealed_range[1] <= input_range[1]):
        raise MaintenanceError("sealed_range must be a subset of input_range", "sealed_range_outside_input")

    _validate_candidate_changes(candidate)
    report = load_json(validation_report_path) if validation_report_path else None

    with PackageSource(package) as source:
        manifest = load_package_manifest(source)
        adapter = select_adapter(source, manifest.entrypoint)
        snap = adapter.scan()
        messages = list(adapter.iter_messages())
        by_seq_message = {m.descriptor.sequence: m for m in messages}
        ordered = [m.descriptor.sequence for m in messages]
        if not ordered:
            raise MaintenanceError("Raw source has no Canonical Current Messages", "raw_empty")

        raw_conv = manifest.conversation.get("id") or (snap.header or {}).get("conversation", {}).get("id")
        candidate_conv = require_str(candidate.get("conversation_id"), "conversation_id")
        if raw_conv is not None and candidate_conv != raw_conv:
            raise MaintenanceError("fragment candidate conversation_id does not match Raw", "conversation_identity_mismatch")

        base = candidate.get("base") if isinstance(candidate.get("base"), dict) else {}
        declared_rev = base.get("continuation_revision")
        if report:
            _validate_validation_report(report, source, manifest, candidate_conv)
            observed_rev = _validation_revision(report)
            if declared_rev != observed_rev:
                raise MaintenanceError("fragment candidate base revision does not match validation report", "base_revision_mismatch")
        elif declared_rev is not None:
            raise MaintenanceError("base continuation revision requires a validation report", "validation_report_required")

        if input_range[0] not in snap.message_by_sequence or input_range[1] not in snap.message_by_sequence:
            raise MaintenanceError("input_range endpoints must resolve to Canonical Current Messages", "range_endpoint_missing")
        input_seqs = sequence_set_for_range(ordered, *input_range)
        if not input_seqs:
            raise MaintenanceError("input_range contains no Canonical Current Messages", "range_empty")
        input_msgs = [by_seq_message[s] for s in input_seqs]

        # A null sealed range is a valid staged outcome, but only after the source/input binding was checked.
        if sealed_range is None:
            return {
                "report_schema": "chat-reader-maintenance-fragment-write",
                "report_version": "1.0.0",
                "tool": {"name": "write_maintenance_fragment", "version": "1.0.0"},
                "status": "no_sealable_prefix",
                "fragment_written": False,
                "fragment_id": fragment_id,
                "ranges": {"input": list(input_range), "sealed": None, "unsealed": list(input_range)},
                "source_binding": {
                    "validated": True,
                    "conversation_id": candidate_conv,
                    "entrypoint_sha256": f"sha256:{source.sha256(manifest.entrypoint)}",
                    "input_fingerprint": _range_fp(input_msgs, snap, "input"),
                },
                "findings": [],
            }

        if sealed_range[0] not in snap.message_by_sequence or sealed_range[1] not in snap.message_by_sequence:
            raise MaintenanceError("sealed_range endpoints must resolve to Canonical Current Messages", "range_endpoint_missing")
        sealed_seqs = sequence_set_for_range(ordered, *sealed_range)
        if not sealed_seqs:
            raise MaintenanceError("sealed_range contains no Canonical Current Messages", "range_empty")
        sealed_msgs = [by_seq_message[s] for s in sealed_seqs]

        # Validate optional unsealed tail as the actual suffix after the sealed boundary inside input_range.
        positions = {sequence: index for index, sequence in enumerate(ordered)}
        sealed_position = positions[sealed_range[1]]
        after_sealed = [s for s in input_seqs if positions[s] > sealed_position]
        unsealed = candidate.get("unsealed_tail")
        if after_sealed:
            if not isinstance(unsealed, dict):
                raise MaintenanceError("unsealed_tail is required when input_range contains messages after sealed_range", "unsealed_tail_required")
            ur = _range_obj(unsealed, "unsealed_tail")
            assert ur is not None
            if ur[0] not in snap.message_by_sequence or ur[1] not in snap.message_by_sequence:
                raise MaintenanceError("unsealed_tail endpoints must resolve to Canonical Current Messages", "range_endpoint_missing")
            unsealed_seqs = sequence_set_for_range(ordered, *ur)
            if unsealed_seqs != after_sealed:
                raise MaintenanceError("unsealed_tail must cover exactly the input messages after sealed_range", "unsealed_tail_mismatch")
        elif unsealed not in (None, {}):
            raise MaintenanceError("unsealed_tail must be absent when sealed_range reaches the input frontier", "unsealed_tail_mismatch")

        _validate_evidence(candidate, snap, input_range, sealed_range, report)

        deps_out = []
        for idx, dep in enumerate(candidate.get("dependency_ranges", []) or []):
            if not isinstance(dep, dict):
                raise MaintenanceError("dependency_ranges items must be objects", "schema_invalid")
            rr = _range_obj(dep, f"dependency_ranges[{idx}]")
            assert rr is not None
            if rr[0] not in snap.message_by_sequence or rr[1] not in snap.message_by_sequence:
                raise MaintenanceError("dependency range endpoints must resolve to Canonical Current Messages", "range_endpoint_missing")
            dep_msgs = [by_seq_message[s] for s in sequence_set_for_range(ordered, *rr)]
            deps_out.append({
                "seq_start": rr[0], "seq_end": rr[1], "message_count": len(dep_msgs),
                "reason": dep.get("reason"), "fingerprint": _range_fp(dep_msgs, snap, "dependency"),
            })

        segment_out = []
        for seg in candidate.get("candidate_segments", []) or []:
            if not isinstance(seg, dict):
                raise MaintenanceError("candidate_segments items must be objects", "schema_invalid")
            sid = require_str(seg.get("id"), "candidate_segments[].id")
            if not LOCAL_CANDIDATE_ID_RE.match(sid) or not sid.startswith("SEG-CAND-"):
                raise MaintenanceError(f"staged Segment must use local SEG-CAND-* ID: {sid}", "fragment_segment_id_invalid")
            ss = require_int(seg.get("seq_start"), f"{sid}.seq_start")
            se = require_int(seg.get("seq_end"), f"{sid}.seq_end")
            if not (sealed_range[0] <= ss <= se <= sealed_range[1]):
                raise MaintenanceError(f"candidate Segment {sid} must lie within sealed_range", "fragment_segment_outside_sealed_range")
            if ss not in snap.message_by_sequence or se not in snap.message_by_sequence:
                raise MaintenanceError(f"candidate Segment {sid} endpoints must resolve", "range_endpoint_missing")
            seg_msgs = [by_seq_message[s] for s in sequence_set_for_range(ordered, ss, se)]
            if not seg_msgs:
                raise MaintenanceError(f"candidate Segment {sid} contains no messages", "fragment_segment_empty")
            out = dict(seg)
            out["message_count"] = len(seg_msgs)
            out["source_fingerprint"] = _range_fp(seg_msgs, snap, "dependency")
            segment_out.append(out)

        att_out = []
        for dep in candidate.get("attachment_dependencies", []) or []:
            if not isinstance(dep, dict):
                raise MaintenanceError("attachment_dependencies items must be objects", "schema_invalid")
            aid = require_str(dep.get("attachment_id"), "attachment_dependencies[].attachment_id")
            if aid not in snap.attachments:
                raise MaintenanceError(f"attachment dependency does not exist: {aid}", "attachment_dependency_missing")
            out = dict(dep)
            att = snap.attachments[aid]
            out["object_sha256"] = att.object_sha256
            out["object_available"] = bool(att.object_path and source.exists(att.object_path))
            att_out.append(out)

        output = {
            "schema": FRAGMENT_SCHEMA,
            "schema_version": SCHEMA_VERSION,
            "fragment_id": fragment_id,
            "conversation_id": candidate_conv,
            "base_continuation_revision": declared_rev,
            "source_binding": {
                "conversation_id": candidate_conv,
                "source_snapshot": {
                    "entrypoint": manifest.entrypoint,
                    "entrypoint_sha256": f"sha256:{source.sha256(manifest.entrypoint)}",
                },
                "input_range": {
                    "seq_start": input_range[0], "seq_end": input_range[1], "message_count": len(input_msgs),
                    "fingerprint": _range_fp(input_msgs, snap, "input"),
                },
                "sealed_range": {
                    "seq_start": sealed_range[0], "seq_end": sealed_range[1], "message_count": len(sealed_msgs),
                    "fingerprint": _range_fp(sealed_msgs, snap, "sealed"),
                },
                "dependency_ranges": deps_out,
            },
            "input_range": {"seq_start": input_range[0], "seq_end": input_range[1]},
            "sealed_range": {"seq_start": sealed_range[0], "seq_end": sealed_range[1]},
            "candidate_segments": segment_out,
            "current_changes": candidate.get("current_changes", []),
            "durable_knowledge": candidate.get("durable_knowledge", []),
            "operational_changes": candidate.get("operational_changes", []),
            "evidence_refs": candidate.get("evidence_refs", []),
            "attachment_dependencies": att_out,
            "cross_boundary_dependencies": candidate.get("cross_boundary_dependencies", []),
            "unsealed_tail": candidate.get("unsealed_tail"),
        }
        atomic_write_json(output_path, output, refuse_existing=True)

        return {
            "report_schema": "chat-reader-maintenance-fragment-write",
            "report_version": "1.0.0",
            "tool": {"name": "write_maintenance_fragment", "version": "1.0.0"},
            "status": "ok",
            "fragment_written": True,
            "fragment_id": fragment_id,
            "output_path": str(Path(output_path).resolve()),
            "ranges": {
                "input": [input_range[0], input_range[1]],
                "sealed": [sealed_range[0], sealed_range[1]],
                "unsealed": (
                    [candidate["unsealed_tail"].get("seq_start"), candidate["unsealed_tail"].get("seq_end")]
                    if isinstance(candidate.get("unsealed_tail"), dict) else None
                ),
            },
            "source_binding": {"validated": True},
            "findings": [],
        }
