import hashlib
import re
import uuid
from collections.abc import Iterator
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, Request, Response, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.attachment import (
    AssetDerivative,
    AssetObject,
    Attachment,
    AttachmentUploadItem,
    MessageVersionAttachment,
)
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.schemas.attachment import (
    AttachmentFinalizeRequest,
    AttachmentBatchDownloadRequest,
    AttachmentListRead,
    AttachmentOccurrenceLocationRead,
    AttachmentRead,
    AttachmentUpdateRequest,
    AttachmentUploadItemRead,
    AttachmentUploadSessionCreate,
    AttachmentUploadSessionRead,
    AttachmentTextSearchMatch,
    AttachmentTextSearchRead,
)
from app.schemas.task import BackgroundTaskRead
from app.api.routes.tasks import background_job_read
from app.services.background_jobs import queue_attachment_derivative, queue_attachment_download
from app.services.exporting.attachment_download import AttachmentDownloadError
from app.services.assets.attachment_service import (
    AttachmentAccessError,
    attachment_content,
    attachment_read,
    get_owner_attachment,
    get_share_attachment,
)
from app.services.assets.asset_store import get_asset_store
from app.services.assets.text_search import AttachmentTextSearchError, search_text_file
from app.services.assets.upload_service import (
    AttachmentUploadError,
    add_upload_item,
    create_upload_session,
    delete_upload_item,
    finalize_upload_items,
    get_upload_session,
    remove_unreferenced_attachment,
)
from app.services.sharing.share_service import ShareError, resolve_accessible_share

router = APIRouter(tags=["attachments"])
_ACTIVE_MIME_TYPES = {"image/svg+xml", "text/html", "application/xhtml+xml", "application/xml", "text/xml"}
_INLINE_MIME_TYPES = {
    "application/json",
    "application/pdf",
    "image/avif",
    "image/gif",
    "image/jpeg",
    "image/png",
    "image/webp",
    "text/csv",
    "text/markdown",
    "text/plain",
}


