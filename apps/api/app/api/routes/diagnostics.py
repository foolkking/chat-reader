from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.services.diagnostics import collect_diagnostics

router = APIRouter(tags=["internal"], include_in_schema=False)


@router.get("/api/internal/diagnostics")
def internal_diagnostics(db: Session = Depends(get_db)) -> dict:
    settings = get_settings()
    if not settings.enable_internal_diagnostics:
        raise HTTPException(status_code=404, detail="Not found.")
    return collect_diagnostics(db, settings)
