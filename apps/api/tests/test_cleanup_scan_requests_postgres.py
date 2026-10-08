"""Global scan idempotency under actual PostgreSQL concurrent transactions."""
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from sqlalchemy.orm import Session
from app.models.background_job import BackgroundJob
from app.models.content_cleanup import ContentCleanupScan
from app.models.user import User
from app.services.cleanup_scan_requests import queue_global_scan
from app.services.content_cleanup import ensure_builtin_rules
from app.services.editing.message_edit_service import create_manual_conversation
from app.services.ownership import OwnershipScope
from test_import_profile_postgres import isolated_schema  # noqa: F401

pytestmark = pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1", reason="requires disposable PostgreSQL")


def test_concurrent_request_creates_one_job_and_snapshot(isolated_schema):
    engine, migrate = isolated_schema
    migrate("head")
    with Session(engine) as db:
        user = User(normalized_email="global-scan-postgres@example.test")
        db.add(user)
        db.flush()
        owner = user.id
        create_manual_conversation(db, title="Synthetic global scan", user_text="Synthetic question",
            assistant_text="Before cite turn12search4 after.", ownership_scope=OwnershipScope(owner))
        ensure_builtin_rules(db)
        db.commit()
    key, barrier = uuid.uuid4(), Barrier(2)
    def admit(_):
        with Session(engine) as db:
            barrier.wait(timeout=10)
            scan, job = queue_global_scan(db, OwnershipScope(owner), key)
            db.commit()
            return scan.id, job.id
    with ThreadPoolExecutor(max_workers=2) as pool:
        result = list(pool.map(admit, range(2)))
    assert result[0] == result[1]
    with Session(engine) as db:
        assert db.query(ContentCleanupScan).filter_by(owner_user_id=owner).count() == 1
        assert db.query(BackgroundJob).filter_by(owner_user_id=owner, idempotency_key=str(key)).count() == 1
