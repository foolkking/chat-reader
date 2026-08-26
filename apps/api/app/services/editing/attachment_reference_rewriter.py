"""Shared, fail-closed rewriting for conversation attachment references."""

import re
import uuid
from typing import Any


_ATTACHMENT_ID_KEYS = {"attachmentId", "attachment_id"}


ASSET_REFERENCE_RE = re.compile(
    r"cr-asset://(?P<id>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})",
    re.IGNORECASE,
)


def rewrite_attachment_text(value: str, attachment_id_map: dict[uuid.UUID, uuid.UUID]) -> str:
    if not value or not attachment_id_map:
        return value

    def replace(match: re.Match[str]) -> str:
        source_id = uuid.UUID(match.group("id"))
        target_id = attachment_id_map.get(source_id)
        return f"cr-asset://{target_id}" if target_id is not None else match.group(0)

    return ASSET_REFERENCE_RE.sub(replace, value)


def attachment_reference_ids(value: Any) -> set[uuid.UUID]:
    found: set[uuid.UUID] = set()
    if isinstance(value, str):
        found.update(uuid.UUID(match.group("id")) for match in ASSET_REFERENCE_RE.finditer(value))
    elif isinstance(value, list):
        for item in value:
            found.update(attachment_reference_ids(item))
    elif isinstance(value, dict):
        for item in value.values():
            found.update(attachment_reference_ids(item))
    return found


def attachment_data_ids(value: Any) -> set[uuid.UUID]:
    """Collect URI and structured attachment IDs from block data or HTML."""
    found: set[uuid.UUID] = set()
    if isinstance(value, str):
        found.update(uuid.UUID(match.group("id")) for match in ASSET_REFERENCE_RE.finditer(value))
    elif isinstance(value, list):
        for item in value:
            found.update(attachment_data_ids(item))
    elif isinstance(value, dict):
        for key, item in value.items():
            if key in _ATTACHMENT_ID_KEYS:
                try:
                    found.add(uuid.UUID(str(item)))
                except (TypeError, ValueError):
                    pass
            found.update(attachment_data_ids(item))
    return found


def assert_attachment_references_mapped(value: Any, attachment_id_map: dict[uuid.UUID, uuid.UUID]) -> None:
    """Reject copied data that still points at an attachment outside the copy set."""
    if isinstance(value, str):
        for match in ASSET_REFERENCE_RE.finditer(value):
            source_id = uuid.UUID(match.group("id"))
            if source_id not in attachment_id_map:
                raise ValueError(f"Attachment reference {source_id} cannot be mapped during merge.")
        return
    if isinstance(value, list):
        for item in value:
            assert_attachment_references_mapped(item, attachment_id_map)
        return
    if isinstance(value, dict):
        for key in _ATTACHMENT_ID_KEYS:
            raw_id = value.get(key)
            if not raw_id:
                continue
            try:
                source_id = uuid.UUID(str(raw_id))
            except (TypeError, ValueError):
                continue
            if source_id not in attachment_id_map:
                raise ValueError(f"Attachment id {source_id} cannot be mapped during merge.")
        for item in value.values():
            assert_attachment_references_mapped(item, attachment_id_map)


def rewrite_attachment_data(value: Any, attachment_id_map: dict[uuid.UUID, uuid.UUID]) -> Any:
    if isinstance(value, list):
        return [rewrite_attachment_data(item, attachment_id_map) for item in value]
    if isinstance(value, dict):
        output = {key: rewrite_attachment_data(item, attachment_id_map) for key, item in value.items()}
        for key in _ATTACHMENT_ID_KEYS:
            attachment_id = output.get(key)
            try:
                source_id = uuid.UUID(str(attachment_id)) if attachment_id else None
            except (TypeError, ValueError):
                source_id = None
            if source_id in attachment_id_map:
                output[key] = str(attachment_id_map[source_id])
        return output
    if isinstance(value, str):
        return rewrite_attachment_text(value, attachment_id_map)
    return value
