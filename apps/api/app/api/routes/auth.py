from __future__ import annotations

import logging
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.observability import structured_event
from app.models.user import User
from app.models.auth import AuthSession
from app.services.access import consume_invitation, consume_password_reset, invitation_for_token, registration_mode
from app.services.access import create_password_reset_grant
from app.services.auth_rate_limit import RateLimitExceeded, consume_auth_attempt
from app.services.password_mail import send_password_reset
from app.services.auth import (
    PASSWORD_MAX_LENGTH,
    PASSWORD_MIN_LENGTH,
    SESSION_COOKIE_NAME,
    SESSION_PRESENCE_COOKIE_NAME,
    LoginThrottled,
    authenticate_session,
    change_password,
    describe_user_agent,
    issue_session,
    revoke_session,
    register_user,
    legacy_account_setup_required,
    upgrade_legacy_owner,
    verify_login_for_email,
    utc_now,
    validate_new_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])
auth_logger = logging.getLogger("chat_reader.auth")


class LoginInput(BaseModel):
    email: str | None = Field(default=None, max_length=320)
    password: str = Field(min_length=1, max_length=PASSWORD_MAX_LENGTH)


class RegisterInput(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_LENGTH)
    confirm_password: str = Field(min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_LENGTH)
    display_name: str | None = Field(default=None, max_length=200)
    invitation_token: str | None = Field(default=None, max_length=512)


class PasswordChangeInput(BaseModel):
    current_password: str = Field(min_length=1, max_length=PASSWORD_MAX_LENGTH)
    new_password: str = Field(min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_LENGTH)
    confirm_password: str = Field(min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_LENGTH)


class LegacyUpgradeInput(BaseModel):
    current_password: str = Field(min_length=1, max_length=PASSWORD_MAX_LENGTH)
    email: str = Field(min_length=3, max_length=320)
    display_name: str | None = Field(default=None, max_length=200)


class SetupStatusRead(BaseModel):
    setup_required: bool
    registration_mode: str


class PasswordResetRequestInput(BaseModel):
    email: str = Field(min_length=3, max_length=320)


class PasswordResetInput(BaseModel):
    token: str = Field(min_length=32, max_length=512)
    new_password: str = Field(min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_LENGTH)
    confirm_password: str = Field(min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_LENGTH)


class AuthSessionRead(BaseModel):
    authenticated: bool
    principal_id: str | None = None
    user_id: str | None = None
    inactivity_expires_at: str | None = None
    auth_mode: str = "single_password"
    email: str | None = None
    display_name: str | None = None
    role: str | None = None
    registration_mode: str | None = None
    password_reset_available: bool = False


class DeviceSessionRead(BaseModel):
    id: str
    device_label: str
    created_at: str
    last_activity_at: str
    current: bool


class ProfileUpdateInput(BaseModel):
    display_name: str | None = Field(default=None, max_length=200)


@router.get("/session", response_model=AuthSessionRead)
def read_session(request: Request, response: Response, db: Session = Depends(get_db)) -> AuthSessionRead:
    settings = get_settings()
    if not settings.auth_enabled:
        return AuthSessionRead(authenticated=True, principal_id="owner", auth_mode="single_password")
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
        return AuthSessionRead(
            authenticated=False,
            registration_mode=registration_mode(db, settings),
            password_reset_available=bool(settings.smtp_host and settings.smtp_from_address),
        )
    if authentication.touched and token is not None:
        _set_cookie(response, token)
    expires_at = authentication.session.last_activity_at + timedelta(
        seconds=settings.auth_inactivity_timeout_seconds
    )
    return AuthSessionRead(
        authenticated=True,
        principal_id=authentication.context.principal_id,
        user_id=str(authentication.context.user_id) if authentication.context.user_id else None,
        inactivity_expires_at=expires_at.isoformat(),
        auth_mode="multi_account" if authentication.context.user_id is not None else "single_password",
        email=authentication.session.principal.user.normalized_email if authentication.session.principal.user else None,
        display_name=authentication.session.principal.user.display_name if authentication.session.principal.user else None,
        role=authentication.context.role,
        registration_mode=registration_mode(db, settings),
        password_reset_available=bool(settings.smtp_host and settings.smtp_from_address),
    )


