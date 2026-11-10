"""Missing source files are recoverable content gaps, not a ZIP safety bypass."""
import json
import io
import uuid
import zipfile
from types import SimpleNamespace

import pytest

from app.core.config import get_settings
from app.core.database import get_db
from app.main import app
from app.models.attachment import Attachment, MessageVersionAttachment
from app.models.message_version import MessageVersion
from app.services.adaptive_import import memory_budget
from app.services.adaptive_import.archive_sources import archive_catalog
from app.services.editing.attachment_integrity import audit_conversation_attachment_integrity
from test_adaptive_import_api import _create, _zip_bytes
from test_import_preview_api import client  # noqa: F401


@pytest.fixture(params=[False, True], ids=["legacy", "bounded-v2"])
def zip_client(client, monkeypatch, request):
    monkeypatch.setenv("IMPORT_BOUNDED_ZIP_ENABLED", str(request.param).lower())
    monkeypatch.setattr(memory_budget, "effective_total_memory_bytes", lambda: 640 * 1024**2)
    monkeypatch.setattr(memory_budget, "process_resident_memory_bytes", lambda: 80 * 1024**2)
    get_settings.cache_clear()
    yield client
    get_settings.cache_clear()


def missing_zip(*, present=False):
    entries = {
        "conversation.md": (
            "# Synthetic missing resources\n\n## User\nRead the files.\n\n## Assistant\n"
            "![diagram](assets/missing.png)\n\nAgain ![same](assets/./missing.png)\n\n"
            "[note](assets/note.txt)\n\n`![example](assets/example.png)`\n"
        ).encode(),
        "manifest.json": json.dumps({
            "version": "1", "messages": [{"id": "u"}, {"id": "a"}],
            "assets": [{"path": "assets/missing.png", "width": 999, "height": 999},
                       {"path": "assets/note.txt"}, {"path": "assets/manifest-only.pdf"}],
        }).encode(),
    }
    if present:
        entries["assets/note.txt"] = b"Synthetic available file."
    return _zip_bytes(entries)


@pytest.mark.parametrize("present", [False, True])
def test_missing_zip_import_retains_real_occurrences_without_fake_files(zip_client, present):
    session = _create(zip_client, [("missing.zip", missing_zip(present=present), "application/zip")])
    assert session["state"] == "READY"
    summary = session["archives"][0]
    assert summary["missing_attachment_count"] == (2 if present else 3)
    assert summary["blocking_issue_count"] == 0
    result = zip_client.post(f"/api/imports/{session['import_id']}/commit")
    assert result.status_code == 200, result.text
    assert result.json()["status"] == "committed"
    assert any("ZIP missing attachments:" in warning for warning in result.json()["warnings"])
    conversation_id = result.json()["conversation_ids"][0]
    items = zip_client.get(f"/api/conversations/{conversation_id}/attachments").json()["items"]
    assert len(items) == 3
    by_name = {item["original_filename"]: item for item in items}
    for name, item in by_name.items():
        assert item["source_type"] == "adaptive_zip"
        if present and name == "note.txt":
            assert zip_client.get(item["content_url"]).content == b"Synthetic available file."
            continue
        assert item["asset_object"] is None
        assert item["status"] == item["resolution_status"] == "missing"
        assert item["scan_status"] == "not_available"
        assert item["content_url"] is None and item["download_url"] is None
        assert "image_geometry_v1" not in item["metadata"]
        assert "image_display_v1" not in item["metadata"]
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        assert not audit_conversation_attachment_integrity(db, uuid.UUID(conversation_id))
        assert db.query(MessageVersionAttachment).filter_by(
            attachment_id=uuid.UUID(by_name["missing.png"]["id"])).count() == 2
        assert db.query(MessageVersionAttachment).filter_by(
            attachment_id=uuid.UUID(by_name["manifest-only.pdf"]["id"])).count() == 0
        text = "\n".join(row.display_text for row in db.query(MessageVersion).all())
        assert "`![example](assets/example.png)`" in text
        assert "![diagram](assets/" not in text
    finally:
        db.close()
        generator.close()


