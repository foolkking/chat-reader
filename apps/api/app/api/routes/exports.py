import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.export import ExportOptions
from app.services.exporting.export_service import ExportError
from app.services.exporting.prepared_export import prepare_direct_export
from app.services.export_download import PreparedExportResponse
from app.models.conversation import Conversation
from app.services.ownership import get_owned, ownership_scope_from_request

router = APIRouter(prefix="/api/conversations", tags=["exports"])


@router.get("/{conversation_id}/exports/markdown")
def export_markdown_v2(
    conversation_id: uuid.UUID,
    request: Request,
    include_metadata: bool = True,
    include_versions: bool = False,
    include_description: bool = False,
    toc_mode: str = Query(default="none", pattern="^(none|message_index|bounded_headings)$"),
    include_annotations: bool = False,
    include_notebook: bool = False,
    message_ids: str | None = None,
    db: Session = Depends(get_db),
) -> StreamingResponse:
    try:
        _require_owner(db, conversation_id, request)
        options = ExportOptions(
            format="markdown_v2",
            message_ids=_parse_message_ids(message_ids),
            include_metadata=include_metadata,
            include_versions=include_versions,
            include_description=include_description,
            include_toc=toc_mode != "none",
            include_annotations=include_annotations,
            include_notebook=include_notebook,
            toc_mode=toc_mode,
        )
        return direct_export_response(db, conversation_id, options)
    except ExportError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("/{conversation_id}/exports/canjson")
def export_canjson_v2(
    conversation_id: uuid.UUID,
    request: Request,
    include_metadata: bool = True,
    include_versions: bool = False,
    include_description: bool = False,
    include_annotations: bool = False,
    include_notebook: bool = False,
    include_source_refs: bool = True,
    compression: str = Query(default="none", pattern="^(none|gzip)$"),
    message_ids: str | None = None,
    db: Session = Depends(get_db),
) -> StreamingResponse:
    try:
        _require_owner(db, conversation_id, request)
        options = ExportOptions(
            format="canjson_v2",
            message_ids=_parse_message_ids(message_ids),
            include_metadata=include_metadata,
            include_versions=include_versions,
            include_description=include_description,
            include_annotations=include_annotations,
            include_notebook=include_notebook,
            include_source_refs=include_source_refs,
            compression=compression,
        )
        return direct_export_response(db, conversation_id, options)
    except ExportError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("/{conversation_id}/export")
def export_conversation(
    conversation_id: uuid.UUID,
    request: Request,
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
        _require_owner(db, conversation_id, request)
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
        return direct_export_response(db, conversation_id, options)
    except ExportError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


def _parse_message_ids(raw: str | None) -> list[uuid.UUID]:
    if not raw:
        return []
    try:
        parsed = [uuid.UUID(part.strip()) for part in raw.split(",") if part.strip()]
    except ValueError as exc:
        raise ExportError("message_ids must be comma-separated UUIDs.") from exc
    if len(parsed) > 100_000:
        raise ExportError("message_ids cannot contain more than 100,000 entries.")
    if len(parsed) != len(set(parsed)):
        raise ExportError("message_ids cannot contain duplicates.")
    return parsed


def _require_owner(db: Session, conversation_id: uuid.UUID, request: Request) -> None:
    if get_owned(db, Conversation, conversation_id, ownership_scope_from_request(request)) is None:
        raise HTTPException(status_code=404, detail="Conversation not found.")


def direct_export_response(db: Session, conversation_id: uuid.UUID, options: ExportOptions) -> StreamingResponse:
    # Ownership was checked above without writes. Release that read transaction
    # before opening the snapshot, so concurrent downloads need only one pool slot.
    db.rollback()
    result = prepare_direct_export(db, conversation_id, options)
    try:
        db.commit()
        return PreparedExportResponse(result)
    except BaseException:
        result.content.close()
        db.rollback()
        raise
