"""Single-slot supervisor. Heavy parsers/services live only in its child."""
from datetime import datetime, timezone
import logging
import os
from pathlib import Path
import subprocess
import sys
import threading
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
    db.info["legacy_recovery_needed"] = True
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
        # Both legacy-active queries succeeded and found no recovery inputs.
        # This transaction-local proof avoids a fresh no-op recovery child;
        # unknown/control-blocked/failed reads remain conservative.
        db.info["legacy_recovery_needed"] = False
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
    pipes = {"stdin": subprocess.PIPE, "stdout": subprocess.PIPE} if kind == "standby" else {}
    return subprocess.Popen(command, cwd=Path(__file__).resolve().parents[2],
        env={**os.environ, "CHAT_READER_EXECUTION_PARENT": str(os.getpid())},
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0, **pipes)


class PreparedExecution:
    """One independent, single-use child. No task or execution lease while idle."""
    def __init__(self, process):
        self.process = process
        self.ready = threading.Event()
        self.valid = False
        self._delivery_lock = threading.Lock()
        self._consumed = False
        self._reader = threading.Thread(target=self._read, daemon=True)
        self._reader.start()

    def _read(self):
        try:
            self.valid = self.process.stdout.readline(128) == b"chat-reader-executor-ready-v1\n"
            self.ready.set()
            if self.valid:
                while data := self.process.stdout.read1(65536):
                    # Preserve ordinary child stdout without a blocked pipe;
                    # stderr keeps its original inherited logging destination.
                    try:
                        remaining = memoryview(data)
                        while remaining:
                            written = os.write(sys.stdout.fileno(), remaining)
                            if written <= 0:
                                raise OSError("Child output forwarding stopped")
                            remaining = remaining[written:]
                    except (AttributeError, OSError, ValueError):
                        sys.stdout.write(data.decode("utf-8", errors="replace"))
                        sys.stdout.flush()
        except (OSError, ValueError):
            self.valid = False
        finally:
            self.ready.set()
            self.process.stdout.close()

    def activate(self, kind, task_id, token):
        if kind not in {"import", "job"}:
            raise ValueError("Unsupported prepared execution kind")
        task_id, token = uuid.UUID(str(task_id)), uuid.UUID(str(token))
        with self._delivery_lock:
            if self._consumed:
                raise RuntimeError("Prepared execution has already been consumed")
            self._consumed = True
            try:
                self.process.stdin.write(f"{kind}\t{task_id}\t{token}\n".encode("ascii"))
                self.process.stdin.flush()
            except (BrokenPipeError, OSError):
                # Delivery may have succeeded before the pipe failed. Never
                # start a second executor: reconcile this exact claimed token.
                pass
            finally:
                try:
                    self.process.stdin.close()
                except (BrokenPipeError, OSError):
                    pass
        return self.process

    def close(self):
        with self._delivery_lock:
            self._consumed = True
            try:
                self.process.stdin.close()
            except (BrokenPipeError, OSError):
                pass
        try:
            self.process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            self.process.terminate()
            try:
                self.process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)
        self._reader.join(timeout=2)


def prepare_execution_child(shutdown):
    child = PreparedExecution(spawn("standby", uuid.UUID(int=0), uuid.UUID(int=0)))
    deadline = time.monotonic() + 5
    while not child.ready.wait(timeout=0.05):
        if shutdown.requested or time.monotonic() >= deadline:
            child.close()
            return None
    if shutdown.requested or not child.valid or child.process.poll() is not None:
        child.close()
        return None
    return child


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
        # Keep the same control-check interval while running, but wake on OS
        # exit instead of adding an unconditional idle delay. The scheduling
        # loop must still verify reconciliation and the PostgreSQL lease.
        try:
            child.wait(timeout=0.25)
            return
        except subprocess.TimeoutExpired:
            pass


def reconcile_pending(factory=SessionLocal, *, retire_idle=None):
    with factory() as db:
        bound_worker_transaction(db)
        control = db.get(TaskExecutionControl, SLOT)
        if control is None or control.finished_at:
            return True
        identity = control.task_kind, control.task_id, control.token
    if retire_idle is not None:
        retire_idle()
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


