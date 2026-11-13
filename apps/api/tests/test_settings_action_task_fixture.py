"""Run the browser's exact action-task seed/teardown on disposable PostgreSQL."""
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid

import pytest
from sqlalchemy.orm import Session

from app.api.routes.tasks import cancel_task, retry_task
from app.models.background_job import BackgroundJob
from app.models.message_version import MessageVersion
from app.models.task_execution_control import TaskExecutionControl
from app.models.user import User
from app.services import background_jobs, worker_supervisor
from app.services.editing.message_edit_service import create_manual_conversation
from app.services.execution_control import SLOT
from app.services.ownership import OwnershipScope
from test_cleanup_postgres import isolated_schema, pytestmark  # noqa: F401


API_ROOT = Path(__file__).resolve().parents[1]
FIXTURE = API_ROOT.parent / "web/e2e/settings-task-center.spec.ts"


@pytest.fixture
def runtime(isolated_schema, monkeypatch):
    engine, migrate = isolated_schema
    migrate("head")
    monkeypatch.setenv("DATABASE_URL", engine.url.render_as_string(hide_password=False))
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("E2E_SETTINGS_MAILBOX", "1")
    return engine


def program(name):
    source = FIXTURE.read_text(encoding="utf-8")
    marker = f"function {name}("
    assert source.count(marker) == 1, f"Browser fixture {name} is missing or ambiguous"
    body = source.split(marker, 1)[1]
    assert 'execFileSync("python",' in body
    return body.split('execFileSync("python",', 1)[1].split("`", 2)[1]


