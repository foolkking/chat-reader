import logging
import uuid
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import or_
from sqlalchemy.orm import Session, sessionmaker

from app.core.database import SessionLocal
from app.core.config import get_settings
from app.models.background_job import BackgroundJob
from app.models.content_cleanup import ContentCleanupScan
from app.models.conversation import Conversation
from app.models.project import Project
from app.services.editing.message_edit_service import (
    MessageEditError,
    auto_clean_conversation,
    merge_conversations,
)
from app.services.exporting.cr_archive import create_cr_archive
from app.services.exporting.context_package import create_context_package
from app.services.exporting.attachment_bundle import create_attachment_bundle, MARKDOWN_BUNDLE_FORMAT, CANJSON_BUNDLE_FORMAT
from app.services.exporting.system_archive import create_system_archive
from app.services.exporting.attachment_download import create_attachment_download, validate_attachment_download
from app.schemas.export import ExportOptions
from app.services.offline_packages import build_catalog, build_offline_package, changed_conversations, select_conversations
from app.services.artifact_lifecycle import cleanup_committed_artifacts
from app.services.derived_rebuild import rebuild_conversation_derived_data
from app.services.toc.toc_refresh import refresh_toc_data
from app.services.assets.derivatives import build_asset_derivative
from app.services.content_cleanup import process_scan_chunk
from app.services.conversations.conversation_deletion import delete_conversation_record
from app.services.retry_policy import MAX_AUTOMATIC_ATTEMPTS
from app.core.observability import structured_event

logger = logging.getLogger(__name__)

ACTIVE_JOB_STATUSES = ("queued", "processing", "cancelling")
ProgressCallback = Callable[[str, int, int, int], None]


class BackgroundJobCancelled(RuntimeError):
    pass


def queue_conversation_merge(
    db: Session,
    *,
    conversation_ids: list[uuid.UUID],
    title: str | None,
    project_id: uuid.UUID | None,
    idempotency_key: str | None,
) -> BackgroundJob:
    if len(conversation_ids) < 2:
        raise MessageEditError("At least two conversations are required for merge.")
    if len(set(conversation_ids)) != len(conversation_ids):
        raise MessageEditError("Duplicate conversation ids are not allowed.")
    conversations = (
        db.query(Conversation)
        .filter(
            Conversation.id.in_(conversation_ids),
            Conversation.deleted_at.is_(None),
            Conversation.status == "active",
        )
        .all()
    )
    if len(conversations) != len(conversation_ids):
        raise MessageEditError("One or more conversations were not found.")
    if project_id is not None:
        project = db.get(Project, project_id)
        if project is None or project.is_archived:
            raise MessageEditError("Project not found.")

    if idempotency_key:
        existing = (
            db.query(BackgroundJob)
            .filter(
                BackgroundJob.job_type == "conversation_merge",
                BackgroundJob.idempotency_key == idempotency_key,
                BackgroundJob.status.in_((*ACTIVE_JOB_STATUSES, "committed")),
            )
            .order_by(BackgroundJob.created_at.desc())
            .first()
        )
        if existing is not None:
            return existing

    total_items = sum(conversation.message_count for conversation in conversations)
    job = BackgroundJob(
        id=uuid.uuid4(),
        job_type="conversation_merge",
        status="queued",
        phase="queued",
        progress=0,
        processed_items=0,
        total_items=total_items,
        payload={
            "conversation_ids": [str(item) for item in conversation_ids],
            "title": title,
            "project_id": str(project_id) if project_id else None,
        },
        result={},
        idempotency_key=idempotency_key,
    )
    db.add(job)
    db.flush()
    return job


def queue_conversation_export(
    db: Session,
    *,
    conversation_id: uuid.UUID,
    idempotency_key: str | None,
    include_description: bool = False,
    include_annotations: bool = False,
    include_notebook: bool = False,
    include_metadata: bool = True,
    include_source_refs: bool = True,
    export_format: str = "cr_v2",
    context_scope: str = "full_conversation",
    start_message_id: uuid.UUID | None = None,
) -> BackgroundJob:
    conversation = db.get(Conversation, conversation_id)
    if conversation is None or conversation.deleted_at is not None:
        raise MessageEditError("Conversation not found.", 404)
    if idempotency_key:
        existing = (
            db.query(BackgroundJob)
            .filter(
                BackgroundJob.job_type == "conversation_export",
                BackgroundJob.idempotency_key == idempotency_key,
                BackgroundJob.status.in_((*ACTIVE_JOB_STATUSES, "committed")),
            )
            .order_by(BackgroundJob.created_at.desc())
            .first()
        )
        if existing is not None:
            return existing
    job = BackgroundJob(
        id=uuid.uuid4(),
        job_type="conversation_export",
        status="queued",
        phase="queued",
        progress=0,
        processed_items=0,
        total_items=conversation.message_count,
        payload={
            "conversation_id": str(conversation.id),
            "title": conversation.display_title,
            "include_description": include_description,
            "include_annotations": include_annotations,
            "include_notebook": include_notebook,
            "include_metadata": include_metadata,
            "include_source_refs": include_source_refs,
            "export_format": export_format,
            "context_scope": context_scope,
            "start_message_id": str(start_message_id) if start_message_id else None,
        },
        result={},
        idempotency_key=idempotency_key,
    )
    db.add(job)
    db.flush()
    return job


