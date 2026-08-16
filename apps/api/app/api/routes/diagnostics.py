from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.services.diagnostics import collect_diagnostics

router = APIRouter(tags=["internal"], include_in_schema=False)


@router.get("/api/internal/diagnostics")
def internal_diagnostics(request: Request, response: Response, db: Session = Depends(get_db)) -> dict:
    settings = get_settings()
    client_host = request.client.host if request.client is not None else None
    if not settings.enable_internal_diagnostics or client_host not in {"127.0.0.1", "::1"}:
        raise HTTPException(
            status_code=404,
            detail="Not found.",
            headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
        )
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Robots-Tag"] = "noindex, noarchive"
    return collect_diagnostics(db, settings)
