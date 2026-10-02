"""Root-admin account deletion queue and transaction-safe execution."""

from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models.administration import UserDeletionRequest
from app.models.annotation import AnnotationSyncReceipt, ConversationAnnotation, ConversationNotebook
from app.models.import_profile import ImportProfileGrant
from app.models.content_cleanup import ContentCleanupRuleGrant
from app.models.attachment import AssetObject, Attachment
from app.models.auth import AuthPrincipal
from app.models.background_job import BackgroundJob
from app.models.conversation import Conversation
from app.models.offline_package_artifact import OfflinePackageArtifact
from app.models.project import Project
from app.models.reading_position import ReadingPosition, ReadingPositionSyncReceipt
from app.models.user import User
from app.models.user_preference import UserPreference, PreferenceSyncReceipt
from app.models.user_skill import UserSkill, UserSkillSelection
from app.services.administration import record_admin_audit
from app.services.assets.lifecycle import asset_object_has_live_references
from app.services.assets.asset_store import get_asset_store
from app.services.auth import ROOT_ADMIN_USER_ID
from app.services.access import disable_user
from app.services.preferences import _lock as lock_preferences


def account_deletion_impact(db: Session, target_user_id: uuid.UUID) -> dict[str, int]:
    conversation_ids = db.query(Conversation.id).filter(Conversation.owner_user_id == target_user_id)
    return {
        "projects": db.query(Project.id).filter(Project.owner_user_id == target_user_id).count(),
        "conversations": conversation_ids.count(),
        "attachments": db.query(Attachment.id).filter(Attachment.conversation_id.in_(conversation_ids)).count(),
        "background_tasks": db.query(BackgroundJob.id).filter(BackgroundJob.owner_user_id == target_user_id).count(),
        "annotations": db.query(ConversationAnnotation.id).filter(ConversationAnnotation.subject_key == str(target_user_id)).count(),
        "notebooks": db.query(ConversationNotebook.id).filter(ConversationNotebook.subject_key == str(target_user_id)).count(),
        "format_grants": db.query(ImportProfileGrant.user_id).filter(ImportProfileGrant.user_id == target_user_id).count(),
        "rule_grants": db.query(ContentCleanupRuleGrant.user_id).filter(ContentCleanupRuleGrant.user_id == target_user_id).count(),
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
    if idempotency_key:
        _lock(db, f"delete-user-key:{actor_user_id}:{idempotency_key}")
        existing = db.query(BackgroundJob).filter(
            BackgroundJob.job_type == "user_account_delete",
            BackgroundJob.owner_user_id == actor_user_id,
            BackgroundJob.idempotency_key == idempotency_key,
        ).order_by(BackgroundJob.created_at.desc()).first()
        if existing is not None:
            if (existing.payload or {}).get("target_user_id") != str(target_user_id):
                raise ValueError("This idempotency key belongs to another account deletion.")
            request = db.query(UserDeletionRequest).filter(UserDeletionRequest.background_job_id == existing.id).one()
            return existing, request
    target = db.query(User).filter(User.id == target_user_id).with_for_update().populate_existing().one_or_none()
    if target is None:
        raise LookupError("User not found.")
    if target.role == "ADMIN":
        raise ValueError("The root administrator cannot be deleted.")
    # Different windows/keys must still refer to the one pending operation.
    pending = db.query(UserDeletionRequest, BackgroundJob).join(
        BackgroundJob, BackgroundJob.id == UserDeletionRequest.background_job_id,
    ).filter(UserDeletionRequest.target_user_id == target_user_id,
             BackgroundJob.status.in_(("queued", "processing", "cancelling", "failed"))).first()
    if pending is not None:
        return pending[1], pending[0]
    # The account stays disabled on failure. No new sessions or jobs may start
    # between confirmation and worker execution; the administrator can retry.
    disable_user(db, target, True)
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
    record_admin_audit(db, actor_user_id=actor_user_id, action="USER_DELETE_QUEUED",
                       target_user_id=target_user_id, resource_type="user", resource_id=target_user_id, metadata=impact)
    return job, request


def execute_user_account_delete(
    db: Session,
    *,
    job: BackgroundJob,
    target_user_id: uuid.UUID,
    deletion_request_id: uuid.UUID,
) -> tuple[dict[str, object], list[str]]:
    request = db.get(UserDeletionRequest, deletion_request_id)
    if request is None or request.background_job_id != job.id or request.target_user_id != target_user_id:
        raise RuntimeError("User deletion request is unavailable.")
    if request.status == "COMPLETED":
        # Retrying storage cleanup never repeats the canonical deletion/audit.
        return dict(request.result_summary), list((job.payload or {}).get("account_cleanup_keys", []))
    request.status = "RUNNING"
    request.started_at = datetime.now(timezone.utc)
    lock_preferences(db, str(target_user_id))
    target = db.query(User).filter(User.id == target_user_id).with_for_update().populate_existing().one_or_none()
    if target is None:
        result = {"target_user_id": str(target_user_id), "already_deleted": True, "deleted_asset_objects": 0}
        request.status = "COMPLETED"
        request.result_summary = result
        request.completed_at = datetime.now(timezone.utc)
        return result, []
    if target.id == ROOT_ADMIN_USER_ID or target.role == "ADMIN" or target.id == request.requested_by_user_id:
        raise ValueError("The root administrator cannot be deleted.")

    conversation_query = db.query(Conversation.id).filter(Conversation.owner_user_id == target_user_id)
    conversation_count = conversation_query.count()
    removable_keys: list[str] = []
    removed_assets = 0
    preserved_assets = 0
    # Remove attachment references in batches before testing object ownership.
    # Row locks also serialize new references against eager orphan deletion.
    while True:
        asset_ids = [row[0] for row in db.query(Attachment.asset_object_id).filter(
            Attachment.conversation_id.in_(conversation_query), Attachment.asset_object_id.is_not(None),
        ).distinct().order_by(Attachment.asset_object_id).limit(100).all()]
        if not asset_ids:
            break
        assets = db.query(AssetObject).filter(AssetObject.id.in_(asset_ids)).order_by(AssetObject.id).with_for_update().all()
        attachments = db.query(Attachment).filter(Attachment.conversation_id.in_(conversation_query),
                                                  Attachment.asset_object_id.in_(asset_ids))
        if db.get_bind().dialect.name == "postgresql":
            attachments.delete(synchronize_session=False)
        else:
            while batch := attachments.limit(100).all():
                for attachment in batch:
                    db.delete(attachment)
                db.flush()
        db.flush()
        for asset in assets:
            if asset_object_has_live_references(db, asset.id):
                preserved_assets += 1
                continue
            removable_keys.append(asset.storage_key)
            db.delete(asset)
            removed_assets += 1
        db.flush()
    if db.get_bind().dialect.name == "postgresql":
        db.query(Conversation).filter(Conversation.owner_user_id == target_user_id).delete(synchronize_session=False)
        db.query(Project).filter(Project.owner_user_id == target_user_id).delete(synchronize_session=False)
    else:
        # Compatibility mode still uses ORM cascades when SQLite FK enforcement
        # is absent. Never load an account's entire conversation collection.
        for model in (Conversation, Project):
            while batch := db.query(model).filter(model.owner_user_id == target_user_id).limit(50).all():
                for row in batch:
                    db.delete(row)
                db.flush()
    db.flush()
    subject = str(target_user_id)
    db.query(UserSkillSelection).filter(UserSkillSelection.subject_key == subject).delete(synchronize_session=False)
    db.query(UserSkill).filter(UserSkill.subject_key == subject).delete(synchronize_session=False)
    db.query(PreferenceSyncReceipt).filter(PreferenceSyncReceipt.subject_key == subject).delete(synchronize_session=False)
    db.query(ReadingPositionSyncReceipt).filter(ReadingPositionSyncReceipt.subject_key == subject).delete(synchronize_session=False)
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

    result = {
        "target_user_id": str(target_user_id),
        "deleted_conversations": conversation_count,
        "deleted_asset_objects": removed_assets,
        "preserved_shared_asset_objects": preserved_assets,
    }
    result.update(account_deleted=True, asset_cleanup_status="pending" if removable_keys else "completed",
                  asset_cleanup_pending=len(removable_keys))
    # Durable before canonical commit. Keys never enter the public task result.
    job.payload = {**job.payload, "account_cleanup_keys": removable_keys}
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
            "deleted_conversations": conversation_count,
            "deleted_asset_objects": removed_assets,
            "preserved_shared_asset_objects": preserved_assets,
        },
    )
    db.flush()
    return result, removable_keys


