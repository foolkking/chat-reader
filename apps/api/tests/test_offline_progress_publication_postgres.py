"""Real packages/PG fences; the injected clock controls publication, not PG timeouts."""
import hashlib
import json
import os
from types import SimpleNamespace
import uuid
from zipfile import ZipFile

import pytest
from sqlalchemy import event
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import sessionmaker

from app.core.config import get_settings
from app.models.background_job import BackgroundJob
from app.models.message_version import MessageVersion
from app.models.offline_package_artifact import OfflinePackageArtifact
from app.models.task_execution_control import TaskExecutionControl
from app.models.user import User
from app.services import background_jobs, offline_packages, worker_supervisor
from app.services.editing.message_edit_service import create_manual_conversation
from app.services.execution_control import (
    EXECUTION_LOCK, SLOT, ExecutionStopped, monitor_execution, request_stop, session_lease,
)
from app.services.execution_reconciliation import reconcile
from app.services.ownership import OwnershipScope
from test_import_profile_postgres import isolated_schema  # noqa: F401

pytestmark = pytest.mark.skipif(
    os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1",
    reason="explicit disposable PostgreSQL required",
)


@pytest.fixture
def offline_runtime(isolated_schema, tmp_path, monkeypatch):
    engine, migrate = isolated_schema
    migrate("head")
    monkeypatch.setenv("OFFLINE_STORAGE_DIR", str(tmp_path / "offline"))
    get_settings.cache_clear()
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    # Replace this module's namespace only. Monitor, driver and transaction
    # deadlines must continue to use the real monotonic clock.
    clock = SimpleNamespace(value=10.0)
    monkeypatch.setattr(background_jobs, "time", SimpleNamespace(
        monotonic=lambda: clock.value, perf_counter=lambda: clock.value,
    ))
    with factory() as db:
        owner = User(normalized_email=f"synthetic-{uuid.uuid4()}@example.test")
        db.add(owner)
        db.flush()
        conversation = create_manual_conversation(
            db, title="Synthetic progress",
            user_text="Synthetic publication question",
            assistant_text="Synthetic publication answer",
            ownership_scope=OwnershipScope(owner.id),
        ).conversation
        db.commit()
        owner_id, conversation_id = owner.id, conversation.id
        source = {row.id: row.display_text for row in db.query(MessageVersion).all()}

    attempts, publications = [], []

    def observe(_connection, _cursor, statement, parameters, _context, _many):
        sql = " ".join(statement.lower().split())
        if "from background_jobs" in sql and "for update skip locked" in sql:
            attempts.append(clock.value)
        if sql.startswith("update background_jobs set") and "phase" in parameters and parameters["phase"] not in {
            "completed", "cancelled", "failed",
        }:
            publications.append((clock.value, parameters["phase"]))

    event.listen(engine, "before_cursor_execute", observe)
    try:
        yield SimpleNamespace(
            engine=engine, factory=factory, clock=clock, owner=owner_id,
            conversation=conversation_id, source=source,
            attempts=attempts, publications=publications,
        )
    finally:
        event.remove(engine, "before_cursor_execute", observe)
        get_settings.cache_clear()


def claimed(runtime, *, supervised=True):
    with runtime.factory() as db:
        job = background_jobs.queue_offline_package(
            db, scope="conversation", conversation_id=runtime.conversation,
            project_id=None, known_revisions={}, include_assets="none",
            idempotency_key=uuid.uuid4().hex, subject_key=str(runtime.owner),
            ownership_scope=OwnershipScope(runtime.owner),
        )
        db.commit()
        job_id = job.id
        if supervised:
            identity = worker_supervisor.claim(db)
            assert identity[1] == job_id
            execution = db.info["supervised_execution"]
        else:
            assert background_jobs.claim_next_job(db) == job_id
            execution = db.info["claimed_background_execution"]
            db.commit()
            identity = None
    runtime.attempts.clear()
    runtime.publications.clear()
    return job_id, execution, identity


def assert_source_preserved(runtime):
    with runtime.factory() as db:
        assert {row.id: row.display_text for row in db.query(MessageVersion).all()} == runtime.source


