"""Run only after the old executor has exited or while owning its execution lease."""
from datetime import datetime, timezone
from app.models.background_job import BackgroundJob
from app.models.import_record import ImportRecord
from app.models.task_execution_control import TaskExecutionControl
from app.services.worker_maintenance import bound_worker_transaction
from app.services.execution_control import SLOT


def reconcile(kind, task_id, token, factory):
    with factory() as db:
        bound_worker_transaction(db)
        control = db.query(TaskExecutionControl).filter_by(slot=SLOT, token=token).with_for_update(skip_locked=True).one_or_none()
        if control is None:
            return False
        if control.finished_at:
            return True
        model = ImportRecord if kind == "import" else BackgroundJob
        row = db.query(model).filter_by(id=task_id).with_for_update(skip_locked=True).one_or_none()
        if row is None:
            # Do not confuse a locked existing row with a deleted one.
            if db.get(model, task_id) is not None:
                return False
        elif row.attempt_count == control.attempt and row.status in {"processing", "cancelling"}:
            now = datetime.now(timezone.utc)
            # An administrator interrupts an executor, not the owner's intent.
            # Keep failed work in its existing explicit retry flow; do not turn
            # deletion/restore into a terminal cancellation with no recovery.
            cancelled = control.stop_reason == "user" or row.status == "cancelling"
            row.status = row.phase = "cancelled" if cancelled else "failed"
            row.completed_at = row.heartbeat_at = now
            row.error_message = None if cancelled else ("TASK_STALLED" if control.stop_reason == "stalled" else "TASK_EXECUTION_INTERRUPTED")
            if kind == "import":
                row.session_state = "READY" if cancelled else "FAILED"
            else:
                from app.services.background_jobs import _sync_adaptive_import_record_after_job
                if row.job_type == "support_notification":
                    from app.services.support_notifications import recover_notification
                    recover_notification(db, row)
                else:
                    if row.job_type == "user_account_delete":
                        from app.services.user_deletion import mark_user_deletion_failed
                        mark_user_deletion_failed(db, row.id)
                    row.payload = {**(row.payload or {}), "source_disposition": control.source_disposition or "retain"}
                    _sync_adaptive_import_record_after_job(db, row, status=row.status, now=now)
                    from app.services.exporting.system_archive_jobs import SYSTEM_JOB_TYPES, sync_system_archive_record
                    if row.job_type in SYSTEM_JOB_TYPES:
                        sync_system_archive_record(db, row, status="CANCELLED" if cancelled else "FAILED")
        # A canonical terminal result (including a resource deferral) wins over
        # a late stop request. Never overwrite it or repeat its business work.
        control.finished_at = datetime.now(timezone.utc)
        db.commit()
        return True
