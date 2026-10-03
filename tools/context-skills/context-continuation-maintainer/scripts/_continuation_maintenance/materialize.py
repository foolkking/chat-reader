from __future__ import annotations

import copy
import json
import os
import re
import shutil
import tempfile
import zipfile
from pathlib import Path
from typing import Any

from _context_package.canonical_v2 import select_adapter
from _context_package.current_doc import parse_current_document
from _context_package.continuation_index import load_index_json
from _context_package.fingerprints import fingerprint_messages
from _context_package.manifest import load_package_manifest
from _context_package.source import PackageSource
from _context_package.validation import validate_continuation

from .fragments import FRAGMENT_SCHEMA, _range_fp
from .model import (
    MaintenanceError,
    NAMESPACES,
    NEW_ID_RE,
    STABLE_ID_RE,
    VALID_GC_STATUS,
    VALID_MODES,
    VALID_TRUST,
    load_json,
    normalize_sha256,
    sequence_set_for_range,
    sha256_bytes,
)
from .render_current import render_current
from .render_index import render_index_model

CANDIDATE_SCHEMA = "chat-reader-continuation-candidate"
TRACE_SCHEMA = "chat-reader-maintenance-trace"
SCHEMA_VERSION = "1.0.0"
SEMANTIC_GATE_KEYS = (
    "adoption_resolved",
    "supersession_resolved",
    "scope_resolved",
    "state_levels_resolved",
    "material_conflicts_preserved",
    "context_critical_dependencies_resolved",
)
_PLACEHOLDER_TOKEN_RE = re.compile(r"NEW-(?:" + "|".join(NAMESPACES) + r")-\d+")
_STABLE_TOKEN_RE = re.compile(r"(?<!NEW-)\b(?:" + "|".join(NAMESPACES) + r")-\d+\b")


def _read_base(source: PackageSource, manifest) -> tuple[Any, dict[str, Any] | None, str | None, str | None, dict[str, int | None]]:
    current_path = "continuation/current.md"
    index_path = "continuation/index.json"
    if manifest.continuation:
        if isinstance(manifest.continuation.get("current"), str):
            current_path = manifest.continuation["current"]
        if isinstance(manifest.continuation.get("index"), str):
            index_path = manifest.continuation["index"]
    current = parse_current_document(source.read_text(current_path)) if source.exists(current_path) else None
    index = load_index_json(source.read_text(index_path)) if source.exists(index_path) else None
    current_rev = current.frontmatter.get("continuation_revision") if current and isinstance(current.frontmatter.get("continuation_revision"), int) else None
    index_rev = index.get("continuation_revision") if index and isinstance(index.get("continuation_revision"), int) else None
    manifest_rev = None
    if manifest.continuation and isinstance(manifest.continuation.get("continuation_revision"), int):
        manifest_rev = manifest.continuation["continuation_revision"]
    return (
        current, index, current_path if current else None, index_path if index else None,
        {"current": current_rev, "index": index_rev, "manifest": manifest_rev},
    )


def _validate_report_binding(report: dict[str, Any], source: PackageSource, manifest, current_path: str | None, index_path: str | None) -> None:
    if report.get("report_schema") != "chat-reader-continuation-validation":
        raise MaintenanceError("validation report schema is not recognized", "validation_report_invalid")
    binding = report.get("binding") if isinstance(report.get("binding"), dict) else None
    if binding:
        conv = manifest.conversation.get("id")
        if binding.get("conversation_id") not in {None, conv}:
            raise MaintenanceError("validation report belongs to another Conversation", "stale_maintenance_input")
        ep = binding.get("source_entrypoint")
        if isinstance(ep, str) and ep != manifest.entrypoint:
            raise MaintenanceError("validation report entrypoint differs from source", "stale_maintenance_input")
        raw_hash = normalize_sha256(binding.get("source_entrypoint_sha256"))
        if raw_hash and raw_hash != source.sha256(manifest.entrypoint):
            raise MaintenanceError("Raw source changed after validation", "stale_maintenance_input")
        if current_path and isinstance(binding.get("current_sha256"), str):
            if not source.exists(current_path) or normalize_sha256(binding["current_sha256"]) != source.sha256(current_path):
                raise MaintenanceError("base Current changed after validation", "concurrency_conflict")
        if index_path and isinstance(binding.get("index_sha256"), str):
            if not source.exists(index_path) or normalize_sha256(binding["index_sha256"]) != source.sha256(index_path):
                raise MaintenanceError("base Index changed after validation", "concurrency_conflict")


