"""Real member/history round trips through .cr, using synthetic content only."""
import io
import json
import uuid
import zipfile
from pathlib import Path

import pytest

from app.models.user import User
from app.models.user_skill import UserSkill
from app.models.skill_bundle import SkillBundleRevision, SkillFileObject
from app.models.administration import SystemSkill
from app.services.skills import create_skill
from app.services.skill_bundles import parse_bundle, save_revision, revision_query, download_revision
from app.services.exporting.personal_archive import create_personal_archive
from app.services.exporting.personal_restore import restore_personal_archive
from app.services.exporting.archive_preflight import inspect_personal_archive
from app.services.exporting.system_archive import create_system_archive, restore_system_archive, SystemArchiveError
from app.services.system_skills import create_system_skill
from test_skill_bundles import bundle
from test_system_archive_integrity import archive_db, seed_archive_source  # noqa: F401
from test_system_archive_configuration import configuration_target, bootstrap_target  # noqa: F401
from test_personal_restore import repack


def add_skill(db, owner, script):
    parsed = parse_bundle(bundle(script), 'demo.zip')
    row = create_skill(db, category='EXPORT_CONTEXT', locale='en', name='Synthetic Bundle',
                       content=parsed.content, subject_key=str(owner), bundle_digest=parsed.digest)
    save_revision(db, row, parsed, base_revision=0, preserve_baseline=False)
    return row


def script_bytes(db, skill, revision):
    row = revision_query(db, skill).filter(SkillBundleRevision.revision == revision).one()
    with zipfile.ZipFile(io.BytesIO(download_revision(db, row))) as archive:
        return archive.read('demo/scripts/action.py')


def test_personal_archive_keeps_distinct_scripts_all_versions_and_idempotency(archive_db):
    db = archive_db
    users, _, job, _ = seed_archive_source(db)
    first = add_skill(db, users[0].id, b'old-script')
    save_revision(db, first, parse_bundle(bundle(b'new-script'), 'demo.zip'), base_revision=1)
    second = add_skill(db, users[0].id, b'different-script')
    add_skill(db, users[1].id, b'private-other-user')
    db.commit()
    artifact = create_personal_archive(db, job_id=job.id, owner_user_id=users[0].id)
    db.commit()
    with zipfile.ZipFile(artifact.storage_uri) as archive:
        assert json.loads(archive.read('manifest.json'))['skill_bundle_version'] == 1
        data = b''.join(archive.read(name) for name in archive.namelist())
        assert b'private-other-user' not in data
        assert b'storage_key' not in archive.read('data/skill_file_objects.jsonl')
    target = User(normalized_email='bundle-restore@example.test')
    db.add(target); db.commit()
    restore_personal_archive(db, Path(artifact.storage_uri), owner_user_id=target.id, expected_digest=inspect_personal_archive(Path(artifact.storage_uri))["content_digest"])
    db.commit()
    restored = db.query(UserSkill).filter_by(subject_key=str(target.id)).all()
    assert len(restored) == 2
    by_digest = {row.bundle_digest: row for row in restored}
    assert script_bytes(db, by_digest[first.bundle_digest], 1) == b'old-script'
    assert script_bytes(db, by_digest[first.bundle_digest], 2) == b'new-script'
    assert script_bytes(db, by_digest[second.bundle_digest], 1) == b'different-script'
    count = db.query(SkillBundleRevision).count()
    restore_personal_archive(db, Path(artifact.storage_uri), owner_user_id=target.id, expected_digest=inspect_personal_archive(Path(artifact.storage_uri))["content_digest"])
    db.commit()
    assert db.query(SkillBundleRevision).count() == count


def test_bundle_corruption_rejected_before_writes(archive_db, tmp_path):
    db = archive_db
    users, _, job, _ = seed_archive_source(db)
    add_skill(db, users[0].id, b'synthetic')
    db.commit()
    artifact = create_personal_archive(db, job_id=job.id, owner_user_id=users[0].id)
    db.commit()
    def corrupt(files, manifest):
        path = next(name for name in files if name.startswith('skills/objects/'))
        files[path] = b'tampered'
    changed = repack(artifact.storage_uri, tmp_path / 'corrupt.cr', corrupt)
    before = db.query(SkillFileObject).count()
    with pytest.raises(SystemArchiveError):
        inspect_personal_archive(changed)
    assert db.query(SkillFileObject).count() == before


