from __future__ import annotations

from urllib.parse import urlsplit

from fastapi import Request
from sqlalchemy.exc import SQLAlchemyError
from starlette.concurrency import run_in_threadpool
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import JSONResponse, Response

from app.core.config import Settings, get_settings
from app.core.database import SessionLocal
from app.services.auth import SESSION_COOKIE_NAME, SESSION_PRESENCE_COOKIE_NAME, SessionAuthentication, authenticate_session

PUBLIC_PATHS = frozenset({
    "/health", "/api/health", "/api/auth/login", "/api/auth/register",
    "/api/auth/session", "/api/auth/logout", "/api/auth/setup/status",
    "/api/auth/setup/upgrade",
    "/api/auth/password-reset",
    "/api/auth/password-reset/request",
    "/api/auth/email-verification/request",
    "/api/auth/email-verification/confirm",
})
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


class AuthenticationMiddleware(BaseHTTPMiddleware):
    """Protect every non-infrastructure route when single-owner auth is enabled."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        settings = get_settings()
        if not settings.auth_enabled:
            return await call_next(request)

        path = request.url.path
        if request.method not in SAFE_METHODS and path != "/api/internal/diagnostics":
            if not _same_origin(request, settings.public_web_base_url):
                return _json_error(403, "Cross-origin request denied.")

        # Share capabilities are a deliberate public-by-link surface. The
        # share service still enforces token scope and optional password
        # unlock before returning any content.
        if path in PUBLIC_PATHS or path.startswith("/api/shared/") or path == "/api/internal/diagnostics" or request.method == "OPTIONS":
            response = await call_next(request)
            if path.startswith("/api/auth/") or path.startswith("/api/shared/"):
                response.headers["Cache-Control"] = "no-store"
                response.headers["Pragma"] = "no-cache"
            return response

        token = request.cookies.get(SESSION_COOKIE_NAME)
        try:
            authentication = await run_in_threadpool(_authenticate_request, token, settings)
        except SQLAlchemyError:
            return _json_error(503, "Authentication service unavailable.")

        if authentication is None:
            response = _json_error(401, "Authentication required.")
            if token:
                response.delete_cookie(SESSION_COOKIE_NAME, path="/", secure=settings.auth_cookie_secure, samesite="lax")
            response.delete_cookie(SESSION_PRESENCE_COOKIE_NAME, path="/", secure=settings.auth_cookie_secure, samesite="lax")
            return response

        request.state.auth = authentication.context
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["Pragma"] = "no-cache"
        # Password changes can revoke this session and clear its cookies in
        # the route. A sliding refresh must not overwrite that explicit clear.
        route_sets_session = any(
            value.startswith(f"{SESSION_COOKIE_NAME}=")
            for value in response.headers.getlist("set-cookie")
        )
        if authentication.touched and token is not None and not route_sets_session:
            response.set_cookie(
                SESSION_COOKIE_NAME,
                token,
                max_age=settings.auth_inactivity_timeout_seconds,
                httponly=True,
                secure=settings.auth_cookie_secure,
                samesite="lax",
                path="/",
            )
            response.set_cookie(
                SESSION_PRESENCE_COOKIE_NAME,
                "1",
                max_age=settings.auth_inactivity_timeout_seconds,
                httponly=False,
                secure=settings.auth_cookie_secure,
                samesite="lax",
                path="/",
            )
        return response


def _authenticate_request(token: str | None, settings: Settings) -> SessionAuthentication | None:
    # Synchronous PostgreSQL I/O must not block the ASGI event loop, including
    # public login/session and health requests behind another request's query.
    with SessionLocal() as db:
        return authenticate_session(db, token, settings)


def _same_origin(request: Request, public_web_base_url: str) -> bool:
    origin = request.headers.get("origin")
    if not origin:
        return False
    expected = urlsplit(public_web_base_url)
    try:
        actual = urlsplit(origin)
    except ValueError:
        return False
    return (
        actual.scheme.casefold(),
        actual.netloc.casefold(),
        actual.path,
        actual.query,
        actual.fragment,
    ) == (
        expected.scheme.casefold(),
        expected.netloc.casefold(),
        "",
        "",
        "",
    )


def _json_error(status_code: int, detail: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"detail": detail},
        headers={"Cache-Control": "no-store", "Pragma": "no-cache"},
    )
