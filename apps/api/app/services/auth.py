from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Protocol

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHash, VerifyMismatchError, VerificationError
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models.auth import AuthLoginThrottle, AuthPrincipal, AuthSession

OWNER_PRINCIPAL_ID = "owner"
SESSION_COOKIE_NAME = "chat_reader_session"
# This is deliberately not a credential. It lets the offline UI notice that a
# user cleared browser cookies while preserving the HttpOnly session token as
# the sole server-side authorization authority.
SESSION_PRESENCE_COOKIE_NAME = "chat_reader_session_present"
PASSWORD_MIN_LENGTH = 12
PASSWORD_MAX_LENGTH = 1024
LOGIN_BACKOFF_AFTER = 3
LOGIN_BACKOFF_MAX_SECONDS = 30

_password_hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=4)


@dataclass(frozen=True)
class AuthContext:
    principal_id: str
    session_id: uuid.UUID


@dataclass(frozen=True)
class SessionAuthentication:
    context: AuthContext
    session: AuthSession
    touched: bool


class AuthConfigurationError(RuntimeError):
    pass


class LoginThrottled(RuntimeError):
    def __init__(self, retry_after_seconds: int):
        super().__init__("Login temporarily throttled.")
        self.retry_after_seconds = max(1, retry_after_seconds)


class AuthProvider(Protocol):
    """Future-compatible credential boundary; Release N ships one provider only."""

    auth_mode: str

    def authenticate(self, db: Session, password: str, *, now: datetime | None = None) -> AuthPrincipal | None: ...


class SingleOwnerPasswordProvider:
    auth_mode = "single_password"

    def authenticate(self, db: Session, password: str, *, now: datetime | None = None) -> AuthPrincipal | None:
        return verify_login(db, password, now=now)


single_owner_password_provider: AuthProvider = SingleOwnerPasswordProvider()


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def validate_new_password(password: str) -> None:
    if len(password) < PASSWORD_MIN_LENGTH:
        raise ValueError(f"Password must be at least {PASSWORD_MIN_LENGTH} characters.")
    if len(password) > PASSWORD_MAX_LENGTH:
        raise ValueError(f"Password must not exceed {PASSWORD_MAX_LENGTH} characters.")


def hash_password(password: str) -> str:
    validate_new_password(password)
    return _password_hasher.hash(password)


def verify_password(password_hash: str, candidate: str) -> bool:
    if len(candidate) > PASSWORD_MAX_LENGTH:
        return False
    try:
        return _password_hasher.verify(password_hash, candidate)
    except (VerifyMismatchError, VerificationError, InvalidHash, ValueError):
        return False


def token_digest(token: str, settings: Settings) -> str:
    secret = settings.auth_secret_value().encode("utf-8")
    if len(secret) < 32:
        raise AuthConfigurationError("Authentication session secret is unavailable.")
    return hmac.new(secret, token.encode("ascii"), hashlib.sha256).hexdigest()


def provision_owner(db: Session, password: str, settings: Settings, *, now: datetime | None = None) -> AuthPrincipal:
    now = now or utc_now()
    # Validate the deployment secret before mutating canonical credential state.
    token_digest(secrets.token_urlsafe(32), settings)
    password_hash = hash_password(password)
    principal = db.get(AuthPrincipal, OWNER_PRINCIPAL_ID)
    if principal is None:
        principal = AuthPrincipal(
            id=OWNER_PRINCIPAL_ID,
            password_hash=password_hash,
            credential_version=1,
            created_at=now,
            updated_at=now,
        )
        db.add(principal)
    else:
        principal.password_hash = password_hash
        principal.credential_version += 1
        principal.updated_at = now
        db.execute(
            update(AuthSession)
            .where(AuthSession.principal_id == OWNER_PRINCIPAL_ID, AuthSession.revoked_at.is_(None))
            .values(revoked_at=now)
        )
    throttle = db.get(AuthLoginThrottle, OWNER_PRINCIPAL_ID)
    if throttle is not None:
        db.delete(throttle)
    db.commit()
    db.refresh(principal)
    return principal


