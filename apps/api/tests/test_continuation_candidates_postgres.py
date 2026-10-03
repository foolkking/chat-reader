"""Explicit disposable PostgreSQL concurrency and FK acceptance gate."""
import os
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.conversation import Conversation
from app.models.context_continuation import ContinuationCandidate, ContinuationRevision, ContextMemberObject
from app.models.user import User
from app.services.continuation_files import update_files
from app.services.ownership import OwnershipScope
from test_import_profile_postgres import isolated_schema  # noqa: F401

pytestmark = pytest.mark.skipif(os.environ.get('SETTINGS_POSTGRES_INTEGRATION') != '1', reason='requires disposable PostgreSQL')


def test_same_direct_update_concurrently_creates_one_snapshot(isolated_schema, tmp_path, monkeypatch):
    engine, migrate = isolated_schema
    migrate('head')
    monkeypatch.setenv('ASSET_STORAGE_DIR', str(tmp_path / 'assets'))
    get_settings.cache_clear()
    try:
        with Session(engine) as db:
            user = User(normalized_email='context-concurrency@example.test')
            db.add(user)
            db.flush()
            conversation = Conversation(owner_user_id=user.id, title='Synthetic', display_title='Synthetic',
                                        source_type='synthetic', source_profile='synthetic', parser_version='test')
            db.add(conversation)
            db.commit()
            owner_id, conversation_id = user.id, conversation.id
        barrier = Barrier(2)

        def submit(_):
            with Session(engine) as db:
                barrier.wait(timeout=10)
                revision, state = update_files(db, conversation_id, OwnershipScope(owner_id), members={'current': b'# synthetic'}, base_generation=0)
                db.commit()
                return revision.id

        with ThreadPoolExecutor(max_workers=2) as executor:
            ids = list(executor.map(submit, range(2)))
        assert ids[0] == ids[1]
        with Session(engine) as db:
            assert db.query(ContinuationCandidate).count() == 0
            assert db.query(ContinuationRevision).count() == 1
            assert db.query(ContextMemberObject).count() == 1
            db.delete(db.get(Conversation, conversation_id))
            db.commit()
            assert db.query(ContinuationCandidate).count() == 0
    finally:
        get_settings.cache_clear()


@pytest.mark.parametrize('operation', ['direct', 'return_upload', 'return_apply'])
def test_disabled_account_rejects_previously_authenticated_context_writes(isolated_schema, tmp_path, monkeypatch, operation):
    from io import BytesIO
    import zipfile
    from fastapi import HTTPException
    from app.models.background_job import BackgroundJob
    from app.models.export_artifact import ExportArtifact
    from app.services.context_return_jobs import receive_context_return, process_context_return

    engine, migrate = isolated_schema
    migrate('head')
    monkeypatch.setenv('AUTH_ENABLED', 'true')
    monkeypatch.setenv('ASSET_STORAGE_DIR', str(tmp_path / 'assets'))
    monkeypatch.setenv('EXPORT_STORAGE_DIR', str(tmp_path / 'exports'))
    get_settings.cache_clear()
    package = BytesIO()
    with zipfile.ZipFile(package, 'w') as archive:
        archive.writestr('manifest.json', '{}')
        archive.writestr('conversation.canjsonl', '{"record_type":"manifest","format":"chat-reader-canonical-jsonl","version":2}\n')
        archive.writestr('continuation/current.md', '# Pending synthetic file')
    try:
        with Session(engine) as db:
            user = User(normalized_email='context-revoked@example.test')
            db.add(user); db.flush()
            conversation = Conversation(owner_user_id=user.id, title='Synthetic disabled owner', display_title='Synthetic',
                                        source_type='synthetic', source_profile='synthetic', parser_version='test')
            db.add(conversation); db.commit()
            owner_id, conversation_id = user.id, conversation.id
            if operation == 'return_apply':
                job = receive_context_return(db, BytesIO(package.getvalue()), conversation_id, OwnershipScope(owner_id),
                    base_generation=0, idempotency_key='queued-before-disable')
                db.commit(); job_id = job.id

        with Session(engine) as stale:
            # Authentication ran earlier, retaining an ACTIVE ORM identity.
            cached_owner = stale.get(User, owner_id)
            assert cached_owner.can_login
            with Session(engine) as admin:
                admin.get(User, owner_id).status = 'DISABLED'
                admin.commit()
            assert cached_owner.can_login
            with pytest.raises(HTTPException) as rejected:
                if operation == 'direct':
                    update_files(stale, conversation_id, OwnershipScope(owner_id), members={'current': b'# Too late'}, base_generation=0)
                elif operation == 'return_upload':
                    receive_context_return(stale, BytesIO(package.getvalue()), conversation_id, OwnershipScope(owner_id),
                        base_generation=0, idempotency_key='too-late')
                else:
                    process_context_return(stale, stale.get(BackgroundJob, job_id), OwnershipScope(owner_id), lambda *args: None)
            assert rejected.value.status_code == 401
            stale.rollback()

        with Session(engine) as db:
            assert db.query(ContinuationRevision).count() == db.query(ContextMemberObject).count() == 0
            assert db.query(ExportArtifact).count() == (1 if operation == 'return_apply' else 0)
            assert db.query(BackgroundJob).filter_by(job_type='context_return').count() == (1 if operation == 'return_apply' else 0)
    finally:
        get_settings.cache_clear()
