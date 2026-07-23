import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, Header, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.models.offline_package_artifact import OfflinePackageArtifact
from app.schemas.offline import OfflineCatalogResponse, OfflinePackageCreate, OfflinePackageQueued, OfflinePackageRead
from app.services.background_jobs import queue_offline_package
from app.services.offline_packages import OfflinePackageError, build_catalog

router = APIRouter(prefix="/api/offline", tags=["offline"])


@router.get("/catalog", response_model=OfflineCatalogResponse)
def get_offline_catalog(db: Session = Depends(get_db)) -> OfflineCatalogResponse:
    return build_catalog(db)


@router.post("/packages", response_model=OfflinePackageQueued, status_code=status.HTTP_202_ACCEPTED)
def create_offline_package(
    payload: OfflinePackageCreate,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
) -> OfflinePackageQueued:
    try:
        job = queue_offline_package(
            db,
            scope=payload.scope,
            conversation_id=payload.conversation_id,
            project_id=payload.project_id,
            idempotency_key=idempotency_key,
        )
        catalog = build_catalog(db)
        if payload.scope == "conversation":
            selected = next((item for item in catalog.conversations if item.id == payload.conversation_id), None)
            estimate = selected.estimated_bytes if selected else 0
        elif payload.scope == "project":
            selected_project = next((item for item in catalog.projects if item.id == payload.project_id), None)
            estimate = selected_project.estimated_bytes if selected_project else 0
        else:
            estimate = catalog.estimated_bytes
        db.commit()
        return OfflinePackageQueued(
            package_id=uuid.UUID(str(job.payload["package_id"])),
            job_id=job.id,
            status=job.status,
            scope=payload.scope,
            estimated_bytes=estimate,
            catalog_revision=catalog.revision,
        )
    except OfflinePackageError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("/packages/{package_id}", response_model=OfflinePackageRead)
def get_offline_package(package_id: uuid.UUID, db: Session = Depends(get_db)) -> OfflinePackageRead:
    package = db.get(OfflinePackageArtifact, package_id)
    if package is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Offline package not found.")
    return OfflinePackageRead(
        id=package.id,
        job_id=package.job_id,
        scope=package.scope_type,
        scope_id=package.scope_id,
        catalog_revision=package.catalog_revision,
        filename=package.filename,
        sha256=package.sha256,
        byte_size=package.byte_size,
        conversation_count=package.conversation_count,
        created_at=package.created_at,
    )


@router.get("/packages/{package_id}/download")
def download_offline_package(package_id: uuid.UUID, db: Session = Depends(get_db)) -> FileResponse:
    package = db.get(OfflinePackageArtifact, package_id)
    if package is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Offline package not found.")
    root = Path(get_settings().offline_storage_dir).resolve()
    path = Path(package.storage_uri).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Offline package file is missing.")
    package.download_count += 1
    db.commit()
    return FileResponse(path, media_type="application/zip", filename=package.filename)