@router.post(
    "/api/conversations/{conversation_id}/attachment-upload-sessions",
    response_model=AttachmentUploadSessionRead,
    status_code=status.HTTP_201_CREATED,
)
def create_attachment_upload_session(
    conversation_id: uuid.UUID,
    payload: AttachmentUploadSessionCreate,
    db: Session = Depends(get_db),
) -> AttachmentUploadSessionRead:
    try:
        session = create_upload_session(
            db,
            conversation_id=conversation_id,
            target_message_id=payload.target_message_id,
            base_message_version_id=payload.base_message_version_id,
        )
        db.commit()
        return _upload_session_read(session)
    except AttachmentUploadError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.post(
    "/api/attachment-upload-sessions/{session_id}/items",
    response_model=AttachmentUploadItemRead,
    status_code=status.HTTP_201_CREATED,
)
def upload_attachment_item(
    session_id: uuid.UUID,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> AttachmentUploadItemRead:
    try:
        item = add_upload_item(
            db,
            session_id=session_id,
            filename=file.filename or "attachment.bin",
            declared_mime_type=file.content_type,
            source=file.file,
        )
        db.commit()
        return _upload_item_read(item)
    except AttachmentUploadError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get(
    "/api/attachment-upload-sessions/{session_id}",
    response_model=AttachmentUploadSessionRead,
)
def read_attachment_upload_session(
    session_id: uuid.UUID,
    db: Session = Depends(get_db),
) -> AttachmentUploadSessionRead:
    try:
        session = get_upload_session(db, session_id)
        db.commit()
        return _upload_session_read(session)
    except AttachmentUploadError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.delete(
    "/api/attachment-upload-sessions/{session_id}/items/{item_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def remove_attachment_upload_item(
    session_id: uuid.UUID,
    item_id: uuid.UUID,
    db: Session = Depends(get_db),
) -> Response:
    try:
        delete_upload_item(db, session_id=session_id, item_id=item_id)
        db.commit()
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except AttachmentUploadError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.post(
    "/api/conversations/{conversation_id}/attachments",
    response_model=AttachmentListRead,
    status_code=status.HTTP_201_CREATED,
)
def create_conversation_attachments(
    conversation_id: uuid.UUID,
    payload: AttachmentFinalizeRequest,
    db: Session = Depends(get_db),
) -> AttachmentListRead:
    promoted: list[str] = []
    try:
        result = finalize_upload_items(
            db,
            conversation_id=conversation_id,
            item_ids=payload.upload_item_ids,
        )
        promoted = result.promoted_storage_keys
        db.commit()
        return AttachmentListRead(items=[attachment_read(item) for item in result.attachments])
    except AttachmentUploadError as exc:
        db.rollback()
        for storage_key in promoted:
            get_asset_store().delete_key(storage_key)
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except Exception:
        db.rollback()
        for storage_key in promoted:
            get_asset_store().delete_key(storage_key)
        raise


@router.post(
    "/api/conversations/{conversation_id}/attachment-downloads",
    response_model=BackgroundTaskRead,
    status_code=status.HTTP_202_ACCEPTED,
)
def create_attachment_download(
    conversation_id: uuid.UUID,
    payload: AttachmentBatchDownloadRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
) -> BackgroundTaskRead:
    normalized = sorted(str(value) for value in payload.attachment_ids)
    selection_hash = hashlib.sha256((str(conversation_id) + ":" + ",".join(normalized)).encode("utf-8")).hexdigest()
    try:
        job = queue_attachment_download(
            db,
            conversation_id=conversation_id,
            attachment_ids=payload.attachment_ids,
            idempotency_key=idempotency_key or f"attachment-download:{selection_hash}",
        )
        db.commit()
        return background_job_read(job)
    except AttachmentDownloadError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("/api/conversations/{conversation_id}/attachments", response_model=AttachmentListRead)
def list_conversation_attachments(
    conversation_id: uuid.UUID,
    db: Session = Depends(get_db),
) -> AttachmentListRead:
    attachments = db.query(Attachment).filter(
        Attachment.conversation_id == conversation_id,
        Attachment.deleted_at.is_(None),
        Attachment.status != "detached",
    ).order_by(Attachment.created_at.asc(), Attachment.id.asc()).all()
    attachment_ids = [attachment.id for attachment in attachments]
    occurrence_rows = (
        db.query(
            MessageVersionAttachment,
            Message.id,
            Message.current_version_id,
            Message.order_key,
            Message.role,
            MessageVersion.version_number,
            func.substr(MessageVersion.plain_text, 1, 160),
        )
        .join(MessageVersion, MessageVersion.id == MessageVersionAttachment.message_version_id)
        .join(Message, Message.id == MessageVersion.message_id)
        .filter(MessageVersionAttachment.attachment_id.in_(attachment_ids))
        .all()
        if attachment_ids
        else []
    )
    rows_by_attachment: dict[uuid.UUID, list] = {attachment_id: [] for attachment_id in attachment_ids}
    for row in occurrence_rows:
        rows_by_attachment.setdefault(row[0].attachment_id, []).append(row)
    items: list[AttachmentRead] = []
    for attachment in attachments:
        rows = rows_by_attachment.get(attachment.id, [])
        message_ids = {row[1] for row in rows}
        occurrences = [
            AttachmentOccurrenceLocationRead(
                message_id=row[1],
                message_version_id=row[0].message_version_id,
                is_current_version=row[0].message_version_id == row[2],
                message_order_key=row[3],
                message_role=row[4],
                version_number=row[5],
                message_preview=row[6],
                occurrence_key=row[0].occurrence_key,
                placement=row[0].placement,
                block_index=row[0].block_index,
            )
            for row in rows
        ]
        items.append(
            attachment_read(attachment).model_copy(
                update={
                    "occurrence_count": len(rows),
                    "message_count": len(message_ids),
                    "is_used": any(row[0].message_version_id == row[2] for row in rows),
                    "occurrences": occurrences,
                }
            )
        )
    return AttachmentListRead(items=items)


@router.patch("/api/conversations/{conversation_id}/attachments/{attachment_id}", response_model=AttachmentRead)
def update_conversation_attachment(
    conversation_id: uuid.UUID,
    attachment_id: uuid.UUID,
    payload: AttachmentUpdateRequest,
    db: Session = Depends(get_db),
) -> AttachmentRead:
    attachment = db.get(Attachment, attachment_id)
    if attachment is None or attachment.conversation_id != conversation_id or attachment.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Attachment not found.")
    display_name = Path(payload.display_name).name.strip()[:500]
    if not display_name:
        raise HTTPException(status_code=422, detail="Attachment display name is required.")
    attachment.display_name = display_name
    db.commit()
    return attachment_read(attachment)


@router.delete(
    "/api/conversations/{conversation_id}/attachments/{attachment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_conversation_attachment(
    conversation_id: uuid.UUID,
    attachment_id: uuid.UUID,
    db: Session = Depends(get_db),
) -> Response:
    attachment = db.get(Attachment, attachment_id)
    if attachment is None or attachment.conversation_id != conversation_id or attachment.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Attachment not found.")
    try:
        storage_key = remove_unreferenced_attachment(db, attachment)
        db.commit()
        if storage_key:
            get_asset_store().delete_key(storage_key)
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except AttachmentUploadError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.post("/api/attachments/{attachment_id}/derivatives/{derivative_type}", response_model=BackgroundTaskRead, status_code=status.HTTP_202_ACCEPTED)
def queue_attachment_derivative_route(
    attachment_id: uuid.UUID,
    derivative_type: str,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
) -> BackgroundTaskRead:
    if derivative_type not in {"text_extract", "image_thumbnail", "image_preview"}:
        raise HTTPException(status_code=422, detail="Unsupported attachment derivative type.")
    try:
        get_owner_attachment(db, attachment_id)
        job = queue_attachment_derivative(
            db,
            attachment_id=attachment_id,
            derivative_type=derivative_type,
            idempotency_key=idempotency_key or f"attachment-derivative:{attachment_id}:{derivative_type}",
        )
        db.commit()
        return background_job_read(job)
    except AttachmentAccessError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get(
    "/api/attachments/{attachment_id}/derivatives/{derivative_type}/content",
    operation_id="get_attachment_derivative_content",
)
@router.head(
    "/api/attachments/{attachment_id}/derivatives/{derivative_type}/content",
    operation_id="head_attachment_derivative_content",
)
def get_attachment_derivative_content(
    attachment_id: uuid.UUID,
    derivative_type: str,
    request: Request,
    disposition: str = Query(default="inline", pattern="^(inline|attachment)$"),
    range_header: str | None = Header(default=None, alias="Range"),
    db: Session = Depends(get_db),
) -> Response:
    try:
        attachment = get_owner_attachment(db, attachment_id)
        derivative = db.query(AssetDerivative).join(
            AssetObject,
            AssetObject.id == AssetDerivative.source_asset_object_id,
        ).filter(
            AssetDerivative.derivative_type == derivative_type,
            AssetDerivative.status == "ready",
            AssetObject.id == attachment.asset_object_id,
        ).order_by(AssetDerivative.created_at.desc()).first()
        if derivative is None:
            raise AttachmentAccessError("Attachment derivative not found.")
        asset = db.get(AssetObject, derivative.derivative_asset_object_id)
        if asset is None or asset.status != "available":
            raise AttachmentAccessError("Attachment derivative is unavailable.", 423)
        try:
            path = get_asset_store().resolve_key(asset.storage_key)
        except (ValueError, FileNotFoundError):
            raise AttachmentAccessError("Attachment derivative is missing.")
        suffix = ".txt" if derivative_type == "text_extract" else ".png"
        return _content_response(path, asset.detected_mime_type, f"{attachment.display_name}.{derivative_type}{suffix}", request.method, disposition, range_header)
    except AttachmentAccessError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("/api/attachments/{attachment_id}", response_model=AttachmentRead)
def get_attachment_metadata(attachment_id: uuid.UUID, db: Session = Depends(get_db)) -> AttachmentRead:
    try:
        return attachment_read(get_owner_attachment(db, attachment_id))
    except AttachmentAccessError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("/api/attachments/{attachment_id}/text/search", response_model=AttachmentTextSearchRead)
def search_attachment_text(
    attachment_id: uuid.UUID,
    q: str = Query(min_length=1, max_length=256),
    limit: int = Query(default=50, ge=1, le=200),
    cursor: str | None = Query(default=None, max_length=4096),
    db: Session = Depends(get_db),
) -> AttachmentTextSearchRead:
    try:
        content = attachment_content(get_owner_attachment(db, attachment_id))
        page = search_text_file(
            attachment_id=str(attachment_id),
            sha256=content.asset_object.sha256,
            byte_size=content.asset_object.byte_size,
            path=content.path,
            query=q,
            limit=limit,
            cursor=cursor,
        )
        return AttachmentTextSearchRead(
            matches=[AttachmentTextSearchMatch(byte_offset=item.byte_offset, preview=item.preview) for item in page.matches],
            scanned_bytes=page.scanned_bytes,
            complete=page.complete,
            nextCursor=page.next_cursor,
        )
    except AttachmentTextSearchError as exc:
        status_code = 409 if exc.code == "cursor_stale" else 422
        raise HTTPException(status_code=status_code, detail={"code": exc.code, "message": str(exc)}) from exc
    except AttachmentAccessError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("/api/attachments/{attachment_id}/content", operation_id="get_attachment_content")
@router.head("/api/attachments/{attachment_id}/content", operation_id="head_attachment_content")
def get_attachment_content(
    attachment_id: uuid.UUID,
    request: Request,
    disposition: str = Query(default="inline", pattern="^(inline|attachment)$"),
    range_header: str | None = Header(default=None, alias="Range"),
    db: Session = Depends(get_db),
) -> Response:
    try:
        content = attachment_content(get_owner_attachment(db, attachment_id))
        return _content_response(content.path, content.asset_object.detected_mime_type, content.attachment.display_name, request.method, disposition, range_header)
    except AttachmentAccessError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get(
    "/api/shared/{token}/attachments/{attachment_id}/content",
    operation_id="get_shared_attachment_content",
)
@router.head(
    "/api/shared/{token}/attachments/{attachment_id}/content",
    operation_id="head_shared_attachment_content",
)
def get_shared_attachment_content(
    token: str,
    attachment_id: uuid.UUID,
    request: Request,
    disposition: str = Query(default="inline", pattern="^(inline|attachment)$"),
    range_header: str | None = Header(default=None, alias="Range"),
    db: Session = Depends(get_db),
) -> Response:
    try:
        share = resolve_accessible_share(db, token)
        content = attachment_content(get_share_attachment(db, share, attachment_id))
        return _content_response(content.path, content.asset_object.detected_mime_type, content.attachment.display_name, request.method, disposition, range_header, cache_control="private, no-store")
    except (AttachmentAccessError, ShareError) as exc:
        raise HTTPException(status_code=getattr(exc, "status_code", 404), detail=str(exc)) from exc


@router.get("/api/shared/{token}/attachments/{attachment_id}", response_model=AttachmentRead)
def get_shared_attachment_metadata(
    token: str,
    attachment_id: uuid.UUID,
    db: Session = Depends(get_db),
) -> AttachmentRead:
    try:
        share = resolve_accessible_share(db, token)
        attachment = get_share_attachment(db, share, attachment_id)
        return attachment_read(attachment, content_prefix=f"/api/shared/{token}/attachments")
    except (AttachmentAccessError, ShareError) as exc:
        raise HTTPException(status_code=getattr(exc, "status_code", 404), detail=str(exc)) from exc


def _content_response(
    path: Path,
    mime_type: str,
    filename: str,
    method: str,
    disposition: str,
    range_header: str | None,
    *,
    cache_control: str = "private, max-age=3600",
) -> Response:
    size = path.stat().st_size
    start, end, status_code = _resolve_range(range_header, size)
    if mime_type in _ACTIVE_MIME_TYPES or not _inline_allowed(mime_type):
        disposition = "attachment"
    headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": cache_control,
        "Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(_safe_download_name(filename))}",
        "Content-Length": str(max(0, end - start + 1)),
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "X-Content-Type-Options": "nosniff",
    }
    if status_code == 206:
        headers["Content-Range"] = f"bytes {start}-{end}/{size}"
    if method == "HEAD":
        return Response(status_code=status_code, media_type=mime_type, headers=headers)
    return StreamingResponse(
        _read_range(path, start, end),
        status_code=status_code,
        media_type=mime_type,
        headers=headers,
    )


