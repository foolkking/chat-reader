import logging
import time
import uuid
import shutil
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Body, Depends, File, HTTPException, Response, UploadFile, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.observability import structured_event
from app.models.import_record import ImportRecord
from app.models.conversation import Conversation
from app.models.source_artifact import SourceArtifact
from app.schemas.import_schema import (
    ConversationPreview,
    ImportPreviewFile,
    ImportPreviewResponse,
    ImportCommitOptions,
    ImportAlignmentIssue,
    ImportWarningsResponse,
    ImportStatusResponse,
    MessagePreview,
    SourceDetectionResult,
    SourceArtifactRead,
    SourceProfile,
)
from app.schemas.canonical import CommitImportResponse
from app.services.canonical.persistence import CommitImportError, commit_import_preview
from app.services.import_queue import (
    ACTIVE_IMPORT_STATUSES,
    conversation_ids_for_import,
    primary_filename,
    queue_import,
)
from app.services.import_pipeline.canonical_draft import CanonicalDraftConversation, preview_markdown, preview_text
from app.services.import_pipeline.exporter_aligner import align_exporter_sources
from app.services.import_pipeline.exporter_json_parser import ExporterJsonParseError, parse_exporter_json
from app.services.import_pipeline.exporter_markdown_parser import ExporterMarkdownPairingError, parse_exporter_markdown
from app.services.import_pipeline.canjson_parser import CanJsonParseError, parse_canjson_v1, parse_canjson_v2
from app.services.import_pipeline.draft_store import attach_import_draft
from app.services.import_pipeline.source_detector import detect_source_profile
from app.services.content_cleanup import queue_import_scan
from app.services.storage.local_storage import save_import_file
from app.services.exporting.cr_archive import CrArchiveError, inspect_cr_archive
from app.services.assets.lifecycle import delete_asset_files, release_import_assets
from app.services.ownership import OwnershipScope, get_owned, ownership_scope_from_request
from app.services.feature_policies import effective_import_size_mb, get_feature_policy

router = APIRouter(prefix="/api/imports", tags=["imports"])
logger = logging.getLogger(__name__)

ALLOWED_EXTENSIONS = {
    ".cr",
    ".json",
    ".md",
    ".markdown",
    ".jsonl",
    ".gz",
    ".canonical.json",
    ".canonical.jsonl",
    ".canonical.jsonl.gz",
}
PREVIEW_MESSAGE_LIMIT = 20
PREVIEW_CONVERSATION_LIMIT = 20


UploadedPreviewFile = tuple[str, bytes, SourceDetectionResult]