def queue_system_archive_export(
    db: Session,
    *,
    include_archived: bool,
    idempotency_key: str | None,
) -> BackgroundJob:
    if idempotency_key:
        existing = (
            db.query(BackgroundJob)
            .filter(
                BackgroundJob.job_type == "system_archive_export",
                BackgroundJob.idempotency_key == idempotency_key,
                BackgroundJob.status.in_((*ACTIVE_JOB_STATUSES, "committed")),
            )
            .order_by(BackgroundJob.created_at.desc())
            .first()
        )
        if existing is not None:
            return existing
    conversation_query = db.query(Conversation).filter(Conversation.deleted_at.is_(None))
    if not include_archived:
        conversation_query = conversation_query.filter(Conversation.status == "active")
    total = conversation_query.count()
    job = BackgroundJob(
        id=uuid.uuid4(),
        job_type="system_archive_export",
        status="queued",
        phase="queued",
        progress=0,
        processed_items=0,
        total_items=total,
        payload={"include_archived": include_archived},
        result={},
        idempotency_key=idempotency_key,
    )
    db.add(job)
    db.flush()
    return job


def queue_attachment_download(
    db: Session,
    *,
    conversation_id: uuid.UUID,
    attachment_ids: list[uuid.UUID],
    idempotency_key: str,
) -> BackgroundJob:
    validate_attachment_download(db, conversation_id=conversation_id, attachment_ids=attachment_ids)
    existing = (
        db.query(BackgroundJob)
        .filter(
            BackgroundJob.job_type == "attachment_batch_download",
            BackgroundJob.idempotency_key == idempotency_key,
            BackgroundJob.status.in_((*ACTIVE_JOB_STATUSES, "committed")),
        )
        .order_by(BackgroundJob.created_at.desc())
        .first()
    )
    if existing is not None:
        return existing
    job = BackgroundJob(
        id=uuid.uuid4(),
        job_type="attachment_batch_download",
        status="queued",
        phase="queued",
        progress=0,
        processed_items=0,
        total_items=len(attachment_ids),
        payload={"conversation_id": str(conversation_id), "attachment_ids": [str(value) for value in attachment_ids]},
        result={},
        idempotency_key=idempotency_key,
    )
    db.add(job)
    db.flush()
    return job


def queue_conversation_auto_clean(
    db: Session,
    *,
    conversation_id: uuid.UUID,
    idempotency_key: str | None,
) -> BackgroundJob:
    conversation = db.get(Conversation, conversation_id)
    if conversation is None or conversation.deleted_at is not None or conversation.status != "active":
        raise MessageEditError("Conversation not found.", 404)
    if idempotency_key:
        existing = (
            db.query(BackgroundJob)
            .filter(
                BackgroundJob.job_type == "conversation_auto_clean",
                BackgroundJob.idempotency_key == idempotency_key,
                BackgroundJob.status.in_((*ACTIVE_JOB_STATUSES, "committed")),
            )
            .order_by(BackgroundJob.created_at.desc())
            .first()
        )
        if existing is not None:
            return existing
    job = BackgroundJob(
        id=uuid.uuid4(),
        job_type="conversation_auto_clean",
        status="queued",
        phase="queued",
        progress=0,
        processed_items=0,
        total_items=conversation.message_count,
        payload={"conversation_id": str(conversation.id), "title": conversation.display_title},
        result={},
        idempotency_key=idempotency_key,
    )
    db.add(job)
    db.flush()
    return job


def queue_conversation_batch_delete(
    db: Session,
    *,
    conversation_ids: list[uuid.UUID],
    idempotency_key: str | None,
) -> BackgroundJob:
    ordered_ids = list(dict.fromkeys(conversation_ids))
    if not ordered_ids:
        raise MessageEditError("At least one conversation is required.", 422)
    existing = db.query(Conversation.id).filter(
        Conversation.id.in_(ordered_ids),
        Conversation.deleted_at.is_(None),
    ).all()
    if {row[0] for row in existing} != set(ordered_ids):
        raise MessageEditError("One or more conversations were not found.", 404)
    if idempotency_key:
        previous = (
            db.query(BackgroundJob)
            .filter(
                BackgroundJob.job_type == "conversation_batch_delete",
                BackgroundJob.idempotency_key == idempotency_key,
                BackgroundJob.status.in_((*ACTIVE_JOB_STATUSES, "committed")),
            )
            .order_by(BackgroundJob.created_at.desc())
            .first()
        )
        if previous is not None:
            return previous
    job = BackgroundJob(
        id=uuid.uuid4(),
        job_type="conversation_batch_delete",
        status="queued",
        phase="queued",
        progress=0,
        processed_items=0,
        total_items=len(ordered_ids),
        payload={"conversation_ids": [str(item) for item in ordered_ids]},
        result={},
        idempotency_key=idempotency_key,
    )
    db.add(job)
    db.flush()
    return job


