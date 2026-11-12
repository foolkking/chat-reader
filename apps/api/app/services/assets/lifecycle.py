from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import exists
from sqlalchemy.orm import Session

from app.models.attachment import Attachment, AssetDerivative, AssetObject, AssetObjectLease, MessageVersionAttachment
from app.services.assets.asset_store import get_asset_store
from app.services.worker_maintenance import bound_worker_transaction


@dataclass(frozen=True)
class AssetGcResult:
    candidates: int
    marked_deleted: int
    deleted_files: int


def asset_object_has_live_references(db: Session, asset_object_id: uuid.UUID) -> bool:
    """Check authoritative references before an eager object deletion."""
    now = datetime.now(timezone.utc)
    checks = (
        db.query(Attachment.id).filter(Attachment.asset_object_id == asset_object_id),
        db.query(AssetObjectLease.id).filter(
            AssetObjectLease.asset_object_id == asset_object_id,
            AssetObjectLease.expires_at > now,
        ),
        db.query(AssetDerivative.id).filter(
            (AssetDerivative.source_asset_object_id == asset_object_id)
            | (AssetDerivative.derivative_asset_object_id == asset_object_id)
        ),
    )
    return any(query.first() is not None for query in checks)


def release_import_assets(db: Session, import_id: uuid.UUID) -> list[str]:
    leased_asset_ids = {
        row[0]
        for row in db.query(AssetObjectLease.asset_object_id).filter(
            AssetObjectLease.holder_type == "import",
            AssetObjectLease.holder_id == str(import_id),
        ).all()
    }
    attachments = db.query(Attachment).filter(Attachment.import_id == import_id).with_for_update().all()
    asset_ids = leased_asset_ids | {item.asset_object_id for item in attachments if item.asset_object_id is not None}
    for attachment in attachments:
        has_links = db.query(MessageVersionAttachment.id).filter(
            MessageVersionAttachment.attachment_id == attachment.id
        ).first() is not None
        if not has_links:
            db.delete(attachment)
    db.query(AssetObjectLease).filter(
        AssetObjectLease.holder_type == "import",
        AssetObjectLease.holder_id == str(import_id),
    ).delete(synchronize_session=False)
    db.flush()

    storage_keys: list[str] = []
    for asset_id in asset_ids:
        asset = db.query(AssetObject).filter_by(id=asset_id).with_for_update().one_or_none()
        if asset is None:
            continue
        if asset_object_has_live_references(db, asset.id):
            continue
        asset.status = "deleted"
        asset.deleted_at = datetime.now(timezone.utc)
        storage_keys.append(asset.storage_key)
    db.flush()
    return storage_keys


def garbage_collect_assets(
    db: Session,
    *,
    retention_days: int = 30,
    execute: bool = False,
    limit: int = 100,
) -> AssetGcResult:
    bound_worker_transaction(db)
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=max(1, retention_days))
    linked = exists().where(Attachment.asset_object_id == AssetObject.id)
    leased = exists().where(
        AssetObjectLease.asset_object_id == AssetObject.id,
        AssetObjectLease.expires_at > now,
    )
    derivative_source = exists().where(AssetDerivative.source_asset_object_id == AssetObject.id)
    derivative_object = exists().where(AssetDerivative.derivative_asset_object_id == AssetObject.id)
    candidates = (
        db.query(AssetObject)
        .filter(
            AssetObject.status == "available",
            AssetObject.created_at < cutoff,
            ~linked,
            ~leased,
            ~derivative_source,
            ~derivative_object,
        )
        .order_by(AssetObject.created_at.asc())
        .limit(max(1, min(limit, 100)))
    )
    if execute:
        candidates = candidates.with_for_update(skip_locked=True)
    candidates = candidates.all()
    if not execute:
        return AssetGcResult(candidates=len(candidates), marked_deleted=0, deleted_files=0)

    storage_keys: list[str] = []
    for asset in candidates:
        # Recheck after the row lock. Inserts of FK references wait for this
        # transaction and all binders must still reject non-available assets.
        if asset_object_has_live_references(db, asset.id):
            continue
        asset.status = "deleted"
        asset.deleted_at = now
        storage_keys.append(asset.storage_key)
    db.commit()
    return AssetGcResult(
        candidates=len(candidates),
        marked_deleted=len(storage_keys),
        deleted_files=cleanup_deleted_assets(db, limit=limit),
    )


def cleanup_deleted_assets(db: Session, *, limit=20, should_continue=lambda: True) -> int:
    """Retry only an already-authorized deletion, never infer abandonment by age."""
    bound_worker_transaction(db)
    ids = [row[0] for row in db.query(AssetObject.id).filter(
        AssetObject.status == "deleted", AssetObject.storage_deleted_at.is_(None),
    ).order_by(AssetObject.deleted_at, AssetObject.id).limit(max(1, min(limit, 100)))]
    db.rollback()
    deleted = 0
    store = get_asset_store()
    for asset_id in ids:
        if not should_continue():
            break
        bound_worker_transaction(db)
        asset = db.query(AssetObject).filter_by(id=asset_id).with_for_update(skip_locked=True).one_or_none()
        if asset is None or asset.status != "deleted" or asset.storage_deleted_at is not None:
            db.rollback()
            continue
        if asset_object_has_live_references(db, asset.id):
            db.rollback()
            continue
        try:
            store.delete_key(asset.storage_key)
        except (OSError, ValueError):
            db.rollback()
            continue
        asset.storage_deleted_at = datetime.now(timezone.utc)
        db.commit()
        deleted += 1
    return deleted


def delete_asset_files(storage_keys: list[str]) -> int:
    store = get_asset_store()
    deleted = 0
    for storage_key in storage_keys:
        try:
            store.delete_key(storage_key)
            deleted += 1
        except OSError:
            continue
    return deleted
