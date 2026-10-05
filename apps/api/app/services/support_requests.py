"""Owner-scoped requests; approvals commit with their effective limit changes."""
from __future__ import annotations

import hashlib
import json
import uuid
from datetime import timedelta

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.import_record import utc_now
from app.models.support_request import SupportMessage, SupportRequest, UserLimitOverride
from app.models.user import User
from app.schemas.support_request import LimitOverrideUpdate, RequestCreate, RequestDecision, RequestReply
from app.services.feature_policies import effective_limits, limit_bounds
from app.services.subject_account import lock_subject_account

ACTIVE = {"OPEN", "WAITING"}
KINDS = {"LIMIT", "QUESTION", "ISSUE"}
STATUSES = {*ACTIVE, "APPROVED", "REJECTED", "RESOLVED", "WITHDRAWN", "IMPORTED"}


class SupportError(ValueError):
    def __init__(self, code: str, status: int = 422):
        self.code, self.status = code, status
        super().__init__(code)


def _digest(value) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode()).hexdigest()


def _lock(db: Session, owner: uuid.UUID, *, allow_inactive=False):
    lock_subject_account(db, str(owner), allow_inactive=allow_inactive)
    if db.get_bind().dialect.name == "postgresql":
        key = int.from_bytes(hashlib.sha256(f"support-requests:{owner}".encode()).digest()[:8], "big", signed=True)
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})


def mail_available(db: Session) -> bool:
    from app.services.auth import ROOT_ADMIN_USER_ID, normalize_email
    settings = get_settings()
    root = db.get(User, ROOT_ADMIN_USER_ID)
    try:
        return bool(settings.smtp_host and settings.smtp_from_address and root and root.can_login
                    and normalize_email(root.normalized_email or ""))
    except ValueError:
        return False


def _rate_limit(db: Session, actor: User):
    if actor.role == "ADMIN":
        return
    count = db.scalar(select(func.count()).select_from(SupportMessage).where(
        SupportMessage.author_user_id == actor.id, SupportMessage.created_at >= utc_now() - timedelta(hours=1)))
    if count >= 30:
        raise SupportError("REQUEST_RATE_LIMIT", 429)


def _notify(db: Session, request: SupportRequest, message: SupportMessage, requested: bool):
    from app.models.background_job import BackgroundJob
    if not requested or (message.author_role == "ADMIN" and not request.notify_replies):
        return
    if not mail_available(db):
        message.mail_state = "UNAVAILABLE"
        return
    job = BackgroundJob(id=uuid.uuid4(), owner_user_id=request.owner_user_id, job_type="support_notification",
        payload={"request_id": str(request.id), "message_id": str(message.id)}, total_items=1,
        idempotency_key=f"support-mail:{message.id}:{message.notification_attempts}")
    db.add(job)
    db.flush()
    message.mail_state = "QUEUED"
    message.notification_job_id = job.id


def retry_mail(db, actor, request_id, message_id, key, *, admin=False):
    from app.models.background_job import BackgroundJob
    row = get_request(db, actor, request_id, admin=admin, lock=True)
    message = db.get(SupportMessage, message_id, populate_existing=True)
    if message is None or message.request_id != row.id or message.author_user_id != actor.id:
        raise SupportError("MESSAGE_NOT_FOUND", 404)
    receipt_key = f"support-mail-retry:{message.id}:{key}"
    previous = db.scalar(select(BackgroundJob).where(BackgroundJob.owner_user_id == row.owner_user_id,
        BackgroundJob.job_type == "support_notification", BackgroundJob.idempotency_key == receipt_key))
    if previous:
        return
    if row.status == "IMPORTED" or message.mail_state not in {"FAILED", "UNAVAILABLE"}:
        raise SupportError("MAIL_RETRY_NOT_ALLOWED", 409)
    if message.notification_attempts >= 3:
        raise SupportError("MAIL_RETRY_LIMIT", 429)
    if not mail_available(db):
        raise SupportError("MAIL_UNAVAILABLE", 503)
    _notify(db, row, message, True)
    job = db.get(BackgroundJob, message.notification_job_id)
    if job is None:
        raise SupportError("MAIL_RETRY_NOT_ALLOWED", 409)
    job.idempotency_key = receipt_key
    db.flush()


def _message(db: Session, request: SupportRequest, actor: User, *, key: str, digest: str, operation: str, body: str, notify: bool):
    message = SupportMessage(id=uuid.uuid4(), request_id=request.id, author_user_id=actor.id,
        author_role=actor.role, operation=operation, body=body, operation_key=key, operation_digest=digest)
    db.add(message)
    db.flush()
    _notify(db, request, message, notify)
    return message


