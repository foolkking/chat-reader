from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import exists
from sqlalchemy.orm import Session

from app.models.attachment import Attachment, AssetDerivative, AssetObject, AssetObjectLease, MessageVersionAttachment
from app.services.assets.asset_store import get_asset_store


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
        asset = db.get(AssetObject, asset_id)
        if asset is None:
            continue
        if db.query(Attachment.id).filter(Attachment.asset_object_id == asset.id).first() is not None:
            continue
        if db.query(AssetObjectLease.id).filter(AssetObjectLease.asset_object_id == asset.id).first() is not None:
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
) -> AssetGcResult:
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
            AssetObject.status != "deleted",
            AssetObject.created_at < cutoff,
            ~linked,
            ~leased,
            ~derivative_source,
            ~derivative_object,
        )
        .order_by(AssetObject.created_at.asc())
        .all()
    )
    if not execute:
        return AssetGcResult(candidates=len(candidates), marked_deleted=0, deleted_files=0)

    storage_keys: list[str] = []
    for asset in candidates:
        asset.status = "deleted"
        asset.deleted_at = now
        storage_keys.append(asset.storage_key)
    db.commit()
    return AssetGcResult(
        candidates=len(candidates),
        marked_deleted=len(candidates),
        deleted_files=delete_asset_files(storage_keys),
    )


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
