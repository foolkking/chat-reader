"""Fresh worker/read paths must not start the API or remote-scanner dependencies."""
import json
from pathlib import Path
import subprocess
import sys
import textwrap

import pytest


_GUARDED_HEADER = """
    import importlib
    import importlib.abc
    import json
    from pathlib import Path
    import platform
    import socket
    import sys
    platform.uname()  # Read-only Windows OS detection precedes the audit guard.
    sys.path.insert(0, sys.argv[1])
    from app.core import config
    settings = config.Settings(
        _env_file=None, DATABASE_URL="sqlite:///:memory:",
        AUTH_SESSION_SECRET="synthetic-optional-worker-dependency",
        REMOTE_SCANNER_URL=None, REMOTE_SCANNER_TOKEN=None,
        OFFLINE_STORAGE_DIR=str(Path(sys.argv[2]) / "packages"),
        ASSET_STORAGE_DIR=str(Path(sys.argv[2]) / "assets"),
    )
    config.get_settings = lambda: settings

    def forbidden(*args, **kwargs):
        raise AssertionError("Worker dependency fixture attempted external work")

    socket.socket.connect = forbidden
    socket.socket.connect_ex = forbidden
    socket.create_connection = forbidden
    def audit(event, args):
        if event in {"subprocess.Popen", "socket.connect"}:
            forbidden()
        if event == "sqlite3.connect" and args[0] != ":memory:":
            forbidden()
    sys.addaudithook(audit)
    blocked = ("fastapi", "httpx")
    class DependencyGuard(importlib.abc.MetaPathFinder):
        def find_spec(self, fullname, path=None, target=None):
            if any(fullname == name or fullname.startswith(name + ".") for name in blocked):
                raise AssertionError("Unselected optional dependency imported: " + fullname)
    sys.meta_path.insert(0, DependencyGuard())
"""


