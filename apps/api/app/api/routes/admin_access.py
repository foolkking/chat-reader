from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.models.access import AccountInvitation
from app.models.administration import AdminAuditLog
from app.models.attachment import Attachment, AssetObject
from app.models.conversation import Conversation
from app.models.project import Project
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
from app.services.user_deletion import account_deletion_impact, queue_user_account_delete

router = APIRouter(prefix="/api/admin/access", tags=["admin-access"])


class RegistrationUpdate(BaseModel):
    mode: str = Field(pattern="^(CLOSED|INVITE_ONLY|OPEN)$")
    require_admin_approval: bool = False
    email_verification_enabled: bool = False
    password_reset_enabled: bool = True


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
    row = set_access_settings(
        db,
        mode=payload.mode,
        require_admin_approval=payload.require_admin_approval,
        email_verification_enabled=payload.email_verification_enabled,
        password_reset_enabled=payload.password_reset_enabled,
        actor_user_id=actor.id,
    )
    _record(db, request, actor.id, "REGISTRATION_MODE_CHANGED", resource_type="INSTANCE_ACCESS", resource_id="1", metadata={
        "registration_mode": payload.mode,
        "require_admin_approval": payload.require_admin_approval,
        "email_verification_enabled": payload.email_verification_enabled,
        "password_reset_enabled": payload.password_reset_enabled,
    })
    db.commit()
    return {**access_settings(db, get_settings()), "updated_at": row.updated_at}


@router.get("/users")
def list_users(request: Request, db: Session = Depends(get_db)) -> list[dict]:
    _admin(request, db)
    rows = db.query(User).order_by(User.created_at.asc(), User.id.asc()).all()
    conversation_counts = dict(db.query(Conversation.owner_user_id, func.count(Conversation.id)).filter(
        Conversation.deleted_at.is_(None), Conversation.owner_user_id.is_not(None)
    ).group_by(Conversation.owner_user_id).all())
    project_counts = dict(db.query(Project.owner_user_id, func.count(Project.id)).filter(
        Project.owner_user_id.is_not(None)
    ).group_by(Project.owner_user_id).all())
    attachment_counts = dict(db.query(Conversation.owner_user_id, func.count(Attachment.id)).join(
        Attachment, Attachment.conversation_id == Conversation.id
    ).filter(
        Conversation.deleted_at.is_(None), Attachment.deleted_at.is_(None), Conversation.owner_user_id.is_not(None)
    ).group_by(Conversation.owner_user_id).all())
    attachment_bytes = dict(db.query(Conversation.owner_user_id, func.coalesce(func.sum(AssetObject.byte_size), 0)).join(
        Attachment, Attachment.conversation_id == Conversation.id
    ).outerjoin(AssetObject, AssetObject.id == Attachment.asset_object_id).filter(
        Conversation.deleted_at.is_(None), Attachment.deleted_at.is_(None), Conversation.owner_user_id.is_not(None)
    ).group_by(Conversation.owner_user_id).all())
    return [
        {
            "id": str(row.id),
            "email": row.normalized_email,
            "display_name": row.display_name,
            "role": row.role,
            "status": row.status,
            "created_at": row.created_at,
            "last_login_at": row.last_login_at,
            "email_verified_at": row.email_verified_at,
            "approval_reviewed_at": row.approval_reviewed_at,
            "stats": {
                "projects": project_counts.get(row.id, 0),
                "conversations": conversation_counts.get(row.id, 0),
                "attachments": attachment_counts.get(row.id, 0),
                "attachment_bytes": int(attachment_bytes.get(row.id, 0) or 0),
            },
        }
        for row in rows
    ]


@router.patch("/users/{user_id}/status")
def update_user_status(
    user_id: uuid.UUID,
    payload: UserStatusUpdate,
    request: Request,
    db: Session = Depends(get_db),
) -> dict:
    actor = _admin(request, db)
    user = db.get(User, user_id)
    if user is None or user.id == actor.id:
        raise HTTPException(status_code=404, detail="User not found.")
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
    rows = db.query(AccountInvitation).order_by(AccountInvitation.created_at.desc()).all()
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
    invitation = db.get(AccountInvitation, invitation_id)
    if invitation is None or invitation.used_at is not None:
        raise HTTPException(status_code=404, detail="Invitation not found.")
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
    if user is None or user.id == actor.id:
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
    if user is None or user.id == actor.id:
        raise HTTPException(status_code=404, detail="User not found.")
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
    if user is None or user.id == actor.id:
        raise HTTPException(status_code=404, detail="User not found.")
    return {"user_id": str(user.id), **account_deletion_impact(db, user.id)}


@router.post("/users/{user_id}/delete", response_model=BackgroundTaskRead, status_code=status.HTTP_202_ACCEPTED)
def delete_user_account(
    user_id: uuid.UUID,
    payload: DeleteUserRequest,
    request: Request,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
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
