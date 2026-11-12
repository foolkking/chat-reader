from __future__ import annotations

import logging
import threading
import time
import uuid
from collections.abc import Callable
from datetime import datetime, timezone

from sqlalchemy.orm import Session, sessionmaker

from app.core.database import SessionLocal
from app.core.observability import structured_event
from app.models.background_job import BackgroundJob
from app.models.import_record import ImportRecord
from app.models.worker_runtime_state import WorkerRuntimeState
from app.services.worker_maintenance import bound_worker_transaction

PRIMARY_WORKER_KEY = "primary"
ACTIVE_JOB_STATUSES = ("processing", "cancelling")
TaskExecution = tuple[int, datetime | None, str | None]

logger = logging.getLogger(__name__)


def register_worker(
    db: Session,
    *,
    instance_id: uuid.UUID,
    now: datetime | None = None,
) -> WorkerRuntimeState:
    timestamp = now or datetime.now(timezone.utc)
    row = db.get(WorkerRuntimeState, PRIMARY_WORKER_KEY)
    if row is None:
        row = WorkerRuntimeState(
            worker_key=PRIMARY_WORKER_KEY,
            instance_id=instance_id,
            state="idle",
            task_kind=None,
            started_at=timestamp,
            heartbeat_at=timestamp,
        )
        db.add(row)
    else:
        row.instance_id = instance_id
        row.state = "idle"
        row.task_kind = None
        row.started_at = timestamp
        row.heartbeat_at = timestamp
    db.flush()
    return row


def pulse_worker(
    db: Session,
    *,
    instance_id: uuid.UUID,
    state: str,
    task_kind: str | None,
    now: datetime | None = None,
) -> bool:
    if state not in {"idle", "busy"}:
        raise ValueError(f"Unsupported worker state: {state}")
    if task_kind not in {None, "import", "job"}:
        raise ValueError(f"Unsupported worker task kind: {task_kind}")
    if state == "idle" and task_kind is not None:
        raise ValueError("An idle worker cannot own an active task.")
    if state == "busy" and task_kind is None:
        raise ValueError("A busy worker requires an active task kind.")

    timestamp = now or datetime.now(timezone.utc)
    updated = (
        db.query(WorkerRuntimeState)
        .filter(
            WorkerRuntimeState.worker_key == PRIMARY_WORKER_KEY,
            WorkerRuntimeState.instance_id == instance_id,
        )
        .update(
            {
                WorkerRuntimeState.state: state,
                WorkerRuntimeState.task_kind: task_kind,
                WorkerRuntimeState.heartbeat_at: timestamp,
            },
            synchronize_session=False,
        )
    )
    if updated != 1:
        return False
    db.flush()
    return True


def refresh_active_task_heartbeat(
    db: Session,
    *,
    task_kind: str,
    task_id: uuid.UUID,
    now: datetime | None = None,
    execution: TaskExecution | None = None,
) -> bool:
    timestamp = now or datetime.now(timezone.utc)
    if task_kind == "job":
        model = BackgroundJob
        query = db.query(BackgroundJob).filter(
            BackgroundJob.id == task_id, BackgroundJob.status.in_(ACTIVE_JOB_STATUSES),
        )
        if execution is not None:
            query = query.filter(
                BackgroundJob.attempt_count == execution[0],
                BackgroundJob.started_at == execution[1],
                BackgroundJob.payload["execution_token"].as_string() == execution[2],
            )
    elif task_kind == "import":
        model = ImportRecord
        query = db.query(ImportRecord).filter(
            ImportRecord.id == task_id, ImportRecord.status == "processing",
        )
        if execution is not None:
            query = query.filter(ImportRecord.attempt_count == execution[0], ImportRecord.started_at == execution[1])
    else:
        raise ValueError(f"Unsupported worker task kind: {task_kind}")
    # Canonical work may hold this row while calling an auxiliary progress
    # writer. Do not join that lock queue or stall the worker's liveness lane.
    # Lock only the ID; keep the status/execution predicates on the write too.
    if query.with_entities(model.id).with_for_update(skip_locked=True).first() is None:
        return False
    updated = query.update({model.heartbeat_at: timestamp}, synchronize_session=False)
    db.flush()
    return updated == 1


