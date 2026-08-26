from __future__ import annotations

import hashlib
import json
import shutil
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.import_profile import ImportInputGroup, ImportProfile, ImportProfileRevision, ImportStructureFamily
from app.models.import_record import ImportRecord
from app.models.source_artifact import SourceArtifact
from app.schemas.import_schema import SourceProfile
from app.services.adaptive_import.analysis import analyze_documents, default_mapping, normalized_stem
from app.services.adaptive_import.contracts import AdaptiveImportError, AnalysisResult, SourceDocument
from app.services.adaptive_import.normalization import normalize_group, validate_drafts
from app.services.adaptive_import.profiles import (
    BUILTINS,
    builtin_payload,
    create_verified_revision,
    match_profile,
    normalize_builtin,
    profile_payload,
)
from app.services.import_pipeline.draft_store import attach_import_draft
from app.services.storage.local_storage import save_import_file

MAX_ADAPTIVE_FILES = 500
RECOVERABLE_SESSION_STATES = {"NEEDS_GROUPING", "RESOLVING", "READY", "BLOCKED"}


def create_session(db: Session, uploads: list[tuple[str, bytes]]) -> ImportRecord:
    record = begin_session(db, len(uploads))
    try:
        for filename, content in uploads:
            add_session_source(db, record, filename, content)
        return finalize_session(db, record)
    except Exception:
        db.rollback()
        remove_session_files(record.id)
        raise


def begin_session(db: Session, file_count: int, *, repair_profile_id: uuid.UUID | None = None) -> ImportRecord:
    if file_count < 1:
        raise AdaptiveImportError("FILES_REQUIRED", "Choose at least one JSON or Markdown file.", layer="file")
    if file_count > MAX_ADAPTIVE_FILES:
        raise AdaptiveImportError("FILE_COUNT_LIMIT", f"At most {MAX_ADAPTIVE_FILES} files can be analyzed at once.", layer="file")
    record = ImportRecord(
        id=uuid.uuid4(),
        source_profile="adaptive_json_markdown",
        source_fingerprint="pending",
        status="analyzing",
        phase="analyzing",
        progress=5,
        alignment_status="not_applicable",
        warnings=[],
        file_count=file_count,
        total_bytes=0,
        session_state="COLLECTING",
        analysis_summary={"repair_profile_id": str(repair_profile_id)} if repair_profile_id else {},
    )
    db.add(record)
    db.flush()
    return record


def add_session_source(db: Session, record: ImportRecord, filename: str, content: bytes) -> None:
    settings = get_settings()
    max_bytes = settings.max_import_file_size_mb * 1024 * 1024
    total_limit = settings.max_adaptive_import_total_mb * 1024 * 1024
    extension = _extension(filename)
    if extension not in {".json", ".jsonl", ".gz", ".md", ".markdown", ".txt", ".html", ".htm"}:
        raise AdaptiveImportError("SOURCE_UNSUPPORTED", f"Unsupported file extension: {extension or '(none)'}", layer="file")
    if not content:
        raise AdaptiveImportError("FILE_EMPTY", f"{filename} is empty.", layer="file")
    if len(content) > max_bytes:
        raise AdaptiveImportError("FILE_TOO_LARGE", f"{filename} exceeds the {settings.max_import_file_size_mb} MB limit.", layer="file")
    if record.total_bytes + len(content) > total_limit:
        raise AdaptiveImportError(
            "SESSION_TOO_LARGE",
            f"This import session exceeds the {settings.max_adaptive_import_total_mb} MB total limit.",
            layer="file",
        )
    digest = hashlib.sha256(content).hexdigest()
    stored = save_import_file(record.id, filename, content)
    db.add(SourceArtifact(
        id=uuid.uuid4(), import_id=record.id, source_type="adaptive_source", source_profile=SourceProfile.unknown.value,
        filename=filename, safe_filename=stored.safe_filename, sha256=digest, byte_size=len(content),
        mime_guess="application/json" if extension in {".json", ".jsonl", ".gz"} else "text/plain",
        file_extension=extension, raw_storage_uri=stored.raw_storage_uri, parsed_summary={},
    ))
    record.total_bytes += len(content)
    db.flush()


def finalize_session(db: Session, record: ImportRecord) -> ImportRecord:
    record.source_fingerprint = ",".join(sorted(artifact.sha256 for artifact in record.artifacts))
    _build_initial_groups(db, record)
    analyze_session(db, record)
    db.commit()
    db.refresh(record)
    return record


