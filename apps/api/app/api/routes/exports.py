import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.export import ExportOptions
from app.services.exporting.export_service import (
    ExportError,
    export_conversation_canonical_json,
    export_conversation_markdown,
)

router = APIRouter(prefix="/api/conversations", tags=["exports"])


@router.get("/{conversation_id}/export")
def export_conversation(
    conversation_id: uuid.UUID,
    format: str = Query(default="markdown"),
    include_metadata: bool = True,
    include_toc: bool = True,
    include_versions: bool = False,
    include_description: bool = False,
    include_annotations: bool = False,
    include_notebook: bool = False,
    message_ids: str | None = None,
    db: Session = Depends(get_db),
) -> Response:
    try:
        if format not in {"markdown", "canonical_json"}:
            raise ExportError("Unsupported export format.")
        options = ExportOptions(
            format=format,
            message_ids=_parse_message_ids(message_ids),
            include_metadata=include_metadata,
            include_toc=include_toc,
            include_versions=include_versions,
            include_description=include_description,
            include_annotations=include_annotations,
            include_notebook=include_notebook,
        )
        if format == "markdown":
            result = export_conversation_markdown(db, conversation_id, options)
        else:
            result = export_conversation_canonical_json(db, conversation_id, options)
        db.commit()
        return Response(
            content=result.content,
            media_type=result.media_type,
            headers={"Content-Disposition": f'attachment; filename="{result.filename}"'},
        )
    except ExportError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


def _parse_message_ids(raw: str | None) -> list[uuid.UUID]:
    if not raw:
        return []
    try:
        return [uuid.UUID(part.strip()) for part in raw.split(",") if part.strip()]
    except ValueError as exc:
        raise ExportError("message_ids must be comma-separated UUIDs.") from exc
