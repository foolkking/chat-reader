"""Exercise the browser's exact synthetic-task helper without starting services."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid

import pytest
from sqlalchemy.orm import Session

from app.api.routes.tasks import cancel_task
from app.models.background_job import BackgroundJob
from app.models.content_cleanup import ContentCleanupScan
from app.models.import_record import ImportRecord
from app.models.message_version import MessageVersion
from app.models.task_execution_control import TaskExecutionControl
from app.models.user import User
from app.services import background_jobs, worker_supervisor
from app.services.editing.message_edit_service import create_manual_conversation
from app.services.execution_control import SLOT
from app.services.ownership import OwnershipScope
from test_cleanup_postgres import isolated_schema, pytestmark  # noqa: F401


API_ROOT = Path(__file__).resolve().parents[1]
FIXTURE = API_ROOT.parent / "web/e2e/settings-noise-scan-lifecycle.spec.ts"


@pytest.fixture
def runtime(isolated_schema, monkeypatch):
    engine, migrate = isolated_schema
    migrate("head")
    monkeypatch.setenv("DATABASE_URL", engine.url.render_as_string(hide_password=False))
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("E2E_SETTINGS_MAILBOX", "1")
    return engine


def run_fixture(target, mode, *, check=True):
    # Execute the actual embedded helper, not a second implementation of teardown.
    source = FIXTURE.read_text(encoding="utf-8")
    start = 'execFileSync("python", ["-B", "-c", `'
    end = '`, id, mode]'
    assert source.count(start) == source.count(end) == 1
    program = source.split(start, 1)[1].split(end, 1)[0]
    result = subprocess.run(
        [sys.executable, "-B", "-c", program, str(target), mode],
        cwd=API_ROOT, env=os.environ.copy(), capture_output=True, text=True,
        encoding="utf-8", timeout=15,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    if check:
        assert result.returncode == 0, result.stderr
        return json.loads(result.stdout)
    return result


def conversation(engine):
    with Session(engine) as db:
        owner = User(normalized_email=f"scan-lifecycle-fixture-{uuid.uuid4()}@example.test")
        db.add(owner)
        db.flush()
        result = create_manual_conversation(
            db, title="Synthetic lifecycle fixture", user_text="Synthetic question",
            assistant_text="Before cite turn12search4 after.",
            ownership_scope=OwnershipScope(owner.id),
        )
        db.commit()
        return result.conversation.id, owner.id


def source_snapshot(engine):
    with Session(engine) as db:
        return [
            (row.id, row.message_id, row.display_text, row.content_hash)
            for row in db.query(MessageVersion).order_by(MessageVersion.id)
        ]


@pytest.mark.parametrize("status", ["processing", "cancelling", "queued"])
@pytest.mark.parametrize("next_kind", ["adaptive_import_analysis", "content_noise_scan"])
def test_disposal_unblocks_the_next_task_without_stale_recovery(runtime, status, next_kind):
    conversation_id, owner_id = conversation(runtime)
    before = source_snapshot(runtime)
    fixture = run_fixture(conversation_id, "new")
    scan_id, job_id = uuid.UUID(fixture["id"]), uuid.UUID(fixture["job_id"])
    with Session(runtime) as db:
        if status == "cancelling":
            assert cancel_task(job_id, db, OwnershipScope(owner_id)).status == "cancelling"
        elif status == "queued":
            db.get(BackgroundJob, job_id).status = "queued"
            db.commit()
        following = BackgroundJob(
            owner_user_id=owner_id, job_type=next_kind, status="queued",
            phase="queued", payload={},
        )
        db.add(following)
        db.commit()
        following_id = following.id
        assert worker_supervisor.STALL_SECONDS == 300
        assert background_jobs.recover_stale_jobs(db, 300) == 0
        if status != "queued":
            assert worker_supervisor.claim(db) is None
            assert db.get(BackgroundJob, following_id).status == "queued"
        db.rollback()

    run_fixture(scan_id, "dispose")
    with Session(runtime) as db:
        assert db.get(BackgroundJob, job_id).status == "cancelled"
        assert db.get(ContentCleanupScan, scan_id).status != "READY"
        started = time.monotonic()
        identity = worker_supervisor.claim(db)
        assert time.monotonic() - started < 2
        assert identity is not None and identity[1] == following_id
    assert source_snapshot(runtime) == before


@pytest.mark.parametrize("terminal", ["complete", "fail", "finish"])
def test_disposal_preserves_terminal_results_and_is_idempotent(runtime, terminal):
    conversation_id, owner_id = conversation(runtime)
    before = source_snapshot(runtime)
    fixture = run_fixture(conversation_id, "new")
    scan_id, job_id = uuid.UUID(fixture["id"]), uuid.UUID(fixture["job_id"])
    if terminal == "finish":
        with Session(runtime) as db:
            cancel_task(job_id, db, OwnershipScope(owner_id))
    run_fixture(scan_id, terminal)
    with Session(runtime) as db:
        job = db.get(BackgroundJob, job_id)
        receipt = (job.status, job.phase, job.completed_at, job.error_message, job.payload, job.result)
        assert job.status in {"committed", "failed", "cancelled"}
    for _ in range(2):
        run_fixture(scan_id, "dispose")
    with Session(runtime) as db:
        job = db.get(BackgroundJob, job_id)
        assert (job.status, job.phase, job.completed_at, job.error_message, job.payload, job.result) == receipt
    assert source_snapshot(runtime) == before


@pytest.mark.parametrize("mismatch", ["owner", "scan", "execution"])
def test_disposal_refuses_mismatched_or_supervised_tasks(runtime, mismatch):
    conversation_id, owner_id = conversation(runtime)
    before = source_snapshot(runtime)
    fixture = run_fixture(conversation_id, "new")
    scan_id, job_id = uuid.UUID(fixture["id"]), uuid.UUID(fixture["job_id"])
    with Session(runtime) as db:
        job = db.get(BackgroundJob, job_id)
        if mismatch == "owner":
            other = User(normalized_email=f"scan-lifecycle-other-{uuid.uuid4()}@example.test")
            db.add(other)
            db.flush()
            job.owner_user_id = other.id
        elif mismatch == "scan":
            job.payload = {**job.payload, "scan_id": str(uuid.uuid4())}
        else:
            now = datetime.now(timezone.utc)
            db.add(TaskExecutionControl(
                slot=SLOT, task_id=job_id, task_kind="job", token=uuid.uuid4(),
                attempt=job.attempt_count, started_at=now, progress_at=now,
            ))
        db.commit()
        receipt = (job.status, job.payload)
    result = run_fixture(scan_id, "dispose", check=False)
    assert result.returncode != 0
    with Session(runtime) as db:
        job = db.get(BackgroundJob, job_id)
        assert (job.status, job.payload) == receipt
    assert source_snapshot(runtime) == before


def test_disposal_targets_only_its_original_scan(runtime):
    first, _ = conversation(runtime)
    second, _ = conversation(runtime)
    before = source_snapshot(runtime)
    original = run_fixture(first, "new")
    unrelated = run_fixture(second, "new")
    run_fixture(original["id"], "dispose")
    with Session(runtime) as db:
        assert db.get(BackgroundJob, uuid.UUID(original["job_id"])).status == "cancelled"
        assert db.get(BackgroundJob, uuid.UUID(unrelated["job_id"])).status == "processing"
        assert worker_supervisor.claim(db) is None
    assert source_snapshot(runtime) == before


def test_import_follow_up_disposal_keeps_the_committed_parent(runtime):
    conversation_id, owner_id = conversation(runtime)
    before = source_snapshot(runtime)
    with Session(runtime) as db:
        parent = ImportRecord(
            owner_user_id=owner_id, source_profile="synthetic",
            source_fingerprint=f"synthetic-lifecycle-{uuid.uuid4()}",
            status="committed", conversation_id=conversation_id,
        )
        db.add(parent)
        db.commit()
        parent_id = parent.id
    fixture = run_fixture(parent_id, "import")
    run_fixture(fixture["id"], "dispose")
    with Session(runtime) as db:
        assert db.get(BackgroundJob, uuid.UUID(fixture["job_id"])).status == "cancelled"
        parent = db.get(ImportRecord, parent_id)
        assert parent.status == "committed" and parent.conversation_id == conversation_id
    assert source_snapshot(runtime) == before
