"""Read-only, source-bound image geometry. Never decode pixels or persist on GET."""
from __future__ import annotations

import re
from types import SimpleNamespace

from app.models.attachment import AssetObject, Attachment
from app.services.assets.asset_store import get_asset_store
from app.services.assets.scanner import scan_status_allows_use

KEY = "image_geometry_v1"


def selected_geometry(attachment: Attachment) -> dict | None:
    value = (attachment.metadata_ or {}).get(KEY)
    asset = attachment.asset_object
    if not isinstance(value, dict) or asset is None:
        return None
    if value.get("source_sha256") != asset.sha256 or not re.fullmatch(r"[a-f0-9]{64}", asset.sha256):
        return None
    if any(type(value.get(key)) is not int or not 0 < value[key] <= 1_000_000
           for key in ("original_width", "original_height")):
        return None
    return {key: value[key] for key in ("source_sha256", "original_width", "original_height")}


def inspect_geometry(asset: AssetObject | None) -> dict | None:
    # Only called after the caller's authorization/scanning boundary, for one
    # attachment or a just-ingested asset. Never call from list/turn serializers.
    if (asset is None or asset.deleted_at is not None or asset.status != "available"
            or not scan_status_allows_use(asset.scan_status)
            or not (asset.detected_mime_type or "").startswith("image/")):
        return None
    from app.services.assets.image_display import dimensions
    try:
        path = get_asset_store().resolve_key(asset.storage_key)
        width, height = dimensions(SimpleNamespace(asset_object=asset, path=path))
        if not 0 < width <= 1_000_000 or not 0 < height <= 1_000_000:
            return None
        return {"source_sha256": asset.sha256, "original_width": width, "original_height": height}
    except (OSError, ValueError):
        # Geometry is optional. Inspection rejection must not revoke access to
        # an otherwise usable original or turn a read into a failed import.
        return None


def ingested_geometry(asset: AssetObject | None) -> dict:
    value = inspect_geometry(asset)
    return {KEY: value} if value else {}
