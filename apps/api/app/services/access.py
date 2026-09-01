from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models.access import AccountInvitation, InstanceAccessSetting, PasswordResetGrant
from app.models.auth import AuthPrincipal, AuthSession
from app.models.user import User
from app.services.auth import hash_password, token_digest, utc_now, validate_new_password


def registration_mode(db: Session, settings: Settings) -> str:
    row = db.get(InstanceAccessSetting, 1)
    return row.registration_mode if row is not None else settings.auth_registration_mode


def access_settings(db: Session, settings: Settings) -> dict:
    row = db.get(InstanceAccessSetting, 1)
    return {
        "registration_mode": row.registration_mode if row else settings.auth_registration_mode,
        "require_admin_approval": row.require_admin_approval if row else False,
        "email_verification_enabled": row.email_verification_enabled if row else False,
        "password_reset_enabled": row.password_reset_enabled if row else True,
    }


def set_registration_mode(db: Session, mode: str, actor_user_id: uuid.UUID) -> InstanceAccessSetting:
    if mode not in {"CLOSED", "INVITE_ONLY", "OPEN"}:
        raise ValueError("Invalid registration mode.")
    row = db.get(InstanceAccessSetting, 1)
    if row is None:
        row = InstanceAccessSetting(id=1, registration_mode=mode, updated_by_user_id=actor_user_id)
        db.add(row)
    else:
        row.registration_mode = mode
        row.updated_by_user_id = actor_user_id
        row.updated_at = utc_now()
    db.flush()
    return row


def set_access_settings(
    db: Session,
    *,
    mode: str,
    require_admin_approval: bool,
    email_verification_enabled: bool,
    password_reset_enabled: bool,
    actor_user_id: uuid.UUID,
) -> InstanceAccessSetting:
    row = set_registration_mode(db, mode, actor_user_id)
    row.require_admin_approval = require_admin_approval
    row.email_verification_enabled = email_verification_enabled
    row.password_reset_enabled = password_reset_enabled
    row.updated_by_user_id = actor_user_id
    row.updated_at = utc_now()
    db.flush()
    return row


def create_invitation(
    db: Session,
    settings: Settings,
    actor_user_id: uuid.UUID,
    *,
    expires_in_hours: int = 168,
) -> tuple[str, AccountInvitation]:
    if not 1 <= expires_in_hours <= 24 * 90:
        raise ValueError("Invitation expiry must be between 1 hour and 90 days.")
    token = secrets.token_urlsafe(48)
    now = utc_now()
    invitation = AccountInvitation(
        id=uuid.uuid4(),
        token_digest=token_digest(token, settings),
        created_by_user_id=actor_user_id,
        expires_at=now + timedelta(hours=expires_in_hours),
        created_at=now,
    )
    db.add(invitation)
    db.flush()
    return token, invitation


def invitation_for_token(db: Session, token: str, settings: Settings, *, now: datetime | None = None) -> AccountInvitation | None:
    now = now or utc_now()
    try:
        digest = token_digest(token, settings)
    except (UnicodeEncodeError, ValueError):
        return None
    row = db.query(AccountInvitation).filter(AccountInvitation.token_digest == digest).one_or_none()
    if row is None or row.revoked_at is not None or row.used_at is not None or _utc(row.expires_at) <= now:
        return None
    return row


def consume_invitation(invitation: AccountInvitation, user_id: uuid.UUID, *, now: datetime | None = None) -> None:
    if invitation.used_at is not None or invitation.revoked_at is not None:
        raise ValueError("Invitation is no longer valid.")
    invitation.used_by_user_id = user_id
    invitation.used_at = now or utc_now()


def disable_user(db: Session, user: User, disabled: bool) -> None:
    user.status = "DISABLED" if disabled else "ACTIVE"
    user.updated_at = utc_now()
    if disabled:
        principal = db.query(AuthPrincipal).filter(AuthPrincipal.user_id == user.id).one_or_none()
        if principal is not None:
            db.execute(
                update(AuthSession)
                .where(AuthSession.principal_id == principal.id, AuthSession.revoked_at.is_(None))
                .values(revoked_at=utc_now())
            )
    db.flush()


def revoke_user_sessions(db: Session, user: User) -> int:
    principal = db.query(AuthPrincipal).filter(AuthPrincipal.user_id == user.id).one_or_none()
    if principal is None:
        return 0
    result = db.execute(
        update(AuthSession)
        .where(AuthSession.principal_id == principal.id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=utc_now())
    )
    db.flush()
    return int(result.rowcount or 0)


def review_pending_user(db: Session, user: User, *, approved: bool, actor_user_id: uuid.UUID) -> None:
    if user.status != "PENDING":
        raise ValueError("Only pending users can be reviewed.")
    user.status = "ACTIVE" if approved else "DISABLED"
    user.approval_reviewed_at = utc_now()
    user.approval_reviewed_by_user_id = actor_user_id
    user.updated_at = utc_now()
    if not approved:
        revoke_user_sessions(db, user)
    db.flush()


def create_password_reset_grant(
    db: Session,
    settings: Settings,
    user_id: uuid.UUID,
    *,
    actor_user_id: uuid.UUID | None,
    expires_in_minutes: int = 30,
) -> tuple[str, PasswordResetGrant]:
    token = secrets.token_urlsafe(48)
    now = utc_now()
    grant = PasswordResetGrant(
        id=uuid.uuid4(),
        user_id=user_id,
        token_digest=token_digest(token, settings),
        created_by_user_id=actor_user_id,
        expires_at=now + timedelta(minutes=max(5, min(expires_in_minutes, 120))),
        created_at=now,
    )
    db.add(grant)
    db.flush()
    return token, grant


def consume_password_reset(db: Session, settings: Settings, token: str, new_password: str) -> User:
    validate_new_password(new_password)
    now = utc_now()
    try:
        digest = token_digest(token, settings)
    except (UnicodeEncodeError, ValueError) as exc:
        raise ValueError("Password reset link is invalid or expired.") from exc
    grant = db.query(PasswordResetGrant).filter(PasswordResetGrant.token_digest == digest).one_or_none()
    if grant is None or grant.used_at is not None or grant.revoked_at is not None or _utc(grant.expires_at) <= now:
        raise ValueError("Password reset link is invalid or expired.")
    user = db.get(User, grant.user_id)
    principal = db.query(AuthPrincipal).filter(AuthPrincipal.user_id == grant.user_id).one_or_none()
    if user is None or principal is None or user.status != "ACTIVE":
        raise ValueError("Password reset link is invalid or expired.")
    principal.password_hash = hash_password(new_password)
    principal.credential_version += 1
    principal.updated_at = now
    user.credential_version = principal.credential_version
    user.updated_at = now
    grant.used_at = now
    db.execute(
        update(AuthSession)
        .where(AuthSession.principal_id == principal.id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=now)
    )
    db.flush()
    return user


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