def queue_conversation_derived_rebuild(
    db: Session,
    *,
    conversation_id: uuid.UUID,
    idempotency_key: str | None,
    rebuild_versions: bool = True,
) -> BackgroundJob:
    conversation = db.get(Conversation, conversation_id)
    if conversation is None or conversation.deleted_at is not None:
        raise MessageEditError("Conversation not found.", 404)
    if idempotency_key:
        existing = (
            db.query(BackgroundJob)
            .filter(
                BackgroundJob.job_type == "conversation_derived_rebuild",
                BackgroundJob.idempotency_key == idempotency_key,
                BackgroundJob.status.in_((*ACTIVE_JOB_STATUSES, "committed")),
            )
            .order_by(BackgroundJob.created_at.desc())
            .first()
        )
        if existing is not None:
            return existing
    if not rebuild_versions:
        active_rebuilds = (
            db.query(BackgroundJob)
            .filter(
                BackgroundJob.job_type == "conversation_derived_rebuild",
                BackgroundJob.status.in_(ACTIVE_JOB_STATUSES),
            )
            .order_by(BackgroundJob.created_at.desc())
            .all()
        )
        existing = next(
            (
                item
                for item in active_rebuilds
                if str((item.payload or {}).get("conversation_id")) == str(conversation_id)
                and not bool((item.payload or {}).get("rebuild_versions", True))
            ),
            None,
        )
        if existing is not None:
            return existing
    job = BackgroundJob(
        id=uuid.uuid4(),
        job_type="conversation_derived_rebuild",
        status="queued",
        phase="queued",
        progress=0,
        processed_items=0,
        total_items=conversation.message_count,
        payload={
            "conversation_id": str(conversation.id),
            "title": conversation.display_title,
            "rebuild_versions": rebuild_versions,
        },
        result={},
        idempotency_key=idempotency_key,
    )
    db.add(job)
    db.flush()
    return job


def queue_toc_refresh(
    db: Session,
    *,
    conversation_id: uuid.UUID,
    refresh_dialogue_index: bool,
    refresh_section_toc: bool,
    section_scope: str,
    idempotency_key: str | None,
) -> BackgroundJob:
    conversation = db.get(Conversation, conversation_id)
    if conversation is None or conversation.deleted_at is not None:
        raise MessageEditError("Conversation not found.", 404)
    if not refresh_dialogue_index and not refresh_section_toc:
        raise MessageEditError("At least one TOC target must be selected.", 422)
    if section_scope not in {"current_conversation", "all_conversations"}:
        raise MessageEditError("Unsupported section TOC scope.", 422)
    if idempotency_key:
        existing = (
            db.query(BackgroundJob)
            .filter(
                BackgroundJob.job_type == "toc_refresh",
                BackgroundJob.idempotency_key == idempotency_key,
                BackgroundJob.status.in_((*ACTIVE_JOB_STATUSES, "committed")),
            )
            .order_by(BackgroundJob.created_at.desc())
            .first()
        )
        if existing is not None:
            return existing
    total_items = 1
    if refresh_section_toc and section_scope == "all_conversations":
        total_items = db.query(Conversation).filter(Conversation.deleted_at.is_(None)).count()
    job = BackgroundJob(
        id=uuid.uuid4(),
        job_type="toc_refresh",
        status="queued",
        phase="queued",
        progress=0,
        processed_items=0,
        total_items=total_items,
        payload={
            "conversation_id": str(conversation.id),
            "title": conversation.display_title,
            "refresh_dialogue_index": refresh_dialogue_index,
            "refresh_section_toc": refresh_section_toc,
            "section_scope": section_scope,
        },
        result={},
        idempotency_key=idempotency_key,
    )
    db.add(job)
    db.flush()
    return job


