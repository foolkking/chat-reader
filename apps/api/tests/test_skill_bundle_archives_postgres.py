"""Run Bundle archive contracts against migrated PostgreSQL foreign keys in CI."""
import os

import pytest
from sqlalchemy.orm import Session

from app.core.config import get_settings
from test_import_profile_postgres import isolated_schema  # noqa: F401
from test_system_archive_integrity import archive_db  # noqa: F401
from test_skill_bundle_archives import (
    test_personal_archive_keeps_distinct_scripts_all_versions_and_idempotency as personal_roundtrip,
    test_system_restore_keeps_bundle_history_in_fresh_instance as system_roundtrip,
)

pytestmark = pytest.mark.skipif(os.environ.get('SETTINGS_POSTGRES_INTEGRATION') != '1', reason='requires disposable PostgreSQL')


def test_personal_bundle_archive_postgres(isolated_schema, tmp_path, monkeypatch):
    engine, migrate = isolated_schema
    migrate('head')
    for key, directory in (('ASSET_STORAGE_DIR', 'objects'), ('EXPORT_STORAGE_DIR', 'exports')):
        monkeypatch.setenv(key, str(tmp_path / directory))
    get_settings.cache_clear()
    with Session(engine) as db:
        personal_roundtrip(db)


@pytest.mark.parametrize('fail_after_restore', [False, True])
def test_system_bundle_archive_postgres(archive_db, isolated_schema, tmp_path, monkeypatch, fail_after_restore):
    engine, migrate = isolated_schema
    migrate('head')
    with Session(engine) as target:
        system_roundtrip(archive_db, target, tmp_path, monkeypatch, fail_after_restore)


def test_zip_default_reset_preserves_personal_selection_postgres(isolated_schema):
    import hashlib
    from app.models.user import User
    from app.models.user_skill import UserSkill, UserSkillSelection
    from app.models.administration import SystemSkill
    from app.services.skills import resolve_skill
    engine, migrate = isolated_schema
    migrate('20261002_0045')
    # Seed the old contract directly. Current services legitimately select newer
    # policy columns and must not be executed against a historical schema.
    with Session(engine) as db:
        user = User(normalized_email='legacy-skill-owner@example.test')
        db.add(user); db.flush()
        subject = str(user.id)
        content = 'existing personal'
        personal = UserSkill(subject_key=subject, category='EXPORT_CONTEXT', locale='en', name='Keep personal',
            content=content, byte_size=len(content), content_digest=hashlib.sha256(content.encode()).hexdigest())
        db.add(personal); db.flush()
        personal_id = personal.id
        db.add(UserSkillSelection(subject_key=subject, category='EXPORT_CONTEXT', locale='en', skill_id=personal_id))
        override = 'old override'
        bundled = SystemSkill(skill_key='builtin:export:en', bundled_key='builtin:export:en', source_kind='BUNDLED',
            category='EXPORT_CONTEXT', locale='en', name='Legacy built-in', content=override,
            content_digest=hashlib.sha256(override.encode()).hexdigest(), byte_size=len(override), default_enabled=True)
        custom = SystemSkill(skill_key='legacy-default', source_kind='ADMIN_CREATED',
            category='EXPORT_CONTEXT', locale='en', name='Old default', content=override,
            content_digest=hashlib.sha256(override.encode()).hexdigest(), byte_size=len(override), default_enabled=True)
        db.add_all([bundled, custom]); db.flush()
        bundled_id, custom_id = bundled.id, custom.id
        db.commit()
    migrate('20261003_0046')
    with Session(engine) as db:
        assert db.get(SystemSkill, bundled_id).content is None
        assert db.get(SystemSkill, bundled_id).default_enabled
        assert not db.get(SystemSkill, custom_id).default_enabled
        assert db.get(UserSkill, personal_id).content == content
        assert db.get(UserSkillSelection, (subject, 'EXPORT_CONTEXT', 'en')).skill_id == personal_id
    migrate('head')
    with Session(engine) as db:
        assert resolve_skill(db, category='EXPORT_CONTEXT', locale='en', subject_key=subject)['id'] == str(personal_id)


@pytest.mark.parametrize('legacy_conflict', [False, True])
def test_concurrent_unified_preferences_remain_one_choice(isolated_schema, legacy_conflict):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from app.models.user import User
    from app.models.user_skill import UserSkillSelection
    from app.services.skills import create_skill, update_selection, selected_id

    engine, migrate = isolated_schema
    migrate('head')
    with Session(engine) as db:
        user = User(normalized_email='synthetic-choice@example.test')
        db.add(user); db.flush()
        subject = str(user.id)
        skills = [create_skill(db, category='EXPORT_CONTEXT', locale=locale, name=locale,
                               content=f'Synthetic {locale}', subject_key=subject).id for locale in ('en', 'zh-CN')]
        if legacy_conflict:
            db.add_all([UserSkillSelection(subject_key=subject, category='EXPORT_CONTEXT', locale=locale, skill_id=skill_id)
                        for locale, skill_id in zip(('en', 'zh-CN'), skills)])
        db.commit()
    barrier = Barrier(2)
    def choose(skill_id):
        with Session(engine) as db:
            # Both callers have already read the old settings. Keeping these
            # objects alive also catches writes based on a stale identity map.
            previous = db.query(UserSkillSelection).filter_by(subject_key=subject).all()
            barrier.wait(timeout=10)
            update_selection(db, category='EXPORT_CONTEXT', skill_id=skill_id, subject_key=subject)
            db.commit()
            assert len(previous) == (2 if legacy_conflict else 0)
    with ThreadPoolExecutor(max_workers=2) as workers:
        list(workers.map(choose, skills))
    with Session(engine) as db:
        rows = db.query(UserSkillSelection).filter_by(subject_key=subject).all()
        assert len(rows) == 2 and len({row.skill_id for row in rows}) == 1
        assert selected_id(db, 'EXPORT_CONTEXT', 'en', subject) == selected_id(db, 'EXPORT_CONTEXT', 'zh-CN', subject)