def test_missing_relative_resource_owned_by_each_actual_document(zip_client):
    session = _create(zip_client, [("multi.zip", _zip_bytes({
        "one.md": b"# One\n\n## User\nOne\n\n## Assistant\n![a](assets/missing.png)\n",
        "nested/two.md": b"# Two\n\n## User\nTwo\n\n## Assistant\n![b](../assets/missing.png)\n",
    }), "application/zip")])
    # Generic Markdown ZIPs use the existing mapping workflow.
    from test_adaptive_import_api import _complete_analysis
    for family in session["families"]:
        if family["handling_class"] == "MAPPABLE":
            response = zip_client.post(
                f"/api/adaptive-import/sessions/{session['import_id']}/families/{family['id']}/mapping",
                json={"profile_name": "Synthetic missing files", "mapping_spec": family["mapping_draft"]},
            )
            assert response.status_code in (200, 202), response.text
            session = response.json()
            if response.status_code == 202:
                session = _complete_analysis(zip_client, session)
    result = zip_client.post(f"/api/imports/{session['import_id']}/commit")
    assert result.status_code == 200, result.text
    assert len(result.json()["conversation_ids"]) == 2
    for conversation_id in result.json()["conversation_ids"]:
        items = zip_client.get(f"/api/conversations/{conversation_id}/attachments").json()["items"]
        assert len(items) == 1 and items[0]["status"] == "missing"


def test_missing_metadata_cannot_bypass_present_resource_stream(zip_client):
    from app.models.import_record import ImportRecord
    from app.services.adaptive_import.archive_sources import archive_missing_member
    from app.services.adaptive_import.contracts import AdaptiveImportError
    session = _create(zip_client, [("missing.zip", missing_zip(present=True), "application/zip")])
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        record = db.get(ImportRecord, uuid.UUID(session["import_id"]))
        archive_id = uuid.UUID(session["archives"][0]["artifact_id"])
        catalog = archive_catalog(record, archive_id)
        member = next(item for item in catalog["members"] if item["path"] == "assets/note.txt")
        forged = {"id": member["member_id"], "metadata": {
            "archive_artifact_id": str(archive_id), "archive_member_id": member["member_id"],
            "archive_missing": True, "archive_path": member["path"],
        }}
        assert archive_missing_member(record, forged) is False
        forged["metadata"]["archive_member_id"] = str(uuid.uuid4())
        with pytest.raises(AdaptiveImportError):
            archive_missing_member(record, forged)
    finally:
        db.close()
        generator.close()


@pytest.mark.parametrize("failure", ["crc", "scanner", "source_changed", "read_error"])
def test_partial_zip_cannot_hide_available_file_failures(zip_client, monkeypatch, failure):
    from app.models.conversation import Conversation
    from app.models.import_record import ImportRecord
    from app.services.canonical import persistence
    from app.services.adaptive_import.archive_sources import _artifact_path
    source = missing_zip(present=True)
    if failure == "crc":
        # Store without compression so changing one byte exercises the real CRC
        # reader, not a synthetic scanner exception or invalid deflate stream.
        output = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(source)) as archive, zipfile.ZipFile(output, "w") as stored:
            for item in archive.infolist():
                stored.writestr(item.filename, archive.read(item))
        source = bytearray(output.getvalue())
        with zipfile.ZipFile(io.BytesIO(source)) as archive:
            item = archive.getinfo("assets/note.txt")
            start = item.header_offset + 30 + len(item.filename.encode()) + len(item.extra)
        source[start] ^= 1
        source = bytes(source)
    session = _create(zip_client, [("partial.zip", source, "application/zip")])
    assert session["state"] == "READY"
    if failure == "scanner":
        monkeypatch.setattr(persistence, "scan_attachment", lambda _: SimpleNamespace(status="rejected", allowed_by_policy=False))
    if failure == "read_error":
        def unavailable(*_args, **_kwargs):
            raise OSError("Synthetic storage failure")
        monkeypatch.setattr(persistence, "archive_member_stream", unavailable)
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        baseline = db.query(Conversation).count()
        if failure == "source_changed":
            record = db.get(ImportRecord, uuid.UUID(session["import_id"]))
            artifact = next(item for item in record.artifacts if item.source_type == "adaptive_archive")
            with _artifact_path(record, artifact).open("ab") as handle:
                handle.write(b"synthetic source replacement")
        result = zip_client.post(f"/api/imports/{session['import_id']}/commit")
        assert result.status_code >= 400 or result.json()["status"] != "committed", result.text
        db.expire_all()
        assert db.query(Conversation).count() == baseline
        assert db.query(Attachment).count() == 0
    finally:
        db.close()
        generator.close()


