"""Only the initiating browser's private device code can claim an approved grant."""
from datetime import datetime, timedelta, timezone
import secrets

from fastapi import HTTPException
from sqlalchemy import delete, select, text

from app.core.config import get_settings
from app.models.reader_extension import ExtensionDevice, ExtensionPairing
from app.services import extension_access as access
from app.services.auth_rate_limit import RateLimitExceeded, consume_auth_attempt

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def throttle(db, action, identity, limit):
    key = access.digest(f"pair:{action}:" + identity.encode("utf-8").hex())
    # Serialize the first-insert and every subsequent increment across API processes.
    if db.get_bind().dialect.name == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(:n)"), {"n": int(key[:15], 16)})
    try:
        consume_auth_attempt(db, get_settings(), scope="pair-" + action, identity=key,
                             limit=limit, window_seconds=600)
    except RateLimitExceeded as exc:
        db.commit()
        raise HTTPException(429, "Try again later.", headers={"Retry-After": str(exc.retry_after_seconds)}) from exc
    db.commit()  # Failed guesses and unknown secrets still count.


def start(db, client, device_name):
    now = datetime.now(timezone.utc)
    db.execute(delete(ExtensionPairing).where(ExtensionPairing.expires_at <= now))
    secret = secrets.token_urlsafe(32)
    code = "".join(secrets.choice(ALPHABET) for _ in range(8))
    db.add(ExtensionPairing(secret_hash=access.digest("poll:" + secret), code_hash=access.digest("code:" + code),
                            client=client, device_name=device_name, expires_at=now + timedelta(minutes=10),
                            next_poll=now))
    db.commit()
    return {"code": code[:4] + "-" + code[4:], "device_code": secret, "expires_in": 600, "interval": 5}


def by_code(db, code):
    row = db.scalar(select(ExtensionPairing).where(
        ExtensionPairing.code_hash == access.digest("code:" + code.replace("-", "").upper()),
        ExtensionPairing.expires_at > datetime.now(timezone.utc)).with_for_update())
    if row is None or row.device_id:
        raise HTTPException(404, "Code is unavailable.")
    access.check_client(row.client)
    return row


def approve(db, auth, code):
    # Credential/account changes lock the user before touching dependent rows.
    # Revalidate the authorizing Web session before taking the pairing-row lock.
    access.lock_authorizing_session(db, auth)
    row = by_code(db, code)
    device = access.reserve_device(db, auth, row.client, until=row.expires_at, device_name=row.device_name,
                                   code_hash=row.secret_hash)
    row.device_id = device.id
    db.commit()


def poll(db, client, secret, cancel=False):
    now = datetime.now(timezone.utc)
    row = db.scalar(select(ExtensionPairing).where(
        ExtensionPairing.secret_hash == access.digest("poll:" + secret), ExtensionPairing.client == client,
        ExtensionPairing.expires_at > now).with_for_update())
    if row is None:
        raise HTTPException(410, "Pairing expired or completed.")
    grant = db.get(ExtensionDevice, row.device_id, with_for_update=True) if row.device_id else None
    if cancel:
        db.delete(row)
        if grant:
            db.delete(grant)
        db.commit()
        return {"state": "cancelled"}
    if access.alive(row.next_poll, now):
        raise HTTPException(429, "Poll again later.", headers={"Retry-After": "5"})
    if not grant:
        row.next_poll = now + timedelta(seconds=4)
        db.commit()
        return {"state": "pending"}
    user = access.principal_for(db, grant)
    grant.expires_at = now + timedelta(days=30)
    result = access.rotate_grant(grant, user, now)
    db.delete(row)
    db.commit()
    return result
