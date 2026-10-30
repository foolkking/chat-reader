import hashlib
import unicodedata
import uuid

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.models.user_feature_entry import UserFeatureEntry
from app.models.conversation import Conversation
from app.schemas.user_feature_entries import (
    ConversationTagValue,
    ExportPresetValue,
    OfflineChecklistValue,
    ReadingListValue,
    SavedSearchValue,
    UserFeatureEntryRead,
)
from app.services.preferences import get_or_create_preferences
from app.services.ownership import OwnershipScope, LEGACY_OWNERSHIP_SCOPE
from app.services.conversation_revision import bump_offline_revision

VALUE_SCHEMAS = {
    "saved-search": SavedSearchValue,
    "export-preset": ExportPresetValue,
    "reading-list": ReadingListValue,
    "offline-checklist": OfflineChecklistValue,
    "conversation-tag": ConversationTagValue,
}
COLLECTION_LIMITS = {
    "saved-search": 20,
    "export-preset": 20,
    "reading-list": 500,
    "offline-checklist": 20,
    "conversation-tag": 100,
}


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
    ownership_scope: OwnershipScope = LEGACY_OWNERSHIP_SCOPE,
) -> UserFeatureEntryRead:
    schema = _ensure_collection(collection)
    parsed = schema.model_validate(value)
    normalized_value = parsed.model_dump(mode="json")
    _lock_entry(db, subject_key, collection, entry_id)
    get_or_create_preferences(db, subject_key)
    if collection == "conversation-tag":
        conversation_ids = set(parsed.conversation_ids)
        if conversation_ids:
            owned_count = db.query(Conversation.id).filter(
                Conversation.id.in_(conversation_ids),
                ownership_scope.predicate(Conversation),
                Conversation.deleted_at.is_(None),
            ).count()
            if owned_count != len(conversation_ids):
                raise UserFeatureEntryConflict("One or more conversations are unavailable.")
        normalized_name = _normalized_tag_name(parsed.name)
        for existing in db.scalars(select(UserFeatureEntry).where(
            UserFeatureEntry.subject_key == subject_key,
            UserFeatureEntry.collection == collection,
            UserFeatureEntry.id != entry_id,
        )):
            try:
                existing_name = ConversationTagValue.model_validate(existing.value).name
            except Exception:
                continue
            if _normalized_tag_name(existing_name) == normalized_name:
                raise UserFeatureEntryConflict("A tag with this name already exists.")
    row = db.scalar(
        select(UserFeatureEntry)
        .where(
            UserFeatureEntry.subject_key == subject_key,
            UserFeatureEntry.collection == collection,
            UserFeatureEntry.id == entry_id,
        )
        .with_for_update()
    )
    previous_value = row.value if row is not None else None
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
    if collection == "conversation-tag" and previous_value != normalized_value:
        _invalidate_tag_packages(db, previous_value, normalized_value, ownership_scope)
    db.flush()
    return entry_read(row)


def delete_entry(
    db: Session,
    subject_key: str,
    collection: str,
    entry_id: uuid.UUID,
    expected_revision: int,
    ownership_scope: OwnershipScope = LEGACY_OWNERSHIP_SCOPE,
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
    if collection == "conversation-tag":
        _invalidate_tag_packages(db, row.value, None, ownership_scope)
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


def _normalized_tag_name(value: str) -> str:
    return unicodedata.normalize("NFKC", value).strip().casefold()


def _invalidate_tag_packages(db: Session, previous: dict | None, current: dict | None, scope: OwnershipScope) -> None:
    ids = {
        uuid.UUID(str(value))
        for tag in (previous, current) if isinstance(tag, dict)
        for value in tag.get("conversation_ids", [])
    }
    if not ids:
        return
    for conversation in db.scalars(select(Conversation).where(
        Conversation.id.in_(ids), scope.predicate(Conversation),
    ).order_by(Conversation.id)):
        bump_offline_revision(conversation)


def _lock_entry(db: Session, subject_key: str, collection: str, entry_id: uuid.UUID) -> None:
    if db.get_bind().dialect.name != "postgresql":
        return
    # Serialize collection membership as well as revisions: two tabs may add
    # the same conversation using different client-generated entry IDs.
    raw = f"user-feature-entry:{subject_key}:{collection}".encode()
    key = int.from_bytes(hashlib.sha256(raw).digest()[:8], "big", signed=True)
    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})
