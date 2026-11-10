"""Failed and paused source repair keeps the session and explicit commit boundary."""
import uuid

import pytest

from app.core.config import get_settings
from app.models.background_job import BackgroundJob
from app.models.import_record import ImportRecord
from app.services.adaptive_import import memory_budget
from app.services.background_jobs import process_background_job
from test_adaptive_import_api import _complete_analysis, _create, _zip_bytes
from test_import_analysis_queue import database, claim, queue, source, small_conversation_zip
from test_import_preview_api import client  # noqa: F401


@pytest.fixture(autouse=True, params=[False, True], ids=["legacy", "worker"])
def synthetic_capacity(client, monkeypatch, request):
    monkeypatch.setenv("IMPORT_BOUNDED_ZIP_ENABLED", str(request.param).lower())
    monkeypatch.setattr("app.services.uploads.available_memory_bytes", lambda: 16 * 1024**3)
    monkeypatch.setattr(memory_budget, "effective_total_memory_bytes", lambda: 640 * 1024**2)
    monkeypatch.setattr(memory_budget, "process_resident_memory_bytes", lambda: 80 * 1024**2)
    get_settings.cache_clear()
    yield request.param
    get_settings.cache_clear()


def stopped(client, state):
    if state == "FAILED":
        response = client.post("/api/adaptive-import/sessions", files=[
            ("files", ("broken.zip", b"not a zip", "application/zip")),
        ])
        assert response.status_code == 201, response.text
        pending = response.json()
        job, factory = claim(pending)
        process_background_job(job, session_factory=factory)
    else:
        pending = queue(client)
        assert client.post(f"/api/tasks/{pending['analysis_task_id']}/cancel",
                           json={"source_disposition": "retain"}).status_code == 200
    result = client.get(f"/api/adaptive-import/sessions/{pending['import_id']}").json()
    assert result["state"] == state, result
    return result


@pytest.mark.parametrize("state", ["FAILED", "PAUSED"])
def test_replacement_repairs_first_analysis_without_starting_a_new_session(client, state, synthetic_capacity):
    before = stopped(client, state)
    assert not before["groups"]  # First-pass failure/stop still exposes sources.
    artifact = before["sources"][0]
    assert "raw_storage_uri" not in artifact and "safe_filename" not in artifact
    response = client.put(
        f"/api/adaptive-import/sessions/{before['import_id']}/artifacts/{artifact['artifact_id']}",
        files={"file": ("replacement.json", source(), "application/json")},
        data={"expected_updated_at": before["updated_at"]},
    )
    assert response.status_code == (202 if synthetic_capacity else 200), response.text
    pending = response.json()
    if synthetic_capacity:
        assert pending["analysis_task_id"] != before["analysis_task_id"]
    assert pending["import_id"] == before["import_id"]
    after = _complete_analysis(client, pending) if synthetic_capacity else pending
    assert after["state"] == "READY", after
    assert after["file_count"] == before["file_count"]
    assert after["sources"][0]["artifact_id"] == artifact["artifact_id"]
    assert after["sources"][0]["filename"] == "replacement.json"
    assert after["sources"][0]["source_revision"] == artifact["source_revision"] + 1
    assert "pause" not in after["analysis_summary"]
    assert after["error_message"] is None
    assert client.get("/api/conversations").json() == []
    if state == "FAILED":
        # The old failed task can no longer reset this newer session to analysis.
        assert client.post(f"/api/tasks/{before['analysis_task_id']}/retry").status_code == 409


def test_missing_old_source_can_be_replaced_and_stale_request_never_stages(client, tmp_path, synthetic_capacity):
    before = stopped(client, "PAUSED")
    artifact = before["sources"][0]
    root = tmp_path / "storage" / "imports" / before["import_id"]
    (root / "source-0.json").unlink()
    endpoint = f"/api/adaptive-import/sessions/{before['import_id']}/artifacts/{artifact['artifact_id']}"
    baseline = set(root.iterdir())
    stale = client.put(endpoint, files={"file": ("new.json", source(), "application/json")})
    assert stale.status_code == 409, stale.text
    assert set(root.iterdir()) == baseline
    response = client.put(endpoint, files={"file": ("new.json", source(), "application/json")},
                          data={"expected_updated_at": before["updated_at"]})
    assert response.status_code == (202 if synthetic_capacity else 200), response.text
    after = _complete_analysis(client, response.json()) if synthetic_capacity else response.json()
    assert after["state"] == "READY"
    assert (root / "source-1.json").read_bytes() == source()