def queue_attachment_derivative(
    db: Session,
    *,
    attachment_id: uuid.UUID,
    derivative_type: str,
    idempotency_key: str | None,
) -> BackgroundJob:
    if idempotency_key:
        existing = (
            db.query(BackgroundJob)
            .filter(
                BackgroundJob.job_type == "attachment_derivative",
                BackgroundJob.idempotency_key == idempotency_key,
                BackgroundJob.status.in_((*ACTIVE_JOB_STATUSES, "committed")),
            )
            .order_by(BackgroundJob.created_at.desc())
            .first()
        )
        if existing is not None:
            return existing
    job = BackgroundJob(
        id=uuid.uuid4(),
        job_type="attachment_derivative",
        status="queued",
        phase="queued",
        progress=0,
        processed_items=0,
        total_items=1,
        payload={"attachment_id": str(attachment_id), "derivative_type": derivative_type},
        result={},
        idempotency_key=idempotency_key,
    )
    db.add(job)
    db.flush()
    return job


def queue_offline_package(
    db: Session,
    *,
    scope: str,
    conversation_id: uuid.UUID | None,
    project_id: uuid.UUID | None,
    known_revisions: dict[uuid.UUID, int] | None,
    idempotency_key: str | None,
    include_assets: str = "all",
) -> BackgroundJob:
    conversations = select_conversations(db, scope=scope, conversation_id=conversation_id, project_id=project_id)
    base_revisions = known_revisions or {}
    changed = changed_conversations(conversations, base_revisions)
    if idempotency_key:
        existing = (
            db.query(BackgroundJob)
            .filter(
                BackgroundJob.job_type == "offline_package",
                BackgroundJob.idempotency_key == idempotency_key,
                BackgroundJob.status.in_((*ACTIVE_JOB_STATUSES, "committed")),
            )
            .order_by(BackgroundJob.created_at.desc())
            .first()
        )
        if existing is not None:
            return existing
    job = BackgroundJob(
        id=uuid.uuid4(),
        job_type="offline_package",
        status="queued",
        phase="queued",
        progress=0,
        processed_items=0,
        total_items=len(changed),
        payload={
            "package_id": str(uuid.uuid4()),
            "scope": scope,
            "conversation_id": str(conversation_id) if conversation_id else None,
            "project_id": str(project_id) if project_id else None,
            "known_revisions": {str(key): value for key, value in base_revisions.items()},
            "include_assets": include_assets,
            # Catalog generation is intentionally deferred to the worker. It
            # performs per-conversation size estimation and must not block the
            # interactive request that queues an offline download.
        },
        result={},
        idempotency_key=idempotency_key,
    )
    db.add(job)
    db.flush()
    return job


def recover_stale_jobs(db: Session, stale_after_seconds: int) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=stale_after_seconds)
    jobs = (
        db.query(BackgroundJob)
        .filter(
            BackgroundJob.status.in_(("processing", "cancelling")),
            or_(BackgroundJob.heartbeat_at.is_(None), BackgroundJob.heartbeat_at < cutoff),
        )
        .all()
    )
    now = datetime.now(timezone.utc)
    for job in jobs:
        if job.status == "cancelling":
            job.status = "cancelled"
            job.phase = "cancelled"
            job.heartbeat_at = now
            job.completed_at = now
            job.error_message = None
            structured_event(logger, logging.INFO, "background_job_cancelled", job_id=str(job.id), job_type=job.job_type)
            continue
        if job.attempt_count >= MAX_AUTOMATIC_ATTEMPTS:
            job.status = "failed"
            job.phase = "failed"
            job.heartbeat_at = now
            job.completed_at = now
            job.error_message = (
                f"Worker stopped before completing {MAX_AUTOMATIC_ATTEMPTS} times; "
                "automatic retries stopped."
            )
            structured_event(
                logger,
                logging.WARNING,
                "background_job_auto_retry_exhausted",
                job_id=str(job.id),
                job_type=job.job_type,
                attempt=job.attempt_count,
            )
            continue
        job.status = "queued"
        job.phase = "queued"
        job.queued_at = now
        job.started_at = None
        job.heartbeat_at = None
        job.error_message = "Previous worker stopped before completing; task requeued."
        structured_event(
            logger,
            logging.WARNING,
            "background_job_stale_recovered",
            job_id=str(job.id),
            job_type=job.job_type,
            attempt=job.attempt_count,
        )
    db.flush()
    return len(jobs)


def claim_next_job(
    db: Session,
    *,
    job_type: str | None = None,
    exclude_job_types: tuple[str, ...] = ("content_noise_scan",),
) -> uuid.UUID | None:
    query = db.query(BackgroundJob).filter(BackgroundJob.status == "queued")
    if job_type is not None:
        query = query.filter(BackgroundJob.job_type == job_type)
    if exclude_job_types:
        query = query.filter(BackgroundJob.job_type.notin_(exclude_job_types))
    job = (
        query
        .order_by(BackgroundJob.queued_at.asc(), BackgroundJob.created_at.asc())
        .with_for_update(skip_locked=True)
        .first()
    )
    if job is None:
        return None
    now = datetime.now(timezone.utc)
    job.status = "processing"
    job.phase = "validating"
    job.progress = max(job.progress, 1)
    job.started_at = now
    job.heartbeat_at = now
    job.error_message = None
    job.attempt_count += 1
    db.flush()
    structured_event(
        logger,
        logging.INFO,
        "background_job_started",
        job_id=str(job.id),
        job_type=job.job_type,
        attempt=job.attempt_count,
    )
    return job.id


