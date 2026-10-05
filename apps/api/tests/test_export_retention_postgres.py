"""Real PostgreSQL row locks and upgrade/downgrade preserve export sources."""
import hashlib
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from threading import Barrier

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import sessionmaker

from app.models.background_job import BackgroundJob
from app.models.export_artifact import ExportArtifact, ExportArtifactLease
from app.models.user import User
from app.services.export_retention import acquire_download, owned_export, reclaim_exports, release_download
from app.services.ownership import OwnershipScope
from test_import_profile_postgres import isolated_schema  # noqa: F401

pytestmark = pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1", reason="requires disposable PostgreSQL")


def seed(engine, tmp_path):
    now = datetime.now(timezone.utc)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    with factory() as db:
        user = User(normalized_email="export-concurrency@example.test")
        db.add(user)
        db.flush()
        job = BackgroundJob(owner_user_id=user.id, job_type="conversation_export", status="committed")
        db.add(job)
        db.flush()
        root = tmp_path / "exports"
        path = root / str(job.id) / "synthetic.context.zip"
        path.parent.mkdir(parents=True)
        body = b"Synthetic immutable export"
        path.write_bytes(body)
        artifact = ExportArtifact(job_id=job.id, format="context_package", scope_type="conversation",
            filename=path.name, storage_uri=str(path), sha256=hashlib.sha256(body).hexdigest(),
            byte_size=len(body), expires_at=now+timedelta(minutes=3))
        db.add(artifact)
        db.commit()
        return factory, root, path, artifact.id, user.id, now


def test_claim_lock_then_live_download_prevents_concurrent_unlink(isolated_schema, tmp_path):
    engine, migrate = isolated_schema
    migrate("head")
    factory, root, path, identity, owner, now = seed(engine, tmp_path)
    with factory() as db:
        artifact = owned_export(db, identity, OwnershipScope(owner), lock=True)
        lease_id = acquire_download(db, artifact, now=now+timedelta(seconds=175))
        # A reaper that saw the pre-commit snapshot must skip the locked row.
        with ThreadPoolExecutor(max_workers=1) as pool:
            assert pool.submit(reclaim_exports, factory, root, now=now+timedelta(seconds=180)).result(timeout=5)["reclaimed"] == 0
        assert path.is_file()
        db.commit()
    assert reclaim_exports(factory, root, now=now+timedelta(seconds=181))["reclaimed"] == 0
    release_download(factory, identity, lease_id)
    assert reclaim_exports(factory, root, now=now+timedelta(seconds=182))["reclaimed"] == 1
    assert not path.exists()


def test_two_reapers_commit_one_actual_removal(isolated_schema, tmp_path):
    engine, migrate = isolated_schema
    migrate("head")
    factory, root, path, identity, owner, now = seed(engine, tmp_path)
    barrier = Barrier(2)
    def cleanup(_):
        barrier.wait(timeout=5)
        return reclaim_exports(factory, root, now=now+timedelta(days=1))
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(cleanup, range(2)))
    assert sum(result["reclaimed"] for result in results) == 1
    assert not path.exists()
    with factory() as db:
        assert db.get(ExportArtifact, identity).lifecycle_state == "reclaimed"
        assert db.query(ExportArtifactLease).count() == 0


def test_legacy_upload_and_deadlines_survive_upgrade_and_downgrade(isolated_schema):
    engine, migrate = isolated_schema
    migrate("20261005_0047")
    metadata = sa.MetaData()
    jobs = sa.Table("background_jobs", metadata, autoload_with=engine)
    exports = sa.Table("export_artifacts", metadata, autoload_with=engine)
    identity, job_id = uuid.uuid4(), uuid.uuid4()
    now = datetime.now(timezone.utc)
    deadline = now+timedelta(hours=24)
    with engine.begin() as db:
        owner = db.execute(sa.select(User.id).limit(1)).scalar_one()
        db.execute(jobs.insert().values(id=job_id, owner_user_id=owner, job_type="system_archive_preflight", status="committed", phase="completed",
            progress=100, processed_items=1, total_items=1, payload={}, result={}, attempt_count=1, queued_at=now, created_at=now, updated_at=now))
        db.execute(exports.insert().values(id=identity, job_id=job_id, scope_type="archive_upload", format="system-archive-upload",
            filename="synthetic.cr", storage_uri="synthetic-preserved.cr", sha256="0"*64, byte_size=42, download_count=0, expires_at=deadline, created_at=now))
    migrate("head")
    with sessionmaker(bind=engine)() as db:
        row = db.get(ExportArtifact, identity)
        assert row.expires_at == deadline and row.scope_type == "archive_upload"
        assert row.lifecycle_state == "active" and row.retention_seconds is None
    migrate("20261005_0047", "downgrade")
    with engine.connect() as db:
        assert db.execute(sa.select(exports.c.expires_at).where(exports.c.id == identity)).scalar_one() == deadline
    migrate("head")
