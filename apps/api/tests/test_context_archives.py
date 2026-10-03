"""Real .cr roundtrip for direct Context snapshots, without semantic adoption."""
import json
from pathlib import Path
import zipfile

import pytest

from app.models.user import User
from app.models.context_continuation import ContinuationRevision, ContinuationState, ContextMemberObject, ContextBinding
from app.services.assets.asset_store import get_asset_store
from app.services.exporting.personal_archive import create_personal_archive
from app.services.exporting.personal_restore import restore_personal_archive
from app.services.exporting.archive_preflight import inspect_personal_archive
from app.services.exporting.system_archive import SystemArchiveError
from test_context_cleanup import update
from test_system_archive_integrity import archive_db, seed_archive_source  # noqa: F401
from test_personal_restore import repack
from test_system_archive_configuration import configuration_target, bootstrap_target  # noqa: F401


def test_personal_context_roundtrip_and_idempotency(archive_db):
    db = archive_db
    users, conversations, job, _ = seed_archive_source(db)
    for generation in range(3):
        update(db, conversations[0], generation, f'# Current {generation}'.encode())
    from app.services.continuation_files import update_files
    from app.services.ownership import OwnershipScope
    update_files(db, conversations[0].id, OwnershipScope(users[0].id),
        members={'current': b'# Current 3', 'index': b'{"chapters": []}'}, base_generation=3)
    db.add(ContextBinding(conversation_id=conversations[0].id, identity_digest='a' * 64,
        identity={'conversation': 'synthetic-external'}, locator_mapping={'external': 'source-anchor'}))
    db.commit()
    update(db, conversations[1], 0, b'private-other-account')
    artifact = create_personal_archive(db, job_id=job.id, owner_user_id=users[0].id)
    db.commit()
    path = Path(artifact.storage_uri)
    with zipfile.ZipFile(path) as source:
        assert json.loads(source.read('manifest.json'))['context_files_version'] == 1
        assert b'private-other-account' not in b''.join(source.read(name) for name in source.namelist())
        assert b'storage_key' not in source.read('data/context_member_objects.jsonl')
        assert not any('candidate' in name or 'validation' in name for name in source.namelist())
    target = User(normalized_email='context-restore@example.test')
    db.add(target); db.commit()
    digest = inspect_personal_archive(path)['content_digest']
    result = restore_personal_archive(db, path, owner_user_id=target.id, expected_digest=digest)
    db.commit()
    import uuid
    restored_id = uuid.UUID(result['conversation_ids'][0])
    assert restored_id != conversations[0].id
    revisions = db.query(ContinuationRevision).filter_by(conversation_id=restored_id).all()
    assert len(revisions) == 3
    texts = {get_asset_store().resolve_key(db.get(ContextMemberObject, row.current_sha256).storage_key).read_bytes() for row in revisions}
    assert texts == {f'# Current {i}'.encode() for i in (1, 2, 3)}
    selected = db.get(ContinuationState, restored_id).adopted_revision_id
    assert selected in {row.id for row in revisions}
    selected_row = db.get(ContinuationRevision, selected)
    assert get_asset_store().resolve_key(db.get(ContextMemberObject, selected_row.index_sha256).storage_key).read_bytes() == b'{"chapters": []}'
    binding = db.query(ContextBinding).filter_by(conversation_id=restored_id).one()
    assert binding.identity == {'conversation': 'synthetic-external'}
    assert binding.id != db.query(ContextBinding).filter_by(conversation_id=conversations[0].id).one().id
    assert all(row.declared_trust == 'unverified' for row in revisions)
    count = db.query(ContinuationRevision).count()
    assert restore_personal_archive(db, path, owner_user_id=target.id, expected_digest=digest)['already_restored']
    db.commit()
    assert db.query(ContinuationRevision).count() == count


def test_corrupt_context_member_rejected(archive_db, tmp_path):
    db = archive_db
    users, conversations, job, _ = seed_archive_source(db)
    update(db, conversations[0], 0, b'# synthetic')
    artifact = create_personal_archive(db, job_id=job.id, owner_user_id=users[0].id)
    db.commit()
    def corrupt(files, manifest):
        path = next(name for name in files if name.startswith('context/objects/'))
        files[path] = b'tampered'
    path = repack(artifact.storage_uri, tmp_path / 'bad-context.cr', corrupt)
    before = db.query(ContinuationRevision).count()
    with pytest.raises(SystemArchiveError):
        inspect_personal_archive(path)
    assert db.query(ContinuationRevision).count() == before


@pytest.mark.parametrize('rollback', [False, True])
def test_system_context_restore(archive_db, configuration_target, tmp_path, monkeypatch, rollback):
    from app.core.config import get_settings
    from app.services.exporting.system_archive import create_system_archive, restore_system_archive
    db = archive_db
    users, conversations, job, _ = seed_archive_source(db)
    users[1].role = 'ADMIN'
    update(db, conversations[0], 0, b'# preserved bytes')
    update(db, conversations[0], 1, b'# second snapshot')
    source_id = conversations[0].id
    artifact = create_system_archive(db, job_id=job.id, include_archived=True)
    db.commit()
    monkeypatch.setenv('ASSET_STORAGE_DIR', str(tmp_path / 'fresh-context'))
    get_settings.cache_clear()
    root, _ = bootstrap_target(configuration_target)
    if rollback:
        from app.services.exporting import archive_context
        original = archive_context.restore_context
        def interrupted(*args):
            original(*args)
            raise RuntimeError('synthetic failure after Context restore')
        monkeypatch.setattr(archive_context, 'restore_context', interrupted)
        with pytest.raises(RuntimeError, match='synthetic failure'):
            restore_system_archive(configuration_target, Path(artifact.storage_uri), target_root_id=root)
        configuration_target.rollback()
        assert configuration_target.query(ContinuationRevision).count() == 0
        assert configuration_target.query(ContextMemberObject).count() == 0
        assert not [p for p in (tmp_path / 'fresh-context').rglob('*') if p.is_file()]
        return
    restore_system_archive(configuration_target, Path(artifact.storage_uri), target_root_id=root)
    configuration_target.commit()
    rows = configuration_target.query(ContinuationRevision).filter_by(conversation_id=source_id).all()
    assert len(rows) == 2
    assert all(row.declared_trust == 'unverified' for row in rows)
    selected = configuration_target.get(ContinuationState, source_id).adopted_revision_id
    row = configuration_target.get(ContinuationRevision, selected)
    obj = configuration_target.get(ContextMemberObject, row.current_sha256)
    assert get_asset_store().resolve_key(obj.storage_key).read_bytes() == b'# second snapshot'


def test_pre_context_extension_archive_remains_readable(archive_db, tmp_path):
    from app.services.exporting.archive_context import CONTEXT_TABLES
    users, _, job, _ = seed_archive_source(archive_db)
    artifact = create_personal_archive(archive_db, job_id=job.id, owner_user_id=users[0].id)
    archive_db.commit()
    def legacy(files, manifest):
        manifest.pop('context_files_version')
        removed = {f'data/{name}.jsonl' for name in CONTEXT_TABLES}
        manifest['canonical_entries'] = [row for row in manifest['canonical_entries'] if row['path'] not in removed]
        for name in removed:
            files.pop(name)
    path = repack(artifact.storage_uri, tmp_path / 'legacy.cr', legacy)
    assert 'continuation_revisions' not in inspect_personal_archive(path)['counts']