@router.post("/preview", response_model=ImportPreviewResponse)
async def preview_import(
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    ownership_scope: OwnershipScope = Depends(ownership_scope_from_request),
) -> ImportPreviewResponse:
    if not files:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="At least one file is required.")
    if len(files) > 2:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "unsupported_file_set",
                "message": "Import preview accepts at most one JSON file and one Markdown file.",
            },
        )

    settings = get_settings()
    policy = get_feature_policy(db)
    if not policy.allow_user_import:
        raise HTTPException(status_code=403, detail="User import is disabled by the system administrator.")
    max_size_mb = effective_import_size_mb(db)
    max_bytes = max_size_mb * 1024 * 1024
    import_id = uuid.uuid4()
    preview_files: list[ImportPreviewFile] = []
    import_warnings: list[str] = []
    total_bytes = 0
    source_profiles: list[str] = []
    uploaded_files: list[UploadedPreviewFile] = []
    pending_files: list[tuple[str, bytes]] = []
    conversation_preview: ConversationPreview | None = None
    conversation_previews: list[ConversationPreview] = []
    drafts = []
    archive_summary: dict | None = None
    archive_artifact: SourceArtifact | None = None
    duplicate_conversation_id: uuid.UUID | None = None
    preview_saved = False

    try:
        for upload in files:
            content = await upload.read()
            filename = upload.filename or "upload"
            extension = _extension(filename)

            if extension not in ALLOWED_EXTENSIONS:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail={
                        "code": "unsupported_source_profile",
                        "message": f"Unsupported file extension: {extension or '(none)'}",
                    },
                )
            if not content:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty.")
            if len(content) > max_bytes:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail=f"File exceeds {max_size_mb}MB limit.",
                )

            pending_files.append((filename, content))

        initial_detections = [
            (filename, content, detect_source_profile(filename, content))
            for filename, content in pending_files
        ]
        exporter_json = next(
            ((filename, content) for filename, content, detection in initial_detections if detection.source_profile == SourceProfile.chatgpt_exporter_json),
            None,
        )
        expected_messages = None
        if exporter_json is not None:
            try:
                expected_messages = parse_exporter_json(exporter_json[1]).messages
            except ExporterJsonParseError:
                # The canonical parser below returns the structured JSON error.
                expected_messages = None

        for filename, content, initial_detection in initial_detections:
            detection = initial_detection
            if detection.source_profile == SourceProfile.unknown and _extension(filename) in {".md", ".markdown"}:
                detection = detect_source_profile(filename, content, expected_messages)
            if detection.source_profile == SourceProfile.unknown:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail={"code": "unsupported_source_profile", "message": detection.reason, "warnings": detection.warnings},
                )
            uploaded_files.append((filename, content, detection))

        _validate_upload_set(uploaded_files)
        if not any(item[2].source_profile == SourceProfile.chat_reader_cr_v2 for item in uploaded_files):
            drafts = _build_supported_drafts(uploaded_files)
            conversation_preview = _preview_from_draft(drafts[0]) if drafts else None

        for filename, content, detection in uploaded_files:
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
            if detection.source_profile == SourceProfile.chat_reader_cr_v2:
                try:
                    archive_path = Path(settings.import_storage_dir) / str(import_id) / stored_file.safe_filename
                    archive_summary = inspect_cr_archive(archive_path)
                    artifact.parsed_summary = archive_summary
                    archive_artifact = artifact
                except CrArchiveError as exc:
                    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

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
                    warnings=detection.warnings,
                )
            )
            import_warnings.extend(detection.warnings)
            total_bytes += detection.size_bytes
            source_profiles.append(detection.source_profile.value)

        if archive_summary is not None:
            conversation_preview = ConversationPreview(
                title=archive_summary["title"],
                source_type="chat_reader_archive",
                source_profile="chat_reader_cr_v2",
                alignment_status="archive_ready",
                message_count=archive_summary["message_count"],
                prompt_count=0,
                response_count=0,
                empty_message_count=0,
                cleaned_thinking_summary_count=0,
                first_user_message=None,
                warnings=[],
                messages=[],
            )
        if conversation_preview is not None:
            import_warnings.extend(conversation_preview.warnings)
            source_profiles = [conversation_preview.source_profile]

        source_fingerprint = (
            archive_summary["archive_fingerprint"] if archive_summary is not None else _combined_source_fingerprint(preview_files)
        )
        if archive_summary is not None:
            existing = (
                db.query(ImportRecord)
                .filter(
                    ownership_scope.predicate(ImportRecord),
                    ImportRecord.source_fingerprint == source_fingerprint,
                    ImportRecord.status == "committed",
                    ImportRecord.conversation_id.is_not(None),
                )
                .order_by(ImportRecord.committed_at.desc())
                .first()
            )
            duplicate_conversation_id = existing.conversation_id if existing else None
            if archive_artifact is not None:
                archive_artifact.parsed_summary = {
                    **archive_summary,
                    "duplicate_conversation_id": str(duplicate_conversation_id) if duplicate_conversation_id else None,
                }

        import_record = ImportRecord(
            id=import_id,
            owner_user_id=ownership_scope.owner_user_id,
            source_profile=_combined_source_profile(source_profiles),
            source_fingerprint=source_fingerprint,
            status="previewed",
            alignment_status=conversation_preview.alignment_status if conversation_preview else "not_applicable",
            warnings=import_warnings,
            file_count=len(preview_files),
            total_bytes=total_bytes,
            json_filename=_first_filename_for_extension(preview_files, ".json")
            or _first_filename_for_extension(preview_files, ".canonical.json")
            or _first_filename_for_extension(preview_files, ".jsonl")
            or _first_filename_for_extension(preview_files, ".canonical.jsonl")
            or _first_filename_for_extension(preview_files, ".gz")
            or _first_filename_for_extension(preview_files, ".canonical.jsonl.gz"),
            md_filename=_first_filename_for_extension(preview_files, ".md")
            or _first_filename_for_extension(preview_files, ".markdown"),
        )
        db.add(import_record)
        if drafts:
            attach_import_draft(import_record, drafts)
        db.commit()
        preview_saved = True

    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Import preview could not be saved.",
        ) from exc
    finally:
        if not preview_saved:
            _cleanup_import_directory(import_id)

    can_commit = conversation_preview is not None and conversation_preview.alignment_status not in {"conflict_detected", "failed"}
    return ImportPreviewResponse(
        import_id=import_id,
        status="previewed",
        files=preview_files,
        warnings=import_warnings,
        conversation_preview=conversation_preview,
        conversation_previews=conversation_previews,
        can_commit=can_commit,
        commit_endpoint=f"/api/imports/{import_id}/commit" if can_commit else None,
        archive_summary=archive_summary,
        duplicate_conversation_id=duplicate_conversation_id,
        compatibility="compatible" if archive_summary is not None else None,
    )


