"""Only synthetic, task-local storage; no user import sources."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import uuid

import pytest
from sqlalchemy.orm import sessionmaker

from app.core.database import get_db
from app.core.config import get_settings
from app.main import app
from app.models.attachment import AssetObject, AssetObjectLease
from app.services.assets.lifecycle import garbage_collect_assets, cleanup_deleted_assets
from app.services.assets.asset_store import get_asset_store
from test_import_preview_api import client  # noqa: F401


def test_gc_is_bounded_preserves_leases_and_retries_only_remaining_files(client, monkeypatch):
    gen = app.dependency_overrides[get_db]()
    db = next(gen)
    try:
        store = get_asset_store()
        ids = []
        for index in range(4):
            key = store.object_key()
            path = Path(get_settings().asset_storage_dir) / key
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"synthetic")
            asset = AssetObject(id=uuid.uuid4(), sha256=f"{index:064x}", byte_size=9,
                detected_mime_type="text/plain", storage_backend="local", storage_key=key,
                status="available", scan_status="clean", created_at=datetime.now(timezone.utc) - timedelta(days=40))
            db.add(asset); ids.append(asset.id)
        db.flush()
        db.add(AssetObjectLease(asset_object_id=ids[0], holder_type="import", holder_id="synthetic",
            expires_at=datetime.now(timezone.utc) + timedelta(days=1)))
        db.commit()
        assert garbage_collect_assets(db, execute=False, limit=2).candidates == 2
        assert all(db.get(AssetObject, aid).status == "available" for aid in ids)
        original = type(store).delete_key
        monkeypatch.setattr(type(store), "delete_key", lambda *args: (_ for _ in ()).throw(OSError("synthetic disk unavailable")))
        result = garbage_collect_assets(db, execute=True, limit=2)
        assert result.marked_deleted == 2 and result.deleted_files == 0
        assert db.get(AssetObject, ids[0]).status == "available"
        assert sum(db.get(AssetObject, aid).status == "available" for aid in ids) == 2
        monkeypatch.setattr(type(store), "delete_key", original)
        assert cleanup_deleted_assets(db, limit=1) == 1
        assert cleanup_deleted_assets(db, limit=10) == 1
        assert cleanup_deleted_assets(db, limit=10) == 0
        assert db.get(AssetObject, ids[0]).status == "available"
        assert sum(db.get(AssetObject, aid).storage_deleted_at is not None for aid in ids) == 2
    finally:
        gen.close()


def test_temporary_cleanup_failure_cannot_replace_archive_failure(tmp_path, monkeypatch, caplog):
    from app.services.exporting.cr_archive import _staged_archive
    temporary = tmp_path / "synthetic.cr.part"
    monkeypatch.setattr(Path, "unlink", lambda *a, **kw: (_ for _ in ()).throw(PermissionError("synthetic busy file")))
    with pytest.raises(ValueError, match="original archive failure"):
        with _staged_archive(temporary):
            raise ValueError("original archive failure")
    assert temporary.is_file()
    assert "artifact_temporary_cleanup_deferred" in caplog.text


def test_maintenance_rotates_each_family_to_first_position(monkeypatch):
    from app.services.worker_maintenance import run_worker_maintenance
    from app.services import export_retention
    from app.services.sharing import share_service
    from app.services.assets import upload_service, lifecycle
    calls = []
    class Database:
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass
    for module, name, label in (
        (export_retention, "reclaim_exports", "exports"),
        (share_service, "reclaim_expired_frozen_snapshots", "shares"),
        (upload_service, "cleanup_finished_uploads", "uploads"),
        (lifecycle, "cleanup_deleted_assets", "assets"),
    ):
        monkeypatch.setattr(module, name, lambda *args, _label=label, **kw: calls.append(_label))
    first = []
    for lane in range(4):
        calls.clear()
        run_worker_maintenance(Database, Path("."), should_continue=lambda: not calls, start_lane=lane)
        first.extend(calls)
    assert first == ["exports", "shares", "uploads", "assets"]


def test_stage_cleanup_failure_preserves_original_limit_error(tmp_path, monkeypatch, caplog):
    import io
    from app.services.assets.asset_store import LocalAssetStore
    store = LocalAssetStore(tmp_path / "assets")
    monkeypatch.setattr(Path, "unlink", lambda *a, **kw: (_ for _ in ()).throw(PermissionError("synthetic cleanup refusal")))
    with pytest.raises(ValueError, match="configured size limit"):
        store.stage(io.BytesIO(b"synthetic bytes"), max_bytes=1)
    assert "artifact_temporary_cleanup_deferred" in caplog.text


def test_promotion_permission_failure_retains_staged_input(tmp_path, monkeypatch):
    import io
    from app.services.assets.asset_store import LocalAssetStore
    from app.services.assets import asset_store
    store = LocalAssetStore(tmp_path / "assets")
    staged = store.stage(io.BytesIO(b"synthetic"), max_bytes=32)
    key = store.object_key()
    monkeypatch.setattr(asset_store.os, "chmod", lambda *args: (_ for _ in ()).throw(PermissionError("synthetic mode refusal")))
    with pytest.raises(PermissionError):
        store.promote(staged.path, key)
    assert staged.path.read_bytes() == b"synthetic"
    assert not store.resolve_key(key, must_exist=False).exists()
