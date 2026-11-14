"""Actual in-memory reconciliation must not load unrelated archive handlers."""
import json
from pathlib import Path
import subprocess
import sys
import textwrap

import pytest


@pytest.mark.parametrize(("job_type", "reason"), [
    ("conversation_export", "user"),
    ("conversation_export", "stalled"),
    ("conversation_export", "admin"),
    ("offline_package", "user"),
    ("offline_package", "stalled"),
    ("offline_package", "admin"),
    ("content_noise_scan", "user"),
    ("content_noise_scan", "stalled"),
    ("content_noise_scan", "admin"),
    ("system_archive_export", "user"),
    ("system_archive_export", "stalled"),
    ("system_archive_export", "admin"),
    ("system_archive_preflight", "user"),
    ("system_archive_preflight", "stalled"),
    ("system_archive_preflight", "admin"),
    ("system_archive_restore", "user"),
    ("system_archive_restore", "stalled"),
    ("system_archive_restore", "admin"),
])
def test_actual_interrupted_task_reconciles_without_archive_handlers(job_type, reason, tmp_path):
    script = textwrap.dedent("""
        from datetime import datetime, timezone
        import importlib.abc
        import json
        import platform
        import socket
        import sys
        import uuid
        platform.uname()  # Windows read-only OS detection precedes the guard.
        sys.path.insert(0, sys.argv[1])
        from app.core import config
        settings = config.Settings(
            _env_file=None, DATABASE_URL="sqlite:///:memory:",
            AUTH_SESSION_SECRET="synthetic-reconciliation-import-boundary",
        )
        config.get_settings = lambda: settings

        def forbidden(*args, **kwargs):
            raise AssertionError("Reconciliation fixture attempted external work")

        socket.socket.connect = forbidden
        socket.socket.connect_ex = forbidden
        socket.create_connection = forbidden
        def audit(event, args):
            if event in {"subprocess.Popen", "socket.connect"}:
                forbidden()
            if event == "sqlite3.connect" and args[0] != ":memory:":
                forbidden()
        sys.addaudithook(audit)
        blocked = (
            "app.services.exporting.system_archive_jobs",
            "app.services.exporting.system_archive",
            "app.services.exporting.system_archive_preflight",
            "app.services.exporting.archive_jobs",
            "app.services.exporting.personal_archive",
            "app.services.exporting.personal_restore",
            "app.services.editing.message_edit_service",
            "app.services.search.search_indexer",
        )
        class HandlerGuard(importlib.abc.MetaPathFinder):
            def find_spec(self, fullname, path=None, target=None):
                if any(fullname == name or fullname.startswith(name + ".") for name in blocked):
                    raise AssertionError("Unselected archive handler imported: " + fullname)
        sys.meta_path.insert(0, HandlerGuard())

        from sqlalchemy import create_engine, event
        from sqlalchemy.orm import sessionmaker
        from app.core.database import Base
        from app.models.administration import AdminAuditLog, SystemBackupRecord
        from app.models.background_job import BackgroundJob
        from app.models.task_execution_control import TaskExecutionControl
        from app.models.user import User
        from app.services.execution_control import SLOT
        from app.services.execution_reconciliation import reconcile
        engine = create_engine("sqlite:///:memory:")
        @event.listens_for(engine, "connect")
        def enable_foreign_keys(connection, _):
            connection.execute("PRAGMA foreign_keys=ON")
        Base.metadata.create_all(engine)
        factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
        now = datetime.now(timezone.utc)
        job_type, reason = sys.argv[2:4]
        task_id, token, owner = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        expected = "cancelled" if reason == "user" else "failed"
        archive_status = "CANCELLED" if reason == "user" else "FAILED"
        is_system = job_type.startswith("system_archive_")
        with factory() as db:
            db.add(User(id=owner, role="ADMIN"))
            db.flush()
            db.add(BackgroundJob(
                id=task_id, owner_user_id=owner, job_type=job_type,
                status="processing", attempt_count=1, started_at=now,
                payload={"synthetic-marker": "retain"},
            ))
            db.flush()
            db.add(TaskExecutionControl(
                slot=SLOT, token=token, task_kind="job", task_id=task_id,
                attempt=1, started_at=now, progress_at=now,
                stop_requested_at=now, stop_reason=reason, source_disposition="retain",
            ))
            if is_system:
                db.add(SystemBackupRecord(
                    operation="BACKUP" if job_type == "system_archive_export" else "RESTORE",
                    requested_by_user_id=owner, background_job_id=task_id, status="RUNNING",
                ))
            db.commit()
        assert reconcile("job", task_id, token, factory) is True
        with factory() as db:
            task = db.get(BackgroundJob, task_id)
            control = db.get(TaskExecutionControl, SLOT)
            assert task.status == task.phase == expected
            assert task.attempt_count == control.attempt == 1 and control.token == token
            assert task.completed_at is not None and control.finished_at is not None
            assert task.payload == {"synthetic-marker": "retain", "source_disposition": "retain"}
            assert db.get(User, owner) is not None
            assert task.error_message == (
                None if reason == "user"
                else "TASK_STALLED" if reason == "stalled"
                else "TASK_EXECUTION_INTERRUPTED"
            )
            audits = db.query(AdminAuditLog).all()
            assert len(audits) == (1 if is_system else 0)
            if is_system:
                record = db.query(SystemBackupRecord).filter_by(background_job_id=task_id).one()
                assert record.status == archive_status
                assert record.started_at is not None and record.completed_at is not None
                assert audits[0].resource_id == str(task_id)
                assert audits[0].action == f"SYSTEM_{record.operation}_{archive_status}"
                assert audits[0].result == ("FAILURE" if archive_status == "FAILED" else "SUCCESS")
        assert reconcile("job", task_id, token, factory) is True
        with factory() as db:
            assert db.query(AdminAuditLog).count() == (1 if is_system else 0)
        assert not any(name in sys.modules for name in blocked)
        engine.dispose()
        print(json.dumps({"job_type": job_type, "reason": reason, "status": expected,
                          "unselected_archive_handlers_loaded": False,
                          "idempotent_archive_audit": True}))
    """)
    result = subprocess.run(
        [sys.executable, "-c", script, str(Path(__file__).resolve().parents[1]), job_type, reason],
        cwd=tmp_path, capture_output=True, text=True, timeout=20,
        creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
    )
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == {
        "job_type": job_type, "reason": reason,
        "status": "cancelled" if reason == "user" else "failed",
        "unselected_archive_handlers_loaded": False, "idempotent_archive_audit": True,
    }


def test_archive_projection_is_the_existing_system_handler_reexport():
    from app.services.exporting import archive_task_status, system_archive_jobs

    assert system_archive_jobs.SYSTEM_JOB_TYPES is archive_task_status.SYSTEM_JOB_TYPES
    assert system_archive_jobs.sync_system_archive_record is archive_task_status.sync_system_archive_record
