from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.preferences import UserPreferenceRead, UserPreferenceUpdate
from app.services.preferences import get_or_create_preferences, preference_read, update_preferences
from app.services.ownership import subject_key_from_request

router = APIRouter(tags=["preferences"])


@router.get("/api/preferences", response_model=UserPreferenceRead)
def get_preferences(request: Request, db: Session = Depends(get_db)) -> UserPreferenceRead:
    preference = get_or_create_preferences(db, subject_key_from_request(request))
    db.commit()
    return preference_read(preference)


@router.patch("/api/preferences", response_model=UserPreferenceRead)
def patch_preferences(
    payload: UserPreferenceUpdate,
    request: Request,
    db: Session = Depends(get_db),
) -> UserPreferenceRead:
    preference = update_preferences(db, payload, subject_key_from_request(request))
    db.commit()
    return preference_read(preference)
