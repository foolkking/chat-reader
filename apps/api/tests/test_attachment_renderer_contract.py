import json
import uuid
import zipfile
from pathlib import Path

from app.core.config import get_settings
from app.core.database import get_db
from app.main import app
from app.models.attachment import Attachment, AssetObject
from app.models.background_job import BackgroundJob
from app.services.background_jobs import process_background_job
from test_attachment_upload_api import _conversation_with_message, _create_session, _upload
from test_import_preview_api import client  # noqa: F401


def _promote(client, conversation_id: str, name: str, body: bytes, mime: str = "text/plain") -> dict:
    session = _create_session(client, conversation_id)
    response = client.post(
        f"/api/attachment-upload-sessions/{session['id']}/items",
        files={"file": (name, body, mime)},
    )
    assert response.status_code == 201, response.text
    promoted = client.post(
        f"/api/conversations/{conversation_id}/attachments",
        json={"upload_item_ids": [response.json()["id"]]},
    )
    assert promoted.status_code == 201, promoted.text
    return promoted.json()["items"][0]


def test_capabilities_are_abstract_and_include_renderer_contract(client) -> None:
    response = client.get("/api/capabilities")
    assert response.status_code == 200
    capabilities = response.json()["attachments"]
    assert capabilities["viewer"] is True
    assert capabilities["range"] is True
    assert capabilities["imageDerivatives"] is True
    assert capabilities["textSearch"] is True
    assert capabilities["batchDownload"] is True
    serialized = json.dumps(response.json())
    assert "message_version_attachments" not in serialized
    assert "idx_" not in serialized


def test_text_search_cursor_is_bound_to_query_and_asset(client, tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("ASSET_STORAGE_DIR", str(tmp_path / "assets"))
    monkeypatch.setenv("ASSET_STORAGE_BACKEND", "local")
    monkeypatch.setenv("ATTACHMENT_CURSOR_SECRET", "test-cursor-secret")
    get_settings.cache_clear()
    conversation_id, _message = _conversation_with_message(client)
    attachment = _promote(client, conversation_id, "notes.txt", ("needle line\n" * 400_000).encode())
    response = client.get(f"/api/attachments/{attachment['id']}/text/search", params={"q": "needle", "limit": 2})
    assert response.status_code == 200, response.text
    page = response.json()
    assert len(page["matches"]) == 2
    assert page["nextCursor"]
    stale = client.get(f"/api/attachments/{attachment['id']}/text/search", params={"q": "different", "cursor": page["nextCursor"]})
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "cursor_stale"


def test_batch_download_streams_distinct_business_attachments(client, tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("ASSET_STORAGE_DIR", str(tmp_path / "assets"))
    monkeypatch.setenv("ASSET_STORAGE_BACKEND", "local")
    monkeypatch.setenv("EXPORT_STORAGE_DIR", str(tmp_path / "exports"))
    get_settings.cache_clear()
    conversation_id, _message = _conversation_with_message(client)
    first = _promote(client, conversation_id, "same.txt", b"same bytes")

    db_override = next(app.dependency_overrides[get_db]())
    asset = db_override.get(AssetObject, uuid.UUID(first["asset_object"]["id"]))
    second = Attachment(
        id=uuid.uuid4(), conversation_id=uuid.UUID(conversation_id), asset_object_id=asset.id,
        original_filename="same.txt", display_name="same.txt", declared_mime_type="text/plain",
        detected_mime_type="text/plain", status="available", scan_status="scanner_disabled",
        source_type="upload", source_attachment_id=uuid.uuid4().hex, metadata_={}, resolution_status="resolved",
    )
    db_override.add(second)
    db_override.commit()

    queued = client.post(
        f"/api/conversations/{conversation_id}/attachment-downloads",
        json={"attachment_ids": [first["id"], str(second.id)]},
    )
    assert queued.status_code == 202, queued.text
    job_id = uuid.UUID(queued.json()["job_id"])
    queued_job = db_override.get(BackgroundJob, job_id)
    queued_job.status = "processing"
    queued_job.phase = "validating"
    queued_job.attempt_count = 1
    db_override.commit()
    process_background_job(job_id, session_factory=lambda: next(app.dependency_overrides[get_db]()))
    job = db_override.get(BackgroundJob, job_id)
    db_override.refresh(job)
    assert job.status == "committed", job.error_message
    archive_path = Path(get_settings().export_storage_dir) / str(job.id) / job.result["filename"]
    with zipfile.ZipFile(archive_path) as archive:
        names = archive.namelist()
        assert len(names) == 2
        assert len({name.casefold() for name in names}) == 2
        assert all(archive.read(name) == b"same bytes" for name in names)