def assert_real_package(runtime, job_id):
    with runtime.factory() as db:
        job = db.get(BackgroundJob, job_id)
        assert (job.status, job.phase, job.progress, job.processed_items) == (
            "committed", "completed", 100, 1,
        )
        artifact = db.query(OfflinePackageArtifact).filter_by(job_id=job_id).one()
        assert job.result["package_id"] == str(artifact.id)
        assert job.result["sha256"] == artifact.sha256
        assert job.result["byte_size"] == artifact.byte_size
        with open(artifact.storage_uri, "rb") as source:
            content = source.read()
        assert len(content) == artifact.byte_size
        assert hashlib.sha256(content).hexdigest() == artifact.sha256
        with ZipFile(artifact.storage_uri) as archive:
            assert archive.testzip() is None
            package = json.loads(archive.read("package.json"))
        assert package["version"] == 3
        assert len(package["conversations"]) == 1
        assert len(package["conversations"][0]["messages"]) == 2
        serialized = json.dumps(package)
        assert all(text in serialized for text in runtime.source.values())
        durations = job.result["phase_durations_ms"]
    assert_source_preserved(runtime)
    return durations


@pytest.mark.parametrize("supervised", [True, False], ids=["supervised", "legacy"])
def test_real_short_package_coalesces_only_supervised_snapshots(
    offline_runtime, monkeypatch, supervised,
):
    runtime = offline_runtime
    job_id, execution, _ = claimed(runtime, supervised=supervised)
    checkpoints = []
    original_progress = background_jobs.business_progress

    def progress(signature):
        checkpoints.append(signature)
        runtime.clock.value += .01
        original_progress(signature)

    monkeypatch.setattr(background_jobs, "business_progress", progress)
    background_jobs.process_background_job(
        job_id, runtime.factory, expected_execution=execution if supervised else None,
    )
    durations = assert_real_package(runtime, job_id)
    assert len(checkpoints) >= 15  # Real handler phases, not a stubbed artifact.
    assert {signature[0] for signature in checkpoints} <= set(durations)
    if supervised:
        assert len(runtime.attempts) == 1
        assert [phase for _, phase in runtime.publications] == ["validating"]
    else:
        assert len(runtime.attempts) == len(checkpoints)
        assert len(runtime.publications) >= len(checkpoints) - 1


def test_phase_changes_do_not_renew_the_one_second_publication_window(
    offline_runtime, monkeypatch,
):
    runtime = offline_runtime
    job_id, execution, _ = claimed(runtime)
    original_build = offline_packages.build_offline_package
    times = [10.25, 10.5, 10.999, 11.0, 11.25, 11.999, 12.0]

    def build(db, *, progress_callback, **kwargs):
        for index, now in enumerate(times):
            runtime.clock.value = now
            progress_callback(f"synthetic_stage_{index}", index + 10, index, len(times))
        return original_build(db, progress_callback=progress_callback, **kwargs)

    monkeypatch.setattr(offline_packages, "build_offline_package", build)
    background_jobs.process_background_job(job_id, runtime.factory, expected_execution=execution)
    durations = assert_real_package(runtime, job_id)
    assert runtime.publications == [
        (10.0, "validating"), (11.0, "synthetic_stage_3"), (12.0, "synthetic_stage_6"),
    ]
    assert len(runtime.attempts) == 3
    assert {f"synthetic_stage_{index}" for index in range(len(times))} <= set(durations)
    assert durations["synthetic_stage_2"] == 1.0


@pytest.mark.parametrize("results", [[{"synthetic_receipt": 1}, {"synthetic_receipt": 2}], [{}, {}]])
def test_explicit_result_is_published_even_inside_the_window(offline_runtime, monkeypatch, results):
    runtime = offline_runtime
    job_id, execution, _ = claimed(runtime)
    original_build = offline_packages.build_offline_package

    def build(db, *, progress_callback, **kwargs):
        for index, result in enumerate(results):
            runtime.clock.value = 10.1 + index * .1
            progress_callback("synthetic_receipt", 10, index, 2, result)
            with runtime.factory() as reader:
                stored = reader.get(BackgroundJob, job_id).result
                assert all(stored[key] == value for key, value in result.items())
                if not result:
                    assert set(stored) == {"progress_updated_at"}
        runtime.clock.value = 10.3
        progress_callback("synthetic_after_receipt", 20, 2, 2)
        return original_build(db, progress_callback=progress_callback, **kwargs)

    monkeypatch.setattr(offline_packages, "build_offline_package", build)
    background_jobs.process_background_job(job_id, runtime.factory, expected_execution=execution)
    assert_real_package(runtime, job_id)
    assert [phase for _, phase in runtime.publications] == [
        "validating", "synthetic_receipt", "synthetic_receipt",
    ]
    assert len(runtime.attempts) == 3