def test_active_analysis_refuses_replacement_before_staging(client, tmp_path):
    pending = queue(client)
    with database() as db:
        record = db.get(ImportRecord, uuid.UUID(pending["import_id"]))
        artifact_id = record.artifacts[0].id
    root = tmp_path / "storage" / "imports" / pending["import_id"]
    before = set(root.iterdir())
    response = client.put(f"/api/adaptive-import/sessions/{pending['import_id']}/artifacts/{artifact_id}",
                          files={"file": ("replacement.json", source(), "application/json")})
    assert response.status_code == 409
    assert set(root.iterdir()) == before
    with database() as db:
        assert db.query(BackgroundJob).count() == 1


def exclude(client, session, artifact_id=None, revision=None):
    return client.request("DELETE",
        f"/api/adaptive-import/sessions/{session['import_id']}/artifacts/{artifact_id or session['sources'][0]['artifact_id']}",
        json={"expected_updated_at": revision or session["updated_at"]})


def exclusion_result(client, response, worker):
    assert response.status_code == (202 if worker else 200), response.text
    return _complete_analysis(client, response.json()) if worker else response.json()


def test_explicit_exclusion_of_entire_unsafe_zip_retains_other_sources(client, tmp_path, synthetic_capacity):
    bad = _zip_bytes({"../outside.md": b"# Synthetic"})
    pending = client.post("/api/adaptive-import/sessions", files=[
        ("files", ("bad.zip", bad, "application/zip")),
        ("files", ("good.zip", small_conversation_zip(), "application/zip")),
    ]).json()
    job, factory = claim(pending)
    process_background_job(job, session_factory=factory)
    before = client.get(f"/api/adaptive-import/sessions/{pending['import_id']}").json()
    assert before["failure"]["code"] == "ZIP_PATH_UNSAFE"
    root = tmp_path / "storage" / "imports" / before["import_id"]
    saved = {path: path.read_bytes() for path in root.iterdir() if path.is_file() and path.name != "bad.zip"}
    after = exclusion_result(client, exclude(client, before), synthetic_capacity)
    assert after["state"] == "READY", after
    assert after["file_count"] == 1
    assert [item["filename"] for item in after["sources"]] == ["good.zip"]
    assert len(after["archives"]) == 1
    assert after["conversation_count"] == 1
    assert after["error_message"] is None and "failure" not in after["analysis_summary"]
    assert all(path.read_bytes() == content for path, content in saved.items())
    assert not (root / "bad.zip").exists()
    assert client.get("/api/conversations").json() == []
    if synthetic_capacity:
        assert after["analysis_task_id"] != before["analysis_task_id"]
        assert client.post(f"/api/tasks/{before['analysis_task_id']}/retry").status_code == 409


def test_paused_missing_source_can_be_excluded_in_selection_order(client, tmp_path, synthetic_capacity):
    pending = queue(client, count=3)
    client.post(f"/api/tasks/{pending['analysis_task_id']}/cancel", json={"source_disposition": "retain"})
    before = client.get(f"/api/adaptive-import/sessions/{pending['import_id']}").json()
    (tmp_path / "storage" / "imports" / before["import_id"] / "source-1.json").unlink()
    after = exclusion_result(client, exclude(client, before, before["sources"][1]["artifact_id"]), synthetic_capacity)
    assert after["state"] == "READY"
    assert after["source_status"] == "available"
    assert [item["filename"] for item in after["sources"]] == ["source-0.json", "source-2.json"]
    assert [group["files"][0]["filename"] for group in after["groups"]] == ["source-0.json", "source-2.json"]
    assert after["total_bytes"] == len(source()) * 2
    assert "pause" not in after["analysis_summary"]
    assert client.get("/api/conversations").json() == []


def test_source_exclusion_keeps_unaffected_group_identity_and_removes_zip_children(client, synthetic_capacity):
    before = _create(client, [
        ("keep.json", source(), "application/json"),
        ("remove.zip", small_conversation_zip(), "application/zip"),
    ])
    loose_group = next(group for group in before["groups"] if group["mode"] == "JSON")
    derived = next(group for group in before["groups"] if group["mode"] == "MARKDOWN")["files"][0]
    rejected = exclude(client, before, derived["artifact_id"])
    assert rejected.status_code == 409 and rejected.json()["detail"]["code"] == "ARCHIVE_CLASSIFICATION_REQUIRED"
    after = exclusion_result(client, exclude(client, before, before["sources"][1]["artifact_id"]), synthetic_capacity)
    assert after["state"] == "READY"
    assert after["groups"][0]["id"] == loose_group["id"]
    assert len(after["groups"]) == 1 and not after["archives"]
    assert after["total_bytes"] == len(source())