def process_background_job(
    job_id: uuid.UUID,
    session_factory: sessionmaker = SessionLocal,
) -> None:
    def persist_report(
        phase: str,
        progress: int,
        processed: int,
        total: int,
        result: dict[str, object] | None = None,
    ) -> None:
        with session_factory() as progress_db:
            job = progress_db.get(BackgroundJob, job_id)
            if job is None:
                raise BackgroundJobCancelled("Background job no longer exists.")
            if job.status in {"cancelling", "cancelled"}:
                raise BackgroundJobCancelled("Background job cancellation requested.")
            if job.status != "processing":
                raise RuntimeError(f"Background job is no longer processing ({job.status}).")
            job.phase = phase
            job.progress = max(0, min(progress, 99))
            job.processed_items = processed
            job.total_items = total
            if result is not None:
                job.result = result
            job.heartbeat_at = datetime.now(timezone.utc)
            progress_db.commit()

    try:
        with session_factory() as db:
            job = db.get(BackgroundJob, job_id)
            if job is None:
                return
            if job.status in {"cancelling", "cancelled"}:
                if job.status == "cancelling":
                    now = datetime.now(timezone.utc)
                    job.status = "cancelled"
                    job.phase = "cancelled"
                    job.heartbeat_at = now
                    job.completed_at = now
                    job.error_message = None
                    db.commit()
                return
            if job.status != "processing":
                return
            payload = job.payload or {}
            is_sqlite = db.get_bind().dialect.name == "sqlite"

            def report(
                phase: str,
                progress: int,
                processed: int,
                total: int,
                result: dict[str, object] | None = None,
            ) -> None:
                if not is_sqlite:
                    persist_report(phase, progress, processed, total, result)
                    return
                if job.status in {"cancelling", "cancelled"}:
                    raise BackgroundJobCancelled("Background job cancellation requested.")
                if job.status != "processing":
                    raise RuntimeError(f"Background job is no longer processing ({job.status}).")
                job.phase = phase
                job.progress = max(0, min(progress, 99))
                job.processed_items = processed
                job.total_items = total
                if result is not None:
                    job.result = result
                job.heartbeat_at = datetime.now(timezone.utc)

            report("validating", 5, 0, job.total_items)
            if job.job_type == "conversation_merge":
                conversation_ids = [uuid.UUID(value) for value in payload.get("conversation_ids", [])]
                project_value = payload.get("project_id")
                project_id = uuid.UUID(project_value) if project_value else None
                result = merge_conversations(
                    db=db,
                    conversation_ids=conversation_ids,
                    title=payload.get("title"),
                    project_id=project_id,
                    progress_callback=report,
                )
                job_result = {
                    "conversation_ids": [str(result.conversation.id)],
                    "conversation_id": str(result.conversation.id),
                    "title": result.conversation.display_title,
                    "message_count": result.message_count,
                }
                processed_items = result.message_count
                report("publishing", 99, processed_items, processed_items)
            elif job.job_type == "system_archive_export":
                artifact = create_system_archive(
                    db,
                    job_id=job.id,
                    include_archived=bool(payload.get("include_archived", True)),
                    progress_callback=report,
                )
                job_result = {
                    "artifact_id": str(artifact.id),
                    "filename": artifact.filename,
                    "byte_size": artifact.byte_size,
                    "download_url": f"/api/exports/{artifact.id}/download",
                }
                processed_items = job.total_items
            elif job.job_type == "conversation_export":
                conversation_id = uuid.UUID(payload["conversation_id"])
                if payload.get("export_format") == "context_package":
                    artifact = create_context_package(
                        db,
                        conversation_id=conversation_id,
                        job_id=job.id,
                        scope_kind=str(payload.get("context_scope") or "full_conversation"),
                        start_message_id=(
                            uuid.UUID(str(payload["start_message_id"]))
                            if payload.get("start_message_id")
                            else None
                        ),
                        progress_callback=report,
                    )
                elif payload.get("export_format") in {"markdown_bundle", "canjson_bundle"}:
                    export_format = str(payload.get("export_format"))
                    artifact = create_attachment_bundle(
                        db,
                        conversation_id=conversation_id,
                        job_id=job.id,
                        bundle_format=(
                            MARKDOWN_BUNDLE_FORMAT
                            if export_format == "markdown_bundle"
                            else CANJSON_BUNDLE_FORMAT
                        ),
                        options=ExportOptions(
                            format="markdown_v2" if export_format == "markdown_bundle" else "canjson_v2",
                            message_ids=[],
                            include_metadata=bool(payload.get("include_metadata", True)),
                            include_description=bool(payload.get("include_description")),
                            include_annotations=bool(payload.get("include_annotations")),
                            include_notebook=bool(payload.get("include_notebook")),
                            include_source_refs=bool(payload.get("include_source_refs", True)),
                        ),
                        progress_callback=report,
                    )
                else:
                    artifact = create_cr_archive(
                        db,
                        conversation_id=conversation_id,
                        job_id=job.id,
                        progress_callback=report,
                        include_description=bool(payload.get("include_description")),
                        include_annotations=bool(payload.get("include_annotations")),
                        include_notebook=bool(payload.get("include_notebook")),
                    )
                job_result = {
                    "conversation_id": str(conversation_id),
                    "artifact_id": str(artifact.id),
                    "filename": artifact.filename,
                    "byte_size": artifact.byte_size,
                    "download_url": f"/api/exports/{artifact.id}/download",
                }
                processed_items = job.total_items
            elif job.job_type == "conversation_auto_clean":
                conversation_id = uuid.UUID(payload["conversation_id"])
                result = auto_clean_conversation(db, conversation_id, progress_callback=report)
                job_result = {
                    "conversation_id": str(conversation_id),
                    "conversation_ids": [str(conversation_id)],
                    "scanned_messages": result.scanned_messages,
                    "cleaned_messages": result.cleaned_messages,
                }
                processed_items = result.scanned_messages
            elif job.job_type == "conversation_batch_delete":
                conversation_ids = [uuid.UUID(value) for value in payload.get("conversation_ids", [])]
                prior_result = job.result or {}
                succeeded_ids = [str(value) for value in prior_result.get("deleted_ids", [])]
                failed = [
                    {"id": str(item.get("id")), "error": str(item.get("error"))}
                    for item in prior_result.get("failed", [])
                    if isinstance(item, dict) and item.get("id")
                ]
                total = len(conversation_ids)
                next_index = max(0, min(int(payload.get("next_index", 0)), total))
                if next_index >= total:
                    job_result = {"deleted_ids": succeeded_ids, "failed": failed}
                    processed_items = total
                else:
                    # Complete one conversation per worker turn. This keeps the
                    # single worker responsive to imports and interactive jobs,
                    # while preserving the requested top-to-bottom order.
                    index = next_index + 1
                    conversation_id = conversation_ids[next_index]
                    report(
                        "deleting",
                        int(next_index * 100 / max(total, 1)),
                        next_index,
                        total,
                        {"deleted_ids": succeeded_ids, "failed": failed},
                    )
                    last_error: Exception | None = None
                    for _attempt in range(2):
                        try:
                            delete_conversation_record(db, conversation_id)
                            succeeded_ids.append(str(conversation_id))
                            last_error = None
                            break
                        except LookupError:
                            db.rollback()
                            # A concurrent delete already reached the desired
                            # terminal state, so treat it as idempotent success.
                            succeeded_ids.append(str(conversation_id))
                            last_error = None
                            break
                        except Exception as exc:
                            db.rollback()
                            last_error = exc
                    if last_error is not None:
                        failed.append({"id": str(conversation_id), "error": _safe_error(last_error)})
                    next_index = index
                    result = {"deleted_ids": succeeded_ids, "failed": failed}
                    if next_index < total:
                        # Requeue at the item boundary. A cancellation arriving
                        # during the delete is observed here and cannot start the
                        # following item.
                        now = datetime.now(timezone.utc)
                        updated = (
                            db.query(BackgroundJob)
                            .filter(BackgroundJob.id == job.id, BackgroundJob.status == "processing")
                            .update(
                                {
                                    BackgroundJob.payload: {**payload, "next_index": next_index},
                                    BackgroundJob.result: result,
                                    BackgroundJob.status: "queued",
                                    BackgroundJob.phase: "deleting",
                                    BackgroundJob.progress: int(next_index * 100 / max(total, 1)),
                                    BackgroundJob.processed_items: next_index,
                                    BackgroundJob.total_items: total,
                                    BackgroundJob.queued_at: now,
                                    BackgroundJob.started_at: None,
                                    BackgroundJob.heartbeat_at: now,
                                    BackgroundJob.attempt_count: 0,
                                    BackgroundJob.error_message: None,
                                },
                                synchronize_session=False,
                            )
                        )
                        if updated != 1:
                            db.refresh(job)
                        if updated != 1 and job.status in {"cancelling", "cancelled"}:
                            now = datetime.now(timezone.utc)
                            job.status = "cancelled"
                            job.phase = "cancelled"
                            job.progress = int(next_index * 100 / max(total, 1))
                            job.processed_items = next_index
                            job.result = result
                            job.heartbeat_at = now
                            job.completed_at = now
                            db.commit()
                            return
                        if updated != 1:
                            raise BackgroundJobCancelled("Background job state changed before requeue.")
                        db.commit()
                        return
                    job_result = result
                    processed_items = total
            elif job.job_type == "content_noise_scan":
                scan_id = uuid.UUID(str(payload["scan_id"]))
                result = process_scan_chunk(db, scan_id)
                if not bool(result.get("done")):
                    scan_payload = dict(payload)
                    scan = db.get(ContentCleanupScan, scan_id)
                    scan_payload["cursor_message_id"] = str(scan.cursor_message_id) if scan and scan.cursor_message_id else None
                    job.payload = scan_payload
                    job.status = "queued"
                    job.phase = "scanning"
                    job.progress = int(result.get("processed", 0) * 100 / max(int(result.get("total", 1)), 1))
                    job.processed_items = int(result.get("processed", 0))
                    job.total_items = int(result.get("total", 0))
                    job.queued_at = datetime.now(timezone.utc)
                    job.started_at = None
                    job.heartbeat_at = datetime.now(timezone.utc)
                    job.attempt_count = 0
                    job.error_message = None
                    db.commit()
                    return
                job_result = {
                    "scan_id": str(scan_id),
                    "occurrence_count": int(result.get("occurrences", 0)),
                }
                processed_items = int(result.get("processed", 0))
            elif job.job_type == "conversation_derived_rebuild":
                conversation_id = uuid.UUID(payload["conversation_id"])
                result = rebuild_conversation_derived_data(
                    db,
                    conversation_id,
                    progress_callback=report,
                    rebuild_versions=bool(payload.get("rebuild_versions", True)),
                    commit_batches=True,
                )
                job_result = {
                    "conversation_id": str(conversation_id),
                    "conversation_ids": [str(conversation_id)],
                    "rebuilt_versions": result.rebuilt_versions,
                    "rebuilt_blocks": result.rebuilt_blocks,
                }
                processed_items = result.rebuilt_versions
            elif job.job_type == "toc_refresh":
                conversation_id = uuid.UUID(payload["conversation_id"])
                result = refresh_toc_data(
                    db,
                    conversation_id,
                    refresh_dialogue_index=bool(payload.get("refresh_dialogue_index", True)),
                    refresh_section_toc=bool(payload.get("refresh_section_toc", True)),
                    section_scope=str(payload.get("section_scope") or "current_conversation"),
                    progress_callback=report,
                )
                job_result = {
                    "conversation_id": str(conversation_id),
                    "conversation_ids": [str(conversation_id)],
                    "refresh_dialogue_index": result.refresh_dialogue_index,
                    "refresh_section_toc": result.refresh_section_toc,
                    "section_scope": result.section_scope,
                    "dialogue_message_count": result.dialogue_message_count,
                    "section_conversation_count": result.section_conversation_count,
                    "heading_count": result.heading_count,
                }
                processed_items = max(result.section_conversation_count, 1)
            elif job.job_type == "offline_package":
                package = build_offline_package(
                    db,
                    job_id=job.id,
                    package_id=uuid.UUID(payload["package_id"]),
                    scope=str(payload["scope"]),
                    conversation_id=uuid.UUID(payload["conversation_id"]) if payload.get("conversation_id") else None,
                    project_id=uuid.UUID(payload["project_id"]) if payload.get("project_id") else None,
                    known_revisions={
                        uuid.UUID(key): int(value)
                        for key, value in dict(payload.get("known_revisions") or {}).items()
                    },
                    include_assets=str(payload.get("include_assets") or "all"),
                    progress_callback=report,
                )
                job_result = {
                    "package_id": str(package.id),
                    "filename": package.filename,
                    "byte_size": package.byte_size,
                    "sha256": package.sha256,
                    "conversation_count": package.conversation_count,
                    "download_url": f"/api/offline/packages/{package.id}/download",
                }
                processed_items = package.conversation_count
            elif job.job_type == "attachment_batch_download":
                conversation_id = uuid.UUID(payload["conversation_id"])
                attachment_ids = [uuid.UUID(value) for value in payload.get("attachment_ids", [])]
                artifact = create_attachment_download(
                    db,
                    conversation_id=conversation_id,
                    attachment_ids=attachment_ids,
                    job_id=job.id,
                    progress_callback=report,
                )
                job_result = {
                    "conversation_id": str(conversation_id),
                    "artifact_id": str(artifact.id),
                    "filename": artifact.filename,
                    "byte_size": artifact.byte_size,
                    "download_url": f"/api/exports/{artifact.id}/download",
                }
                processed_items = len(attachment_ids)
            elif job.job_type == "attachment_derivative":
                derivative = build_asset_derivative(
                    db,
                    attachment_id=uuid.UUID(payload["attachment_id"]),
                    derivative_type=str(payload["derivative_type"]),
                )
                job_result = {
                    "attachment_id": payload["attachment_id"],
                    "derivative_id": str(derivative.id),
                    "derivative_type": derivative.derivative_type,
                }
                processed_items = 1
            else:
                raise ValueError(f"Unsupported background job type: {job.job_type}")
            now = datetime.now(timezone.utc)
            committed_values = {
                "status": "committed",
                "phase": "completed",
                "progress": 100,
                "processed_items": processed_items,
                "result": job_result,
                "heartbeat_at": now,
                "completed_at": now,
                "error_message": None,
            }
            post_commit_cleanup: list[tuple[str, list[Path], Path]] = []
            if job.job_type == "offline_package":
                cleanup_paths = list(getattr(package, "_cleanup_paths", []))
                if cleanup_paths:
                    post_commit_cleanup.append(("offline", cleanup_paths, Path(get_settings().offline_storage_dir)))
            if is_sqlite:
                for key, value in committed_values.items():
                    setattr(job, key, value)
            else:
                updated = (
                    db.query(BackgroundJob)
                    .filter(BackgroundJob.id == job_id, BackgroundJob.status == "processing")
                    .update(committed_values, synchronize_session=False)
                )
                if updated != 1:
                    raise BackgroundJobCancelled("Background job cancellation won the publish race.")
            db.commit()
            if job.job_type in {"system_archive_export", "conversation_export", "attachment_batch_download"}:
                structured_event(logger, logging.INFO, "artifact_db_committed", category="export", job_id=str(job_id))
            elif job.job_type == "offline_package":
                structured_event(logger, logging.INFO, "artifact_db_committed", category="offline", job_id=str(job_id))
            structured_event(
                logger,
                logging.INFO,
                "background_job_committed",
                job_id=str(job_id),
                job_type=job.job_type,
                attempt=job.attempt_count,
            )
            for category, paths, root in post_commit_cleanup:
                cleanup_committed_artifacts(paths, root=root, category=category)
    except BackgroundJobCancelled:
        structured_event(logger, logging.INFO, "background_job_cancelled", job_id=str(job_id))
        with session_factory() as db:
            job = db.get(BackgroundJob, job_id)
            if job is not None and job.status in {"processing", "cancelling"}:
                now = datetime.now(timezone.utc)
                job.status = "cancelled"
                job.phase = "cancelled"
                job.heartbeat_at = now
                job.completed_at = now
                job.error_message = None
                db.commit()
    except Exception as exc:
        structured_event(
            logger,
            logging.ERROR,
            "background_job_failed",
            job_id=str(job_id),
            error_class=type(exc).__name__,
        )
        with session_factory() as db:
            job = db.get(BackgroundJob, job_id)
            if job is not None:
                now = datetime.now(timezone.utc)
                cancelled = job.status in {"cancelling", "cancelled"}
                job.status = "cancelled" if cancelled else "failed"
                job.phase = "cancelled" if cancelled else "failed"
                job.error_message = None if cancelled else _safe_error(exc)
                job.heartbeat_at = now
                job.completed_at = now
                db.commit()


