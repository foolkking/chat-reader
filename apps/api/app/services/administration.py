"""Shared root-administration authorization and append-only audit helpers."""

from __future__ import annotations

import uuid
from collections.abc import Mapping
from typing import Any

from fastapi import HTTPException, Request
from sqlalchemy.orm import Session

from app.models.administration import AdminAuditLog
from app.models.user import User
from app.services.auth import root_admin_user


def require_root_admin(request: Request, db: Session) -> User:
    """Authorize only the immutable deployment root identity.

    A 404 response deliberately avoids disclosing the administration surface
    to normal authenticated accounts.
    """

    context = getattr(request.state, "auth", None)
    user = root_admin_user(db, context)
    if user is None:
        raise HTTPException(status_code=404, detail="Not found.")
    return user


def record_admin_audit(
    db: Session,
    *,
    actor_user_id: uuid.UUID,
    action: str,
    target_user_id: uuid.UUID | None = None,
    resource_type: str | None = None,
    resource_id: str | uuid.UUID | None = None,
    result: str = "SUCCESS",
    metadata: Mapping[str, Any] | None = None,
    request_id: str | None = None,
) -> AdminAuditLog:
    """Append bounded privileged-action metadata without sensitive payloads."""

    if result not in {"SUCCESS", "FAILURE", "DENIED"}:
        raise ValueError("Unsupported audit result.")
    safe_metadata = _safe_metadata(metadata or {})
    row = AdminAuditLog(
        actor_user_id=actor_user_id,
        action=action,
        target_user_id=target_user_id,
        resource_type=resource_type,
        resource_id=str(resource_id) if resource_id is not None else None,
        result=result,
        event_metadata=safe_metadata,
        request_id=(request_id or "")[:120] or None,
    )
    db.add(row)
    db.flush()
    return row


def request_id_from(request: Request) -> str | None:
    value = request.headers.get("x-request-id")
    return value[:120] if value else None


def _safe_metadata(metadata: Mapping[str, Any]) -> dict[str, Any]:
    forbidden = {
        "password",
        "password_hash",
        "session",
        "session_token",
        "token",
        "reset_token",
        "invitation_token",
        "content",
        "body",
        "attachment_content",
    }
    output: dict[str, Any] = {}
    for raw_key, value in metadata.items():
        key = str(raw_key)[:80]
        if key.casefold() in forbidden:
            continue
        if isinstance(value, uuid.UUID):
            output[key] = str(value)
        elif isinstance(value, (str, int, float, bool)) or value is None:
            output[key] = value[:500] if isinstance(value, str) else value
        elif isinstance(value, (list, tuple)):
            output[key] = [
                str(item)[:160]
                for item in value[:50]
                if isinstance(item, (str, int, float, bool, uuid.UUID))
            ]
    return output