def issue_session(
    db: Session,
    principal: AuthPrincipal,
    settings: Settings,
    *,
    now: datetime | None = None,
) -> tuple[str, AuthSession]:
    now = now or utc_now()
    token = secrets.token_urlsafe(48)
    session = AuthSession(
        principal_id=principal.id,
        token_digest=token_digest(token, settings),
        credential_version=principal.credential_version,
        created_at=now,
        last_activity_at=now,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return token, session


def authenticate_session(
    db: Session,
    token: str | None,
    settings: Settings,
    *,
    now: datetime | None = None,
    touch: bool = True,
) -> SessionAuthentication | None:
    if token is None or len(token) < 32 or len(token) > 256:
        return None
    now = now or utc_now()
    try:
        digest = token_digest(token, settings)
    except (UnicodeEncodeError, AuthConfigurationError):
        return None
    session = db.query(AuthSession).filter(AuthSession.token_digest == digest).one_or_none()
    if session is None or session.revoked_at is not None:
        return None
    principal = db.get(AuthPrincipal, session.principal_id)
    if principal is None or session.credential_version != principal.credential_version:
        return None
    if now - _utc(session.last_activity_at) >= timedelta(seconds=settings.auth_inactivity_timeout_seconds):
        session.revoked_at = now
        db.commit()
        return None

    touched = False
    if touch and now - _utc(session.last_activity_at) >= timedelta(
        seconds=settings.auth_activity_touch_interval_seconds
    ):
        session.last_activity_at = now
        db.commit()
        touched = True
    return SessionAuthentication(
        context=AuthContext(principal_id=principal.id, session_id=session.id),
        session=session,
        touched=touched,
    )


def revoke_session(db: Session, token: str | None, settings: Settings, *, now: datetime | None = None) -> None:
    if token is None:
        return
    try:
        digest = token_digest(token, settings)
    except (UnicodeEncodeError, AuthConfigurationError):
        return
    session = db.query(AuthSession).filter(AuthSession.token_digest == digest).one_or_none()
    if session is not None and session.revoked_at is None:
        session.revoked_at = now or utc_now()
        db.commit()


def verify_login(db: Session, password: str, *, now: datetime | None = None) -> AuthPrincipal | None:
    now = now or utc_now()
    principal = db.get(AuthPrincipal, OWNER_PRINCIPAL_ID)
    if principal is None:
        return None
    throttle = db.get(AuthLoginThrottle, OWNER_PRINCIPAL_ID)
    if throttle is not None and throttle.blocked_until is not None and _utc(throttle.blocked_until) > now:
        retry = int((_utc(throttle.blocked_until) - now).total_seconds()) + 1
        raise LoginThrottled(retry)

    if verify_password(principal.password_hash, password):
        if throttle is not None:
            db.delete(throttle)
            db.commit()
        return principal

    if throttle is None:
        throttle = AuthLoginThrottle(principal_id=OWNER_PRINCIPAL_ID, failed_attempts=0, updated_at=now)
        db.add(throttle)
    throttle.failed_attempts += 1
    throttle.updated_at = now
    if throttle.failed_attempts >= LOGIN_BACKOFF_AFTER:
        delay = min(LOGIN_BACKOFF_MAX_SECONDS, 2 ** (throttle.failed_attempts - LOGIN_BACKOFF_AFTER))
        throttle.blocked_until = now + timedelta(seconds=delay)
    db.commit()
    return None


def change_password(
    db: Session,
    current_password: str,
    new_password: str,
    *,
    now: datetime | None = None,
) -> bool:
    now = now or utc_now()
    principal = db.get(AuthPrincipal, OWNER_PRINCIPAL_ID)
    if principal is None or not verify_password(principal.password_hash, current_password):
        return False
    validate_new_password(new_password)
    principal.password_hash = hash_password(new_password)
    principal.credential_version += 1
    principal.updated_at = now
    db.execute(
        update(AuthSession)
        .where(AuthSession.principal_id == OWNER_PRINCIPAL_ID, AuthSession.revoked_at.is_(None))
        .values(revoked_at=now)
    )
    throttle = db.get(AuthLoginThrottle, OWNER_PRINCIPAL_ID)
    if throttle is not None:
        db.delete(throttle)
    db.commit()
    return True


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
