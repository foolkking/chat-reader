"""Real request/database/object-store draft behavior; no semantic success mocks."""
from contextlib import contextmanager
import uuid

import pytest
from sqlalchemy import inspect

from app.core.config import get_settings
from app.core.database import get_db
from app.main import app
from app.models.context_continuation import ContextMemberObject, ContinuationCandidate
from app.models.message_version import MessageVersion
from test_import_preview_api import client  # noqa: F401
from test_auth import auth_client  # noqa: F401
from test_admin_system import _normal_user_session
from test_message_editing_api import commit_edit_sample


@pytest.fixture(autouse=True)
def private_objects(tmp_path, monkeypatch):
    monkeypatch.setenv('ASSET_STORAGE_DIR', str(tmp_path / 'objects'))
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@contextmanager
def database():
    generator = app.dependency_overrides[get_db]()
    try:
        yield next(generator)
    finally:
        generator.close()


def root(client):
    return '/api/conversations/' + commit_edit_sample(client)['conversation_id'] + '/continuation'












def test_failed_member_storage_rolls_back_metadata_and_physical_files(client, monkeypatch):
    from app.services import continuation_candidates as service
    from app.services.ownership import LEGACY_OWNERSHIP_SCOPE
    from app.services.assets.asset_store import get_asset_store
    path = root(client)
    conversation_id = uuid.UUID(path.split('/')[3])
    store_member = service._store_member
    calls = 0

    def fail_second(db, data):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError('synthetic storage interruption')
        return store_member(db, data)

    monkeypatch.setattr(service, '_store_member', fail_second)
    with database() as db:
        with pytest.raises(RuntimeError, match='synthetic'):
            service.create_candidate(db, conversation_id, LEGACY_OWNERSHIP_SCOPE,
                                     members={'current': b'# first', 'index': b'{}'}, base_generation=0,
                                     base_revision_id=None, idempotency_key='rollback')
        db.rollback()
        assert db.query(ContextMemberObject).count() == 0
        assert db.query(ContinuationCandidate).count() == 0
        assert not [p for p in (get_asset_store().root / 'context').rglob('*') if p.is_file()]


def test_context_migration_roundtrip_matches_models():
    import importlib.util
    from pathlib import Path
    from sqlalchemy import create_engine
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from alembic.autogenerate import compare_metadata
    from app.core.database import Base

    modules = []
    for filename in ('20261002_0044_context_continuation.py', '20261002_0045_continuation_direct_files.py'):
        file = Path(__file__).resolve().parents[1] / 'alembic/versions' / filename
        spec = importlib.util.spec_from_file_location(file.stem, file)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        modules.append(module)
    names = {'context_member_objects', 'context_bindings', 'continuation_revisions', 'continuation_states',
             'continuation_candidates', 'continuation_validations', 'context_export_receipts'}
    with create_engine('sqlite://').begin() as connection:
        connection.exec_driver_sql('PRAGMA foreign_keys=ON')
        Base.metadata.create_all(connection, tables=[t for t in Base.metadata.sorted_tables if t.name not in names])
        context = MigrationContext.configure(connection)
        with Operations.context(context):
            for module in modules:
                module.upgrade()
            assert compare_metadata(context, Base.metadata) == []
            for module in reversed(modules):
                module.downgrade()
        assert names.isdisjoint(inspect(connection).get_table_names())






def seed_legacy_candidate(path, **files):
    """Seed old stored data for compatibility tests, never via a product API."""
    from app.services.continuation_candidates import create_candidate, candidate_read
    from app.services.ownership import LEGACY_OWNERSHIP_SCOPE
    with database() as db:
        item = create_candidate(db, uuid.UUID(path.split('/')[3]), LEGACY_OWNERSHIP_SCOPE,
            members=files, base_generation=0, base_revision_id=None, idempotency_key=str(uuid.uuid4()))
        db.commit()
        return candidate_read(item)


@pytest.mark.parametrize('method,suffix', [('post','/candidates'), ('get','/candidates'),
    ('put','/candidates/old/members'), ('get','/candidates/old/members/current'),
    ('post','/candidates/old/validate'), ('get','/candidates/old/validations'),
    ('post','/candidates/old/adopt'), ('get','/candidates/old/preview')])
def test_retired_candidate_routes_do_not_create_state(client, method, suffix):
    path = root(client)
    response = getattr(client, method)(path + suffix)
    assert response.status_code == 410
    assert response.json()['detail']['code'] == 'CONTEXT_CANDIDATE_FLOW_RETIRED'
    with database() as db:
        from app.models.context_continuation import ContinuationValidation, ContinuationRevision
        from app.models.background_job import BackgroundJob
        assert db.query(ContinuationCandidate).count() == 0
        assert db.query(ContinuationValidation).count() == 0
        assert db.query(ContinuationRevision).count() == 0
        assert db.query(ContextMemberObject).count() == 0
        assert db.query(BackgroundJob).filter_by(job_type='context_validation').count() == 0


def test_retired_routes_absent_from_published_openapi(client):
    assert not any('/continuation/candidates' in path for path in client.get('/openapi.json').json()['paths'])


def test_direct_member_safety_rejects_invalid_inputs_without_state(client):
    path = root(client)
    for content in (b'{"revision":1,"revision":2}', b'[]', b'\xff', b'{"x":NaN}'):
        response = client.put(path + '/files', data={'base_generation': 0}, files={'index': ('index.json', content)})
        assert response.status_code == 422
    with database() as db:
        assert db.query(ContextMemberObject).count() == 0
        assert db.query(ContinuationCandidate).count() == 0


def test_foreign_account_cannot_read_direct_or_retired_endpoints(auth_client, monkeypatch):
    monkeypatch.setenv('IMPORT_COMMIT_INLINE', 'true'); get_settings.cache_clear()
    _, token = _normal_user_session(auth_client)
    auth_client.cookies.set('chat_reader_session', token)
    auth_client.cookies.set('chat_reader_session_present', '1')
    path = root(auth_client)
    saved = auth_client.put(path + '/files', data={'base_generation': 0}, files={'current': ('current.md', b'# private')})
    assert saved.status_code == 200
    _, other = _normal_user_session(auth_client)
    auth_client.cookies.set('chat_reader_session', other)
    for suffix in ('', '/revisions', '/candidates', '/candidates/old/preview',
        '/revisions/' + saved.json()['revision_id'] + '/members/current'):
        assert auth_client.get(path + suffix).status_code == 404
    assert auth_client.post(path + '/candidates/old/adopt').status_code == 404
    assert auth_client.put(path + '/files', data={'base_generation': 1}, files={'current': ('current.md', b'# denied')}).status_code == 404
