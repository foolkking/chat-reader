"""Real PostgreSQL locks, migrations, rollback and foreign-key deletion."""
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from sqlalchemy import inspect, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.support_request import SupportMessage, SupportRequest, UserLimitOverride
from app.models.user import User
from app.schemas.support_request import RequestCreate, RequestDecision
from app.services.auth import ROOT_ADMIN_USER_ID
from app.services.feature_policies import get_feature_policy
from app.services import support_requests as service
from test_import_profile_postgres import isolated_schema  # noqa: F401
from test_system_archive_integrity import archive_db  # noqa: F401
from test_support_archives import (
    test_personal_history_is_scoped_recoverable_and_never_reapproves as personal_roundtrip,
    test_system_support_roundtrip_remaps_accounts_and_bounds_grants as system_roundtrip,
)

pytestmark = pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1", reason="requires disposable PostgreSQL")


def test_concurrent_create_and_approval_are_one_atomic_change(isolated_schema, monkeypatch):
    engine, migrate = isolated_schema
    migrate("head")
    monkeypatch.setenv("AUTH_ENABLED", "true")
    get_settings.cache_clear()
    with Session(engine) as db:
        account = User(normalized_email="support-lock@example.test")
        db.add(account); db.flush()
        owner = account.id
        get_feature_policy(db).maximum_import_size_mb = 1
        db.commit()
    payload = RequestCreate(kind="LIMIT", title="Synthetic", body="Increase synthetic import limit", limits={"import_size_mb": 2})
    barrier = Barrier(2)
    def create(_):
        with Session(engine) as db:
            actor = db.get(User, owner)
            barrier.wait(timeout=10)
            row = service.create_request(db, actor, payload, "same-key")
            db.commit()
            return row.id
    with ThreadPoolExecutor(max_workers=2) as pool:
        ids = list(pool.map(create, range(2)))
    assert ids[0] == ids[1]
    barrier = Barrier(2)
    def approve(index):
        with Session(engine) as db:
            actor = db.get(User, ROOT_ADMIN_USER_ID)
            # Keep a stale identity-map entry through the lock acquisition.
            previous = db.get(SupportRequest, ids[0])
            barrier.wait(timeout=10)
            try:
                row = service.decide_request(db, actor, ids[0], RequestDecision(base_revision=1, action="APPROVE",
                    body="Synthetic approval", limits={"import_size_mb": 2}), f"window-{index}", admin=True)
                db.commit()
                assert previous.id == row.id
                return "approved"
            except service.SupportError as exc:
                db.rollback()
                return exc.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(approve, range(2)))
    assert sorted(results) == ["REQUEST_CHANGED", "approved"]
    with Session(engine) as db:
        assert db.query(SupportRequest).count() == 1 and db.query(SupportMessage).count() == 2
        assert db.get(UserLimitOverride, owner).revision == 1
        db.delete(db.get(User, owner)); db.commit()
        assert db.query(SupportMessage).count() == db.query(UserLimitOverride).count() == db.query(SupportRequest).count() == 0
    migrate("20261003_0046", operation="downgrade")
    assert "support_requests" not in inspect(engine).get_table_names()
    migrate("head")
    assert "support_requests" in inspect(engine).get_table_names()


def test_personal_history_postgres(isolated_schema, tmp_path, monkeypatch):
    engine, migrate = isolated_schema
    migrate("head")
    for key, folder in (("ASSET_STORAGE_DIR", "objects"), ("EXPORT_STORAGE_DIR", "exports")):
        monkeypatch.setenv(key, str(tmp_path / folder))
    get_settings.cache_clear()
    with Session(engine) as db:
        personal_roundtrip(db)


def test_system_history_postgres(archive_db, isolated_schema, tmp_path, monkeypatch):
    engine, migrate = isolated_schema
    migrate("head")
    with Session(engine) as target:
        system_roundtrip(archive_db, target, tmp_path, monkeypatch)