def create_request(db: Session, actor: User, payload: RequestCreate, key: str) -> SupportRequest:
    if actor.role != "USER":
        raise SupportError("ADMIN_USES_REQUEST_INBOX", 403)
    _lock(db, actor.id)
    digest = _digest(payload.model_dump())
    previous = db.scalar(select(SupportRequest).where(SupportRequest.owner_user_id == actor.id, SupportRequest.creation_key == key))
    if previous:
        if previous.creation_digest != digest:
            raise SupportError("IDEMPOTENCY_CONFLICT", 409)
        return previous
    _rate_limit(db, actor)
    if db.scalar(select(func.count()).select_from(SupportRequest).where(SupportRequest.owner_user_id == actor.id, SupportRequest.status.in_(ACTIVE))) >= 10:
        raise SupportError("TOO_MANY_OPEN_REQUESTS", 409)
    limits = payload.limits.model_dump(exclude_none=True)
    if payload.kind == "LIMIT":
        pending = db.scalar(select(SupportRequest.id).where(SupportRequest.owner_user_id == actor.id, SupportRequest.kind == "LIMIT", SupportRequest.status.in_(ACTIVE)))
        if pending:
            raise SupportError("LIMIT_REQUEST_ALREADY_OPEN", 409)
        current = effective_limits(db, actor.id)
        if any(value <= current[name] for name, value in limits.items()):
            raise SupportError("REQUEST_MUST_INCREASE_LIMIT")
        if any(value > limit_bounds()[name] for name, value in limits.items()):
            raise SupportError("LIMIT_EXCEEDS_DEPLOYMENT")
    row = SupportRequest(id=uuid.uuid4(), owner_user_id=actor.id, kind=payload.kind, title=payload.title,
        requested_limits=limits, notify_replies=payload.notify_replies, creation_key=key, creation_digest=digest)
    db.add(row)
    db.flush()
    _message(db, row, actor, key="create", digest=digest, operation="CREATE", body=payload.body, notify=payload.notify_admin)
    return row


def get_request(db: Session, actor: User, request_id: uuid.UUID, *, admin: bool = False, lock: bool = False):
    if admin:
        _require_admin(actor)
    query = select(SupportRequest).where(SupportRequest.id == request_id)
    if not admin:
        query = query.where(SupportRequest.owner_user_id == actor.id)
    row = db.scalar(query)
    if row is None:
        raise SupportError("REQUEST_NOT_FOUND", 404)
    if lock:
        _lock(db, row.owner_user_id, allow_inactive=admin)
        row = db.scalar(query.with_for_update().execution_options(populate_existing=True))
        if row is None:
            raise SupportError("REQUEST_NOT_FOUND", 404)
    return row


def _prior_operation(db, row, actor, key, payload, operation):
    digest = _digest({"actor": str(actor.id), "operation": operation, "payload": payload.model_dump()})
    previous = db.scalar(select(SupportMessage).where(SupportMessage.request_id == row.id, SupportMessage.operation_key == key))
    if previous:
        if previous.operation_digest != digest:
            raise SupportError("IDEMPOTENCY_CONFLICT", 409)
        return digest, previous
    if row.revision != payload.base_revision:
        raise SupportError("REQUEST_CHANGED", 409)
    if row.status not in ACTIVE:
        raise SupportError("REQUEST_CLOSED", 409)
    _rate_limit(db, actor)
    return digest, None


def reply_request(db: Session, actor: User, request_id: uuid.UUID, payload: RequestReply, key: str, *, admin=False):
    row = get_request(db, actor, request_id, admin=admin, lock=True)
    digest, previous = _prior_operation(db, row, actor, key, payload, "REPLY")
    if previous:
        return row
    _message(db, row, actor, key=key, digest=digest, operation="REPLY", body=payload.body, notify=payload.notify)
    row.status = "WAITING" if admin else "OPEN"
    row.revision += 1
    row.updated_at = utc_now()
    db.flush()
    return row


def override_read(db, user_id):
    row = db.get(UserLimitOverride, user_id)
    return {"revision": row.revision if row else 0,
            "approved": {"import_size_mb": row.import_size_mb, "merge_message_count": row.merge_message_count} if row else {},
            "effective": effective_limits(db, user_id), "hard_bounds": limit_bounds()}


def _apply_limits(db, actor, owner, limits, *, replace=False):
    bounds = limit_bounds()
    if any(value is not None and value > bounds[name] for name, value in limits.items()):
        raise SupportError("LIMIT_EXCEEDS_DEPLOYMENT")
    row = db.get(UserLimitOverride, owner, populate_existing=True)
    if row is None:
        row = UserLimitOverride(user_id=owner, revision=1)
        db.add(row)
    else:
        row.revision += 1
    for name, value in limits.items():
        setattr(row, name, value if replace else max(value, getattr(row, name) or 0))
    row.updated_by_user_id = actor.id
    row.updated_at = utc_now()
    db.flush()
    return row


