from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.models.background_job import BackgroundJob
from app.models.import_profile import ImportInputGroup, ImportProfile, ImportProfileAlias, ImportProfilePublication, ImportProfileRevision, ImportStructureFamily
from app.models.import_record import ImportRecord
from app.models.project import Project
from app.models.source_artifact import SourceArtifact
from app.services.adaptive_import.contracts import AdaptiveImportError
from app.services.adaptive_import.profile_access import available_revisions, canonical_profile_id, publish_revision, related_profile_ids, revision_payload, visible_profile
from app.services.administration import require_root_admin, record_admin_audit, request_id_from
from app.services.adaptive_import.service import (
    MAX_ADAPTIVE_FILES,
    add_session_source_stream,
    begin_session,
    cancel_session,
    check_family_health,
    list_profiles,
    preview_family_mapping,
    reanalyze_session,
    remove_input_group,
    remove_source_paths,
    remove_session_files,
    queue_session_analysis,
    replace_session_artifact,
    resolve_grouping,
    select_profile_revision,
    session_payload,
    update_profile,
    verify_family_mapping,
)
from app.services.ownership import OwnershipScope, get_owned, ownership_scope_from_request
from app.services.feature_policies import effective_import_size_mb, get_feature_policy
from app.services.uploads import (
    UploadLimitError,
    bounded_analysis_admission_sync,
    bounded_upload_staging_sync,
    read_upload_bounded_sync,
    upload_size,
)

router = APIRouter(tags=["adaptive-import"])


class GroupSpec(BaseModel):
    artifact_ids: list[uuid.UUID] = Field(min_length=1, max_length=2)
    display_name: str | None = Field(default=None, max_length=300)


class GroupingRequest(BaseModel):
    groups: list[GroupSpec] = Field(min_length=1, max_length=500)


class FamilyMappingRequest(BaseModel):
    profile_name: str = Field(min_length=1, max_length=200)
    mapping_spec: dict[str, Any]


class ProfileSelectionRequest(BaseModel):
    revision_id: uuid.UUID


class FamilyMappingPreviewRequest(BaseModel):
    profile_name: str = Field(default="Preview format", min_length=1, max_length=200)
    mapping_spec: dict[str, Any]
    sample_group_id: uuid.UUID | None = None


