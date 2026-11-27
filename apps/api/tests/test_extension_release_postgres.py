"""Grant publication and shared settings races on disposable PostgreSQL only."""
import os
import secrets
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from threading import Barrier, Event, local
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import sessionmaker

from app.core.config import get_settings
from app.models.auth import AuthPrincipal, AuthSession
from app.models.reader_extension import ExtensionDevice, ExtensionPairing
from app.models.user import User
from app.services import extension_access as access, extension_pairing as pairing
from app.services.auth import (
    authenticate_session, change_password, hash_password, issue_session, revoke_session,
)
from test_import_profile_postgres import isolated_schema  # noqa: F401

pytestmark = pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1",
                               reason="explicit disposable PostgreSQL required")
CLIENT = "a" * 32
PASSWORD = "synthetic previous password 2026"


@pytest.fixture
def grants(isolated_schema, monkeypatch):
    engine, migrate = isolated_schema
    migrate("head")
    monkeypatch.setenv("AUTH_ENABLED", "true")
    monkeypatch.setenv("AUTH_SESSION_SECRET", "synthetic-review-secret-not-production")
    monkeypatch.setenv("READER_EXTENSION_IDS", CLIENT)
    get_settings.cache_clear()
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    with factory() as db:
        user = User(normalized_email="extension-review@example.test")
        db.add(user)
        db.flush()
        principal = AuthPrincipal(id="synthetic-extension", user_id=user.id,
                                  credential_version=1, password_hash=hash_password(PASSWORD))
        db.add(principal)
        db.flush()
        token, _ = issue_session(db, principal, get_settings())
        context = authenticate_session(db, token, get_settings()).context
    yield factory, migrate, context, token
    get_settings.cache_clear()


def retained_retry(grants, monkeypatch, tmp_path, state):
    from app.models.background_job import BackgroundJob
    from app.services.adaptive_import.service import begin_session, add_session_source, queue_session_analysis
    from app.services.background_jobs import _sync_adaptive_import_record_after_job
    from test_reader_extension import package, ROWS
    factory, _, context, _ = grants
    monkeypatch.setenv("IMPORT_STORAGE_DIR", str(tmp_path / "retry"))
    monkeypatch.setenv("READER_EXTENSION_CAPTURE", "true")
    get_settings.cache_clear()
    with factory() as db:
        now = datetime.now(timezone.utc)
        grant = ExtensionDevice(user_id=context.user_id, client=CLIENT, credential_version=1,
                                created_at=now, access_until=now + timedelta(hours=1),
                                expires_at=now + timedelta(days=1))
        db.add(grant)
        db.flush()
        record = begin_session(db, 1, owner_user_id=context.user_id)
        add_session_source(db, record, "synthetic.zip", package(ROWS))
        record.analysis_summary = {**record.analysis_summary, "extension_device": str(grant.id)}
        job = queue_session_analysis(db, record)
        job.idempotency_key = "adaptive-upload:" + str(uuid.uuid4())
        job.status = "failed" if state == "FAILED" else "cancelled"
        job.completed_at = now
        if state == "PAUSED":
            job.payload = {**job.payload, "source_disposition": "retain"}
        _sync_adaptive_import_record_after_job(db, job, status=job.status, now=now)
        db.commit()
        assert db.get(BackgroundJob, job.id).status == job.status
        return factory, SimpleNamespace(user_id=context.user_id, session_id=grant.id), record.id, job.id


@pytest.mark.parametrize("state", ["FAILED", "PAUSED"])
def test_device_retry_two_confirmations_keep_one_receipt(grants, monkeypatch, tmp_path, state):
    from app.models.background_job import BackgroundJob
    from app.models.import_record import ImportRecord
    from app.services.extension_retry import retry
    factory, auth, iid, jid = retained_retry(grants, monkeypatch, tmp_path, state)
    barrier = Barrier(2)

    def attempt(_):
        with factory() as db:
            barrier.wait(timeout=10)
            try:
                return retry(db, auth, iid)
            except HTTPException as exc:
                return exc.status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(attempt, range(2)))
    assert sum(isinstance(value, dict) for value in results) == 1
    assert 409 in results
    with factory() as db:
        assert db.query(ImportRecord).count() == 1
        assert db.query(BackgroundJob).filter_by(status="queued").count() == 1
        assert db.query(BackgroundJob).filter(BackgroundJob.idempotency_key.is_not(None)).count() == 1
        assert db.get(ImportRecord, iid).status == "analyzing"
        assert len(db.get(ImportRecord, iid).artifacts) == 1


