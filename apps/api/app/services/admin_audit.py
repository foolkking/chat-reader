"""Bounded audit inspection with literal account filters and historical targets."""

import uuid
from datetime import datetime

from sqlalchemy import or_
from sqlalchemy.orm import Session, aliased

from app.models.administration import AdminAuditLog
from app.models.user import User


def _account_filter(user, id_column, query: str):
    value = query.strip()
    escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    terms = [user.normalized_email.ilike(f"%{escaped}%", escape="\\"), user.display_name.ilike(f"%{escaped}%", escape="\\")]
    try:
        terms.append(id_column == uuid.UUID(value))
    except ValueError:
        pass
    return or_(*terms)


def audit_page(db: Session, *, action: str, actor: str, target: str, result: str,
               created_after: datetime | None, created_before: datetime | None, offset: int, limit: int,
               actor_user_id: uuid.UUID | None = None, target_user_id: uuid.UUID | None = None) -> dict:
    actor_user, target_user = aliased(User), aliased(User)
    query = db.query(AdminAuditLog, actor_user, target_user).outerjoin(actor_user, actor_user.id == AdminAuditLog.actor_user_id).outerjoin(target_user, target_user.id == AdminAuditLog.target_user_id)
    if action:
        query = query.filter(AdminAuditLog.action == action)
    if result != "ALL":
        query = query.filter(AdminAuditLog.result == result)
    if actor.strip():
        query = query.filter(_account_filter(actor_user, AdminAuditLog.actor_user_id, actor))
    if target.strip():
        query = query.filter(_account_filter(target_user, AdminAuditLog.target_user_id, target))
    for value, column in ((actor_user_id, AdminAuditLog.actor_user_id), (target_user_id, AdminAuditLog.target_user_id)):
        if value is not None:
            query = query.filter(column == value)
    if created_after:
        query = query.filter(AdminAuditLog.created_at >= created_after)
    if created_before:
        query = query.filter(AdminAuditLog.created_at <= created_before)
    total = query.count()
    rows = query.order_by(AdminAuditLog.created_at.desc(), AdminAuditLog.id.desc()).offset(offset).limit(limit).all()
    return {"total": total, "offset": offset, "limit": limit, "items": [
        {"id": str(row.id), "action": row.action, "result": row.result, "created_at": row.created_at,
         "actor_user_id": str(row.actor_user_id), "actor_email": by.normalized_email if by else None,
         "actor_name": by.display_name if by else None,
         "target_user_id": str(row.target_user_id) if row.target_user_id else None,
         "target_email": to.normalized_email if to else None, "target_name": to.display_name if to else None,
         "resource_type": row.resource_type, "resource_id": row.resource_id,
         "metadata": row.event_metadata, "request_id": row.request_id}
        for row, by, to in rows
    ]}