class ProfileUpdateRequest(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    status: str | None = None


class ImportDestinationRequest(BaseModel):
    target_project_id: uuid.UUID | None = None


@router.post("/api/adaptive-import/sessions", status_code=status.HTTP_201_CREATED)
def create_adaptive_import_session(
    files: list[UploadFile] = File(...),
    repair_profile_id: uuid.UUID | None = Form(default=None),
    target_project_id: uuid.UUID | None = Form(default=None),
    db: Session = Depends(get_db),
    ownership_scope: OwnershipScope = Depends(ownership_scope_from_request),
) -> dict[str, Any]:
    if not files:
        raise HTTPException(status_code=400, detail={"code": "FILES_REQUIRED", "message": "Choose at least one JSON or Markdown file."})
    if len(files) > MAX_ADAPTIVE_FILES:
        raise HTTPException(status_code=422, detail={"code": "FILE_COUNT_LIMIT", "message": f"At most {MAX_ADAPTIVE_FILES} files can be analyzed at once."})
    if not get_feature_policy(db).allow_user_import:
        raise HTTPException(status_code=403, detail={"code": "IMPORT_DISABLED", "message": "User import is disabled by the system administrator."})
    if target_project_id is not None:
        target_project = get_owned(db, Project, target_project_id, ownership_scope)
        if target_project is None:
            raise HTTPException(status_code=404, detail={"code": "IMPORT_PROJECT_NOT_FOUND", "message": "The selected import project is unavailable."})
        if target_project.is_archived:
            raise HTTPException(status_code=409, detail={"code": "IMPORT_PROJECT_ARCHIVED", "message": "Restore the selected project before importing into it."})
        if target_project.is_default:
            target_project_id = None
    max_bytes = effective_import_size_mb(db, ownership_scope.owner_user_id) * 1024 * 1024
    # Keep the existing SESSION_TOO_LARGE contract for the session budget;
    # this additional guard represents only the upload gateway's request ceiling.
    total_limit = get_settings().import_gateway_file_limit_mb * 1024 * 1024
    sizes = [upload_size(item) for item in files]
    if any(size > max_bytes for size in sizes):
        raise HTTPException(
            status_code=413,
            detail={"code": "FILE_TOO_LARGE", "message": "A source file exceeds the configured per-file limit."},
        )
    if sum(sizes) > total_limit:
        raise HTTPException(
            status_code=413,
            detail={"code": "IMPORT_TOTAL_SIZE_LIMIT", "message": "The combined files exceed this deployment's import limit."},
        )
    record: ImportRecord | None = None
    commit_attempted = False
    try:
        with bounded_upload_staging_sync(files):
            record = begin_session(
                db,
                len(files),
                repair_profile_id=repair_profile_id,
                target_project_id=target_project_id,
                owner_user_id=ownership_scope.owner_user_id,
            )
            for item in files:
                item.file.seek(0)
                add_session_source_stream(
                    db,
                    record,
                    item.filename or "upload",
                    item.file,
                    max_file_bytes=max_bytes,
                )
            queue_session_analysis(db, record)
            # Once COMMIT starts its outcome may be unknown to this request.
            # A refresh/response failure cannot revoke a durable queued job.
            commit_attempted = True
            db.commit()
            db.refresh(record)
        return session_payload(record)
    except UploadLimitError as exc:
        db.rollback()
        if record is not None and not commit_attempted:
            _remove_failed_session(record.id)
        raise HTTPException(
            status_code=exc.status_code,
            detail={"code": exc.code, "message": str(exc)},
            headers={"Retry-After": "15"} if exc.status_code == 429 else None,
        ) from exc
    except AdaptiveImportError as exc:
        db.rollback()
        if record is not None and not commit_attempted:
            _remove_failed_session(record.id)
        raise _http_error(exc) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        if record is not None and not commit_attempted:
            _remove_failed_session(record.id)
        message = (
            "Import analysis submission is not confirmed. Check Tasks before uploading again."
            if commit_attempted else "Import analysis could not be saved."
        )
        raise HTTPException(status_code=500, detail={"code": "SESSION_PERSISTENCE_FAILED", "message": message}) from exc
    except Exception as exc:
        db.rollback()
        if record is not None and not commit_attempted:
            _remove_failed_session(record.id)
        message = (
            "Import analysis submission is not confirmed. Check Tasks before uploading again."
            if commit_attempted else "Import analysis failed safely."
        )
        raise HTTPException(status_code=500, detail={"code": "SESSION_ANALYSIS_FAILED", "message": message}) from exc


def _remove_failed_session(import_id: uuid.UUID) -> None:
    remove_session_files(import_id)


@router.get("/api/adaptive-import/sessions/{import_id}")
def get_adaptive_import_session(
    import_id: uuid.UUID,
    db: Session = Depends(get_db),
    ownership_scope: OwnershipScope = Depends(ownership_scope_from_request),
) -> dict[str, Any]:
    record = _record(import_id, db, ownership_scope)
    result = session_payload(record)
    task_id = result.get("analysis_task_id")
    if task_id and record.session_state in {"ANALYZING", "COLLECTING"}:
        job = get_owned(db, BackgroundJob, uuid.UUID(str(task_id)), ownership_scope)
        if job is not None and job.job_type == "adaptive_import_analysis":
            result.update(phase=job.phase, progress=job.progress)
            if job.status == "cancelling":
                result["state"] = "CANCELING"
    return result


@router.delete("/api/adaptive-import/sessions/{import_id}", status_code=status.HTTP_204_NO_CONTENT)
def cancel_adaptive_import_session(
    import_id: uuid.UUID,
    db: Session = Depends(get_db),
    ownership_scope: OwnershipScope = Depends(ownership_scope_from_request),
) -> None:
    record = _record(import_id, db, ownership_scope)
    try:
        task_id = (record.analysis_summary or {}).get("analysis_task_id")
        job = None
        if task_id:
            try:
                job = (
                    db.query(BackgroundJob)
                    .filter(
                        BackgroundJob.id == uuid.UUID(str(task_id)),
                        ownership_scope.predicate(BackgroundJob),
                        BackgroundJob.job_type == "adaptive_import_analysis",
                    )
                    .with_for_update()
                    .one_or_none()
                )
            except ValueError:
                job = None
        if job is not None and job.status == "processing":
            now = datetime.now(timezone.utc)
            job.status = "cancelling"
            job.phase = "cancelling"
            job.heartbeat_at = now
            # The worker owns a transaction on this ImportRecord. Only update
            # its job here; writing the record would wait on that transaction
            # and could deadlock the worker's final cancellation check.
        elif job is not None and job.status == "cancelling":
            pass
        else:
            # A terminal analysis job does not own the record any more. Lock
            # and refresh it before deleting files: canonical commit may have
            # started after the initial read above.
            db.refresh(record, with_for_update=True)
            if job is not None and job.status == "queued":
                now = datetime.now(timezone.utc)
                job.status = "cancelled"
                job.phase = "cancelled"
                job.completed_at = now
                job.heartbeat_at = now
            cancel_session(record)
        db.commit()
    except AdaptiveImportError as exc:
        db.rollback()
        raise _http_error(exc) from exc


@router.put("/api/adaptive-import/sessions/{import_id}/groups")
def update_adaptive_import_groups(
    import_id: uuid.UUID,
    payload: GroupingRequest,
    db: Session = Depends(get_db),
    ownership_scope: OwnershipScope = Depends(ownership_scope_from_request),
) -> dict[str, Any]:
    record = _record(import_id, db, ownership_scope)
    try:
        with bounded_analysis_admission_sync(_analysis_sizes(record)):
            resolve_grouping(db, record, [item.model_dump(mode="json") for item in payload.groups])
        db.commit()
        db.refresh(record)
        return session_payload(record)
    except AdaptiveImportError as exc:
        db.rollback()
        raise _http_error(exc) from exc
    except UploadLimitError as exc:
        db.rollback()
        raise _upload_error(exc) from exc


@router.post("/api/adaptive-import/sessions/{import_id}/reanalyze")
def reanalyze_adaptive_import_session(
    import_id: uuid.UUID,
    db: Session = Depends(get_db),
    ownership_scope: OwnershipScope = Depends(ownership_scope_from_request),
) -> dict[str, Any]:
    record = _record(import_id, db, ownership_scope)
    try:
        with bounded_analysis_admission_sync(_analysis_sizes(record)):
            reanalyze_session(db, record)
        db.commit()
        db.refresh(record)
        return session_payload(record)
    except AdaptiveImportError as exc:
        db.rollback()
        raise _http_error(exc) from exc
    except UploadLimitError as exc:
        db.rollback()
        raise _upload_error(exc) from exc


@router.put("/api/adaptive-import/sessions/{import_id}/destination")
def update_adaptive_import_destination(
    import_id: uuid.UUID,
    payload: ImportDestinationRequest,
    db: Session = Depends(get_db),
    ownership_scope: OwnershipScope = Depends(ownership_scope_from_request),
) -> dict[str, Any]:
    record = _record(import_id, db, ownership_scope)
    record = (
        db.query(ImportRecord)
        .filter(ImportRecord.id == record.id)
        .with_for_update()
        .one()
    )
    if record.status in {"queued", "processing", "committed"} or record.session_state in {"IMPORTING", "COMPLETED", "CANCELED"}:
        raise HTTPException(status_code=409, detail={"code": "IMPORT_DESTINATION_LOCKED", "message": "The destination can no longer be changed for this import."})

    target_project_id = payload.target_project_id
    if target_project_id is not None:
        target_project = get_owned(db, Project, target_project_id, ownership_scope)
        if target_project is None:
            raise HTTPException(status_code=404, detail={"code": "IMPORT_PROJECT_NOT_FOUND", "message": "The selected import project is unavailable."})
        if target_project.is_archived:
            raise HTTPException(status_code=409, detail={"code": "IMPORT_PROJECT_ARCHIVED", "message": "Restore the selected project before importing into it."})
        if target_project.is_default:
            target_project_id = None

    summary = dict(record.analysis_summary or {})
    summary["target_project_id"] = str(target_project_id) if target_project_id else None
    commit_options = dict(summary.get("commit_options") or {})
    commit_options["project_id"] = str(target_project_id) if target_project_id else None
    summary["commit_options"] = commit_options
    record.analysis_summary = summary
    db.commit()
    db.refresh(record)
    return session_payload(record)


@router.put("/api/adaptive-import/sessions/{import_id}/artifacts/{artifact_id}")
def replace_adaptive_import_artifact(
    import_id: uuid.UUID,
    artifact_id: uuid.UUID,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    ownership_scope: OwnershipScope = Depends(ownership_scope_from_request),
) -> dict[str, Any]:
    record = _record(import_id, db, ownership_scope)
    artifact = _artifact(import_id, artifact_id, db)
    if not get_feature_policy(db).allow_user_import:
        raise HTTPException(status_code=403, detail={"code": "IMPORT_DISABLED", "message": "User import is disabled by the system administrator."})
    new_path = None
    try:
        max_bytes = effective_import_size_mb(db, ownership_scope.owner_user_id) * 1024 * 1024
        sizes = [artifact.byte_size for artifact in record.artifacts if artifact.id != artifact_id]
        sizes.append(upload_size(file))
        with bounded_analysis_admission_sync(sizes):
            content = read_upload_bounded_sync(file, max_bytes)
            old_path, new_path = replace_session_artifact(
                db,
                record,
                artifact,
                filename=file.filename or "replacement",
                content=content,
            )
        db.commit()
        db.refresh(record)
        remove_source_paths([old_path])
        return session_payload(record)
    except AdaptiveImportError as exc:
        db.rollback()
        if new_path is not None:
            remove_source_paths([new_path])
        raise _http_error(exc) from exc
    except UploadLimitError as exc:
        db.rollback()
        if new_path is not None:
            remove_source_paths([new_path])
        raise HTTPException(
            status_code=exc.status_code,
            detail={"code": exc.code, "message": str(exc)},
            headers={"Retry-After": "15"} if exc.status_code == 429 else None,
        ) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        if new_path is not None:
            remove_source_paths([new_path])
        raise HTTPException(
            status_code=500,
            detail={"code": "SOURCE_REPLACEMENT_FAILED", "message": "The replacement could not be saved."},
        ) from exc


@router.delete("/api/adaptive-import/sessions/{import_id}/groups/{group_id}")
def exclude_adaptive_import_group(
    import_id: uuid.UUID,
    group_id: uuid.UUID,
    db: Session = Depends(get_db),
    ownership_scope: OwnershipScope = Depends(ownership_scope_from_request),
) -> dict[str, Any]:
    record = _record(import_id, db, ownership_scope)
    group = _group(import_id, group_id, db)
    try:
        with bounded_analysis_admission_sync(_analysis_sizes(record)):
            removed_paths = remove_input_group(db, record, group)
        db.commit()
        db.refresh(record)
        remove_source_paths(removed_paths)
        return session_payload(record)
    except AdaptiveImportError as exc:
        db.rollback()
        raise _http_error(exc) from exc
    except UploadLimitError as exc:
        db.rollback()
        raise _upload_error(exc) from exc


@router.post("/api/adaptive-import/sessions/{import_id}/families/{family_id}/mapping")
def save_family_mapping(
    import_id: uuid.UUID,
    family_id: uuid.UUID,
    payload: FamilyMappingRequest,
    db: Session = Depends(get_db),
    ownership_scope: OwnershipScope = Depends(ownership_scope_from_request),
) -> dict[str, Any]:
    record = _record(import_id, db, ownership_scope)
    family = _family(import_id, family_id, db)
    try:
        with bounded_analysis_admission_sync(_analysis_sizes(record)):
            verify_family_mapping(
                db, record, family, mapping_spec=payload.mapping_spec, profile_name=payload.profile_name.strip()
            )
        db.commit()
        db.refresh(record)
        return session_payload(record)
    except AdaptiveImportError as exc:
        db.rollback()
        raise _http_error(exc) from exc
    except UploadLimitError as exc:
        db.rollback()
        raise _upload_error(exc) from exc
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail={"code": "PROFILE_VALIDATION_FAILED", "message": str(exc)}) from exc