def retry_background_job(job: BackgroundJob) -> BackgroundJob:
    if job.status != "failed":
        return job
    now = datetime.now(timezone.utc)
    job.status = "queued"
    job.phase = "queued"
    job.progress = 0
    job.processed_items = 0
    job.result = {}
    job.error_message = None
    job.queued_at = now
    job.started_at = None
    job.heartbeat_at = None
    job.completed_at = None
    job.attempt_count = 0
    structured_event(logger, logging.INFO, "background_job_manual_retry", job_id=str(job.id), job_type=job.job_type)
    return job


def request_background_job_cancellation(job: BackgroundJob) -> BackgroundJob:
    if job.job_type not in {"conversation_merge", "conversation_batch_delete"}:
        raise MessageEditError("This background task cannot be cancelled.", 409)
    now = datetime.now(timezone.utc)
    if job.status == "queued":
        job.status = "cancelled"
        job.phase = "cancelled"
        job.heartbeat_at = now
        job.completed_at = now
        job.error_message = None
        return job
    if job.status == "processing":
        job.status = "cancelling"
        job.phase = "cancelling"
        job.heartbeat_at = now
        return job
    if job.status in {"cancelling", "cancelled"}:
        return job
    raise MessageEditError("This merge task can no longer be cancelled.", 409)


def _safe_error(exc: Exception) -> str:
    return (str(exc).strip() or exc.__class__.__name__)[:2000]
