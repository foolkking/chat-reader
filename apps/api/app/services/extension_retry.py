"""Retry retained device imports; never infer consent or repeat canonical writes."""
from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select

from app.core.config import get_settings
from app.models.background_job import BackgroundJob
from app.models.import_record import ImportRecord
from app.models.reader_extension import ExtensionDevice
from app.models.task_execution_control import TaskExecutionControl
from app.services import extension_access as access
from app.services.adaptive_import.service import queue_session_analysis, session_recovery_status
from app.services.background_jobs import retry_background_job
from app.services.execution_control import SLOT
from app.services.feature_policies import get_feature_policy
from app.services.worker_maintenance import bound_worker_transaction


def _review_required():
    raise HTTPException(409, detail={
        "code": "EXTENSION_IMPORT_RETRY_REVIEW",
        "message": "Reopen the existing import in Reader to review or repair it.",
        "next_action": "open_reader",
    })


def retry(db, auth, iid):
    bound_worker_transaction(db)
    record = db.scalar(select(ImportRecord).where(
        ImportRecord.id == iid, ImportRecord.owner_user_id == auth.user_id))
    if not record or (record.analysis_summary or {}).get("extension_device") != str(auth.session_id):
        raise HTTPException(404)
    if not get_settings().reader_extension_capture or not get_feature_policy(db).allow_user_import:
        raise HTTPException(403, "User import is disabled.")
    try:
        jid = UUID(str((record.analysis_summary or {}).get("analysis_task_id")))
    except (ValueError, TypeError):
        _review_required()
    # Match analysis retry/cancellation: job first, then refresh its record.
    # Do not queue over an old worker or over a replacement selected elsewhere.
    job = db.scalar(select(BackgroundJob).where(BackgroundJob.id == jid,
        BackgroundJob.owner_user_id == auth.user_id, BackgroundJob.job_type == "adaptive_import_analysis")
        .with_for_update(skip_locked=True).execution_options(populate_existing=True))
    if job is None:
        _review_required()
    record = db.scalar(select(ImportRecord).where(ImportRecord.id == iid)
                       .with_for_update(skip_locked=True).execution_options(populate_existing=True))
    if record is None:
        _review_required()
    summary = record.analysis_summary or {}
    if record.owner_user_id != auth.user_id or summary.get("extension_device") != str(auth.session_id):
        raise HTTPException(404)
    if (summary.get("analysis_task_id") != str(jid)
            or (job.payload or {}).get("import_id") != str(iid)
            or record.committed_at is not None or record.conversation_id is not None
            or (record.status, record.session_state) not in {("failed", "FAILED"), ("paused", "PAUSED")}
            or summary.get("append_only") or (job.payload or {}).get("operation")
            or job.status not in {"failed", "cancelled", "committed"}
            or summary.get("extension_transfer") and not summary["extension_transfer"].get("accepted")):
        _review_required()
    control = db.get(TaskExecutionControl, SLOT)
    if control and control.task_id in {iid, jid} and control.finished_at is None:
        raise HTTPException(409, detail={"code": "TASK_EXECUTION_STOPPING",
                                        "message": "The previous execution has not released its slot yet."})
    recovery = session_recovery_status(record)
    if not recovery["source_available"]:
        _review_required()
    analysis_retry = record.phase == "analysis_failed" and job.status == "failed"
    paused = record.session_state == "PAUSED" and job.status == "cancelled"
    rebuild = (record.status == "failed" and record.phase != "analysis_failed"
               and job.status == "committed" and "rebuild_preview" in recovery["allowed_actions"])
    if not (analysis_retry or paused or rebuild):
        _review_required()
    # Revalidate the device after waiting for task locks. The worker and the
    # later explicit commit still repeat authorization and all source checks.
    grant = db.scalar(select(ExtensionDevice).where(ExtensionDevice.id == auth.session_id)
                      .with_for_update().execution_options(populate_existing=True))
    user = access.principal_for(db, grant)
    now = datetime.now(timezone.utc)
    if (user.id != auth.user_id or not access.alive(grant.access_until, now)
            or not access.alive(grant.expires_at, now)):
        raise HTTPException(401, "Reconnect the extension.")
    if analysis_retry:
        retry_background_job(job)
    else:
        previous = (summary.get("pause") or {}).get("previous_state", "COLLECTING")
        job = queue_session_analysis(db, record, rebuild_preview=rebuild)
        if paused:
            job.payload = {**job.payload, "resume_session": True, "previous_state": previous}
    # retry_background_job refreshes the locked record itself. Clear consent
    # afterwards so that refresh cannot restore a previously approved decision.
    record.analysis_summary = {key: value for key, value in (record.analysis_summary or {}).items()
                               if key != "extension_decision"}
    record.attempt_count = 0
    db.commit()
    db.refresh(record)
    return {"id": record.id, "state": record.session_state, "status": record.status, "phase": record.phase}
