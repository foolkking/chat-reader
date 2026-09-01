"""Root-admin account deletion queue and transaction-safe execution."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.administration import UserDeletionRequest
from app.models.annotation import AnnotationSyncReceipt
from app.models.attachment import AssetObject, Attachment
from app.models.auth import AuthPrincipal
from app.models.background_job import BackgroundJob
from app.models.conversation import Conversation
from app.models.offline_package_artifact import OfflinePackageArtifact
from app.models.project import Project
from app.models.reading_position import ReadingPosition
from app.models.user import User
from app.models.user_preference import UserPreference
from app.models.user_skill import UserSkill, UserSkillSelection
from app.services.administration import record_admin_audit
from app.services.assets.lifecycle import asset_object_has_live_references
from app.services.auth import ROOT_ADMIN_USER_ID


def account_deletion_impact(db: Session, target_user_id: uuid.UUID) -> dict[str, int]:
    conversation_ids = db.query(Conversation.id).filter(Conversation.owner_user_id == target_user_id)
    return {
        "projects": db.query(Project.id).filter(Project.owner_user_id == target_user_id).count(),
        "conversations": conversation_ids.count(),
        "attachments": db.query(Attachment.id).filter(Attachment.conversation_id.in_(conversation_ids)).count(),
        "background_tasks": db.query(BackgroundJob.id).filter(BackgroundJob.owner_user_id == target_user_id).count(),
        "skills": db.query(UserSkill.id).filter(UserSkill.subject_key == str(target_user_id)).count(),
    }


def queue_user_account_delete(
    db: Session,
    *,
    actor_user_id: uuid.UUID,
    target_user_id: uuid.UUID,
    idempotency_key: str | None,
) -> tuple[BackgroundJob, UserDeletionRequest]:
    if target_user_id == ROOT_ADMIN_USER_ID or target_user_id == actor_user_id:
        raise ValueError("The root administrator cannot be deleted.")
    if db.get(User, target_user_id) is None:
        raise LookupError("User not found.")
    if idempotency_key:
        existing = db.query(BackgroundJob).filter(
            BackgroundJob.job_type == "user_account_delete",
            BackgroundJob.owner_user_id == actor_user_id,
            BackgroundJob.idempotency_key == idempotency_key,
            BackgroundJob.status.in_(("queued", "processing", "cancelling", "committed")),
        ).order_by(BackgroundJob.created_at.desc()).first()
        if existing is not None:
            request = db.query(UserDeletionRequest).filter(UserDeletionRequest.background_job_id == existing.id).one()
            return existing, request
    impact = account_deletion_impact(db, target_user_id)
    job = BackgroundJob(
        owner_user_id=actor_user_id,
        job_type="user_account_delete",
        status="queued",
        phase="queued",
        progress=0,
        processed_items=0,
        total_items=max(impact["conversations"], 1),
        payload={"target_user_id": str(target_user_id)},
        result={},
        idempotency_key=idempotency_key,
    )
    db.add(job)
    db.flush()
    request = UserDeletionRequest(
        target_user_id=target_user_id,
        requested_by_user_id=actor_user_id,
        background_job_id=job.id,
        status="QUEUED",
        impact_summary=impact,
        result_summary={},
    )
    db.add(request)
    db.flush()
    job.payload = {**job.payload, "deletion_request_id": str(request.id)}
    return job, request


def execute_user_account_delete(
    db: Session,
    *,
    job: BackgroundJob,
    target_user_id: uuid.UUID,
    deletion_request_id: uuid.UUID,
) -> tuple[dict[str, object], list[str]]:
    request = db.get(UserDeletionRequest, deletion_request_id)
    if request is None or request.background_job_id != job.id:
        raise RuntimeError("User deletion request is unavailable.")
    request.status = "RUNNING"
    request.started_at = datetime.now(timezone.utc)
    target = db.get(User, target_user_id)
    if target is None:
        result = {"target_user_id": str(target_user_id), "already_deleted": True, "deleted_asset_objects": 0}
        request.status = "COMPLETED"
        request.result_summary = result
        request.completed_at = datetime.now(timezone.utc)
        return result, []
    if target.id == ROOT_ADMIN_USER_ID:
        raise ValueError("The root administrator cannot be deleted.")

    conversation_ids = [row[0] for row in db.query(Conversation.id).filter(Conversation.owner_user_id == target_user_id).all()]
    asset_ids = {
        row[0]
        for row in db.query(Attachment.asset_object_id).filter(
            Attachment.conversation_id.in_(conversation_ids),
            Attachment.asset_object_id.is_not(None),
        ).all()
    } if conversation_ids else set()
    # Load the two primary owner aggregates so ORM cascades also run in the
    # SQLite test/development compatibility mode. PostgreSQL foreign keys are
    # still the final fail-closed authority for every other owned table.
    for conversation in db.query(Conversation).filter(Conversation.owner_user_id == target_user_id).all():
        db.delete(conversation)
    for project in db.query(Project).filter(Project.owner_user_id == target_user_id).all():
        db.delete(project)
    db.flush()
    subject = str(target_user_id)
    db.query(UserSkillSelection).filter(UserSkillSelection.subject_key == subject).delete(synchronize_session=False)
    db.query(UserSkill).filter(UserSkill.subject_key == subject).delete(synchronize_session=False)
    db.query(UserPreference).filter(UserPreference.subject_key == subject).delete(synchronize_session=False)
    db.query(ReadingPosition).filter(ReadingPosition.subject_key == subject).delete(synchronize_session=False)
    db.query(AnnotationSyncReceipt).filter(AnnotationSyncReceipt.subject_key == subject).delete(synchronize_session=False)
    db.query(OfflinePackageArtifact).filter(OfflinePackageArtifact.subject_key == subject).delete(synchronize_session=False)
    principal = db.query(AuthPrincipal).filter(AuthPrincipal.user_id == target_user_id).one_or_none()
    if principal is not None:
        db.delete(principal)
        db.flush()
    db.delete(target)
    db.flush()

    removable_keys: list[str] = []
    removed_assets = 0
    for asset_id in asset_ids:
        if asset_object_has_live_references(db, asset_id):
            continue
        asset = db.get(AssetObject, asset_id)
        if asset is not None:
            removable_keys.append(asset.storage_key)
            db.delete(asset)
            removed_assets += 1
    result = {
        "target_user_id": str(target_user_id),
        "deleted_conversations": len(conversation_ids),
        "deleted_asset_objects": removed_assets,
        "preserved_shared_asset_objects": len(asset_ids) - removed_assets,
    }
    request.status = "COMPLETED"
    request.result_summary = result
    request.completed_at = datetime.now(timezone.utc)
    record_admin_audit(
        db,
        actor_user_id=request.requested_by_user_id,
        action="USER_DELETED",
        target_user_id=target_user_id,
        resource_type="user",
        resource_id=target_user_id,
        metadata={
            "deleted_conversations": len(conversation_ids),
            "deleted_asset_objects": removed_assets,
            "preserved_shared_asset_objects": len(asset_ids) - removed_assets,
        },
    )
    db.flush()
    return result, removable_keys


def mark_user_deletion_failed(db: Session, job_id: uuid.UUID) -> None:
    request = db.query(UserDeletionRequest).filter(UserDeletionRequest.background_job_id == job_id).one_or_none()
    if request is None or request.status in {"COMPLETED", "CANCELLED"}:
        return
    request.status = "FAILED"
    request.result_summary = {"error_code": "DELETION_FAILED"}
    request.completed_at = datetime.now(timezone.utc)
