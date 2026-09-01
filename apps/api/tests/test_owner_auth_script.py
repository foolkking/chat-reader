from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import get_settings
from app.core.database import Base
from app.models.auth import AuthPrincipal
from app.models.user import User
from app.services.auth import provision_owner, verify_password
from scripts import owner_auth


@pytest.fixture()
def deployment_admin(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    database_url = f"sqlite:///{tmp_path / 'deployment-admin.db'}"
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.setenv("AUTH_SESSION_SECRET", "test-only-session-secret-012345678901234567890")
    monkeypatch.setenv("ADMIN_EMAIL", "fool@1.com")
    monkeypatch.setenv("ADMIN_PASSWORD", "123456")
    get_settings.cache_clear()
    settings = get_settings()
    engine = create_engine(database_url)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    Base.metadata.create_all(bind=engine)
    monkeypatch.setattr(owner_auth, "SessionLocal", factory)
    yield settings, factory
    get_settings.cache_clear()


def test_deployment_admin_changes_only_when_environment_changes(deployment_admin, monkeypatch, capsys) -> None:
    settings, factory = deployment_admin

    owner_auth.ensure_configured_admin(settings)
    first_output = capsys.readouterr().out
    assert "123456" not in first_output
    with factory() as db:
        principal = db.get(AuthPrincipal, "owner")
        assert principal is not None
        user = db.get(User, principal.user_id)
        assert user is not None
        assert user.normalized_email == "fool@1.com"
        assert user.role == "ADMIN"
        assert verify_password(principal.password_hash, "123456")
        applied_digest = principal.deployment_config_digest
        assert applied_digest and len(applied_digest) == 64

        provision_owner(db, "web-updated-password", settings)
        assert db.query(User).count() == 1

    owner_auth.ensure_configured_admin(settings)
    assert "unchanged" in capsys.readouterr().out
    with factory() as db:
        principal = db.get(AuthPrincipal, "owner")
        assert principal is not None
        assert verify_password(principal.password_hash, "web-updated-password")
        assert principal.deployment_config_digest == applied_digest

    monkeypatch.setenv("ADMIN_EMAIL", "changed@example.test")
    monkeypatch.setenv("ADMIN_PASSWORD", "new-deployment-password")
    owner_auth.ensure_configured_admin(settings)
    with factory() as db:
        principal = db.get(AuthPrincipal, "owner")
        assert principal is not None
        user = db.get(User, principal.user_id)
        assert user is not None
        assert user.normalized_email == "changed@example.test"
        assert verify_password(principal.password_hash, "new-deployment-password")
        assert principal.deployment_config_digest != applied_digest
        assert db.query(User).count() == 1


def test_deployment_admin_requires_email_and_password_together(deployment_admin, monkeypatch) -> None:
    settings, factory = deployment_admin
    monkeypatch.delenv("ADMIN_PASSWORD")

    with pytest.raises(SystemExit, match="must be provided together"):
        owner_auth.ensure_configured_admin(settings)

    with factory() as db:
        assert db.get(AuthPrincipal, "owner") is None
