import json
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core import auth_middleware
from app.core.config import get_settings
from app.models.administration import SystemBackupRecord
from app.models.attachment import AssetObject
from app.models.background_job import BackgroundJob
from app.models.import_record import ImportRecord
from app.models.worker_runtime_state import WorkerRuntimeState
from app.services import admin_runtime, app_info, diagnostics
from app.services.auth import ROOT_ADMIN_USER_ID
from test_auth import auth_client, owner_login  # noqa: F401
from test_admin_system import _normal_user_session
from test_import_profile_postgres import isolated_schema  # noqa: F401


def test_build_metadata_writer_validates_revision_without_runtime_environment(monkeypatch, tmp_path):
    from scripts import write_build_metadata
    (tmp_path / "app").mkdir()
    monkeypatch.setattr(write_build_metadata, "__file__", str(tmp_path / "scripts" / "write_build_metadata.py"))
    monkeypatch.setattr(write_build_metadata.sys, "argv", ["writer", "a" * 40])
    write_build_metadata.main()
    output = tmp_path / "app" / "build_metadata.json"
    assert json.loads(output.read_text()) == {"revision": "a" * 40}
    monkeypatch.setattr(write_build_metadata.sys, "argv", ["writer", "private-invalid-value"])
    with pytest.raises(SystemExit):
        write_build_metadata.main()
    assert json.loads(output.read_text()) == {"revision": "a" * 40}
    monkeypatch.setattr(write_build_metadata.sys, "argv", ["writer"])
    write_build_metadata.main()
    assert json.loads(output.read_text()) == {"revision": None}


def roots(monkeypatch, tmp_path):
    for kind in ("import", "export", "offline", "asset"):
        path = tmp_path / kind
        path.mkdir(exist_ok=True)
        (path / "private-name.txt").write_bytes(b"private body")
        monkeypatch.setenv(f"{kind.upper()}_STORAGE_DIR", str(path))
    get_settings.cache_clear()
    return get_settings()


def test_runtime_permissions_and_app_info_whitelist(auth_client, monkeypatch, tmp_path):
    assert auth_client.get("/api/admin/runtime-status").status_code == 401
    assert auth_client.get("/api/app-info").status_code == 401
    _, token = _normal_user_session(auth_client)
    auth_client.cookies.set("chat_reader_session", token)
    assert auth_client.get("/api/admin/runtime-status").status_code == 404
    metadata = tmp_path / "metadata.json"
    metadata.write_text(json.dumps({"revision": "b" * 40, "password": "synthetic-secret"}))
    monkeypatch.setattr(app_info, "BUILD_METADATA_PATH", metadata)
    response = auth_client.get("/api/app-info")
    assert response.status_code == 200
    assert response.json() == {"api_version": app_info.API_VERSION, "revision": "b" * 40}
    assert "no-store" in response.headers["Cache-Control"]
    for value in ("not-json", '[]', '{"revision":"private-path"}', '"' + "x" * 500 + '"'):
        metadata.write_text(value)
        assert auth_client.get("/api/app-info").json()["revision"] is None
    assert owner_login(auth_client).status_code == 200
    roots(monkeypatch, tmp_path)
    response = auth_client.get("/api/admin/runtime-status")
    assert response.status_code == 200
    assert "no-store" in response.headers["Cache-Control"]
    assert response.headers["X-Robots-Tag"] == "noindex, noarchive"
    assert response.json()["worker"]["status"] == "unavailable"
    assert response.json()["complete"] is False
    assert "private" not in response.text and str(tmp_path) not in response.text