def test_bounded_zip_exclusion_cleans_its_actual_catalog_only_after_success(client, tmp_path, synthetic_capacity):
    before = _create(client, [
        ("keep.zip", small_conversation_zip(), "application/zip"),
        ("remove.zip", small_conversation_zip(), "application/zip"),
    ])
    from app.services.adaptive_import import service
    with database() as db:
        record = db.get(ImportRecord, uuid.UUID(before["import_id"]))
        removed = next(item for item in record.artifacts if item.filename == "remove.zip")
        catalog_name = removed.parsed_summary.get("catalog_file") or f"archive-{removed.id}.json"
        catalog = tmp_path / "storage" / "imports" / before["import_id"] / catalog_name
        derived = [service._source_path(record, item) for item in record.artifacts
                   if str((item.parsed_summary or {}).get("archive_artifact_id")) == str(removed.id)]
        assert catalog.is_file() and derived
    after = exclusion_result(client, exclude(client, before, before["sources"][1]["artifact_id"]), synthetic_capacity)
    assert after["state"] == "READY" and len(after["archives"]) == 1
    assert not catalog.exists() and all(not path.exists() for path in derived)
    assert client.get(f"/api/adaptive-import/sessions/{after['import_id']}/archives/{after['sources'][0]['artifact_id']}").status_code == 200


def test_exclusion_does_not_accept_changed_remaining_bytes(client, tmp_path, synthetic_capacity):
    before = stopped(client, "PAUSED")
    root = tmp_path / "storage" / "imports" / before["import_id"]
    (root / "source-1.json").write_bytes(source() + b"\n")
    response = exclude(client, before)
    if synthetic_capacity:
        assert response.status_code == 202
        job, factory = claim(response.json())
        process_background_job(job, session_factory=factory)
        task = client.get(f"/api/tasks/{job}").json()
        assert task["status"] == "failed"
        assert task["result"]["failure"]["code"] == "SOURCE_CHANGED"
    else:
        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "SOURCE_CHANGED"
    after = client.get(f"/api/adaptive-import/sessions/{before['import_id']}").json()
    assert after["file_count"] == 2
    assert [item["artifact_id"] for item in after["sources"]] == [item["artifact_id"] for item in before["sources"]]
    assert (root / "source-0.json").read_bytes() == source()
    assert client.get("/api/conversations").json() == []


def test_exclusion_rejects_last_stale_foreign_and_active_sources(client, synthetic_capacity):
    single = stopped(client, "FAILED")
    response = exclude(client, single)
    assert response.status_code == 409 and response.json()["detail"]["code"] == "SESSION_WOULD_BE_EMPTY"
    paused = stopped(client, "PAUSED")
    assert exclude(client, paused, revision="2001-01-01T00:00:00Z").status_code == 409
    assert exclude(client, paused, single["sources"][0]["artifact_id"]).status_code == 404
    active = queue(client)
    assert exclude(client, active).status_code == 409
    with database() as db:
        record = db.get(ImportRecord, uuid.UUID(paused["import_id"]))
        record.status = "queued"
        db.commit()
    current = client.get(f"/api/adaptive-import/sessions/{paused['import_id']}").json()
    assert exclude(client, current).status_code == 409


def test_exclusion_preserves_an_unremoved_half_of_a_pair(client, synthetic_capacity):
    before = _create(client, [
        ("pair.json", source(), "application/json"),
        ("pair.md", b"# Synthetic\n\n## User\nQuestion\n\n## Assistant\nAnswer", "text/markdown"),
    ])
    assert len(before["groups"]) == 1 and before["groups"][0]["mode"] == "JSON_MARKDOWN"
    after = exclusion_result(client, exclude(client, before), synthetic_capacity)
    assert after["file_count"] == 1
    assert after["groups"][0]["mode"] == "MARKDOWN"
    assert after["groups"][0]["id"] == before["groups"][0]["id"]
    # The unpaired generic transcript needs its own mapping confirmation. Do
    # not inherit a JSON+Markdown interpretation or pretend it is verified.
    assert after["state"] == "RESOLVING"
    assert after["families"][0]["handling_class"] == "MAPPABLE"
    assert after["can_import"] is False
    assert client.get("/api/conversations").json() == []


def test_exclusion_analysis_failure_rolls_back_source_and_files(client, tmp_path, monkeypatch, synthetic_capacity):
    from app.services.adaptive_import import service
    from app.services.adaptive_import.contracts import AdaptiveImportError
    before = stopped(client, "PAUSED")
    root = tmp_path / "storage" / "imports" / before["import_id"]
    saved = {path: path.read_bytes() for path in root.iterdir()}

    def fail(*args, **kwargs):
        raise AdaptiveImportError("ZIP_CRC_INVALID", "Synthetic integrity failure.", layer="archive")

    monkeypatch.setattr(service, "analyze_session", fail)
    response = exclude(client, before)
    if synthetic_capacity:
        assert response.status_code == 202
        job, factory = claim(response.json())
        process_background_job(job, session_factory=factory)
        assert client.get(f"/api/tasks/{job}").json()["status"] == "failed"
    else:
        assert response.status_code == 422
    after = client.get(f"/api/adaptive-import/sessions/{before['import_id']}").json()
    assert after["file_count"] == 2 and len(after["sources"]) == 2
    assert all(path.read_bytes() == content for path, content in saved.items())


