"""Run only against an explicitly selected disposable PostgreSQL database."""
import os
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.access import EmailVerificationGrant
from app.models.user import User
from app.services.auth import register_user
from app.services.email_verification import confirm_registration_email, create_email_verification
from app.services.access import review_pending_user
from app.services.auth import ROOT_ADMIN_USER_ID


@pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1", reason="requires explicitly selected disposable PostgreSQL")
def test_concurrent_confirmation_consumes_once_under_real_row_locks():
    engine = create_engine(os.environ["DATABASE_URL"])
    assert engine.dialect.name == "postgresql"
    settings = get_settings()
    with Session(engine) as db:
        user, _ = register_user(db, f"verification-{uuid.uuid4()}@example.test", "synthetic postgres passphrase")
        user.email_verification_required = True
        user.status = "PENDING"
        user.approval_status = "APPROVED"
        db.flush()
        token = create_email_verification(db, settings, user)
        user_id = user.id
        db.commit()

    def confirm():
        with Session(engine) as db:
            try:
                confirm_registration_email(db, settings, token)
                db.commit()
                return "confirmed"
            except ValueError:
                db.rollback()
                return "rejected"

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda _: confirm(), range(2)))
        assert sorted(results) == ["confirmed", "rejected"]
        with Session(engine) as db:
            user = db.get(User, user_id)
            assert user.can_login
            assert user.email_verified_at is not None
            assert db.query(EmailVerificationGrant).filter_by(user_id=user_id).one().used_at is not None
    finally:
        # This test leaves only its synthetic user in the disposable database;
        # teardown of the dedicated test instance is owned by the test runner.
        engine.dispose()


@pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1", reason="requires explicitly selected disposable PostgreSQL")
def test_concurrent_approval_and_verification_do_not_lose_eligibility():
    engine = create_engine(os.environ["DATABASE_URL"])
    assert engine.dialect.name == "postgresql"
    settings = get_settings()
    with Session(engine) as db:
        user, _ = register_user(db, f"approval-{uuid.uuid4()}@example.test", "synthetic postgres passphrase")
        user.email_verification_required = True
        user.status = "PENDING"
        user.approval_status = "PENDING"
        db.flush()
        token = create_email_verification(db, settings, user)
        user_id = user.id
        db.commit()

    def apply(action):
        with Session(engine) as db:
            if action == "approve":
                review_pending_user(db, db.get(User, user_id), approved=True, actor_user_id=ROOT_ADMIN_USER_ID)
            else:
                confirm_registration_email(db, settings, token)
            db.commit()

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            list(executor.map(apply, ["approve", "verify"]))
        with Session(engine) as db:
            assert db.get(User, user_id).can_login
    finally:
        engine.dispose()
