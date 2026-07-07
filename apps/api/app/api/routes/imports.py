import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.models.import_record import ImportRecord
from app.models.source_artifact import SourceArtifact
from app.schemas.import_schema import (
    ConversationPreview,
    ImportPreviewFile,
    ImportPreviewResponse,
    ImportWarningsResponse,
    MessagePreview,
    SourceDetectionResult,
    SourceArtifactRead,
    SourceProfile,
)
from app.schemas.canonical import CommitImportResponse
from app.services.canonical.persistence import CommitImportError, commit_import_preview
from app.services.import_pipeline.canonical_draft import preview_text
from app.services.import_pipeline.exporter_aligner import align_exporter_sources
from app.services.import_pipeline.exporter_json_parser import ExporterJsonParseError, parse_exporter_json
from app.services.import_pipeline.exporter_markdown_parser import parse_exporter_markdown
from app.services.import_pipeline.official_json_parser import OfficialJsonParseError, parse_official_json
from app.services.import_pipeline.official_normalizer import build_official_conversation_preview
from app.services.import_pipeline.source_detector import detect_source_profile
from app.services.storage.local_storage import save_import_file

router = APIRouter(prefix="/api/imports", tags=["imports"])

ALLOWED_EXTENSIONS = {".json", ".md", ".markdown", ".txt", ".csv"}
PREVIEW_MESSAGE_LIMIT = 20
PREVIEW_CONVERSATION_LIMIT = 20


UploadedPreviewFile = tuple[str, bytes, SourceDetectionResult]


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
    uploaded_files: list[UploadedPreviewFile] = []
    conversation_preview: ConversationPreview | None = None
    conversation_previews: list[ConversationPreview] = []

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
            uploaded_files.append((filename, content, detection))
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

        conversation_preview = _build_exporter_conversation_preview(uploaded_files)
        if conversation_preview is None:
            conversation_previews = _build_official_conversation_previews(uploaded_files, import_warnings)
            conversation_preview = conversation_previews[0] if conversation_previews else None
        if conversation_preview is not None:
            import_warnings.extend(conversation_preview.warnings)
            source_profiles = [conversation_preview.source_profile]

        import_record = ImportRecord(
            id=import_id,
            source_profile=_combined_source_profile(source_profiles),
            source_fingerprint=_combined_source_fingerprint(preview_files),
            status="previewed",
            alignment_status=conversation_preview.alignment_status if conversation_preview else "not_applicable",
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
        conversation_preview=conversation_preview,
        conversation_previews=conversation_previews,
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


@router.post("/{import_id}/commit", response_model=CommitImportResponse)
def commit_import(import_id: uuid.UUID, db: Session = Depends(get_db)) -> CommitImportResponse:
    try:
        result = commit_import_preview(import_id, db)
    except CommitImportError as exc:
        message = str(exc)
        status_code = status.HTTP_404_NOT_FOUND if "not found" in message.lower() else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=status_code, detail=message) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Import commit could not be saved.",
        ) from exc
    return CommitImportResponse(
        import_id=result.import_id,
        status=result.status,
        conversation_ids=result.conversation_ids,
        conversation_count=result.conversation_count,
        message_count=result.message_count,
        warnings=result.warnings,
    )


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
    if unique_profiles == {"chatgpt_exporter_json", "chatgpt_exporter_markdown"}:
        return "chatgpt_exporter_combo"
    return "mixed"


def _combined_source_fingerprint(files: list[ImportPreviewFile]) -> str:
    return ",".join(sorted(file.sha256 for file in files))


def _first_filename_for_extension(files: list[ImportPreviewFile], extension: str) -> str | None:
    for file in files:
        if file.file_extension == extension:
            return file.filename
    return None


def _build_exporter_conversation_preview(files: list[UploadedPreviewFile]) -> ConversationPreview | None:
    exporter_json = next(
        ((filename, content) for filename, content, detection in files if detection.source_profile == SourceProfile.chatgpt_exporter_json),
        None,
    )
    exporter_markdown = next(
        (
            (filename, content)
            for filename, content, detection in files
            if detection.source_profile == SourceProfile.chatgpt_exporter_markdown
        ),
        None,
    )

    if exporter_json is None and exporter_markdown is None:
        return None

    warnings: list[str] = []
    json_result = None
    markdown_result = None

    if exporter_json is not None:
        try:
            json_result = parse_exporter_json(exporter_json[1])
        except ExporterJsonParseError as exc:
            warnings.append(f"{exporter_json[0]} could not be parsed as ChatGPT Exporter JSON: {exc}")

    if exporter_markdown is not None:
        markdown_result = parse_exporter_markdown(exporter_markdown[1])

    alignment = align_exporter_sources(json_result, markdown_result)
    if alignment.conversation is None:
        return None

    conversation = alignment.conversation
    combined_warnings = warnings + conversation.warnings
    return ConversationPreview(
        title=conversation.title,
        source_type=conversation.source_type,
        source_profile=conversation.source_profile,
        alignment_status=conversation.alignment_status,
        message_count=conversation.message_count,
        prompt_count=conversation.prompt_count,
        response_count=conversation.response_count,
        empty_message_count=conversation.empty_message_count,
        cleaned_thinking_summary_count=conversation.cleaned_thinking_summary_count,
        first_user_message=preview_text(conversation.first_user_message or ""),
        warnings=combined_warnings,
        messages=[
            MessagePreview(
                role=message.role,
                order_key=message.order_key,
                plain_text_preview=preview_text(message.plain_text),
                display_text_preview=preview_text(message.display_text),
                source_json_index=message.source_json_index,
                source_markdown_index=message.source_markdown_index,
                warnings=message.warnings,
            )
            for message in conversation.messages[:PREVIEW_MESSAGE_LIMIT]
        ],
    )


def _build_official_conversation_previews(
    files: list[UploadedPreviewFile],
    import_warnings: list[str],
) -> list[ConversationPreview]:
    official_file = next(
        (
            (filename, content, detection)
            for filename, content, detection in files
            if detection.source_profile in {SourceProfile.official_conversations_json, SourceProfile.official_conversation_json}
        ),
        None,
    )
    if official_file is None:
        return []

    filename, content, detection = official_file
    try:
        parse_result = parse_official_json(content)
    except OfficialJsonParseError as exc:
        import_warnings.append(f"{filename} could not be parsed as official conversations JSON: {exc}")
        return []

    source_profile = detection.source_profile.value
    previews = [
        build_official_conversation_preview(conversation, source_profile)
        for conversation in parse_result.conversations[:PREVIEW_CONVERSATION_LIMIT]
    ]
    import_warnings.extend(parse_result.warnings)
    if parse_result.conversation_count > PREVIEW_CONVERSATION_LIMIT:
        import_warnings.append(f"Conversation previews capped at {PREVIEW_CONVERSATION_LIMIT}.")
    return previews