@router.post("/api/adaptive-import/sessions/{import_id}/families/{family_id}/health")
def check_format_health(
    import_id: uuid.UUID, family_id: uuid.UUID,
    db: Session = Depends(get_db),
    ownership_scope: OwnershipScope = Depends(ownership_scope_from_request),
) -> dict[str, Any]:
    record = _record(import_id, db, ownership_scope)
    family = _family(import_id, family_id, db)
    try:
        with bounded_analysis_admission_sync(_analysis_sizes(record)):
            result = check_family_health(db, record, family)
        db.commit()
        return result
    except AdaptiveImportError as exc:
        db.rollback()
        raise _http_error(exc) from exc
    except UploadLimitError as exc:
        db.rollback()
        raise _upload_error(exc) from exc


@router.post("/api/adaptive-import/sessions/{import_id}/families/{family_id}/mapping/preview")
def preview_family_mapping_route(
    import_id: uuid.UUID,
    family_id: uuid.UUID,
    payload: FamilyMappingPreviewRequest,
    db: Session = Depends(get_db),
    ownership_scope: OwnershipScope = Depends(ownership_scope_from_request),
) -> dict[str, Any]:
    record = _record(import_id, db, ownership_scope)
    family = _family(import_id, family_id, db)
    try:
        with bounded_analysis_admission_sync(_analysis_sizes(record)):
            return preview_family_mapping(
                record,
                family,
                mapping_spec=payload.mapping_spec,
                profile_name=payload.profile_name.strip(),
                sample_group_id=payload.sample_group_id,
            )
    except AdaptiveImportError as exc:
        raise _http_error(exc) from exc
    except UploadLimitError as exc:
        raise _upload_error(exc) from exc


