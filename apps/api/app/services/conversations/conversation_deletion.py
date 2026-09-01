"""Canonical conversation deletion shared by synchronous and queued flows."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.attachment import AssetObject, Attachment
from app.models.background_job import BackgroundJob
from app.models.conversation import Conversation
from app.services.assets.asset_store import get_asset_store
from app.services.assets.lifecycle import asset_object_has_live_references
from app.services.ownership import OwnershipScope, get_owned


def delete_conversation_record(
    db: Session,
    conversation_id: uuid.UUID,
    ownership_scope: OwnershipScope | None = None,
) -> None:
    """Delete one conversation as an independent durable unit."""
    conversation = (
        get_owned(db, Conversation, conversation_id, ownership_scope)
        if ownership_scope is not None
        else db.get(Conversation, conversation_id)
    )
    if conversation is None or conversation.deleted_at is not None:
        raise LookupError("Conversation not found.")
    asset_ids = {
        row[0]
        for row in db.query(Attachment.asset_object_id).filter(
            Attachment.conversation_id == conversation.id,
            Attachment.asset_object_id.is_not(None),
        ).all()
    }
    # Derived rebuilds are best-effort work scheduled after edits. Cancel
    # queued work and ask processing work to stop before removing the
    # conversation. Committing this state first lets a worker observe the
    # cancellation at its next progress/publish boundary instead of holding
    # the delete request behind a long rebuild transaction.
    now = datetime.now(timezone.utc)
    pending_rebuilds = (
        db.query(BackgroundJob)
        .filter(
            BackgroundJob.job_type == "conversation_derived_rebuild",
            BackgroundJob.status.in_(("queued", "processing", "cancelling")),
        )
        .all()
    )
    for job in pending_rebuilds:
        if str((job.payload or {}).get("conversation_id")) != str(conversation_id):
            continue
        if job.status == "queued":
            job.status = "cancelled"
            job.phase = "cancelled"
            job.completed_at = now
            job.heartbeat_at = now
            job.error_message = None
        elif job.status == "processing":
            job.status = "cancelling"
            job.phase = "cancelling"
            job.heartbeat_at = now
    # Publish the terminal lifecycle state before doing the potentially
    # expensive cascade.  Rebuild workers use the same row as their guard and
    # can now observe ``deleted`` at their next boundary instead of holding a
    # transaction open while the DELETE waits behind them.  The hard delete is
    # intentionally a second transaction; the endpoint remains idempotent and
    # no user-visible request waits on derived/index cleanup.
    conversation.status = "deleted"
    conversation.deleted_at = now
    db.commit()

    # Start the destructive cascade from a clean transaction so stale ORM
    # state (and locks acquired while cancelling jobs) cannot lengthen the
    # user-facing delete request.
    conversation = (
        get_owned(db, Conversation, conversation_id, ownership_scope)
        if ownership_scope is not None
        else db.get(Conversation, conversation_id)
    )
    if conversation is None:
        return
    db.delete(conversation)
    db.flush()
    removable_keys: list[str] = []
    for asset_id in asset_ids:
        if asset_object_has_live_references(db, asset_id):
            continue
        asset = db.get(AssetObject, asset_id)
        if asset is not None:
            removable_keys.append(asset.storage_key)
            db.delete(asset)
    db.commit()
    for storage_key in removable_keys:
        try:
            get_asset_store().delete_key(storage_key)
        except Exception:
            # Database deletion is authoritative; periodic asset GC removes
            # leftover bytes without failing the user-visible deletion.
            pass