def analyze_session(db: Session, record: ImportRecord) -> None:
    _clear_import_plan(record)
    record.session_state = "ANALYZING"
    record.status = "analyzing"
    record.phase = "analyzing"
    record.progress = 15
    for group in record.input_groups:
        group.family_id = None
    db.flush()
    db.query(ImportStructureFamily).filter(ImportStructureFamily.import_id == record.id).delete(synchronize_session=False)
    db.expire(record, ["structure_families"])
    unresolved_grouping = [group for group in record.input_groups if group.grouping_status != "RESOLVED"]
    if unresolved_grouping:
        record.session_state = "NEEDS_GROUPING"
        record.status = "needs_grouping"
        record.phase = "grouping"
        record.progress = 20
        record.analysis_summary = _summary(record)
        return

    buckets: dict[tuple[str, str], list[tuple[ImportInputGroup, AnalysisResult]]] = defaultdict(list)
    invalid: list[tuple[ImportInputGroup, AdaptiveImportError]] = []
    for group in record.input_groups:
        try:
            analysis = analyze_documents(_group_documents(record, group))
            group.profile_resolution = {
                "analysis": {
                    "mode": analysis.mode,
                    "mapping_candidates": analysis.mapping_candidates,
                    "semantic": analysis.semantic,
                    "handling_class": analysis.handling_class,
                }
            }
            group.diagnostics = analysis.diagnostics
            buckets[(analysis.mode, analysis.signature_digest)].append((group, analysis))
        except AdaptiveImportError as exc:
            group.diagnostics = [exc.diagnostic(group_id=str(group.id))]
            group.profile_resolution = {"status": "INVALID"}
            invalid.append((group, exc))

    repair_profile: ImportProfile | None = None
    repair_profile_id = (record.analysis_summary or {}).get("repair_profile_id")
    if repair_profile_id:
        repair_profile = db.get(ImportProfile, uuid.UUID(str(repair_profile_id)))
        if repair_profile is None or repair_profile.kind != "LEARNED" or repair_profile.status != "ACTIVE":
            raise AdaptiveImportError("REPAIR_PROFILE_UNAVAILABLE", "The learned import profile is not available for repair.", layer="profile")
        if invalid or len(buckets) != 1 or next(iter(buckets))[0] != repair_profile.source_mode:
            raise AdaptiveImportError(
                "REPAIR_REQUIRES_ONE_FAMILY",
                "Profile repair requires source files that form exactly one compatible structure family.",
                layer="profile",
            )

    for (mode, digest), entries in buckets.items():
        representative = entries[0][1]
        documents = _group_documents(record, entries[0][0])
        match = match_profile(db, representative, documents)
        if repair_profile is not None:
            current_revision = next((item for item in repair_profile.revisions if item.id == repair_profile.current_revision_id), None)
            if current_revision is None:
                raise AdaptiveImportError("REPAIR_PROFILE_INVALID", "The learned import profile has no current revision.", layer="profile")
            from app.services.adaptive_import.contracts import MatchResult
            match = MatchResult(
                status="DRIFTED",
                profile_key=None,
                profile_id=str(repair_profile.id),
                revision_id=str(current_revision.id),
                profile_name=repair_profile.name,
                evidence={"reason": "user_requested_remap", "revision": current_revision.revision},
            )
        family = ImportStructureFamily(
            import_id=record.id,
            source_mode=mode,
            signature=representative.signature,
            signature_digest=digest,
            resolution_status=match.status,
            display_name=match.profile_name or _unknown_name(mode),
            matched_profile_key=match.profile_key,
            matched_profile_id=uuid.UUID(match.profile_id) if match.profile_id else None,
            matched_revision_id=uuid.UUID(match.revision_id) if match.revision_id else None,
            mapping_draft=default_mapping(representative),
            validation_result={},
            match_evidence={
                **match.evidence,
                "handling_class": "SUPPORTED" if match.status in {"EXACT_MATCH", "COMPATIBLE"} else "MAPPABLE",
                "handling_reason": _handling_reason(match.status, representative),
            },
        )
        db.add(family)
        db.flush()
        for group, _ in entries:
            group.family_id = family.id
            group.profile_resolution = {**group.profile_resolution, "status": match.status, "profile_name": match.profile_name}

    for group, exc in invalid:
        family = ImportStructureFamily(
            import_id=record.id, source_mode=group.mode, signature={}, signature_digest=hashlib.sha256(str(group.id).encode()).hexdigest(),
            resolution_status="INVALID", display_name="Invalid source", mapping_draft={}, validation_result={},
            match_evidence={
                "diagnostic": exc.diagnostic(group_id=str(group.id)),
                "handling_class": "NOT_MAPPABLE",
                "handling_reason": _handling_reason_for_error(exc),
            },
        )
        db.add(family)
        db.flush()
        group.family_id = family.id

    db.flush()
    db.expire(record, ["structure_families"])
    _resolve_known_families(db, record)
    _update_session_state(db, record)


