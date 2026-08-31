from __future__ import annotations

import json
import logging
import re
import time
import uuid
from contextvars import ContextVar, Token
from datetime import datetime, timezone
from typing import Any

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import JSONResponse, Response

_request_id: ContextVar[str | None] = ContextVar("request_id", default=None)
request_logger = logging.getLogger("chat_reader.request")
_structured_handler = logging.StreamHandler()
_structured_handler.setFormatter(logging.Formatter("%(message)s"))
_REDACTED = "[redacted]"
_SENSITIVE_FIELD_PARTS = (
    "authorization",
    "body",
    "content",
    "cookie",
    "error_message",
    "exception_message",
    "filename",
    "header",
    "password",
    "path",
    "prompt",
    "query",
    "quote",
    "secret",
    "text",
    "token",
    "traceback",
    "uri",
    "url",
)
_EVENT_RE = re.compile(r"^[a-z0-9_.-]{1,80}$")
_DATABASE_URL_RE = re.compile(r"(?i)\b(?:postgres(?:ql)?|mysql|redis)://[^\s\"']+")
_WINDOWS_PATH_RE = re.compile(r"(?i)\b[a-z]:[\\/][^\s\"']+")
_UNIX_PATH_RE = re.compile(r"(?<![A-Za-z0-9])/(?:mnt|var|opt|tmp|home|srv|app)/[^\s\"']+")
_BEARER_RE = re.compile(r"(?i)\bbearer\s+[a-z0-9._~+/=-]+")


def _query_endpoint_family(route_template: str) -> str | None:
    """Return a bounded family label for the read paths we troubleshoot most."""
    if route_template.startswith("/api/search"):
        return "search"
    if "/toc" in route_template:
        return "toc"
    if route_template == "/api/conversations/{conversation_id}/attachments":
        return "attachments"
    if route_template.startswith("/api/conversations"):
        if any(marker in route_template for marker in ("/reader-turn", "/message-window", "/dialogue-index", "/resolve-locator")):
            return "conversation_reader"
        if route_template == "/api/conversations":
            return "conversations"
    return None


def _duration_bucket(duration_ms: float) -> str:
    if duration_ms < 50:
        return "lt_50ms"
    if duration_ms < 250:
        return "50_249ms"
    if duration_ms < 1000:
        return "250_999ms"
    if duration_ms < 5000:
        return "1_4_999s"
    return "gte_5s"


def _ensure_structured_log_output(logger: logging.Logger) -> None:
    """Make application events visible without enabling raw HTTP access logs."""
    logger.setLevel(logging.INFO)
    current: logging.Logger | None = logger
    while current is not None:
        if current.handlers:
            return
        if not current.propagate:
            break
        current = current.parent
    logger.addHandler(_structured_handler)
    logger.propagate = False


def current_request_id() -> str | None:
    return _request_id.get()


def _safe_log_field(key: str, value: Any) -> Any:
    normalized_key = key.casefold()
    if any(part in normalized_key for part in _SENSITIVE_FIELD_PARTS):
        return _REDACTED
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, uuid.UUID):
        return str(value)
    if not isinstance(value, str):
        # Structured events intentionally accept only bounded scalar metadata.
        # Nested payloads are too easy to populate with request or user data.
        return _REDACTED
    sanitized = _DATABASE_URL_RE.sub(_REDACTED, value)
    sanitized = _WINDOWS_PATH_RE.sub(_REDACTED, sanitized)
    sanitized = _UNIX_PATH_RE.sub(_REDACTED, sanitized)
    sanitized = _BEARER_RE.sub(_REDACTED, sanitized)
    return sanitized[:256]


def structured_event(logger: logging.Logger, level: int, event: str, **fields: Any) -> None:
    # Observability is best-effort and must never turn a business operation into a failure.
    try:
        _ensure_structured_log_output(logger)
        payload: dict[str, Any] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "event": event if _EVENT_RE.fullmatch(event) else "invalid_event",
        }
        request_id = current_request_id()
        if request_id is not None:
            payload["request_id"] = request_id
        payload.update({key: _safe_log_field(key, value) for key, value in fields.items()})
        logger.log(level, json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str))
    except Exception:
        return


class RequestObservabilityMiddleware(BaseHTTPMiddleware):
    """Assign a server-owned request ID and emit one sanitized completion event."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        request_id = str(uuid.uuid4())
        token: Token[str | None] = _request_id.set(request_id)
        request.state.request_id = request_id
        started = time.perf_counter()
        response: Response
        error_class: str | None = None
        try:
            response = await call_next(request)
        except Exception as exc:  # The response stays safe; raw exception text is not logged.
            error_class = type(exc).__name__
            response = JSONResponse(
                status_code=500,
                content={"detail": "Internal server error.", "request_id": request_id},
            )
        finally:
            duration_ms = round((time.perf_counter() - started) * 1000, 3)

        route = request.scope.get("route")
        route_template = getattr(route, "path", None) or "unmatched"
        response.headers["X-Request-ID"] = request_id
        fields: dict[str, Any] = {
            "method": request.method,
            "route_template": route_template,
            "status": response.status_code,
            "duration_ms": duration_ms,
        }
        endpoint_family = _query_endpoint_family(route_template)
        if endpoint_family is not None:
            fields["endpoint_family"] = endpoint_family
            fields["duration_bucket"] = _duration_bucket(duration_ms)
        if error_class is not None:
            fields["error_class"] = error_class
        try:
            structured_event(
                request_logger,
                logging.ERROR if response.status_code >= 500 else logging.INFO,
                "api_request_completed",
                **fields,
            )
        finally:
            _request_id.reset(token)
        return response
