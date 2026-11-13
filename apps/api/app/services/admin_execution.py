"""Root's bounded execution control. No canonical writes, replay or file deletion."""
from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException
from pydantic import ValidationError

from app.models.administration import AdminAuditLog
from app.models.background_job import BackgroundJob
from app.models.import_record import ImportRecord
from app.models.task_execution_control import TaskExecutionControl
from app.models.user import User
from app.schemas.admin_runtime import AdminExecutionIdentity
from app.services.administration import record_admin_audit
from app.services.execution_control import SLOT, request_stop
from app.services.worker_maintenance import bound_worker_transaction

ACTION = "TASK_EXECUTION_STOP_REQUESTED"
ACTIVE = {"processing", "cancelling"}
STATUSES = ACTIVE | {"queued", "committed", "failed", "cancelled", "paused", "previewed", "analyzing"}
FAMILIES = {
    "adaptive_import_analysis": "import", "conversation_merge": "merge",
    "conversation_export": "export", "conversation_batch_export": "export",
    "system_archive_export": "export", "personal_archive_export": "export",
    "attachment_batch_download": "export", "offline_package": "offline",
    "system_archive_preflight": "restore", "system_archive_restore": "restore",
    "personal_archive_preflight": "restore", "personal_archive_restore": "restore",
    "conversation_batch_delete": "delete", "user_account_delete": "delete",
    "conversation_derived_rebuild": "rebuild", "toc_refresh": "rebuild",
    "attachment_derivative": "rebuild", "personal_search_backfill": "rebuild",
    "support_notification": "notification", "content_noise_scan": "cleanup",
    "conversation_auto_clean": "cleanup", "conversation_delete_cleanup": "cleanup",
    "context_object_cleanup": "cleanup", "skill_object_cleanup": "cleanup",
    "context_return": "context",
}


def _identity(control):
    return AdminExecutionIdentity(task_kind=control.task_kind, task_id=control.task_id,
        execution_token=control.token, attempt=control.attempt)


def _matches(control, identity):
    return bool(control and control.token == identity.execution_token
        and control.task_kind == identity.task_kind and control.task_id == identity.task_id
        and control.attempt == identity.attempt)


def _receipt(db, actor_id, identity=None):
    query = db.query(AdminAuditLog).filter_by(actor_user_id=actor_id, action=ACTION, resource_type="task_execution")
    if identity:
        query = query.filter_by(resource_id=str(identity.execution_token))
    return query.order_by(AdminAuditLog.created_at.desc(), AdminAuditLog.id.desc()).first()


def _receipt_identity(receipt):
    if receipt is None:
        return None
    try:
        return AdminExecutionIdentity.model_validate({
            **{key: receipt.event_metadata.get(key) for key in ("task_kind", "task_id", "attempt")},
            "execution_token": receipt.resource_id,
        })
    except (ValidationError, TypeError):
        return None


def _utc(value):
    return value.replace(tzinfo=timezone.utc) if value and value.tzinfo is None else value