def test_runtime_real_aggregates_latest_archive_and_read_only(auth_client, monkeypatch, tmp_path):
    settings = roots(monkeypatch, tmp_path)
    assert owner_login(auth_client).status_code == 200
    now = datetime.now(timezone.utc)
    with auth_middleware.SessionLocal() as db:
        job = BackgroundJob(job_type="system_archive_export", status="failed", phase="failed", payload={"private": "private-body"}, error_message="private-error", completed_at=now)
        db.add(job); db.flush()
        record = SystemBackupRecord(operation="BACKUP", status="QUEUED", requested_by_user_id=ROOT_ADMIN_USER_ID,
            background_job_id=job.id, artifact_name="private-file.cr", summary={"private": "body"})
        db.add_all([record, ImportRecord(source_profile="private-source", source_fingerprint="a" * 64, json_filename="private-file.json", total_bytes=4, draft_storage_uri="private-path", status="queued"),
            WorkerRuntimeState(worker_key="primary", instance_id=uuid.uuid4(), state="busy", task_kind="job", heartbeat_at=now, started_at=now)])
        db.commit()
        snapshot = admin_runtime.runtime_snapshot(db, settings, now=now)
        assert snapshot["complete"] is True
        assert snapshot["queue"]["jobs"]["failed"] == 1
        assert snapshot["queue"]["imports"]["queued"] == 1
        assert snapshot["worker"]["status"] == "alive_busy"
        assert snapshot["backup"]["record"]["status"] == "FAILED"
        assert snapshot["restore"] == {"available": True, "record": None}
        assert snapshot["storage"]["assets"]["bytes"] == len(b"private body")
        assert not db.new and not db.dirty and not db.deleted
        assert db.get(SystemBackupRecord, record.id).status == "QUEUED"
        serialized = json.dumps(snapshot, default=str)
        assert "private" not in serialized and str(job.id) not in serialized


def test_runtime_counts_pauses_and_both_cancel_spellings_without_hiding_unknowns(auth_client, monkeypatch, tmp_path):
    settings = roots(monkeypatch, tmp_path)
    with auth_middleware.SessionLocal() as db:
        for state in ("paused", "previewed", "analyzing", "canceled", "cancelled", "unknown-private-state"):
            db.add(ImportRecord(source_profile="synthetic", source_fingerprint=uuid.uuid4().hex, status=state))
        db.commit()
        result = admin_runtime.runtime_snapshot(db, settings)["queue"]["imports"]
        assert result["paused"] == result["previewed"] == result["analyzing"] == 1
        assert result["cancelled"] == 2
        assert result["other"] == 1
        assert "unknown-private-state" not in json.dumps(result)
        assert sum(result.values()) == 6


def test_runtime_source_cleanup_counts_only_discarded_sessions_and_does_not_expose_bindings(auth_client, monkeypatch, tmp_path):
    from app.services.adaptive_import.source_cleanup import KEY
    settings = roots(monkeypatch, tmp_path)
    with auth_middleware.SessionLocal() as db:
        for status, state in (("canceled", "pending"), ("cancelled", "blocked"),
                              ("canceled", "completed"), ("paused", "failed"), ("committed", "failed")):
            db.add(ImportRecord(source_profile="synthetic", source_fingerprint=uuid.uuid4().hex,
                status=status, session_state="CANCELED", analysis_summary={KEY: {
                    "state": state, "version": 1, "revision": str(uuid.uuid4()), "root_digest": "private-binding"}}))
        db.commit()
        result = admin_runtime.runtime_snapshot(db, settings)
        assert result["source_cleanup"] == {"available": True, "pending_count": 2, "blocked_count": 1}
        assert "private-binding" not in json.dumps(result)


@pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1",
                    reason="requires explicitly selected disposable PostgreSQL")
def test_postgres_source_cleanup_aggregate_reuses_its_grouped_expression(isolated_schema, monkeypatch, tmp_path):
    from app.models.user import User
    from app.services.adaptive_import.source_cleanup import KEY
    engine, migrate = isolated_schema
    migrate("head")
    settings = roots(monkeypatch, tmp_path)
    with Session(engine) as db:
        owner = User(normalized_email=f"cleanup-metric-{uuid.uuid4()}@example.test")
        db.add(owner)
        db.flush()
        for status, state, version in (
            ("canceled", "pending", 1), ("cancelled", "failed", 1),
            ("canceled", "blocked", 1), ("canceled", "completed", 1),
            ("paused", "failed", 1), ("canceled", "blocked", 2),
        ):
            db.add(ImportRecord(owner_user_id=owner.id, source_profile="synthetic", source_fingerprint=uuid.uuid4().hex,
                status=status, session_state="CANCELED", analysis_summary={KEY: {
                    "state": state, "version": version, "revision": str(uuid.uuid4()),
                    "root_digest": "synthetic-private-binding"}}))
        db.commit()
        before = db.query(ImportRecord.id, ImportRecord.status, ImportRecord.analysis_summary).all()
        snapshot = admin_runtime.runtime_snapshot(db, settings)
        assert snapshot["source_cleanup"] == {"available": True, "pending_count": 3, "blocked_count": 1}
        assert "synthetic-private-binding" not in json.dumps(snapshot)
        assert not db.new and not db.dirty and not db.deleted
        assert db.query(ImportRecord.id, ImportRecord.status, ImportRecord.analysis_summary).all() == before


