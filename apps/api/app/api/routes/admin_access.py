from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.models.access import AccountInvitation
from app.models.administration import AdminAuditLog
from app.models.user import User
from app.services.access import (
    create_invitation,
    create_password_reset_grant,
    disable_user,
    access_settings,
    review_pending_user,
    revoke_user_sessions,
    set_access_settings,
)
from app.services.auth import root_admin_user
from app.api.routes.tasks import background_job_read
from app.schemas.task import BackgroundTaskRead
from app.services.user_deletion import account_deletion_impact, queue_user_account_delete, ensure_not_deleting
from app.services.admin_users import user_rows, users_page

router = APIRouter(prefix="/api/admin/access", tags=["admin-access"])


class RegistrationUpdate(BaseModel):
    mode: str = Field(pattern="^(CLOSED|INVITE_ONLY|OPEN)$")
    require_admin_approval: bool | None = None
    email_verification_enabled: bool | None = None
    password_reset_enabled: bool | None = None


class InvitationCreate(BaseModel):
    expires_in_hours: int = Field(default=168, ge=1, le=2160)


class UserStatusUpdate(BaseModel):
    status: str = Field(pattern="^(ACTIVE|DISABLED)$")


class ResetGrantCreate(BaseModel):
    expires_in_minutes: int = Field(default=30, ge=5, le=120)


class DeleteUserRequest(BaseModel):
    confirm_user_id: uuid.UUID


def _admin(request: Request, db: Session) -> User:
    context = getattr(request.state, "auth", None)
    user = root_admin_user(db, context)
    if user is None:
        raise HTTPException(status_code=404, detail="Not found.")
    return user


@router.get("")
def get_access_overview(request: Request, db: Session = Depends(get_db)) -> dict:
    _admin(request, db)
    settings = get_settings()
    return {
        **access_settings(db, settings),
        "smtp_configured": bool(settings.smtp_host and settings.smtp_from_address),
    }


@router.put("/registration")
def update_registration(payload: RegistrationUpdate, request: Request, db: Session = Depends(get_db)) -> dict:
    actor = _admin(request, db)
    settings = get_settings()
    if payload.email_verification_enabled is True and not (settings.smtp_host and settings.smtp_from_address):
        raise HTTPException(status_code=422, detail="Configure SMTP before requiring email verification.")
    row = set_access_settings(
        db,
        mode=payload.mode,
        require_admin_approval=payload.require_admin_approval,
        email_verification_enabled=payload.email_verification_enabled,
        password_reset_enabled=payload.password_reset_enabled,
        actor_user_id=actor.id,
    )
    _record(db, request, actor.id, "REGISTRATION_MODE_CHANGED", resource_type="INSTANCE_ACCESS", resource_id="1",
            metadata={key: value for key, value in payload.model_dump(exclude_unset=True).items() if value is not None})
    db.commit()
    return {**access_settings(db, settings), "smtp_configured": bool(settings.smtp_host and settings.smtp_from_address), "updated_at": row.updated_at}


@router.get("/users")
def list_users(request: Request, db: Session = Depends(get_db)) -> list[dict]:
    _admin(request, db)
    rows = db.query(User).order_by(User.created_at.asc(), User.id.asc()).all()
    return user_rows(db, rows)


