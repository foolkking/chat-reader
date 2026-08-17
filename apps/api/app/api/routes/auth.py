from __future__ import annotations

import logging
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.observability import structured_event
from app.services.auth import (
    PASSWORD_MAX_LENGTH,
    PASSWORD_MIN_LENGTH,
    SESSION_COOKIE_NAME,
    SESSION_PRESENCE_COOKIE_NAME,
    LoginThrottled,
    authenticate_session,
    change_password,
    issue_session,
    revoke_session,
    single_owner_password_provider,
    utc_now,
    validate_new_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])
auth_logger = logging.getLogger("chat_reader.auth")


class LoginInput(BaseModel):
    password: str = Field(min_length=1, max_length=PASSWORD_MAX_LENGTH)


class PasswordChangeInput(BaseModel):
    current_password: str = Field(min_length=1, max_length=PASSWORD_MAX_LENGTH)
    new_password: str = Field(min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_LENGTH)
    confirm_password: str = Field(min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_LENGTH)


class AuthSessionRead(BaseModel):
    authenticated: bool
    principal_id: str | None = None
    inactivity_expires_at: str | None = None
    auth_mode: str = "single_password"


@router.get("/session", response_model=AuthSessionRead)
def read_session(request: Request, response: Response, db: Session = Depends(get_db)) -> AuthSessionRead:
    settings = get_settings()
    if not settings.auth_enabled:
        return AuthSessionRead(authenticated=True, principal_id="owner")
    token = request.cookies.get(SESSION_COOKIE_NAME)
    try:
        # Session polling proves whether the device is still trusted, but it is
        # not user activity. Only authenticated business requests may extend
        # the sliding inactivity window.
        authentication = authenticate_session(db, token, settings, touch=False)
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Authentication service unavailable.") from exc
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    if authentication is None:
        if token:
            _clear_cookie(response)
        return AuthSessionRead(authenticated=False)
    if authentication.touched and token is not None:
        _set_cookie(response, token)
    expires_at = authentication.session.last_activity_at + timedelta(
        seconds=settings.auth_inactivity_timeout_seconds
    )
    return AuthSessionRead(
        authenticated=True,
        principal_id=authentication.context.principal_id,
        inactivity_expires_at=expires_at.isoformat(),
    )


@router.post("/login", response_model=AuthSessionRead)
def login(input: LoginInput, response: Response, db: Session = Depends(get_db)) -> AuthSessionRead:
    settings = get_settings()
    if not settings.auth_enabled:
        raise HTTPException(status_code=404, detail="Not found.")
    try:
        principal = single_owner_password_provider.authenticate(db, input.password)
    except LoginThrottled as exc:
        structured_event(auth_logger, logging.WARNING, "owner_login_throttled")
        raise HTTPException(
            status_code=429,
            detail="Too many attempts. Try again shortly.",
            headers={"Retry-After": str(exc.retry_after_seconds), "Cache-Control": "no-store"},
        ) from exc
    if principal is None:
        structured_event(auth_logger, logging.WARNING, "owner_login_failed")
        raise HTTPException(
            status_code=401,
            detail="Incorrect password.",
            headers={"Cache-Control": "no-store", "Pragma": "no-cache"},
        )
    token, session = issue_session(db, principal, settings)
    _set_cookie(response, token)
    structured_event(auth_logger, logging.INFO, "owner_login_succeeded")
    expires_at = session.last_activity_at + timedelta(seconds=settings.auth_inactivity_timeout_seconds)
    return AuthSessionRead(
        authenticated=True,
        principal_id=principal.id,
        inactivity_expires_at=expires_at.isoformat(),
    )


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, db: Session = Depends(get_db)) -> None:
    settings = get_settings()
    if settings.auth_enabled:
        revoke_session(db, request.cookies.get(SESSION_COOKIE_NAME), settings)
    _clear_cookie(response)
    structured_event(auth_logger, logging.INFO, "owner_logout")


@router.post("/password", status_code=204)
def update_password(
    input: PasswordChangeInput,
    response: Response,
    db: Session = Depends(get_db),
) -> None:
    if input.new_password != input.confirm_password:
        raise HTTPException(status_code=422, detail="New passwords do not match.")
    try:
        validate_new_password(input.new_password)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not change_password(db, input.current_password, input.new_password, now=utc_now()):
        raise HTTPException(status_code=401, detail="Incorrect password.")
    _clear_cookie(response)
    structured_event(auth_logger, logging.INFO, "owner_credential_changed", sessions_invalidated=True)


def _set_cookie(response: Response, token: str) -> None:
    settings = get_settings()
    response.set_cookie(
        SESSION_COOKIE_NAME,
        token,
        max_age=settings.auth_inactivity_timeout_seconds,
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite="lax",
        path="/",
    )
    response.set_cookie(
        SESSION_PRESENCE_COOKIE_NAME,
        "1",
        max_age=settings.auth_inactivity_timeout_seconds,
        httponly=False,
        secure=settings.auth_cookie_secure,
        samesite="lax",
        path="/",
    )
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"


def _clear_cookie(response: Response) -> None:
    settings = get_settings()
    response.delete_cookie(
        SESSION_COOKIE_NAME,
        path="/",
        secure=settings.auth_cookie_secure,
        httponly=True,
        samesite="lax",
    )
    response.delete_cookie(
        SESSION_PRESENCE_COOKIE_NAME,
        path="/",
        secure=settings.auth_cookie_secure,
        samesite="lax",
    )
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
