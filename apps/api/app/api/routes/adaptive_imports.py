from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.models.import_profile import ImportInputGroup, ImportProfile, ImportProfileRevision, ImportStructureFamily
from app.models.import_record import ImportRecord
from app.models.source_artifact import SourceArtifact
from app.services.adaptive_import.contracts import AdaptiveImportError
from app.services.adaptive_import.service import (
    MAX_ADAPTIVE_FILES,
    add_session_source,
    begin_session,
    cancel_session,
    finalize_session,
    list_profiles,
    preview_family_mapping,
    reanalyze_session,
    remove_input_group,
    remove_source_paths,
    remove_session_files,
    replace_session_artifact,
    resolve_grouping,
    select_profile_revision,
    session_payload,
    update_profile,
    verify_family_mapping,
)
from app.services.ownership import OwnershipScope, get_owned, ownership_scope_from_request
from app.services.feature_policies import effective_import_size_mb, get_feature_policy

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


@router.post("/api/adaptive-import/sessions", status_code=status.HTTP_201_CREATED)
async def create_adaptive_import_session(
    files: list[UploadFile] = File(...),
    repair_profile_id: uuid.UUID | None = Form(default=None),
    db: Session = Depends(get_db),
    ownership_scope: OwnershipScope = Depends(ownership_scope_from_request),
) -> dict[str, Any]:
    if not files:
        raise HTTPException(status_code=400, detail={"code": "FILES_REQUIRED", "message": "Choose at least one JSON or Markdown file."})
    if len(files) > MAX_ADAPTIVE_FILES:
        raise HTTPException(status_code=422, detail={"code": "FILE_COUNT_LIMIT", "message": f"At most {MAX_ADAPTIVE_FILES} files can be analyzed at once."})
    if not get_feature_policy(db).allow_user_import:
        raise HTTPException(status_code=403, detail={"code": "IMPORT_DISABLED", "message": "User import is disabled by the system administrator."})
    max_bytes = effective_import_size_mb(db) * 1024 * 1024
    record: ImportRecord | None = None
    try:
        record = begin_session(
            db,
            len(files),
            repair_profile_id=repair_profile_id,
            owner_user_id=ownership_scope.owner_user_id,
        )
        for item in files:
            content = await _read_upload_bounded(item, max_bytes)
            add_session_source(db, record, item.filename or "upload", content)
        record = finalize_session(db, record)
        return session_payload(record)
    except AdaptiveImportError as exc:
        db.rollback()
        if record is not None:
            _remove_failed_session(record.id)
        raise _http_error(exc) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        if record is not None:
            _remove_failed_session(record.id)
        raise HTTPException(status_code=500, detail={"code": "SESSION_PERSISTENCE_FAILED", "message": "Import analysis could not be saved."}) from exc
    except Exception as exc:
        db.rollback()
        if record is not None:
            _remove_failed_session(record.id)
        raise HTTPException(status_code=500, detail={"code": "SESSION_ANALYSIS_FAILED", "message": "Import analysis failed safely."}) from exc


async def _read_upload_bounded(upload: UploadFile, max_bytes: int) -> bytes:
    content = bytearray()
    while True:
        chunk = await upload.read(min(1024 * 1024, max_bytes + 1 - len(content)))
        if not chunk:
            return bytes(content)
        content.extend(chunk)
        if len(content) > max_bytes:
            raise AdaptiveImportError("FILE_TOO_LARGE", f"{upload.filename or 'upload'} exceeds the configured per-file limit.", layer="file")


def _remove_failed_session(import_id: uuid.UUID) -> None:
    remove_session_files(import_id)


@router.get("/api/adaptive-import/sessions/{import_id}")
def get_adaptive_import_session(
    import_id: uuid.UUID,
    db: Session = Depends(get_db),
    ownership_scope: OwnershipScope = Depends(ownership_scope_from_request),
) -> dict[str, Any]:
    record = _record(import_id, db, ownership_scope)
    return session_payload(record)


@router.delete("/api/adaptive-import/sessions/{import_id}", status_code=status.HTTP_204_NO_CONTENT)
def cancel_adaptive_import_session(
    import_id: uuid.UUID,
    db: Session = Depends(get_db),
    ownership_scope: OwnershipScope = Depends(ownership_scope_from_request),
) -> None:
    record = _record(import_id, db, ownership_scope)
    try:
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
        resolve_grouping(db, record, [item.model_dump(mode="json") for item in payload.groups])
        db.commit()
        db.refresh(record)
        return session_payload(record)
    except AdaptiveImportError as exc:
        db.rollback()
        raise _http_error(exc) from exc