def _collect_stable_ids(value: Any, out: set[str]) -> None:
    if isinstance(value, str):
        if STABLE_ID_RE.fullmatch(value):
            out.add(value)
        for tok in _STABLE_TOKEN_RE.findall(value):
            out.add(tok)
    elif isinstance(value, list):
        for x in value:
            _collect_stable_ids(x, out)
    elif isinstance(value, dict):
        for x in value.values():
            _collect_stable_ids(x, out)


def _base_stable_ids(base_current, base_index, *, conversation_id: str) -> set[str]:
    stable: set[str] = set()
    if base_current and base_current.frontmatter.get("conversation_id") == conversation_id:
        stable.update(base_current.object_ids)
    if base_index and base_index.get("conversation_id") == conversation_id:
        for seg in base_index.get("segments", []) if isinstance(base_index.get("segments"), list) else []:
            if isinstance(seg, dict) and isinstance(seg.get("id"), str):
                stable.add(seg["id"])
        for ch in base_index.get("chapters", []) if isinstance(base_index.get("chapters"), list) else []:
            if isinstance(ch, dict) and isinstance(ch.get("id"), str):
                stable.add(ch["id"])
    return stable


def _validate_candidate_stable_ids(candidate: dict[str, Any], allowed: set[str]) -> None:
    referenced: set[str] = set()
    _collect_stable_ids(candidate, referenced)
    unknown = sorted(referenced - allowed)
    if unknown:
        raise MaintenanceError(
            f"Candidate uses final stable IDs that are not present in the reusable base: {unknown[:30]}",
            "candidate_stable_id_unknown",
        )


def _collect_placeholders(value: Any, out: set[str]) -> None:
    if isinstance(value, str):
        out.update(_PLACEHOLDER_TOKEN_RE.findall(value))
    elif isinstance(value, list):
        for x in value:
            _collect_placeholders(x, out)
    elif isinstance(value, dict):
        for x in value.values():
            _collect_placeholders(x, out)


def _allocate_ids(candidate: dict[str, Any], base_stable: set[str]) -> dict[str, str]:
    maxima = {ns: 0 for ns in NAMESPACES}
    for sid in base_stable:
        m = STABLE_ID_RE.match(sid)
        if m:
            maxima[m.group("ns")] = max(maxima[m.group("ns")], int(m.group("num")))
    placeholders: set[str] = set()
    _collect_placeholders(candidate, placeholders)
    mapping: dict[str, str] = {}

    def key(p: str):
        m = NEW_ID_RE.match(p)
        assert m
        return (NAMESPACES.index(m.group("ns")), int(m.group("num")), p)

    for placeholder in sorted(placeholders, key=key):
        m = NEW_ID_RE.match(placeholder)
        assert m
        ns = m.group("ns")
        maxima[ns] += 1
        mapping[placeholder] = f"{ns}-{maxima[ns]:03d}"
    return mapping


def _replace_ids(value: Any, mapping: dict[str, str]) -> Any:
    if isinstance(value, str):
        def repl(m): return mapping.get(m.group(0), m.group(0))
        return _PLACEHOLDER_TOKEN_RE.sub(repl, value)
    if isinstance(value, list): return [_replace_ids(x, mapping) for x in value]
    if isinstance(value, dict): return {k: _replace_ids(v, mapping) for k, v in value.items()}
    return value


def _trace_read_sequences(trace: dict[str, Any], ordered: list[int], target: set[int]) -> set[int]:
    out: set[int] = set()
    for field in ("semantic_reads", "targeted_rechecks"):
        arr = trace.get(field, [])
        if not isinstance(arr, list):
            raise MaintenanceError(f"Maintenance Trace {field} must be an array", "trace_invalid")
        for r in arr:
            if not isinstance(r, dict):
                raise MaintenanceError(f"Maintenance Trace {field} item must be an object", "trace_invalid")
            if r.get("every_sequence") is not True or r.get("full_body_required") is not True:
                continue
            a, b = r.get("seq_start"), r.get("seq_end")
            if not isinstance(a, int) or not isinstance(b, int) or a > b:
                raise MaintenanceError(f"invalid semantic read range in {field}", "trace_invalid")
            out.update(s for s in ordered if a <= s <= b and s in target)
    return out