@router.post("/api/adaptive-import/sessions/{import_id}/families/{family_id}/profile")
def choose_family_profile(
    import_id: uuid.UUID,
    family_id: uuid.UUID,
    payload: ProfileSelectionRequest,
    db: Session = Depends(get_db),
    ownership_scope: OwnershipScope = Depends(ownership_scope_from_request),
) -> dict[str, Any]:
    record = _record(import_id, db, ownership_scope)
    family = _family(import_id, family_id, db)
    try:
        with bounded_analysis_admission_sync(_analysis_sizes(record)):
            select_profile_revision(db, record, family, payload.revision_id)
        db.commit()
        db.refresh(record)
        return session_payload(record)
    except AdaptiveImportError as exc:
        db.rollback()
        raise _http_error(exc) from exc
    except UploadLimitError as exc:
        db.rollback()
        raise _upload_error(exc) from exc


@router.get("/api/import-formats")
def get_import_formats(
    db: Session = Depends(get_db),
    ownership_scope: OwnershipScope = Depends(ownership_scope_from_request),
) -> list[dict[str, Any]]:
    return list_profiles(db, ownership_scope.owner_user_id)


@router.patch("/api/import-formats/{profile_id}")
def patch_import_format(
    profile_id: uuid.UUID,
    payload: ProfileUpdateRequest,
    db: Session = Depends(get_db),
    ownership_scope: OwnershipScope = Depends(ownership_scope_from_request),
) -> dict[str, Any]:
    profile = visible_profile(db, ownership_scope.owner_user_id, profile_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="Import profile not found.")
    values = payload.model_dump(exclude_none=True)
    try:
        update_profile(db, profile, values, owner_user_id=ownership_scope.owner_user_id)
        db.commit()
        db.refresh(profile)
        return next(
            item
            for item in list_profiles(db, ownership_scope.owner_user_id)
            if item.get("id") == str(profile.id)
        )
    except AdaptiveImportError as exc:
        db.rollback()
        raise _http_error(exc) from exc