@router.get("/{import_id}/source-artifacts", response_model=list[SourceArtifactRead])
def list_source_artifacts(
    import_id: uuid.UUID,
    db: Session = Depends(get_db),
    ownership_scope: OwnershipScope = Depends(ownership_scope_from_request),
) -> list[SourceArtifactRead]:
    _get_import_or_404(import_id, db, ownership_scope)
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
        )
        for artifact in artifacts
    ]


@router.get("/{import_id}/warnings", response_model=ImportWarningsResponse)
def get_import_warnings(
    import_id: uuid.UUID,
    db: Session = Depends(get_db),
    ownership_scope: OwnershipScope = Depends(ownership_scope_from_request),
) -> ImportWarningsResponse:
    import_record = _get_import_or_404(import_id, db, ownership_scope)
    return ImportWarningsResponse(import_id=import_record.id, warnings=import_record.warnings)


@router.get("/{import_id:uuid}", response_model=ImportStatusResponse)
def get_import(
    import_id: uuid.UUID,
    db: Session = Depends(get_db),
    ownership_scope: OwnershipScope = Depends(ownership_scope_from_request),
) -> ImportStatusResponse:
    return _import_status(_get_import_or_404(import_id, db, ownership_scope), db)


@router.delete("/{import_id:uuid}", status_code=status.HTTP_204_NO_CONTENT)
def delete_expired_import(
    import_id: uuid.UUID,
    db: Session = Depends(get_db),
    ownership_scope: OwnershipScope = Depends(ownership_scope_from_request),
) -> Response:
    record = _get_import_or_404(import_id, db, ownership_scope)
    now = datetime.now(timezone.utc)
    expires_at = record.draft_expires_at
    if record.status != "previewed" or expires_at is None or (expires_at if expires_at.tzinfo else expires_at.replace(tzinfo=timezone.utc)) > now:
        raise HTTPException(status_code=409, detail="Only expired, uncommitted import previews can be deleted.")
    storage_keys = release_import_assets(db, import_id)
    db.delete(record)
    db.commit()
    delete_asset_files(storage_keys)
    _cleanup_import_directory(import_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/active", response_model=list[ImportStatusResponse])
def list_active_imports(
    db: Session = Depends(get_db),
    ownership_scope: OwnershipScope = Depends(ownership_scope_from_request),
) -> list[ImportStatusResponse]:
    records = (
        db.query(ImportRecord)
        .filter(
            ownership_scope.predicate(ImportRecord),
            ImportRecord.status.in_((*ACTIVE_IMPORT_STATUSES, "failed")),
        )
        .order_by(ImportRecord.queued_at.asc(), ImportRecord.created_at.asc())
        .limit(20)
        .all()
    )
    return [_import_status(record, db) for record in records]


@router.get("/{import_id}/status", response_model=ImportStatusResponse)
def get_import_status(
    import_id: uuid.UUID,
    db: Session = Depends(get_db),
    ownership_scope: OwnershipScope = Depends(ownership_scope_from_request),
) -> ImportStatusResponse:
    return _import_status(_get_import_or_404(import_id, db, ownership_scope), db)


@router.post("/{import_id}/commit", response_model=CommitImportResponse, status_code=status.HTTP_202_ACCEPTED)
def commit_import(
    import_id: uuid.UUID,
    response: Response,
    options: ImportCommitOptions = Body(default_factory=ImportCommitOptions),
    db: Session = Depends(get_db),
    ownership_scope: OwnershipScope = Depends(ownership_scope_from_request),
) -> CommitImportResponse:
    import_record = _get_import_or_404(import_id, db, ownership_scope)
    if import_record.status == "committed":
        response.status_code = status.HTTP_200_OK
        return _commit_response(import_record, db)
    if import_record.alignment_status in {"conflict_detected", "failed"}:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Import preview contains unresolved JSON/Markdown alignment conflicts.",
        )

    archive_artifact = (
        db.query(SourceArtifact)
        .filter(
            SourceArtifact.import_id == import_id,
            SourceArtifact.source_profile.in_(("chat_reader_cr_v2", "chat_reader_archive_v1")),
        )
        .first()
    )
    if archive_artifact is not None:
        summary = dict(archive_artifact.parsed_summary or {})
        duplicate_id = summary.get("duplicate_conversation_id")
        duplicate_policy = "clone" if options.duplicate_policy == "copy" else options.duplicate_policy
        if duplicate_policy not in {"clone", "reject", "replace", "merge_if_same_hash"}:
            raise HTTPException(status_code=422, detail="Unsupported archive duplicate policy.")
        if duplicate_id and duplicate_policy == "reject":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"message": "Archive already exists.", "conversation_id": duplicate_id},
            )
        summary["commit_options"] = {
            "duplicate_policy": duplicate_policy,
            "duplicate_conversation_id": duplicate_id,
            "project_id": str(options.project_id) if options.project_id else None,
            "create_archive_project": options.create_archive_project,
        }
        archive_artifact.parsed_summary = summary

    queue_import(import_record, db)
    db.commit()

    if not get_settings().import_commit_inline:
        return _commit_response(import_record, db)

    import_record.status = "processing"
    import_record.phase = "parsing"
    import_record.started_at = datetime.now(timezone.utc)
    import_record.heartbeat_at = import_record.started_at
    db.commit()
    try:
        result = commit_import_preview(import_id, db)
        # Import commit is authoritative; noise review is an independent,
        # low-priority follow-up and must not make a successful import fail.
        try:
            with db.begin_nested():
                queue_import_scan(db, result.conversation_ids, ownership_scope)
        except Exception as exc:  # pragma: no cover - operational guard
            structured_event(logger, logging.WARNING, "post_import_noise_scan_queue_failed", import_id=str(import_id), error_class=type(exc).__name__)
        db.commit()
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
    response.status_code = status.HTTP_200_OK
    db.refresh(import_record)
    return _commit_response(import_record, db, result.message_count)


