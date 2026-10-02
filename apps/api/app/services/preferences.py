import hashlib
import json

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models.import_record import utc_now
from app.models.user_preference import PreferenceSyncReceipt, UserPreference
from app.schemas.preferences import PreferenceSyncRequest, PreferenceSyncResponse, UserPreferenceRead, UserPreferenceUpdate
from app.services.subject_account import lock_subject_account

DEFAULT_SUBJECT_KEY = "local:default"
PREFERENCE_FIELDS = tuple(UserPreferenceUpdate.model_fields)


class PreferenceSyncError(ValueError):
    pass


def _lock(db: Session, subject_key: str) -> None:
    if db.get_bind().dialect.name == "postgresql":
        key = int.from_bytes(hashlib.sha256(f"user-preferences:{subject_key}".encode()).digest()[:8], "big", signed=True)
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})


def get_or_create_preferences(db: Session, subject_key: str = DEFAULT_SUBJECT_KEY, *, allow_inactive: bool = False) -> UserPreference:
    _lock(db, subject_key)
    lock_subject_account(db, subject_key, allow_inactive=allow_inactive)
    preference = db.scalar(select(UserPreference).where(UserPreference.subject_key == subject_key).execution_options(populate_existing=True))
    if preference is None:
        preference = UserPreference(subject_key=subject_key)
        db.add(preference)
        db.flush()
    return preference


def _apply(preference: UserPreference, values: dict) -> None:
    revisions = dict(preference.field_revisions or {})
    for key, value in values.items():
        if getattr(preference, key) != value:
            setattr(preference, key, value)
            revisions[key] = revisions.get(key, 1) + 1
    preference.field_revisions = revisions
    preference.updated_at = utc_now()


def update_preferences(db: Session, payload: UserPreferenceUpdate, subject_key: str = DEFAULT_SUBJECT_KEY, *, allow_inactive: bool = False) -> UserPreference:
    preference = get_or_create_preferences(db, subject_key, allow_inactive=allow_inactive)
    _apply(preference, payload.model_dump(exclude_none=True, exclude_unset=True))
    db.flush()
    return preference


def preference_read(preference: UserPreference) -> UserPreferenceRead:
    return UserPreferenceRead(**{key: getattr(preference, key) for key in PREFERENCE_FIELDS},
        field_revisions={key: (preference.field_revisions or {}).get(key, 1) for key in PREFERENCE_FIELDS},
        created_at=preference.created_at, updated_at=preference.updated_at)


def sync_preferences(db: Session, payload: PreferenceSyncRequest, subject_key: str) -> PreferenceSyncResponse:
    preference = get_or_create_preferences(db, subject_key)
    digest = hashlib.sha256(json.dumps(payload.model_dump(mode="json"), sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    receipt = db.get(PreferenceSyncReceipt, (subject_key, payload.operation_id))
    if receipt:
        if receipt.request_hash != digest:
            raise PreferenceSyncError("This sync operation was already used for different changes.")
        return PreferenceSyncResponse.model_validate(receipt.response)
    values = payload.changes.model_dump(exclude_none=True, exclude_unset=True)
    revisions = preference.field_revisions or {}
    conflicts = [key for key, value in values.items() if payload.base_revisions[key] != revisions.get(key, 1) and value != getattr(preference, key)]
    applied = {key: value for key, value in values.items() if key not in conflicts}
    _apply(preference, applied)
    db.flush()
    result = PreferenceSyncResponse(operation_id=payload.operation_id, preferences=preference_read(preference), applied=list(applied), conflicts=conflicts)
    db.add(PreferenceSyncReceipt(subject_key=subject_key, operation_id=payload.operation_id, request_hash=digest, response=result.model_dump(mode="json")))
    db.flush()
    return result