def _resolve_range(value: str | None, size: int) -> tuple[int, int, int]:
    if size == 0:
        return 0, -1, 200
    if value is None:
        return 0, size - 1, 200
    match = re.fullmatch(r"bytes=(\d*)-(\d*)", value.strip())
    if match is None or "," in value:
        raise HTTPException(status_code=416, detail="Only one byte range is supported.", headers={"Content-Range": f"bytes */{size}"})
    first, last = match.groups()
    if not first and not last:
        raise HTTPException(status_code=416, detail="Invalid byte range.", headers={"Content-Range": f"bytes */{size}"})
    if not first:
        length = int(last)
        start = max(0, size - length)
        end = size - 1
    else:
        start = int(first)
        end = int(last) if last else size - 1
    if start >= size or start > end:
        raise HTTPException(status_code=416, detail="Byte range is outside the attachment.", headers={"Content-Range": f"bytes */{size}"})
    return start, min(end, size - 1), 206


def _read_range(path: Path, start: int, end: int) -> Iterator[bytes]:
    remaining = max(0, end - start + 1)
    with path.open("rb") as source:
        source.seek(start)
        while remaining:
            chunk = source.read(min(1024 * 1024, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


def _inline_allowed(mime_type: str) -> bool:
    return mime_type in _INLINE_MIME_TYPES or mime_type.startswith("audio/") or mime_type.startswith("video/")


def _safe_download_name(filename: str) -> str:
    value = Path(filename).name.replace("\r", "_").replace("\n", "_").strip()
    return value[:240] or "attachment.bin"


def _upload_item_read(item: AttachmentUploadItem) -> AttachmentUploadItemRead:
    return AttachmentUploadItemRead(
        id=item.id,
        client_filename=item.client_filename,
        declared_mime_type=item.declared_mime_type,
        detected_mime_type=item.detected_mime_type,
        byte_size=item.byte_size,
        sha256=item.sha256,
        validation_status=item.validation_status,
        scan_status=item.scan_status,
        error_code=item.error_code,
        created_at=item.created_at,
    )


def _upload_session_read(session) -> AttachmentUploadSessionRead:
    return AttachmentUploadSessionRead(
        id=session.id,
        conversation_id=session.conversation_id,
        target_message_id=session.target_message_id,
        base_message_version_id=session.base_message_version_id,
        status=session.status,
        expires_at=session.expires_at,
        created_at=session.created_at,
        items=[_upload_item_read(item) for item in session.items],
    )