@router.get("/setup/status", response_model=SetupStatusRead)
def setup_status(db: Session = Depends(get_db)) -> SetupStatusRead:
    settings = get_settings()
    return SetupStatusRead(
        setup_required=legacy_account_setup_required(db),
        registration_mode="CLOSED" if legacy_account_setup_required(db) else registration_mode(db, settings),
    )


@router.post("/setup/upgrade", status_code=204)
def setup_upgrade(input: LegacyUpgradeInput, request: Request, response: Response, db: Session = Depends(get_db)) -> None:
    _consume_or_429(db, request, "legacy-setup", input.email, limit=8, window_seconds=900)
    try:
        upgrade_legacy_owner(
            db,
            current_password=input.current_password,
            email=input.email,
            display_name=input.display_name,
        )
        db.commit()
    except PermissionError as exc:
        db.rollback()
        raise HTTPException(status_code=401, detail="Current password is incorrect.") from exc
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    _clear_cookie(response)
    structured_event(auth_logger, logging.INFO, "legacy_account_upgraded", sessions_invalidated=True)


@router.post("/login", response_model=AuthSessionRead)
def login(input: LoginInput, request: Request, response: Response, db: Session = Depends(get_db)) -> AuthSessionRead:
    settings = get_settings()
    if not settings.auth_enabled:
        raise HTTPException(status_code=404, detail="Not found.")
    if legacy_account_setup_required(db):
        raise HTTPException(status_code=409, detail="Administrator account setup is required.")
    if not input.email:
        raise HTTPException(status_code=401, detail="Email or password is incorrect.")
    _consume_or_429(db, request, "login", input.email or "legacy-owner", limit=10, window_seconds=300)
    try:
        principal = verify_login_for_email(db, input.email, input.password)
    except LoginThrottled as exc:
        structured_event(auth_logger, logging.WARNING, "login_throttled")
        raise HTTPException(
            status_code=429,
            detail="Too many attempts. Try again shortly.",
            headers={"Retry-After": str(exc.retry_after_seconds), "Cache-Control": "no-store"},
        ) from exc
    if principal is None:
        structured_event(auth_logger, logging.WARNING, "login_failed")
        raise HTTPException(
            status_code=401,
            detail="Email or password is incorrect.",
            headers={"Cache-Control": "no-store", "Pragma": "no-cache"},
        )
    token, session = issue_session(db, principal, settings, device_label=describe_user_agent(request.headers.get("user-agent")))
    _set_cookie(response, token)
    user = db.get(User, principal.user_id) if principal.user_id else None
    structured_event(auth_logger, logging.INFO, "login_succeeded")
    expires_at = session.last_activity_at + timedelta(seconds=settings.auth_inactivity_timeout_seconds)
    return AuthSessionRead(
        authenticated=True,
        principal_id=principal.id,
        user_id=str(user.id) if user else None,
        inactivity_expires_at=expires_at.isoformat(),
        auth_mode="multi_account" if user is not None else "single_password",
        email=user.normalized_email if user else None,
        display_name=user.display_name if user else None,
        role=user.role if user else "ADMIN",
        registration_mode=registration_mode(db, settings),
        password_reset_available=bool(settings.smtp_host and settings.smtp_from_address),
    )