@router.delete("/api/import-formats/{profile_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_import_format(
    profile_id: uuid.UUID,
    db: Session = Depends(get_db),
    ownership_scope: OwnershipScope = Depends(ownership_scope_from_request),
) -> None:
    profile = visible_profile(db, ownership_scope.owner_user_id, profile_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="Import profile not found.")
    if profile.kind != "LEARNED":
        raise HTTPException(status_code=409, detail={"code": "BUILTIN_READ_ONLY", "message": "Built-in import profiles cannot be deleted."})
    update_profile(db, profile, {"hidden": True}, owner_user_id=ownership_scope.owner_user_id)
    db.commit()


@router.get("/api/import-formats/{profile_id}/revisions")
def get_import_format_revisions(
    profile_id: uuid.UUID,
    db: Session = Depends(get_db),
    ownership_scope: OwnershipScope = Depends(ownership_scope_from_request),
) -> list[dict[str, Any]]:
    profile = visible_profile(db, ownership_scope.owner_user_id, profile_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="Import profile not found.")
    visible = [revision for candidate, revision in available_revisions(db, ownership_scope.owner_user_id, include_disabled=True) if candidate.id == profile.id]
    effective = max(visible, key=lambda revision: (revision.id == profile.current_revision_id, revision.created_at, revision.revision))
    seen = set()
    result = []
    for item in sorted(visible, key=lambda revision: (revision.id == effective.id, revision.created_at, revision.revision), reverse=True):
        digest = item.configuration_digest or str(item.id)
        if digest not in seen:
            seen.add(digest)
            result.append(revision_payload(item, current=item.id == effective.id))
    return result