def _get_import_or_404(
    import_id: uuid.UUID,
    db: Session,
    ownership_scope: OwnershipScope,
) -> ImportRecord:
    import_record = get_owned(db, ImportRecord, import_id, ownership_scope)
    if import_record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Import record not found.")
    return import_record


def _import_status(record: ImportRecord, db: Session) -> ImportStatusResponse:
    conversation_ids = conversation_ids_for_import(db, record)
    message_count = _message_count(db, conversation_ids)
    return ImportStatusResponse(
        import_id=record.id,
        status=record.status,
        phase=record.phase,
        progress=record.progress,
        processed_messages=record.processed_messages,
        total_messages=record.total_messages,
        conversation_ids=conversation_ids,
        conversation_count=len(conversation_ids),
        message_count=message_count,
        filename=primary_filename(record),
        error_message=record.error_message,
        warnings=record.warnings or [],
        queued_at=record.queued_at,
        started_at=record.started_at,
        heartbeat_at=record.heartbeat_at,
        completed_at=record.completed_at,
    )


def _commit_response(record: ImportRecord, db: Session, message_count: int | None = None) -> CommitImportResponse:
    task = _import_status(record, db)
    payload = task.model_dump()
    payload["message_count"] = message_count if message_count is not None else task.message_count
    return CommitImportResponse(**payload)


def _message_count(db: Session, conversation_ids: list[uuid.UUID]) -> int:
    if not conversation_ids:
        return 0
    rows = db.query(Conversation.message_count).filter(Conversation.id.in_(conversation_ids)).all()
    return sum(row[0] for row in rows)


def _extension(filename: str) -> str:
    lowered = Path(filename).name.lower()
    for suffix in (".canonical.jsonl.gz", ".canonical.jsonl", ".canonical.json"):
        if lowered.endswith(suffix):
            return suffix
    return Path(lowered).suffix


def _cleanup_import_directory(import_id: uuid.UUID) -> None:
    root = Path(get_settings().import_storage_dir).resolve()
    directory = (root / str(import_id)).resolve()
    if directory.parent != root or directory.name != str(import_id):
        return
    if directory.is_dir():
        shutil.rmtree(directory)


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