@router.post("/register", response_model=AuthSessionRead, status_code=201)
def register(input: RegisterInput, request: Request, response: Response, db: Session = Depends(get_db)) -> AuthSessionRead:
    settings = get_settings()
    _consume_or_429(db, request, "register", input.email, limit=5, window_seconds=3600)
    if input.invitation_token:
        _consume_or_429(db, request, "invitation", input.invitation_token, limit=10, window_seconds=900)
    mode = registration_mode(db, settings)
    invitation = None
    if mode == "INVITE_ONLY" and input.invitation_token:
        invitation = invitation_for_token(db, input.invitation_token, settings)
    if legacy_account_setup_required(db) or not settings.auth_enabled or (mode != "OPEN" and invitation is None):
        raise HTTPException(status_code=403, detail="Registration is not open on this instance.")
    if input.password != input.confirm_password:
        raise HTTPException(status_code=422, detail="Passwords do not match.")
    try:
        user, principal = register_user(db, input.email, input.password, display_name=input.display_name)
        if invitation is not None:
            consume_invitation(invitation, user.id)
        token, session = issue_session(db, principal, settings, device_label=describe_user_agent(request.headers.get("user-agent")))
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail="An account with this email already exists.") from exc
    _set_cookie(response, token)
    return AuthSessionRead(
        authenticated=True,
        principal_id=principal.id,
        user_id=str(user.id),
        inactivity_expires_at=(session.last_activity_at + timedelta(seconds=settings.auth_inactivity_timeout_seconds)).isoformat(),
        auth_mode="multi_account",
        email=user.normalized_email,
        display_name=user.display_name,
        role=user.role,
        registration_mode=mode,
        password_reset_available=bool(settings.smtp_host and settings.smtp_from_address),
    )


@router.get("/me", response_model=AuthSessionRead)
def me(request: Request, response: Response, db: Session = Depends(get_db)) -> AuthSessionRead:
    settings = get_settings()
    authentication = authenticate_session(db, request.cookies.get(SESSION_COOKIE_NAME), settings)
    if authentication is None:
        raise HTTPException(status_code=401, detail="Authentication required.")
    user = authentication.session.principal.user
    return AuthSessionRead(
        authenticated=True,
        principal_id=authentication.context.principal_id,
        user_id=str(user.id) if user else None,
        inactivity_expires_at=(authentication.session.last_activity_at + timedelta(seconds=settings.auth_inactivity_timeout_seconds)).isoformat(),
        auth_mode="multi_account" if user else "single_password",
        email=user.normalized_email if user else None,
        display_name=user.display_name if user else None,
        role=authentication.context.role,
        registration_mode=registration_mode(db, settings),
        password_reset_available=bool(settings.smtp_host and settings.smtp_from_address),
    )


@router.patch("/me", response_model=AuthSessionRead)
def update_me(input: ProfileUpdateInput, request: Request, db: Session = Depends(get_db)) -> AuthSessionRead:
    settings = get_settings()
    authentication = authenticate_session(db, request.cookies.get(SESSION_COOKIE_NAME), settings, touch=False)
    if authentication is None or authentication.context.user_id is None:
        raise HTTPException(status_code=401, detail="Authentication required.")
    user = db.get(User, authentication.context.user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required.")
    user.display_name = input.display_name.strip()[:200] if input.display_name and input.display_name.strip() else None
    user.updated_at = utc_now()
    db.commit()
    return AuthSessionRead(
        authenticated=True,
        principal_id=authentication.context.principal_id,
        user_id=str(user.id),
        inactivity_expires_at=(authentication.session.last_activity_at + timedelta(seconds=settings.auth_inactivity_timeout_seconds)).isoformat(),
        auth_mode="multi_account",
        email=user.normalized_email,
        display_name=user.display_name,
        role=user.role,
        registration_mode=registration_mode(db, settings),
        password_reset_available=bool(settings.smtp_host and settings.smtp_from_address),
    )


@router.post("/password-reset/request", status_code=204)
def request_password_reset(input: PasswordResetRequestInput, request: Request, db: Session = Depends(get_db)) -> None:
    settings = get_settings()
    if not settings.smtp_host or not settings.smtp_from_address:
        raise HTTPException(status_code=404, detail="Not found.")
    _consume_or_429(db, request, "password-reset-request", input.email, limit=5, window_seconds=3600)
    normalized = input.email.strip().casefold()
    user = db.query(User).filter(User.normalized_email == normalized, User.status == "ACTIVE").one_or_none()
    if user is not None:
        token, _ = create_password_reset_grant(db, settings, user.id, actor_user_id=None)
        db.commit()
        reset_url = f"{settings.public_web_base_url.rstrip('/')}/reset-password?token={token}"
        try:
            send_password_reset(settings, user.normalized_email or normalized, reset_url)
        except Exception:
            structured_event(auth_logger, logging.ERROR, "password_reset_delivery_failed")
    # The same response is returned whether the account exists or delivery worked.


@router.post("/password-reset", status_code=204)
def reset_password(input: PasswordResetInput, response: Response, db: Session = Depends(get_db)) -> None:
    if input.new_password != input.confirm_password:
        raise HTTPException(status_code=422, detail="Passwords do not match.")
    try:
        consume_password_reset(db, get_settings(), input.token, input.new_password)
        db.commit()
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    _clear_cookie(response)


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, db: Session = Depends(get_db)) -> None:
    settings = get_settings()
    if settings.auth_enabled:
        revoke_session(db, request.cookies.get(SESSION_COOKIE_NAME), settings)
    _clear_cookie(response)
    structured_event(auth_logger, logging.INFO, "logout")


