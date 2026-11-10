"""Recovery of explicit source disposal, using task-owned synthetic files only."""
import json
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy.orm import Session, sessionmaker

from app.main import app
from app.models.background_job import BackgroundJob
from app.models.import_record import ImportRecord
from app.models.user import User
from app.services.adaptive_import import service, source_cleanup
from app.services.ownership import OwnershipScope, ownership_scope_from_request
from test_import_analysis_queue import client, database, queue, source, synthetic_headroom  # noqa: F401
from test_import_profile_postgres import isolated_schema  # noqa: F401


def discard_with_failure(client, monkeypatch, tmp_path):
    queued = queue(client, count=1)
    with monkeypatch.context() as patch:
        patch.setattr(service.shutil, "rmtree", lambda _path: (_ for _ in ()).throw(PermissionError("private path")))
        assert client.delete(f"/api/adaptive-import/sessions/{queued['import_id']}").status_code == 204
    return queued, tmp_path / "storage" / "imports" / queued["import_id"]


def test_pending_cleanup_survives_process_interruption_and_private_binding_is_not_exposed(client, monkeypatch, tmp_path):
    queued = queue(client, count=1)
    path = tmp_path / "storage" / "imports" / queued["import_id"]
    with monkeypatch.context() as patch:
        patch.setattr(source_cleanup, "finish_receipt", lambda *args: None)
        assert client.delete(f"/api/adaptive-import/sessions/{queued['import_id']}").status_code == 204
    response = client.get(f"/api/adaptive-import/sessions/{queued['import_id']}")
    assert response.json()["source_cleanup"]["state"] == "pending"
    assert source_cleanup.KEY not in response.text and "root_digest" not in response.text
    assert path.is_dir()
    assert client.post(f"/api/tasks/{queued['import_id']}/retry").json()["result"]["source_cleanup"]["state"] == "completed"
    assert not path.exists()


@pytest.mark.parametrize("commit_happened", [False, True])
def test_unknown_receipt_write_never_restarts_import_and_reconciles_missing_directory(client, tmp_path, monkeypatch, commit_happened):
    queued = queue(client, count=1)
    original_commit = Session.commit

    def commit(db):
        receipt_write = any(isinstance(row, ImportRecord)
            and (row.analysis_summary or {}).get(source_cleanup.KEY, {}).get("state") == "completed" for row in db.dirty)
        if receipt_write:
            if commit_happened:
                original_commit(db)
            raise RuntimeError("private connection details")
        return original_commit(db)

    with monkeypatch.context() as patch:
        patch.setattr(Session, "commit", commit)
        assert client.delete(f"/api/adaptive-import/sessions/{queued['import_id']}").status_code == 204
    assert not (tmp_path / "storage" / "imports" / queued["import_id"]).exists()
    state = client.get(f"/api/tasks/{queued['import_id']}").json()
    assert state["result"]["source_cleanup"]["state"] == ("completed" if commit_happened else "pending")
    assert client.post(f"/api/tasks/{queued['import_id']}/retry").json()["result"]["source_cleanup"]["state"] == "completed"
    assert client.get(f"/api/tasks/{queued['analysis_task_id']}").json()["status"] == "cancelled"


def test_reconfigured_root_is_not_rebound_to_unrelated_directory(client, tmp_path, monkeypatch):
    queued, original = discard_with_failure(client, monkeypatch, tmp_path)
    other_root = tmp_path / "other-root"
    other_file = other_root / queued["import_id"] / "preserved.txt"
    other_file.parent.mkdir(parents=True)
    other_file.write_bytes(b"unrelated synthetic source")
    with monkeypatch.context() as patch:
        patch.setattr(service, "get_settings", lambda: SimpleNamespace(import_storage_dir=other_root))
        response = client.post(f"/api/tasks/{queued['import_id']}/retry")
    assert response.status_code == 200
    assert response.json()["result"]["source_cleanup"]["state"] == "blocked"
    assert original.is_dir() and other_file.read_bytes() == b"unrelated synthetic source"
    assert client.post(f"/api/tasks/{queued['import_id']}/retry").json()["result"]["source_cleanup"]["state"] == "completed"
    assert not original.exists() and other_file.is_file()


def test_missing_storage_root_is_unknown_not_proof_of_completed_cleanup(client, tmp_path, monkeypatch):
    queued, original = discard_with_failure(client, monkeypatch, tmp_path)
    retained_root = tmp_path / "temporarily-offline-storage"
    original.parent.rename(retained_root)
    response = client.post(f"/api/tasks/{queued['import_id']}/retry")
    assert response.json()["result"]["source_cleanup"]["state"] == "blocked"
    assert (retained_root / queued["import_id"] / "source-0.json").read_bytes() == source()
    retained_root.rename(original.parent)
    assert client.post(f"/api/tasks/{queued['import_id']}/retry").json()["result"]["source_cleanup"]["state"] == "completed"


