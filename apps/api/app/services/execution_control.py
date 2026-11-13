"""Small control plane. Never locks the canonical task from a progress callback."""
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import time

from sqlalchemy import event, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.models.task_execution_control import TaskExecutionControl
from app.services.worker_maintenance import bound_worker_transaction

SLOT = "primary"
EXECUTION_LOCK = int.from_bytes(hashlib.sha256(b"chat-reader:single-executor:v1").digest()[:8], "big", signed=True)
SUPERVISION_LOCK = int.from_bytes(hashlib.sha256(b"chat-reader:single-supervisor:v1").digest()[:8], "big", signed=True)


class ExecutionStopped(BaseException):
    """Unwind canonical transactions; do not mistake stopping for business failure."""


@contextmanager
def session_lease(engine, key):
    """Dedicated connection, held across the task's multiple transactions."""
    connection = engine.connect()
    acquired = False
    try:
        if connection.dialect.name == "postgresql":
            connection.execute(text("SET statement_timeout = '1500ms'"))
            acquired = bool(connection.scalar(text("SELECT pg_try_advisory_lock(:key)"), {"key": key}))
            connection.commit()
        else:
            acquired = True
        yield connection if acquired else None
    finally:
        if connection.dialect.name == "postgresql":
            try:
                connection.rollback()
                if acquired:
                    connection.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": key})
                connection.execute(text("RESET statement_timeout"))
                connection.commit()
            except SQLAlchemyError:
                connection.invalidate()
        connection.close()


def request_stop(db, control, reason="user", disposition="retain"):
    if control.finished_at is None and control.stop_requested_at is None:
        control.stop_requested_at = datetime.now(timezone.utc)
        control.stop_reason = reason
        control.source_disposition = disposition
    return control


def execution_fields(db, row):
    """Fixed read-only projection shared by Tasks and a bound noise scan."""
    if db is None or row is None or row.status not in {"processing", "cancelling"}:
        return {}
    control = db.get(TaskExecutionControl, SLOT)
    if not control or control.task_id != row.id or control.attempt != row.attempt_count or control.finished_at:
        return {}
    return {
        "execution_state": "stopping" if control.stop_requested_at else "running",
        "business_progress_at": control.progress_at,
        "stop_requested_at": control.stop_requested_at,
    }


_monitor = None


def business_progress(signature=None, *, byte_count=0):
    if _monitor is not None:
        _monitor.check(signature, byte_count=byte_count)


def execution_checkpoint():
    if _monitor is not None:
        _monitor.check()


class ExecutionMonitor:
    def __init__(self, token, factory, lease):
        self.token, self.factory, self.lease = token, factory, lease
        self.last_check = 0.0
        self.last_signature = None
        self.pending_progress = None
        self.backend = lease.scalar(text("SELECT pg_backend_pid()")) if lease.dialect.name == "postgresql" else None
        lease.commit()

    def check(self, signature=None, *, byte_count=0, force=False):
        if byte_count > 0 or (signature is not None and signature != self.last_signature):
            self.pending_progress = datetime.now(timezone.utc)
            if signature is not None:
                self.last_signature = signature
        now = time.monotonic()
        if not force and now - self.last_check < 1:
            return
        self.last_check = now
        try:
            with self.factory() as db:
                db.info["execution_auxiliary"] = True
                bound_worker_transaction(db)
                control = db.get(TaskExecutionControl, SLOT)
                if control is None or control.token != self.token or control.finished_at or control.stop_requested_at:
                    raise ExecutionStopped()
                if self.pending_progress:
                    row = db.query(TaskExecutionControl).filter_by(slot=SLOT, token=self.token).with_for_update(skip_locked=True).one_or_none()
                    if row is not None:
                        if row.stop_requested_at:
                            raise ExecutionStopped()
                        row.progress_at = self.pending_progress
                        db.commit()
                        self.pending_progress = None
        except SQLAlchemyError:
            # Auxiliary outage does not hold a canonical transaction hostage.
            # But publication may not commit without a verifiable fence.
            if force:
                raise ExecutionStopped() from None

    def before_commit(self, db):
        if db.info.get("execution_auxiliary"):
            return
        if self.lease.invalidated or self.lease.closed:
            raise ExecutionStopped()
        try:
            if self.backend is not None and self.lease.scalar(text("SELECT pg_backend_pid()")) != self.backend:
                raise ExecutionStopped()
            self.lease.commit()
            self.check(force=True)
        except SQLAlchemyError:
            raise ExecutionStopped() from None


@contextmanager
def monitor_execution(token, factory, lease):
    global _monitor
    monitor = ExecutionMonitor(token, factory, lease)
    _monitor = monitor
    event.listen(Session, "before_commit", monitor.before_commit)
    try:
        monitor.check(force=True)
        yield
    finally:
        event.remove(Session, "before_commit", monitor.before_commit)
        _monitor = None
