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
from sqlalchemy import func, update
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models.auth import AuthLoginThrottle, AuthPrincipal, AuthSession
from app.models.user import User

OWNER_PRINCIPAL_ID = "owner"
# The migration that introduced account identities uses this UUID for the
# administrator that owns all pre-account data.  Keep the identity stable and
# independent from mutable email/display-name fields; every root-admin
# authorization check is anchored to this user and the ``owner`` principal.
ROOT_ADMIN_USER_ID = uuid.UUID("2dfb6c9e-4b25-4f67-9f5e-4b87f1d8ad01")
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
_dummy_password_hash = _password_hasher.hash("chat-reader-dummy-credential-check")


@dataclass(frozen=True)
class AuthContext:
    principal_id: str
    session_id: uuid.UUID
    user_id: uuid.UUID | None = None
    role: str = "ADMIN"


@dataclass(frozen=True)
class SessionAuthentication:
    context: AuthContext
    session: AuthSession
    touched: bool


class AuthConfigurationError(RuntimeError):
    pass


def root_admin_user(db: Session, context: AuthContext | None) -> User | None:
    """Return the configured root administrator for an authenticated context.

    ``owner`` is the only administrator principal.  We intentionally verify
    both the principal id and its immutable UUID binding instead of trusting a
    mutable role, email, username, or client-provided value.  Returning
    ``None`` lets route layers use a deliberately generic 404/401 response so
    admin-resource existence is not disclosed to regular users.
    """

    if context is None or context.principal_id != OWNER_PRINCIPAL_ID:
        return None
    principal = db.get(AuthPrincipal, OWNER_PRINCIPAL_ID)
    if principal is None or principal.user_id != ROOT_ADMIN_USER_ID:
        return None
    if context.user_id != ROOT_ADMIN_USER_ID:
        return None
    user = db.get(User, ROOT_ADMIN_USER_ID)
    if user is None or user.status != "ACTIVE" or user.role != "ADMIN":
        return None
    return user


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


