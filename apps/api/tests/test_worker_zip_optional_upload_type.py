"""Upload annotations must not bring the API runtime into ZIP worker admission."""
import importlib
import inspect
import typing

import pytest

from test_worker_optional_dependency_imports import _fresh


@pytest.mark.parametrize("module", [
    "app.services.uploads",
    "app.services.adaptive_import.memory_budget",
    "app.services.adaptive_import.service",
    "app.services.adaptive_import.operations",
    "app.services.import_queue",
    "app.services.worker_supervisor",
])
def test_passive_zip_worker_path_does_not_load_annotation_only_api_dependency(module, tmp_path):
    result = _fresh(tmp_path, """
        import sqlalchemy
        sqlalchemy.engine.Engine.connect = forbidden
        importlib.import_module(sys.argv[3])
        assert not any(name in sys.modules for name in blocked)
        print(json.dumps({"module": sys.argv[3], "api_dependency_loaded": False}))
    """, module)
    assert result == {"module": module, "api_dependency_loaded": False}


def test_explicit_upload_type_reexport_preserves_fastapi_identity_and_annotations():
    from fastapi import UploadFile

    uploads = importlib.import_module("app.services.uploads")
    assert uploads.UploadFile is UploadFile
    assert typing.get_type_hints(uploads.upload_size)["upload"] is UploadFile
    assert typing.get_type_hints(uploads.read_upload_bounded)["upload"] is UploadFile
    assert typing.get_type_hints(uploads.read_upload_bounded_sync)["upload"] is UploadFile
    for name in ("bounded_upload_analysis", "bounded_upload_analysis_sync", "bounded_upload_staging_sync"):
        hints = typing.get_type_hints(inspect.unwrap(getattr(uploads, name)))
        assert typing.get_args(hints["files"]) == (UploadFile,)


def test_unknown_upload_module_attribute_does_not_load_optional_api_dependency(tmp_path):
    assert _fresh(tmp_path, """
        from app.services import uploads
        try:
            uploads.unselected_upload_detail
        except AttributeError:
            pass
        else:
            raise AssertionError("An unknown upload attribute was accepted")
        assert not any(name in sys.modules for name in blocked)
        print(json.dumps({"unknown_attribute_rejected": True, "api_dependency_loaded": False}))
    """) == {"unknown_attribute_rejected": True, "api_dependency_loaded": False}


def test_explicit_operation_response_reexports_preserve_exact_api_objects():
    from fastapi import HTTPException
    from fastapi.encoders import jsonable_encoder
    from fastapi.responses import JSONResponse

    operations = importlib.import_module("app.services.adaptive_import.operations")
    assert operations.HTTPException is HTTPException
    assert operations.jsonable_encoder is jsonable_encoder
    assert operations.JSONResponse is JSONResponse


def test_queue_operation_keeps_real_api_encoder_response_and_persistence_order(monkeypatch):
    from datetime import datetime, timezone
    import json
    from types import SimpleNamespace
    import uuid
    from fastapi.responses import JSONResponse
    from app.services.adaptive_import import operations, service

    task_id = uuid.uuid4()
    record = SimpleNamespace(session_state="READY", source_fingerprint="synthetic")
    job = SimpleNamespace(id=task_id, payload={"existing": True})
    calls = []
    monkeypatch.setattr(service, "_require_session_state", lambda row, states: calls.append(("state", row, states)))
    monkeypatch.setattr(service, "queue_session_analysis", lambda db, row: job)
    monkeypatch.setattr(service, "session_payload", lambda row: {
        "state": row.session_state,
        "created_at": datetime(2026, 11, 15, tzinfo=timezone.utc),
    })
    db = SimpleNamespace(commit=lambda: calls.append(("commit",)),
                         refresh=lambda row: calls.append(("refresh", row)))
    response = operations.queue_operation(db, record, "reanalyze", {"selected": True})
    assert type(response) is JSONResponse
    assert response.status_code == 202
    assert json.loads(response.body) == {
        "state": "READY", "created_at": "2026-11-15T00:00:00+00:00",
        "operation_task_id": str(task_id),
    }
    assert job.payload == {
        "existing": True, "operation": "reanalyze", "arguments": {"selected": True},
        "previous_state": "READY", "source_fingerprint": "synthetic",
    }
    assert calls == [
        ("state", record, service.RECOVERABLE_SESSION_STATES),
        ("commit",), ("refresh", record),
    ]


def test_queue_operation_keeps_exact_api_error_before_any_persistence(monkeypatch):
    from types import SimpleNamespace
    from fastapi import HTTPException
    from app.services.adaptive_import import operations, service
    from app.services.adaptive_import.contracts import AdaptiveImportError

    def denied(*args):
        raise AdaptiveImportError("SESSION_STATE", "Synthetic rejected state", layer="analysis")

    def forbidden(*args):
        pytest.fail("Rejected state reached persistence")

    monkeypatch.setattr(service, "_require_session_state", denied)
    monkeypatch.setattr(service, "queue_session_analysis", forbidden)
    with pytest.raises(HTTPException) as caught:
        operations.queue_operation(SimpleNamespace(commit=forbidden), object(), "replace")
    assert type(caught.value) is HTTPException
    assert caught.value.status_code == 409
    assert caught.value.detail == {"code": "SESSION_STATE", "message": "Synthetic rejected state"}
