"""Canonical conversation deletion shared by synchronous and queued flows."""

from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from app.models.attachment import AssetObject, Attachment
from app.models.conversation import Conversation
from app.services.assets.asset_store import get_asset_store
from app.services.assets.lifecycle import asset_object_has_live_references


def delete_conversation_record(db: Session, conversation_id: uuid.UUID) -> None:
    """Delete one conversation as an independent durable unit."""
    conversation = db.get(Conversation, conversation_id)
    if conversation is None or conversation.deleted_at is not None:
        raise LookupError("Conversation not found.")
    asset_ids = {
        row[0]
        for row in db.query(Attachment.asset_object_id).filter(
            Attachment.conversation_id == conversation.id,
            Attachment.asset_object_id.is_not(None),
        ).all()
    }
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