@pytest.mark.parametrize("identity", ["../preserved", "/outside", "not-an-import-id"])
def test_session_cleanup_rejects_non_uuid_targets_before_touching_files(tmp_path, identity):
    preserved = tmp_path / "preserved"
    preserved.mkdir()
    marker = preserved / "synthetic.txt"
    marker.write_bytes(b"not a session")
    with pytest.raises(source_cleanup.SourceCleanupBlocked):
        service.remove_session_files(identity, storage_root=tmp_path)
    assert marker.read_bytes() == b"not a session"


@pytest.mark.parametrize("replacement", ["file", "symlink"])
def test_changed_directory_is_protected_not_reported_as_removed(client, tmp_path, monkeypatch, replacement):
    queued, original = discard_with_failure(client, monkeypatch, tmp_path)
    retained = tmp_path / "retained-source"
    original.rename(retained)
    if replacement == "symlink":
        try:
            original.symlink_to(retained, target_is_directory=True)
        except OSError:
            if os.name == "nt":
                pytest.skip("Windows user cannot create a test symlink")
            raise
    else:
        original.write_bytes(b"unrelated replacement")
    response = client.post(f"/api/tasks/{queued['import_id']}/retry")
    assert response.json()["result"]["source_cleanup"]["state"] == "blocked"
    assert (retained / "source-0.json").read_bytes() == source()
    assert original.lstat()


def test_stale_receipt_cannot_delete_sources_or_override_a_new_request(client, tmp_path, monkeypatch):
    queued, path = discard_with_failure(client, monkeypatch, tmp_path)
    identity = uuid.UUID(queued["import_id"])
    with database() as db:
        record = db.get(ImportRecord, identity)
        old = dict(record.analysis_summary[source_cleanup.KEY])
        new_revision = source_cleanup.schedule_receipt(record, path.parent)
        db.commit()
        source_cleanup.finish_receipt(db.get_bind(), identity, path.parent, old["revision"], service.remove_session_files)
        db.expire_all()
        assert db.get(ImportRecord, identity).analysis_summary[source_cleanup.KEY]["revision"] == new_revision
        assert db.get(ImportRecord, identity).analysis_summary[source_cleanup.KEY]["state"] == "pending"
    assert path.is_dir()


def test_other_owner_cannot_see_or_retry_pending_cleanup(client, tmp_path, monkeypatch):
    queued, path = discard_with_failure(client, monkeypatch, tmp_path)
    with monkeypatch.context() as patch:
        patch.setitem(app.dependency_overrides, ownership_scope_from_request, lambda: OwnershipScope(uuid.uuid4()))
        assert client.get("/api/tasks/active").json() == []
        assert client.get(f"/api/tasks/{queued['import_id']}").status_code == 404
        assert client.post(f"/api/tasks/{queued['import_id']}/retry").status_code == 404
    assert path.is_dir()


def test_pending_cleanup_has_separate_bounded_window_and_does_not_claim_active_slots(client):
    queued = queue(client, count=1)
    with database() as db:
        owner = db.get(ImportRecord, uuid.UUID(queued["import_id"])).owner_user_id
        for _ in range(25):
            db.add(ImportRecord(owner_user_id=owner, source_profile="synthetic", source_fingerprint=uuid.uuid4().hex,
                status="canceled", session_state="CANCELED", updated_at=datetime.now(timezone.utc) - timedelta(days=3),
                analysis_summary={source_cleanup.KEY: {"version": 1, "state": "failed", "revision": str(uuid.uuid4())}}))
        db.commit()
    rows = client.get("/api/tasks/active").json()
    pending = [row for row in rows if row["result"].get("source_cleanup")]
    assert len(pending) == 20
    assert any(row["job_id"] == queued["analysis_task_id"] and row["status"] == "queued" for row in rows)


@pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1", reason="requires disposable PostgreSQL")
def test_receipt_respects_real_postgres_lock_and_retries_after_release(isolated_schema, tmp_path, monkeypatch):
    engine, migrate = isolated_schema
    migrate("head")
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    root = tmp_path / "imports"
    with factory() as db:
        owner = User(normalized_email="cleanup-lock@example.test")
        db.add(owner)
        db.flush()
        record = ImportRecord(owner_user_id=owner.id, source_profile="synthetic", source_fingerprint="c" * 64,
            status="canceled", session_state="CANCELED")
        db.add(record)
        db.flush()
        revision = source_cleanup.schedule_receipt(record, root)
        db.commit()
        identity = record.id
    target = root / str(identity)
    target.mkdir(parents=True)
    (target / "source.txt").write_bytes(b"synthetic retained source")
    with factory() as holder:
        holder.query(ImportRecord).filter_by(id=identity).with_for_update().one()
        with ThreadPoolExecutor(max_workers=1) as executor:
            executor.submit(source_cleanup.finish_receipt, engine, identity, root, revision, service.remove_session_files).result(timeout=5)
        assert target.is_dir()
    source_cleanup.finish_receipt(engine, identity, root, revision, service.remove_session_files)
    assert not target.exists()
    with factory() as db:
        assert source_cleanup.public_receipt(db.get(ImportRecord, identity))["state"] == "completed"