def execution_result(db, actor_id, identity, *, control=None):
    bound_worker_transaction(db)
    control = control if control is not None else db.get(TaskExecutionControl, SLOT)
    model = ImportRecord if identity.task_kind == "import" else BackgroundJob
    # Never hydrate payloads, filenames, errors or imported bodies for diagnostics.
    columns = [model.id, model.owner_user_id, model.status, model.attempt_count, model.started_at]
    if model is BackgroundJob:
        columns.append(model.job_type)
    task = db.query(*columns).filter(model.id == identity.task_id).one_or_none()
    receipt = _receipt(db, actor_id, identity)
    recorded = receipt is not None and _receipt_identity(receipt) == identity
    matches = _matches(control, identity)
    started_at = control.started_at if matches else None
    if started_at is None and recorded:
        try:
            started_at = datetime.fromisoformat(receipt.event_metadata["execution_started_at"])
        except (KeyError, TypeError, ValueError):
            pass
    # Manual retry resets attempt_count. Without the execution's start boundary,
    # a later attempt=1 could falsely look like the old stopped task succeeded.
    same_attempt = (task is not None and task.attempt_count == identity.attempt
        and started_at is not None and _utc(task.started_at) == _utc(started_at))
    status = ("cancelled" if task.status == "canceled" else task.status) if same_attempt else None
    status = status if status in STATUSES else None
    now = datetime.now(timezone.utc)
    age = None
    if matches:
        progress = control.progress_at
        if progress.tzinfo is None:
            progress = progress.replace(tzinfo=timezone.utc)
        age = max(0, int((now - progress).total_seconds()))
    if not matches:
        state = "changed"
    elif control.finished_at:
        state = "finished"
    elif not same_attempt or status not in ACTIVE:
        state = "reconciling"
    elif control.stop_requested_at:
        state = "stopping"
    else:
        state = "stalled" if age >= 300 else "running"
    owner = None
    if task and task.owner_user_id:
        user = db.query(User.id, User.display_name, User.normalized_email).filter(User.id == task.owner_user_id).one_or_none()
        if user:
            owner = {"id": str(user.id), "label": (user.display_name or user.normalized_email)[:200]}
    return {
        "identity": identity.model_dump(mode="json"), "state": state,
        "canonical_status": status, "owner": owner,
        "family": "import" if identity.task_kind == "import" else FAMILIES.get(task.job_type, "other") if task else "other",
        "started_at": task.started_at if same_attempt else None, "progress_age_seconds": age,
        "stop_allowed": state in {"running", "stalled"},
        "stop_requested_at": control.stop_requested_at if matches else None,
        "stop_recorded_at": receipt.created_at if recorded else None,
        "source_disposition": control.source_disposition if matches and control.stop_requested_at else "retain" if recorded else None,
    }


def execution_snapshot(db, actor_id):
    bound_worker_transaction(db)
    control = db.get(TaskExecutionControl, SLOT)
    current = execution_result(db, actor_id, _identity(control), control=control) if control and not control.finished_at else None
    previous = _receipt_identity(_receipt(db, actor_id))
    last_stop = execution_result(db, actor_id, previous, control=control) if previous else None
    # An old worker's row without a control record is not safe to reset/stop here.
    untracked = False
    if current is None:
        untracked = any(db.query(model.id).filter(model.status.in_(ACTIVE)).first() is not None
            for model in (BackgroundJob, ImportRecord))
    return {"current": current, "last_stop": last_stop, "untracked": untracked}


def stop_execution(db, actor_id, identity, *, request_id=None):
    bound_worker_transaction(db)
    control = db.query(TaskExecutionControl).filter_by(slot=SLOT).with_for_update(nowait=True).populate_existing().one_or_none()
    if not _matches(control, identity) or control.finished_at:
        raise HTTPException(409, detail={"code": "TASK_EXECUTION_CHANGED", "next_action": "check_result"})
    result = execution_result(db, actor_id, identity, control=control)
    if result["state"] not in {"running", "stalled", "stopping"}:
        raise HTTPException(409, detail={"code": "TASK_EXECUTION_CHANGED", "next_action": "check_result"})
    if control.stop_requested_at is None:
        request_stop(db, control, reason="admin", disposition="retain")
        # Audit and stop are one transaction; replay of this exact execution is a no-op.
        record_admin_audit(db, actor_user_id=actor_id, action=ACTION, resource_type="task_execution",
            resource_id=identity.execution_token,
            target_user_id=UUID(result["owner"]["id"]) if result["owner"] else None,
            metadata={**identity.model_dump(mode="json", exclude={"execution_token"}),
                      "execution_started_at": _utc(control.started_at).isoformat()}, request_id=request_id)
    # Capture before COMMIT, so serialization cannot access an expired ORM row.
    result = execution_result(db, actor_id, identity, control=control)
    db.commit()
    return result
