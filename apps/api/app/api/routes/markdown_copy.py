import re
import uuid
import asyncio
from threading import BoundedSemaphore

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.core.database import get_db
from app.services.assets import public_images, image_display
from app.services.assets.attachment_service import AttachmentAccessError, get_owner_attachment
from app.services.ownership import ownership_scope_from_request
from app.api.routes.attachments import _content_response

router = APIRouter(tags=["markdown-copy"])
_preview_slot = BoundedSemaphore(1)


class PublishImagesRequest(BaseModel):
    base_version_id: uuid.UUID
    attachment_ids: list[uuid.UUID] = Field(default_factory=list, max_length=public_images.MAX_COPY_IMAGES)


class ImageDisplayRequest(BaseModel):
    source_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    scale_percent: int = Field(strict=True, ge=1, le=100)
    expected_scale_percent: int = Field(strict=True, ge=1, le=100)


@router.get("/api/attachments/{attachment_id}/image-display")
def read_image_display(attachment_id: uuid.UUID, request: Request, response: Response, db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "no-store"
    try:
        return image_display.display_state(db, attachment_id, ownership_scope_from_request(request))
    except (AttachmentAccessError, FileNotFoundError) as exc:
        raise HTTPException(getattr(exc, "status_code", 404), detail=str(exc)) from exc


@router.put("/api/attachments/{attachment_id}/image-display")
def update_image_display(attachment_id: uuid.UUID, payload: ImageDisplayRequest, request: Request,
                         response: Response, db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "no-store"
    # Serialize expensive pixel work with SVG previews, not anonymous reads.
    acquired = False
    try:
        scope = ownership_scope_from_request(request)
        get_owner_attachment(db, attachment_id, scope)
        acquired = _preview_slot.acquire(blocking=False)
        if not acquired:
            raise HTTPException(429, detail="Another image conversion is in progress.", headers={"Retry-After": "3"})
        result = image_display.save_display(db, attachment_id, scope, payload.source_sha256,
                                            payload.scale_percent, payload.expected_scale_percent)
        db.commit()
        return result
    except (AttachmentAccessError, FileNotFoundError) as exc:
        db.rollback()
        raise HTTPException(getattr(exc, "status_code", 404), detail=str(exc)) from exc
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(503, detail="Image storage changed concurrently. Reload and retry.",
                            headers={"Retry-After": "1"}) from exc
    finally:
        if acquired:
            _preview_slot.release()


@router.get("/api/messages/{message_id}/markdown-copy")
def markdown_copy_plan(message_id: uuid.UUID, request: Request, response: Response, db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "no-store"
    try:
        return public_images.copy_plan(db, message_id, ownership_scope_from_request(request))
    except AttachmentAccessError as exc:
        raise HTTPException(exc.status_code, detail=str(exc)) from exc


@router.post("/api/messages/{message_id}/markdown-copy")
def publish_message_images(message_id: uuid.UUID, payload: PublishImagesRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "no-store"
    try:
        result = public_images.publish_images(
            db, message_id, ownership_scope_from_request(request), payload.base_version_id, payload.attachment_ids,
        )
        db.commit()
        return result
    except (AttachmentAccessError, FileNotFoundError) as exc:
        db.rollback()
        raise HTTPException(getattr(exc, "status_code", 404), detail="Image unavailable." if isinstance(exc, FileNotFoundError) else str(exc)) from exc


@router.put("/api/attachments/{attachment_id}/markdown-copy-preview")
async def upload_markdown_copy_preview(
    attachment_id: uuid.UUID, request: Request,
    source_sha256: str = Query(pattern=r"^[a-f0-9]{64}$"), db: Session = Depends(get_db),
):
    scope = ownership_scope_from_request(request)
    acquired = False
    try:
        # Reject wrong ownership before reading even a bounded request body.
        await run_in_threadpool(get_owner_attachment, db, attachment_id, scope)
        acquired = _preview_slot.acquire(blocking=False)
        if not acquired:
            raise HTTPException(429, detail="Another safe image conversion is in progress.", headers={"Retry-After": "3"})
        payload = bytearray()
        async with asyncio.timeout(15):
            async for chunk in request.stream():
                if len(payload) + len(chunk) > public_images.MAX_PREVIEW_BYTES:
                    raise AttachmentAccessError("PNG preview exceeds the 4 MiB limit.", 413)
                payload.extend(chunk)
        await run_in_threadpool(public_images.save_svg_preview, db, attachment_id, scope, source_sha256, bytes(payload))
        await run_in_threadpool(db.commit)
        return Response(status_code=204)
    except AttachmentAccessError as exc:
        db.rollback()
        raise HTTPException(exc.status_code, detail=str(exc)) from exc
    except TimeoutError as exc:
        db.rollback()
        raise HTTPException(408, detail="PNG preview upload timed out.") from exc
    except IntegrityError as exc:
        # Distinct SVG sources can concurrently produce the same deduplicated
        # PNG. Roll back the losing transaction; a retry reuses the winner.
        db.rollback()
        raise HTTPException(503, detail="Preview storage changed concurrently. Retry.", headers={"Retry-After": "1"}) from exc
    finally:
        if acquired:
            _preview_slot.release()


@router.get("/api/public-images/{token}")
@router.head("/api/public-images/{token}")
def get_public_image(token: str, request: Request, db: Session = Depends(get_db)):
    try:
        if not re.fullmatch(r"[A-Za-z0-9_-]{43}", token):
            raise AttachmentAccessError("Image not found.")
        path, mime = public_images.public_image_content(db, token)
        response = _content_response(path, mime, "image", request.method, "inline", request.headers.get("range"),
                                     cache_control="no-store")
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Content-Security-Policy"] = "default-src 'none'; sandbox"
        return response
    except (AttachmentAccessError, FileNotFoundError, ValueError) as exc:
        # Identical missing/blocked/deleted/unknown response, including HEAD.
        return Response(status_code=404, headers={"Cache-Control": "no-store"})