def _unchanged_segment_sequences(report: dict[str, Any], base_index: dict[str, Any] | None, ordered: list[int]) -> set[int]:
    if not base_index:
        return set()
    fps = report.get("fingerprints") if isinstance(report.get("fingerprints"), dict) else {}
    segs = fps.get("segments") if isinstance(fps.get("segments"), dict) else {}
    details = segs.get("details")
    if not isinstance(details, list):
        raise MaintenanceError("full validation report required to inherit verified ranges after partial mismatch", "full_validation_report_required")
    unchanged_ids = {d.get("id") for d in details if isinstance(d, dict) and d.get("content_status") == "match"}
    out: set[int] = set()
    for seg in base_index.get("segments", []) if isinstance(base_index.get("segments"), list) else []:
        if not isinstance(seg, dict) or seg.get("id") not in unchanged_ids:
            continue
        a,b=seg.get("seq_start"),seg.get("seq_end")
        if isinstance(a,int) and isinstance(b,int): out.update(s for s in ordered if a<=s<=b)
    return out


def _inherited_sequences(trace: dict[str, Any], report: dict[str, Any] | None, base_index: dict[str, Any] | None, ordered: list[int], target: set[int]) -> set[int]:
    baseline = trace.get("baseline") if isinstance(trace.get("baseline"), dict) else {}
    inherited: set[int] = set()
    if not report:
        return inherited
    state = report.get("runtime_state")
    prefix = baseline.get("inherited_verified_prefix") if isinstance(baseline.get("inherited_verified_prefix"), dict) else None
    if state in {"valid_verified", "locator_only_mismatch"} and report.get("trust", {}).get("persisted") == "verified" and prefix:
        a,b=prefix.get("seq_start"),prefix.get("seq_end")
        old_cov = report.get("coverage", {}).get("current", {}) if isinstance(report.get("coverage"), dict) else {}
        if not isinstance(a,int) or not isinstance(b,int) or a>b:
            raise MaintenanceError("invalid inherited_verified_prefix", "trace_invalid")
        if a != old_cov.get("seq_start") or b != old_cov.get("seq_end"):
            raise MaintenanceError("inherited_verified_prefix must match validated old Stable Prefix", "trust_inheritance_invalid")
        if state == "locator_only_mismatch" and not report.get("locator_repair", {}).get("safe"):
            raise MaintenanceError("unsafe locator mismatch cannot inherit verified prefix", "trust_inheritance_invalid")
        inherited.update(s for s in ordered if a<=s<=b and s in target)
    ranges = baseline.get("inherited_verified_ranges", [])
    if ranges:
        persisted = report.get("trust", {}).get("persisted") if isinstance(report.get("trust"), dict) else None
        if persisted != "verified" or state != "content_mismatch":
            raise MaintenanceError(
                "explicit inherited_verified_ranges require a previously verified baseline with content_mismatch",
                "trust_inheritance_invalid",
            )
        allowed = _unchanged_segment_sequences(report, base_index, ordered)
        for rr in ranges:
            if not isinstance(rr, dict) or not isinstance(rr.get("seq_start"),int) or not isinstance(rr.get("seq_end"),int):
                raise MaintenanceError("invalid inherited_verified_ranges entry", "trace_invalid")
            chosen={s for s in ordered if rr["seq_start"]<=s<=rr["seq_end"] and s in target}
            if not chosen.issubset(allowed):
                raise MaintenanceError("inherited verified range includes source-changed or unverified material", "trust_inheritance_invalid")
            inherited.update(chosen)
    return inherited


