import io
import zipfile

import pytest

from test_import_preview_api import client  # noqa: F401
from test_auth import auth_client, owner_login  # noqa: F401
from test_admin_system import _normal_user_session


@pytest.fixture(autouse=True)
def private_objects(tmp_path, monkeypatch):
    from app.core.config import get_settings
    monkeypatch.setenv('ASSET_STORAGE_DIR', str(tmp_path / 'objects'))
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def bundle(script=b'print("never executed")', extra=None):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w') as archive:
        archive.writestr('demo/SKILL.md', '---\nname: demo\ndescription: Example instructions.\n---\nRead references/help.md')
        archive.writestr('demo/references/help.md', 'Synthetic reference')
        archive.writestr('demo/scripts/action.py', script)
        if extra: archive.writestr(extra, 'bad')
    return output.getvalue()


def upload(client, data):
    return client.post('/api/skills', data={'category': 'EXPORT_CONTEXT', 'locale': 'en', 'name': 'Demo'},
                       files={'file': ('demo.zip', data, 'application/zip')})


def test_bundle_replacement_keeps_old_bytes_and_selection(client):
    created = upload(client, bundle())
    assert created.status_code == 201, created.text
    skill = created.json()
    assert skill['bundle_revision'] == 1
    selected = client.put('/api/skills/selections', json={'category': 'EXPORT_CONTEXT', 'locale': 'en', 'skill_id': skill['id']})
    assert selected.status_code == 204
    old = client.get(skill['bundle_url'])
    assert old.status_code == 200
    with zipfile.ZipFile(io.BytesIO(old.content)) as z:
        assert z.read('demo/scripts/action.py') == b'print("never executed")'
    replaced = client.post(f"/api/skills/{skill['id']}/revisions", data={'base_revision': 1},
                           files={'file': ('demo.zip', bundle(b'# second'), 'application/zip')})
    assert replaced.status_code == 200, replaced.text
    assert replaced.json()['bundle_revision'] == 2
    assert replaced.json()['is_selected']
    assert client.get(skill['bundle_url']).content == old.content
    resolved = client.get('/api/skills/resolve?category=EXPORT_CONTEXT&locale=en').json()
    assert resolved['bundle_url'] == replaced.json()['bundle_url']
    with zipfile.ZipFile(io.BytesIO(client.get(resolved['bundle_url']).content)) as z:
        assert z.read('demo/scripts/action.py') == b'# second'
    assert len(client.get(f"/api/skills/{skill['id']}/revisions").json()) == 2
    members = client.get(f"/api/skills/{skill['id']}/revisions/2/members").json()
    assert {m['path'] for m in members} == {'SKILL.md', 'scripts/action.py', 'references/help.md'}


def test_same_instruction_different_script_is_not_duplicate(client):
    assert upload(client, bundle(b'# one')).status_code == 201
    assert upload(client, bundle(b'# two')).status_code == 201
    assert upload(client, bundle(b'# one')).status_code == 409


def test_stale_replacement_preserves_current_and_retry_is_idempotent(client):
    skill = upload(client, bundle()).json()
    url = f"/api/skills/{skill['id']}/revisions"
    def replace(base, body):
        return client.post(url, data={'base_revision': base}, files={'file': ('demo.zip', bundle(body), 'application/zip')})
    assert replace(1, b'# new').status_code == 200
    assert replace(1, b'# new').json()['bundle_revision'] == 2
    assert replace(1, b'# different').status_code == 409
    assert len(client.get(url).json()) == 2


@pytest.mark.parametrize('path', ['demo/../escape', 'demo/SKILL.MD', 'demo/con', 'second/file.md', 'demo/references'])
def test_unsafe_and_ambiguous_bundles_leave_no_skill(client, path):
    response = upload(client, bundle(extra=path))
    assert response.status_code == 422, response.text
    assert all(row['source'] != 'USER' for row in client.get('/api/skills').json())