@pytest.mark.parametrize("age,state", [(10, "alive_idle"), (500, "stale"), (-10, "unavailable")])
def test_worker_liveness_is_not_inferred_from_finished_jobs(auth_client, monkeypatch, tmp_path, age, state):
    settings = roots(monkeypatch, tmp_path)
    now = datetime.now(timezone.utc)
    with auth_middleware.SessionLocal() as db:
        db.add(WorkerRuntimeState(worker_key="primary", instance_id=uuid.uuid4(), state="idle", heartbeat_at=now - timedelta(seconds=age), started_at=now))
        db.commit()
        result = admin_runtime.runtime_snapshot(db, settings, now=now)
        assert result["worker"]["status"] == state
        assert result["complete"] is (state != "unavailable")


def test_partial_metrics_and_remote_assets_are_explicit(auth_client, monkeypatch, tmp_path):
    settings = roots(monkeypatch, tmp_path).model_copy(update={"asset_storage_backend": "s3"})
    with auth_middleware.SessionLocal() as db:
        db.add(AssetObject(sha256="a" * 64, byte_size=33, detected_mime_type="text/plain", storage_backend="s3", storage_key="private-key", status="ready"))
        db.commit()
        result = admin_runtime.runtime_snapshot(db, settings)
        assert result["storage"]["assets"] == {"available": True, "kind": "object_records", "file_count": 1, "bytes": 33, "complete": True}
        monkeypatch.setattr(admin_runtime, "_counts", lambda *args: (_ for _ in ()).throw(RuntimeError("private-error")))
        monkeypatch.setattr(admin_runtime, "storage_usage", lambda *args, **kwargs: {"file_count": 1, "bytes": 4, "complete": False})
        result = admin_runtime.runtime_snapshot(db, settings)
        assert result["queue"] == {"available": False}
        assert result["worker"]["processing_task_count"] is None
        assert not result["storage"]["imports"]["complete"]
        assert not result["complete"] and "private-error" not in json.dumps(result)


def test_storage_budget_counts_directories_and_honors_deadline(tmp_path, monkeypatch):
    for index in range(12):
        (tmp_path / str(index)).mkdir()
    assert diagnostics.storage_usage(tmp_path, max_entries=3)["complete"] is False
    assert diagnostics.storage_usage(tmp_path / "missing")["complete"] is False
    clock = iter([0, 0, 0, 0.5])
    monkeypatch.setattr(diagnostics.time, "monotonic", lambda: next(clock, 1))
    assert diagnostics.storage_usage(tmp_path, time_budget_seconds=0.1)["complete"] is False


@pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1", reason="requires disposable PostgreSQL")
def test_postgres_timeout_recovery_and_read_only_snapshot(isolated_schema, monkeypatch, tmp_path):
    engine, migrate = isolated_schema
    migrate("head")
    settings = roots(monkeypatch, tmp_path)
    with Session(engine) as db:
        db.execute(text("SET TRANSACTION READ ONLY"))
        result = admin_runtime._metric(db, lambda: {"value": db.execute(text("SELECT pg_sleep(2)")).scalar()})
        assert result == {"available": False}
        assert db.execute(text("SELECT 1")).scalar() == 1
        result = admin_runtime.runtime_snapshot(db, settings)
        assert result["queue"]["available"] and result["queue"]["jobs"]["queued"] == 0
        assert result["backup"] == {"available": True, "record": None}
        db.commit()