def invoke(name, *args, check=True):
    result = subprocess.run(
        [sys.executable, "-B", "-c", program(name), *map(str, args)],
        cwd=API_ROOT, env=os.environ.copy(), capture_output=True, text=True,
        encoding="utf-8", timeout=15,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    if check:
        assert result.returncode == 0, result.stderr
    return result


def seed(engine, operation="cancel"):
    with Session(engine) as db:
        owner = User(normalized_email=f"task-fence-fixture-{uuid.uuid4()}@example.test")
        db.add(owner)
        db.flush()
        created = create_manual_conversation(
            db, title="Synthetic task action fixture", user_text="Synthetic retained question",
            assistant_text="Synthetic retained answer", ownership_scope=OwnershipScope(owner.id),
        )
        db.commit()
        conversation_id, owner_id = created.conversation.id, owner.id
    result = invoke("seedActionTask", conversation_id, operation)
    if result.stdout.strip().startswith("{"):
        return json.loads(result.stdout)
    # Retain a faithful red reproduction against the pre-repair seed helper.
    with Session(engine) as db:
        job = db.get(BackgroundJob, uuid.UUID(result.stdout.strip()))
        return {
            "id": str(job.id), "conversation_id": str(conversation_id), "owner_id": str(owner_id),
            "created_at": job.created_at.isoformat(), "operation": operation,
        }


def finish(receipt, check=True):
    return invoke("finishActionTask", json.dumps(receipt), check=check)


def source_snapshot(engine):
    with Session(engine) as db:
        return [
            (
                row.id, row.message_id, row.display_text, row.content_hash,
                hashlib.sha256(row.display_text.encode("utf-8")).hexdigest(),
            )
            for row in db.query(MessageVersion).order_by(MessageVersion.id)
        ]


@pytest.mark.parametrize("status", ["processing", "cancelling"])
@pytest.mark.parametrize("next_kind", ["conversation_export", "offline_package"])
def test_own_action_fixture_cleanup_unblocks_next_task_without_stale_recovery(runtime, status, next_kind):
    fixture = seed(runtime)
    job_id, owner_id = uuid.UUID(fixture["id"]), uuid.UUID(fixture["owner_id"])
    before = source_snapshot(runtime)
    with Session(runtime) as db:
        if status == "cancelling":
            assert cancel_task(job_id, db, OwnershipScope(owner_id)).status == "cancelling"
        following = BackgroundJob(
            owner_user_id=owner_id, job_type=next_kind, status="queued", phase="queued", payload={},
        )
        db.add(following)
        db.commit()
        following_id = following.id
        assert background_jobs.recover_stale_jobs(db, 300) == 0
        assert worker_supervisor.STALL_SECONDS == 300
        assert worker_supervisor.claim(db) is None
        assert db.get(BackgroundJob, following_id).status == "queued"
        db.rollback()
    finish(fixture)
    with Session(runtime) as db:
        assert db.get(BackgroundJob, job_id).status == "cancelled"
        started = time.monotonic()
        identity = worker_supervisor.claim(db)
        assert time.monotonic() - started < 2
        assert identity is not None and identity[1] == following_id
    assert source_snapshot(runtime) == before


@pytest.mark.parametrize("terminal", ["committed", "failed", "cancelled"])
def test_action_fixture_cleanup_preserves_terminal_receipts(runtime, terminal):
    fixture = seed(runtime)
    before = source_snapshot(runtime)
    with Session(runtime) as db:
        job = db.get(BackgroundJob, uuid.UUID(fixture["id"]))
        job.status = job.phase = terminal
        job.completed_at = datetime.now(timezone.utc)
        job.result = {"synthetic_receipt": "retained"}
        db.commit()
        receipt = (job.status, job.phase, job.completed_at, job.error_message, job.payload, job.result)
    for _ in range(2):
        finish(fixture)
    with Session(runtime) as db:
        job = db.get(BackgroundJob, uuid.UUID(fixture["id"]))
        assert (job.status, job.phase, job.completed_at, job.error_message, job.payload, job.result) == receipt
    assert source_snapshot(runtime) == before


@pytest.mark.parametrize("mismatch", ["owner", "conversation", "kind", "token", "control", "created_at", "started_at", "attempt", "operation"])
def test_action_fixture_cleanup_refuses_wrong_scope_and_real_execution(runtime, mismatch):
    fixture = seed(runtime)
    before = source_snapshot(runtime)
    job_id = uuid.UUID(fixture["id"])
    with Session(runtime) as db:
        job = db.get(BackgroundJob, job_id)
        if mismatch == "owner":
            other = User(normalized_email=f"task-fence-other-{uuid.uuid4()}@example.test")
            db.add(other)
            db.flush()
            job.owner_user_id = other.id
        elif mismatch == "conversation":
            job.payload = {**job.payload, "conversation_id": str(uuid.uuid4())}
        elif mismatch == "kind":
            job.job_type = "search_vector_backfill"
        elif mismatch == "token":
            job.payload = {**job.payload, "execution_token": uuid.uuid4().hex}
        elif mismatch == "created_at":
            job.created_at += timedelta(seconds=1)
        elif mismatch == "started_at":
            job.started_at += timedelta(seconds=1)
        elif mismatch == "attempt":
            job.attempt_count = 1
        elif mismatch == "operation":
            fixture = {**fixture, "operation": "retry"}
        else:
            now = datetime.now(timezone.utc)
            db.add(TaskExecutionControl(
                slot=SLOT, task_id=job_id, task_kind="job", token=uuid.uuid4(),
                attempt=job.attempt_count, started_at=now, progress_at=now,
            ))
        db.commit()
        receipt = (job.status, job.phase, job.payload, job.result, job.created_at, job.started_at, job.attempt_count)
    result = finish(fixture, check=False)
    assert result.returncode != 0
    with Session(runtime) as db:
        job = db.get(BackgroundJob, job_id)
        assert (job.status, job.phase, job.payload, job.result, job.created_at, job.started_at, job.attempt_count) == receipt
    assert source_snapshot(runtime) == before


def test_action_fixture_cleanup_leaves_unrelated_claimed_fixture_alone(runtime):
    original, unrelated = seed(runtime), seed(runtime)
    before = source_snapshot(runtime)
    finish(original)
    with Session(runtime) as db:
        assert db.get(BackgroundJob, uuid.UUID(original["id"])).status == "cancelled"
        assert db.get(BackgroundJob, uuid.UUID(unrelated["id"])).status == "processing"
        assert worker_supervisor.claim(db) is None
    assert source_snapshot(runtime) == before


@pytest.mark.parametrize("guard", ["environment", "mailbox", "database", "port"])
def test_action_fixture_teardown_refuses_missing_test_opt_in(runtime, monkeypatch, guard):
    fixture = seed(runtime)
    before = source_snapshot(runtime)
    if guard == "environment":
        monkeypatch.setenv("APP_ENV", "production")
    elif guard == "mailbox":
        monkeypatch.setenv("E2E_SETTINGS_MAILBOX", "0")
    elif guard == "database":
        monkeypatch.delenv("DATABASE_URL")
    else:
        monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://postgres@127.0.0.1:5432/postgres")
    assert finish(fixture, check=False).returncode != 0
    with Session(runtime) as db:
        assert db.get(BackgroundJob, uuid.UUID(fixture["id"])).status == "processing"
    assert source_snapshot(runtime) == before


@pytest.mark.parametrize("status", ["queued", "processing", "committed"])
def test_retry_fixture_cleanup_never_takes_over_real_retry(runtime, status):
    fixture = seed(runtime, "retry")
    job_id, owner_id = uuid.UUID(fixture["id"]), uuid.UUID(fixture["owner_id"])
    before = source_snapshot(runtime)
    with Session(runtime) as db:
        assert retry_task(job_id, db, OwnershipScope(owner_id)).status == "queued"
        if status != "queued":
            identity = worker_supervisor.claim(db)
            assert identity is not None and identity[1] == job_id
            if status == "committed":
                job = db.get(BackgroundJob, job_id)
                job.status = job.phase = "committed"
                job.completed_at = datetime.now(timezone.utc)
                job.result = {"synthetic_completed_receipt": "retained"}
                db.get(TaskExecutionControl, SLOT).finished_at = datetime.now(timezone.utc)
                db.commit()
        job = db.get(BackgroundJob, job_id)
        receipt = (job.status, job.phase, job.payload, job.result, job.attempt_count, job.started_at)
        control = db.get(TaskExecutionControl, SLOT)
        control_receipt = None if control is None else (control.token, control.stop_requested_at, control.finished_at)
        db.rollback()
    finish(fixture)
    with Session(runtime) as db:
        job = db.get(BackgroundJob, job_id)
        assert (job.status, job.phase, job.payload, job.result, job.attempt_count, job.started_at) == receipt
        control = db.get(TaskExecutionControl, SLOT)
        assert (None if control is None else (control.token, control.stop_requested_at, control.finished_at)) == control_receipt
    assert source_snapshot(runtime) == before
