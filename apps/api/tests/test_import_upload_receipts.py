"""Initial upload admission is a receipt, not permission to import twice."""
import uuid

import pytest

from app.api.routes import adaptive_imports
from app.models.background_job import BackgroundJob
from app.models.import_record import ImportRecord
from app.models.user import User
from test_import_analysis_queue import database, source
from test_import_preview_api import client  # noqa: F401


def upload(client, key, files=None, **options):
    return client.post("/api/adaptive-import/sessions", headers={"Idempotency-Key": str(key)},
        data=options, files=files or [("files", ("first.json", source(), "application/json")),
                                    ("files", ("second.md", b"# Synthetic second source", "text/markdown"))])


def lookup(client, key):
    return client.get(f"/api/adaptive-import/requests/{key}")


def test_same_upload_key_returns_original_session_without_staging_or_analysis(client, monkeypatch):
    key = uuid.uuid4()
    first = upload(client, key)
    assert first.status_code == 201, first.text
    monkeypatch.setattr(adaptive_imports, "begin_session", lambda *a, **kw: pytest.fail("Duplicate admission"))
    monkeypatch.setattr(adaptive_imports, "add_session_source_stream", lambda *a, **kw: pytest.fail("Duplicate staging"))
    second = upload(client, key)
    assert second.status_code == 201, second.text
    assert second.json()["import_id"] == first.json()["import_id"]
    assert second.json()["analysis_task_id"] == first.json()["analysis_task_id"]
    with database() as db:
        assert db.query(ImportRecord).count() == 1
        assert db.query(BackgroundJob).count() == 1


@pytest.mark.parametrize("change", ["bytes", "name", "order", "count", "profile"])
def test_reused_upload_key_binds_bytes_order_names_and_options(client, change):
    key = uuid.uuid4()
    first = upload(client, key)
    assert first.status_code == 201
    files = [("files", ("first.json", source(), "application/json")),
             ("files", ("second.md", b"# Synthetic second source", "text/markdown"))]
    options = {}
    if change == "bytes":
        files[0] = ("files", ("first.json", b" " + source(), "application/json"))
    elif change == "name":
        files[0] = ("files", ("renamed.json", source(), "application/json"))
    elif change == "order":
        files.reverse()
    elif change == "count":
        files.pop()
    else:
        options["repair_profile_id"] = str(uuid.uuid4())
    result = upload(client, key, files, **options)
    assert result.status_code == 409, result.text
    assert result.json()["detail"]["code"] == "IMPORT_UPLOAD_REQUEST_CONFLICT"
    with database() as db:
        assert db.query(ImportRecord).count() == 1
        assert db.query(BackgroundJob).count() == 1


@pytest.mark.parametrize("status", ["queued", "processing", "cancelling", "committed", "failed", "cancelled"])
def test_receipt_is_read_only_terminal_aware_and_does_not_touch_source_files(client, monkeypatch, status):
    key = uuid.uuid4()
    accepted = upload(client, key).json()
    with database() as db:
        job = db.get(BackgroundJob, uuid.UUID(accepted["analysis_task_id"]))
        job.status = status
        db.commit()
        before = job.payload, job.attempt_count, job.status
    monkeypatch.setattr(adaptive_imports, "session_payload", lambda *a: pytest.fail("Receipt must not load sources"))
    response = lookup(client, key)
    assert response.status_code == 200, response.text
    assert response.json() == {"receipt": {"import_id": accepted["import_id"],
        "task_id": accepted["analysis_task_id"], "status": status}}
    assert response.headers["cache-control"] == "no-store"
    assert all(secret not in response.text for secret in ["sha256", "storage", "payload", "first.json"])
    with database() as db:
        job = db.get(BackgroundJob, uuid.UUID(accepted["analysis_task_id"]))
        assert (job.payload, job.attempt_count, job.status) == before


def test_unknown_receipt_does_not_assert_that_upload_was_rejected(client):
    response = lookup(client, uuid.uuid4())
    assert response.status_code == 200 and response.json() == {"receipt": None}
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.parametrize("foreign", ["job", "import"])
def test_foreign_receipt_is_not_disclosed(client, foreign):
    key = uuid.uuid4()
    accepted = upload(client, key).json()
    with database() as db:
        other = User(normalized_email="synthetic-upload-other@example.test")
        db.add(other)
        db.flush()
        model, identity = (BackgroundJob, "analysis_task_id") if foreign == "job" else (ImportRecord, "import_id")
        db.get(model, uuid.UUID(accepted[identity])).owner_user_id = other.id
        db.commit()
    response = lookup(client, key)
    assert accepted["import_id"] not in response.text
    assert accepted["analysis_task_id"] not in response.text
    assert response.status_code == (200 if foreign == "job" else 410)
    assert response.headers["cache-control"] == "no-store"
    if foreign == "import":
        assert response.json()["detail"]["code"] == "IMPORT_UPLOAD_RECEIPT_UNAVAILABLE"


