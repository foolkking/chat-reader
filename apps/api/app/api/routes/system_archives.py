import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Header, HTTPException, Request, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.routes.tasks import background_job_read
from app.core.config import get_settings
from app.core.database import get_db
from app.schemas.task import BackgroundTaskRead
from app.services.background_jobs import queue_system_archive_export
from app.services.exporting.system_archive import SystemArchiveError, restore_system_archive
from app.services.ownership import ownership_scope_from_request
from app.api.routes.admin_access import _admin


router = APIRouter(prefix="/api/system/archive", tags=["system-archive"])


class SystemArchiveExportRequest(BaseModel):
    include_archived: bool = True


class SystemArchiveRestoreResponse(BaseModel):
    status: str
    restored: dict[str, int]


@router.post("/exports", response_model=BackgroundTaskRead, status_code=status.HTTP_202_ACCEPTED)
def queue_system_archive(
    payload: SystemArchiveExportRequest,
    request: Request,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
) -> BackgroundTaskRead:
    _require_admin_if_enabled(request, db)
    job = queue_system_archive_export(
        db,
        include_archived=payload.include_archived,
        idempotency_key=idempotency_key,
        ownership_scope=ownership_scope_from_request(request),
    )
    db.commit()
    return background_job_read(job)


@router.post("/restore", response_model=SystemArchiveRestoreResponse)
def restore_system_archive_route(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> SystemArchiveRestoreResponse:
    _require_admin_if_enabled(request, db)
    import_root = Path(get_settings().import_storage_dir).resolve()
    temp_dir = (import_root / "system-restore-temp").resolve()
    if not temp_dir.is_relative_to(import_root):
        raise HTTPException(status_code=500, detail="Invalid restore storage path.")
    temp_dir.mkdir(parents=True, exist_ok=True)
    path = temp_dir / f"{uuid.uuid4()}.cr.part"
    try:
        with path.open("xb") as destination:
            written = 0
            while chunk := file.file.read(1024 * 1024):
                written += len(chunk)
                if written > get_settings().bundle_max_compressed_bytes:
                    raise HTTPException(status_code=413, detail="System archive exceeds the upload size limit.")
                destination.write(chunk)
        restored = restore_system_archive(db, path)
        db.commit()
        return SystemArchiveRestoreResponse(status="restored", restored=restored)
    except SystemArchiveError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except Exception:
        db.rollback()
        raise
    finally:
        path.unlink(missing_ok=True)


def _require_admin_if_enabled(request: Request, db: Session) -> None:
    """Keep the pre-auth test/development mode while enforcing ADMIN in production."""
    if get_settings().auth_enabled:
        _admin(request, db)
