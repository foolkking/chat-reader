"""Bounded Root-only user directory queries; never expose credentials."""
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.models.administration import UserDeletionRequest
from app.models.attachment import AssetObject, Attachment
from app.models.background_job import BackgroundJob
from app.models.conversation import Conversation
from app.models.project import Project
from app.models.user import User


def user_rows(db: Session, rows: list[User]) -> list[dict]:
    ids = [row.id for row in rows]
    if not ids:
        return []
    conversations = dict(db.query(Conversation.owner_user_id, func.count(Conversation.id)).filter(
        Conversation.owner_user_id.in_(ids), Conversation.deleted_at.is_(None),
    ).group_by(Conversation.owner_user_id).all())
    projects = dict(db.query(Project.owner_user_id, func.count(Project.id)).filter(
        Project.owner_user_id.in_(ids),
    ).group_by(Project.owner_user_id).all())
    attachments = {row[0]: (row[1], int(row[2])) for row in db.query(
        Conversation.owner_user_id, func.count(Attachment.id), func.coalesce(func.sum(AssetObject.byte_size), 0),
    ).join(Attachment, Attachment.conversation_id == Conversation.id).outerjoin(
        AssetObject, AssetObject.id == Attachment.asset_object_id,
    ).filter(Conversation.owner_user_id.in_(ids), Conversation.deleted_at.is_(None), Attachment.deleted_at.is_(None)
    ).group_by(Conversation.owner_user_id).all()}
    latest = select(UserDeletionRequest.id, func.row_number().over(
        partition_by=UserDeletionRequest.target_user_id,
        order_by=(UserDeletionRequest.created_at.desc(), UserDeletionRequest.id.desc()),
    ).label("rank")).where(UserDeletionRequest.target_user_id.in_(ids)).subquery()
    deletions = {item.target_user_id: {
        "job_id": str(job.id), "status": job.status, "phase": job.phase,
        "progress": job.progress, "impact": item.impact_summary,
    } for item, job in db.query(UserDeletionRequest, BackgroundJob).join(
        latest, and_(latest.c.id == UserDeletionRequest.id, latest.c.rank == 1),
    ).join(BackgroundJob, BackgroundJob.id == UserDeletionRequest.background_job_id).all()}
    return [{
        "id": str(row.id), "email": row.normalized_email, "display_name": row.display_name,
        "role": row.role, "status": row.status, "can_login": row.can_login,
        "created_at": row.created_at, "last_login_at": row.last_login_at,
        "email_verified_at": row.email_verified_at, "email_verification_required": row.email_verification_required,
        "approval_status": row.approval_status, "approval_reviewed_at": row.approval_reviewed_at,
        "deletion": deletions.get(row.id),
        "stats": {"projects": projects.get(row.id, 0), "conversations": conversations.get(row.id, 0),
                  "attachments": attachments.get(row.id, (0, 0))[0], "attachment_bytes": attachments.get(row.id, (0, 0))[1]},
    } for row in rows]


def users_page(db: Session, *, q: str, state: str, offset: int, limit: int) -> dict:
    query = db.query(User)
    if q.strip():
        # Search literal text: '%' and '_' must not expand the administrator's scope.
        literal = q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        query = query.filter(or_(User.normalized_email.ilike(f"%{literal}%", escape="\\"),
                                 User.display_name.ilike(f"%{literal}%", escape="\\")))
    predicates = {
        "ACTIVE": and_(User.status == "ACTIVE", User.approval_status == "APPROVED",
                       or_(User.email_verification_required.is_(False), User.email_verified_at.is_not(None))),
        "DISABLED": User.status == "DISABLED",
        "PENDING": and_(User.approval_status == "PENDING", User.status != "DISABLED"),
        "UNVERIFIED": and_(User.email_verification_required.is_(True), User.email_verified_at.is_(None),
                           User.approval_status != "REJECTED", User.status != "DISABLED"),
        "REJECTED": User.approval_status == "REJECTED",
    }
    if state in predicates:
        query = query.filter(predicates[state])
    total = query.count()
    rows = query.order_by(User.created_at.desc(), User.id.desc()).offset(offset).limit(limit).all()
    return {"items": user_rows(db, rows), "total": total, "offset": offset, "limit": limit}
