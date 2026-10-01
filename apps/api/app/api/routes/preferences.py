from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.preferences import PreferenceSyncRequest, PreferenceSyncResponse, UserPreferenceRead, UserPreferenceUpdate
from app.services.preferences import PreferenceSyncError, get_or_create_preferences, preference_read, sync_preferences, update_preferences
from app.services.ownership import subject_key_from_request

router = APIRouter(tags=["preferences"])


@router.post("/api/preferences/sync", response_model=PreferenceSyncResponse)
def sync_preference_fields(payload: PreferenceSyncRequest, request: Request, db: Session = Depends(get_db)) -> PreferenceSyncResponse:
    try:
        result = sync_preferences(db, payload, subject_key_from_request(request))
        db.commit()
        return result
    except PreferenceSyncError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


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