def resolve_grouping(db: Session, record: ImportRecord, groups: list[dict[str, Any]]) -> None:
    _require_session_state(record, RECOVERABLE_SESSION_STATES)
    artifact_ids = {str(artifact.id) for artifact in record.artifacts}
    submitted = [str(item) for group in groups for item in group.get("artifact_ids", [])]
    if set(submitted) != artifact_ids or len(submitted) != len(set(submitted)):
        raise AdaptiveImportError("GROUPING_INCOMPLETE", "Every source file must appear in exactly one group.", layer="grouping")
    db.query(ImportInputGroup).filter(ImportInputGroup.import_id == record.id).delete(synchronize_session=False)
    db.flush()
    db.expire(record, ["input_groups"])
    for payload in groups:
        ids = [str(item) for item in payload["artifact_ids"]]
        artifacts = [artifact for artifact in record.artifacts if str(artifact.id) in ids]
        mode = _mode_for_artifacts(artifacts)
        if mode is None:
            raise AdaptiveImportError("GROUP_AMBIGUOUS", "Each group needs at most one JSON and one Markdown file.", layer="grouping")
        db.add(ImportInputGroup(
            import_id=record.id, mode=mode, artifact_ids=ids,
            display_name=payload.get("display_name") or " + ".join(item.filename for item in artifacts),
            grouping_status="RESOLVED", profile_resolution={}, diagnostics=[],
        ))
    db.flush()
    db.expire(record, ["input_groups"])
    analyze_session(db, record)


def reanalyze_session(db: Session, record: ImportRecord) -> None:
    _require_session_state(record, RECOVERABLE_SESSION_STATES)
    analyze_session(db, record)


def replace_session_artifact(
    db: Session,
    record: ImportRecord,
    artifact: SourceArtifact,
    *,
    filename: str,
    content: bytes,
) -> tuple[Path, Path]:
    _require_session_state(record, RECOVERABLE_SESSION_STATES)
    settings = get_settings()
    max_bytes = settings.max_import_file_size_mb * 1024 * 1024
    total_limit = settings.max_adaptive_import_total_mb * 1024 * 1024
    extension = _extension(filename)
    if extension not in {".json", ".jsonl", ".gz", ".md", ".markdown", ".txt", ".html", ".htm"}:
        raise AdaptiveImportError("SOURCE_UNSUPPORTED", f"Unsupported file extension: {extension or '(none)'}", layer="file")
    if not content:
        raise AdaptiveImportError("FILE_EMPTY", f"{filename} is empty.", layer="file")
    if len(content) > max_bytes:
        raise AdaptiveImportError("FILE_TOO_LARGE", f"{filename} exceeds the {settings.max_import_file_size_mb} MB limit.", layer="file")
    projected_total = record.total_bytes - artifact.byte_size + len(content)
    if projected_total > total_limit:
        raise AdaptiveImportError(
            "SESSION_TOO_LARGE",
            f"This import session exceeds the {settings.max_adaptive_import_total_mb} MB total limit.",
            layer="file",
        )

    old_path = _source_path(record, artifact)
    stored = save_import_file(record.id, filename, content)
    new_path = _session_root(record.id) / stored.safe_filename
    try:
        artifact.filename = filename
        artifact.safe_filename = stored.safe_filename
        artifact.sha256 = hashlib.sha256(content).hexdigest()
        artifact.byte_size = len(content)
        artifact.mime_guess = "application/json" if extension in {".json", ".jsonl", ".gz"} else "text/plain"
        artifact.file_extension = extension
        artifact.raw_storage_uri = stored.raw_storage_uri
        artifact.parsed_summary = {}
        record.total_bytes = projected_total

        artifacts_by_id = {str(item.id): item for item in record.artifacts}
        for group in record.input_groups:
            if str(artifact.id) not in group.artifact_ids:
                continue
            group_artifacts = [artifacts_by_id[item_id] for item_id in group.artifact_ids if item_id in artifacts_by_id]
            mode = _mode_for_artifacts(group_artifacts)
            group.mode = mode or "UNKNOWN"
            group.display_name = " + ".join(item.filename for item in group_artifacts)
            group.grouping_status = "RESOLVED" if mode else "AMBIGUOUS"
            group.profile_resolution = {}
            group.diagnostics = [] if mode else [{
                "code": "GROUP_AMBIGUOUS",
                "layer": "grouping",
                "blocking": True,
                "message": "This replacement no longer forms one JSON/Markdown conversation group.",
                "action": "open_group_resolver",
                "group_id": str(group.id),
            }]
        _refresh_source_fingerprint(record)
        analyze_session(db, record)
        return old_path, new_path
    except Exception:
        _remove_source_path(new_path)
        raise