class ProfilePublicationRequest(BaseModel):
    revision_id: uuid.UUID
    name: str = Field(min_length=1, max_length=200)


@router.get("/api/admin/import-formats")
def admin_import_formats(request: Request, limit: int = Query(30, ge=1, le=100), offset: int = Query(0, ge=0), db: Session = Depends(get_db)) -> dict:
    require_root_admin(request, db)
    query = db.query(ImportProfile).filter(ImportProfile.kind == "LEARNED", ~ImportProfile.id.in_(db.query(ImportProfileAlias.old_profile_id)))
    total = query.count()
    items = []
    for profile in query.order_by(ImportProfile.created_at.desc(), ImportProfile.id).offset(offset).limit(limit):
        publication = db.get(ImportProfilePublication, profile.id)
        revisions = db.query(ImportProfileRevision).filter(ImportProfileRevision.profile_id.in_(related_profile_ids(db, profile.id))).order_by(ImportProfileRevision.created_at.desc()).all()
        seen = set()
        unique = []
        for revision in revisions:
            digest = revision.configuration_digest or str(revision.id)
            if digest not in seen:
                seen.add(digest)
                unique.append(revision_payload(revision, current=revision.id == profile.current_revision_id))
        items.append({"id": str(profile.id), "name": publication.name if publication else f"{profile.source_mode} format",
            "source_mode": profile.source_mode, "source_account_available": profile.owner_user_id is not None,
            "published_revision_id": str(publication.revision_id) if publication and publication.withdrawn_at is None else None,
            "revisions": unique})
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.put("/api/admin/import-formats/{profile_id}/publication")
def publish_import_format(profile_id: uuid.UUID, payload: ProfilePublicationRequest, request: Request, db: Session = Depends(get_db)) -> dict:
    actor = require_root_admin(request, db)
    if not payload.name.strip():
        raise HTTPException(status_code=422, detail="Publication name is required.")
    try:
        publication = publish_revision(db, profile_id=profile_id, revision_id=payload.revision_id, actor_id=actor.id, name=payload.name.strip())
        record_admin_audit(db, actor_user_id=actor.id, action="IMPORT_FORMAT_PUBLISHED", resource_type="IMPORT_PROFILE", resource_id=publication.profile_id,
            metadata={"revision_id": str(publication.revision_id)}, request_id=request_id_from(request))
        db.commit()
        return {"profile_id": str(publication.profile_id), "revision_id": str(publication.revision_id), "published": True}
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.delete("/api/admin/import-formats/{profile_id}/publication", status_code=204)
def withdraw_import_format(profile_id: uuid.UUID, request: Request, db: Session = Depends(get_db)) -> None:
    from datetime import datetime, timezone
    actor = require_root_admin(request, db)
    canonical = canonical_profile_id(db, profile_id)
    db.query(ImportProfile).filter_by(id=canonical).with_for_update().first()
    publication = db.get(ImportProfilePublication, canonical)
    if publication and publication.withdrawn_at is None:
        publication.withdrawn_at = datetime.now(timezone.utc)
        record_admin_audit(db, actor_user_id=actor.id, action="IMPORT_FORMAT_WITHDRAWN", resource_type="IMPORT_PROFILE", resource_id=canonical, request_id=request_id_from(request))
    db.commit()



