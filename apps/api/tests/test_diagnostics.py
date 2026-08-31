from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import event

from app.core.config import get_settings
from app.core.database import get_db
from app.main import app
from app.models.background_job import BackgroundJob
from app.models.import_record import ImportRecord
from app.models.worker_runtime_state import WorkerRuntimeState
from app.services.diagnostics import _timing_percentiles, storage_usage
from test_import_preview_api import client  # noqa: F401


def _operator_client() -> TestClient:
    return TestClient(app, client=("127.0.0.1", 50000))


def test_internal_diagnostics_disabled_by_default(client: TestClient, monkeypatch) -> None:
    monkeypatch.setenv("ENABLE_INTERNAL_DIAGNOSTICS", "false")
    get_settings.cache_clear()
    response = client.get("/api/internal/diagnostics")
    assert response.status_code == 404
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["X-Content-Type-Options"] == "nosniff"


def test_internal_diagnostics_enabled_still_denies_non_loopback_client(
    client: TestClient,
    monkeypatch,
) -> None:
    monkeypatch.setenv("ENABLE_INTERNAL_DIAGNOSTICS", "true")
    get_settings.cache_clear()
    response = client.get("/api/internal/diagnostics")
    assert response.status_code == 404
    assert response.headers["Cache-Control"] == "no-store"