def _validate_trace(
    trace: dict[str, Any], candidate: dict[str, Any], *, source: PackageSource, manifest,
    report: dict[str, Any] | None, base_index: dict[str, Any] | None,
    ordered: list[int], target_sequences: list[int], target_trust: str,
) -> dict[str, Any]:
    if trace.get("schema") != TRACE_SCHEMA or trace.get("schema_version") != SCHEMA_VERSION:
        raise MaintenanceError("Maintenance Trace schema/version unsupported", "trace_schema_unsupported")
    mode = trace.get("mode")
    if mode not in VALID_MODES or mode != candidate.get("maintenance_mode"):
        raise MaintenanceError("Maintenance Trace mode does not match Candidate", "trace_mode_mismatch")
    conv = manifest.conversation.get("id")
    if trace.get("conversation_id") != conv or candidate.get("conversation_id") != conv:
        raise MaintenanceError("Candidate/Trace conversation_id does not match source", "conversation_identity_mismatch")
    sb = trace.get("source_binding") if isinstance(trace.get("source_binding"), dict) else {}
    if sb.get("conversation_id") != conv:
        raise MaintenanceError("Trace source binding must name the current Conversation", "trace_source_binding_incomplete")
    entrypoint = sb.get("entrypoint")
    if entrypoint is not None and entrypoint != manifest.entrypoint:
        raise MaintenanceError("Trace source entrypoint does not match the current source", "stale_maintenance_input")
    stored_raw = normalize_sha256(sb.get("entrypoint_sha256"))
    if not stored_raw:
        raise MaintenanceError("Trace source binding requires entrypoint_sha256", "trace_source_binding_incomplete")
    if stored_raw != source.sha256(manifest.entrypoint):
        raise MaintenanceError("Trace Raw source binding is stale", "stale_maintenance_input")

    requested = trace.get("trust_target")
    if isinstance(requested, dict):
        requested = requested.get("requested")
    if requested != target_trust:
        raise MaintenanceError("Maintenance Trace trust target does not match Candidate", "trace_trust_target_mismatch")

    cov = candidate.get("coverage") if isinstance(candidate.get("coverage"), dict) else {}
    boundary = trace.get("boundary") if isinstance(trace.get("boundary"), dict) else {}
    if boundary.get("accepted_sequence") != cov.get("seq_end"):
        raise MaintenanceError("Candidate boundary does not match Maintenance Trace accepted boundary", "boundary_mismatch")

    gate = trace.get("semantic_gate") if isinstance(trace.get("semantic_gate"), dict) else {}
    missing_gate = [k for k in SEMANTIC_GATE_KEYS if gate.get(k) is not True]
    if missing_gate:
        raise MaintenanceError(f"semantic gate incomplete: {missing_gate}", "semantic_gate_incomplete")

    attachments = trace.get("attachments") if isinstance(trace.get("attachments"), dict) else {}
    req = set(x for x in attachments.get("required", []) if isinstance(x,str))
    ins = set(x for x in attachments.get("inspected", []) if isinstance(x,str))
    unavail = set(x for x in attachments.get("unavailable", []) if isinstance(x,str))
    if not req.issubset(ins | unavail):
        raise MaintenanceError("not all required context-critical attachments are accounted for", "attachment_gate_incomplete")

    gc = trace.get("retention_gc") if isinstance(trace.get("retention_gc"), dict) else {}
    gc_status = gc.get("status")
    if gc_status not in VALID_GC_STATUS:
        raise MaintenanceError("retention_gc.status is missing or invalid", "gc_gate_incomplete")
    repair_kind = trace.get("repair_kind")
    if repair_kind == "pure_locator":
        if mode != "REPAIR" or report is None or report.get("runtime_state") != "locator_only_mismatch":
            raise MaintenanceError("pure_locator repair requires a locator_only_mismatch validation state", "repair_kind_invalid")
        if not report.get("locator_repair", {}).get("safe"):
            raise MaintenanceError("pure_locator repair requires deterministic safe locator remapping", "repair_kind_invalid")
    if gc_status != "performed" and not (mode == "REPAIR" and repair_kind == "pure_locator"):
        raise MaintenanceError("semantic materialization requires retention_gc.status=performed", "gc_gate_incomplete")

    target = set(target_sequences)
    read = _trace_read_sequences(trace, ordered, target)
    inherited = _inherited_sequences(trace, report, base_index, ordered, target)
    if target_trust == "verified":
        missing = sorted(target - read - inherited)
        if missing:
            raise MaintenanceError(f"verified target lacks semantic coverage for sequences: {missing[:30]}", "trust_target_refused")
    return {"semantic_read_sequences": len(read), "inherited_sequences": len(inherited)}


