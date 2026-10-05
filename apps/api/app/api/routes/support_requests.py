"""Station inbox is authoritative; notification delivery is a separate state."""
import uuid
from contextlib import contextmanager

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.user import User
from app.schemas.support_request import LimitOverrideUpdate, RequestCreate, RequestDecision, RequestReply
from app.services import support_requests as service
from app.services.administration import record_admin_audit, request_id_from, require_root_admin

router = APIRouter(tags=["support-requests"])


def _actor(request: Request, db: Session, admin: bool):
    if admin:
        return require_root_admin(request, db)
    identity = getattr(getattr(request.state, "auth", None), "user_id", None)
    actor = db.get(User, identity) if identity else None
    if actor is None or not actor.can_login:
        raise HTTPException(401, detail="Authentication required.")
    return actor


def _key(value: str = Header(alias="Idempotency-Key", min_length=1, max_length=100, pattern=r"^[A-Za-z0-9_.:-]+$")):
    return value


@contextmanager
def _transaction(db):
    try:
        yield
        db.commit()
    except service.SupportError as error:
        db.rollback()
        raise HTTPException(error.status, detail={"code": error.code},
                            headers={"Retry-After": "3600"} if error.status == 429 else None) from None
    except Exception:
        db.rollback()
        raise


def _audit(db, request, actor, action, row=None):
    record_admin_audit(db, actor_user_id=actor.id, action=action,
        target_user_id=row.owner_user_id if row else None,
        resource_type="SUPPORT_REQUEST", resource_id=row.id if row else None,
        metadata={"revision": row.revision} if row else {}, request_id=request_id_from(request))


@router.post("/api/me/requests", status_code=201)
def create(payload: RequestCreate, request: Request, db: Session = Depends(get_db), key: str = Depends(_key)):
    actor = _actor(request, db, False)
    with _transaction(db):
        row = service.create_request(db, actor, payload, key)
        result = service.detail(db, actor, row.id)
    return result


def _register_inbox(prefix: str, admin: bool):
    @router.get(prefix, name=f"{'admin' if admin else 'my'}_requests")
    def listing(request: Request, db: Session = Depends(get_db), status: str | None = None,
                kind: str | None = None, offset: int = Query(default=0, ge=0), limit: int = Query(default=20, ge=1, le=100)):
        actor = _actor(request, db, admin)
        with _transaction(db):
            result = service.list_requests(db, actor, admin=admin, status=status, kind=kind, offset=offset, limit=limit)
            if admin:
                _audit(db, request, actor, "SUPPORT_REQUESTS_LISTED")
        return result

    @router.get(prefix + "/{request_id}", name=f"{'admin' if admin else 'my'}_request_detail")
    def detail(request_id: uuid.UUID, request: Request, db: Session = Depends(get_db),
               offset: int = Query(default=0, ge=0), limit: int = Query(default=40, ge=1, le=100)):
        actor = _actor(request, db, admin)
        with _transaction(db):
            result = service.detail(db, actor, request_id, admin=admin, offset=offset, limit=limit)
            if admin:
                _audit(db, request, actor, "SUPPORT_REQUEST_VIEWED", service.get_request(db, actor, request_id, admin=True))
        return result

    @router.post(prefix + "/{request_id}/messages", name=f"{'admin' if admin else 'my'}_request_reply")
    def reply(request_id: uuid.UUID, payload: RequestReply, request: Request,
              db: Session = Depends(get_db), key: str = Depends(_key)):
        actor = _actor(request, db, admin)
        with _transaction(db):
            row = service.reply_request(db, actor, request_id, payload, key, admin=admin)
            if admin:
                _audit(db, request, actor, "SUPPORT_REQUEST_REPLIED", row)
            result = service.detail(db, actor, row.id, admin=admin)
        return result

    @router.post(prefix + "/{request_id}/decision", name=f"{'admin' if admin else 'my'}_request_decision")
    def decide(request_id: uuid.UUID, payload: RequestDecision, request: Request,
               db: Session = Depends(get_db), key: str = Depends(_key)):
        actor = _actor(request, db, admin)
        with _transaction(db):
            row = service.decide_request(db, actor, request_id, payload, key, admin=admin)
            if admin:
                _audit(db, request, actor, f"SUPPORT_REQUEST_{payload.action}", row)
            result = service.detail(db, actor, row.id, admin=admin)
        return result

    @router.post(prefix + "/{request_id}/messages/{message_id}/retry-mail", name=f"{'admin' if admin else 'my'}_request_retry_mail")
    def retry_mail(request_id: uuid.UUID, message_id: uuid.UUID, request: Request,
                   db: Session = Depends(get_db), key: str = Depends(_key)):
        actor = _actor(request, db, admin)
        with _transaction(db):
            service.retry_mail(db, actor, request_id, message_id, key, admin=admin)
            if admin:
                _audit(db, request, actor, "SUPPORT_NOTIFICATION_RETRIED", service.get_request(db, actor, request_id, admin=True))
            result = service.detail(db, actor, request_id, admin=admin)
        return result


_register_inbox("/api/me/requests", False)
_register_inbox("/api/admin/requests", True)


@router.get("/api/admin/users/{user_id}/limit-overrides")
def limits(user_id: uuid.UUID, request: Request, db: Session = Depends(get_db)):
    actor = _actor(request, db, True)
    user = db.get(User, user_id)
    if user is None or user.role != "USER":
        raise HTTPException(404, detail="Not found.")
    with _transaction(db):
        result = service.override_read(db, user_id)
        record_admin_audit(db, actor_user_id=actor.id, target_user_id=user_id,
                           action="USER_LIMITS_VIEWED", request_id=request_id_from(request))
    return result


@router.put("/api/admin/users/{user_id}/limit-overrides")
def update_limits(user_id: uuid.UUID, payload: LimitOverrideUpdate, request: Request,
                  db: Session = Depends(get_db), key: str = Depends(_key)):
    actor = _actor(request, db, True)
    with _transaction(db):
        result = service.update_override(db, actor, user_id, payload, key)
        record_admin_audit(db, actor_user_id=actor.id, target_user_id=user_id,
            action="USER_LIMITS_CHANGED", metadata={"revision": result["revision"]}, request_id=request_id_from(request))
    return result