def decide_request(db: Session, actor: User, request_id: uuid.UUID, payload: RequestDecision, key: str, *, admin=False):
    row = get_request(db, actor, request_id, admin=admin, lock=True)
    action = payload.action
    if not admin and action != "WITHDRAW":
        raise SupportError("DECISION_NOT_ALLOWED", 403)
    if admin and action == "WITHDRAW":
        raise SupportError("DECISION_NOT_ALLOWED", 403)
    digest, previous = _prior_operation(db, row, actor, key, payload, action)
    if previous:
        return row
    limits = payload.limits.model_dump(exclude_none=True)
    if action == "APPROVE":
        if row.kind != "LIMIT" or not limits or set(limits) != set(row.requested_limits):
            raise SupportError("APPROVAL_LIMITS_REQUIRED")
        if any(value > row.requested_limits[name] for name, value in limits.items()):
            raise SupportError("APPROVAL_EXCEEDS_REQUEST")
        applied = _apply_limits(db, actor, row.owner_user_id, limits)
        applied.change_reason = payload.body
        row.approved_limits = limits
    elif limits:
        raise SupportError("LIMITS_REQUIRE_APPROVAL")
    if action == "RESOLVE" and row.kind == "LIMIT":
        raise SupportError("LIMIT_REQUIRES_DECISION")
    row.status = {"APPROVE": "APPROVED", "REJECT": "REJECTED", "RESOLVE": "RESOLVED", "REQUEST_INFO": "WAITING", "WITHDRAW": "WITHDRAWN"}[action]
    _message(db, row, actor, key=key, digest=digest, operation=action, body=payload.body, notify=payload.notify)
    row.revision += 1
    row.updated_at = utc_now()
    db.flush()
    return row


def update_override(db, actor, user_id, payload: LimitOverrideUpdate, key: str):
    _require_admin(actor)
    _lock(db, user_id, allow_inactive=True)
    user = db.get(User, user_id, populate_existing=True)
    if user is None or user.role != "USER":
        raise SupportError("USER_NOT_FOUND", 404)
    current = override_read(db, user_id)
    digest = _digest({"actor": str(actor.id), "payload": payload.model_dump()})
    existing = db.get(UserLimitOverride, user_id)
    if existing and existing.last_operation_key == key:
        if existing.last_operation_digest != digest:
            raise SupportError("IDEMPOTENCY_CONFLICT", 409)
        return current
    if current["revision"] != payload.base_revision:
        raise SupportError("LIMIT_CHANGED", 409)
    values = payload.limits.model_dump()
    changed = _apply_limits(db, actor, user_id, values, replace=True)
    changed.last_operation_key, changed.last_operation_digest = key, digest
    changed.change_reason = payload.reason
    db.flush()
    return override_read(db, user_id)


def _require_admin(actor):
    from app.services.auth import ROOT_ADMIN_USER_ID
    if actor.id != ROOT_ADMIN_USER_ID or actor.role != "ADMIN" or not actor.can_login:
        raise SupportError("REQUEST_NOT_FOUND", 404)


def request_payload(row):
    return {name: getattr(row, name) for name in ("id", "kind", "title", "status", "revision", "requested_limits", "approved_limits", "notify_replies", "created_at", "updated_at")}


def detail(db, actor, request_id, *, admin=False, offset=0, limit=40):
    row = get_request(db, actor, request_id, admin=admin)
    messages = select(SupportMessage).where(SupportMessage.request_id == row.id)
    total = db.scalar(select(func.count()).select_from(messages.subquery()))
    result = {**request_payload(row), "limits": override_read(db, row.owner_user_id), "mail_available": mail_available(db),
              "messages": [{**{name: getattr(m, name) for name in ("id", "author_role", "operation", "body", "mail_state", "notification_attempts", "created_at")},
                            "can_retry_mail": m.author_user_id == actor.id and m.mail_state in {"FAILED", "UNAVAILABLE"} and m.notification_attempts < 3 and row.status != "IMPORTED"}
                           for m in db.scalars(messages.order_by(SupportMessage.created_at, SupportMessage.id).offset(offset).limit(limit))],
              "message_total": total, "message_offset": offset}
    if admin:
        owner = db.get(User, row.owner_user_id)
        result["owner"] = {"id": row.owner_user_id, "name": owner.display_name, "email": owner.normalized_email}
    return result


def list_requests(db, actor, *, admin=False, status=None, kind=None, offset=0, limit=20):
    if admin:
        _require_admin(actor)
    query = select(SupportRequest)
    if not admin:
        query = query.where(SupportRequest.owner_user_id == actor.id)
    if status:
        if status not in STATUSES:
            raise SupportError("INVALID_REQUEST_STATUS")
        query = query.where(SupportRequest.status == status)
    if kind:
        if kind not in KINDS:
            raise SupportError("INVALID_REQUEST_KIND")
        query = query.where(SupportRequest.kind == kind)
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    rows = db.scalars(query.order_by(SupportRequest.updated_at.desc(), SupportRequest.id.desc()).offset(offset).limit(limit))
    return {"items": [request_payload(row) for row in rows], "total": total, "offset": offset, "limit": limit}
