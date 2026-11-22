"""Private beta public-client pairing. No cookie authentication on the device surface."""
import base64
import hashlib
import hmac
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import select

from app.core.config import get_settings
from app.models.auth import AuthPrincipal
from app.models.reader_extension import ExtensionDevice
from app.models.user import User
from app.services.auth import AuthContext

PREFIX = "/api/extension/v1/"
SCOPES = ["catalog:read", "catalog:organize", "conversation:import", "context:export"]


def digest(value):
    # Rotating the instance's session secret invalidates restored device grants too.
    return hmac.new(get_settings().auth_secret_value().encode(), b"reader-device-v1\0" + value.encode("ascii"),
                    hashlib.sha256).hexdigest()


def pkce(verifier):
    return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest()).rstrip(b"=").decode()


def check_client(client):
    settings = get_settings()
    if not settings.auth_enabled or not settings.auth_secret_value() or client not in settings.reader_extension_ids:
        raise HTTPException(403, "Extension is not registered on this instance.")


def alive(value, now):
    return value.replace(tzinfo=value.tzinfo or timezone.utc) > now


def principal_for(db, grant):
    if grant is None:
        raise HTTPException(401, "Reconnect the extension.")
    check_client(grant.client)
    user = db.get(User, grant.user_id)
    principal = db.scalar(select(AuthPrincipal).where(AuthPrincipal.user_id == grant.user_id))
    if not user or not user.can_login or not principal or principal.credential_version != grant.credential_version:
        raise HTTPException(401, "Reconnect the extension.")
    return user


def issue_code(db, context, client, challenge):
    check_client(client)
    principal = db.get(AuthPrincipal, context.principal_id)
    if not principal or not principal.user_id or principal.user_id != context.user_id:
        raise HTTPException(403, "An active Reader account is required.")
    now = datetime.now(timezone.utc)
    code = secrets.token_urlsafe(32)
    db.query(ExtensionDevice).filter(ExtensionDevice.user_id == principal.user_id,
                                      ExtensionDevice.expires_at <= now).delete(synchronize_session=False)
    if db.query(ExtensionDevice).filter_by(user_id=principal.user_id).count() >= 32:
        raise HTTPException(409, "Disconnect an older browser first.")
    db.add(ExtensionDevice(user_id=principal.user_id, client=client, credential_version=principal.credential_version,
                           challenge=challenge, code_hash=digest(code), created_at=now,
                           access_until=now + timedelta(minutes=2), expires_at=now + timedelta(minutes=2)))
    db.commit()
    return code


def exchange(db, client, *, code=None, verifier=None, refresh=None):
    check_client(client)
    now = datetime.now(timezone.utc)
    query = select(ExtensionDevice).where(ExtensionDevice.client == client)
    query = query.where(ExtensionDevice.code_hash == digest(code)) if code else query.where(ExtensionDevice.refresh_hash == digest(refresh))
    grant = db.scalar(query.with_for_update())
    user = principal_for(db, grant)
    if not alive(grant.expires_at, now) or (code and not hmac.compare_digest(grant.challenge or "", pkce(verifier))):
        raise HTTPException(401, "Expired or invalid authorization.")
    if code:
        grant.expires_at = now + timedelta(days=30)
    grant.code_hash = grant.challenge = None
    access, refresh = secrets.token_urlsafe(32), secrets.token_urlsafe(48)
    grant.access_hash, grant.refresh_hash = digest(access), digest(refresh)
    grant.access_until = now + timedelta(minutes=10)
    result = dict(access_token=access, refresh_token=refresh, expires_in=600, device_id=grant.id,
                  user_id=user.id, account=user.display_name or user.normalized_email or "Reader", scopes=SCOPES)
    db.commit()
    return result


def authenticate_device(db, authorization, origin):
    import re
    match = re.fullmatch(r"Bearer ([A-Za-z0-9_-]{43})", authorization or "")
    if not match:
        raise HTTPException(401, "Extension authorization required.")
    grant = db.scalar(select(ExtensionDevice).where(ExtensionDevice.access_hash == digest(match[1])))
    user = principal_for(db, grant)
    now = datetime.now(timezone.utc)
    if not alive(grant.access_until, now) or not alive(grant.expires_at, now):
        raise HTTPException(401, "Extension authorization expired.")
    if origin is not None and origin != "chrome-extension://" + grant.client:
        raise HTTPException(403, "Origin not registered.")
    return AuthContext(principal_id="extension", session_id=grant.id, user_id=user.id, role="USER")
