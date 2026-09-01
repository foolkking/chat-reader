import hashlib
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models.auth import AuthRateLimit
from app.services.auth import token_digest, utc_now


class RateLimitExceeded(RuntimeError):
    def __init__(self, retry_after_seconds: int):
        super().__init__("Too many attempts.")
        self.retry_after_seconds = max(1, retry_after_seconds)


def consume_auth_attempt(
    db: Session,
    settings: Settings,
    *,
    scope: str,
    identity: str,
    limit: int,
    window_seconds: int,
    now: datetime | None = None,
) -> None:
    now = now or utc_now()
    bounded_identity = hashlib.sha256(identity.encode("utf-8")).hexdigest()
    scope_key = token_digest(f"{scope}:{bounded_identity}", settings)
    row = db.get(AuthRateLimit, scope_key)
    if row is None:
        row = AuthRateLimit(scope_key=scope_key, attempt_count=1, window_started_at=now, updated_at=now)
        db.add(row)
        db.flush()
        return
    started = _utc(row.window_started_at)
    if now - started >= timedelta(seconds=window_seconds):
        row.attempt_count = 1
        row.window_started_at = now
        row.blocked_until = None
        row.updated_at = now
        db.flush()
        return
    if row.blocked_until is not None and _utc(row.blocked_until) > now:
        raise RateLimitExceeded(int((_utc(row.blocked_until) - now).total_seconds()) + 1)
    row.attempt_count += 1
    row.updated_at = now
    if row.attempt_count > limit:
        row.blocked_until = started + timedelta(seconds=window_seconds)
        db.flush()
        raise RateLimitExceeded(int((row.blocked_until - now).total_seconds()) + 1)
    db.flush()


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