def test_ambiguous_unicode_replacement_preserves_saved_bundle(client):
    item = upload(client, bundle()).json()
    original = client.get(item['bundle_url']).content
    malformed = io.BytesIO(bundle())
    with zipfile.ZipFile(malformed, 'a') as archive:
        archive.writestr('demo/references/caf\u00e9.md', b'first')
        archive.writestr('demo/references/cafe\u0301.md', b'second')
    response = client.post(f"/api/skills/{item['id']}/revisions", data={'base_revision': 1},
                          files={'file': ('demo.zip', malformed.getvalue(), 'application/zip')})
    assert response.status_code == 422
    assert len(client.get(f"/api/skills/{item['id']}/revisions").json()) == 1
    assert client.get(item['bundle_url']).content == original


def test_legacy_markdown_is_preserved_in_installable_bundle(client):
    original = '# original\nUser instructions, unchanged.'
    # Seed a pre-migration record to exercise compatibility wrapping on read.
    from app.core.database import get_db
    from app.main import app
    from app.services.skills import create_skill
    from app.services.ownership import LEGACY_SUBJECT_KEY
    session = app.dependency_overrides[get_db]()
    db = next(session)
    try:
        item = create_skill(db, category='EXPORT_CONTEXT', locale='en', name='Legacy',
                            content=original, subject_key=LEGACY_SUBJECT_KEY)
        db.commit()
        item_id = str(item.id)
    finally:
        session.close()
    row = next(row for row in client.get('/api/skills').json() if row['id'] == item_id)
    assert client.get(row['content_url']).text == original
    with zipfile.ZipFile(io.BytesIO(client.get(row['bundle_url']).content)) as z:
        assert z.read('personal-skill/references/legacy-instructions.md').decode() == original
        assert z.read('personal-skill/SKILL.md').startswith(b'---\nname:')


def test_private_bundle_cannot_be_read_or_replaced_by_another_user(auth_client):
    _, first_token = _normal_user_session(auth_client)
    auth_client.cookies.set('chat_reader_session', first_token)
    auth_client.cookies.set('chat_reader_session_present', '1')
    response = upload(auth_client, bundle())
    assert response.status_code == 201, response.text
    row = response.json()
    _, other_token = _normal_user_session(auth_client)
    auth_client.cookies.set('chat_reader_session', other_token)
    for path in (row['bundle_url'], f"/api/skills/{row['id']}/revisions",
                 f"/api/skills/{row['id']}/revisions/1/members",
                 f"/api/skills/{row['id']}/revisions/1/member?path=SKILL.md"):
        assert auth_client.get(path).status_code == 404
    assert auth_client.post(f"/api/skills/{row['id']}/revisions", data={'base_revision': 1},
                           files={'file': ('demo.zip', bundle(b'# changed'), 'application/zip')}).status_code == 404


def test_system_bundle_replacement_is_audited_and_history_is_not_public(auth_client):
    assert owner_login(auth_client).status_code == 200
    created = auth_client.post('/api/admin/system-skills/bundle',
        data={'category': 'EXPORT_CONTEXT', 'locale': 'en', 'name': 'System example', 'default_enabled': 'true'},
        files={'file': ('demo.zip', bundle(), 'application/zip')})
    assert created.status_code == 201, created.text
    row = created.json()
    old_url = row['bundle_url']
    assert auth_client.get(old_url).status_code == 200
    replacement = auth_client.post(f"/api/admin/system-skills/{row['id']}/revisions", data={'base_revision': 1},
                                  files={'file': ('demo.zip', bundle(b'# new'), 'application/zip')})
    assert replacement.status_code == 200, replacement.text
    assert auth_client.get(old_url).status_code == 404
    assert auth_client.get(f"/api/admin/system-skills/{row['id']}/revisions/1/bundle").status_code == 200
    members = auth_client.get(f"/api/admin/system-skills/{row['id']}/revisions/1/members")
    assert members.status_code == 200
    assert any(member['path'] == 'scripts/action.py' for member in members.json())
    original_script = auth_client.get(f"/api/admin/system-skills/{row['id']}/revisions/1/member?path=scripts/action.py")
    assert original_script.content == b'print("never executed")'
    resolved = auth_client.get('/api/skills/resolve?category=EXPORT_CONTEXT&locale=en').json()
    assert resolved['bundle_url'] == replacement.json()['bundle_url']
    _, token = _normal_user_session(auth_client)
    auth_client.cookies.set('chat_reader_session', token)
    auth_client.cookies.set('chat_reader_session_present', '1')
    assert auth_client.get(f"/api/admin/system-skills/{row['id']}/revisions").status_code == 404
    assert auth_client.get(f"/api/admin/system-skills/{row['id']}/revisions/1/member?path=SKILL.md").status_code == 404
    assert auth_client.post(f"/api/admin/system-skills/{row['id']}/revisions", data={'base_revision': 2},
                           files={'file': ('demo.zip', bundle(), 'application/zip')}).status_code == 404


