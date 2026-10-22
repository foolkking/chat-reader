"""Owner-selected image sizing. Originals and public capability identities never change."""
from __future__ import annotations

import hashlib
import io
import math
import re
import warnings
import xml.etree.ElementTree as ET

from PIL import Image, ImageOps
from sqlalchemy.orm import Session

from app.models.attachment import AssetDerivative, AssetObject, Attachment
from app.services.assets.asset_store import get_asset_store
from app.services.assets.attachment_service import AttachmentAccessError, get_owner_attachment
from app.services.assets.scanner import scan_status_allows_use
from app.services.ownership import OwnershipScope

KEY = "image_display_v1"
TYPE = "image_display_png"
MAX_BYTES = 16 * 1024 * 1024
MAX_SOURCE_PIXELS = 8_000_000
MAX_RESULT_PIXELS = 4_000_000


def selected_display(attachment: Attachment) -> dict | None:
    value = (attachment.metadata_ or {}).get(KEY)
    if not isinstance(value, dict) or attachment.asset_object is None:
        return None
    if value.get("source_sha256") != attachment.asset_object.sha256:
        return None
    if any(type(value.get(k)) is not int or value[k] <= 0 for k in (
        "scale_percent", "original_width", "original_height", "width", "height",
    )) or value["scale_percent"] > 100:
        return None
    return {k: value[k] for k in (
        "source_sha256", "scale_percent", "original_width", "original_height", "width", "height",
    )}


