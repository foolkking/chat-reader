import uuid
from pathlib import Path

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Request, Response, status
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy.orm import sessionmaker
from pydantic import BaseModel

from app.core.config import get_settings
from app.core.database import get_db
from app.models.conversation import Conversation
from app.schemas.task import BackgroundTaskRead
from app.schemas.export import ExportRequest, ConversationBatchExportRequest
from app.services.background_jobs import queue_conversation_auto_clean, queue_conversation_derived_rebuild, queue_conversation_export
from app.services.editing.message_edit_service import MessageEditError
from app.api.routes.tasks import background_job_read
from app.services.exporting.cr_archive import ARCHIVE_MIME
from app.services.exporting.attachment_bundle import BUNDLE_MIME, CANJSON_BUNDLE_FORMAT, MARKDOWN_BUNDLE_FORMAT
from app.services.exporting.context_package import CONTEXT_PACKAGE_FORMAT, CONTEXT_PACKAGE_MIME
from app.services.artifact_lifecycle import validate_final_artifact
from app.services.export_retention import owned_export, require_available, artifact_status, acquire_viewer, release_viewer, acquire_download, claim_download, regenerate_export
from app.services.export_download import ExportFileResponse
from app.services.ownership import OwnershipScope, get_owned, ownership_scope_from_request
from app.services.exporting.export_service import ExportError
from app.api.routes.exports import direct_export_response


router = APIRouter(tags=["exports"])


@router.post("/api/conversations/batch-export", response_model=BackgroundTaskRead, status_code=202)
def queue_batch_export(
    payload: ConversationBatchExportRequest,
    request: Request,
    idempotency_key: str = Header(alias="Idempotency-Key", min_length=1, max_length=200),
    db: Session = Depends(get_db),
) -> BackgroundTaskRead:
    from app.services.exporting.conversation_batch import queue_conversation_batch_export
    try:
        job = queue_conversation_batch_export(db, conversation_ids=payload.conversation_ids,
            idempotency_key=idempotency_key, ownership_scope=ownership_scope_from_request(request))
        db.commit()
    except ExportError as error:
        db.rollback()
        raise HTTPException(error.status_code, str(error)) from error
    return background_job_read(job)


@router.post(
    "/api/conversations/{conversation_id}/exports",
    response_model=None,
    status_code=status.HTTP_202_ACCEPTED,
)
def queue_archive_export(
    conversation_id: uuid.UUID,
    request: Request,
    payload: ExportRequest | None = Body(default=None),
    include_description: bool = False,
    include_annotations: bool = False,
    include_notebook: bool = False,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
) -> BackgroundTaskRead | StreamingResponse:
    ownership_scope = ownership_scope_from_request(request)
    if get_owned(db, Conversation, conversation_id, ownership_scope) is None:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    if payload is not None and payload.format in {"markdown_v2", "canjson_v2"}:
        try:
            options = payload.to_options()
            return direct_export_response(db, conversation_id, options)
        except ExportError as exc:
            db.rollback()
            raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    try:
        if payload is not None:
            include_description = payload.include_description
            include_annotations = payload.annotation_scope == "all"
            include_notebook = payload.notebook_scope == "current"
        job = queue_conversation_export(
            db,
            conversation_id=conversation_id,
            idempotency_key=idempotency_key,
            include_description=include_description,
            include_annotations=include_annotations,
            include_notebook=include_notebook,
            include_metadata=payload.include_metadata if payload is not None else True,
            include_source_refs=payload.include_source_refs if payload is not None else True,
            export_format=payload.format if payload is not None else "cr_v2",
            context_scope=payload.context_scope if payload is not None else "full_conversation",
            context_attachment_policy=payload.context_attachment_policy if payload is not None else "include",
            continuation_policy=payload.continuation_policy if payload is not None else "auto",
            start_message_id=payload.start_message_id if payload is not None else None,
            ownership_scope=ownership_scope,
        )
        db.commit()
    except MessageEditError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    return background_job_read(job)


@router.post(
    "/api/conversations/{conversation_id}/auto-clean",
    response_model=BackgroundTaskRead,
    status_code=status.HTTP_202_ACCEPTED,
)
def queue_archive_auto_clean(
    conversation_id: uuid.UUID,
    request: Request,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
) -> BackgroundTaskRead:
    try:
        job = queue_conversation_auto_clean(
            db,
            conversation_id=conversation_id,
            idempotency_key=idempotency_key,
            ownership_scope=ownership_scope_from_request(request),
        )
        db.commit()
    except MessageEditError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    return background_job_read(job)