@router.get("/sessions", response_model=list[DeviceSessionRead])
def list_sessions(request: Request, db: Session = Depends(get_db)) -> list[DeviceSessionRead]:
    authentication = authenticate_session(db, request.cookies.get(SESSION_COOKIE_NAME), get_settings(), touch=False)
    if authentication is None:
        raise HTTPException(status_code=401, detail="Authentication required.")
    rows = (
        db.query(AuthSession)
        .filter(
            AuthSession.principal_id == authentication.context.principal_id,
            AuthSession.revoked_at.is_(None),
        )
        .order_by(AuthSession.last_activity_at.desc())
        .all()
    )
    return [
        DeviceSessionRead(
            id=str(row.id),
            device_label=row.device_label,
            created_at=row.created_at.isoformat(),
            last_activity_at=row.last_activity_at.isoformat(),
            current=row.id == authentication.context.session_id,
        )
        for row in rows
    ]


@router.post("/sessions/logout-others", status_code=204)
def logout_other_sessions(request: Request, db: Session = Depends(get_db)) -> None:
    authentication = authenticate_session(db, request.cookies.get(SESSION_COOKIE_NAME), get_settings(), touch=False)
    if authentication is None:
        raise HTTPException(status_code=401, detail="Authentication required.")
    db.query(AuthSession).filter(
        AuthSession.principal_id == authentication.context.principal_id,
        AuthSession.id != authentication.context.session_id,
        AuthSession.revoked_at.is_(None),
    ).update({AuthSession.revoked_at: utc_now()}, synchronize_session=False)
    db.commit()


@router.post("/password", status_code=204)
def update_password(
    input: PasswordChangeInput,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> None:
    if input.new_password != input.confirm_password:
        raise HTTPException(status_code=422, detail="New passwords do not match.")
    try:
        validate_new_password(input.new_password)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    authentication = authenticate_session(db, request.cookies.get(SESSION_COOKIE_NAME), get_settings(), touch=False)
    principal_id = authentication.context.principal_id if authentication is not None else "owner"
    if not change_password(db, input.current_password, input.new_password, principal_id=principal_id, now=utc_now()):
        raise HTTPException(status_code=401, detail="Incorrect password.")
    _clear_cookie(response)
    structured_event(auth_logger, logging.INFO, "credential_changed", sessions_invalidated=True)


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


def _consume_or_429(
    db: Session,
    request: Request,
    scope: str,
    value: str,
    *,
    limit: int,
    window_seconds: int,
) -> None:
    client = request.client.host if request.client else "unknown"
    try:
        consume_auth_attempt(
            db,
            get_settings(),
            scope=scope,
            identity=f"{client}:{value.strip().casefold()}",
            limit=limit,
            window_seconds=window_seconds,
        )
        db.commit()
    except RateLimitExceeded as exc:
        db.commit()
        raise HTTPException(
            status_code=429,
            detail="Too many attempts. Try again later.",
            headers={"Retry-After": str(exc.retry_after_seconds), "Cache-Control": "no-store"},
        ) from exc