def remove_input_group(db: Session, record: ImportRecord, group: ImportInputGroup) -> list[Path]:
    _require_session_state(record, RECOVERABLE_SESSION_STATES)
    if len(record.input_groups) <= 1:
        raise AdaptiveImportError(
            "SESSION_WOULD_BE_EMPTY",
            "The last conversation group cannot be excluded. Replace its source file or cancel this import instead.",
            layer="grouping",
        )

    artifact_ids = set(group.artifact_ids)
    if any(artifact_ids.intersection(other.artifact_ids) for other in record.input_groups if other.id != group.id):
        raise AdaptiveImportError(
            "GROUP_ARTIFACT_SHARED",
            "This group shares a source file with another group and must be regrouped before it can be excluded.",
            layer="grouping",
        )
    artifacts = [item for item in record.artifacts if str(item.id) in artifact_ids]
    paths = [_source_path(record, item) for item in artifacts]
    record.file_count -= len(artifacts)
    record.total_bytes -= sum(item.byte_size for item in artifacts)
    for artifact in artifacts:
        db.delete(artifact)
    db.delete(group)
    db.flush()
    db.expire(record, ["artifacts", "input_groups", "structure_families"])
    _refresh_source_fingerprint(record)
    analyze_session(db, record)
    return paths


def verify_family_mapping(
    db: Session,
    record: ImportRecord,
    family: ImportStructureFamily,
    *,
    mapping_spec: dict[str, Any],
    profile_name: str,
) -> None:
    _require_session_state(record, {"RESOLVING"})
    analysis = _analysis_for_family(record, family)
    all_drafts = []
    group_results = []
    for group in family.groups:
        try:
            drafts = normalize_group(_group_documents(record, group), mapping_spec, profile_name)
            result = validate_drafts(drafts)
            group_results.append({"group_id": str(group.id), **result})
            if not result["valid"]:
                raise AdaptiveImportError("FAMILY_VALIDATION_FAILED", "A group in this family does not satisfy the import contract.", layer="validation")
            all_drafts.extend(drafts)
        except AdaptiveImportError as exc:
            group.diagnostics = [exc.diagnostic(group_id=str(group.id))]
            family.validation_result = {"valid": False, "groups": group_results, "failed_group_id": str(group.id)}
            record.session_state = "RESOLVING"
            raise
    verification = validate_drafts(all_drafts)
    existing_profile_id = family.matched_profile_id if family.resolution_status == "DRIFTED" else None
    profile, revision = create_verified_revision(
        db,
        analysis=analysis,
        mapping_spec=mapping_spec,
        validation_spec={"minimum_messages": 1, "content_non_empty": True, "role_coverage": True},
        verification_summary={**verification, "group_count": len(family.groups)},
        name=profile_name,
        existing_profile_id=existing_profile_id,
    )
    family.resolution_status = "EXACT_MATCH"
    family.display_name = profile.name
    family.matched_profile_key = None
    family.matched_profile_id = profile.id
    family.matched_revision_id = revision.id
    family.mapping_draft = mapping_spec
    family.validation_result = {**verification, "groups": group_results}
    family.match_evidence = {"kind": "LEARNED", "revision": revision.revision, "verified_on_full_family": True}
    for group in family.groups:
        group.profile_resolution = {"status": "EXACT_MATCH", "profile_name": profile.name, "revision": revision.revision}
        group.diagnostics = []
    _update_session_state(db, record)