def test_invalid_request_key_does_not_stage_sources(client):
    assert upload(client, "not-a-uuid").status_code == 422
    assert lookup(client, "not-a-uuid").status_code == 422
    with database() as db:
        assert db.query(ImportRecord).count() == 0


def test_successful_commit_with_lost_response_is_found_and_never_staged_again(client, monkeypatch):
    key = uuid.uuid4()
    original = adaptive_imports.session_payload
    monkeypatch.setattr(adaptive_imports, "session_payload", lambda *a: (_ for _ in ()).throw(RuntimeError("synthetic response loss")))
    response = upload(client, key)
    assert response.status_code == 500
    receipt = lookup(client, key).json()["receipt"]
    assert receipt and receipt["status"] == "queued"
    monkeypatch.setattr(adaptive_imports, "session_payload", original)
    repeated = upload(client, key)
    assert repeated.status_code == 201
    assert repeated.json()["import_id"] == receipt["import_id"]
    with database() as db:
        assert db.query(ImportRecord).count() == 1
        assert db.query(BackgroundJob).count() == 1


@pytest.mark.parametrize("status", ["failed", "committed", "cancelled"])
def test_terminal_admission_returns_original_and_never_retries_analysis(client, status):
    key = uuid.uuid4()
    first = upload(client, key).json()
    with database() as db:
        job = db.get(BackgroundJob, uuid.UUID(first["analysis_task_id"]))
        job.status = status
        db.commit()
    again = upload(client, key)
    assert again.status_code == 201
    assert again.json()["import_id"] == first["import_id"]
    with database() as db:
        job = db.get(BackgroundJob, uuid.UUID(first["analysis_task_id"]))
        assert job.status == status and job.attempt_count == 0
        assert db.query(BackgroundJob).count() == 1


def test_legacy_requests_without_identity_still_create_distinct_sessions(client):
    ids = []
    for _ in range(2):
        result = client.post("/api/adaptive-import/sessions",
            files={"files": ("synthetic.md", b"# Synthetic source", "text/markdown")})
        assert result.status_code == 201
        ids.append(result.json()["import_id"])
    assert ids[0] != ids[1]


def test_receipt_is_metadata_only_even_if_source_metadata_is_unavailable(client, monkeypatch):
    from app.models.source_artifact import SourceArtifact
    from sqlalchemy import event
    key = uuid.uuid4()
    accepted = upload(client, key).json()
    with database() as db:
        engine = db.get_bind()
        db.query(SourceArtifact).delete()
        db.commit()
    def inspect(_conn, _cursor, statement, *_):
        assert "source_artifacts" not in statement, "Receipt GET consulted source metadata"
        assert "FOR UPDATE" not in statement.upper(), "Receipt GET locked a writer"
    event.listen(engine, "before_cursor_execute", inspect)
    try:
        result = lookup(client, key)
        assert result.status_code == 200
        assert result.json()["receipt"]["import_id"] == accepted["import_id"]
    finally:
        event.remove(engine, "before_cursor_execute", inspect)


def test_repeated_verification_reads_in_bounded_chunks_and_preserves_duplicate_names(client, monkeypatch):
    from io import BytesIO
    from fastapi import UploadFile
    from app.services.adaptive_import.upload_receipts import verify_repeated_upload
    files = [("files", ("same.md", b"first", "text/markdown")),
             ("files", ("same.md", b"second", "text/markdown"))]
    accepted = upload(client, uuid.uuid4(), files).json()
    reads = []
    class Bounded(BytesIO):
        def read(self, size=-1):
            reads.append(size)
            assert 0 < size <= 64 * 1024
            return super().read(size)
    with database() as db:
        job = db.get(BackgroundJob, uuid.UUID(accepted["analysis_task_id"]))
        verify_repeated_upload(job, [UploadFile(filename="same.md", file=Bounded(b"first")),
            UploadFile(filename="same.md", file=Bounded(b"second"))], None, None, max_file_bytes=100, total_limit=200)
    assert reads
