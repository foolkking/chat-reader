"""Purpose-bound, single-use grants. Reading the landing page never consumes one."""
from __future__ import annotations

import secrets
from datetime import timedelta

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models.access import EmailVerificationGrant
from app.models.user import User
from app.services.access import _utc
from app.services.auth import token_digest, utc_now


def create_email_verification(db: Session, settings: Settings, user: User) -> str:
    # All issuance and consumption take the user lock first, serializing resend
    # with confirmation without allowing a replay of a superseded grant.
    db.query(User).filter(User.id == user.id).with_for_update().populate_existing().one()
    if user.status == "DISABLED" or user.approval_status == "REJECTED" or not user.email_verification_required or user.email_verified_at:
        raise ValueError("This account does not need email verification.")
    now = utc_now()
    db.query(EmailVerificationGrant).filter(
        EmailVerificationGrant.user_id == user.id,
        EmailVerificationGrant.purpose == "REGISTER",
        EmailVerificationGrant.used_at.is_(None),
        EmailVerificationGrant.revoked_at.is_(None),
    ).update({"revoked_at": now}, synchronize_session="fetch")
    token = secrets.token_urlsafe(48)
    db.add(EmailVerificationGrant(
        user_id=user.id, purpose="REGISTER", target_email=user.normalized_email,
        credential_version=user.credential_version, token_digest=token_digest(token, settings),
        created_at=now, expires_at=now + timedelta(minutes=30),
    ))
    db.flush()
    return token


def confirm_registration_email(db: Session, settings: Settings, token: str) -> User:
    error = "Verification link is invalid or expired. Request a new link."
    try:
        digest = token_digest(token, settings)
    except (UnicodeEncodeError, ValueError) as exc:
        raise ValueError(error) from exc
    grant = db.query(EmailVerificationGrant).filter(
        EmailVerificationGrant.token_digest == digest, EmailVerificationGrant.purpose == "REGISTER",
    ).one_or_none()
    if grant is None:
        raise ValueError(error)
    user = db.query(User).filter(User.id == grant.user_id).with_for_update().populate_existing().one_or_none()
    db.refresh(grant)
    now = utc_now()
    if (user is None or grant.used_at is not None or grant.revoked_at is not None or _utc(grant.expires_at) <= now
            or user.status == "DISABLED" or user.approval_status == "REJECTED"
            or grant.credential_version != user.credential_version or grant.target_email != user.normalized_email
            or not user.email_verification_required or user.email_verified_at is not None):
        raise ValueError(error)
    grant.used_at = now
    user.email_verified_at = now
    user.status = "ACTIVE" if user.registration_requirements_met else "PENDING"
    db.flush()
    return user
