from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import event

from app.core.config import get_settings
from app.core.database import get_db
from app.main import app
from app.models.background_job import BackgroundJob
from app.models.import_record import ImportRecord
from app.services.diagnostics import storage_usage
from test_import_preview_api import client  # noqa: F401


def test_internal_diagnostics_disabled_by_default(client: TestClient, monkeypatch) -> None:
    monkeypatch.setenv("ENABLE_INTERNAL_DIAGNOSTICS", "false")
    get_settings.cache_clear()
    response = client.get("/api/internal/diagnostics")
    assert response.status_code == 404


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
            ImportRecord(
                source_profile="fixture",
                source_fingerprint="opaque",
                status="failed",
                phase="failed",
                attempt_count=3,
                json_filename="private-name.json",
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
        response = client.get("/api/internal/diagnostics")
    finally:
        event.remove(engine, "before_cursor_execute", record_statement)
        db.close()
        generator.close()
    assert response.status_code == 200
    payload = response.json()
    assert payload["jobs"]["status_counts"]["queued"] == 1
    assert payload["imports"]["retry_exhausted"] == 1
    assert payload["storage"]["assets"]["file_count"] == 1
    assert payload["artifacts"]["cleanup_scan_complete"] is True
    serialized = json.dumps(payload)
    assert "sensitive-filename" not in serialized
    assert "private conversation content" not in serialized
    assert "private-name.json" not in serialized
    assert "storage_uri" not in serialized
    assert "token" not in serialized.casefold()
    assert len(statements) <= 24
    assert not any("messages" in statement.casefold() for statement in statements)


def test_health_remains_separate_from_diagnostics(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert set(response.json()) == {"status", "service", "stage"}


def test_storage_usage_stops_at_the_configured_entry_budget(tmp_path: Path) -> None:
    for index in range(5):
        (tmp_path / f"file-{index}.bin").write_bytes(b"x")
    result = storage_usage(tmp_path, max_entries=3)
    assert result == {"file_count": 3, "bytes": 3, "complete": False}