def mark_user_deletion_failed(db: Session, job_id: uuid.UUID) -> None:
    request = db.query(UserDeletionRequest).filter(UserDeletionRequest.background_job_id == job_id).one_or_none()
    if request is None or request.status in {"COMPLETED", "CANCELLED"}:
        return
    record_admin_audit(db, actor_user_id=request.requested_by_user_id, action="USER_DELETE_FAILED",
                       target_user_id=request.target_user_id, resource_type="user", resource_id=request.target_user_id,
                       result="FAILURE", metadata={"error_code": "DELETION_FAILED"})
    request.status = "FAILED"
    request.result_summary = {"error_code": "DELETION_FAILED"}
    request.completed_at = datetime.now(timezone.utc)


def _lock(db: Session, name: str) -> None:
    if db.get_bind().dialect.name == "postgresql":
        key = int.from_bytes(hashlib.sha256(name.encode()).digest()[:8], "big", signed=True)
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})


def ensure_not_deleting(db: Session, target_user_id: uuid.UUID) -> None:
    db.query(User).filter(User.id == target_user_id).with_for_update().populate_existing().one_or_none()
    if db.query(UserDeletionRequest.id).join(BackgroundJob, BackgroundJob.id == UserDeletionRequest.background_job_id).filter(
        UserDeletionRequest.target_user_id == target_user_id,
        BackgroundJob.status.in_(("queued", "processing", "cancelling", "failed")),
    ).first() is not None:
        raise ValueError("Account deletion is pending. Review or retry its task.")