def test_source_cleanup_waits_for_outer_commit_and_is_abandoned_on_rollback(client, tmp_path, monkeypatch):
    from app.services.adaptive_import import service
    from app.models.source_artifact import SourceArtifact
    from sqlalchemy import text
    before = stopped(client, "PAUSED")
    artifact_id = uuid.UUID(before["sources"][0]["artifact_id"])
    with database() as db:
        # SQLite otherwise treats a first SAVEPOINT as the outer transaction.
        db.execute(text("BEGIN"))
        record = db.get(ImportRecord, uuid.UUID(before["import_id"]))
        artifact = db.get(SourceArtifact, artifact_id)
        old_path = service._source_path(record, artifact)
        with db.begin_nested():
            service.exclude_session_source(db, record, artifact)
        assert old_path.is_file()
        db.rollback()
        assert old_path.is_file()
        assert db.get(SourceArtifact, artifact_id) is not None
        record = db.get(ImportRecord, uuid.UUID(before["import_id"]))
        service.exclude_session_source(db, record, db.get(SourceArtifact, artifact_id))
        assert old_path.is_file()
        db.commit()
        assert not old_path.exists()


def test_exclusion_never_follows_source_symlink_to_a_sibling(client, tmp_path, synthetic_capacity):
    before = stopped(client, "PAUSED")
    root = tmp_path / "storage" / "imports" / before["import_id"]
    old = root / "source-0.json"
    old.unlink()
    try:
        old.symlink_to(root / "source-1.json")
    except OSError:
        pytest.skip("Creating a file symlink requires platform permission.")
    response = exclude(client, before)
    if synthetic_capacity:
        assert response.status_code == 202
        job, factory = claim(response.json())
        process_background_job(job, session_factory=factory)
        assert client.get(f"/api/tasks/{job}").json()["status"] == "failed"
    else:
        assert response.status_code == 422
    assert (root / "source-1.json").read_bytes() == source()
    assert len(client.get(f"/api/adaptive-import/sessions/{before['import_id']}").json()["sources"]) == 2


@pytest.mark.parametrize("committed", [False, True], ids=["commit-rejected", "commit-ack-lost"])
def test_exclusion_commit_uncertainty_preserves_the_authoritative_draft(client, tmp_path, monkeypatch, synthetic_capacity, committed):
    from sqlalchemy.orm import Session
    from sqlalchemy.exc import SQLAlchemyError
    from app.services.adaptive_import import service
    from app.services.import_pipeline.draft_store import read_import_draft

    before = _create(client, [("first.json", source(), "application/json"), ("second.json", source(), "application/json")])
    with database() as db:
        record = db.get(ImportRecord, uuid.UUID(before["import_id"]))
        old_draft = tmp_path / "storage" / "imports" / record.draft_storage_uri
        old_bytes = old_draft.read_bytes()
    original_commit = Session.commit
    intervened = []

    def commit(db):
        if db.info.get(service._SOURCE_CLEANUP_KEY) and not intervened:
            intervened.append(True)
            assert old_draft.read_bytes() == old_bytes
            if committed:
                original_commit(db)
            raise SQLAlchemyError("Synthetic lost COMMIT response")
        return original_commit(db)

    monkeypatch.setattr(Session, "commit", commit)
    response = exclude(client, before)
    if synthetic_capacity:
        assert response.status_code == 202
        job, factory = claim(response.json())
        process_background_job(job, session_factory=factory)
        assert client.get(f"/api/tasks/{job}").json()["status"] == ("committed" if committed else "failed")
    else:
        assert response.status_code == 500
        assert response.json()["detail"]["code"] == "SOURCE_EXCLUSION_RESPONSE_UNCONFIRMED"
    assert intervened
    with database() as db:
        record = db.get(ImportRecord, uuid.UUID(before["import_id"]))
        drafts = read_import_draft(record)
        assert len(drafts) == (1 if committed else 2)
        assert record.file_count == (1 if committed else 2)
        if not committed:
            assert old_draft.read_bytes() == old_bytes
        else:
            assert not old_draft.exists()
        root = tmp_path / "storage" / "imports" / str(record.id)
        assert (root / "first.json").exists() == (not committed)
        assert (root / "second.json").read_bytes() == source()
    assert client.get("/api/conversations").json() == []