def dimensions(content) -> tuple[int, int]:
    from app.services.assets.public_images import RASTER_TYPES, SVG_TYPE, MAX_SVG_BYTES
    mime = content.asset_object.detected_mime_type
    if mime == SVG_TYPE:
        if content.asset_object.byte_size > MAX_SVG_BYTES:
            raise AttachmentAccessError("SVG exceeds the safe size limit.", 413)
        with content.path.open("rb") as stream:
            raw = stream.read(MAX_SVG_BYTES + 1)
        if len(raw) > MAX_SVG_BYTES:
            raise AttachmentAccessError("SVG exceeds the safe size limit.", 413)
        # XML is inspected only for dimensions, never rendered or fetched server-side.
        if b"\0" in raw or re.search(br"<!DOCTYPE|<!ENTITY", raw, re.I):
            raise AttachmentAccessError("SVG declarations are not supported.", 422)
        try:
            svg = ET.fromstring(raw)
            if svg.tag != "{http://www.w3.org/2000/svg}svg":
                raise ValueError()
            box = [float(n) for n in re.split(r"[,\s]+", svg.attrib["viewBox"].strip())] if "viewBox" in svg.attrib else None
            if box is not None and (len(box) != 4 or not all(math.isfinite(v) for v in box) or box[2] <= 0 or box[3] <= 0):
                raise ValueError()
            def dim(name, fallback):
                v = svg.get(name, "")
                return float(v.removesuffix("px")) if re.fullmatch(r"\d+(?:\.\d+)?(?:px)?", v) else fallback
            w, h = dim("width", box[2] if box else 300), dim("height", box[3] if box else 150)
            if not (0 < w <= 4096 and 0 < h <= 4096 and w * h <= MAX_RESULT_PIXELS):
                raise ValueError()
            return max(1, math.floor(w + .5)), max(1, math.floor(h + .5))
        except (ET.ParseError, ValueError, OverflowError) as exc:
            raise AttachmentAccessError("SVG dimensions are unsupported.", 422) from exc
    if mime not in RASTER_TYPES:
        raise AttachmentAccessError("Only supported images can be resized.", 422)
    # Header inspection can itself read large EXIF/ICC/text segments. Enforce
    # the encoded-byte limit before Pillow, including the read-only size route.
    if content.asset_object.byte_size > MAX_BYTES or content.path.stat().st_size > MAX_BYTES:
        raise AttachmentAccessError("Image exceeds the 16 MiB size-inspection limit.", 413)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(content.path) as image:
                # Match browser EXIF orientation without decoding the full image here.
                rotated = image.getexif().get(274) in {5, 6, 7, 8}
                return (image.height, image.width) if rotated else image.size
    except (OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise AttachmentAccessError("Image dimensions cannot be read.", 422) from exc


def display_state(db: Session, attachment_id, scope: OwnershipScope) -> dict:
    from app.services.assets.public_images import _usable
    row = get_owner_attachment(db, attachment_id, scope)
    content = _usable(row)
    width, height = dimensions(content)
    selected = selected_display(row)
    return {**selected, "configured": True} if selected else {
        "source_sha256": content.asset_object.sha256, "scale_percent": 100, "configured": False,
        "original_width": width, "original_height": height, "width": width, "height": height,
    }


def _version(row: Attachment, percent: int) -> str:
    return f"pillow-v1:{row.id}:{percent}"


def display_asset(db: Session, row: Attachment) -> AssetObject | None:
    selected = selected_display(row)
    if not selected or selected["scale_percent"] == 100 and row.asset_object.detected_mime_type != "image/svg+xml":
        return None
    asset = db.query(AssetObject).join(
        AssetDerivative, AssetDerivative.derivative_asset_object_id == AssetObject.id,
    ).filter(
        AssetDerivative.source_asset_object_id == row.asset_object_id,
        AssetDerivative.derivative_type == TYPE,
        AssetDerivative.generator_version == _version(row, selected["scale_percent"]),
        AssetDerivative.status == "ready",
    ).first()
    if asset is None or asset.status != "available" or asset.deleted_at or not scan_status_allows_use(asset.scan_status):
        raise AttachmentAccessError("Resized image is unavailable. Save its size again.", 409)
    get_asset_store().resolve_key(asset.storage_key)
    return asset


def save_display(db: Session, attachment_id, scope: OwnershipScope, source_sha256: str,
                 percent: int, expected_percent: int) -> dict:
    from app.services.assets.public_images import SVG_TYPE, _preview, _usable
    row = get_owner_attachment(db, attachment_id, scope)
    db.query(Attachment).filter_by(id=row.id).with_for_update().populate_existing().one()
    content = _usable(row)
    source = content.asset_object
    if source.sha256 != source_sha256:
        raise AttachmentAccessError("Image source changed. Reload image size.", 409)
    current = selected_display(row)
    if (current["scale_percent"] if current else 100) != expected_percent:
        raise AttachmentAccessError("Image size changed elsewhere. Reload before saving.", 409)
    if type(percent) is not int or not 1 <= percent <= 100:
        raise AttachmentAccessError("Use a whole percentage from 1 to 100.", 422)
    width, height = dimensions(content)
    result = {
        "source_sha256": source.sha256, "scale_percent": percent,
        "original_width": width, "original_height": height,
        "width": max(1, (width * percent + 50) // 100),
        "height": max(1, (height * percent + 50) // 100),
    }
    if percent != 100 or source.detected_mime_type == SVG_TYPE:
        if source.byte_size > MAX_BYTES or width * height > MAX_SOURCE_PIXELS:
            raise AttachmentAccessError("Image exceeds the 16 MiB / 8 megapixel resize limit.", 413)
        if max(result["width"], result["height"]) > 4096 or result["width"] * result["height"] > MAX_RESULT_PIXELS:
            raise AttachmentAccessError("Choose a smaller percentage (maximum 4096px / 4 megapixels).", 413)
        base = source
        if source.detected_mime_type == SVG_TYPE:
            base = _preview(db, source.id, row.id)
            if base is None or not scan_status_allows_use(base.scan_status):
                raise AttachmentAccessError("Prepare a safe SVG preview before resizing.", 409)
        try:
            with Image.open(get_asset_store().resolve_key(base.storage_key)) as image:
                if getattr(image, "n_frames", 1) != 1:
                    raise AttachmentAccessError("Animated images keep their original size; resizing would discard animation.", 422)
                if image.width * image.height > MAX_SOURCE_PIXELS:
                    raise AttachmentAccessError("Image exceeds the safe decode limit.", 413)
                with ImageOps.exif_transpose(image) as oriented:
                    with oriented.convert("RGBA") as pixels:
                        with pixels.resize((result["width"], result["height"]), Image.Resampling.LANCZOS) as resized:
                            output = io.BytesIO()
                            # No source metadata: clear propagated info and write only PNG pixels.
                            resized.info.clear()
                            resized.save(output, format="PNG")
            raw = output.getvalue()
            if len(raw) > MAX_BYTES:
                raise AttachmentAccessError("Resized PNG exceeds the 16 MiB limit.", 413)
            _store_derivative(db, row, percent, raw)
        except (OSError, ValueError, Image.DecompressionBombError) as exc:
            if isinstance(exc, AttachmentAccessError):
                raise
            raise AttachmentAccessError("Image could not be resized safely.", 422) from exc
    row.metadata_ = {**(row.metadata_ or {}), KEY: result}
    db.flush()
    return {**result, "configured": True}


def _store_derivative(db: Session, row: Attachment, percent: int, raw: bytes) -> None:
    store = get_asset_store()
    digest = hashlib.sha256(raw).hexdigest()
    asset = db.query(AssetObject).filter_by(sha256=digest, byte_size=len(raw)).first()
    missing = asset is None
    if asset is not None:
        if asset.status != "available" or asset.deleted_at or not scan_status_allows_use(asset.scan_status):
            raise AttachmentAccessError("Resized image object is unavailable.", 423)
        try:
            store.resolve_key(asset.storage_key)
        except FileNotFoundError:
            missing = True
    if missing:
        staged = store.stage(io.BytesIO(raw), max_bytes=MAX_BYTES, quarantine=False)
        key = store.object_key()
        store.promote(staged.path, key)
        if asset is None:
            asset = AssetObject(sha256=digest, byte_size=len(raw), detected_mime_type="image/png",
                                detected_extension=".png", storage_key=key, storage_backend=store.backend,
                                status="available", scan_status=row.asset_object.scan_status)
            db.add(asset)
        else:
            asset.storage_key, asset.storage_backend = key, store.backend
        try:
            db.flush()
        except BaseException:
            store.delete_key(key)
            raise
    derivative = db.query(AssetDerivative).filter_by(
        source_asset_object_id=row.asset_object_id, derivative_type=TYPE, generator_version=_version(row, percent),
    ).first()
    if derivative is None:
        db.add(AssetDerivative(source_asset_object_id=row.asset_object_id, derivative_asset_object_id=asset.id,
                               derivative_type=TYPE, generator="pillow", generator_version=_version(row, percent),
                               status="ready", metadata_={"image_display": True}))
    else:
        derivative.derivative_asset_object_id, derivative.status = asset.id, "ready"
