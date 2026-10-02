import os
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.access import AccountInvitation
from app.models.user import User
from app.services.access import create_invitation, consume_invitation, invitation_for_token
from app.services.auth import ROOT_ADMIN_USER_ID
from test_import_profile_postgres import isolated_schema  # noqa: F401

pytestmark = pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1", reason="requires disposable PostgreSQL")


def test_one_invitation_can_only_create_one_account_concurrently(isolated_schema):
    engine, migrate = isolated_schema
    migrate("head")
    settings = get_settings()
    with Session(engine) as db:
        token, invitation = create_invitation(db, settings, ROOT_ADMIN_USER_ID, expires_in_hours=1)
        iid = invitation.id
        db.commit()
    barrier = Barrier(2)
    def register(index):
        with Session(engine) as db:
            barrier.wait(timeout=10)
            invitation = invitation_for_token(db, token, settings)
            if invitation is None:
                return "rejected"
            user = User(normalized_email=f"invite-concurrent-{index}@example.test")
            db.add(user); db.flush()
            consume_invitation(invitation, user.id)
            db.commit()
            return "created"
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(register, (1, 2)))
    assert sorted(results) == ["created", "rejected"]
    with Session(engine) as db:
        assert db.query(User).filter(User.normalized_email.like("invite-concurrent-%")).count() == 1
        row = db.get(AccountInvitation, iid)
        assert row.used_by_user_id is not None and row.used_at is not None
