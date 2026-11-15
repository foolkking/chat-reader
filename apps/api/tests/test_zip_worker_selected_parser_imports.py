"""ZIP work must not eagerly load unrelated legacy format implementations."""
import importlib
import json
from pathlib import Path
import subprocess
import sys
import textwrap

import pytest

from test_worker_optional_dependency_imports import _GUARDED_HEADER, _fresh


_UNSELECTED = (
    "app.services.import_pipeline.canjson_parser",
    "app.services.import_pipeline.exporter_aligner",
    "app.services.import_pipeline.exporter_json_parser",
    "app.services.import_pipeline.exporter_markdown_parser",
    "app.services.import_pipeline.source_detector",
    "app.services.import_pipeline.official_json_parser",
    "app.services.import_pipeline.official_normalizer",
    "app.services.import_pipeline.official_primary_path",
    "app.services.exporting.cr_archive",
)


def _real_zip_fresh(tmp_path, body, *arguments):
    # The original passive-import guard forbids every on-disk database. Real
    # canonical commits need owned heading-count scratch and, on Linux, the
    # cold libmagic loader's read-only cache query. Scope both to the actual
    # commit; keep passive imports, other processes and network IO forbidden.
    scratch_guard = """
        import re
        _owned_heading_scratch = None
        def _is_owned_heading_scratch(value):
            if _owned_heading_scratch is None or not isinstance(value, (str, Path)):
                return False
            path = Path(value).resolve()
            root = _owned_heading_scratch.resolve()
            return (
                root.is_relative_to(Path(sys.argv[2]).resolve())
                and path.parent == root
                and re.fullmatch(r"\\.heading-counts-[a-f0-9]{32}\\.sqlite", path.name) is not None
            )
        def _is_readonly_libmagic_discovery(args):
            if sys.platform != "linux" or not isinstance(_owned_heading_scratch, Path):
                return False
            root = _owned_heading_scratch.resolve()
            return (
                root.is_relative_to(Path(sys.argv[2]).resolve())
                and root.is_dir()
                and args == (
                    "/sbin/ldconfig", ["/sbin/ldconfig", "-p"], None,
                    {"LC_ALL": "C", "LANG": "C"},
                )
            )
    """
    clause = 'if event == "sqlite3.connect" and args[0] != ":memory:":'
    process_clause = 'if event in {"subprocess.Popen", "socket.connect"}:'
    assert _GUARDED_HEADER.count(clause) == 1
    assert _GUARDED_HEADER.count(process_clause) == 1
    header = _GUARDED_HEADER.replace(
        clause,
        'if event == "sqlite3.connect" and args[0] != ":memory:" and not _is_owned_heading_scratch(args[0]):',
    ).replace(
        process_clause,
        'if event == "socket.connect" or (event == "subprocess.Popen" and not _is_readonly_libmagic_discovery(args)):',
    )
    result = subprocess.run(
        [
            sys.executable, "-c",
            textwrap.dedent(scratch_guard) + "\n" + textwrap.dedent(header) + "\n" + textwrap.dedent(body),
            str(Path(__file__).resolve().parents[1]), str(tmp_path), *arguments,
        ],
        cwd=tmp_path, capture_output=True, text=True, timeout=20,
        creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


@pytest.mark.parametrize("destination", ["wrong_name", "sibling", "outside_task"])
def test_real_zip_dependency_guard_rejects_nonowned_sqlite(destination, tmp_path):
    result = _real_zip_fresh(tmp_path, """
        import sqlite3
        _owned_heading_scratch = Path(sys.argv[2]) / "imports" / "synthetic-record"
        name = ".heading-counts-" + "0" * 32 + ".sqlite"
        paths = {
            "wrong_name": _owned_heading_scratch / "ordinary-database.sqlite",
            "sibling": _owned_heading_scratch.parent / name,
            "outside_task": Path(sys.argv[2]).parent / name,
        }
        target = paths[sys.argv[3]]
        try:
            sqlite3.connect(str(target))
        except AssertionError as exc:
            assert str(exc) == "Worker dependency fixture attempted external work"
        else:
            raise AssertionError("The task-local scratch guard admitted an unrelated database")
        assert not target.exists()
        print(json.dumps({"unrelated_database_rejected": True}))
    """, destination)
    assert result == {"unrelated_database_rejected": True}


@pytest.mark.parametrize("phase", ["passive", "outside_task", "missing_scratch", "retired"])
def test_real_zip_dependency_guard_rejects_library_discovery_outside_commit(phase, tmp_path):
    result = _real_zip_fresh(tmp_path, """
        import subprocess
        phase = sys.argv[3]
        if phase == "outside_task":
            _owned_heading_scratch = Path(sys.argv[2]).parent
        elif phase == "missing_scratch":
            _owned_heading_scratch = Path(sys.argv[2]) / "imports" / "synthetic-record"
        elif phase == "retired":
            _owned_heading_scratch = Path(sys.argv[2]) / "imports" / "synthetic-record"
            _owned_heading_scratch.mkdir(parents=True)
            _owned_heading_scratch = None
        try:
            subprocess.run(
                ["/sbin/ldconfig", "-p"], check=True,
                env={"LC_ALL": "C", "LANG": "C"},
            )
        except AssertionError as exc:
            assert str(exc) == "Worker dependency fixture attempted external work"
        else:
            raise AssertionError("Library discovery ran outside the owned canonical commit")
        print(json.dumps({"outside_commit_rejected": True}))
    """, phase)
    assert result == {"outside_commit_rejected": True}


@pytest.mark.parametrize("variant", [
    "other_program", "relative_program", "cache_write", "extra_argument",
    "shell", "alternate_executable", "different_cwd", "inherited_env", "injected_env",
])
def test_real_zip_dependency_guard_rejects_other_processes_during_commit(variant, tmp_path):
    result = _real_zip_fresh(tmp_path, """
        import subprocess
        _owned_heading_scratch = Path(sys.argv[2]) / "imports" / "synthetic-record"
        _owned_heading_scratch.mkdir(parents=True)
        variant = sys.argv[3]
        cache = Path(sys.argv[2]) / "must-not-create-cache"
        command = ["/sbin/ldconfig", "-p"]
        kwargs = {"env": {"LC_ALL": "C", "LANG": "C"}}
        if variant == "other_program":
            command = [sys.executable, "-c", "raise AssertionError('must-not-run')"]
        elif variant == "relative_program":
            command = ["ldconfig", "-p"]
        elif variant == "cache_write":
            command = ["/sbin/ldconfig", "-C", str(cache)]
        elif variant == "extra_argument":
            command += ["-v"]
        elif variant == "shell":
            command = "/sbin/ldconfig -p"
            kwargs["shell"] = True
        elif variant == "alternate_executable":
            kwargs["executable"] = sys.executable
        elif variant == "different_cwd":
            kwargs["cwd"] = sys.argv[2]
        elif variant == "inherited_env":
            kwargs["env"] = None
        elif variant == "injected_env":
            kwargs["env"]["LD_PRELOAD"] = "must-not-load"
        try:
            subprocess.run(command, check=True, **kwargs)
        except AssertionError as exc:
            assert str(exc) == "Worker dependency fixture attempted external work"
        else:
            raise AssertionError("The canonical guard admitted another process")
        assert not cache.exists()
        print(json.dumps({"other_process_rejected": True}))
    """, variant)
    assert result == {"other_process_rejected": True}


def test_real_zip_dependency_guard_still_rejects_network_during_commit(tmp_path):
    result = _real_zip_fresh(tmp_path, """
        _owned_heading_scratch = Path(sys.argv[2]) / "imports" / "synthetic-record"
        _owned_heading_scratch.mkdir(parents=True)
        connection = socket.socket()
        try:
            connection.connect(("127.0.0.1", 1))
        except AssertionError as exc:
            assert str(exc) == "Worker dependency fixture attempted external work"
        else:
            raise AssertionError("The canonical guard admitted a network connection")
        finally:
            connection.close()
        print(json.dumps({"network_rejected": True}))
    """)
    assert result == {"network_rejected": True}


def test_real_zip_dependency_guard_admits_only_owned_linux_cache_read(tmp_path):
    result = _real_zip_fresh(tmp_path, """
        import subprocess
        _owned_heading_scratch = Path(sys.argv[2]) / "imports" / "synthetic-record"
        _owned_heading_scratch.mkdir(parents=True)
        try:
            command = ["/sbin/ldconfig", "-p"]
            kwargs = {"env": {"LC_ALL": "C", "LANG": "C"}}
            if sys.platform == "linux":
                cache = subprocess.run(
                    command, check=True, stdin=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL, stdout=subprocess.PIPE, **kwargs,
                )
                assert b"libmagic.so.1" in cache.stdout
            else:
                try:
                    subprocess.run(command, check=True, **kwargs)
                except AssertionError as exc:
                    assert str(exc) == "Worker dependency fixture attempted external work"
                else:
                    raise AssertionError("A non-Linux process was admitted")
        finally:
            _owned_heading_scratch = None
        print(json.dumps({"readonly_cache_allowed": sys.platform == "linux"}))
    """)
    assert result == {"readonly_cache_allowed": sys.platform == "linux"}


@pytest.mark.parametrize("module", [
    "app.services.adaptive_import.profiles",
    "app.services.adaptive_import.service",
    "app.services.canonical.persistence",
    "app.services.import_queue",
])
def test_passive_zip_path_does_not_load_unselected_formats(module, tmp_path):
    result = _fresh(tmp_path, """
        blocked += tuple(json.loads(sys.argv[4]))
        import sqlalchemy
        sqlalchemy.engine.Engine.connect = forbidden
        importlib.import_module(sys.argv[3])
        assert not any(name in sys.modules for name in blocked)
        print(json.dumps({"module": sys.argv[3], "unselected_formats_loaded": False}))
    """, module, json.dumps(_UNSELECTED))
    assert result == {"module": module, "unselected_formats_loaded": False}


@pytest.mark.parametrize("bounded", [False, True])
def test_real_dedicated_zip_analysis_and_commit_keep_selected_formats_and_source(bounded, tmp_path):
    result = _real_zip_fresh(tmp_path, """
        blocked += tuple(json.loads(sys.argv[4]))
        import hashlib
        import uuid
        from sqlalchemy import create_engine, event
        from sqlalchemy.orm import sessionmaker
        from app.core.database import Base
        from app.models.user import User
        from app.models.background_job import BackgroundJob
        from app.models.import_record import ImportRecord
        from app.models.conversation import Conversation
        from app.models.message import Message
        from app.models.render_block import RenderBlock
        from app.models.attachment import AssetObject, Attachment, MessageVersionAttachment
        from app.models.task_execution_control import TaskExecutionControl
        from app.services.adaptive_import import service
        from app.services.background_jobs import process_background_job
        from app.services.execution_control import SLOT
        from app.services.execution_reconciliation import reconcile
        from app.services.import_queue import queue_import
        from app.services.canonical.persistence import commit_import_preview
        from app.services.worker_supervisor import claim
        from scripts.verify_small_zip_memory import synthetic_zip

        bounded = sys.argv[3] == "true"
        settings.import_storage_dir = str(Path(sys.argv[2]) / "imports")
        settings.import_bounded_zip_enabled = bounded
        settings.allow_unscanned_attachments = True
        engine = create_engine("sqlite:///:memory:")
        @event.listens_for(engine, "connect")
        def foreign_keys(connection, _):
            connection.execute("PRAGMA foreign_keys=ON")
        Base.metadata.create_all(engine)
        factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
        content = synthetic_zip()
        source_hash = hashlib.sha256(content).hexdigest()
        with factory() as db:
            owner = User(role="ADMIN", status="ACTIVE")
            db.add(owner)
            db.flush()
            record = service.begin_session(db, 1, owner_user_id=owner.id)
            service.add_session_source(db, record, "synthetic-memory.zip", content)
            job = service.queue_session_analysis(db, record)
            record_id, job_id = record.id, job.id
            db.commit()
        with factory() as db:
            kind, claimed, token = claim(db)
            assert kind == "job" and claimed == job_id
        with factory() as db:
            row = db.get(BackgroundJob, job_id)
            execution = (row.attempt_count, row.started_at, row.payload["execution_token"])
        process_background_job(job_id, factory, expected_execution=execution)
        assert reconcile("job", job_id, token, factory)
        with factory() as db:
            row = db.get(BackgroundJob, job_id)
            record = db.get(ImportRecord, record_id)
            assert row.status == "committed", row.error_message
            assert record.session_state == "READY"
            assert record.structure_families[0].matched_profile_key == "builtin:conversation-zip-markdown-v1"
            assert (record.draft_summary.get("format_version") or 1) == (2 if bounded else 1)
            queue_import(record, db)
            db.commit()
        with factory() as db:
            kind, claimed, token = claim(db)
            assert kind == "import" and claimed == record_id
        # Memory SQLite has one physical connection. Use the real canonical
        # transaction without the PostgreSQL-only independent progress lane.
        _owned_heading_scratch = Path(settings.import_storage_dir) / str(record_id)
        try:
            with factory() as db:
                committed = commit_import_preview(record_id, db)
        finally:
            _owned_heading_scratch = None
        assert committed.message_count == 4
        assert reconcile("import", record_id, token, factory)
        with factory() as db:
            record = db.get(ImportRecord, record_id)
            assert record.status == "committed" and record.session_state == "COMPLETED"
            assert db.get(TaskExecutionControl, SLOT).finished_at is not None
            assert db.query(Conversation).count() == 1 and db.query(Message).count() == 4
            assert db.query(RenderBlock).count() == 177
            assert db.query(Attachment).count() == 14 and db.query(AssetObject).count() == 14
            assert db.query(MessageVersionAttachment).count() == 13
        sources = list(Path(settings.import_storage_dir).glob("**/*.zip"))
        assert len(sources) == 1 and hashlib.sha256(sources[0].read_bytes()).hexdigest() == source_hash
        assert not any(name in sys.modules for name in blocked)
        engine.dispose()
        print(json.dumps({"bounded": bounded, "canonical_messages": 4,
                          "unselected_formats_loaded": False, "source_preserved": True}))
    """, "true" if bounded else "false", json.dumps(_UNSELECTED))
    assert result == {
        "bounded": bounded, "canonical_messages": 4,
        "unselected_formats_loaded": False, "source_preserved": True,
    }


@pytest.mark.parametrize(("module", "name", "provider"), [
    ("app.services.adaptive_import.profiles", "CanJsonParseError", "app.services.import_pipeline.canjson_parser"),
    ("app.services.adaptive_import.profiles", "parse_canjson_v1", "app.services.import_pipeline.canjson_parser"),
    ("app.services.adaptive_import.profiles", "parse_canjson_v2", "app.services.import_pipeline.canjson_parser"),
    ("app.services.adaptive_import.profiles", "align_exporter_sources", "app.services.import_pipeline.exporter_aligner"),
    ("app.services.adaptive_import.profiles", "ExporterJsonParseError", "app.services.import_pipeline.exporter_json_parser"),
    ("app.services.adaptive_import.profiles", "parse_exporter_json", "app.services.import_pipeline.exporter_json_parser"),
    ("app.services.adaptive_import.profiles", "ExporterMarkdownPairingError", "app.services.import_pipeline.exporter_markdown_parser"),
    ("app.services.adaptive_import.profiles", "parse_exporter_markdown", "app.services.import_pipeline.exporter_markdown_parser"),
    ("app.services.adaptive_import.profiles", "detect_source_profile", "app.services.import_pipeline.source_detector"),
    ("app.services.canonical.persistence", "align_exporter_sources", "app.services.import_pipeline.exporter_aligner"),
    ("app.services.canonical.persistence", "parse_exporter_json", "app.services.import_pipeline.exporter_json_parser"),
    ("app.services.canonical.persistence", "parse_exporter_markdown", "app.services.import_pipeline.exporter_markdown_parser"),
    ("app.services.canonical.persistence", "OfficialConversationResult", "app.services.import_pipeline.official_json_parser"),
    ("app.services.canonical.persistence", "parse_official_json", "app.services.import_pipeline.official_json_parser"),
    ("app.services.canonical.persistence", "_extract_content", "app.services.import_pipeline.official_normalizer"),
    ("app.services.canonical.persistence", "_metadata_preview", "app.services.import_pipeline.official_normalizer"),
    ("app.services.canonical.persistence", "resolve_primary_path", "app.services.import_pipeline.official_primary_path"),
    ("app.services.canonical.persistence", "CrArchiveError", "app.services.exporting.cr_archive"),
    ("app.services.canonical.persistence", "import_cr_archive", "app.services.exporting.cr_archive"),
])
def test_explicit_legacy_parser_reexports_keep_real_objects(module, name, provider):
    assert getattr(importlib.import_module(module), name) is getattr(importlib.import_module(provider), name)
