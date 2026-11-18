"""Root-only bridge to a fixed, optional host socket. No Docker/registry credentials."""
from __future__ import annotations

import http.client
import json
import re
import socket
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.core.auth_middleware import _same_origin
from app.core.config import get_settings
from app.core.database import get_db
from app.services.administration import record_admin_audit, require_root_admin

router = APIRouter(prefix="/api/admin/updates", tags=["root-administration"])
SOCKET = "/run/chat-reader-updater/control.sock"


class Ticket(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=r"^[a-f0-9]{32}$")


class Intent(Ticket):
    expected: str = Field(pattern=r"^(?:[a-f0-9]{40}|[a-f0-9]{64})$")
    target: str = Field(pattern=r"^(?:[a-f0-9]{40}|[a-f0-9]{64})$")


class _Host(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(SOCKET)


def _call(op, body=None):
    conn = _Host("localhost", timeout=40 if op == "check" else 5)
    try:
        conn.request(
            "GET" if body is None else "POST",
            "/" + op,
            body=None if body is None else json.dumps(body),
            headers={"Content-Type": "application/json"},
        )
        resp = conn.getresponse()
        data = resp.read(131073)
        if resp.status not in (200, 202):
            raise HTTPException(
                409, detail="UPDATE_CHECK_FAILED" if op == "check" else "UPDATE_STATE_CHANGED"
            )
        if len(data) > 131072:
            raise ValueError()
        result = json.loads(data)
        if not isinstance(result, dict):
            raise ValueError()
        return result
    except (OSError, AttributeError, http.client.HTTPException, ValueError):
        raise HTTPException(503, detail="UPDATER_UNAVAILABLE") from None
    finally:
        conn.close()


def _guard(request, db, write=False, recent=False):
    actor = require_root_admin(request, db)
    if write and not _same_origin(request, get_settings().public_web_base_url):
        raise HTTPException(403, detail="ORIGIN_DENIED")
    if recent:
        auth = getattr(request.state, "session_authentication", None)
        created = auth.session.created_at if auth else None
        if (
            not created
            or not 0
            <= (
                datetime.now(timezone.utc) - created.replace(tzinfo=created.tzinfo or timezone.utc)
            ).total_seconds()
            <= 600
        ):
            raise HTTPException(403, detail="FRESH_LOGIN_REQUIRED")
    return actor


@router.get("")
def read_update(request: Request, response: Response, db: Session = Depends(get_db)):
    _guard(request, db)
    response.headers["Cache-Control"] = "private, no-store"
    return _call("state")


@router.post("/check")
def check_update(request: Request, db: Session = Depends(get_db)):
    _guard(request, db, write=True)
    return _call("check", {})


@router.post("/ticket")
def monitor_ticket(body: Ticket, request: Request, response: Response, db: Session = Depends(get_db)):
    _guard(request, db, write=True, recent=True)
    token = _call("ticket", body.model_dump()).get("ticket", "")
    if not isinstance(token, str) or not re.fullmatch("[a-f0-9]{64}", token):
        raise HTTPException(503, detail="UPDATER_UNAVAILABLE")
    response.set_cookie(
        "cr_update_monitor",
        token,
        max_age=5400,
        path="/__updates/",
        httponly=True,
        secure=True,
        samesite="strict",
    )
    response.headers["Cache-Control"] = "private, no-store"
    return {"ready": True}


@router.post("/{action}", status_code=202)
def start_update(
    action: Literal["prepare", "apply", "rollback"],
    body: Intent,
    request: Request,
    db: Session = Depends(get_db),
):
    actor = _guard(request, db, write=True, recent=True)
    # Commit an intent, not a false success, before the independent host may stop the API.
    record_admin_audit(
        db,
        actor_user_id=actor.id,
        action="release_" + action + "_requested",
        resource_type="release",
        resource_id=body.id,
    )
    db.commit()
    return _call(action, body.model_dump())
