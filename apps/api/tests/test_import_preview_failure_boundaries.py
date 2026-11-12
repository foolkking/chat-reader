"""Synthetic first-admission failures, not a replay of user archives."""
from contextlib import contextmanager
import hashlib
import io
import json
import zipfile

import pytest
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.routes import adaptive_imports, imports
from app.models.import_record import ImportRecord
from app.services.adaptive_import.contracts import AdaptiveImportError
from app.services.exporting.cr_archive import JSONL_ENTRIES
from app.services.uploads import UploadLimitError
from test_import_analysis_queue import database, source
from test_import_preview_api import client  # noqa: F401


def archive_bytes(*, version=2):
    entries = {name: b"" for name in JSONL_ENTRIES}
    entries["conversation.json"] = b'{"display_title":"Synthetic preview only"}'
    manifest = {"format": "chat-reader-archive", "version": version, "summary": {},
                "entries": {name: {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
                            for name, data in entries.items()}}
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr("manifest.json", json.dumps(manifest).encode())
        for name, data in entries.items():
            archive.writestr(name, data)
    return stream.getvalue()


@pytest.mark.parametrize("kind", ["json", "cr"])
@pytest.mark.parametrize("after_commit", [False, True])
@pytest.mark.parametrize("error_type", [SQLAlchemyError, RuntimeError])
def test_uncertain_preview_commit_never_removes_source_or_draft(
    client, tmp_path, monkeypatch, caplog, kind, after_commit, error_type,
):
    content = source() if kind == "json" else archive_bytes()
    name = f"synthetic.{kind}"
    original = Session.commit
    captured = {}
    private = "Synthetic private failure /srv/private-preview/source.cr"

    def commit(db):
        record = next((item for item in db.new if isinstance(item, ImportRecord)), None)
        if record is None:
            return original(db)
        captured["id"] = record.id
        directory = tmp_path / "storage" / "imports" / str(record.id)
        captured["bytes"] = {path.name: path.read_bytes() for path in directory.iterdir()}
        if after_commit:
            original(db)
        raise error_type(private)

    with monkeypatch.context() as patch:
        patch.setattr(Session, "commit", commit)
        response = client.post("/api/imports/preview",
                               files={"files": (name, content, "application/octet-stream")})
    assert response.status_code == 500
    assert private not in response.text and private not in caplog.text
    directory = tmp_path / "storage" / "imports" / str(captured["id"])
    actual = {path.name: path.read_bytes() for path in directory.iterdir()} if directory.exists() else {}
    assert actual == captured["bytes"], "COMMIT uncertainty must not revoke possibly durable inputs."
    assert actual[name] == content
    if kind == "json":
        assert "canonical-draft.jsonl" in actual
    assert response.json()["detail"]["code"] == "IMPORT_PREVIEW_UNCONFIRMED"
    with database() as db:
        assert db.query(ImportRecord).count() == int(after_commit)
        if after_commit:
            record = db.get(ImportRecord, captured["id"])
            assert record.status == "previewed" and record.conversation_id is None
    assert client.get("/api/conversations").json() == []


def test_known_precommit_failure_still_removes_only_its_new_sources(client, tmp_path, monkeypatch):
    sentinel = tmp_path / "storage" / "imports" / "other-retained-fixture" / "keep.txt"
    sentinel.parent.mkdir(parents=True)
    sentinel.write_bytes(b"Unrelated synthetic source.")

    def fail(*args, **kwargs):
        raise SQLAlchemyError("Synthetic draft persistence rejection.")

    monkeypatch.setattr(imports, "attach_import_draft", fail)
    response = client.post("/api/imports/preview",
                           files={"files": ("synthetic.json", source(), "application/json")})
    assert response.status_code == 500
    assert response.json()["detail"] == "Import preview could not be saved."
    assert sentinel.read_bytes() == b"Unrelated synthetic source."
    assert sorted(path.name for path in sentinel.parent.parent.iterdir()) == ["other-retained-fixture"]
    with database() as db:
        assert db.query(ImportRecord).count() == 0


@pytest.mark.parametrize("failure", ["archive", "limit"])
def test_preview_cleanup_failure_keeps_original_rejection_and_releases_admission(
    client, tmp_path, monkeypatch, caplog, failure,
):
    active, retained_guards, errors = [], [], []

    @contextmanager
    def gate(*args, **kwargs):
        assert not active, "The previous request left its admission occupied."
        active.append(True)
        try:
            yield
        finally:
            active.pop()

    def retained_gate(*args, **kwargs):
        result = gate()
        retained_guards.append(result)
        return result

    def denied(*args):
        error = PermissionError("Synthetic cleanup /srv/private-preview/retained.cr")
        errors.append(error)
        raise error

    def limited(*args):
        raise UploadLimitError("FILE_TOO_LARGE", "Choose a smaller source.", status_code=413)

    monkeypatch.setattr(imports, "bounded_upload_analysis_sync", retained_gate)
    monkeypatch.setattr(imports, "_cleanup_import_directory", denied)
    if failure == "limit":
        monkeypatch.setattr(imports, "detect_source_profile", limited)
    try:
        response = client.post("/api/imports/preview",
                               files={"files": ("synthetic.cr", archive_bytes(version=99), "application/zip")})
        assert response.status_code == (400 if failure == "archive" else 413), response.text
        if failure == "archive":
            assert response.json()["detail"] == "Unsupported .cr archive version."
            assert len(list((tmp_path / "storage" / "imports").glob("*/synthetic.cr"))) == 1
        else:
            assert response.json()["detail"]["code"] == "FILE_TOO_LARGE"
        assert errors[0].__traceback__ is not None
        assert active == [], "Explicit release must not depend on traceback/context-manager GC."
        warnings = [item.message for item in caplog.records if "import_preview_cleanup_failed" in item.message]
        assert len(warnings) == 1 and "PermissionError" in warnings[0]
        assert "private-preview" not in caplog.text
        assert "synthetic.cr" not in warnings[0]
        # The next independent rejection can enter immediately, without logout.
        again = client.post("/api/imports/preview",
                            files={"files": ("synthetic.cr", archive_bytes(version=99), "application/zip")})
        assert again.status_code == response.status_code and active == []
        assert client.get("/api/conversations").json() == []
    finally:
        # Only fixture-owned fake context managers, never a workaround for product cleanup.
        for guard in retained_guards:
            guard.gen.close()


@pytest.mark.parametrize("error,expected,code", [
    (UploadLimitError("SESSION_TOO_LARGE", "Choose fewer sources.", status_code=413), 413, "SESSION_TOO_LARGE"),
    (AdaptiveImportError("SOURCE_UNSUPPORTED", "Choose a supported source.", layer="file"), 422, "SOURCE_UNSUPPORTED"),
    (SQLAlchemyError("Synthetic persistence rejection."), 500, "SESSION_PERSISTENCE_FAILED"),
])
def test_adaptive_cleanup_failure_does_not_replace_the_original_admission_error(
    client, tmp_path, monkeypatch, caplog, error, expected, code,
):
    def fail(*args, **kwargs):
        raise error

    def denied(*args, **kwargs):
        raise PermissionError("Synthetic cleanup /srv/private-preview/source.json")

    monkeypatch.setattr(adaptive_imports, "queue_session_analysis", fail)
    monkeypatch.setattr(adaptive_imports, "remove_session_files", denied)
    response = client.post("/api/adaptive-import/sessions",
                           files={"files": ("synthetic.json", source(), "application/json")})
    assert response.status_code == expected, response.text
    assert response.json()["detail"]["code"] == code
    assert client.get("/api/conversations").json() == []
    with database() as db:
        assert db.query(ImportRecord).count() == 0
    assert len(list((tmp_path / "storage" / "imports").glob("*/synthetic.json"))) == 1
    warnings = [item.message for item in caplog.records if "import_admission_cleanup_failed" in item.message]
    assert len(warnings) == 1 and "PermissionError" in warnings[0]
    assert "private-preview" not in caplog.text and "synthetic.json" not in warnings[0]
