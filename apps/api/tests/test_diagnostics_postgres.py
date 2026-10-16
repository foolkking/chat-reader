"""Real timeout/transaction and exact health SQL semantics in a disposable DB."""
import os
from pathlib import Path
import re

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.services import diagnostics
from test_import_profile_postgres import isolated_schema  # noqa: F401

pytestmark = pytest.mark.skipif(
    os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1",
    reason="requires explicitly selected disposable PostgreSQL",
)


def test_diagnostic_limits_are_enforced_and_do_not_leak_after_rollback(isolated_schema, monkeypatch, tmp_path):
    engine, migrate = isolated_schema
    migrate("head")
    monkeypatch.setattr(diagnostics, "available_memory_bytes", lambda: 1024**3)
    settings = Settings(
        import_storage_dir=str(tmp_path / "imports"), export_storage_dir=str(tmp_path / "exports"),
        offline_storage_dir=str(tmp_path / "offline"), asset_storage_dir=str(tmp_path / "assets"),
    )
    with Session(engine) as db:
        baseline = {key: db.scalar(text(f"SHOW {key}")) for key in (
            "statement_timeout", "lock_timeout", "work_mem", "max_parallel_workers_per_gather",
        )}
        db.rollback()
        payload = diagnostics.collect_diagnostics(db, settings)
        assert payload["system"]["worker_state"] == "unavailable"
        assert db.scalar(text("SHOW transaction_read_only")) == "on"
        assert db.scalar(text("SHOW statement_timeout")) == "1500ms"
        assert db.scalar(text("SHOW lock_timeout")) == "1s"
        assert db.scalar(text("SHOW work_mem")) == "4MB"
        assert db.scalar(text("SHOW max_parallel_workers_per_gather")) == "0"
        with pytest.raises(DBAPIError) as failure:
            db.execute(text("SELECT pg_sleep(3)"))
        assert failure.value.orig.sqlstate == "57014"  # query_cancelled, not a connection failure
        db.rollback()
        assert db.scalar(text("SHOW transaction_read_only")) == "off"
        assert {key: db.scalar(text(f"SHOW {key}")) for key in baseline} == baseline


def test_lightweight_health_sql_rejects_future_stale_and_missing_heartbeats(isolated_schema):
    engine, _ = isolated_schema
    source = (Path(__file__).resolve().parents[3] / "deploy" / "verify_runtime_health.sh").read_text(encoding="utf-8")
    sql = re.search(r'"(SELECT CASE.*?)"\)', source, re.S).group(1).replace("$stale_after", "120")
    with engine.begin() as db:
        # Nullable/unknown states exercise fail-closed branches beyond the
        # canonical table constraints, without weakening the real schema.
        db.execute(text("CREATE TEMP TABLE worker_runtime_states (worker_key text, state text, heartbeat_at timestamptz)"))
        assert db.execute(text(sql)).scalar() is None
        for state, heartbeat, expected in (
            ("idle", "CURRENT_TIMESTAMP", "alive_idle"),
            ("busy", "CURRENT_TIMESTAMP - interval '119 seconds'", "alive_busy"),
            ("idle", "CURRENT_TIMESTAMP - interval '120 seconds'", "stale"),
            ("idle", "CURRENT_TIMESTAMP - interval '121 seconds'", "stale"),
            ("idle", "CURRENT_TIMESTAMP + interval '1 second'", "stale"),
            ("idle", "NULL", "stale"),
            ("unknown", "CURRENT_TIMESTAMP", "unavailable"),
        ):
            db.execute(text("DELETE FROM worker_runtime_states"))
            db.execute(text(
                f"INSERT INTO worker_runtime_states VALUES ('primary', :state, {heartbeat})"
            ), {"state": state})
            assert db.scalar(text(sql)) == expected
