"""Durable browser download requests must reuse one real queued job."""
import os
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from sqlalchemy.orm import Session

from app.models.background_job import BackgroundJob
from app.models.conversation import Conversation
from app.models.user import User
from app.services.background_jobs import queue_offline_package
from app.services.offline_packages import OfflinePackageError
from app.services.ownership import OwnershipScope
from test_import_profile_postgres import isolated_schema  # noqa: F401

pytestmark = pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1", reason="requires disposable PostgreSQL")


def test_download_admission_serializes_replay_and_rejects_changed_request(isolated_schema):
    engine, migrate = isolated_schema
    migrate("head")
    with Session(engine) as db:
        user = User(normalized_email="offline-admission@example.test")
        db.add(user)
        db.flush()
        conversation = Conversation(owner_user_id=user.id, title="Synthetic", display_title="Synthetic", source_type="test", source_profile="test", parser_version="test")
        db.add(conversation)
        db.commit()
        user_id, conversation_id = user.id, conversation.id
    params = dict(scope="conversation", conversation_id=conversation_id, project_id=None, known_revisions={},
        idempotency_key="synthetic-browser-download", include_assets="all", subject_key=str(user_id), ownership_scope=OwnershipScope(user_id))
    barrier = Barrier(2)

    def admit(_):
        with Session(engine) as db:
            barrier.wait(timeout=10)
            job = queue_offline_package(db, **params)
            db.commit()
            return job.id

    with ThreadPoolExecutor(max_workers=2) as pool:
        jobs = list(pool.map(admit, range(2)))
    assert jobs[0] == jobs[1]
    with Session(engine) as db:
        assert db.query(BackgroundJob).count() == 1
        with pytest.raises(OfflinePackageError) as conflict:
            queue_offline_package(db, **{**params, "include_assets": "none"})
        assert conflict.value.status_code == 409
        db.rollback()
        db.get(BackgroundJob, jobs[0]).status = "cancelled"
        db.commit()
        assert queue_offline_package(db, **params).id == jobs[0]
        db.commit()
        assert db.query(BackgroundJob).count() == 1
