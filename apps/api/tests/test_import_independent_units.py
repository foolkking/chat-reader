"""A format-invalid archive blocks commit, but not other independent previews."""
import json

import pytest

from app.core.config import get_settings
from app.services.adaptive_import import memory_budget
from test_adaptive_import_api import _complete_analysis, _create, _zip_bytes
from test_import_analysis_queue import source, small_conversation_zip, claim
from test_import_preview_api import client  # noqa: F401


@pytest.fixture(autouse=True, params=[False, True], ids=["legacy", "bounded"])
def policy(client, monkeypatch, request):
    monkeypatch.setenv("IMPORT_BOUNDED_ZIP_ENABLED", str(request.param).lower())
    monkeypatch.setattr("app.services.uploads.available_memory_bytes", lambda: 16 * 1024**3)
    monkeypatch.setattr(memory_budget, "effective_total_memory_bytes", lambda: 640 * 1024**2)
    monkeypatch.setattr(memory_budget, "process_resident_memory_bytes", lambda: 80 * 1024**2)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.mark.parametrize("other_zip", [False, True])
def test_bad_independent_archive_can_be_replaced_without_discarding_valid_preview(client, other_zip):
    before = _create(client, [
        ("broken.zip", b"not a ZIP", "application/zip"),
        ("valid.zip" if other_zip else "valid.json", small_conversation_zip() if other_zip else source(),
         "application/zip" if other_zip else "application/json"),
    ])
    assert before["state"] == "RESOLVING", before
    assert before["can_import"] is False and before["file_count"] == 2
    assert {family["resolution_status"] for family in before["families"]} == {"INVALID", "EXACT_MATCH"} or {
        family["resolution_status"] for family in before["families"]
    } == {"INVALID", "COMPATIBLE"}
    assert client.post(f"/api/imports/{before['import_id']}/commit").status_code == 409
    broken = next(item for item in before["sources"] if item["filename"] == "broken.zip")
    response = client.put(
        f"/api/adaptive-import/sessions/{before['import_id']}/artifacts/{broken['artifact_id']}",
        files={"file": ("repaired.json", source(), "application/json")},
        data={"expected_updated_at": before["updated_at"]},
    )
    assert response.status_code in (200, 202), response.text
    after = _complete_analysis(client, response.json()) if response.status_code == 202 else response.json()
    assert after["state"] == "READY", after
    assert after["conversation_count"] == 2
    assert [file["filename"] for group in after["groups"] for file in group["files"]][0] == "repaired.json"
    assert client.get("/api/conversations").json() == []


def test_loose_json_does_not_implicitly_pair_with_zip_markdown(client):
    session = _create(client, [
        ("loose.json", source(), "application/json"), ("bundle.zip", small_conversation_zip(), "application/zip"),
    ])
    assert session["state"] == "READY"
    assert len(session["groups"]) == 2
    assert [group["mode"] for group in session["groups"]] == ["JSON", "MARKDOWN"]
    assert session["conversation_count"] == 2


def test_ambiguous_pair_does_not_prevent_independent_zip_preview(client):
    session = _create(client, [
        ("loose.json", source(), "application/json"),
        ("unrelated.md", b"# Synthetic\n\n## User\nQuestion\n\n## Assistant\nAnswer", "text/markdown"),
        ("other.json", source(), "application/json"),
        ("bundle.zip", small_conversation_zip(), "application/zip"),
    ])
    assert session["state"] == "NEEDS_GROUPING", session
    assert session["families"] and any(
        family["matched_profile_key"] == "builtin:conversation-zip-markdown-v1"
        and family["validation_result"]["valid"] for family in session["families"]
    )
    assert session["can_import"] is False
    assert client.post(f"/api/imports/{session['import_id']}/commit").status_code == 409
    assert client.get("/api/conversations").json() == []


@pytest.mark.parametrize("failure", ["path", "crc"])
def test_security_and_integrity_errors_still_abort_multi_source_analysis(client, failure):
    from app.services.background_jobs import process_background_job
    archive = _zip_bytes({
        "../outside.md" if failure == "path" else "conversation.md": b"# Synthetic\n\n## User\nQuestion\n\n## Assistant\nAnswer",
        "manifest.json": json.dumps({"version": "1", "messages": [], "assets": []}).encode(),
    })
    if failure == "crc":
        import io
        import zipfile
        # A real uncompressed CRC error, not a synthetic exception.
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_STORED) as z:
            z.writestr("conversation.md", b"# Synthetic\n\n## User\nQuestion\n\n## Assistant\nAnswer")
        archive = bytearray(buf.getvalue())
        offset = archive.index(b"# Synthetic")
        archive[offset] ^= 1
        archive = bytes(archive)
    response = client.post("/api/adaptive-import/sessions", files=[
        ("files", ("bad.zip", archive, "application/zip")),
        ("files", ("good.zip", small_conversation_zip(), "application/zip")),
    ])
    assert response.status_code == 201
    pending = response.json()
    job, factory = claim(pending)
    process_background_job(job, session_factory=factory)
    failed = client.get(f"/api/adaptive-import/sessions/{pending['import_id']}").json()
    assert failed["state"] == "FAILED"
    assert failed["failure"]["code"] == ("ZIP_PATH_UNSAFE" if failure == "path" else "ZIP_CRC_INVALID")
    assert client.get("/api/conversations").json() == []