def test_internal_diagnostics_returns_bounded_aggregates_without_sensitive_content(
    client: TestClient,
    monkeypatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("ENABLE_INTERNAL_DIAGNOSTICS", "true")
    monkeypatch.setenv("IMPORT_STORAGE_DIR", str(tmp_path / "imports"))
    monkeypatch.setenv("EXPORT_STORAGE_DIR", str(tmp_path / "exports"))
    monkeypatch.setenv("OFFLINE_STORAGE_DIR", str(tmp_path / "offline"))
    monkeypatch.setenv("ASSET_STORAGE_DIR", str(tmp_path / "assets"))
    get_settings.cache_clear()
    for directory in ("imports", "exports", "offline", "assets"):
        path = tmp_path / directory
        path.mkdir(exist_ok=True)
        (path / "sensitive-filename.txt").write_text("not-read", encoding="utf-8")

    override = app.dependency_overrides[get_db]
    generator = override()
    db = next(generator)
    try:
        now = datetime.now(timezone.utc)
        db.add(
            BackgroundJob(
                job_type="conversation_export",
                status="queued",
                phase="queued",
                queued_at=now - timedelta(seconds=15),
                payload={"title": "private conversation content"},
            )
        )
        db.add(
            BackgroundJob(
                job_type="conversation_merge",
                status="committed",
                phase="committed",
                completed_at=now - timedelta(seconds=30),
            )
        )
        db.add_all(
            [
                BackgroundJob(
                    job_type="conversation_export",
                    status="committed",
                    phase="committed",
                    queued_at=now - timedelta(seconds=10),
                    started_at=now - timedelta(seconds=9),
                    completed_at=now - timedelta(seconds=7),
                ),
                BackgroundJob(
                    job_type="conversation_merge",
                    status="committed",
                    phase="committed",
                    queued_at=now - timedelta(seconds=400),
                    started_at=now - timedelta(seconds=300),
                    completed_at=now,
                ),
            ]
        )
        db.add(
            ImportRecord(
                source_profile="fixture",
                source_fingerprint="opaque",
                status="failed",
                phase="failed",
                attempt_count=3,
                json_filename="private-name.json",
            )
        )
        db.add(
            ImportRecord(
                source_profile="fixture",
                source_fingerprint="terminal-aggregate",
                status="committed",
                phase="committed",
                completed_at=now - timedelta(seconds=20),
            )
        )
        db.commit()
    finally:
        db.close()
        generator.close()

    override = app.dependency_overrides[get_db]
    generator = override()
    db = next(generator)
    engine = db.get_bind()
    statements: list[str] = []

    def record_statement(conn, cursor, statement, parameters, context, executemany) -> None:
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", record_statement)
    try:
        response = _operator_client().get("/api/internal/diagnostics")
    finally:
        event.remove(engine, "before_cursor_execute", record_statement)
        db.close()
        generator.close()
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["Pragma"] == "no-cache"
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Robots-Tag"] == "noindex, noarchive"
    assert response.headers["X-Request-ID"]
    payload = response.json()
    assert payload["jobs"]["status_counts"]["queued"] == 1
    assert payload["imports"]["retry_exhausted"] == 1
    assert payload["storage"]["assets"]["file_count"] == 1
    assert payload["artifacts"]["cleanup_scan_complete"] is True
    task_results = payload["task_results"]
    assert task_results["retention_seconds"] == 600
    assert task_results["visible_job_count"] == 3
    assert task_results["visible_import_count"] == 1
    assert task_results["visible_total_count"] == 4
    assert 30 <= task_results["oldest_visible_age_seconds"] < 31
    timing = payload["jobs"]["recent_timing_sample"]
    assert timing["sample_size"] == 2
    assert timing["queue_wait_average_seconds"] == 50.5
    assert timing["execution_average_seconds"] == 151.0
    assert timing["queue_wait_percentiles_seconds"] == {"p50": 1.0, "p95": 100.0, "p99": 100.0}
    assert timing["execution_percentiles_seconds"] == {"p50": 2.0, "p95": 300.0, "p99": 300.0}
    assert timing["queue_wait_histogram"]["sample_size"] == 2
    assert [bucket["count"] for bucket in timing["queue_wait_histogram"]["buckets"]] == [1, 0, 0, 0, 1, 0]
    assert [bucket["count"] for bucket in timing["execution_histogram"]["buckets"]] == [0, 1, 0, 0, 1, 0]
    assert payload["system"]["scanner"] == "disabled"
    serialized = json.dumps(payload)
    assert "sensitive-filename" not in serialized
    assert "private conversation content" not in serialized
    assert "private-name.json" not in serialized
    assert "storage_uri" not in serialized
    assert "token" not in serialized.casefold()
    assert "instance_id" not in serialized
    assert "job_id" not in serialized
    assert len(statements) <= 24
    assert not any("messages" in statement.casefold() for statement in statements)


def test_timing_percentiles_are_bounded_and_empty_safe() -> None:
    assert _timing_percentiles([]) == {"p50": None, "p95": None, "p99": None}
    assert _timing_percentiles([0.1, 0.2, 0.3, 2.0]) == {"p50": 0.2, "p95": 2.0, "p99": 2.0}


def test_diagnostics_reports_recent_idle_worker_without_recent_job_activity(
    client: TestClient,
    monkeypatch,
) -> None:
    monkeypatch.setenv("ENABLE_INTERNAL_DIAGNOSTICS", "true")
    get_settings.cache_clear()
    override = app.dependency_overrides[get_db]
    generator = override()
    db = next(generator)
    try:
        now = datetime.now(timezone.utc)
        db.add(
            WorkerRuntimeState(
                worker_key="primary",
                instance_id=uuid.uuid4(),
                state="idle",
                task_kind=None,
                started_at=now - timedelta(hours=2),
                heartbeat_at=now,
            )
        )
        db.commit()
    finally:
        db.close()
        generator.close()

    response = _operator_client().get("/api/internal/diagnostics")
    assert response.status_code == 200
    system = response.json()["system"]
    assert system["worker_state"] == "alive_idle"
    assert system["worker_processing_task_count"] == 0
    assert system["worker_active_task_kind"] is None


def test_health_remains_separate_from_diagnostics(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert set(response.json()) == {"status", "service", "stage"}


def test_storage_usage_stops_at_the_configured_entry_budget(tmp_path: Path) -> None:
    for index in range(5):
        (tmp_path / f"file-{index}.bin").write_bytes(b"x")
    result = storage_usage(tmp_path, max_entries=3)
    assert result == {"file_count": 3, "bytes": 3, "complete": False}


def test_public_gateway_configuration_conceals_internal_diagnostics() -> None:
    root = Path(__file__).parents[3]
    fragment = (root / "deploy" / "nginx-internal-diagnostics.location.conf").read_text(encoding="utf-8")
    nginx = (root / "deploy" / "nginx-chat-reader.conf").read_text(encoding="utf-8")
    compose = (root / "docker-compose.production.yml").read_text(encoding="utf-8")
    assert "location ^~ /api/internal/diagnostics" in fragment
    assert "return 404;" in fragment
    assert "no-store" in fragment
    assert "proxy_pass" not in fragment
    assert "include /etc/nginx/snippets/chat-reader-internal-diagnostics.conf;" in nginx
    assert 'expose:\n      - "8000"' in compose.replace("\r\n", "\n")
    assert 'ports:\n      - "8000' not in compose.replace("\r\n", "\n")


def test_import_preview_has_a_route_scoped_pair_upload_limit() -> None:
    root = Path(__file__).parents[3]
    nginx = (root / "deploy" / "nginx-chat-reader.conf").read_text(encoding="utf-8")
    preview_location = nginx.split("location = /api/imports/preview", 1)[1].split("location /", 1)[0]

    assert "client_max_body_size 110m;" in preview_location
    assert nginx.count("client_max_body_size 110m;") == 1
    assert "client_max_body_size 60m;" in nginx