@router.post(
    "/api/conversations/{conversation_id}/derived-rebuild",
    response_model=BackgroundTaskRead,
    status_code=status.HTTP_202_ACCEPTED,
)
def queue_derived_rebuild(
    conversation_id: uuid.UUID,
    request: Request,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
) -> BackgroundTaskRead:
    try:
        job = queue_conversation_derived_rebuild(
            db,
            conversation_id=conversation_id,
            idempotency_key=idempotency_key,
            ownership_scope=ownership_scope_from_request(request),
        )
        db.commit()
    except MessageEditError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    return background_job_read(job)


@router.get("/api/exports/{artifact_id}/download")
def download_archive(
    artifact_id: uuid.UUID,
    request: Request,
    claim: uuid.UUID | None = None,
    db: Session = Depends(get_db),
    ownership_scope: OwnershipScope = Depends(ownership_scope_from_request),
) -> FileResponse:
    artifact = owned_export(db, artifact_id, ownership_scope, lock=True)
    require_available(artifact)
    export_root = Path(get_settings().export_storage_dir).resolve()
    path = Path(artifact.storage_uri).resolve()
    if not path.is_relative_to(export_root) or not validate_final_artifact(path, expected_size=artifact.byte_size):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Export file is missing.")
    lease_id = acquire_download(db, artifact, claim_id=claim)
    factory = sessionmaker(bind=db.get_bind(), autoflush=False)
    db.commit()
    media_type = (
        CONTEXT_PACKAGE_MIME
        if artifact.format == CONTEXT_PACKAGE_FORMAT
        else BUNDLE_MIME
        if artifact.format in {MARKDOWN_BUNDLE_FORMAT, CANJSON_BUNDLE_FORMAT, "attachment-batch-zip", "chat-reader-conversation-batch"}
        else ARCHIVE_MIME
    )
    return ExportFileResponse(path, media_type=media_type, filename=artifact.filename,
                              headers={"Cache-Control": "private, no-store"},
                              session_factory=factory, artifact_id=artifact.id, lease_id=lease_id)


class ExportUsage(BaseModel):
    session_id: uuid.UUID


@router.post("/api/exports/{artifact_id}/download-claims")
def reserve_download(artifact_id: uuid.UUID, payload: ExportUsage, db: Session = Depends(get_db),
                     ownership_scope: OwnershipScope = Depends(ownership_scope_from_request)):
    artifact = owned_export(db, artifact_id, ownership_scope, lock=True)
    lease_id = claim_download(db, artifact, payload.session_id)
    db.commit()
    return {"download_url": f"/api/exports/{artifact.id}/download?claim={lease_id}"}


@router.get("/api/exports/{artifact_id}")
def read_export_status(artifact_id: uuid.UUID, response: Response, db: Session = Depends(get_db),
                       ownership_scope: OwnershipScope = Depends(ownership_scope_from_request)):
    response.headers["Cache-Control"] = "private, no-store"
    return artifact_status(owned_export(db, artifact_id, ownership_scope))


@router.post("/api/exports/{artifact_id}/usage")
def use_export(artifact_id: uuid.UUID, payload: ExportUsage, db: Session = Depends(get_db),
               ownership_scope: OwnershipScope = Depends(ownership_scope_from_request)):
    artifact = owned_export(db, artifact_id, ownership_scope, lock=True)
    acquire_viewer(db, artifact, payload.session_id)
    result = artifact_status(artifact)
    db.commit()
    return result


@router.post("/api/exports/{artifact_id}/release")
def close_export(artifact_id: uuid.UUID, payload: ExportUsage, db: Session = Depends(get_db),
                 ownership_scope: OwnershipScope = Depends(ownership_scope_from_request)):
    artifact = owned_export(db, artifact_id, ownership_scope, lock=True)
    release_viewer(db, artifact, payload.session_id)
    result = artifact_status(artifact)
    db.commit()
    return result


@router.post("/api/exports/{artifact_id}/regenerate", response_model=BackgroundTaskRead, status_code=202)
def regenerate_archive(artifact_id: uuid.UUID, request: Request, db: Session = Depends(get_db),
                       key: str = Header(alias="Idempotency-Key", min_length=1, max_length=100),
                       ownership_scope: OwnershipScope = Depends(ownership_scope_from_request)):
    if not key.isascii():
        raise HTTPException(422, "Invalid request key.")
    artifact = owned_export(db, artifact_id, ownership_scope, lock=True)
    from app.models.background_job import BackgroundJob
    if db.get(BackgroundJob, artifact.job_id).job_type == "system_archive_export":
        from app.services.administration import require_root_admin
        require_root_admin(request, db)
    try:
        job = regenerate_export(db, artifact, ownership_scope, key)
        db.commit()
    except (MessageEditError, ValueError) as exc:
        db.rollback()
        raise HTTPException(getattr(exc, "status_code", 422), "Export sources changed or are unavailable. Review the original selection.") from exc
    return background_job_read(job)