@pytest.mark.parametrize("change", ["cancel", "replace_execution"])
def test_late_canonical_change_is_fenced_without_a_monitor(offline_runtime, monkeypatch, change):
    runtime = offline_runtime
    job_id, execution, _ = claimed(runtime)
    original_build = offline_packages.build_offline_package

    def build(db, **kwargs):
        artifact = original_build(db, **kwargs)
        # No later callback is needed: the final SQL predicate must still win.
        with runtime.factory() as other:
            row = other.get(BackgroundJob, job_id)
            if change == "cancel":
                row.status = "cancelling"
            else:
                row.attempt_count += 1
                row.payload = {**row.payload, "execution_token": uuid.uuid4().hex}
            other.commit()
        return artifact

    monkeypatch.setattr(offline_packages, "build_offline_package", build)
    background_jobs.process_background_job(job_id, runtime.factory, expected_execution=execution)
    with runtime.factory() as db:
        row = db.get(BackgroundJob, job_id)
        assert row.status == ("cancelled" if change == "cancel" else "processing")
        assert row.attempt_count == execution[0] + (change == "replace_execution")
        assert db.query(OfflinePackageArtifact).filter_by(job_id=job_id).count() == 0
        assert "package_id" not in row.result
    assert_source_preserved(runtime)


@pytest.mark.parametrize("change", ["stop", "replace_control"])
def test_monitor_fence_rejects_late_independent_control_change(offline_runtime, monkeypatch, change):
    runtime = offline_runtime
    job_id, execution, identity = claimed(runtime)
    original_build = offline_packages.build_offline_package

    def build(db, **kwargs):
        artifact = original_build(db, **kwargs)
        with runtime.factory() as external:
            # This adapter represents a different API process. Its commit is
            # not the child's canonical publication and must not use its hook.
            external.info["execution_auxiliary"] = True
            control = external.get(TaskExecutionControl, SLOT)
            if change == "stop":
                request_stop(external, control)
            else:
                control.token = uuid.uuid4()
            external.commit()
        return artifact

    monkeypatch.setattr(offline_packages, "build_offline_package", build)
    with session_lease(runtime.engine, EXECUTION_LOCK) as lease:
        assert lease is not None
        with monitor_execution(identity[2], runtime.factory, lease):
            with pytest.raises(ExecutionStopped):
                background_jobs.process_background_job(
                    job_id, runtime.factory, expected_execution=execution,
                )
    with runtime.factory() as db:
        assert db.get(BackgroundJob, job_id).status == "processing"
        assert db.query(OfflinePackageArtifact).filter_by(job_id=job_id).count() == 0
    if change == "stop":
        assert reconcile(*identity, runtime.factory)
        with runtime.factory() as db:
            assert db.get(BackgroundJob, job_id).status == "cancelled"
    assert_source_preserved(runtime)


def test_due_snapshots_skip_the_childs_canonical_lock(offline_runtime, monkeypatch):
    runtime = offline_runtime
    job_id, execution, _ = claimed(runtime)
    original_build = offline_packages.build_offline_package
    original_progress = background_jobs.business_progress

    def progress(signature):
        runtime.clock.value += 1.05
        original_progress(signature)

    def build(db, **kwargs):
        db.query(BackgroundJob).filter_by(id=job_id).with_for_update().one()
        return original_build(db, **kwargs)

    monkeypatch.setattr(background_jobs, "business_progress", progress)
    monkeypatch.setattr(offline_packages, "build_offline_package", build)
    background_jobs.process_background_job(job_id, runtime.factory, expected_execution=execution)
    assert_real_package(runtime, job_id)
    assert len(runtime.attempts) >= 15
    assert [phase for _, phase in runtime.publications] == ["validating"]


@pytest.mark.parametrize("failure", ["auxiliary", "canonical"])
def test_sql_failure_does_not_replace_the_canonical_outcome(offline_runtime, failure):
    runtime = offline_runtime
    job_id, execution, _ = claimed(runtime)

    def fail(_connection, _cursor, statement, parameters, _context, _many):
        if not statement.lstrip().lower().startswith("update background_jobs set"):
            return
        selected = parameters.get("phase") == ("validating" if failure == "auxiliary" else "completed")
        if selected:
            raise OperationalError(statement, {}, RuntimeError("synthetic database failure"))

    event.listen(runtime.engine, "before_cursor_execute", fail)
    try:
        background_jobs.process_background_job(job_id, runtime.factory, expected_execution=execution)
    finally:
        event.remove(runtime.engine, "before_cursor_execute", fail)
    if failure == "auxiliary":
        assert_real_package(runtime, job_id)
        assert len(runtime.attempts) == 1  # An outage must not cause a retry storm.
    else:
        with runtime.factory() as db:
            row = db.get(BackgroundJob, job_id)
            assert row.status == "failed"
            assert row.error_message == "TASK_FAILED"
            assert "package_id" not in row.result
            assert db.query(OfflinePackageArtifact).filter_by(job_id=job_id).count() == 0
        assert_source_preserved(runtime)
