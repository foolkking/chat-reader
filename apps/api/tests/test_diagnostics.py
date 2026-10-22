from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import event

from app.core.config import get_settings
from app.core.database import get_db
from app.main import app
from app.models.background_job import BackgroundJob
from app.models.import_record import ImportRecord
from app.models.worker_runtime_state import WorkerRuntimeState
from app.services.diagnostics import _timing_percentiles, storage_usage
from test_import_preview_api import client  # noqa: F401


@pytest.fixture(autouse=True)
def diagnostic_headroom(monkeypatch):
    # Contract tests must not depend on the runner's current free memory.
    monkeypatch.setattr("app.services.diagnostics.available_memory_bytes", lambda: 1024**3)


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
    normalized_compose = compose.replace("\r\n", "\n")
    assert '127.0.0.1:${API_PORT:-8000}:8000' in normalized_compose
    assert '0.0.0.0:${API_PORT' not in normalized_compose


def test_import_preview_has_a_route_scoped_pair_upload_limit() -> None:
    root = Path(__file__).parents[3]
    nginx = (root / "deploy" / "nginx-chat-reader.conf").read_text(encoding="utf-8")
    preview_location = nginx.split("location = /api/imports/preview", 1)[1].split("location /", 1)[0]

    assert "client_max_body_size 520m;" in preview_location
    assert "proxy_request_buffering off;" in preview_location
    assert "proxy_pass http://127.0.0.1:8000;" in preview_location
    assert "location ^~ /api/attachment-upload-sessions/" in nginx
    assert nginx.count("client_max_body_size 520m;") == 5
    api_location = nginx.split("location /api/", 1)[1].split("location = /api/imports/preview", 1)[0]
    assert "proxy_request_buffering off;" in api_location
    assert "proxy_pass http://127.0.0.1:8000;" in api_location
    assert nginx.count("proxy_request_buffering off;") == 8
    # Eight original API/upload locations plus the explicit public-image read.
    assert nginx.count("proxy_pass http://127.0.0.1:8000;") == 9
    for route in ("/api/me/archive/previews", "/api/system/archive/previews"):
        location = nginx.split(f"location = {route}", 1)[1].split("}", 1)[0]
        assert "client_max_body_size 520m;" in location
        assert "proxy_request_buffering off;" in location
        assert "proxy_pass http://127.0.0.1:8000;" in location
    assert "client_max_body_size 520m;" in nginx


def test_public_image_gateway_conceals_capability_uris_and_does_not_cache() -> None:
    root = Path(__file__).parents[3]
    nginx = (root / "deploy" / "nginx-chat-reader.conf").read_text(encoding="utf-8")
    location = nginx.split("location ^~ /api/public-images/ {", 1)[1].split("}", 1)[0]
    assert "access_log off;" in location
    assert "error_log /dev/null;" in location
    assert "proxy_cache off;" in location
    assert 'add_header Cache-Control "no-store" always;' in location
    assert "proxy_pass http://127.0.0.1:8000;" in location
    assert "client_max_body_size 520m;" not in location


@pytest.mark.parametrize("available", [None, 0, 256 * 1024**2 - 1])
def test_memory_pressure_defers_diagnostics_before_sql_or_scans(client, monkeypatch, available):
    from app.services import diagnostics

    monkeypatch.setenv("ENABLE_INTERNAL_DIAGNOSTICS", "true")
    get_settings.cache_clear()
    monkeypatch.setattr(diagnostics, "available_memory_bytes", lambda: available)

    class NoQueries:
        def get_bind(self):
            pytest.fail("memory admission must precede SQL")

    def no_queries():
        yield NoQueries()

    def no_scan(*args, **kwargs):
        pytest.fail("memory admission must precede storage scans")

    app.dependency_overrides[get_db] = no_queries
    monkeypatch.setattr(diagnostics, "storage_usage", no_scan)
    monkeypatch.setattr(diagnostics, "scan_cleanup_candidates", no_scan)
    response = _operator_client().get("/api/internal/diagnostics")
    assert response.status_code == 503
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["Retry-After"] == "30"
    assert set(response.json()) == {"detail"}
    assert client.get("/api/health").status_code == 200
    # Safety refusal is not a public discovery oracle.
    assert client.get("/api/internal/diagnostics").status_code == 404


def test_full_report_passes_explicit_storage_budgets(client, monkeypatch):
    from app.services import diagnostics

    monkeypatch.setenv("ENABLE_INTERNAL_DIAGNOSTICS", "true")
    get_settings.cache_clear()
    scans = []
    cleanup = []
    real_scan = diagnostics.scan_cleanup_candidates

    def bounded_storage(root, **kwargs):
        scans.append(kwargs)
        return {"file_count": 0, "bytes": 0, "complete": False}

    def bounded_cleanup(db, **kwargs):
        cleanup.append(kwargs)
        return real_scan(db, **kwargs)

    monkeypatch.setattr(diagnostics, "storage_usage", bounded_storage)
    monkeypatch.setattr(diagnostics, "scan_cleanup_candidates", bounded_cleanup)
    response = _operator_client().get("/api/internal/diagnostics")
    assert response.status_code == 200
    assert len(scans) == 4
    assert all(item == {"max_entries": 2000, "time_budget_seconds": 0.15} for item in scans)
    assert len(cleanup) == 1
    assert cleanup[0]["max_files"] == 1000
    assert cleanup[0]["max_entries"] == 2000
    assert cleanup[0]["time_budget_seconds"] == 0.15
    assert all(not item["complete"] for item in response.json()["storage"].values())


def test_postgresql_diagnostics_limits_are_transaction_local(monkeypatch):
    from types import SimpleNamespace
    from app.core.config import Settings
    from app.services.diagnostics import collect_diagnostics

    class StopAfterLimits(Exception):
        pass

    class PostgreSQLSession:
        def __init__(self):
            self.statements = []

        def get_bind(self):
            return SimpleNamespace(dialect=SimpleNamespace(name="postgresql"))

        def execute(self, statement):
            self.statements.append(str(statement))

        def query(self, *args):
            raise StopAfterLimits

    db = PostgreSQLSession()
    with pytest.raises(StopAfterLimits):
        collect_diagnostics(db, Settings())
    assert db.statements == [
        "SET TRANSACTION READ ONLY",
        "SET LOCAL statement_timeout = '1500ms'",
        "SET LOCAL lock_timeout = '1s'",
        "SET LOCAL max_parallel_workers_per_gather = 0",
        "SET LOCAL work_mem = '4MB'",
    ]