@pytest.mark.parametrize("revoke", ["device", "credentials"])
def test_device_retry_revalidates_authority_after_middleware(grants, monkeypatch, tmp_path, revoke):
    from app.models.background_job import BackgroundJob
    from app.models.import_record import ImportRecord
    from app.services.extension_retry import retry
    factory, auth, iid, jid = retained_retry(grants, monkeypatch, tmp_path, "FAILED")
    with factory() as db:
        if revoke == "device":
            db.delete(db.get(ExtensionDevice, auth.session_id))
        else:
            assert change_password(db, PASSWORD, "synthetic replacement password 2026",
                                   principal_id=grants[2].principal_id)
        db.commit()
    with factory() as db:
        with pytest.raises(HTTPException) as caught:
            retry(db, auth, iid)
        assert caught.value.status_code == 401
        db.rollback()
        assert db.get(ImportRecord, iid).status == "failed"
        assert db.get(BackgroundJob, jid).status == "failed"


@pytest.mark.parametrize("locked", ["job", "record"])
def test_device_retry_refuses_inflight_task_without_lock_timeout(grants, monkeypatch, tmp_path, locked):
    from app.models.background_job import BackgroundJob
    from app.models.import_record import ImportRecord
    from app.services.extension_retry import retry
    factory, auth, iid, jid = retained_retry(grants, monkeypatch, tmp_path, "FAILED")
    with factory() as running:
        running.get(BackgroundJob if locked == "job" else ImportRecord,
                    jid if locked == "job" else iid, with_for_update=True)
        with factory() as db:
            with pytest.raises(HTTPException) as caught:
                retry(db, auth, iid)
            assert caught.value.status_code == 409


@pytest.mark.parametrize("flow", ["pairing", "pkce"])
@pytest.mark.parametrize("revocation", ["password", "session", "expiry", "disabled"])
def test_inflight_grant_cannot_outlive_its_web_authority(grants, flow, revocation):
    factory, _, context, token = grants
    with factory() as db:
        ticket = pairing.start(db, CLIENT, "Chat Reader · Edge")
    # The handler has already received a genuine middleware AuthContext.
    # A second transaction invalidates it before the handler publishes a grant.
    with factory() as db:
        if revocation == "password":
            assert change_password(db, PASSWORD, "synthetic replacement password 2026",
                                   principal_id=context.principal_id)
        elif revocation == "session":
            revoke_session(db, token, get_settings())
        elif revocation == "expiry":
            db.get(AuthSession, context.session_id).last_activity_at = (
                datetime.now(timezone.utc) - timedelta(seconds=get_settings().auth_inactivity_timeout_seconds + 1))
            db.commit()
        else:
            db.get(User, context.user_id).status = "DISABLED"
            db.commit()
    with factory() as db:
        assert authenticate_session(db, token, get_settings()) is None
    with factory() as db:
        with pytest.raises(HTTPException) as caught:
            if flow == "pairing":
                pairing.approve(db, context, ticket["code"])
            else:
                access.issue_code(db, context, CLIENT, access.pkce(secrets.token_urlsafe(32)))
        assert caught.value.status_code == 401
        db.rollback()
        assert db.query(ExtensionDevice).count() == 0
        assert db.query(ExtensionPairing).one().device_id is None


def test_grant_authority_refreshes_preloaded_identity_map(grants):
    factory, _, context, token = grants
    with factory() as pending:
        cached = [pending.get(User, context.user_id), pending.get(AuthPrincipal, context.principal_id),
                  pending.get(AuthSession, context.session_id)]
        with factory() as concurrent:
            revoke_session(concurrent, token, get_settings())
        assert cached[-1].revoked_at is None
        with pytest.raises(HTTPException) as caught:
            access.issue_code(pending, context, CLIENT, access.pkce(secrets.token_urlsafe(32)))
        assert caught.value.status_code == 401