def _record(
    import_id: uuid.UUID,
    db: Session,
    ownership_scope: OwnershipScope,
) -> ImportRecord:
    record = get_owned(db, ImportRecord, import_id, ownership_scope)
    if record is None or record.source_profile != "adaptive_json_markdown":
        raise HTTPException(status_code=404, detail="Adaptive import session not found.")
    return record


def _analysis_sizes(record: ImportRecord) -> list[int]:
    """Return persisted source sizes for admission without reading file bodies."""
    return [max(0, int(artifact.byte_size or 0)) for artifact in record.artifacts]


def _family(import_id: uuid.UUID, family_id: uuid.UUID, db: Session) -> ImportStructureFamily:
    family = db.get(ImportStructureFamily, family_id)
    if family is None or family.import_id != import_id:
        raise HTTPException(status_code=404, detail="Structure family not found.")
    return family


def _artifact(import_id: uuid.UUID, artifact_id: uuid.UUID, db: Session) -> SourceArtifact:
    artifact = db.get(SourceArtifact, artifact_id)
    if artifact is None or artifact.import_id != import_id:
        raise HTTPException(status_code=404, detail="Source file not found.")
    return artifact


def _group(import_id: uuid.UUID, group_id: uuid.UUID, db: Session) -> ImportInputGroup:
    group = db.get(ImportInputGroup, group_id)
    if group is None or group.import_id != import_id:
        raise HTTPException(status_code=404, detail="Input group not found.")
    return group


def _http_error(exc: AdaptiveImportError) -> HTTPException:
    status_code = 413 if exc.code in {"FILE_TOO_LARGE", "SESSION_TOO_LARGE"} else 409 if exc.code in {
        "SESSION_STATE_INVALID",
        "SESSION_WOULD_BE_EMPTY",
        "GROUP_ARTIFACT_SHARED",
    } else 422
    return HTTPException(status_code=status_code, detail={"code": exc.code, "message": str(exc), "diagnostic": exc.diagnostic()})


def _upload_error(exc: UploadLimitError) -> HTTPException:
    return HTTPException(
        status_code=exc.status_code,
        detail={"code": exc.code, "message": str(exc)},
        headers={"Retry-After": "15"} if exc.status_code == 429 else None,
    )
