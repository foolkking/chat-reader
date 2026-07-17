import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, Header, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.models.export_artifact import ExportArtifact
from app.schemas.task import BackgroundTaskRead
from app.services.background_jobs import queue_conversation_auto_clean, queue_conversation_export
from app.services.editing.message_edit_service import MessageEditError
from app.api.routes.tasks import background_job_read
from app.services.exporting.cr_archive import ARCHIVE_MIME

router = APIRouter(tags=["exports"])


@router.post(
    "/api/conversations/{conversation_id}/exports",
    response_model=BackgroundTaskRead,
    status_code=status.HTTP_202_ACCEPTED,
)
def queue_archive_export(
    conversation_id: uuid.UUID,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
) -> BackgroundTaskRead:
    try:
        job = queue_conversation_export(
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


@router.get("/api/exports/{artifact_id}/download")
def download_archive(artifact_id: uuid.UUID, db: Session = Depends(get_db)) -> FileResponse:
    artifact = db.get(ExportArtifact, artifact_id)
    if artifact is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Export not found.")
    expires_at = artifact.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Export has expired.")
    export_root = Path(get_settings().export_storage_dir).resolve()
    path = Path(artifact.storage_uri).resolve()
    if not path.is_relative_to(export_root) or not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Export file is missing.")
    artifact.download_count += 1
    db.commit()
    return FileResponse(path, media_type=ARCHIVE_MIME, filename=artifact.filename)
