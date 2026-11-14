"""Single-slot supervisor. Heavy parsers/services live only in its child."""
from datetime import datetime, timezone
import logging
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid

from sqlalchemy.exc import SQLAlchemyError

from app.core.config import get_settings
from app.core.database import SessionLocal, engine
from app.models.background_job import BackgroundJob
from app.models.import_record import ImportRecord
from app.models.task_execution_control import TaskExecutionControl
from app.services.adaptive_import.resource_wait import eligible, finish_wait
from app.services.execution_control import SLOT, SUPERVISION_LOCK, EXECUTION_LOCK, request_stop, session_lease
from app.services.worker_liveness import WorkerHeartbeatReporter
from app.services.worker_maintenance import bound_worker_transaction
from app.workers.shutdown import WorkerShutdown

logger = logging.getLogger(__name__)
STALL_SECONDS = 300
STOP_GRACE_SECONDS = 30


def claim(db):
    bound_worker_transaction(db)
    current = db.get(TaskExecutionControl, SLOT)
    if current is not None and current.finished_at is None:
        return None
    # Upgrade/restart can leave a legacy execution without a control record.
    # Let bounded stale recovery verify its own lease first. Never bypass it
    # simply because this new supervisor has a free control slot.
    for model in (ImportRecord, BackgroundJob):
        if db.query(model.id).filter(model.status.in_(("processing", "cancelling"))).first() is not None:
            return None
    candidates = []
    for kind, model in (("import", ImportRecord), ("job", BackgroundJob)):
        query = db.query(model).filter(model.status == "queued", eligible(model))
        # Noise review remains lower priority than user work.
        if kind == "job":
            query = query.order_by((model.job_type == "content_noise_scan").asc())
        row = query.order_by(model.queued_at, model.created_at, model.id).with_for_update(skip_locked=True).first()
        if row:
            candidates.append((kind, row))
    if not candidates:
        return None
    kind, task = min(candidates, key=lambda value: (
        getattr(value[1], "job_type", "") == "content_noise_scan",
        value[1].queued_at or value[1].created_at,
    ))
    now = datetime.now(timezone.utc)
    token = uuid.uuid4()
    finish_wait(task, "analysis_summary" if kind == "import" else "result")
    task.status, task.phase = "processing", "parsing" if kind == "import" else "validating"
    task.started_at = task.heartbeat_at = now
    task.error_message = None
    task.attempt_count += 1
    task.progress = max(1, task.progress)
    if kind == "import":
        task.session_state = "IMPORTING"
    else:
        task.payload = {**(task.payload or {}), "execution_token": token.hex}
        from app.services.exporting.archive_task_status import SYSTEM_JOB_TYPES, sync_system_archive_record
        if task.job_type in SYSTEM_JOB_TYPES:
            sync_system_archive_record(db, task, status="RUNNING")
    if current is None:
        current = TaskExecutionControl(slot=SLOT)
        db.add(current)
    current.token, current.task_kind, current.task_id = token, kind, task.id
    current.attempt, current.started_at, current.progress_at = task.attempt_count, now, now
    current.stop_requested_at = current.stop_reason = current.finished_at = current.source_disposition = None
    db.info["supervised_execution"] = (task.attempt_count, now, token.hex if kind == "job" else None)
    db.commit()
    return kind, task.id, token


def spawn(kind, task_id, token, *, reconcile=False):
    command = [sys.executable, "-m", "app.workers.execution_child", kind, str(task_id), str(token)]
    if reconcile:
        command.append("--reconcile")
    return subprocess.Popen(command, cwd=Path(__file__).resolve().parents[2],
        env={**os.environ, "CHAT_READER_EXECUTION_PARENT": str(os.getpid())},
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)


def _seconds(value):
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - value).total_seconds()


def supervise(child, token, reporter, shutdown, *, factory=SessionLocal,
              stall_seconds=STALL_SECONDS, grace_seconds=STOP_GRACE_SECONDS):
    """Never claims another task. Even DB outage cannot make it double-execute."""
    stop_started = None
    unavailable_reported = False
    while child.poll() is None:
        try:
            with factory() as db:
                bound_worker_transaction(db)
                control = db.query(TaskExecutionControl).filter_by(slot=SLOT, token=token).with_for_update(skip_locked=True).one_or_none()
                if control is not None:
                    if shutdown.requested or reporter.superseded:
                        request_stop(db, control, "shutdown")
                    elif _seconds(control.progress_at) >= stall_seconds:
                        request_stop(db, control, "stalled")
                    if control.stop_requested_at and stop_started is None:
                        stop_started = time.monotonic()
                    db.commit()
                unavailable_reported = False
        except SQLAlchemyError:
            # Scheduling stays paused. A stop already observed still has its
            # finite local grace period even when PostgreSQL goes offline.
            if not unavailable_reported:
                logger.warning("execution_control_unavailable")
                unavailable_reported = True
        if (shutdown.requested or reporter.superseded) and stop_started is None:
            stop_started = time.monotonic()
        if stop_started is not None and time.monotonic() - stop_started >= grace_seconds:
            child.terminate()
            try:
                child.wait(timeout=2)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=5)
            return
        time.sleep(0.25)