def test_failed_transaction_removes_new_files_but_preserves_shared_objects(client):
    from app.main import app
    from app.core.database import get_db
    from app.models.skill_bundle import SkillFileObject
    from app.services.skill_bundles import parse_bundle, save_revision
    from app.services.skills import create_skill
    from app.services.assets.asset_store import get_asset_store
    assert upload(client, bundle()).status_code == 201
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        prior = {obj.storage_key for obj in db.query(SkillFileObject).all()}
        b = parse_bundle(bundle(b'# rollback-only'), 'demo.zip')
        item = create_skill(db, category='EXPORT_CONTEXT', locale='en', name='Rollback', content=b.content,
                            bundle_digest=b.digest)
        save_revision(db, item, b, base_revision=0, preserve_baseline=False)
        new_keys = {obj.storage_key for obj in db.query(SkillFileObject).all()} - prior
        assert new_keys
        db.rollback()
        store = get_asset_store()
        assert all(store.resolve_key(key).is_file() for key in prior)
        assert all(not store.resolve_key(key, must_exist=False).exists() for key in new_keys)
        assert {obj.storage_key for obj in db.query(SkillFileObject).all()} == prior
    finally:
        generator.close()


def test_builtin_maintenance_bundle_and_personal_preference(client):
    from pathlib import Path
    from app.services.skill_bundles import parse_bundle
    response = client.get('/api/skills/resolve?category=CONTEXT_MAINTENANCE&locale=en')
    assert response.status_code == 200
    resolved = response.json()
    public = Path(__file__).resolve().parents[2] / 'web/public'
    for category in ('CONTEXT_MAINTENANCE', 'EXPORT_CONTEXT'):
        info = client.get(f'/api/skills/resolve?category={category}&locale=en').json()
        path = public / info['bundle_url'].lstrip('/')
        parsed = parse_bundle(path.read_bytes(), path.name)
        assert 'scripts/validate_continuation.py' in parsed.members
        assert parsed.members['SKILL.md'] == (public / info['content_url'].lstrip('/')).read_bytes()
    own = client.post('/api/skills', data={'category': 'CONTEXT_MAINTENANCE', 'locale': 'en', 'name': 'Personal maintenance'},
                      files={'file': ('demo.zip', bundle(), 'application/zip')})
    assert own.status_code == 201, own.text
    assert client.put('/api/skills/selections', json={'category': 'CONTEXT_MAINTENANCE', 'locale': 'en', 'skill_id': own.json()['id']}).status_code == 204
    assert client.get('/api/skills/resolve?category=CONTEXT_MAINTENANCE&locale=en').json()['bundle_url'] == own.json()['bundle_url']
    assert resolved['bundle_url'].endswith('/context-continuation-maintainer.zip')


def test_system_fallback_list_matches_resolver_and_stale_text_edit_is_refused(auth_client):
    assert owner_login(auth_client).status_code == 200
    created = auth_client.post('/api/admin/system-skills/bundle',
        data={'category': 'EXPORT_CONTEXT', 'locale': 'en', 'name': 'Temporary default', 'default_enabled': 'true'},
        files={'file': ('demo.zip', bundle(), 'application/zip')})
    assert created.status_code == 201
    row = created.json()
    stale = auth_client.patch(f"/api/admin/system-skills/{row['id']}", json={'content': '# stale edit'})
    assert stale.status_code == 422
    assert auth_client.get(row['bundle_url']).status_code == 200
    assert auth_client.patch(f"/api/admin/system-skills/{row['id']}", json={'status': 'DISABLED'}).status_code == 200
    selected = [item for item in auth_client.get('/api/skills?category=EXPORT_CONTEXT&locale=en').json() if item['is_selected']]
    resolved = auth_client.get('/api/skills/resolve?category=EXPORT_CONTEXT&locale=en').json()
    assert len(selected) == 1
    assert selected[0]['id'] == resolved['id']
    assert selected[0]['bundle_url'] == resolved['bundle_url']


