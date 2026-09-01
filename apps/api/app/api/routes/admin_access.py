from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.models.access import AccountInvitation
from app.models.user import User
from app.services.access import (
    create_invitation,
    create_password_reset_grant,
    disable_user,
    registration_mode,
    set_registration_mode,
)

router = APIRouter(prefix="/api/admin/access", tags=["admin-access"])


class RegistrationUpdate(BaseModel):
    mode: str = Field(pattern="^(CLOSED|INVITE_ONLY|OPEN)$")


class InvitationCreate(BaseModel):
    expires_in_hours: int = Field(default=168, ge=1, le=2160)


class UserStatusUpdate(BaseModel):
    status: str = Field(pattern="^(ACTIVE|DISABLED)$")


class ResetGrantCreate(BaseModel):
    expires_in_minutes: int = Field(default=30, ge=5, le=120)


def _admin(request: Request, db: Session) -> User:
    context = getattr(request.state, "auth", None)
    user_id = getattr(context, "user_id", None)
    user = db.get(User, user_id) if user_id else None
    if user is None or user.status != "ACTIVE" or user.role != "ADMIN":
        raise HTTPException(status_code=404, detail="Not found.")
    return user


@router.get("")
def get_access_overview(request: Request, db: Session = Depends(get_db)) -> dict:
    _admin(request, db)
    settings = get_settings()
    return {
        "registration_mode": registration_mode(db, settings),
        "smtp_configured": bool(settings.smtp_host and settings.smtp_from_address),
    }


@router.put("/registration")
def update_registration(payload: RegistrationUpdate, request: Request, db: Session = Depends(get_db)) -> dict:
    actor = _admin(request, db)
    row = set_registration_mode(db, payload.mode, actor.id)
    db.commit()
    return {"registration_mode": row.registration_mode, "updated_at": row.updated_at}


@router.get("/users")
def list_users(request: Request, db: Session = Depends(get_db)) -> list[dict]:
    _admin(request, db)
    rows = db.query(User).order_by(User.created_at.asc(), User.id.asc()).all()
    return [
        {
            "id": str(row.id),
            "email": row.normalized_email,
            "display_name": row.display_name,
            "role": row.role,
            "status": row.status,
            "created_at": row.created_at,
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
    db.commit()
    return {"id": str(user.id), "status": user.status}


@router.post("/invitations", status_code=status.HTTP_201_CREATED)
def issue_invitation(payload: InvitationCreate, request: Request, db: Session = Depends(get_db)) -> dict:
    actor = _admin(request, db)
    token, invitation = create_invitation(
        db, get_settings(), actor.id, expires_in_hours=payload.expires_in_hours
    )
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
    _admin(request, db)
    invitation = db.get(AccountInvitation, invitation_id)
    if invitation is None or invitation.used_at is not None:
        raise HTTPException(status_code=404, detail="Invitation not found.")
    invitation.revoked_at = datetime.now(timezone.utc)
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
    db.commit()
    base = get_settings().public_web_base_url.rstrip("/")
    return {
        "reset_url": f"{base}/reset-password?token={token}",
        "expires_at": grant.expires_at,
    }


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
