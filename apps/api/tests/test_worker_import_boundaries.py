"""Cold import boundaries, without starting workers, services or PostgreSQL."""
import json
from pathlib import Path
import subprocess
import sys
import textwrap

import pytest


@pytest.mark.parametrize("module", [
    "app.services.background_jobs",
    "app.services.worker_maintenance",
    "app.services.execution_reconciliation",
    "app.workers.execution_child",
    "app.services.content_cleanup",
])
def test_passive_worker_import_does_not_load_unselected_handlers(module, tmp_path):
    script = textwrap.dedent("""
        import importlib
        import importlib.abc
        import json
        import platform
        import socket
        import sys
        platform.uname()  # Windows' read-only OS detection precedes the guard.
        sys.path.insert(0, sys.argv[1])
        from app.core import config
        settings = config.Settings(
            _env_file=None,
            DATABASE_URL="sqlite:///:memory:",
            AUTH_SESSION_SECRET="synthetic-cold-worker-import-boundary",
        )
        config.get_settings = lambda: settings

        def forbidden(*args, **kwargs):
            raise AssertionError("Passive import attempted external work")

        socket.socket.connect = forbidden
        socket.socket.connect_ex = forbidden
        socket.create_connection = forbidden
        import sqlalchemy
        sqlalchemy.engine.Engine.connect = forbidden
        sys.addaudithook(lambda event, args: forbidden()
                        if event in {"subprocess.Popen", "socket.connect", "sqlite3.connect"} else None)

        blocked = (
            "app.services.editing.message_edit_service",
            "app.services.exporting.archive_jobs",
            "app.services.exporting.system_archive_jobs",
            "app.services.exporting.system_archive",
            "app.services.exporting.cr_archive",
            "app.services.exporting.context_package",
            "app.services.exporting.attachment_download",
            "app.services.offline_packages",
            "app.services.content_cleanup",
            "app.services.derived_rebuild",
            "app.services.user_deletion",
            "app.services.assets.derivatives",
            "app.services.assets.upload_service",
            "app.services.assets.lifecycle",
            "app.services.sharing.share_service",
            "app.services.search.search_indexer",
        )
        blocked = tuple(name for name in blocked if name != sys.argv[2])

        class HandlerGuard(importlib.abc.MetaPathFinder):
            def find_spec(self, fullname, path=None, target=None):
                if any(fullname == name or fullname.startswith(name + ".") for name in blocked):
                    raise AssertionError("Unselected handler imported: " + fullname)

        sys.meta_path.insert(0, HandlerGuard())
        target = importlib.import_module(sys.argv[2])
        assert not any(name in sys.modules for name in blocked)
        if sys.argv[2] == "app.services.background_jobs":
            from app.services.editing.errors import MessageEditError
            assert target.MessageEditError is MessageEditError
            assert target.PERSONAL_JOB_TYPES == (
                "personal_archive_export", "personal_archive_preflight", "personal_archive_restore",
            )
            assert target.SYSTEM_JOB_TYPES == (
                "system_archive_export", "system_archive_preflight", "system_archive_restore",
            )
            assert callable(target.process_background_job)
        print(json.dumps({"module": sys.argv[2], "unselected_handlers_loaded": False,
                          "external_work_permitted": False}))
    """)
    result = subprocess.run(
        [sys.executable, "-c", script, str(Path(__file__).resolve().parents[1]), module],
        cwd=tmp_path, capture_output=True, text=True, timeout=15,
        creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
    )
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == {
        "module": module, "unselected_handlers_loaded": False, "external_work_permitted": False,
    }


@pytest.mark.parametrize(("name", "module"), [
    ("process_scan_chunk", "app.services.content_cleanup"),
    ("rebuild_conversation_derived_data", "app.services.derived_rebuild"),
    ("delete_conversation_record", "app.services.conversations.conversation_deletion"),
    ("execute_user_account_delete", "app.services.user_deletion"),
    ("cleanup_deleted_account_assets", "app.services.user_deletion"),
])
def test_existing_worker_instrumentation_seams_keep_results_and_exceptions(name, module, monkeypatch):
    import importlib
    from app.services import background_jobs

    service = importlib.import_module(module)
    calls = []
    sentinel = object()

    def delegated(*args, **kwargs):
        calls.append((args, kwargs))
        return sentinel

    monkeypatch.setattr(service, name, delegated)
    seam = getattr(background_jobs, name)
    assert seam(sentinel, selected=True) is sentinel
    assert calls == [((sentinel,), {"selected": True})]

    error = RuntimeError("synthetic delegate failure")

    def failed(*args, **kwargs):
        raise error

    monkeypatch.setattr(service, name, failed)
    with pytest.raises(RuntimeError) as caught:
        seam(sentinel, selected=True)
    assert caught.value is error


def test_message_edit_error_reexport_keeps_identity_and_public_detail():
    from app.services.background_jobs import MessageEditError as worker_error
    from app.services.editing.errors import MessageEditError
    from app.services.editing.message_edit_service import MessageEditError as original_import

    assert original_import is worker_error is MessageEditError
    plain = MessageEditError("Synthetic validation")
    assert plain.status_code == 400
    assert plain.detail == str(plain) == "Synthetic validation"
    detailed = MessageEditError("Synthetic conflict", 409, code="SOURCE_BASELINE_CHANGED", line_number=2)
    assert detailed.status_code == 409
    assert detailed.detail == {
        "code": "SOURCE_BASELINE_CHANGED", "message": "Synthetic conflict", "line_number": 2,
    }


@pytest.mark.parametrize(("name", "module"), [
    ("_create_version", "app.services.editing.message_edit_service"),
    ("_get_current_version", "app.services.editing.message_edit_service"),
    ("_write_event", "app.services.editing.message_edit_service"),
    ("rebuild_search_and_toc_for_conversation", "app.services.search.search_indexer"),
])
def test_cleanup_write_seams_are_lazy_and_preserve_instrumentation(name, module, monkeypatch):
    import importlib
    from app.services import content_cleanup

    service = importlib.import_module(module)
    sentinel = object()
    calls = []

    def delegated(*args, **kwargs):
        calls.append((args, kwargs))
        return sentinel

    monkeypatch.setattr(service, name, delegated)
    assert getattr(content_cleanup, name)(sentinel, selected=True) is sentinel
    assert calls == [((sentinel,), {"selected": True})]
