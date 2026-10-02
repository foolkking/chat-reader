"""First-login project listing and first conversation creation can race."""
import os
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from sqlalchemy import event
from sqlalchemy.orm import Session

from app.models.background_job import BackgroundJob
from app.models.project import Project
from app.models.user import User
from app.services.ownership import OwnershipScope
from app.services.projects.project_service import ensure_default_project
from test_import_profile_postgres import isolated_schema  # noqa: F401

pytestmark = pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1", reason="requires disposable PostgreSQL")


def test_concurrent_first_default_project_keeps_both_callers_transactions(isolated_schema):
    engine, migrate = isolated_schema
    migrate("head")
    with Session(engine) as db:
        user = User(normalized_email="first-project@example.test")
        db.add(user); db.commit(); uid = user.id
    barrier = Barrier(2)

    def before_insert(connection, cursor, statement, parameters, context, many):
        if statement.startswith("INSERT INTO projects"):
            barrier.wait(timeout=10)

    event.listen(engine, "before_cursor_execute", before_insert)
    try:
        def create(index):
            with Session(engine) as db:
                # An outer write must survive a losing default-project insert.
                db.add(BackgroundJob(job_type="synthetic", owner_user_id=uid, status="queued", phase="queued", payload={"index": index}))
                project = ensure_default_project(db, OwnershipScope(uid))
                db.commit()
                return project.id
        with ThreadPoolExecutor(max_workers=2) as pool:
            identities = list(pool.map(create, (1, 2)))
    finally:
        event.remove(engine, "before_cursor_execute", before_insert)
    assert identities[0] == identities[1]
    with Session(engine) as db:
        assert db.query(Project).filter_by(owner_user_id=uid, is_default=True).count() == 1
        assert db.query(BackgroundJob).filter_by(owner_user_id=uid).count() == 2
