"""Corrupt offline downloads must preserve the last published package."""
import uuid
from pathlib import Path
from zipfile import ZipFile
import hashlib
from itertools import count
from types import SimpleNamespace

import pytest

from app.core.config import get_settings
from app.models.background_job import BackgroundJob
from app.models.annotation import ConversationNotebook
from app.models.offline_package_artifact import OfflinePackageArtifact
from app.services.background_jobs import queue_offline_package
from app.services.ownership import OwnershipScope
from test_attachment_bundle import bundle_state, state  # noqa: F401
from test_conversation_batch_export import run


def queue(info):
    with info['factory']() as db:
        job = queue_offline_package(db, scope='conversation', conversation_id=info['sources'][0],
            project_id=None, known_revisions={}, include_assets='all', idempotency_key=str(uuid.uuid4()),
            subject_key=str(info['owners'][0]), ownership_scope=OwnershipScope(info['owners'][0]))
        db.commit()
        return job.id


@pytest.mark.parametrize('damage', ['same_size', 'truncated', 'oversized', 'missing'])
def test_damaged_asset_cannot_replace_working_offline_package(bundle_state, tmp_path, monkeypatch, damage):
    info = bundle_state
    root = tmp_path / 'offline'
    monkeypatch.setenv('OFFLINE_STORAGE_DIR', str(root))
    get_settings.cache_clear()
    with info['factory']() as db:
        notebook = db.get(ConversationNotebook, info['notebook'])
        notebook.blocks = [{**block, 'id': str(uuid.uuid4())} for block in notebook.blocks]
        db.commit()
    first = queue(info)
    run(info['factory'], first)
    with info['factory']() as db:
        assert db.get(BackgroundJob, first).status == 'committed', db.get(BackgroundJob, first).error_message
        old = db.query(OfflinePackageArtifact).filter_by(job_id=first).one()
        old_id, old_path = old.id, Path(old.storage_uri)
        original = old_path.read_bytes()
    path = info['paths'][0]
    if damage == 'missing':
        path.unlink()
    else:
        path.write_bytes(b'X' * {'same_size': 128, 'truncated': 12, 'oversized': 256}[damage])
    second = queue(info)
    run(info['factory'], second)
    with info['factory']() as db:
        assert db.get(BackgroundJob, second).status == 'failed'
        assert db.get(BackgroundJob, second).error_message == (
            'OFFLINE_ASSET_IO' if damage == 'missing' else 'OFFLINE_ASSET_INTEGRITY'
        )
        assert db.get(OfflinePackageArtifact, old_id) is not None
        assert db.query(OfflinePackageArtifact).filter_by(job_id=second).count() == 0
    assert old_path.read_bytes() == original
    assert set(root.iterdir()) == {old_path}
    path.write_bytes(b'A' * 128)
    repaired = queue(info)
    run(info['factory'], repaired)
    with info['factory']() as db:
        assert db.get(BackgroundJob, repaired).status == 'committed'
        latest = db.query(OfflinePackageArtifact).filter_by(job_id=repaired).one()
        with ZipFile(latest.storage_uri) as archive:
            assert archive.read(f"assets/objects/{info['assets'][0]}") == b'A' * 128
        assert db.get(OfflinePackageArtifact, old_id) is None
    assert not old_path.exists()


def test_large_asset_copy_checks_cancellation_between_bounded_chunks(tmp_path, monkeypatch):
    from app.services import offline_packages
    from app.services.background_jobs import BackgroundJobCancelled
    source = tmp_path / 'synthetic-large'
    content = b'A' * (2 * 1024 * 1024)
    source.write_bytes(content)
    asset = SimpleNamespace(id=uuid.uuid4(), storage_key='synthetic-large',
        byte_size=len(content), sha256=hashlib.sha256(content).hexdigest())
    monkeypatch.setattr(offline_packages, 'get_asset_store', lambda: SimpleNamespace(resolve_key=lambda key: source))
    ticks = count()
    monkeypatch.setattr(offline_packages.time, 'monotonic', lambda: next(ticks))
    def cancel(*args):
        raise BackgroundJobCancelled()
    target = tmp_path / 'partial.zip'
    with ZipFile(target, 'w') as archive:
        with pytest.raises(BackgroundJobCancelled):
            offline_packages._write_verified_asset(archive, asset, cancel, 1, 1)
    with ZipFile(target) as archive:
        assert archive.getinfo(f'assets/objects/{asset.id}').file_size == 1024 * 1024
    assert source.read_bytes() == content
