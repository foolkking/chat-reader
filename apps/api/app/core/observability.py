from __future__ import annotations

import json
import logging
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


def structured_event(logger: logging.Logger, level: int, event: str, **fields: Any) -> None:
    # Observability is best-effort and must never turn a business operation into a failure.
    try:
        _ensure_structured_log_output(logger)
        payload: dict[str, Any] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "event": event,
        }
        request_id = current_request_id()
        if request_id is not None:
            payload["request_id"] = request_id
        payload.update(fields)
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