def _validate_fragments(fragment_paths: list[str], *, source: PackageSource, manifest, adapter, snapshot, messages, candidate: dict[str, Any], base_revision: int | None, base_index: dict[str, Any] | None, target_sequences: list[int]) -> list[dict[str, Any]]:
    if candidate.get("maintenance_mode") == "FINALIZE" and not fragment_paths:
        raise MaintenanceError("FINALIZE requires Maintenance Fragments", "fragments_required")
    by_seq = {m.descriptor.sequence:m for m in messages}
    ordered=[m.descriptor.sequence for m in messages]
    results=[]; ids=[]; sealed_supported: set[int] = set()
    for path in fragment_paths:
        frag=load_json(path)
        if frag.get("schema")!=FRAGMENT_SCHEMA or frag.get("schema_version")!=SCHEMA_VERSION:
            raise MaintenanceError(f"unsupported Fragment schema: {path}", "fragment_schema_unsupported")
        if frag.get("conversation_id")!=manifest.conversation.get("id"):
            raise MaintenanceError(f"Fragment belongs to another Conversation: {path}", "fragment_lineage_mismatch")
        if frag.get("base_continuation_revision") not in {None, base_revision}:
            raise MaintenanceError(f"Fragment base revision incompatible with current base: {path}", "fragment_lineage_mismatch")
        bind=frag.get("source_binding") if isinstance(frag.get("source_binding"),dict) else {}
        stale=False; locator_changed=False
        for kind in ("sealed_range",):
            r=bind.get(kind) if isinstance(bind.get(kind),dict) else {}
            a,b=r.get("seq_start"),r.get("seq_end")
            fp=r.get("fingerprint") if isinstance(r.get("fingerprint"),dict) else {}
            if not isinstance(a,int) or not isinstance(b,int):
                raise MaintenanceError(f"Fragment {path} missing {kind} binding", "fragment_binding_invalid")
            seqs=sequence_set_for_range(ordered,a,b); ms=[by_seq[s] for s in seqs]
            now=_range_fp(ms,snapshot,"sealed")
            if now.get("content")!=fp.get("content"): stale=True
            if now.get("locators")!=fp.get("locators"): locator_changed=True
        for dep in bind.get("dependency_ranges",[]) if isinstance(bind.get("dependency_ranges"),list) else []:
            a,b=dep.get("seq_start"),dep.get("seq_end"); fp=dep.get("fingerprint") if isinstance(dep.get("fingerprint"),dict) else {}
            if not isinstance(a,int) or not isinstance(b,int): raise MaintenanceError("Fragment dependency binding invalid", "fragment_binding_invalid")
            ms=[by_seq[s] for s in sequence_set_for_range(ordered,a,b)]; now=_range_fp(ms,snapshot,"dependency")
            if now.get("content")!=fp.get("content"): stale=True
            if now.get("locators")!=fp.get("locators"): locator_changed=True
        if stale:
            raise MaintenanceError(f"Maintenance Fragment is stale: {path}", "stale_fragment")
        sr=bind.get("sealed_range") if isinstance(bind.get("sealed_range"),dict) else {}
        if isinstance(sr.get("seq_start"),int) and isinstance(sr.get("seq_end"),int):
            sealed_supported.update(s for s in ordered if sr["seq_start"]<=s<=sr["seq_end"])
        fid=frag.get("fragment_id"); ids.append(fid)
        results.append({"fragment_id":fid,"content_binding":"match","locator_binding":"mismatch" if locator_changed else "match"})
    if candidate.get("maintenance_mode") == "FINALIZE":
        supported=set(sealed_supported)
        if base_index and isinstance(base_index.get("coverage"),dict):
            bc=base_index["coverage"]; a,b=bc.get("seq_start"),bc.get("seq_end")
            if isinstance(a,int) and isinstance(b,int): supported.update(s for s in ordered if a<=s<=b)
        missing=[s for s in target_sequences if s not in supported]
        if missing:
            raise MaintenanceError(f"Fragment set leaves unexplained finalized coverage gaps: {missing[:30]}", "fragment_set_coverage_gap")
    if len(ids) != len(set(ids)):
        raise MaintenanceError("duplicate Maintenance Fragment IDs supplied", "fragment_set_duplicate")
    declared=candidate.get("fragments_used")
    if isinstance(declared,list) and set(declared)!=set(ids):
        raise MaintenanceError("Candidate fragments_used does not match supplied Fragments", "fragment_set_mismatch")
    return results