def _fresh(tmp_path, body, *arguments):
    result = subprocess.run(
        [
            sys.executable, "-c",
            textwrap.dedent(_GUARDED_HEADER) + "\n" + textwrap.dedent(body),
            str(Path(__file__).resolve().parents[1]), str(tmp_path), *arguments,
        ],
        cwd=tmp_path, capture_output=True, text=True, timeout=20,
        creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


@pytest.mark.parametrize("module", [
    "app.core.observability",
    "app.services.ownership",
    "app.services.subject_account",
    "app.services.worker_maintenance",
    "app.services.execution_control",
    "app.services.background_jobs",
    "app.services.worker_liveness",
    "app.services.assets.scanner",
    "app.services.offline_packages",
    "app.services.export_retention",
])
def test_passive_worker_path_does_not_load_api_or_remote_scanner(module, tmp_path):
    assert _fresh(tmp_path, """
        import sqlalchemy
        sqlalchemy.engine.Engine.connect = forbidden
        importlib.import_module(sys.argv[3])
        assert not any(name in sys.modules for name in blocked)
        print(json.dumps({"module": sys.argv[3], "unselected_dependencies_loaded": False}))
    """, module) == {"module": module, "unselected_dependencies_loaded": False}


@pytest.mark.parametrize("module", ["app.core.observability", "app.services.ownership"])
def test_request_type_is_still_fastapis_exact_starlette_reexport(module):
    import importlib
    from fastapi import Request as api_request
    from starlette.requests import Request as underlying_request

    assert importlib.import_module(module).Request is api_request is underlying_request


def test_auth_disabled_account_boundary_needs_no_api_or_database(tmp_path):
    assert _fresh(tmp_path, """
        import sqlalchemy
        sqlalchemy.engine.Engine.connect = forbidden
        settings.auth_enabled = False
        from app.services.subject_account import lock_subject_account
        lock_subject_account(None, "synthetic-development-namespace")
        assert not any(name in sys.modules for name in blocked)
        print(json.dumps({"database_access": False, "api_loaded": False}))
    """) == {"database_access": False, "api_loaded": False}


def test_unconfigured_remote_scanner_rejects_without_importing_http_client(tmp_path):
    assert _fresh(tmp_path, """
        from app.services.assets.scanner import AssetScanError, RemoteScanner
        try:
            RemoteScanner().scan(Path(sys.argv[2]) / "must-not-open")
        except AssetScanError as error:
            assert str(error) == "Remote scanner URL is not configured."
        else:
            raise AssertionError("An unconfigured remote scanner was accepted")
        assert not any(name in sys.modules for name in blocked)
        print(json.dumps({"remote_config_required": True, "http_client_loaded": False}))
    """) == {"remote_config_required": True, "http_client_loaded": False}


@pytest.mark.parametrize(("account", "allow_inactive", "denied"), [
    ("active", False, False),
    ("disabled", False, True),
    ("disabled", True, False),
    ("missing", False, True),
    ("missing", True, True),
    ("invalid", False, True),
])
def test_selected_account_boundary_keeps_exact_api_exception(account, allow_inactive, denied, monkeypatch):
    import uuid
    from types import SimpleNamespace
    from fastapi import HTTPException
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from app.core.database import Base
    from app.models.user import User
    from app.services import subject_account

    monkeypatch.setattr(subject_account, "get_settings", lambda: SimpleNamespace(auth_enabled=True))
    engine = create_engine("sqlite:///:memory:")
    try:
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            owner = uuid.uuid4()
            if account in {"active", "disabled"}:
                db.add(User(id=owner, role="USER", status="ACTIVE" if account == "active" else "DISABLED"))
                db.commit()
            subject = "synthetic-invalid-account" if account == "invalid" else str(owner)
            if denied:
                with pytest.raises(HTTPException) as caught:
                    subject_account.lock_subject_account(db, subject, allow_inactive=allow_inactive)
                assert type(caught.value) is HTTPException
                assert caught.value.status_code == 401
                assert caught.value.detail == "Account is no longer available."
            else:
                assert subject_account.lock_subject_account(db, subject, allow_inactive=allow_inactive) is None
    finally:
        engine.dispose()


@pytest.mark.parametrize("scope", ["conversation", "project", "all"])
@pytest.mark.parametrize("asset_mode", ["none", "small", "all"])
def test_actual_offline_job_keeps_owned_v3_content_without_optional_dependencies(
    scope, asset_mode, tmp_path,
):
    result = _fresh(tmp_path, """
        from datetime import datetime, timezone
        import hashlib
        import uuid
        from zipfile import ZipFile
        from sqlalchemy import create_engine, event
        from sqlalchemy.orm import sessionmaker
        from app.core.database import Base
        from app.models.annotation import ConversationAnnotation, ConversationNotebook
        from app.models.background_job import BackgroundJob
        from app.models.conversation import Conversation
        from app.models.message import Message
        from app.models.message_version import MessageVersion
        from app.models.offline_package_artifact import OfflinePackageArtifact
        from app.models.project import Project
        from app.models.project_conversation import ProjectConversation
        from app.models.source_message_ref import SourceMessageRef
        from app.models.task_execution_control import TaskExecutionControl
        from app.models.user import User
        from app.services.background_jobs import queue_offline_package, process_background_job
        from app.services.execution_control import SLOT
        from app.services.execution_reconciliation import reconcile
        from app.services.ownership import OwnershipScope
        from app.services.worker_supervisor import claim

        engine = create_engine("sqlite:///:memory:")
        @event.listens_for(engine, "connect")
        def enable_foreign_keys(connection, _):
            connection.execute("PRAGMA foreign_keys=ON")
        Base.metadata.create_all(engine)
        factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
        now = datetime.now(timezone.utc)
        owner, other_owner = uuid.uuid4(), uuid.uuid4()
        owned_ids, messages = [], {}
        scope, asset_mode = sys.argv[3:5]
        with factory() as db:
            db.add_all([User(id=owner, role="ADMIN"), User(id=other_owner, role="USER")])
            db.flush()
            project = Project(owner_user_id=owner, name="Synthetic owned project",
                              description="Synthetic project context")
            db.add(project)
            db.flush()
            for index, account in enumerate((owner, owner, other_owner)):
                conversation = Conversation(owner_user_id=account,
                    title=f"Synthetic conversation {index}", display_title=f"Synthetic conversation {index}",
                    source_type="manual", source_profile="manual", parser_version="synthetic-v1",
                    message_count=2, turn_count=1, created_at=now, updated_at=now, sort_time=now)
                db.add(conversation)
                db.flush()
                if account != owner:
                    continue
                owned_ids.append(conversation.id)
                db.add(ProjectConversation(conversation_id=conversation.id, project_id=project.id))
                for sequence, role in enumerate(("user", "assistant"), start=1):
                    body = f"Synthetic {role} {index}"
                    message = Message(conversation_id=conversation.id, role=role,
                        order_key=str(sequence), turn_index=0, created_at=now, char_count=len(body))
                    db.add(message)
                    db.flush()
                    version = MessageVersion(message_id=message.id, version_number=1, plain_text=body,
                        display_text=body, content_hash=hashlib.sha256(body.encode()).hexdigest(), edit_type="manual")
                    db.add(version)
                    db.flush()
                    message.current_version_id = version.id
                    db.add(SourceMessageRef(message_id=message.id, source_type="manual",
                        source_profile="synthetic", source_markdown_index=sequence,
                        raw_metadata={"model": "synthetic-model", "private": "must-not-export"}))
                    messages.setdefault(conversation.id, []).append((message.id, body))
                    if role == "user":
                        annotation = ConversationAnnotation(subject_key=str(owner), conversation_id=conversation.id,
                            message_id=message.id, message_version_id=version.id, annotation_type="bookmark",
                            anchor_status="active", comment_markdown="Synthetic retained annotation")
                        db.add(annotation)
                        db.flush()
                        db.add(ConversationNotebook(subject_key=str(owner), conversation_id=conversation.id,
                            title="Synthetic notebook", blocks=[
                                {"id": str(uuid.uuid4()), "type": "markdown", "markdown": "Synthetic retained notes"},
                                {"id": str(uuid.uuid4()), "type": "annotation_reference",
                                 "annotation_id": str(annotation.id)},
                            ]))
                db.add(ConversationAnnotation(subject_key=str(other_owner), conversation_id=conversation.id,
                    annotation_type="bookmark", comment_markdown="must-not-export"))
            db.commit()
            kwargs = dict(scope=scope, conversation_id=owned_ids[0] if scope == "conversation" else None,
                project_id=project.id if scope == "project" else None, known_revisions={}, include_assets=asset_mode,
                idempotency_key=str(uuid.uuid4()), subject_key=str(owner), ownership_scope=OwnershipScope(owner))
            job = queue_offline_package(db, **kwargs)
            job_id = job.id
            db.commit()
            assert queue_offline_package(db, **kwargs).id == job_id
            assert db.query(BackgroundJob).count() == 1
            db.commit()
        with factory() as db:
            kind, claimed, token = claim(db)
            assert kind == "job" and claimed == job_id
        with factory() as db:
            # Match execution_child's fresh read, including SQLite's timestamp representation.
            claimed_job = db.get(BackgroundJob, job_id)
            expected_execution = (
                claimed_job.attempt_count, claimed_job.started_at, claimed_job.payload["execution_token"],
            )
        process_background_job(job_id, factory, expected_execution=expected_execution)
        assert reconcile("job", job_id, token, factory)
        with factory() as db:
            job = db.get(BackgroundJob, job_id)
            assert job.status == "committed", job.error_message
            assert job.attempt_count == 1 and job.progress == 100 and job.completed_at is not None
            assert db.get(TaskExecutionControl, SLOT).finished_at is not None
            package = db.query(OfflinePackageArtifact).filter_by(job_id=job_id).one()
            source = Path(package.storage_uri)
            assert source.resolve().is_relative_to(Path(settings.offline_storage_dir).resolve())
            assert hashlib.sha256(source.read_bytes()).hexdigest() == package.sha256
            assert source.stat().st_size == package.byte_size
            with ZipFile(source) as archive:
                assert archive.testzip() is None and archive.namelist() == ["package.json"]
                payload = json.loads(archive.read("package.json"))
            expected_ids = owned_ids[:1] if scope == "conversation" else owned_ids
            assert package.conversation_count == len(expected_ids)
            assert payload["version"] == 3 and payload["asset_mode"] == asset_mode
            assert payload["update_mode"] == "conversation-delta"
            assert {item["id"] for item in payload["conversations"]} == {str(cid) for cid in expected_ids}
            for item in payload["conversations"]:
                cid = uuid.UUID(item["id"])
                assert [row["current_version"]["display_text"] for row in item["messages"]] == [
                    body for _, body in messages[cid]]
                assert all(row["source_refs"][0]["source_metadata"] == {"model": "synthetic-model"}
                           for row in item["messages"])
                assert item["project_context"]["description"] == "Synthetic project context"
                assert item["annotations"][0]["anchor_status"] == "valid"
                assert len(item["annotations"]) == 1
                assert item["notebook"]["title"] == "Synthetic notebook"
                assert len(item["notebook"]["blocks"]) == 2
            assert "must-not-export" not in json.dumps(payload)
            assert db.query(Conversation).count() == 3 and db.query(Message).count() == 4
            assert len(list(Path(settings.offline_storage_dir).iterdir())) == 1
        assert not any(name in sys.modules for name in blocked)
        engine.dispose()
        print(json.dumps({"scope": scope, "asset_mode": asset_mode,
            "package_version": 3, "owned_conversations": len(expected_ids),
            "idempotent_admission": True, "unselected_dependencies_loaded": False}))
    """, scope, asset_mode)
    assert result == {
        "scope": scope, "asset_mode": asset_mode, "package_version": 3,
        "owned_conversations": 1 if scope == "conversation" else 2,
        "idempotent_admission": True, "unselected_dependencies_loaded": False,
    }
