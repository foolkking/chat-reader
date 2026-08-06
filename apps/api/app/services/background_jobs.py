import logging
import uuid
from collections.abc import Callable
from datetime import datetime, timedelta, timezone

from sqlalchemy import or_
from sqlalchemy.orm import Session, sessionmaker

from app.core.database import SessionLocal
from app.models.background_job import BackgroundJob
from app.models.conversation import Conversation
from app.models.import_record import ImportRecord
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
from app.schemas.export import ExportOptions
from app.services.offline_packages import build_catalog, build_offline_package, changed_conversations, select_conversations
from app.services.derived_rebuild import rebuild_conversation_derived_data
from app.services.import_pipeline.bundle_import import preview_bundle_import
from app.services.assets.derivatives import build_asset_derivative

logger = logging.getLogger(__name__)

ACTIVE_JOB_STATUSES = ("queued", "processing", "cancelling")
MAX_AUTOMATIC_ATTEMPTS = 3
ProgressCallback = Callable[[str, int, int, int], None]


class BackgroundJobCancelled(RuntimeError):
    pass


def queue_bundle_preview(db: Session, *, import_id: uuid.UUID, filename: str) -> BackgroundJob:
    job = BackgroundJob(
        id=uuid.uuid4(),
        job_type="bundle_preview",
        status="queued",
        phase="queued",
        progress=0,
        processed_items=0,
        total_items=0,
        payload={"import_id": str(import_id), "title": filename},
        result={},
        idempotency_key=f"bundle-preview:{import_id}",
    )
    db.add(job)
    db.flush()
    return job


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


def queue_conversation_derived_rebuild(
    db: Session,
    *,
    conversation_id: uuid.UUID,
    idempotency_key: str | None,
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
    job = BackgroundJob(
        id=uuid.uuid4(),
        job_type="conversation_derived_rebuild",
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
    catalog = build_catalog(db)
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
            "catalog_revision": catalog.revision,
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
            continue
        job.status = "queued"
        job.phase = "queued"
        job.queued_at = now
        job.started_at = None
        job.heartbeat_at = None
        job.error_message = "Previous worker stopped before completing; task requeued."
    db.flush()
    return len(jobs)


def claim_next_job(db: Session) -> uuid.UUID | None:
    job = (
        db.query(BackgroundJob)
        .filter(BackgroundJob.status == "queued")
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
    return job.id


def process_background_job(
    job_id: uuid.UUID,
    session_factory: sessionmaker = SessionLocal,
) -> None:
    def persist_report(phase: str, progress: int, processed: int, total: int) -> None:
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

            def report(phase: str, progress: int, processed: int, total: int) -> None:
                if not is_sqlite:
                    persist_report(phase, progress, processed, total)
                    return
                if job.status in {"cancelling", "cancelled"}:
                    raise BackgroundJobCancelled("Background job cancellation requested.")
                if job.status != "processing":
                    raise RuntimeError(f"Background job is no longer processing ({job.status}).")
                job.phase = phase
                job.progress = max(0, min(progress, 99))
                job.processed_items = processed
                job.total_items = total
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
            elif job.job_type == "conversation_derived_rebuild":
                conversation_id = uuid.UUID(payload["conversation_id"])
                result = rebuild_conversation_derived_data(db, conversation_id, progress_callback=report)
                job_result = {
                    "conversation_id": str(conversation_id),
                    "conversation_ids": [str(conversation_id)],
                    "rebuilt_versions": result.rebuilt_versions,
                    "rebuilt_blocks": result.rebuilt_blocks,
                }
                processed_items = result.rebuilt_versions
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
            elif job.job_type == "bundle_preview":
                import_id = uuid.UUID(payload["import_id"])
                preview = preview_bundle_import(db, import_id=import_id, progress_callback=report)
                job_result = {
                    "import_id": str(import_id),
                    "message_count": preview.message_count,
                    "attachment_count": preview.attachment_count,
                    "object_count": preview.object_count,
                    "can_commit": True,
                    "preview_url": f"/api/imports/{import_id}/preview",
                }
                processed_items = preview.object_count
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
    except BackgroundJobCancelled:
        logger.info("Background job %s cancelled", job_id)
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
        logger.exception("Background job %s failed", job_id)
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
                if job.job_type == "bundle_preview" and job.payload.get("import_id"):
                    import_record = db.get(ImportRecord, uuid.UUID(job.payload["import_id"]))
                    if import_record is not None:
                        import_record.status = "failed"
                        import_record.phase = "failed"
                        import_record.progress = 0
                        import_record.error_message = _safe_error(exc)
                        import_record.heartbeat_at = now
                        import_record.completed_at = now
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
    return job


def request_background_job_cancellation(job: BackgroundJob) -> BackgroundJob:
    if job.job_type != "conversation_merge":
        raise MessageEditError("Only conversation merge tasks can be cancelled.", 409)
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
