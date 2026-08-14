from __future__ import annotations

import json
import logging
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.core.observability import RequestObservabilityMiddleware, request_logger


def _test_app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(RequestObservabilityMiddleware)

    @app.get("/ok")
    def ok() -> dict[str, bool]:
        return {"ok": True}

    @app.get("/bad")
    def bad() -> None:
        raise HTTPException(status_code=400, detail="bad request")

    @app.get("/conflict")
    def conflict() -> None:
        raise HTTPException(status_code=409, detail="conflict")

    @app.get("/boom")
    def boom() -> None:
        raise RuntimeError("sensitive-message-body")

    return app


def test_request_id_headers_error_correlation_and_server_ownership(caplog) -> None:
    caplog.set_level(logging.INFO, logger="chat_reader.request")
    with TestClient(_test_app()) as client:
        responses = [
            client.get("/ok", headers={"X-Request-ID": "attacker-controlled"}),
            client.get("/bad"),
            client.get("/missing"),
            client.get("/conflict"),
            client.get("/boom"),
        ]
    assert [response.status_code for response in responses] == [200, 400, 404, 409, 500]
    for response in responses:
        request_id = response.headers["X-Request-ID"]
        assert str(uuid.UUID(request_id)) == request_id
        assert request_id != "attacker-controlled"
        assert request_id in caplog.text
    assert responses[-1].json()["request_id"] == responses[-1].headers["X-Request-ID"]
    assert "sensitive-message-body" not in caplog.text


def test_structured_log_uses_route_template_and_redacts_request_material(caplog) -> None:
    caplog.set_level(logging.INFO, logger="chat_reader.request")
    secret = "share-token-should-not-appear"
    with TestClient(_test_app()) as client:
        response = client.get(
            f"/ok?token={secret}",
            headers={"Cookie": f"session={secret}", "Authorization": f"Bearer {secret}"},
        )
    record = next(record for record in caplog.records if response.headers["X-Request-ID"] in record.message)
    payload = json.loads(record.message)
    assert payload["event"] == "api_request_completed"
    assert payload["route_template"] == "/ok"
    assert payload["method"] == "GET"
    assert payload["status"] == 200
    assert payload["duration_ms"] >= 0
    assert secret not in record.message
    assert "Cookie" not in record.message
    assert "Authorization" not in record.message


def test_logging_failure_does_not_block_business_request(monkeypatch) -> None:
    def fail_log(*args, **kwargs) -> None:
        raise RuntimeError("injected logging failure")

    monkeypatch.setattr(request_logger, "log", fail_log)
    with TestClient(_test_app()) as client:
        response = client.get("/ok")
    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert response.headers["X-Request-ID"]


def test_api_image_disables_uvicorn_raw_access_log() -> None:
    dockerfile = Path(__file__).parents[1] / "Dockerfile"
    assert "--no-access-log" in dockerfile.read_text(encoding="utf-8")