def _validate_upload_set(files: list[UploadedPreviewFile]) -> None:
    profiles = [item[2].source_profile for item in files]
    if profiles.count(SourceProfile.chat_reader_cr_v2):
        if len(files) != 1:
            raise HTTPException(status_code=422, detail={"code": "invalid_import_form", "message": ".cr must be imported by itself."})
        return
    canjson_profiles = {SourceProfile.chat_reader_canjson_v1, SourceProfile.chat_reader_canjson_v2}
    if any(profile in canjson_profiles for profile in profiles):
        if len(files) != 1:
            raise HTTPException(status_code=422, detail={"code": "invalid_import_form", "message": "CanJSON compatibility files must be imported by themselves."})
        return
    if SourceProfile.chatgpt_exporter_json not in profiles:
        raise HTTPException(
            status_code=422,
            detail={"code": "json_required", "message": "Standardized JSON is required; Markdown is an optional validation companion."},
        )
    if profiles.count(SourceProfile.chatgpt_exporter_json) != 1 or profiles.count(SourceProfile.chatgpt_exporter_markdown) > 1 or len(files) > 2:
        raise HTTPException(status_code=422, detail={"code": "invalid_import_form", "message": "Upload one JSON file and optionally one Markdown file."})


def _build_supported_drafts(files: list[UploadedPreviewFile]) -> list[CanonicalDraftConversation]:
    canjson = next((item for item in files if item[2].source_profile in {SourceProfile.chat_reader_canjson_v1, SourceProfile.chat_reader_canjson_v2}), None)
    if canjson is not None:
        try:
            if canjson[2].source_profile == SourceProfile.chat_reader_canjson_v1:
                return [parse_canjson_v1(canjson[1]).conversation]
            return [parse_canjson_v2(canjson[1], compressed=canjson[0].lower().endswith(".gz")).conversation]
        except CanJsonParseError as exc:
            raise HTTPException(status_code=422, detail={"code": "invalid_canjson", "message": str(exc)}) from exc

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

    if exporter_json is None:
        return []
    markdown_result = None
    json_started = time.perf_counter()
    try:
        json_result = parse_exporter_json(exporter_json[1])
    except ExporterJsonParseError as exc:
        raise HTTPException(status_code=422, detail={"code": "invalid_exporter_json", "message": str(exc)}) from exc
    json_parse_ms = round((time.perf_counter() - json_started) * 1000, 2)

    markdown_parse_ms = 0.0
    if exporter_markdown is not None:
        markdown_started = time.perf_counter()
        try:
            markdown_result = parse_exporter_markdown(exporter_markdown[1], json_result.messages)
        except ExporterMarkdownPairingError as exc:
            raise HTTPException(status_code=422, detail={"code": exc.code, "message": str(exc)}) from exc
        finally:
            markdown_parse_ms = round((time.perf_counter() - markdown_started) * 1000, 2)

    alignment_started = time.perf_counter()
    alignment = align_exporter_sources(json_result, markdown_result)
    alignment_ms = round((time.perf_counter() - alignment_started) * 1000, 2)
    logger.info(
        "import_preview_parse_timing",
        extra={
            "json_parse_ms": json_parse_ms,
            "markdown_parse_ms": markdown_parse_ms,
            "alignment_ms": alignment_ms,
            "json_message_count": len(json_result.messages),
            "json_bytes": len(exporter_json[1]),
            "markdown_bytes": len(exporter_markdown[1]) if exporter_markdown is not None else 0,
            "alignment_status": alignment.alignment_status,
        },
    )
    if alignment.conversation is None:
        raise HTTPException(status_code=422, detail={"code": "alignment_failed", "message": "A canonical draft could not be built."})
    return [alignment.conversation]


def _preview_from_draft(conversation: CanonicalDraftConversation) -> ConversationPreview:
    summary: dict[str, int] = {}
    for message in conversation.messages:
        summary[message.alignment_status] = summary.get(message.alignment_status, 0) + 1
    first_user = next((message for message in conversation.messages if message.role == "user"), None)

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
        first_user_message_markdown=preview_markdown(first_user.display_text) if first_user is not None else None,
        warnings=conversation.warnings,
        messages=[
            MessagePreview(
                role=message.role,
                order_key=message.order_key,
                plain_text_preview=preview_text(message.plain_text),
                display_text_preview=preview_text(message.display_text),
                source_json_index=message.source_json_index,
                source_markdown_index=message.source_markdown_index,
                warnings=message.warnings,
                alignment_status=message.alignment_status,
            )
            for message in conversation.messages[:PREVIEW_MESSAGE_LIMIT]
        ],
        alignment_summary=summary,
        alignment_issues=[ImportAlignmentIssue(**issue) for issue in conversation.alignment_issues],
        ignored_json_empty_count=conversation.ignored_json_empty_count,
        ignored_markdown_empty_count=conversation.ignored_markdown_empty_count,
    )
