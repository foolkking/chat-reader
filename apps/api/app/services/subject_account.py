"""Transaction fence for legacy subject-key rows without a user foreign key."""

import uuid

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.user import User


def lock_subject_account(db: Session, subject_key: str, *, allow_inactive: bool = False) -> None:
    # AUTH_ENABLED=false retains the pre-account development/test namespace.
    if not get_settings().auth_enabled:
        return
    try:
        user_id = uuid.UUID(subject_key)
    except ValueError:
        raise HTTPException(401, "Account is no longer available.") from None
    # FOR SHARE permits independent writes to different personal resources,
    # but holds off account disable/delete until this transaction finishes.
    user = db.query(User).filter(User.id == user_id).with_for_update(read=True).populate_existing().one_or_none()
    if user is None or (not allow_inactive and not user.can_login):
        raise HTTPException(401, "Account is no longer available.")
