import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.models.import_record import ImportRecord
from app.models.source_artifact import SourceArtifact
from app.schemas.import_schema import (
    ImportPreviewFile,
    ImportPreviewResponse,
    ImportWarningsResponse,
    SourceArtifactRead,
)
from app.services.import_pipeline.source_detector import detect_source_profile
from app.services.storage.local_storage import save_import_file

router = APIRouter(prefix="/api/imports", tags=["imports"])

ALLOWED_EXTENSIONS = {".json", ".md", ".markdown", ".txt", ".csv"}


@router.post("/preview", response_model=ImportPreviewResponse)
async def preview_import(
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
) -> ImportPreviewResponse:
    if not files:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="At least one file is required.")

    settings = get_settings()
    max_bytes = settings.max_import_file_size_mb * 1024 * 1024
    import_id = uuid.uuid4()
    preview_files: list[ImportPreviewFile] = []
    import_warnings: list[str] = []
    total_bytes = 0
    source_profiles: list[str] = []

    try:
        for upload in files:
            content = await upload.read()
            filename = upload.filename or "upload"
            extension = _extension(filename)

            if extension not in ALLOWED_EXTENSIONS:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Unsupported file extension: {extension or '(none)'}",
                )
            if not content:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty.")
            if len(content) > max_bytes:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail=f"File exceeds {settings.max_import_file_size_mb}MB limit.",
                )

            detection = detect_source_profile(filename, content)
            stored_file = save_import_file(import_id, filename, content)
            artifact = SourceArtifact(
                id=uuid.uuid4(),
                import_id=import_id,
                source_type=detection.source_profile.value,
                source_profile=detection.source_profile.value,
                filename=filename,
                safe_filename=stored_file.safe_filename,
                sha256=detection.sha256,
                byte_size=detection.size_bytes,
                mime_guess=detection.mime_guess,
                file_extension=detection.file_extension,
                raw_storage_uri=stored_file.raw_storage_uri,
                parsed_summary={},
            )
            db.add(artifact)

            preview_files.append(
                ImportPreviewFile(
                    artifact_id=artifact.id,
                    filename=filename,
                    source_profile=detection.source_profile,
                    confidence=detection.confidence,
                    sha256=detection.sha256,
                    byte_size=detection.size_bytes,
                    mime_guess=detection.mime_guess,
                    file_extension=detection.file_extension,
                    raw_storage_uri=stored_file.raw_storage_uri,
                    warnings=detection.warnings,
                )
            )
            import_warnings.extend(detection.warnings)
            total_bytes += detection.size_bytes
            source_profiles.append(detection.source_profile.value)

        import_record = ImportRecord(
            id=import_id,
            source_profile=_combined_source_profile(source_profiles),
            source_fingerprint=_combined_source_fingerprint(preview_files),
            status="previewed",
            alignment_status="not_applicable",
            warnings=import_warnings,
            file_count=len(preview_files),
            total_bytes=total_bytes,
            json_filename=_first_filename_for_extension(preview_files, ".json"),
            md_filename=_first_filename_for_extension(preview_files, ".md")
            or _first_filename_for_extension(preview_files, ".markdown"),
            csv_filename=_first_filename_for_extension(preview_files, ".csv"),
        )
        db.add(import_record)
        db.commit()

    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Import preview could not be saved.",
        ) from exc

    return ImportPreviewResponse(
        import_id=import_id,
        status="previewed",
        files=preview_files,
        warnings=import_warnings,
    )


@router.get("/{import_id}/source-artifacts", response_model=list[SourceArtifactRead])
def list_source_artifacts(import_id: uuid.UUID, db: Session = Depends(get_db)) -> list[SourceArtifactRead]:
    _get_import_or_404(import_id, db)
    artifacts = (
        db.query(SourceArtifact)
        .filter(SourceArtifact.import_id == import_id)
        .order_by(SourceArtifact.created_at.asc())
        .all()
    )
    return [
        SourceArtifactRead(
            artifact_id=artifact.id,
            import_id=artifact.import_id,
            filename=artifact.filename,
            safe_filename=artifact.safe_filename,
            source_profile=artifact.source_profile,
            source_type=artifact.source_type,
            sha256=artifact.sha256,
            byte_size=artifact.byte_size,
            mime_guess=artifact.mime_guess,
            file_extension=artifact.file_extension,
            raw_storage_uri=artifact.raw_storage_uri,
        )
        for artifact in artifacts
    ]


@router.get("/{import_id}/warnings", response_model=ImportWarningsResponse)
def get_import_warnings(import_id: uuid.UUID, db: Session = Depends(get_db)) -> ImportWarningsResponse:
    import_record = _get_import_or_404(import_id, db)
    return ImportWarningsResponse(import_id=import_record.id, warnings=import_record.warnings)


def _get_import_or_404(import_id: uuid.UUID, db: Session) -> ImportRecord:
    import_record = db.get(ImportRecord, import_id)
    if import_record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Import record not found.")
    return import_record


def _extension(filename: str) -> str:
    if "." not in filename:
        return ""
    return "." + filename.rsplit(".", 1)[-1].lower()


def _combined_source_profile(source_profiles: list[str]) -> str:
    if not source_profiles:
        return "unknown"
    unique_profiles = set(source_profiles)
    if len(unique_profiles) == 1:
        return source_profiles[0]
    return "mixed"


def _combined_source_fingerprint(files: list[ImportPreviewFile]) -> str:
    return ",".join(sorted(file.sha256 for file in files))


def _first_filename_for_extension(files: list[ImportPreviewFile], extension: str) -> str | None:
    for file in files:
        if file.file_extension == extension:
            return file.filename
    return None
