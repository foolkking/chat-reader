"""Real in-memory ORM controls for the disposable memory-gate status helper.

These control-plane tests do not run a worker or measure Linux cgroup memory.
They use only runtime dependencies, so the exact release image can run them.
"""
from __future__ import annotations

from contextlib import redirect_stdout
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import uuid

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import app.models  # Register the same model graph used by the application.
from app.core.config import get_settings
from app.core.database import Base
from app.models.background_job import BackgroundJob
from app.models.import_record import ImportRecord
from app.models.user import User
from scripts import verify_bounded_zip_memory, verify_small_zip_memory


class MemoryGateStatusTests(unittest.TestCase):
    def setUp(self):
        root = os.environ.get("TEMP") or os.environ.get("RUNNER_TEMP")
        if not root or not Path(root).is_dir():
            self.fail("Set an explicit existing task TEMP before running these controls.")
        self.directory = tempfile.TemporaryDirectory(prefix="memory-helper-", dir=root)
        def cleanup_directory():
            path = Path(self.directory.name)
            self.assertFalse(path.is_symlink())
            self.assertTrue(path.resolve().is_relative_to(Path(root).resolve()))
            self.directory.cleanup()
        self.addCleanup(cleanup_directory)
        self.engine = create_engine("sqlite+pysqlite:///:memory:")
        self.addCleanup(self.engine.dispose)
        Base.metadata.create_all(self.engine)
        self.factory = sessionmaker(bind=self.engine)
        self.settings = get_settings().model_copy(update={
            "app_env": "test",
            "database_url": "postgresql+psycopg://synthetic@127.0.0.1/chat_reader",
        })
        with self.factory() as db:
            user = User(display_name="Synthetic status control", role="ADMIN", status="ACTIVE")
            db.add(user)
            db.flush()
            record = ImportRecord(
                owner_user_id=user.id,
                source_profile="synthetic-memory-control",
                source_fingerprint="synthetic-memory-control",
                status="previewed",
                session_state="ANALYZING",
            )
            job = BackgroundJob(
                owner_user_id=user.id,
                job_type="adaptive_import_analysis",
                status="queued",
            )
            db.add_all([record, job])
            db.commit()
            self.record_id, self.job_id = record.id, job.id
        self.state = Path(self.directory.name) / "state.json"
        self.state.write_text(
            json.dumps(
                {
                    "import_id": str(self.record_id),
                    "job_id": str(self.job_id),
                    "expected": {"messages": 4, "attachments": 14, "references": 13},
                }
            ),
            encoding="utf-8",
        )

    def run_status(self, *, summary, analysis="processing", state="ANALYZING",
                   import_status="previewed", bounded=False):
        with self.factory() as db:
            record = db.get(ImportRecord, self.record_id)
            record.analysis_summary = summary
            record.session_state = state
            record.status = import_status
            db.get(BackgroundJob, self.job_id).status = analysis
            db.commit()
        helper = verify_bounded_zip_memory if bounded else verify_small_zip_memory
        settings = self.settings.model_copy(update={
            "database_url": self.settings.database_url + ("_bounded_small" if bounded else ""),
        })
        output = io.StringIO()
        with (
            patch.dict(os.environ, {
                "APP_ENV": "test", "SMALL_IMPORT_MEMORY_GATE": "1",
                "BOUNDED_IMPORT_CASE": "small",
            }),
            patch("app.core.config.get_settings", return_value=settings),
            patch("app.core.database.SessionLocal", self.factory),
            patch.object(helper, "STATE", self.state),
            patch("sys.argv", ["memory-status-control", "status"]),
            redirect_stdout(output),
        ):
            helper.main()
        return json.loads(output.getvalue())

    def test_null_or_missing_failure_is_a_valid_read_only_status(self):
        # Include all three normal analysis phases and actual persisted JSON null.
        for summary in (None, {}, {"failure": None}, {"failure": {}}):
            for analysis, state in (
                ("queued", "ANALYZING"), ("processing", "ANALYZING"), ("committed", "READY"),
            ):
                with self.subTest(summary=summary, analysis=analysis):
                    result = self.run_status(summary=summary, analysis=analysis, state=state)
                    self.assertEqual(result, {
                        "analysis": analysis, "state": state,
                        "import": "previewed", "failure_code": None,
                    })
                    with self.factory() as db:
                        self.assertEqual(db.get(ImportRecord, self.record_id).analysis_summary, summary)
                        self.assertEqual(db.get(BackgroundJob, self.job_id).status, analysis)
                        self.assertEqual(db.query(ImportRecord).count(), 1)
                        self.assertEqual(db.query(BackgroundJob).count(), 1)

    def test_real_failure_codes_and_terminal_states_are_not_hidden(self):
        for analysis in ("failed", "cancelled"):
            for code in ("UPLOAD_MEMORY_PRESSURE", "SMALL_IMPORT_BUDGET_EXCEEDED", "TASK_FAILED"):
                with self.subTest(analysis=analysis, code=code):
                    result = self.run_status(
                        summary={"failure": {"code": code, "stage": "analysis", "retryable": False}},
                        analysis=analysis, state="FAILED", import_status="failed",
                    )
                    self.assertEqual(result, {
                        "analysis": analysis, "state": "FAILED",
                        "import": "failed", "failure_code": code,
                    })

    def test_small_and_bounded_status_have_the_same_failure_contract(self):
        for summary in (None, {}, {"failure": None}, {"failure": {}},
                        {"failure": {"code": "TASK_FAILED"}}):
            with self.subTest(summary=summary):
                self.assertEqual(
                    self.run_status(summary=summary),
                    self.run_status(summary=summary, bounded=True),
                )

    def test_nonempty_malformed_failure_is_not_silently_accepted(self):
        for failure in ("invalid", ["invalid"], 1):
            with self.subTest(failure=failure):
                with self.assertRaises(AttributeError):
                    self.run_status(summary={"failure": failure})

    def test_disappeared_task_remains_an_error(self):
        data = json.loads(self.state.read_text(encoding="utf-8"))
        data["job_id"] = str(uuid.uuid4())
        self.state.write_text(json.dumps(data), encoding="utf-8")
        with self.assertRaisesRegex(SystemExit, "Synthetic task disappeared"):
            self.run_status(summary={"failure": None})

    def test_non_ci_environment_is_rejected_before_orm_access(self):
        for app_env, flag in (("production", "1"), ("test", "0"), ("test", "")):
            with self.subTest(app_env=app_env, flag=flag):
                with (
                    patch.dict(os.environ, {"APP_ENV": app_env, "SMALL_IMPORT_MEMORY_GATE": flag}),
                    patch("app.core.database.SessionLocal", side_effect=AssertionError("ORM entered")),
                    patch("sys.argv", ["memory-status-control", "status"]),
                    self.assertRaisesRegex(SystemExit, "restricted"),
                ):
                    verify_small_zip_memory.main()

    def test_non_disposable_database_is_rejected_before_orm_access(self):
        for url in (
            "postgresql+psycopg://synthetic@production.invalid/chat_reader",
            "postgresql+psycopg://synthetic@127.0.0.1/production",
        ):
            with self.subTest(url=url):
                with (
                    patch.dict(os.environ, {"APP_ENV": "test", "SMALL_IMPORT_MEMORY_GATE": "1"}),
                    patch("app.core.config.get_settings",
                          return_value=self.settings.model_copy(update={"database_url": url})),
                    patch("app.core.database.SessionLocal", side_effect=AssertionError("ORM entered")),
                    patch("sys.argv", ["memory-status-control", "status"]),
                    self.assertRaisesRegex(SystemExit, "disposable"),
                ):
                    verify_small_zip_memory.main()


if __name__ == "__main__":
    unittest.main()
