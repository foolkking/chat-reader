import logging
import uuid
from collections.abc import Callable
from datetime import datetime, timedelta, timezone

from sqlalchemy import or_
from sqlalchemy.orm import Session, sessionmaker

from app.core.database import SessionLocal
from app.models.background_job import BackgroundJob
from app.models.conversation import Conversation
from app.models.project import Project
from app.services.editing.message_edit_service import MessageEditError, merge_conversations

logger = logging.getLogger(__name__)

ACTIVE_JOB_STATUSES = ("queued", "processing")
ProgressCallback = Callable[[str, int, int, int], None]


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


def recover_stale_jobs(db: Session, stale_after_seconds: int) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=stale_after_seconds)
    jobs = (
        db.query(BackgroundJob)
        .filter(
            BackgroundJob.status == "processing",
            or_(BackgroundJob.heartbeat_at.is_(None), BackgroundJob.heartbeat_at < cutoff),
        )
        .all()
    )
    now = datetime.now(timezone.utc)
    for job in jobs:
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
            if job is None or job.status != "processing":
                return
            job.phase = phase
            job.progress = max(0, min(progress, 99))
            job.processed_items = processed
            job.total_items = total
            job.heartbeat_at = datetime.now(timezone.utc)
            progress_db.commit()

    try:
        with session_factory() as db:
            job = db.get(BackgroundJob, job_id)
            if job is None or job.status != "processing":
                return
            if job.job_type != "conversation_merge":
                raise ValueError(f"Unsupported background job type: {job.job_type}")
            payload = job.payload or {}
            conversation_ids = [uuid.UUID(value) for value in payload.get("conversation_ids", [])]
            project_value = payload.get("project_id")
            project_id = uuid.UUID(project_value) if project_value else None
            is_sqlite = db.get_bind().dialect.name == "sqlite"

            def report(phase: str, progress: int, processed: int, total: int) -> None:
                if not is_sqlite:
                    persist_report(phase, progress, processed, total)
                    return
                job.phase = phase
                job.progress = max(0, min(progress, 99))
                job.processed_items = processed
                job.total_items = total
                job.heartbeat_at = datetime.now(timezone.utc)

            report("validating", 5, 0, job.total_items)
            result = merge_conversations(
                db=db,
                conversation_ids=conversation_ids,
                title=payload.get("title"),
                project_id=project_id,
                progress_callback=report,
            )
            now = datetime.now(timezone.utc)
            job.status = "committed"
            job.phase = "completed"
            job.progress = 100
            job.processed_items = result.message_count
            job.total_items = result.message_count
            job.result = {
                "conversation_ids": [str(result.conversation.id)],
                "conversation_id": str(result.conversation.id),
                "title": result.conversation.display_title,
                "message_count": result.message_count,
            }
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
                job.status = "failed"
                job.phase = "failed"
                job.error_message = _safe_error(exc)
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
    return job


def _safe_error(exc: Exception) -> str:
    return (str(exc).strip() or exc.__class__.__name__)[:2000]
