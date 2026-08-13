import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Body, Depends, Header, HTTPException, status
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.models.export_artifact import ExportArtifact
from app.models.background_job import BackgroundJob
from app.schemas.task import BackgroundTaskRead
from app.schemas.export import ExportRequest
from app.services.background_jobs import queue_conversation_auto_clean, queue_conversation_derived_rebuild, queue_conversation_export
from app.services.editing.message_edit_service import MessageEditError
from app.api.routes.tasks import background_job_read
from app.services.exporting.cr_archive import ARCHIVE_MIME
from app.services.exporting.attachment_bundle import BUNDLE_MIME, CANJSON_BUNDLE_FORMAT, MARKDOWN_BUNDLE_FORMAT
from app.services.exporting.context_package import CONTEXT_PACKAGE_FORMAT, CONTEXT_PACKAGE_MIME
from app.services.artifact_lifecycle import validate_final_artifact
from app.services.exporting.export_service import (
    ExportError,
    content_disposition,
    export_conversation_canjson_v2,
    export_conversation_markdown_v2,
)

router = APIRouter(tags=["exports"])


@router.post(
    "/api/conversations/{conversation_id}/exports",
    response_model=None,
    status_code=status.HTTP_202_ACCEPTED,
)
def queue_archive_export(
    conversation_id: uuid.UUID,
    payload: ExportRequest | None = Body(default=None),
    include_description: bool = False,
    include_annotations: bool = False,
    include_notebook: bool = False,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
) -> BackgroundTaskRead | StreamingResponse:
    if payload is not None and payload.format in {"markdown_v2", "canjson_v2"}:
        try:
            options = payload.to_options()
            result = (
                export_conversation_markdown_v2(db, conversation_id, options)
                if payload.format == "markdown_v2"
                else export_conversation_canjson_v2(db, conversation_id, options)
            )
            db.commit()
            return StreamingResponse(
                result.content,
                media_type=result.media_type,
                headers={"Content-Disposition": content_disposition(result.filename)},
                status_code=status.HTTP_200_OK,
            )
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
            start_message_id=payload.start_message_id if payload is not None else None,
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
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
) -> BackgroundTaskRead:
    try:
        job = queue_conversation_auto_clean(
            db,
            conversation_id=conversation_id,
            idempotency_key=idempotency_key,
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
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
) -> BackgroundTaskRead:
    try:
        job = queue_conversation_derived_rebuild(
            db,
            conversation_id=conversation_id,
            idempotency_key=idempotency_key,
        )
        db.commit()
    except MessageEditError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    return background_job_read(job)


@router.get("/api/exports/{artifact_id}/download")
def download_archive(artifact_id: uuid.UUID, db: Session = Depends(get_db)) -> FileResponse:
    artifact = db.get(ExportArtifact, artifact_id)
    if artifact is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Export not found.")
    job = db.get(BackgroundJob, artifact.job_id)
    if job is None or job.status != "committed":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Export artifact is not ready.")
    expires_at = artifact.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Export has expired.")
    export_root = Path(get_settings().export_storage_dir).resolve()
    path = Path(artifact.storage_uri).resolve()
    if not path.is_relative_to(export_root) or not validate_final_artifact(path, expected_sha256=artifact.sha256, expected_size=artifact.byte_size):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Export file is missing.")
    artifact.download_count += 1
    db.commit()
    media_type = (
        CONTEXT_PACKAGE_MIME
        if artifact.format == CONTEXT_PACKAGE_FORMAT
        else BUNDLE_MIME
        if artifact.format in {MARKDOWN_BUNDLE_FORMAT, CANJSON_BUNDLE_FORMAT, "attachment-batch-zip"}
        else ARCHIVE_MIME
    )
    return FileResponse(path, media_type=media_type, filename=artifact.filename)