@router.post("/api/adaptive-import/sessions/{import_id}/reanalyze")
def reanalyze_adaptive_import_session(
    import_id: uuid.UUID,
    db: Session = Depends(get_db),
    ownership_scope: OwnershipScope = Depends(ownership_scope_from_request),
) -> dict[str, Any]:
    record = _record(import_id, db, ownership_scope)
    try:
        reanalyze_session(db, record)
        db.commit()
        db.refresh(record)
        return session_payload(record)
    except AdaptiveImportError as exc:
        db.rollback()
        raise _http_error(exc) from exc


@router.put("/api/adaptive-import/sessions/{import_id}/artifacts/{artifact_id}")
async def replace_adaptive_import_artifact(
    import_id: uuid.UUID,
    artifact_id: uuid.UUID,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    ownership_scope: OwnershipScope = Depends(ownership_scope_from_request),
) -> dict[str, Any]:
    record = _record(import_id, db, ownership_scope)
    artifact = _artifact(import_id, artifact_id, db)
    new_path = None
    try:
        max_bytes = effective_import_size_mb(db) * 1024 * 1024
        content = await _read_upload_bounded(file, max_bytes)
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
        removed_paths = remove_input_group(db, record, group)
        db.commit()
        db.refresh(record)
        remove_source_paths(removed_paths)
        return session_payload(record)
    except AdaptiveImportError as exc:
        db.rollback()
        raise _http_error(exc) from exc


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
        verify_family_mapping(
            db, record, family, mapping_spec=payload.mapping_spec, profile_name=payload.profile_name.strip()
        )
        db.commit()
        db.refresh(record)
        return session_payload(record)
    except AdaptiveImportError as exc:
        db.rollback()
        raise _http_error(exc) from exc
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail={"code": "PROFILE_VALIDATION_FAILED", "message": str(exc)}) from exc


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
        return preview_family_mapping(
            record,
            family,
            mapping_spec=payload.mapping_spec,
            profile_name=payload.profile_name.strip(),
            sample_group_id=payload.sample_group_id,
        )
    except AdaptiveImportError as exc:
        raise _http_error(exc) from exc


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
        select_profile_revision(db, record, family, payload.revision_id)
        db.commit()
        db.refresh(record)
        return session_payload(record)
    except AdaptiveImportError as exc:
        db.rollback()
        raise _http_error(exc) from exc


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
    profile = get_owned(db, ImportProfile, profile_id, ownership_scope)
    if profile is None:
        raise HTTPException(status_code=404, detail="Import profile not found.")
    values = payload.model_dump(exclude_none=True)
    try:
        update_profile(db, profile, values)
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
    profile = get_owned(db, ImportProfile, profile_id, ownership_scope)
    if profile is None:
        raise HTTPException(status_code=404, detail="Import profile not found.")
    if profile.kind != "LEARNED":
        raise HTTPException(status_code=409, detail={"code": "BUILTIN_READ_ONLY", "message": "Built-in import profiles cannot be deleted."})
    db.delete(profile)
    db.commit()


@router.get("/api/import-formats/{profile_id}/revisions")
def get_import_format_revisions(
    profile_id: uuid.UUID,
    db: Session = Depends(get_db),
    ownership_scope: OwnershipScope = Depends(ownership_scope_from_request),
) -> list[dict[str, Any]]:
    profile = get_owned(db, ImportProfile, profile_id, ownership_scope)
    if profile is None:
        raise HTTPException(status_code=404, detail="Import profile not found.")
    return [
        {
            "id": str(item.id), "revision": item.revision, "status": item.status,
            "mapping_spec": item.mapping_spec, "validation_spec": item.validation_spec,
            "verification_summary": item.verification_summary, "created_at": item.created_at,
            "verified_at": item.verified_at, "current": item.id == profile.current_revision_id,
        }
        for item in sorted(profile.revisions, key=lambda revision: revision.revision, reverse=True)
    ]


def _record(
    import_id: uuid.UUID,
    db: Session,
    ownership_scope: OwnershipScope,
) -> ImportRecord:
    record = get_owned(db, ImportRecord, import_id, ownership_scope)
    if record is None or record.source_profile != "adaptive_json_markdown":
        raise HTTPException(status_code=404, detail="Adaptive import session not found.")
    return record


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
