"""Authenticated, password-checked address changes using purpose-bound grants."""
import secrets
from datetime import timedelta

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models.access import EmailVerificationGrant, PasswordResetGrant
from app.models.auth import AuthPrincipal, AuthSession
from app.models.user import User
from app.services.auth import SessionAuthentication, normalize_email, token_digest, utc_now, verify_password
from app.services.access import _utc

INVALID_LINK = "Email change link is invalid, expired, or belongs to another account."


def lock_email_account(db: Session, authentication: SessionAuthentication) -> tuple[User, AuthPrincipal, AuthSession]:
    user = db.query(User).filter(User.id == authentication.context.user_id).with_for_update().populate_existing().one_or_none()
    if user is None or user.role != "USER":
        raise PermissionError("Only regular accounts can change their email.")
    principal = db.query(AuthPrincipal).filter(AuthPrincipal.id == authentication.context.principal_id).with_for_update().populate_existing().one_or_none()
    session = db.query(AuthSession).filter(AuthSession.id == authentication.context.session_id).with_for_update().populate_existing().one_or_none()
    if (principal is None or session is None or not user.can_login or session.revoked_at is not None
            or principal.user_id != user.id or session.principal_id != principal.id
            or principal.credential_version != user.credential_version or session.credential_version != user.credential_version):
        raise PermissionError("The current account session is no longer valid.")
    return user, principal, session


def pending_email_change(db: Session, user: User) -> EmailVerificationGrant | None:
    return db.query(EmailVerificationGrant).filter(
        EmailVerificationGrant.user_id == user.id, EmailVerificationGrant.purpose == "EMAIL_CHANGE",
        EmailVerificationGrant.credential_version == user.credential_version,
        EmailVerificationGrant.used_at.is_(None), EmailVerificationGrant.revoked_at.is_(None),
        EmailVerificationGrant.expires_at > utc_now(),
    ).order_by(EmailVerificationGrant.created_at.desc()).first()


def request_email_change(db: Session, settings: Settings, authentication: SessionAuthentication, email: str, password: str) -> tuple[str, EmailVerificationGrant]:
    user, principal, _ = lock_email_account(db, authentication)
    if not verify_password(principal.password_hash, password):
        raise ValueError("Current password is incorrect.")
    target = normalize_email(email)
    if target == user.normalized_email:
        raise ValueError("Enter a different email address.")
    if db.query(User.id).filter(User.normalized_email == target).first() is not None:
        raise FileExistsError("This email address is unavailable.")
    now = utc_now()
    db.query(EmailVerificationGrant).filter(
        EmailVerificationGrant.user_id == user.id, EmailVerificationGrant.purpose == "EMAIL_CHANGE",
        EmailVerificationGrant.used_at.is_(None), EmailVerificationGrant.revoked_at.is_(None),
    ).update({"revoked_at": now}, synchronize_session="fetch")
    token = secrets.token_urlsafe(48)
    grant = EmailVerificationGrant(user_id=user.id, purpose="EMAIL_CHANGE", target_email=target,
        credential_version=user.credential_version, token_digest=token_digest(token, settings),
        created_at=now, expires_at=now + timedelta(minutes=30))
    db.add(grant)
    db.flush()
    return token, grant


def validate_email_change(db: Session, settings: Settings, user: User, token: str) -> EmailVerificationGrant:
    try:
        digest = token_digest(token, settings)
    except (ValueError, UnicodeEncodeError) as exc:
        raise ValueError(INVALID_LINK) from exc
    grant = db.query(EmailVerificationGrant).filter(
        EmailVerificationGrant.token_digest == digest, EmailVerificationGrant.purpose == "EMAIL_CHANGE",
        EmailVerificationGrant.user_id == user.id,
    ).populate_existing().one_or_none()
    if (grant is None or grant.used_at is not None or grant.revoked_at is not None or _utc(grant.expires_at) <= utc_now()
            or grant.credential_version != user.credential_version or not user.can_login or user.role != "USER"):
        raise ValueError(INVALID_LINK)
    return grant


def confirm_email_change(db: Session, settings: Settings, authentication: SessionAuthentication, token: str) -> User:
    user, principal, session = lock_email_account(db, authentication)
    grant = validate_email_change(db, settings, user, token)
    # The unique constraint is the final arbiter if another account takes the
    # address between issuance and confirmation (or confirms concurrently).
    if db.query(User.id).filter(User.normalized_email == grant.target_email, User.id != user.id).first() is not None:
        raise FileExistsError("This email address is unavailable. Request a different address.")
    now = utc_now()
    user.normalized_email = grant.target_email
    user.email_verified_at = now
    user.updated_at = now
    principal.credential_version += 1
    principal.updated_at = now
    user.credential_version = principal.credential_version
    session.credential_version = principal.credential_version
    session.last_activity_at = now
    grant.used_at = now
    db.flush()
    db.query(AuthSession).filter(AuthSession.principal_id == principal.id, AuthSession.id != session.id,
        AuthSession.revoked_at.is_(None)).update({"revoked_at": now}, synchronize_session="fetch")
    db.query(EmailVerificationGrant).filter(EmailVerificationGrant.user_id == user.id,
        EmailVerificationGrant.used_at.is_(None), EmailVerificationGrant.revoked_at.is_(None)).update({"revoked_at": now}, synchronize_session="fetch")
    db.query(PasswordResetGrant).filter(PasswordResetGrant.user_id == user.id,
        PasswordResetGrant.used_at.is_(None), PasswordResetGrant.revoked_at.is_(None)).update({"revoked_at": now}, synchronize_session="fetch")
    db.flush()
    return user