def run_task_worker_forever(*, shutdown=None, prepare_child=None):
    shutdown = shutdown or WorkerShutdown()
    if shutdown.requested:
        return
    # The documented -m launcher uses standby preparation in every environment,
    # not a CI-only warmup. Legacy programmatic callers retain their old path.
    spec = getattr(sys.modules.get("__main__"), "__spec__", None)
    if prepare_child is None and getattr(spec, "name", None) == "app.workers.import_worker":
        prepare_child = prepare_execution_child
    settings = get_settings()
    reporter = WorkerHeartbeatReporter(interval_seconds=settings.worker_heartbeat_interval_seconds)
    last_maintenance = time.monotonic()
    last_recovery = 0.0
    last_execution_exit_at = None
    maintenance_pass = 0
    prepared = None
    reporter_started = False

    def retire_idle():
        nonlocal prepared
        if prepared is not None:
            prepared.close()
            prepared = None

    try:
        if prepare_child is None:
            reporter.start()
            reporter_started = True
        while not shutdown.requested and not reporter.superseded:
            idle_poll_seconds = settings.import_worker_poll_seconds
            try:
                with session_lease(engine, SUPERVISION_LOCK) as guard:
                    if guard is None:
                        retire_idle()
                        shutdown.wait(settings.import_worker_poll_seconds)
                        continue
                    reconciled = (
                        reconcile_pending(retire_idle=retire_idle) if prepared is not None else reconcile_pending()
                    )
                    if not reconciled:
                        shutdown.wait(settings.import_worker_poll_seconds)
                        continue
                    # A continuous user queue must not starve already-authorized
                    # staging cleanup. One bounded helper between executions,
                    # never alongside one, keeps the same resource/slot budget.
                    if time.monotonic() - last_maintenance >= 30:
                        retire_idle()
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
                            retire_idle()
                            shutdown.wait(settings.import_worker_poll_seconds)
                            continue
                        if prepare_child is not None:
                            if prepared is not None and prepared.process.poll() is not None:
                                retire_idle()
                            if prepared is None:
                                prepared = prepare_child(shutdown)
                        if shutdown.requested or reporter.superseded:
                            break
                        if prepare_child is not None and prepared is None:
                            # Standard-launcher readiness failed. Do not
                            # publish a partially cold runtime as idle or
                            # silently replace it with another cold executor.
                            raise OSError("Worker interpreter readiness is unavailable")
                        if not reporter_started:
                            # Idle means the real runtime is ready, including
                            # its idle interpreter, not a partially cold start.
                            reporter.start()
                            reporter_started = True
                        with SessionLocal() as db:
                            identity = claim(db)
                            execution = db.info.get("supervised_execution")
                            legacy_recovery_needed = db.info.get("legacy_recovery_needed", True)
                    if identity:
                        reporter.set_busy(identity[0], identity[1], execution=execution)
                        if prepared is not None:
                            child = prepared.activate(*identity)
                            prepared = None
                        else:
                            child = spawn(*identity)
                        supervise(child, identity[2], reporter, shutdown)
                        last_execution_exit_at = time.monotonic()
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
                            if lane == "recovery" and legacy_recovery_needed is False:
                                last_recovery = time.monotonic()
                                continue
                            retire_idle()
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
                        if (
                            legacy_recovery_needed is False
                            and last_execution_exit_at is not None
                            and 0 <= time.monotonic() - last_execution_exit_at < 5
                        ):
                            # A serial browser batch admits its next child only
                            # after reading/downloading the previous result.
                            # Bound that healthy post-exit handoff to 250ms for
                            # five seconds, without shortening outage/lease/
                            # unknown-state backoff or renewing it on empty reads.
                            idle_poll_seconds = min(idle_poll_seconds, 0.25)
            except (SQLAlchemyError, OSError, subprocess.TimeoutExpired):
                # An unknown database/lease boundary must not retain an idle
                # interpreter prepared under the previous healthy guard.
                retire_idle()
                idle_poll_seconds = settings.import_worker_poll_seconds
                logger.warning("worker_scheduling_paused")
            shutdown.wait(idle_poll_seconds)
    finally:
        retire_idle()
        reporter.stop()