def preview_family_mapping(
    record: ImportRecord,
    family: ImportStructureFamily,
    *,
    mapping_spec: dict[str, Any],
    profile_name: str,
    sample_group_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    _require_session_state(record, {"RESOLVING"})
    drafts = []
    groups = []
    drafts_by_group: dict[str, list] = {}
    for group in family.groups:
        try:
            group_drafts = normalize_group(_group_documents(record, group), mapping_spec, profile_name)
            result = validate_drafts(group_drafts)
            groups.append({"group_id": str(group.id), **result})
            drafts.extend(group_drafts)
            drafts_by_group[str(group.id)] = group_drafts
        except AdaptiveImportError as exc:
            groups.append({"group_id": str(group.id), "valid": False, "issues": [exc.diagnostic(group_id=str(group.id))]})
    validation = validate_drafts(drafts) if drafts else {"valid": False, "conversation_count": 0, "message_count": 0, "issues": []}
    validation["valid"] = validation["valid"] and all(item["valid"] for item in groups)
    sample_group_key = str(sample_group_id) if sample_group_id else (str(family.groups[0].id) if family.groups else "")
    sample_drafts = drafts_by_group.get(sample_group_key, [])
    sample = sample_drafts[0] if sample_drafts else (drafts[0] if drafts else None)
    return {
        "validation": {**validation, "groups": groups, "verified_on_full_family": True},
        "sample_group_id": sample_group_key if sample is not None else None,
        "preview": None if sample is None else {
            "title": sample.title,
            "message_count": len(sample.messages),
            "messages": [
                {"role": message.role, "content": message.display_text[:2000], "timestamp": message.created_at}
                for message in sample.messages[:12]
            ],
        },
    }


def select_profile_revision(db: Session, record: ImportRecord, family: ImportStructureFamily, revision_id: uuid.UUID) -> None:
    _require_session_state(record, {"RESOLVING"})
    revision = db.get(ImportProfileRevision, revision_id)
    if revision is None or revision.status not in {"VERIFIED", "SUPERSEDED"}:
        raise AdaptiveImportError("PROFILE_NOT_FOUND", "The selected verified profile revision was not found.", layer="profile")
    profile = db.get(ImportProfile, revision.profile_id)
    if profile is None or profile.status != "ACTIVE" or profile.source_mode != family.source_mode:
        raise AdaptiveImportError("PROFILE_NOT_AVAILABLE", "The selected profile cannot be used for this family.", layer="profile")
    family.matched_profile_id = profile.id
    family.matched_revision_id = revision.id
    family.matched_profile_key = None
    family.display_name = profile.name
    family.mapping_draft = revision.mapping_spec
    family.resolution_status = "EXACT_MATCH"
    _validate_resolved_family(record, family, revision.mapping_spec, profile.name, revision.validation_spec)
    profile.last_used_at = datetime.now(timezone.utc)
    _update_session_state(db, record)


def session_payload(record: ImportRecord) -> dict[str, Any]:
    families = sorted(record.structure_families, key=lambda item: (item.display_name.casefold(), str(item.id)))
    groups = sorted(record.input_groups, key=lambda item: (item.display_name.casefold(), str(item.id)))
    return {
        "import_id": str(record.id),
        "state": record.session_state,
        "status": record.status,
        "file_count": record.file_count,
        "total_bytes": record.total_bytes,
        "group_count": len(groups),
        "family_count": len(families),
        "conversation_count": int((record.draft_summary or {}).get("conversation_count") or 0),
        "message_count": int((record.draft_summary or {}).get("message_count") or 0),
        "can_import": record.session_state == "READY" and bool(record.draft_storage_uri),
        "groups": [
            {
                "id": str(group.id), "mode": group.mode, "display_name": group.display_name,
                "artifact_ids": group.artifact_ids, "grouping_status": group.grouping_status,
                "family_id": str(group.family_id) if group.family_id else None,
                "profile_resolution": group.profile_resolution, "diagnostics": group.diagnostics,
                "files": [
                    {"artifact_id": str(artifact.id), "filename": artifact.filename, "extension": artifact.file_extension, "byte_size": artifact.byte_size}
                    for artifact in record.artifacts if str(artifact.id) in group.artifact_ids
                ],
            }
            for group in groups
        ],
        "families": [
            {
                "id": str(family.id), "source_mode": family.source_mode, "display_name": family.display_name,
                "resolution_status": family.resolution_status, "group_count": len(family.groups),
                "group_ids": [str(group.id) for group in family.groups],
                "matched_profile_key": family.matched_profile_key,
                "matched_profile_id": str(family.matched_profile_id) if family.matched_profile_id else None,
                "matched_revision_id": str(family.matched_revision_id) if family.matched_revision_id else None,
                "mapping_draft": family.mapping_draft,
                "validation_result": family.validation_result,
                "match_evidence": family.match_evidence,
                # The persisted evidence describes the profile match at the
                # start of analysis.  Full-family validation can subsequently
                # move a family to DRIFTED, so status is authoritative for
                # the user-facing handling class/recovery action.
                "handling_class": (
                    _handling_class_for_status(family.resolution_status)
                    if family.resolution_status in {"DRIFTED", "INVALID", "AMBIGUOUS", "UNKNOWN"}
                    else family.match_evidence.get("handling_class") or _handling_class_for_status(family.resolution_status)
                ),
                "handling_reason": (
                    _handling_reason_for_status(family.resolution_status)
                    if family.resolution_status == "DRIFTED"
                    else family.match_evidence.get("handling_reason") or {}
                ),
                "diagnostics": [diagnostic for group in family.groups for diagnostic in group.diagnostics],
            }
            for family in families
        ],
        "warnings": record.warnings or [],
        "analysis_summary": record.analysis_summary or {},
    }


def list_profiles(db: Session) -> list[dict[str, Any]]:
    learned = db.query(ImportProfile).order_by(ImportProfile.kind, ImportProfile.name).all()
    return [*(builtin_payload(item) for item in BUILTINS), *(profile_payload(item) for item in learned)]


def update_profile(db: Session, profile: ImportProfile, payload: dict[str, Any]) -> None:
    if profile.kind != "LEARNED":
        raise AdaptiveImportError("BUILTIN_READ_ONLY", "Built-in import profiles cannot be changed.", layer="profile")
    if "name" in payload:
        name = str(payload["name"]).strip()
        if not name:
            raise AdaptiveImportError("PROFILE_NAME_REQUIRED", "Profile name cannot be empty.", layer="profile")
        profile.name = name[:200]
    if "status" in payload:
        status = str(payload["status"]).upper()
        if status not in {"ACTIVE", "DISABLED"}:
            raise AdaptiveImportError("PROFILE_STATUS_INVALID", "Profile status must be ACTIVE or DISABLED.", layer="profile")
        profile.status = status
    profile.updated_at = datetime.now(timezone.utc)


def cancel_session(record: ImportRecord) -> None:
    if record.status == "committed" or record.committed_at is not None:
        raise AdaptiveImportError("SESSION_ALREADY_COMMITTED", "A committed import session cannot be canceled.", layer="session")
    record.session_state = "CANCELED"
    record.status = "canceled"
    record.phase = "canceled"
    record.progress = 0
    record.draft_storage_uri = None
    record.draft_sha256 = None
    record.draft_summary = {}
    remove_session_files(record.id)


def _build_initial_groups(db: Session, record: ImportRecord) -> None:
    artifacts = list(record.artifacts)
    json_artifacts = [item for item in artifacts if (item.file_extension or "").casefold() in {".json", ".jsonl", ".gz"}]
    markdown_artifacts = [item for item in artifacts if (item.file_extension or "").casefold() in {".md", ".markdown"}]
    if len(artifacts) == 2 and len(json_artifacts) == 1 and len(markdown_artifacts) == 1:
        db.add(ImportInputGroup(
            import_id=record.id,
            mode="JSON_MARKDOWN",
            artifact_ids=[str(item.id) for item in artifacts],
            display_name=" + ".join(item.filename for item in artifacts),
            grouping_status="RESOLVED",
            profile_resolution={},
            diagnostics=[],
        ))
        db.flush()
        return
    if not json_artifacts or not markdown_artifacts:
        for artifact in artifacts:
            db.add(ImportInputGroup(
                import_id=record.id,
                mode=_mode_for_artifacts([artifact]) or "UNKNOWN",
                artifact_ids=[str(artifact.id)],
                display_name=artifact.filename,
                grouping_status="RESOLVED",
                profile_resolution={},
                diagnostics=[],
            ))
        db.flush()
        return

    buckets: dict[str, list[SourceArtifact]] = defaultdict(list)
    for artifact in artifacts:
        buckets[normalized_stem(artifact.filename)].append(artifact)
    for stem, artifacts in sorted(buckets.items()):
        mode = _mode_for_artifacts(artifacts)
        resolved = mode == "JSON_MARKDOWN"
        group = ImportInputGroup(
            import_id=record.id,
            mode=mode or "UNKNOWN",
            artifact_ids=[str(artifact.id) for artifact in artifacts],
            display_name=" + ".join(artifact.filename for artifact in artifacts),
            grouping_status="RESOLVED" if resolved else "AMBIGUOUS",
            profile_resolution={},
            diagnostics=[] if resolved else [{
                "code": "GROUP_AMBIGUOUS", "layer": "grouping", "blocking": True,
                "message": f"Files grouped under {stem!r} do not form one unambiguous JSON/Markdown pair.", "action": "open_group_resolver",
            }],
        )
        db.add(group)
    db.flush()


def _resolve_known_families(db: Session, record: ImportRecord) -> None:
    for family in record.structure_families:
        if family.resolution_status not in {"EXACT_MATCH", "COMPATIBLE"}:
            continue
        try:
            if family.matched_profile_key:
                validation = _validate_resolved_family(record, family, None, family.matched_profile_key, None)
            elif family.matched_revision_id:
                revision = db.get(ImportProfileRevision, family.matched_revision_id)
                if revision is None:
                    raise AdaptiveImportError("PROFILE_NOT_FOUND", "Matched profile revision is missing.", layer="profile")
                validation = _validate_resolved_family(record, family, revision.mapping_spec, family.display_name, revision.validation_spec)
                profile = db.get(ImportProfile, revision.profile_id)
                if profile:
                    profile.last_used_at = datetime.now(timezone.utc)
            else:
                continue
            family.validation_result = validation
        except (AdaptiveImportError, ValueError) as exc:
            family.resolution_status = "DRIFTED"
            family.validation_result = {"valid": False, "message": str(exc)}
            family.match_evidence = {
                **(family.match_evidence or {}),
                "handling_class": "MAPPABLE",
                "handling_reason": _handling_reason_for_status("DRIFTED"),
            }
            for group in family.groups:
                diagnostic = exc.diagnostic(group_id=str(group.id)) if isinstance(exc, AdaptiveImportError) else {
                    "code": "NORMALIZATION_FAILED", "layer": "normalization", "blocking": True,
                    "message": str(exc), "group_id": str(group.id), "action": "repair_mapping",
                }
                group.diagnostics = [diagnostic]


def _validate_resolved_family(
    record: ImportRecord,
    family: ImportStructureFamily,
    mapping_spec: dict[str, Any] | None,
    profile_name: str,
    validation_spec: dict[str, Any] | None,
) -> dict[str, Any]:
    drafts = []
    groups = []
    for group in family.groups:
        group_drafts = normalize_builtin(family.matched_profile_key, _group_documents(record, group)) if family.matched_profile_key else normalize_group(_group_documents(record, group), mapping_spec or {}, profile_name)
        result = validate_drafts(group_drafts, validation_spec)
        groups.append({"group_id": str(group.id), **result})
        if not result["valid"]:
            raise AdaptiveImportError("FAMILY_VALIDATION_FAILED", "A group does not satisfy this profile.", layer="validation", action="repair_mapping")
        drafts.extend(group_drafts)
    result = validate_drafts(drafts, validation_spec)
    return {**result, "groups": groups, "verified_on_full_family": True}


def _update_session_state(db: Session, record: ImportRecord) -> None:
    statuses = {family.resolution_status for family in record.structure_families}
    if statuses <= {"EXACT_MATCH", "COMPATIBLE"} and statuses:
        _prepare_plan(db, record)
    else:
        record.session_state = "RESOLVING"
        record.status = "resolving"
        record.phase = "input_recovery" if "INVALID" in statuses else "profile_resolution"
        record.progress = 45 if "INVALID" in statuses else 55
    record.analysis_summary = _summary(record)


def _prepare_plan(db: Session, record: ImportRecord) -> None:
    all_drafts = []
    for family in record.structure_families:
        if family.matched_profile_key:
            for group in family.groups:
                all_drafts.extend(normalize_builtin(family.matched_profile_key, _group_documents(record, group)))
        else:
            revision = db.get(ImportProfileRevision, family.matched_revision_id) if family.matched_revision_id else None
            mapping = revision.mapping_spec if revision else family.mapping_draft
            for group in family.groups:
                all_drafts.extend(normalize_group(_group_documents(record, group), mapping, family.display_name))
    result = validate_drafts(all_drafts)
    if not result["valid"]:
        raise AdaptiveImportError("IMPORT_PLAN_INVALID", "The canonical import plan failed validation.", layer="validation")
    attach_import_draft(record, all_drafts)
    record.session_state = "READY"
    record.status = "previewed"
    record.phase = "ready"
    record.progress = 70
    record.total_messages = result["message_count"]
    record.alignment_status = "normalized"


def _analysis_for_family(record: ImportRecord, family: ImportStructureFamily) -> AnalysisResult:
    group = family.groups[0]
    analysis = analyze_documents(_group_documents(record, group))
    if analysis.signature_digest != family.signature_digest:
        raise AdaptiveImportError("ANALYSIS_CHANGED", "Source analysis changed; reanalyze before saving the mapping.", layer="analysis")
    return analysis


def _group_documents(record: ImportRecord, group: ImportInputGroup) -> list[SourceDocument]:
    result = []
    artifacts = {str(item.id): item for item in record.artifacts}
    for artifact_id in group.artifact_ids:
        artifact = artifacts.get(str(artifact_id))
        if artifact is None:
            raise AdaptiveImportError("SOURCE_MISSING", "An input group references a missing source file.", layer="grouping")
        path = _source_path(record, artifact)
        result.append(SourceDocument(
            artifact_id=str(artifact.id), filename=artifact.filename, extension=artifact.file_extension or _extension(artifact.filename), content=path.read_bytes()
        ))
    return result


def _mode_for_artifacts(artifacts: list[SourceArtifact]) -> str | None:
    json_count = sum((item.file_extension or "").casefold() in {".json", ".jsonl", ".gz"} for item in artifacts)
    markdown_count = sum((item.file_extension or "").casefold() in {".md", ".markdown"} for item in artifacts)
    if json_count > 1 or markdown_count > 1 or json_count + markdown_count != len(artifacts):
        return None
    if json_count and markdown_count: return "JSON_MARKDOWN"
    if json_count: return "JSON"
    if markdown_count: return "MARKDOWN"
    return None


def _summary(record: ImportRecord) -> dict[str, Any]:
    statuses = _count_statuses(family.resolution_status for family in record.structure_families)
    return {
        **({"repair_profile_id": record.analysis_summary["repair_profile_id"]} if (record.analysis_summary or {}).get("repair_profile_id") else {}),
        "group_count": len(record.input_groups), "family_count": len(record.structure_families),
        "resolution_counts": statuses, "ready": record.session_state == "READY",
    }


def _handling_class_for_status(status: str) -> str:
    if status in {"EXACT_MATCH", "COMPATIBLE"}:
        return "SUPPORTED"
    if status in {"UNKNOWN", "DRIFTED", "AMBIGUOUS"}:
        return "MAPPABLE"
    return "NOT_MAPPABLE"


def _handling_reason(status: str, analysis: AnalysisResult) -> dict[str, str]:
    return _handling_reason_for_status(status)


def _handling_reason_for_status(status: str) -> dict[str, str]:
    if status in {"EXACT_MATCH", "COMPATIBLE"}:
        return {"code": "SUPPORTED_PROFILE", "title": "已识别的导入格式", "detail": "Chat Reader 已验证该格式，可以直接导入。", "recovery_action": "DIRECT_IMPORT"}
    if status == "DRIFTED":
        return {"code": "PROFILE_DRIFTED", "title": "结构发生变化", "detail": "该格式仍有可解释的消息结构，需要修复映射后才能导入。", "recovery_action": "OPEN_MAPPING"}
    if status == "AMBIGUOUS":
        return {"code": "PROFILE_AMBIGUOUS", "title": "存在多个可能的格式", "detail": "请选择一个已保存格式，或设置一次新的映射。", "recovery_action": "OPEN_MAPPING"}
    return {"code": "UNKNOWN_MESSAGE_FORMAT", "title": "未知但可设置格式", "detail": "已找到可解释的消息边界和正文来源，需要设置一次映射。", "recovery_action": "OPEN_MAPPING"}


def _handling_reason_for_error(error: AdaptiveImportError) -> dict[str, str]:
    details = {
        "NO_MESSAGE_STRUCTURE": ("NO_MESSAGE_BOUNDARY", "没有可靠的消息边界", "当前内容不足以安全分割为 Conversation 消息。", "OPEN_RESCUE"),
        "DOCUMENT_NOT_TRANSCRIPT": ("DOCUMENT_NOT_TRANSCRIPT", "这不是对话记录", "当前文件是说明文档或转换指令，不是可直接分段的 Conversation。", "OPEN_RESCUE"),
        "MARKDOWN_EMPTY": ("EMPTY_SOURCE", "文件没有可导入内容", "文件为空，无法建立 Conversation。", "OPEN_RESCUE"),
        "SOURCE_UNSUPPORTED": ("UNSUPPORTED_SOURCE_TYPE", "文件类型不属于标准导入格式", "当前文件类型没有可用的确定性解析器。", "OPEN_RESCUE"),
        "JSON_INVALID": ("INVALID_JSON", "JSON 无法解析", "语法或编码错误无法通过字段映射解决。", "OPEN_RESCUE"),
        "MARKDOWN_ENCODING_INVALID": ("INVALID_ENCODING", "文本编码无法读取", "请先转换为 UTF-8 文本，或使用 Conversation Rescue。", "OPEN_RESCUE"),
    }
    code, title, detail, action = details.get(error.code, ("NOT_MAPPABLE", "暂不可映射", "当前结构不足以安全生成 Conversation。", "OPEN_RESCUE"))
    return {"code": code, "title": title, "detail": detail, "recovery_action": action}


def _clear_import_plan(record: ImportRecord) -> None:
    record.draft_storage_uri = None
    record.draft_sha256 = None
    record.draft_summary = {}
    record.draft_expires_at = None
    record.total_messages = 0


def _refresh_source_fingerprint(record: ImportRecord) -> None:
    record.source_fingerprint = ",".join(sorted(artifact.sha256 for artifact in record.artifacts))


def _session_root(import_id: uuid.UUID) -> Path:
    root = Path(get_settings().import_storage_dir).resolve()
    session_root = (root / str(import_id)).resolve()
    if session_root.parent != root or session_root.name != str(import_id):
        raise AdaptiveImportError("SOURCE_PATH_INVALID", "The import session storage path is invalid.", layer="file")
    return session_root


def _source_path(record: ImportRecord, artifact: SourceArtifact) -> Path:
    session_root = _session_root(record.id)
    path = (session_root / artifact.safe_filename).resolve()
    if not path.is_relative_to(session_root) or not path.is_file():
        raise AdaptiveImportError("SOURCE_MISSING", "A source file is missing from import storage.", layer="file")
    return path


def _remove_source_path(path: Path) -> None:
    root = Path(get_settings().import_storage_dir).resolve()
    resolved = path.resolve()
    if resolved.is_relative_to(root) and resolved.parent.parent == root:
        resolved.unlink(missing_ok=True)


def remove_source_paths(paths: list[Path]) -> None:
    for path in paths:
        _remove_source_path(path)


def _count_statuses(values) -> dict[str, int]:
    result: dict[str, int] = {}
    for value in values: result[value] = result.get(value, 0) + 1
    return result


def _require_session_state(record: ImportRecord, allowed: set[str]) -> None:
    if record.session_state not in allowed:
        expected = ", ".join(sorted(allowed))
        raise AdaptiveImportError(
            "SESSION_STATE_INVALID",
            f"This operation requires import session state {expected}; current state is {record.session_state}.",
            layer="session",
        )


def _unknown_name(mode: str) -> str:
    return {"JSON": "Unknown JSON format", "MARKDOWN": "Unknown Markdown format", "JSON_MARKDOWN": "Unknown JSON + Markdown format"}.get(mode, "Unknown format")


def _extension(filename: str) -> str:
    lower = filename.casefold()
    if lower.endswith(".canonical.jsonl.gz"): return ".gz"
    if lower.endswith(".canonical.jsonl"): return ".jsonl"
    return Path(lower).suffix


def remove_session_files(import_id: uuid.UUID) -> None:
    root = Path(get_settings().import_storage_dir).resolve()
    target = (root / str(import_id)).resolve()
    if target.parent == root and target.name == str(import_id) and target.is_dir():
        shutil.rmtree(target)