def mark_user_deletion_queued(db: Session, job: BackgroundJob) -> None:
    request = db.query(UserDeletionRequest).filter(UserDeletionRequest.background_job_id == job.id).one_or_none()
    if request is not None and request.status != "COMPLETED":
        request.status = "QUEUED"
        request.result_summary = {}
        request.started_at = None
        request.completed_at = None


def cleanup_deleted_account_assets(db: Session, job_id: uuid.UUID) -> None:
    """Checkpoint bounded cleanup batches; storage failure cannot undo deletion."""
    job = db.get(BackgroundJob, job_id)
    remaining = list((job.payload or {}).get("account_cleanup_keys", [])) if job else []
    for start in range(0, len(remaining), 100):
        job = db.query(BackgroundJob).filter_by(id=job_id).with_for_update().populate_existing().one()
        request = db.query(UserDeletionRequest).filter_by(background_job_id=job_id).one()
        if job.status != "committed" or request.status != "COMPLETED":
            return
        pending = list((job.payload or {}).get("account_cleanup_keys", []))
        done: set[str] = set()
        for key in remaining[start:start + 100]:
            if key not in pending:
                continue
            try:
                # Preserve keys that an archive restoration now references.
                if db.query(AssetObject.id).filter_by(storage_key=key).first() is None:
                    get_asset_store().delete_key(key)
                done.add(key)
            except Exception:
                # Backend exceptions can contain paths or credentials. Retain
                # only the pending count and a bounded, actionable state.
                continue
        pending = [key for key in pending if key not in done]
        job.payload = {**job.payload, "account_cleanup_keys": pending}
        result = {**request.result_summary, "asset_cleanup_pending": len(pending),
                  "asset_cleanup_status": "pending" if pending else "completed"}
        request.result_summary = result
        job.result = result
        db.commit()