def _zip_directory(root: Path, dest: Path) -> None:
    with zipfile.ZipFile(dest, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for p in sorted(x for x in root.rglob("*") if x.is_file()):
            rel=p.relative_to(root).as_posix()
            zi=zipfile.ZipInfo(rel, date_time=(1980,1,1,0,0,0)); zi.compress_type=zipfile.ZIP_DEFLATED; zi.external_attr=(0o100644 & 0xFFFF)<<16
            with p.open('rb') as source, z.open(zi, 'w', force_zip64=True) as target:
                shutil.copyfileobj(source, target, length=1024 * 1024)


def _copy_source_tree(source: PackageSource, dest: Path) -> None:
    for member in source.list_members():
        source.copy_member(member, dest/member)


def _raw_immutability(source: PackageSource, output_zip: Path, manifest) -> dict[str, Any]:
    with PackageSource(output_zip) as out:
        entry_match = source.sha256(manifest.entrypoint)==out.sha256(manifest.entrypoint)
        asset_members=[m for m in source.list_members() if m.startswith("assets/")]
        mismatches=[]
        for m in asset_members:
            if not out.exists(m) or source.sha256(m)!=out.sha256(m): mismatches.append(m)
        return {"entrypoint_match":entry_match,"asset_objects_match":not mismatches,"asset_mismatches":mismatches}


def materialize_continuation(
    package: str, *, candidate_path: str, maintenance_trace_path: str, output_path: str,
    validation_report_path: str | None = None, fragment_paths: list[str] | None = None,
) -> dict[str, Any]:
    output=Path(output_path).resolve()
    source_path=Path(package).resolve()
    if output==source_path:
        raise MaintenanceError("in-place materialization is forbidden", "in_place_forbidden")
    if source_path.is_dir():
        try:
            output.relative_to(source_path)
        except ValueError:
            pass
        else:
            raise MaintenanceError("output must not be created inside a directory source package", "in_place_forbidden")
    if output.exists():
        raise MaintenanceError(f"output already exists: {output}", "output_exists")
    if output.suffix.lower()!=".zip":
        raise MaintenanceError("output must be a .zip Context Package", "output_type_invalid")
    candidate=load_json(candidate_path); trace=load_json(maintenance_trace_path); report=load_json(validation_report_path) if validation_report_path else None
    if candidate.get("schema")!=CANDIDATE_SCHEMA or candidate.get("schema_version")!=SCHEMA_VERSION:
        raise MaintenanceError("Continuation Candidate schema/version unsupported", "candidate_schema_unsupported")
    mode=candidate.get("maintenance_mode")
    if mode not in VALID_MODES or mode=="STAGED_BUILD":
        raise MaintenanceError("final materialization requires ONE_SHOT, FINALIZE, or REPAIR", "candidate_mode_invalid")
    trust=candidate.get("trust_target")
    if trust not in VALID_TRUST:
        raise MaintenanceError("Candidate trust_target must be verified or provisional", "trust_target_invalid")

    with PackageSource(package) as source:
        manifest=load_package_manifest(source); adapter=select_adapter(source,manifest.entrypoint); snapshot=adapter.scan(); messages=list(adapter.iter_messages()); ordered=[m.descriptor.sequence for m in messages]
        if not ordered: raise MaintenanceError("Raw source has no Canonical Current Messages", "raw_empty")
        base_current, base_index, current_path, index_path, base_revs=_read_base(source,manifest)
        if current_path or index_path:
            if report is None:
                raise MaintenanceError("existing continuation requires a validation report", "validation_report_required")
            _validate_report_binding(report,source,manifest,current_path,index_path)
        elif report is not None and report.get("runtime_state") not in {"no_continuation",None}:
            _validate_report_binding(report,source,manifest,current_path,index_path)

        actual_present=bool(current_path or index_path)
        report_rev = None
        if report and isinstance(report.get("binding"), dict) and isinstance(report["binding"].get("continuation_revision"), int):
            report_rev = report["binding"]["continuation_revision"]
        revisions = [r for r in base_revs.values() if isinstance(r, int)]
        canonical_base_rev = report_rev if report_rev is not None else (max(revisions) if revisions else None)
        max_observed_base_rev = max(revisions) if revisions else None

        base=candidate.get("base") if isinstance(candidate.get("base"),dict) else {}
        if not isinstance(base.get("continuation_present"), bool):
            raise MaintenanceError("Candidate base.continuation_present must be boolean", "base_presence_invalid")
        declared_present=base["continuation_present"]
        if declared_present!=actual_present:
            raise MaintenanceError("Candidate base.continuation_present disagrees with source", "base_presence_mismatch")
        declared_rev=base.get("continuation_revision")
        if actual_present and declared_rev!=canonical_base_rev:
            raise MaintenanceError("Candidate base revision disagrees with validated source", "concurrency_conflict")
        if not actual_present and declared_rev is not None:
            raise MaintenanceError("Raw-only build must use null base revision", "base_revision_mismatch")
        baseline=trace.get("baseline") if isinstance(trace.get("baseline"),dict) else {}
        if actual_present and baseline.get("continuation_revision")!=canonical_base_rev:
            raise MaintenanceError("Maintenance Trace base revision disagrees with source", "concurrency_conflict")
        if not actual_present and baseline.get("continuation_revision") is not None:
            raise MaintenanceError("Raw-only Maintenance Trace must use null base revision", "base_revision_mismatch")

        conv_id = manifest.conversation.get("id")
        reusable_stable_ids = _base_stable_ids(base_current, base_index, conversation_id=conv_id)
        _validate_candidate_stable_ids(candidate, reusable_stable_ids)

        coverage=candidate.get("coverage") if isinstance(candidate.get("coverage"),dict) else {}
        cs,ce=coverage.get("seq_start"),coverage.get("seq_end")
        if not isinstance(cs,int) or not isinstance(ce,int) or cs>ce:
            raise MaintenanceError("Candidate coverage range is invalid", "candidate_coverage_invalid")
        if cs!=ordered[0] or ce not in snapshot.message_by_sequence:
            raise MaintenanceError("Stable Prefix must begin at first Canonical Message and end on an actual message", "candidate_coverage_invalid")
        target_sequences=sequence_set_for_range(ordered,cs,ce)
        coverage_final={"seq_start":cs,"seq_end":ce,"message_count":len(target_sequences)}
        if trust == "verified":
            if manifest.conversation_completeness not in {None, "complete"}:
                raise MaintenanceError("verified trust is ineligible for a source declared incomplete", "trust_target_refused")
            if snapshot.parse_errors:
                raise MaintenanceError("verified trust is ineligible while Raw parse errors remain", "trust_target_refused")
            by_seq_desc = snapshot.message_by_sequence
            unavailable = [seq for seq in target_sequences if seq not in by_seq_desc or not by_seq_desc[seq].body_available]
            if unavailable:
                raise MaintenanceError(f"verified target includes unavailable message bodies: {unavailable[:30]}", "trust_target_refused")
        trust_stats=_validate_trace(trace,candidate,source=source,manifest=manifest,report=report,base_index=base_index,ordered=ordered,target_sequences=target_sequences,target_trust=trust)
        fragment_results=_validate_fragments(
            fragment_paths or [],source=source,manifest=manifest,adapter=adapter,snapshot=snapshot,messages=messages,
            candidate=candidate,base_revision=canonical_base_rev,base_index=base_index,target_sequences=target_sequences
        )

        # Allocate IDs once from the reusable base only. New objects MUST use NEW-* placeholders.
        mapping=_allocate_ids(candidate,reusable_stable_ids)
        resolved=_replace_ids(copy.deepcopy(candidate),mapping)
        remaining:set[str]=set(); _collect_placeholders(resolved,remaining)
        if remaining: raise MaintenanceError(f"unresolved placeholder IDs remain: {sorted(remaining)}", "id_allocation_incomplete")

        target_msgs=[m for m in messages if cs<=m.descriptor.sequence<=ce]
        source_fp=fingerprint_messages(target_msgs,snapshot,"prefix")
        new_revision=1 if max_observed_base_rev is None else max_observed_base_rev+1
        current_model=resolved.get("current") if isinstance(resolved.get("current"),dict) else None
        index_model=resolved.get("index") if isinstance(resolved.get("index"),dict) else None
        if current_model is None or index_model is None:
            raise MaintenanceError("Candidate must contain structured current and index models", "candidate_model_missing")
        rendered_index=render_index_model(index_model,conversation_id=resolved["conversation_id"],revision=new_revision,coverage=coverage_final,source_fingerprint=source_fp,messages=messages,snapshot=snapshot)
        rendered_current=render_current(current_model,conversation_id=resolved["conversation_id"],revision=new_revision,trust=trust,coverage=coverage_final,source_fingerprint=source_fp,index_path="continuation/index.json")
        index_bytes=(json.dumps(rendered_index,ensure_ascii=False,indent=2)+"\n").encode("utf-8"); current_bytes=rendered_current.encode("utf-8")

        output.parent.mkdir(parents=True,exist_ok=True)
        work=Path(tempfile.mkdtemp(prefix=".continuation-materialize-", dir=str(output.parent))); temp_zip=None
        try:
            tree=work/"package"; tree.mkdir(); _copy_source_tree(source,tree)
            # Remove old derived Current/Index if they used non-canonical paths.
            for old in (current_path,index_path):
                if old and old not in {"continuation/current.md","continuation/index.json"}:
                    p=tree/old
                    if p.exists(): p.unlink()
            (tree/"continuation").mkdir(parents=True,exist_ok=True)
            (tree/"continuation/current.md").write_bytes(current_bytes)
            (tree/"continuation/index.json").write_bytes(index_bytes)

            man=copy.deepcopy(manifest.raw)
            files=man.get("files") if isinstance(man.get("files"),dict) else {}; man["files"]=files
            for old in (current_path,index_path):
                if old and old not in {"continuation/current.md","continuation/index.json"}: files.pop(old,None)
            files["continuation/current.md"]={"sha256":sha256_bytes(current_bytes),"byte_size":len(current_bytes)}
            files["continuation/index.json"]={"sha256":sha256_bytes(index_bytes),"byte_size":len(index_bytes)}
            cont={
                "schema_version":"1.0.0","continuation_revision":new_revision,"trust":trust,
                "current":"continuation/current.md","index":"continuation/index.json",
                "coverage":coverage_final,"source_fingerprint":source_fp,
            }
            tail=ordered[ordered.index(ce)+1:]
            if tail: cont["raw_tail_start_seq"]=tail[0]
            man["continuation"]=cont
            (tree/"manifest.json").write_text(json.dumps(man,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")

            temp_zip=work/"candidate.context.zip"; _zip_directory(tree,temp_zip)
            imm=_raw_immutability(source,temp_zip,manifest)
            if not imm["entrypoint_match"] or not imm["asset_objects_match"]:
                raise MaintenanceError("Raw immutability gate failed", "raw_immutability_failure")
            final_validation=validate_continuation(str(temp_zip),detail="full")
            expected="valid_verified" if trust=="verified" else "valid_provisional"
            if final_validation.get("runtime_state")!=expected:
                raise MaintenanceError(f"final deterministic validation failed: {final_validation.get('runtime_state')}", "final_validation_failed")
            # Re-open the live source just before publication for optimistic concurrency.
            with PackageSource(package) as fresh_source:
                fresh_manifest = load_package_manifest(fresh_source)
                if fresh_manifest.conversation.get("id") != manifest.conversation.get("id"):
                    raise MaintenanceError("source Conversation changed before publication", "concurrency_conflict")
                stored=normalize_sha256(trace["source_binding"]["entrypoint_sha256"])
                if stored != fresh_source.sha256(fresh_manifest.entrypoint):
                    raise MaintenanceError("Raw changed before publication", "concurrency_conflict")
                if report is not None:
                    _validate_report_binding(report,fresh_source,fresh_manifest,current_path,index_path)
            try:
                os.link(temp_zip, output)
            except FileExistsError as exc:
                raise MaintenanceError('output appeared before publication', 'output_exists') from exc
            temp_zip.unlink(); temp_zip=None
            return {
                "report_schema":"chat-reader-continuation-materialization","report_version":"1.0.0",
                "tool":{"name":"materialize_continuation","version":"1.1.0"},
                "status":"published","source_package":str(source_path),"output_package":str(output),
                "base_revision":canonical_base_rev,"new_revision":new_revision,"maintenance_mode":mode,
                "trust":{"requested":trust,"effective":trust,"eligible":True},
                "coverage":coverage_final,"id_allocations":mapping,
                "semantic_coverage":trust_stats,"fragments":fragment_results,
                "raw_immutability":imm,
                "validation":{"runtime_state":final_validation.get("runtime_state")},
                "files":{"current":{"sha256":sha256_bytes(current_bytes)},"index":{"sha256":sha256_bytes(index_bytes)}},
                "findings":[],
            }
        finally:
            if temp_zip is not None and temp_zip.exists():
                try: temp_zip.unlink()
                except OSError: pass
            shutil.rmtree(work,ignore_errors=True)