@pytest.mark.parametrize("unsafe", ["../escape.txt", "/absolute.txt", "C:/drive.txt"])
def test_missing_resources_do_not_downgrade_unsafe_archive_paths(zip_client, unsafe):
    from test_adaptive_import_api import _complete_analysis
    source = _zip_bytes({"conversation.md": b"# Test\n\n## Assistant\n![missing](assets/no.png)", unsafe: b"bad"})
    response = zip_client.post("/api/adaptive-import/sessions", files=[("files", ("unsafe.zip", source, "application/zip"))])
    assert response.status_code == 201
    queued = response.json()
    # The actual worker failure is intentional; _complete_analysis only accepts
    # successful work, so inspect this failure through the public task endpoint.
    with pytest.raises(AssertionError):
        _complete_analysis(zip_client, queued)
    task = zip_client.get(f"/api/tasks/{queued['analysis_task_id']}").json()
    assert task["status"] == "failed"
    assert task["failure"]["code"] == "ZIP_PATH_UNSAFE"


def test_old_missing_analysis_waits_for_explicit_retry_of_original_zip(zip_client):
    from app.models.background_job import BackgroundJob
    from app.models.import_record import ImportRecord
    from test_adaptive_import_api import _complete_analysis
    response = zip_client.post("/api/adaptive-import/sessions", files=[("files", ("original.zip", missing_zip(), "application/zip"))])
    queued = response.json()
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        # Persist a pre-fix failure receipt, without replacing/re-uploading bytes.
        job = db.get(BackgroundJob, uuid.UUID(queued["analysis_task_id"]))
        job.status = "failed"
        job.error_message = "MARKDOWN_RESOURCE_MISSING"
        record = db.get(ImportRecord, uuid.UUID(queued["import_id"]))
        record.status = "failed"
        record.session_state = "FAILED"
        record.phase = "analysis_failed"
        db.commit()
        before = zip_client.get(f"/api/tasks/{job.id}").json()
        assert before["status"] == "failed"
        retried = zip_client.post(f"/api/tasks/{job.id}/retry")
        assert retried.status_code == 200
        assert retried.json()["status"] == "queued"
        ready = _complete_analysis(zip_client, queued)
        assert ready["state"] == "READY" and ready["archives"][0]["missing_attachment_count"] == 3
        # A retry analyzes only. It must not silently commit the conversation.
        db.expire_all()
        assert record.status != "committed"
    finally:
        db.close()
        generator.close()


@pytest.mark.parametrize("path", ["%2foutside.png", "assets/%00bad.png", "assets/%253abad.png", "../../outside.png"])
def test_missing_index_never_admits_encoded_or_escaping_reference_paths(path):
    from app.services.adaptive_import.archive_sources import _document_references, _reference_candidate
    from app.services.adaptive_import.contracts import AdaptiveImportError
    with pytest.raises(AdaptiveImportError) as failure:
        _reference_candidate("nested/conversation.md", path)
    assert failure.value.code == "ZIP_PATH_UNSAFE"
    # A body reference is now recoverable; it still must never acquire a
    # missing-member identity or permission to read a file.
    assert _document_references(f"![test]({path})", "nested/conversation.md", set()) == (set(), set())
