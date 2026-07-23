from sqlalchemy.orm import Session

from app.models.import_record import utc_now
from app.models.user_preference import UserPreference
from app.schemas.preferences import UserPreferenceRead, UserPreferenceUpdate

DEFAULT_SUBJECT_KEY = "local:default"


def get_or_create_preferences(db: Session) -> UserPreference:
    preference = db.get(UserPreference, DEFAULT_SUBJECT_KEY)
    if preference is not None:
        return preference
    now = utc_now()
    preference = UserPreference(
        subject_key=DEFAULT_SUBJECT_KEY,
        theme_mode="light",
        locale_mode="auto",
        reader_width_mode="standard",
        section_toc_mode="visible",
        conversation_sort_mode="recent_read",
        conversation_sort_direction="desc",
        project_sort_mode="recent_read",
        project_sort_direction="desc",
        created_at=now,
        updated_at=now,
    )
    db.add(preference)
    db.flush()
    return preference


def update_preferences(db: Session, payload: UserPreferenceUpdate) -> UserPreference:
    preference = get_or_create_preferences(db)
    if payload.theme_mode is not None:
        preference.theme_mode = payload.theme_mode
    if payload.locale_mode is not None:
        preference.locale_mode = payload.locale_mode
    if payload.reader_width_mode is not None:
        preference.reader_width_mode = payload.reader_width_mode
    if payload.section_toc_mode is not None:
        preference.section_toc_mode = payload.section_toc_mode
    if payload.conversation_sort_mode is not None:
        preference.conversation_sort_mode = payload.conversation_sort_mode
    if payload.conversation_sort_direction is not None:
        preference.conversation_sort_direction = payload.conversation_sort_direction
    if payload.project_sort_mode is not None:
        preference.project_sort_mode = payload.project_sort_mode
    if payload.project_sort_direction is not None:
        preference.project_sort_direction = payload.project_sort_direction
    preference.updated_at = utc_now()
    db.flush()
    return preference


def preference_read(preference: UserPreference) -> UserPreferenceRead:
    return UserPreferenceRead(
        theme_mode=preference.theme_mode,
        locale_mode=preference.locale_mode,
        reader_width_mode=preference.reader_width_mode,
        section_toc_mode=preference.section_toc_mode,
        conversation_sort_mode=preference.conversation_sort_mode,
        conversation_sort_direction=preference.conversation_sort_direction,
        project_sort_mode=preference.project_sort_mode,
        project_sort_direction=preference.project_sort_direction,
        created_at=preference.created_at,
        updated_at=preference.updated_at,
    )