class WorkerHeartbeatReporter:
    def __init__(
        self,
        *,
        interval_seconds: float,
        session_factory: sessionmaker = SessionLocal,
        instance_id: uuid.UUID | None = None,
        wait: Callable[[float], bool] | None = None,
        maintenance: Callable[[], None] | None = None,
    ) -> None:
        self.interval_seconds = interval_seconds
        self.instance_id = instance_id or uuid.uuid4()
        self._session_factory = session_factory
        self._stop_event = threading.Event()
        self._wait = wait or self._stop_event.wait
        self._maintenance = maintenance
        self._maintenance_wake = threading.Event()
        self._maintenance_lock = threading.Lock()
        self._maintenance_running = False
        self._maintenance_thread: threading.Thread | None = None
        self._state_lock = threading.Lock()
        self._publish_lock = threading.Lock()
        self._state = "idle"
        self._task_kind: str | None = None
        self._task_id: uuid.UUID | None = None
        self._execution: TaskExecution | None = None
        self._registered = False
        self._worker_failure_active = False
        self._task_failure_active = False
        self._superseded = False
        self._thread: threading.Thread | None = None

    @property
    def superseded(self) -> bool:
        return self._superseded

    def start(self) -> None:
        if self._thread is not None or self._stop_event.is_set():
            return
        self.pulse()
        if self._maintenance is not None and not self._superseded:
            self._maintenance_thread = threading.Thread(
                target=self._run_maintenance, name="worker-maintenance", daemon=True,
            )
            self._maintenance_thread.start()
        self._thread = threading.Thread(target=self._run, name="worker-heartbeat", daemon=True)
        self._thread.start()
        structured_event(
            logger,
            logging.INFO,
            "worker_heartbeat_started",
            interval_seconds=self.interval_seconds,
        )

    def stop(self) -> None:
        self._stop_event.set()
        self._maintenance_wake.set()
        deadline = time.monotonic() + max(1.0, self.interval_seconds)
        for thread in (self._thread, self._maintenance_thread):
            if thread is not None and thread is not threading.current_thread():
                thread.join(timeout=max(0.0, deadline - time.monotonic()))

    @property
    def maintenance_allowed(self) -> bool:
        return (self._registered and not self._superseded
                and not self._worker_failure_active and not self._stop_event.is_set())

    def set_busy(self, task_kind: str, task_id: uuid.UUID, *, execution: TaskExecution | None = None) -> bool:
        with self._state_lock:
            self._state = "busy"
            self._task_kind = task_kind
            self._task_id = task_id
            self._execution = execution
        return self.pulse()

    def set_idle(self) -> bool:
        with self._state_lock:
            changed = self._state != "idle" or self._task_kind is not None or self._task_id is not None
            self._state = "idle"
            self._task_kind = None
            self._task_id = None
            self._execution = None
        if changed:
            return self.pulse()
        return not self._superseded

    def pulse(self, *, now: datetime | None = None) -> bool:
        if self._superseded:
            return False
        with self._publish_lock:
            with self._state_lock:
                state = self._state
                task_kind = self._task_kind
                task_id = self._task_id
                execution = self._execution
            try:
                with self._session_factory() as db:
                    bound_worker_transaction(db)
                    if not self._registered:
                        register_worker(db, instance_id=self.instance_id, now=now)
                        if state == "busy":
                            pulse_worker(
                                db,
                                instance_id=self.instance_id,
                                state=state,
                                task_kind=task_kind,
                                now=now,
                            )
                    else:
                        current = pulse_worker(
                            db,
                            instance_id=self.instance_id,
                            state=state,
                            task_kind=task_kind,
                            now=now,
                        )
                        if not current:
                            self._superseded = True
                            structured_event(logger, logging.WARNING, "worker_heartbeat_superseded")
                            return False
                    db.commit()
                self._registered = True
                if self._worker_failure_active:
                    structured_event(logger, logging.INFO, "worker_heartbeat_recovered")
                self._worker_failure_active = False
            except Exception as exc:
                if not self._worker_failure_active:
                    structured_event(
                        logger,
                        logging.WARNING,
                        "worker_heartbeat_write_failed",
                        error_class=type(exc).__name__,
                    )
                self._worker_failure_active = True
                return False
            if state == "busy" and task_kind is not None and task_id is not None:
                try:
                    with self._session_factory() as task_db:
                        bound_worker_transaction(task_db)
                        refresh_active_task_heartbeat(
                            task_db,
                            task_kind=task_kind,
                            task_id=task_id,
                            now=now,
                            execution=execution,
                        )
                        task_db.commit()
                    if self._task_failure_active:
                        structured_event(logger, logging.INFO, "worker_task_heartbeat_recovered")
                    self._task_failure_active = False
                except Exception as exc:
                    if not self._task_failure_active:
                        structured_event(
                            logger,
                            logging.WARNING,
                            "worker_task_heartbeat_write_failed",
                            error_class=type(exc).__name__,
                        )
                    self._task_failure_active = True
            return True

    def _run(self) -> None:
        while not self._wait(self.interval_seconds):
            if not self.pulse():
                if self._superseded:
                    return
                continue
            if self._maintenance is not None and self.maintenance_allowed:
                with self._maintenance_lock:
                    # Coalesce idle requests; never queue another pass behind
                    # a slow one or run filesystem work on the heartbeat lane.
                    if not self._maintenance_running:
                        self._maintenance_wake.set()

    def _run_maintenance(self) -> None:
        while True:
            self._maintenance_wake.wait()
            with self._maintenance_lock:
                self._maintenance_wake.clear()
                if self._stop_event.is_set() or self._superseded:
                    return
                if not self.maintenance_allowed:
                    continue
                self._maintenance_running = True
            try:
                if self._maintenance is not None and self.maintenance_allowed:
                    self._maintenance()
            except Exception as exc:
                structured_event(logger, logging.WARNING, "worker_export_maintenance_failed",
                                 error_class=type(exc).__name__)
            finally:
                with self._maintenance_lock:
                    self._maintenance_running = False