@pytest.mark.parametrize("fail_after_restore", [False, True])
def test_system_restore_keeps_bundle_history_in_fresh_instance(archive_db, configuration_target, tmp_path, monkeypatch, fail_after_restore):
    db = archive_db
    users, _, job, _ = seed_archive_source(db)
    users[1].role = 'ADMIN'
    personal = add_skill(db, users[0].id, b'personal-v1')
    system = create_system_skill(db, actor_user_id=users[1].id, category='EXPORT_CONTEXT', locale='en',
                                 name='System Bundle', content='legacy system instructions', default_enabled=True)
    save_revision(db, system, parse_bundle(bundle(b'system-v2'), 'demo.zip'), base_revision=0)
    db.commit()
    artifact = create_system_archive(db, job_id=job.id, include_archived=True)
    db.commit()
    from app.core.config import get_settings
    monkeypatch.setenv('ASSET_STORAGE_DIR', str(tmp_path / 'restored-objects'))
    get_settings.cache_clear()
    root, _ = bootstrap_target(configuration_target)
    if fail_after_restore:
        from app.services.exporting import system_archive_configuration as configuration
        original = configuration.restore_system_configuration
        def interrupted(*args, **kwargs):
            original(*args, **kwargs)
            raise RuntimeError('Synthetic interruption after member restoration')
        monkeypatch.setattr(configuration, 'restore_system_configuration', interrupted)
        with pytest.raises(RuntimeError, match='Synthetic interruption'):
            restore_system_archive(configuration_target, Path(artifact.storage_uri), target_root_id=root)
        configuration_target.rollback()
        assert configuration_target.query(SkillBundleRevision).count() == 0
        assert configuration_target.query(SkillFileObject).count() == 0
        assert not [p for p in (tmp_path / 'restored-objects').rglob('*') if p.is_file()]
        return
    restore_system_archive(configuration_target, Path(artifact.storage_uri), target_root_id=root)
    configuration_target.commit()
    restored = configuration_target.get(UserSkill, personal.id)
    assert restored.subject_key != personal.subject_key
    assert script_bytes(configuration_target, restored, 1) == b'personal-v1'
    restored_system = configuration_target.get(SystemSkill, system.id)
    assert restored_system.bundle_revision == 2
    assert script_bytes(configuration_target, restored_system, 2) == b'system-v2'


def test_legacy_archive_without_bundle_extension_remains_readable(archive_db, tmp_path):
    from test_personal_archive import seed_personal_data
    users, _, job = seed_personal_data(archive_db)
    artifact = create_personal_archive(archive_db, job_id=job.id, owner_user_id=users[0].id)
    archive_db.commit()
    def legacy(files, manifest):
        manifest.pop('skill_bundle_version')
        removed = {f'data/{name}.jsonl' for name in ('skill_file_objects', 'skill_bundle_members', 'skill_bundle_revisions')}
        manifest['canonical_entries'] = [row for row in manifest['canonical_entries'] if row['path'] not in removed]
        for name in removed: files.pop(name)
    old = repack(artifact.storage_uri, tmp_path / 'legacy-personal.cr', legacy)
    preview = inspect_personal_archive(old)
    assert preview['counts']['skills'] == 1
    assert 'skill_bundle_revisions' not in preview['counts']


def test_restore_merges_history_without_switching_existing_personal_revision(archive_db):
    db = archive_db
    users, _, job, _ = seed_archive_source(db)
    source = add_skill(db, users[0].id, b'archived-old')
    save_revision(db, source, parse_bundle(bundle(b'common-current'), 'demo.zip'), base_revision=1)
    existing = add_skill(db, users[1].id, b'local-old')
    save_revision(db, existing, parse_bundle(bundle(b'common-current'), 'demo.zip'), base_revision=1)
    db.commit()
    artifact = create_personal_archive(db, job_id=job.id, owner_user_id=users[0].id)
    db.commit()
    restore_personal_archive(db, Path(artifact.storage_uri), owner_user_id=users[1].id,
                             expected_digest=inspect_personal_archive(Path(artifact.storage_uri))['content_digest'])
    db.commit()
    db.refresh(existing)
    assert existing.bundle_revision == 2
    assert script_bytes(db, existing, 1) == b'local-old'
    assert script_bytes(db, existing, 2) == b'common-current'
    assert script_bytes(db, existing, 3) == b'archived-old'
    assert db.query(UserSkill).filter_by(subject_key=str(users[1].id)).count() == 1