def test_pairing_is_single_use_and_migration_preserves_issued_grants(grants):
    factory, migrate, context, _ = grants
    with factory() as db:
        ticket = pairing.start(db, CLIENT, "Chat Reader · Edge")
    barrier = Barrier(2)

    def approve(_):
        with factory() as db:
            barrier.wait(timeout=10)
            try:
                pairing.approve(db, context, ticket["code"])
                return 204
            except HTTPException as exc:
                return exc.status_code
    with ThreadPoolExecutor(max_workers=2) as executor:
        assert sorted(executor.map(approve, range(2))) == [204, 404]
    with factory() as db:
        assert db.query(ExtensionDevice).count() == 1
        result = pairing.poll(db, CLIENT, ticket["device_code"])
        grant = db.get(ExtensionDevice, result["device_id"])
        before = (grant.id, grant.user_id, grant.access_hash, grant.refresh_hash, grant.credential_version)
        assert not db.query(ExtensionPairing).count()
    migrate("20261123_0064", "downgrade")
    migrate("head")
    with factory() as db:
        grant = db.get(ExtensionDevice, before[0])
        assert (grant.id, grant.user_id, grant.access_hash, grant.refresh_hash, grant.credential_version) == before
        assert grant.device_name is None


def test_pairing_and_pkce_share_the_serialized_device_quota(grants):
    factory, _, context, _ = grants
    now = datetime.now(timezone.utc)
    with factory() as db:
        db.add_all([ExtensionDevice(user_id=context.user_id, client=CLIENT, credential_version=1,
                    created_at=now, access_until=now + timedelta(minutes=10), expires_at=now + timedelta(days=1))
                    for _ in range(31)])
        db.commit()
        ticket = pairing.start(db, CLIENT, "Chat Reader · Chrome")
    barrier = Barrier(2)

    def reserve(flow):
        with factory() as db:
            barrier.wait(timeout=10)
            try:
                if flow == "pairing":
                    pairing.approve(db, context, ticket["code"])
                else:
                    access.issue_code(db, context, CLIENT, access.pkce(secrets.token_urlsafe(32)))
                return 204
            except HTTPException as exc:
                return exc.status_code
    with ThreadPoolExecutor(max_workers=2) as executor:
        assert sorted(executor.map(reserve, ["pairing", "pkce"])) == [204, 409]
    with factory() as db:
        assert db.query(ExtensionDevice).count() == 32


def test_context_update_and_web_preset_write_use_the_same_lock_order(grants, monkeypatch):
    from app.api.routes import reader_extension as route
    from app.services import user_feature_entries as features
    from app.services.preferences import get_or_create_preferences
    factory, _, context, _ = grants
    subject = str(context.user_id)
    request = SimpleNamespace(state=SimpleNamespace(auth=context))
    with factory() as db:
        get_or_create_preferences(db, subject)
        db.commit()
    first_locked, web_collection, extension_collection = Event(), Event(), Event()
    actor = local()
    real_preferences, real_collection = route.get_or_create_preferences, features.lock_feature_collection

    def observed_collection(db, subject, collection):
        real_collection(db, subject, collection)
        if actor.role == "extension":
            extension_collection.set()
            first_locked.set()
        else:
            web_collection.set()

    def observed_preferences(db, subject):
        result = real_preferences(db, subject)
        first_locked.set()
        # On the old preferences-first implementation, schedule the Web writer
        # after that first lock: the real PostgreSQL lock inversion then deadlocks.
        # On collection-first code, the Web writer waits safely until commit.
        if not extension_collection.is_set():
            assert web_collection.wait(10)
        return result
    monkeypatch.setattr(features, "lock_feature_collection", observed_collection)
    monkeypatch.setattr(route, "get_or_create_preferences", observed_preferences)

    def extension():
        actor.role = "extension"
        with factory() as db:
            return route.update_options(route.QuickOptions(preset_id=None, revision=0,
                include_attachments=True, include_continuation=True), request, db)

    def web():
        actor.role = "web"
        assert first_locked.wait(10)
        with factory() as db:
            result = features.write_entry(db, subject, "export-preset", uuid.uuid4(), 0,
                                          {"format": "context", "name": "Synthetic concurrent preset"})
            db.commit()
            return result
    with ThreadPoolExecutor(max_workers=2) as executor:
        first, second = executor.submit(extension), executor.submit(web)
        assert first.result(timeout=20)["attachments"] == "include"
        assert second.result(timeout=20).revision == 1
