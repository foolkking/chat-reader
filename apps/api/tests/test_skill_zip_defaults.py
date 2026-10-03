from pathlib import Path
import zipfile
import io
from test_import_preview_api import client  # noqa: F401
from test_auth import auth_client  # noqa: F401
from test_system_archive_integrity import archive_db, seed_archive_source  # noqa: F401


def test_only_three_zip_defaults_and_personal_replacement(client):
    rows = client.get('/api/skills').json()
    assert {row['bundle_url'] for row in rows} == {
        '/skills/context-acquisition.zip', '/skills/context-continuation-maintainer.zip',
        '/skills/chat-transcript-normalizer-skill.zip'}
    payload = {'category': 'CONVERSATION_RESCUE', 'locale': 'en', 'name': 'My normalizer'}
    assert client.post('/api/skills', data=payload, files={'file': ('old.txt', b'# old', 'text/plain')}).status_code == 422
    path = Path(__file__).resolve().parents[3] / 'tools/context-skills/default-bundles/chat-transcript-normalizer-skill.zip'
    created = client.post('/api/skills', data=payload, files={'file': (path.name, path.read_bytes(), 'application/zip')})
    assert created.status_code == 201, created.text
    item = created.json()
    assert client.put('/api/skills/selections', json={**{k: payload[k] for k in ('category', 'locale')}, 'skill_id': item['id']}).status_code == 204
    assert client.post(f"/api/skills/{item['id']}/revisions", data={'base_revision': 1}, files={'file': ('old.txt', b'# old', 'text/plain')}).status_code == 422
    result = client.get('/api/skills/resolve?category=CONVERSATION_RESCUE&locale=en').json()
    assert result['id'] == item['id']
    with zipfile.ZipFile(io.BytesIO(client.get(result['bundle_url']).content)) as downloaded, zipfile.ZipFile(path) as supplied:
        assert downloaded.namelist() == sorted(supplied.namelist()) or set(downloaded.namelist()) == set(supplied.namelist())
        assert all(downloaded.read(name) == supplied.read(name) for name in supplied.namelist())


def test_default_migration_preserves_personal_selection(archive_db):
    import importlib.util
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from app.services.skills import create_skill, update_selection, resolve_skill
    from app.services.system_skills import ensure_bundled_system_skills, create_system_skill
    from app.models.administration import SystemSkill
    db = archive_db
    users, _, _, _ = seed_archive_source(db)
    rows = ensure_bundled_system_skills(db)
    rows[0].content = 'old override'
    import hashlib
    rows[0].content_digest = hashlib.sha256(b'old override').hexdigest()
    rows[0].byte_size = len(b'old override')
    custom = create_system_skill(db, actor_user_id=users[1].id, category='EXPORT_CONTEXT', locale='en', name='Old default', content='old system default', default_enabled=True)
    personal = create_skill(db, category='EXPORT_CONTEXT', locale='en', name='Keep personal', content='existing personal', subject_key=str(users[0].id))
    update_selection(db, category='EXPORT_CONTEXT', locale='en', skill_id=personal.id, subject_key=str(users[0].id))
    db.commit()
    path = Path(__file__).resolve().parents[1] / 'alembic/versions/20261003_0046_default_skill_zips.py'
    spec = importlib.util.spec_from_file_location('zip_defaults', path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    with Operations.context(MigrationContext.configure(db.connection())):
        module.upgrade()
    db.commit(); db.expire_all()
    assert not db.get(SystemSkill, custom.id).default_enabled
    assert all(row.content is None and row.default_enabled for row in db.query(SystemSkill).filter_by(source_kind='BUNDLED'))
    assert resolve_skill(db, category='EXPORT_CONTEXT', locale='en', subject_key=str(users[0].id))['id'] == str(personal.id)


def test_markdown_upload_and_replacement_preserve_name_content_and_zip(client):
    from urllib.parse import unquote
    body = {'category': 'EXPORT_CONTEXT', 'locale': 'en', 'name': 'My original skill'}
    original = b'# Personal rules\nDo not rewrite this content.\n'
    response = client.post('/api/skills', data=body, files={'file': ('My original skill.md', original, 'text/markdown')})
    assert response.status_code == 201, response.text
    row = response.json()
    assert row['name'] == body['name']
    assert client.get(row['content_url']).content == original
    downloaded = client.get(row['bundle_url'])
    assert "filename*=UTF-8''My original skill.zip" in unquote(downloaded.headers['content-disposition'])
    with zipfile.ZipFile(io.BytesIO(downloaded.content)) as archive:
        assert archive.read('personal-skill/references/legacy-instructions.md') == original
        assert 'personal-skill/SKILL.md' in archive.namelist()
    changed = client.post(f"/api/skills/{row['id']}/revisions", data={'base_revision': row['bundle_revision']},
                          files={'file': ('different-upload-name.md', b'# Replacement', 'text/markdown')})
    assert changed.status_code == 200, changed.text
    assert changed.json()['name'] == body['name']
    assert client.get(row['content_url']).content == b'# Replacement'
    assert client.get(row['bundle_url']).content == downloaded.content


def test_system_markdown_replacement_preserves_default_name(auth_client):
    from test_auth import owner_login
    assert owner_login(auth_client).status_code == 200
    row = auth_client.get('/api/admin/system-skills').json()[0]
    changed = auth_client.post(f"/api/admin/system-skills/{row['id']}/revisions",
        data={'base_revision': row['bundle_revision']}, files={'file': ('custom.md', b'# System replacement', 'text/markdown')})
    assert changed.status_code == 200, changed.text
    assert changed.json()['name'] == row['name']
    downloaded = auth_client.get(changed.json()['bundle_url'])
    assert downloaded.status_code == 200
    with zipfile.ZipFile(io.BytesIO(downloaded.content)) as archive:
        assert archive.read('personal-skill/references/legacy-instructions.md') == b'# System replacement'
