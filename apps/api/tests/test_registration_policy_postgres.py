"""Real PostgreSQL policy races, fresh ORM reads and first-write defaults."""
import os
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import pytest
from sqlalchemy.orm import Session
from app.core.config import get_settings
from app.models.access import InstanceAccessSetting
from app.models.user import User
from app.services.access import RegistrationPolicyConflict, access_settings, registration_policy_revision, set_access_settings
from test_import_profile_postgres import isolated_schema  # noqa: F401

pytestmark = pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1", reason="requires explicitly selected disposable PostgreSQL")


@pytest.mark.parametrize("checked", [True, False])
def test_cached_concurrent_registration_edits_are_checked_after_lock(isolated_schema, checked):
    engine, migrate = isolated_schema; migrate("head")
    with Session(engine) as db:
        actor = User(normalized_email="policy-race@example.test"); db.add(actor); db.flush(); actor_id = actor.id
        set_access_settings(db, actor_user_id=actor_id, mode="OPEN", require_admin_approval=False, password_reset_enabled=True)
        base = registration_policy_revision(access_settings(db, get_settings())); db.commit()
    barrier = Barrier(2)
    patches = [{"require_admin_approval": True}, {"password_reset_enabled": False}]

    def edit(index):
        with Session(engine) as db:
            cached = db.get(InstanceAccessSetting, 1)
            assert cached.require_admin_approval is False and cached.password_reset_enabled is True
            barrier.wait(timeout=10)
            try:
                row, changes = set_access_settings(db, actor_user_id=actor_id, base_revision=base if checked else None, **patches[index])
                result = ("saved", index, changes); db.commit(); return result
            except RegistrationPolicyConflict:
                db.rollback(); return ("conflict", index, None)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(edit, range(2)))
    assert sorted(result[0] for result in results) == (["conflict", "saved"] if checked else ["saved", "saved"])
    with Session(engine) as db:
        row = db.get(InstanceAccessSetting, 1)
        assert row.registration_mode == "OPEN"
        for state, index, changes in results:
            key, value = next(iter(patches[index].items()))
            assert (getattr(row, key) == value) is (state == "saved")
            if state == "saved": assert changes == patches[index]


def test_initial_flag_only_writers_preserve_deployment_registration_mode(isolated_schema, monkeypatch):
    monkeypatch.setenv("AUTH_REGISTRATION_MODE", "INVITE_ONLY"); get_settings.cache_clear()
    engine, migrate = isolated_schema; migrate("head")
    with Session(engine) as db:
        actor = User(normalized_email="initial-policy@example.test"); db.add(actor); db.flush(); actor_id = actor.id
        db.query(InstanceAccessSetting).delete(); db.commit()
        assert access_settings(db, get_settings())["registration_mode"] == "INVITE_ONLY"
    barrier = Barrier(2)
    def create(index):
        with Session(engine) as db:
            assert db.get(InstanceAccessSetting, 1) is None
            barrier.wait(timeout=10)
            set_access_settings(db, actor_user_id=actor_id, **({"require_admin_approval": True} if index == 0 else {"password_reset_enabled": False}))
            db.commit()
    try:
        with ThreadPoolExecutor(max_workers=2) as pool: list(pool.map(create, range(2)))
        with Session(engine) as db:
            row = db.query(InstanceAccessSetting).one()
            assert row.require_admin_approval is True and row.password_reset_enabled is False
            assert row.registration_mode == "INVITE_ONLY"
    finally: get_settings.cache_clear()
