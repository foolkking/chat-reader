"""Serialize metadata placement and newly appended ranks for one account."""
import hashlib
from sqlalchemy import text


def manual_append_step(navigation, scope, override=None):
    """Choose the visible tail, including legacy reversed manual views."""
    order = override or (navigation or {}).get(scope) or {}
    return -1024 if order.get("mode") == "custom" and order.get("direction") == "desc" else 1024


def lock_navigation_order(connection, owner_user_id, *, nowait=False):
    if connection.dialect.name == "postgresql":
        owner = str(owner_user_id or "2dfb6c9e-4b25-4f67-9f5e-4b87f1d8ad01")
        key = int.from_bytes(hashlib.sha256(f"navigation-order:{owner}".encode()).digest()[:8], "big", signed=True)
        if nowait:
            if not connection.scalar(text("SELECT pg_try_advisory_xact_lock(:key)"), {"key": key}):
                from fastapi import HTTPException
                raise HTTPException(409, "Directory is changing. Refresh before reordering.")
        else:
            connection.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})