def test_cannot_delete_last_active_system_skill(auth_client):
    assert owner_login(auth_client).status_code == 200
    created = auth_client.post('/api/admin/system-skills/bundle',
        data={'category': 'EXPORT_CONTEXT', 'locale': 'en', 'name': 'Only active', 'default_enabled': 'true'},
        files={'file': ('demo.zip', bundle(), 'application/zip')})
    assert created.status_code == 201
    own = created.json()
    rows = auth_client.get('/api/admin/system-skills').json()
    for row in rows:
        if row['category'] == 'EXPORT_CONTEXT' and row['id'] != own['id']:
            assert auth_client.patch(f"/api/admin/system-skills/{row['id']}", json={'status': 'DISABLED'}).status_code == 200
    assert auth_client.delete(f"/api/admin/system-skills/{own['id']}").status_code == 409
    resolved = auth_client.get('/api/skills/resolve?category=EXPORT_CONTEXT&locale=en').json()
    assert resolved['bundle_url'] == own['bundle_url']
    assert auth_client.get(own['bundle_url']).status_code == 200


def test_personal_preference_survives_legacy_unavailable_system_default(client):
    from app.main import app
    from app.core.database import get_db
    from app.models.administration import SystemSkill
    created = upload(client, bundle())
    assert created.status_code == 201
    row = created.json()
    assert client.put('/api/skills/selections', json={
        'category': 'EXPORT_CONTEXT', 'locale': 'en', 'skill_id': row['id'],
    }).status_code == 204
    # Reproduce a database created by the old unrestricted disable endpoint.
    client.get('/api/skills?category=EXPORT_CONTEXT&locale=en')
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        db.query(SystemSkill).filter_by(category='EXPORT_CONTEXT', locale='en').update({'status': 'DISABLED'})
        db.commit()
    finally:
        generator.close()
    resolved = client.get('/api/skills/resolve?category=EXPORT_CONTEXT&locale=en')
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()['bundle_url'] == row['bundle_url']


def test_deleted_bundle_queues_private_cleanup_without_exposing_storage_keys(auth_client):
    from app.main import app
    from app.core.database import get_db
    from app.models.background_job import BackgroundJob
    _, token = _normal_user_session(auth_client)
    auth_client.cookies.set('chat_reader_session', token)
    auth_client.cookies.set('chat_reader_session_present', '1')
    created = upload(auth_client, bundle()).json()
    assert auth_client.delete(f"/api/skills/{created['id']}").status_code == 204
    assert auth_client.get(created['bundle_url']).status_code == 404
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        job = db.query(BackgroundJob).filter_by(job_type='skill_object_cleanup').one()
        job_id, keys = job.id, job.payload['keys']
    finally:
        generator.close()
    task = auth_client.get(f'/api/tasks/{job_id}')
    assert task.status_code == 200
    assert 'keys' not in task.json()
    assert all(key not in task.text for key in keys)
    _, other_token = _normal_user_session(auth_client)
    auth_client.cookies.set('chat_reader_session', other_token)
    assert auth_client.get(f'/api/tasks/{job_id}').status_code == 404
    assert auth_client.post(f'/api/tasks/{job_id}/retry').status_code == 404


def test_rename_keeps_bundle_revision_and_returns_persisted_name(client):
    created = upload(client, bundle()).json()
    before = client.get(created['bundle_url']).content
    changed = client.patch(f"/api/skills/{created['id']}", json={'name': 'Renamed synthetic Skill'})
    assert changed.status_code == 200, changed.text
    assert changed.json()['name'] == 'Renamed synthetic Skill'
    assert changed.json()['bundle_revision'] == created['bundle_revision']
    assert client.get(f"/api/skills/{created['id']}").json()['name'] == 'Renamed synthetic Skill'
    assert client.get(created['bundle_url']).content == before
