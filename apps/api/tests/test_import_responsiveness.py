"""A blocked import parser must not hold the ASGI event loop."""
import asyncio
import threading
import time
import uuid
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI, HTTPException

from app.api.routes import adaptive_imports, imports
from app.core.database import get_db
from app.services.ownership import OwnershipScope, ownership_scope_from_request
from app.services.uploads import UploadLimitError


@pytest.mark.parametrize("kind", ["adaptive-create", "adaptive-replace", "preview"])
@pytest.mark.parametrize("workload", ["blocked-io", "python-cpu"])
def test_import_analysis_leaves_event_loop_available(monkeypatch, kind, workload):
    import_id, artifact_id = uuid.uuid4(), uuid.uuid4()
    entered, release, completed = threading.Event(), threading.Event(), threading.Event()
    parser_released = []
    db = SimpleNamespace(rollback=lambda: None)
    record = SimpleNamespace(id=import_id, artifacts=[])
    app = FastAPI()
    app.include_router(adaptive_imports.router)
    app.include_router(imports.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[ownership_scope_from_request] = lambda: OwnershipScope(uuid.uuid4())

    for module in (adaptive_imports, imports):
        monkeypatch.setattr(module, "get_feature_policy", lambda _: SimpleNamespace(allow_user_import=True))
        monkeypatch.setattr(module, "effective_import_size_mb", lambda *_: 1)
    monkeypatch.setattr(adaptive_imports, "begin_session", lambda *_args, **_kwargs: record)
    monkeypatch.setattr(adaptive_imports, "add_session_source_stream", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(adaptive_imports, "_record", lambda *_: record)
    monkeypatch.setattr(adaptive_imports, "_artifact", lambda *_: SimpleNamespace(id=artifact_id))
    monkeypatch.setattr(imports, "_cleanup_import_directory", lambda *_: None)

    def blocked_parser(*_args, **_kwargs):
        entered.set()
        if workload == "python-cpu":
            # Exercise a GIL-holding parser-shaped workload, not only sleep/I/O
            # that would release the GIL even if incorrectly run on the loop.
            deadline = time.perf_counter() + 0.75
            value = 0
            while time.perf_counter() < deadline:
                value = (value * 33 + 17) & 0xFFFFFFFF
            parser_released.append(value >= 0)
            completed.set()
        else:
            try:
                parser_released.append(release.wait(2))
            finally:
                completed.set()
        # Stop before any real file persistence or canonical DB mutation.
        raise HTTPException(status_code=422, detail="Synthetic parser stopped.")

    if kind == "adaptive-create":
        # First-pass parsing is no longer in this request. Exercise the bounded
        # disk-staging path instead; separate queue tests forbid parser entry.
        monkeypatch.setattr(adaptive_imports, "queue_session_analysis", blocked_parser)
        monkeypatch.setattr(adaptive_imports, "_remove_failed_session", lambda *_: None)
        method, path = "POST", "/api/adaptive-import/sessions"
        files = [("files", ("one.json", b"{}", "application/json"))]
    elif kind == "adaptive-replace":
        monkeypatch.setattr(adaptive_imports, "replace_session_artifact", blocked_parser)
        method, path = "PUT", f"/api/adaptive-import/sessions/{import_id}/artifacts/{artifact_id}"
        files = [("file", ("one.json", b"{}", "application/json"))]
    else:
        monkeypatch.setattr(imports, "detect_source_profile", blocked_parser)
        method, path = "POST", "/api/imports/preview"
        files = [("files", ("one.json", b"{}", "application/json"))]

    @app.get("/probe")
    async def probe():
        still_running = entered.is_set() and not completed.is_set()
        release.set()
        return {"parser_still_running": still_running}

    async def exercise():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
            base_url="http://test",
        ) as client:
            request = asyncio.create_task(client.request(method, path, files=files))
            try:
                assert await asyncio.to_thread(entered.wait, 3), "The parser did not start."
                response = await client.get("/probe")
                assert response.status_code == 200
                assert response.json()["parser_still_running"], "The import blocked the ASGI event loop."
                await request
            finally:
                release.set()
                await request
        assert len(parser_released) == 1

    asyncio.run(exercise())


@pytest.mark.parametrize("action", ["reanalyze", "groups", "exclude", "mapping", "health", "mapping/preview", "profile"])
def test_stored_source_admission_pressure_is_retryable(monkeypatch, action):
    import_id, family_id = uuid.uuid4(), uuid.uuid4()
    app = FastAPI()
    app.include_router(adaptive_imports.router)
    db = SimpleNamespace(rollback=lambda: None)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[ownership_scope_from_request] = lambda: OwnershipScope(uuid.uuid4())
    monkeypatch.setattr(adaptive_imports, "_record", lambda *_: SimpleNamespace(artifacts=[]))
    monkeypatch.setattr(adaptive_imports, "_family", lambda *_: SimpleNamespace())
    monkeypatch.setattr(adaptive_imports, "_group", lambda *_: SimpleNamespace())

    def rejected(_):
        raise UploadLimitError("UPLOAD_MEMORY_PRESSURE", "Synthetic memory pressure.", status_code=429)

    monkeypatch.setattr(adaptive_imports, "bounded_analysis_admission_sync", rejected)
    if action == "exclude":
        path = f"/api/adaptive-import/sessions/{import_id}/groups/{uuid.uuid4()}"
        method, payload = "DELETE", None
    elif action == "groups":
        path = f"/api/adaptive-import/sessions/{import_id}/groups"
        method, payload = "PUT", {"groups": [{"artifact_ids": [str(uuid.uuid4())]}]}
    elif action == "reanalyze":
        path = f"/api/adaptive-import/sessions/{import_id}/reanalyze"
        method, payload = "POST", None
    else:
        path = f"/api/adaptive-import/sessions/{import_id}/families/{family_id}/{action}"
        method = "POST"
        payload = (
            {"revision_id": str(uuid.uuid4())} if action == "profile" else
            {"profile_name": "Synthetic", "mapping_spec": {}} if action.startswith("mapping") else None
        )

    async def exercise():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test",
        ) as client:
            response = await client.request(method, path, json=payload)
        assert response.status_code == 429
        assert response.headers["Retry-After"] == "15"
        assert response.json()["detail"]["code"] == "UPLOAD_MEMORY_PRESSURE"

    asyncio.run(exercise())