def provision_owner(
    db: Session,
    password: str,
    settings: Settings,
    *,
    now: datetime | None = None,
    allow_weak_initial: bool = False,
) -> AuthPrincipal:
    now = now or utc_now()
    # Validate the deployment secret before mutating canonical credential state.
    token_digest(secrets.token_urlsafe(32), settings)
    principal = db.get(AuthPrincipal, OWNER_PRINCIPAL_ID)
    initial_account = principal is None
    owner_user = None
    if principal is not None and principal.user_id:
        # Once provisioned, the owner principal must never be rebound to a
        # different account.  This prevents a deleted/mutated user row from
        # silently transferring root-admin authority to another identity.
        if principal.user_id != ROOT_ADMIN_USER_ID:
            raise AuthConfigurationError("The owner principal is bound to an invalid administrator identity.")
        owner_user = db.get(User, principal.user_id)
        if owner_user is None:
            raise AuthConfigurationError("The owner principal's administrator identity is missing.")
        initial_account = owner_user.normalized_email is None
    unchanged_initial_password = principal is not None and verify_password(principal.password_hash, password)
    if allow_weak_initial and (initial_account or unchanged_initial_password) and 6 <= len(password) <= PASSWORD_MAX_LENGTH:
        password_hash = _password_hasher.hash(password)
    else:
        password_hash = hash_password(password)
    if owner_user is None:
        # Fresh databases and pre-account principals both converge on the
        # migration's stable UUID.  Never select an arbitrary ADMIN row by
        # email/role: those fields are mutable and cannot establish identity.
        owner_user = db.get(User, ROOT_ADMIN_USER_ID)
        if owner_user is None:
            owner_user = User(
                id=ROOT_ADMIN_USER_ID,
                display_name="Administrator",
                role="ADMIN",
                status="ACTIVE",
                credential_version=1,
                created_at=now,
                updated_at=now,
            )
            db.add(owner_user)
            db.flush()
    if principal is None:
        principal = AuthPrincipal(
            id=OWNER_PRINCIPAL_ID,
            user_id=owner_user.id,
            password_hash=password_hash,
            credential_version=1,
            created_at=now,
            updated_at=now,
        )
        db.add(principal)
    else:
        # The branch above guarantees this is the stable root identity.  Keep
        # the assignment only for legacy rows that predate user binding.
        principal.user_id = principal.user_id or ROOT_ADMIN_USER_ID
        principal.password_hash = password_hash
        principal.credential_version += 1
        principal.updated_at = now
        owner_user.credential_version = principal.credential_version
        owner_user.updated_at = now
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
    device_label: str = "Unknown device",
) -> tuple[str, AuthSession]:
    now = now or utc_now()
    token = secrets.token_urlsafe(48)
    session = AuthSession(
        principal_id=principal.id,
        token_digest=token_digest(token, settings),
        credential_version=principal.credential_version,
        device_label=device_label[:120] or "Unknown device",
        created_at=now,
        last_activity_at=now,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return token, session


def describe_user_agent(user_agent: str | None) -> str:
    value = (user_agent or "").casefold()
    browser = (
        "Edge" if "edg/" in value else "Firefox" if "firefox/" in value else
        "Chrome" if "chrome/" in value or "chromium/" in value else
        "Safari" if "safari/" in value else "Browser"
    )
    os_name = (
        "Windows" if "windows" in value else "macOS" if "mac os" in value else
        "Android" if "android" in value else "iOS" if "iphone" in value or "ipad" in value else
        "Linux" if "linux" in value else "device"
    )
    return f"{browser} on {os_name}"


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
    user = db.get(User, principal.user_id) if principal.user_id is not None else None
    if user is not None and (user.status != "ACTIVE" or session.credential_version != user.credential_version):
        session.revoked_at = now
        db.commit()
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
        context=AuthContext(
            principal_id=principal.id,
            session_id=session.id,
            user_id=user.id if user is not None else None,
            role=user.role if user is not None else "ADMIN",
        ),
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


def normalize_email(email: str) -> str:
    value = email.strip().casefold()
    if not value or "@" not in value or len(value) > 320 or any(ch.isspace() for ch in value):
        raise ValueError("Enter a valid email address.")
    local, _, domain = value.rpartition("@")
    if not local or not domain or "." not in domain:
        raise ValueError("Enter a valid email address.")
    return value


def verify_login_for_email(
    db: Session,
    email: str,
    password: str,
    *,
    now: datetime | None = None,
) -> AuthPrincipal | None:
    """Authenticate an account without revealing whether its email exists."""
    normalized = normalize_email(email)
    user = db.query(User).filter(func.lower(User.normalized_email) == normalized).one_or_none()
    principal = db.query(AuthPrincipal).filter(AuthPrincipal.user_id == user.id).one_or_none() if user else None
    throttle_id = principal.id if principal is not None else f"email:{normalized}"
    # Unknown addresses intentionally use the same password verification path
    # and generic failure response; no user row is created on failed login.
    if principal is None or user is None:
        verify_password(_dummy_password_hash, password)
        return None
    if user.status != "ACTIVE":
        verify_password(principal.password_hash, password)
        return None
    return _verify_principal_login(db, principal, password, throttle_id=throttle_id, now=now)


def _verify_principal_login(
    db: Session,
    principal: AuthPrincipal,
    password: str,
    *,
    throttle_id: str,
    now: datetime | None = None,
) -> AuthPrincipal | None:
    now = now or utc_now()
    throttle = db.get(AuthLoginThrottle, principal.id)
    if throttle is not None and throttle.blocked_until is not None and _utc(throttle.blocked_until) > now:
        retry = int((_utc(throttle.blocked_until) - now).total_seconds()) + 1
        raise LoginThrottled(retry)
    if verify_password(principal.password_hash, password):
        if throttle is not None:
            db.delete(throttle)
            db.commit()
        return principal
    if throttle is None:
        throttle = AuthLoginThrottle(principal_id=principal.id, failed_attempts=0, updated_at=now)
        db.add(throttle)
    throttle.failed_attempts += 1
    throttle.updated_at = now
    if throttle.failed_attempts >= LOGIN_BACKOFF_AFTER:
        delay = min(LOGIN_BACKOFF_MAX_SECONDS, 2 ** (throttle.failed_attempts - LOGIN_BACKOFF_AFTER))
        throttle.blocked_until = now + timedelta(seconds=delay)
    db.commit()
    return None


def register_user(
    db: Session,
    email: str,
    password: str,
    *,
    display_name: str | None = None,
    now: datetime | None = None,
) -> tuple[User, AuthPrincipal]:
    normalized = normalize_email(email)
    validate_new_password(password)
    if db.query(User).filter(func.lower(User.normalized_email) == normalized).first() is not None:
        raise ValueError("An account with this email already exists.")
    now = now or utc_now()
    user = User(
        id=uuid.uuid4(),
        normalized_email=normalized,
        display_name=display_name.strip()[:200] if display_name and display_name.strip() else None,
        role="USER",
        status="ACTIVE",
        credential_version=1,
        created_at=now,
        updated_at=now,
    )
    db.add(user)
    db.flush()
    principal = AuthPrincipal(
        id=f"user:{user.id}",
        user_id=user.id,
        password_hash=hash_password(password),
        credential_version=1,
        created_at=now,
        updated_at=now,
    )
    db.add(principal)
    db.flush()
    return user, principal


def legacy_account_setup_required(db: Session) -> bool:
    principal = db.get(AuthPrincipal, OWNER_PRINCIPAL_ID)
    if principal is None or principal.user_id is None:
        return False
    user = db.get(User, principal.user_id)
    return user is not None and user.normalized_email is None


def upgrade_legacy_owner(
    db: Session,
    *,
    current_password: str,
    email: str,
    display_name: str | None = None,
    now: datetime | None = None,
) -> User:
    now = now or utc_now()
    principal = db.get(AuthPrincipal, OWNER_PRINCIPAL_ID)
    if principal is None or principal.user_id is None:
        raise ValueError("Legacy account setup is not available.")
    user = db.get(User, principal.user_id)
    if user is None or user.normalized_email is not None:
        raise ValueError("Legacy account setup is already complete.")
    if not verify_password(principal.password_hash, current_password):
        raise PermissionError("Current password is incorrect.")
    normalized = normalize_email(email)
    if db.query(User).filter(func.lower(User.normalized_email) == normalized, User.id != user.id).first():
        raise ValueError("An account with this email already exists.")
    user.normalized_email = normalized
    user.display_name = display_name.strip()[:200] if display_name and display_name.strip() else user.display_name
    user.role = "ADMIN"
    user.status = "ACTIVE"
    user.updated_at = now
    principal.credential_version += 1
    principal.updated_at = now
    user.credential_version = principal.credential_version
    db.execute(
        update(AuthSession)
        .where(AuthSession.principal_id == principal.id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=now)
    )
    db.flush()
    return user


def change_password(
    db: Session,
    current_password: str,
    new_password: str,
    *,
    principal_id: str = OWNER_PRINCIPAL_ID,
    now: datetime | None = None,
) -> bool:
    now = now or utc_now()
    principal = db.get(AuthPrincipal, principal_id)
    if principal is None or not verify_password(principal.password_hash, current_password):
        return False
    validate_new_password(new_password)
    principal.password_hash = hash_password(new_password)
    principal.credential_version += 1
    principal.updated_at = now
    if principal.user_id is not None:
        user = db.get(User, principal.user_id)
        if user is not None:
            user.credential_version += 1
            user.updated_at = now
    db.execute(
        update(AuthSession)
        .where(AuthSession.principal_id == principal_id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=now)
    )
    throttle = db.get(AuthLoginThrottle, principal_id)
    if throttle is not None:
        db.delete(throttle)
    db.commit()
    return True


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
