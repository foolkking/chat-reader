from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import ValidationError
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.core.database import get_db
from app.schemas.user_feature_entries import UserFeatureEntryRead, UserFeatureEntryWrite
from app.services.ownership import subject_key_from_request
from app.services.user_feature_entries import (
    UserFeatureEntryConflict,
    delete_entry,
    list_entries,
    write_entry,
)

router = APIRouter(prefix="/api/user-feature-entries", tags=["user-feature-entries"])


@router.get("/{collection}", response_model=list[UserFeatureEntryRead])
def read_user_feature_entries(
    collection: str,
    request: Request,
    db: Session = Depends(get_db),
) -> list[UserFeatureEntryRead]:
    try:
        result = list_entries(db, subject_key_from_request(request), collection)
        db.commit()
        return result
    except LookupError as error:
        db.rollback()
        raise HTTPException(status_code=404, detail="User feature collection not found.") from error


@router.put("/{collection}/{entry_id}", response_model=UserFeatureEntryRead)
def save_user_feature_entry(
    collection: str,
    entry_id: UUID,
    payload: UserFeatureEntryWrite,
    request: Request,
    db: Session = Depends(get_db),
) -> UserFeatureEntryRead:
    try:
        result = write_entry(
            db,
            subject_key_from_request(request),
            collection,
            entry_id,
            payload.expected_revision,
            payload.value,
        )
        db.commit()
        return result
    except UserFeatureEntryConflict as error:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(error)) from error
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="The saved entry changed. Reload it before saving.") from error
    except LookupError as error:
        db.rollback()
        raise HTTPException(status_code=404, detail="User feature collection not found.") from error
    except ValidationError as error:
        db.rollback()
        raise HTTPException(status_code=422, detail="Saved entry fields are invalid.") from error


@router.delete("/{collection}/{entry_id}", status_code=204)
def remove_user_feature_entry(
    collection: str,
    entry_id: UUID,
    request: Request,
    expected_revision: int = Query(ge=1),
    db: Session = Depends(get_db),
) -> None:
    try:
        delete_entry(
            db,
            subject_key_from_request(request),
            collection,
            entry_id,
            expected_revision,
        )
        db.commit()
    except UserFeatureEntryConflict as error:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(error)) from error
    except LookupError as error:
        db.rollback()
        raise HTTPException(status_code=404, detail="Saved entry not found.") from error
    return None
