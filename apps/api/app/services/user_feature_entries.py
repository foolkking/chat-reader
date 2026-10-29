import hashlib
import uuid

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.models.user_feature_entry import UserFeatureEntry
from app.schemas.user_feature_entries import (
    ExportPresetValue,
    OfflineChecklistValue,
    ReadingListValue,
    SavedSearchValue,
    UserFeatureEntryRead,
)
from app.services.preferences import get_or_create_preferences

VALUE_SCHEMAS = {
    "saved-search": SavedSearchValue,
    "export-preset": ExportPresetValue,
    "reading-list": ReadingListValue,
    "offline-checklist": OfflineChecklistValue,
}
COLLECTION_LIMITS = {"saved-search": 20, "export-preset": 20, "reading-list": 500, "offline-checklist": 20}


class UserFeatureEntryConflict(ValueError):
    pass


def list_entries(db: Session, subject_key: str, collection: str) -> list[UserFeatureEntryRead]:
    _ensure_collection(collection)
    get_or_create_preferences(db, subject_key)
    rows = db.scalars(
        select(UserFeatureEntry)
        .where(
            UserFeatureEntry.subject_key == subject_key,
            UserFeatureEntry.collection == collection,
        )
        .order_by(UserFeatureEntry.updated_at.desc(), UserFeatureEntry.id)
    ).all()
    return [entry_read(row) for row in rows]


def write_entry(
    db: Session,
    subject_key: str,
    collection: str,
    entry_id: uuid.UUID,
    expected_revision: int,
    value: dict,
) -> UserFeatureEntryRead:
    schema = _ensure_collection(collection)
    parsed = schema.model_validate(value)
    normalized_value = parsed.model_dump(mode="json")
    _lock_entry(db, subject_key, collection, entry_id)
    get_or_create_preferences(db, subject_key)
    row = db.scalar(
        select(UserFeatureEntry)
        .where(
            UserFeatureEntry.subject_key == subject_key,
            UserFeatureEntry.collection == collection,
            UserFeatureEntry.id == entry_id,
        )
        .with_for_update()
    )
    if row is None:
        if expected_revision != 0:
            raise UserFeatureEntryConflict("The saved entry no longer exists.")
        if db.get(UserFeatureEntry, entry_id) is not None:
            raise UserFeatureEntryConflict("The saved entry identity is unavailable.")
        count = db.scalar(
            select(func.count()).select_from(UserFeatureEntry).where(
                UserFeatureEntry.subject_key == subject_key,
                UserFeatureEntry.collection == collection,
            )
        )
        if count >= COLLECTION_LIMITS[collection]:
            raise UserFeatureEntryConflict("This collection is full. Remove an entry before adding another.")
        row = UserFeatureEntry(
            id=entry_id,
            subject_key=subject_key,
            collection=collection,
            revision=1,
            value=normalized_value,
        )
        db.add(row)
    else:
        if expected_revision != row.revision:
            raise UserFeatureEntryConflict("The saved entry changed. Reload it before saving.")
        row.revision += 1
        row.value = normalized_value
    if collection == "reading-list":
        duplicate = db.scalar(select(UserFeatureEntry.id).where(
            UserFeatureEntry.subject_key == subject_key,
            UserFeatureEntry.collection == collection,
            UserFeatureEntry.id != entry_id,
            UserFeatureEntry.value["conversation_id"].as_string() == str(parsed.conversation_id),
        ).limit(1))
        if duplicate is not None:
            raise UserFeatureEntryConflict("This conversation is already in the reading list. Reload the list.")
    db.flush()
    return entry_read(row)


def delete_entry(
    db: Session,
    subject_key: str,
    collection: str,
    entry_id: uuid.UUID,
    expected_revision: int,
) -> None:
    _ensure_collection(collection)
    _lock_entry(db, subject_key, collection, entry_id)
    get_or_create_preferences(db, subject_key)
    row = db.scalar(
        select(UserFeatureEntry)
        .where(
            UserFeatureEntry.subject_key == subject_key,
            UserFeatureEntry.collection == collection,
            UserFeatureEntry.id == entry_id,
        )
        .with_for_update()
    )
    if row is None:
        raise LookupError("The saved entry no longer exists.")
    if expected_revision != row.revision:
        raise UserFeatureEntryConflict("The saved entry changed. Reload it before deleting.")
    db.delete(row)
    db.flush()


def entry_read(row: UserFeatureEntry) -> UserFeatureEntryRead:
    return UserFeatureEntryRead(
        id=row.id,
        collection=row.collection,
        revision=row.revision,
        value=row.value,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _ensure_collection(collection: str):
    schema = VALUE_SCHEMAS.get(collection)
    if schema is None:
        raise LookupError("Unsupported user feature collection.")
    return schema


def _lock_entry(db: Session, subject_key: str, collection: str, entry_id: uuid.UUID) -> None:
    if db.get_bind().dialect.name != "postgresql":
        return
    # Serialize collection membership as well as revisions: two tabs may add
    # the same conversation using different client-generated entry IDs.
    raw = f"user-feature-entry:{subject_key}:{collection}".encode()
    key = int.from_bytes(hashlib.sha256(raw).digest()[:8], "big", signed=True)
    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})
