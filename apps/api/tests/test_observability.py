from __future__ import annotations

import json
import logging
import subprocess
import sys
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.core.observability import RequestObservabilityMiddleware, _duration_bucket, _query_endpoint_family, request_logger, structured_event


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


def test_query_observability_uses_bounded_families_and_duration_buckets() -> None:
    assert _query_endpoint_family("/api/conversations/{conversation_id}/reader-turn") == "conversation_reader"
    assert _query_endpoint_family("/api/conversations/{conversation_id}/resolve-locator") == "conversation_reader"
    assert _query_endpoint_family("/api/conversations/{conversation_id}/toc") == "toc"
    assert _query_endpoint_family("/api/search") == "search"
    assert _query_endpoint_family("/api/conversations/{conversation_id}/attachments") == "attachments"
    assert _query_endpoint_family("/api/health") is None
    assert [_duration_bucket(value) for value in (0, 49.999, 50, 249.999, 250, 999.999, 1000, 4999.999, 5000)] == [
        "lt_50ms",
        "lt_50ms",
        "50_249ms",
        "50_249ms",
        "250_999ms",
        "250_999ms",
        "1_4_999s",
        "1_4_999s",
        "gte_5s",
    ]


def test_logging_failure_does_not_block_business_request(monkeypatch) -> None:
    def fail_log(*args, **kwargs) -> None:
        raise RuntimeError("injected logging failure")

    monkeypatch.setattr(request_logger, "log", fail_log)
    with TestClient(_test_app()) as client:
        response = client.get("/ok")
    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert response.headers["X-Request-ID"]


def test_structured_event_is_emitted_without_preconfigured_root_logger() -> None:
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "import logging; "
                "from app.core.observability import structured_event; "
                "structured_event(logging.getLogger('release_c.production'), logging.INFO, "
                "'production_event', status='ok')"
            ),
        ],
        check=True,
        capture_output=True,
        text=True,
    )

    assert '\"event\":\"production_event\"' in result.stderr
    assert '\"status\":\"ok\"' in result.stderr


def test_structured_event_redacts_sensitive_fields_paths_and_nested_payloads(caplog) -> None:
    logger = logging.getLogger("chat_reader.redaction_test")
    caplog.set_level(logging.INFO, logger=logger.name)
    private_path = r"C:\Users\owner\private\attachment.pdf"
    private_unix_path = "/mnt/chat-reader/imports/source.md"
    private_body = "private-conversation-body"
    database_url = "postgresql://owner:password@database/chat_reader"

    structured_event(
        logger,
        logging.INFO,
        "redaction_contract",
        attachment_id="00000000-0000-0000-0000-000000000001",
        attachment_path=private_path,
        artifact_location=private_unix_path,
        error_message=private_body,
        diagnostic={"body": private_body},
        status=f"failed at {database_url}",
    )

    record = next(record for record in caplog.records if "redaction_contract" in record.message)
    payload = json.loads(record.message)
    assert payload["attachment_id"] == "00000000-0000-0000-0000-000000000001"
    assert payload["attachment_path"] == "[redacted]"
    assert payload["artifact_location"] == "[redacted]"
    assert payload["error_message"] == "[redacted]"
    assert payload["diagnostic"] == "[redacted]"
    assert "[redacted]" in payload["status"]
    assert private_path not in record.message
    assert private_unix_path not in record.message
    assert private_body not in record.message
    assert database_url not in record.message


def test_api_image_disables_uvicorn_raw_access_log() -> None:
    dockerfile = Path(__file__).parents[1] / "Dockerfile"
    assert "--no-access-log" in dockerfile.read_text(encoding="utf-8")