def reconcile_pending(factory=SessionLocal):
    with factory() as db:
        bound_worker_transaction(db)
        control = db.get(TaskExecutionControl, SLOT)
        if control is None or control.finished_at:
            return True
        identity = control.task_kind, control.task_id, control.token
    # A dead parent / replacement worker must verify the old database lease,
    # not just a PID or a stale heartbeat. No user job can start in this gap.
    with session_lease(engine, EXECUTION_LOCK) as lease:
        if lease is None:
            with factory() as db:
                bound_worker_transaction(db)
                row = db.query(TaskExecutionControl).filter_by(slot=SLOT, token=identity[2]).with_for_update(skip_locked=True).one_or_none()
                if row:
                    request_stop(db, row, "supervisor_replaced")
                    db.commit()
            return False
    child = spawn(*identity, reconcile=True)
    try:
        child.wait(timeout=15)
    except subprocess.TimeoutExpired:
        child.kill()
        child.wait(timeout=5)
        return False
    if child.returncode != 0:
        return False
    with factory() as db:
        bound_worker_transaction(db)
        control = db.get(TaskExecutionControl, SLOT)
        return bool(control and control.token == identity[2] and control.finished_at)


def run_task_worker_forever(*, shutdown=None):
    shutdown = shutdown or WorkerShutdown()
    if shutdown.requested:
        return
    settings = get_settings()
    reporter = WorkerHeartbeatReporter(interval_seconds=settings.worker_heartbeat_interval_seconds)
    last_maintenance = time.monotonic()
    last_recovery = 0.0
    maintenance_pass = 0
    try:
        reporter.start()
        while not shutdown.requested and not reporter.superseded:
            try:
                with session_lease(engine, SUPERVISION_LOCK) as guard:
                    if guard is None or not reconcile_pending():
                        shutdown.wait(settings.import_worker_poll_seconds)
                        continue
                    # A continuous user queue must not starve already-authorized
                    # staging cleanup. One bounded helper between executions,
                    # never alongside one, keeps the same resource/slot budget.
                    if time.monotonic() - last_maintenance >= 30:
                        helper = spawn("maintenance", uuid.UUID(int=maintenance_pass), uuid.UUID(int=0))
                        maintenance_pass = (maintenance_pass + 1) % 4
                        try:
                            helper.wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            helper.kill()
                            helper.wait(timeout=5)
                        finally:
                            last_maintenance = time.monotonic()
                        if helper.returncode != 0:
                            logger.warning("worker_maintenance_deferred")
                    # OS process exit does not immediately release PostgreSQL's
                    # backend lease. This also fences a just-terminated helper.
                    with session_lease(engine, EXECUTION_LOCK) as idle_lease:
                        if idle_lease is None:
                            shutdown.wait(settings.import_worker_poll_seconds)
                            continue
                        with SessionLocal() as db:
                            identity = claim(db)
                            execution = db.info.get("supervised_execution")
                    if identity:
                        reporter.set_busy(identity[0], identity[1], execution=execution)
                        child = spawn(*identity)
                        supervise(child, identity[2], reporter, shutdown)
                        # Canonical outcome and lock release are checked on
                        # the next iteration before any further admission.
                        # Do not add an idle poll after real execution; an
                        # empty or unavailable lane still backs off below.
                        continue
                    else:
                        reporter.set_idle()
                        # Housekeeping never owns a second user slot. Isolate
                        # Recovery is only eligible without a canonical user
                        # execution. A legacy live owner still blocks admission.
                        for lane, due in (("recovery", last_recovery),):
                            if shutdown.requested or time.monotonic() - due <= 30:
                                continue
                            helper = spawn(lane, uuid.UUID(int=maintenance_pass if lane == "maintenance" else 0), uuid.UUID(int=0))
                            if lane == "maintenance":
                                maintenance_pass = (maintenance_pass + 1) % 4
                            try:
                                helper.wait(timeout=5)
                            except subprocess.TimeoutExpired:
                                helper.kill()
                                helper.wait(timeout=5)
                                raise
                            if helper.returncode != 0:
                                raise OSError("Worker housekeeping is unavailable")
                            if lane == "recovery":
                                last_recovery = time.monotonic()
                            else:
                                last_maintenance = time.monotonic()
            except (SQLAlchemyError, OSError, subprocess.TimeoutExpired):
                logger.warning("worker_scheduling_paused")
            shutdown.wait(settings.import_worker_poll_seconds)
    finally:
        reporter.stop()