@router.get("/users/page")
def list_user_page(
    request: Request,
    q: str = Query(default="", max_length=200),
    state: str = Query(default="ALL", pattern="^(ALL|ACTIVE|DISABLED|PENDING|UNVERIFIED|REJECTED)$"),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> dict:
    _admin(request, db)
    return users_page(db, q=q, state=state, offset=offset, limit=limit)


@router.get("/users/{user_id}")
def user_detail(user_id: uuid.UUID, request: Request, db: Session = Depends(get_db)) -> dict:
    _admin(request, db)
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found.")
    return user_rows(db, [user])[0]


@router.patch("/users/{user_id}/status")
def update_user_status(
    user_id: uuid.UUID,
    payload: UserStatusUpdate,
    request: Request,
    db: Session = Depends(get_db),
) -> dict:
    actor = _admin(request, db)
    user = db.get(User, user_id)
    if user is None or user.role == "ADMIN":
        raise HTTPException(status_code=404, detail="User not found.")
    _check_not_deleting(db, user)
    disable_user(db, user, payload.status == "DISABLED")
    _record(db, request, actor.id, "USER_DISABLED" if payload.status == "DISABLED" else "USER_ENABLED", target_user_id=user.id,
            resource_type="USER", resource_id=str(user.id))
    db.commit()
    return {"id": str(user.id), "status": user.status}


@router.post("/invitations", status_code=status.HTTP_201_CREATED)
def issue_invitation(payload: InvitationCreate, request: Request, db: Session = Depends(get_db)) -> dict:
    actor = _admin(request, db)
    token, invitation = create_invitation(
        db, get_settings(), actor.id, expires_in_hours=payload.expires_in_hours
    )
    _record(db, request, actor.id, "INVITATION_CREATED", resource_type="INVITATION", resource_id=str(invitation.id), metadata={"expires_at": invitation.expires_at.isoformat()})
    db.commit()
    base = get_settings().public_web_base_url.rstrip("/")
    return {
        "id": str(invitation.id),
        "token": token,
        "invite_url": f"{base}/register?invitation={token}",
        "expires_at": invitation.expires_at,
    }


@router.get("/invitations")
def list_invitations(request: Request, db: Session = Depends(get_db)) -> list[dict]:
    _admin(request, db)
    now = datetime.now(timezone.utc)
    rows = db.query(AccountInvitation).order_by(AccountInvitation.created_at.desc(), AccountInvitation.id.desc()).all()
    return _invitation_rows(rows, now)


@router.get("/invitations/page")
def list_invitation_page(
    request: Request,
    state: str = Query(default="ALL", pattern="^(ALL|PENDING|USED|EXPIRED|REVOKED)$"),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> dict:
    _admin(request, db)
    now = datetime.now(timezone.utc)
    query = db.query(AccountInvitation)
    if state == "REVOKED":
        query = query.filter(AccountInvitation.revoked_at.is_not(None))
    elif state != "ALL":
        query = query.filter(AccountInvitation.revoked_at.is_(None))
        if state == "USED":
            query = query.filter(AccountInvitation.used_at.is_not(None))
        else:
            query = query.filter(AccountInvitation.used_at.is_(None),
                AccountInvitation.expires_at <= now if state == "EXPIRED" else AccountInvitation.expires_at > now)
    total = query.count()
    rows = query.order_by(AccountInvitation.created_at.desc(), AccountInvitation.id.desc()).offset(offset).limit(limit).all()
    return {"items": _invitation_rows(rows, now), "total": total, "limit": limit, "offset": offset}


def _invitation_rows(rows: list[AccountInvitation], now: datetime) -> list[dict]:
    return [
        {
            "id": str(row.id),
            "status": (
                "REVOKED" if row.revoked_at else "USED" if row.used_at else "EXPIRED"
                if _utc(row.expires_at) <= now else "PENDING"
            ),
            "created_at": row.created_at,
            "expires_at": row.expires_at,
            "used_at": row.used_at,
        }
        for row in rows
    ]


@router.delete("/invitations/{invitation_id}", status_code=204)
def revoke_invitation(invitation_id: uuid.UUID, request: Request, db: Session = Depends(get_db)) -> None:
    actor = _admin(request, db)
    invitation = db.query(AccountInvitation).filter_by(id=invitation_id).with_for_update().populate_existing().one_or_none()
    if invitation is None or invitation.used_at is not None:
        raise HTTPException(status_code=404, detail="Invitation not found.")
    if invitation.revoked_at is not None:
        return
    invitation.revoked_at = datetime.now(timezone.utc)
    _record(db, request, actor.id, "INVITATION_REVOKED", resource_type="INVITATION", resource_id=str(invitation.id))
    db.commit()


@router.post("/users/{user_id}/password-reset", status_code=status.HTTP_201_CREATED)
def issue_password_reset(
    user_id: uuid.UUID,
    payload: ResetGrantCreate,
    request: Request,
    db: Session = Depends(get_db),
) -> dict:
    actor = _admin(request, db)
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found.")
    _check_not_deleting(db, user)
    token, grant = create_password_reset_grant(
        db,
        get_settings(),
        user.id,
        actor_user_id=actor.id,
        expires_in_minutes=payload.expires_in_minutes,
    )
    _record(db, request, actor.id, "PASSWORD_RESET_CREATED", target_user_id=user.id, resource_type="USER", resource_id=str(user.id), metadata={"expires_at": grant.expires_at.isoformat()})
    db.commit()
    base = get_settings().public_web_base_url.rstrip("/")
    return {
        "reset_url": f"{base}/reset-password?token={token}",
        "expires_at": grant.expires_at,
    }


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


@router.post("/users/{user_id}/sessions/revoke")
def revoke_all_user_sessions(user_id: uuid.UUID, request: Request, db: Session = Depends(get_db)) -> dict:
    actor = _admin(request, db)
    user = db.get(User, user_id)
    if user is None or user.role == "ADMIN":
        raise HTTPException(status_code=404, detail="User not found.")
    revoked = revoke_user_sessions(db, user)
    _record(db, request, actor.id, "USER_SESSIONS_REVOKED", target_user_id=user.id,
            resource_type="USER", resource_id=str(user.id), metadata={"revoked_sessions": revoked})
    db.commit()
    return {"id": str(user.id), "revoked_sessions": revoked}


@router.post("/users/{user_id}/approve")
def approve_user(user_id: uuid.UUID, request: Request, db: Session = Depends(get_db)) -> dict:
    return _review_user(user_id, request, db, approved=True)


@router.post("/users/{user_id}/reject")
def reject_user(user_id: uuid.UUID, request: Request, db: Session = Depends(get_db)) -> dict:
    return _review_user(user_id, request, db, approved=False)


def _review_user(user_id: uuid.UUID, request: Request, db: Session, *, approved: bool) -> dict:
    actor = _admin(request, db)
    user = db.get(User, user_id)
    if user is None or user.role == "ADMIN":
        raise HTTPException(status_code=404, detail="User not found.")
    _check_not_deleting(db, user)
    try:
        review_pending_user(db, user, approved=approved, actor_user_id=actor.id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    _record(db, request, actor.id, "USER_APPROVED" if approved else "USER_REJECTED", target_user_id=user.id,
            resource_type="USER", resource_id=str(user.id))
    db.commit()
    return {"id": str(user.id), "status": user.status}


@router.get("/users/{user_id}/deletion-impact")
def user_deletion_impact(user_id: uuid.UUID, request: Request, db: Session = Depends(get_db)) -> dict:
    actor = _admin(request, db)
    user = db.get(User, user_id)
    if user is None or user.role == "ADMIN":
        raise HTTPException(status_code=404, detail="User not found.")
    return {"user_id": str(user.id), **account_deletion_impact(db, user.id)}


@router.post("/users/{user_id}/delete", response_model=BackgroundTaskRead, status_code=status.HTTP_202_ACCEPTED)
def delete_user_account(
    user_id: uuid.UUID,
    payload: DeleteUserRequest,
    request: Request,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key", min_length=1, max_length=160),
    db: Session = Depends(get_db),
) -> BackgroundTaskRead:
    actor = _admin(request, db)
    if payload.confirm_user_id != user_id:
        raise HTTPException(status_code=422, detail="User deletion confirmation does not match the target.")
    try:
        job, _ = queue_user_account_delete(
            db,
            actor_user_id=actor.id,
            target_user_id=user_id,
            idempotency_key=idempotency_key,
        )
        db.commit()
        return background_job_read(job)
    except LookupError as exc:
        db.rollback()
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc


def _record(
    db: Session,
    request: Request,
    actor_user_id: uuid.UUID,
    action: str,
    *,
    target_user_id: uuid.UUID | None = None,
    resource_type: str | None = None,
    resource_id: str | None = None,
    metadata: dict | None = None,
) -> None:
    db.add(AdminAuditLog(
        actor_user_id=actor_user_id,
        action=action,
        target_user_id=target_user_id,
        resource_type=resource_type,
        resource_id=resource_id,
        result="SUCCESS",
        event_metadata=metadata or {},
        request_id=request.headers.get("x-request-id"),
    ))


def _check_not_deleting(db: Session, user: User) -> None:
    try:
        ensure_not_deleting(db, user.id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
