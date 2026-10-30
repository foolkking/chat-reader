import os
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from sqlalchemy import event
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.access import EmailVerificationGrant, PasswordResetGrant
from app.models.auth import AuthSession
from app.models.user import User
from app.services.auth import authenticate_session, issue_session, register_user
from app.services.access import consume_password_reset, create_password_reset_grant
from app.services.email_change import confirm_email_change, request_email_change
from test_import_profile_postgres import isolated_schema  # noqa: F401

pytestmark = pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1", reason="requires disposable PostgreSQL")
PASSWORD = "synthetic postgres email passphrase"


def setup_account(engine, old, new):
    with Session(engine) as db:
        user, principal = register_user(db, old, PASSWORD)
        session_token, session = issue_session(db, principal, get_settings())
        email_token, grant = request_email_change(db, get_settings(), authenticate_session(db, session_token, get_settings(), touch=False), new, PASSWORD)
        _, other = issue_session(db, principal, get_settings())
        db.commit()
        return user.id, session.id, other.id, session_token, email_token, grant.id


def test_concurrent_email_confirmations_are_single_use(isolated_schema):
    engine, migrate = isolated_schema; migrate("head")
    uid, sid, other, cookie, token, grant_id = setup_account(engine, "old@example.test", "new@example.test")
    barrier = Barrier(2)
    def confirm(_):
        with Session(engine) as db:
            authentication = authenticate_session(db, cookie, get_settings(), touch=False)
            barrier.wait(timeout=10)
            try:
                confirm_email_change(db, get_settings(), authentication, token); db.commit(); return "confirmed"
            except ValueError:
                db.rollback(); return "rejected"
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(confirm, range(2))) == ["confirmed", "rejected"]
    with Session(engine) as db:
        assert db.get(User, uid).normalized_email == "new@example.test"
        assert db.get(AuthSession, sid).revoked_at is None
        assert db.get(AuthSession, other).revoked_at is not None
        assert db.get(EmailVerificationGrant, grant_id).used_at is not None


def test_two_accounts_cannot_confirm_the_same_address(isolated_schema):
    engine, migrate = isolated_schema; migrate("head")
    accounts = [setup_account(engine, f"old-{i}@example.test", "same@example.test") for i in range(2)]
    barrier = Barrier(2)
    def confirm(account):
        uid, _, _, cookie, token, _ = account
        with Session(engine) as db:
            authentication = authenticate_session(db, cookie, get_settings(), touch=False)
            barrier.wait(timeout=10)
            try:
                confirm_email_change(db, get_settings(), authentication, token); db.commit(); return uid
            except (FileExistsError, IntegrityError):
                db.rollback(); return None
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(confirm, accounts))
    assert sum(value is not None for value in results) == 1
    with Session(engine) as db:
        assert db.query(User).filter(User.normalized_email == "same@example.test").count() == 1
        for account, result in zip(accounts, results):
            uid, sid, other, _, _, grant_id = account
            assert db.get(AuthSession, sid).revoked_at is None
            assert (db.get(AuthSession, other).revoked_at is None) is (result is None)
            assert (db.get(EmailVerificationGrant, grant_id).used_at is None) is (result is None)
            if result is None: assert db.get(User, uid).normalized_email.startswith("old-")


def test_email_change_and_password_reset_serialize(isolated_schema):
    engine, migrate = isolated_schema; migrate("head")
    uid, _, _, cookie, token, grant_id = setup_account(engine, "reset-old@example.test", "reset-new@example.test")
    with Session(engine) as db:
        reset_token, grant = create_password_reset_grant(db, get_settings(), uid, actor_user_id=None)
        reset_id = grant.id; db.commit()
    barrier = Barrier(2)
    def apply(action):
        with Session(engine) as db:
            authentication = authenticate_session(db, cookie, get_settings(), touch=False)
            barrier.wait(timeout=10)
            try:
                if action == "email": confirm_email_change(db, get_settings(), authentication, token)
                else: consume_password_reset(db, get_settings(), reset_token, "new postgres password phrase")
                db.commit(); return action
            except (ValueError, PermissionError):
                db.rollback(); return None
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(apply, ["email", "password"]))
    assert sum(value is not None for value in results) == 1
    with Session(engine) as db:
        user = db.get(User, uid)
        assert user.credential_version == user.principal.credential_version == 2
        if results[0]: assert db.get(PasswordResetGrant, reset_id).revoked_at is not None
        else: assert db.get(EmailVerificationGrant, grant_id).used_at is None


@pytest.mark.parametrize("old_split_read", [1, 2])
def test_session_authentication_cannot_mix_email_change_versions(isolated_schema, old_split_read):
    """Commit between the old session/principal/user reads, without timing sleeps."""
    engine, migrate = isolated_schema
    migrate("head")
    uid, sid, other, cookie, token, _ = setup_account(
        engine, "snapshot-old@example.test", "snapshot-new@example.test",
    )
    reads = []
    committed = []
    with engine.connect() as connection:
        def commit_during_read(conn, cursor, statement, parameters, context, executemany):
            sql = statement.lstrip().lower()
            if not sql.startswith("select") or not any(
                table in sql for table in ("auth_sessions", "auth_principals", "users")
            ):
                return
            reads.append(sql)
            # The joined query already has a coherent result at this point.
            # Old code instead commits after its first/second separate SELECT.
            joined = "join auth_principals" in sql and "join users" in sql
            if committed or not (joined or len(reads) == old_split_read):
                return
            with Session(engine) as writer:
                authentication = authenticate_session(writer, cookie, get_settings(), touch=False)
                assert authentication is not None
                confirm_email_change(writer, get_settings(), authentication, token)
                writer.commit()
            committed.append(True)

        event.listen(connection, "after_cursor_execute", commit_during_read)
        try:
            with Session(bind=connection) as reader:
                authentication = authenticate_session(reader, cookie, get_settings(), touch=False)
                assert authentication is not None
                assert authentication.context.user_id == uid
                assert authentication.session.revoked_at is None
        finally:
            event.remove(connection, "after_cursor_execute", commit_during_read)
    assert committed == [True]
    assert len(reads) == 1, "Version checks must share one SQL statement snapshot"
    with Session(engine) as db:
        assert db.get(User, uid).normalized_email == "snapshot-new@example.test"
        assert db.get(AuthSession, sid).revoked_at is None
        assert db.get(AuthSession, other).revoked_at is not None
        assert authenticate_session(db, cookie, get_settings(), touch=False) is not None
