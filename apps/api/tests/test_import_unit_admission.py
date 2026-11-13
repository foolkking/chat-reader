"""Sequential analysis changes the admitted working set, never canonical atomicity."""
import gc
import uuid
import weakref

import pytest

from app.core.config import get_settings
from app.models.import_record import ImportRecord
from app.services import uploads
from app.services.adaptive_import import service
from app.services.adaptive_import.contracts import AdaptiveImportError
from test_adaptive_import_api import _complete_analysis
from test_import_analysis_queue import database, queue
from test_import_preview_api import client  # noqa: F401


@pytest.fixture(autouse=True)
def normal_admission(monkeypatch):
    monkeypatch.setenv("UPLOAD_MEMORY_RESERVE_MB", "512")
    monkeypatch.setenv("UPLOAD_ANALYSIS_MEMORY_FACTOR", "32")
    monkeypatch.setattr(uploads, "available_memory_bytes", lambda: 800 * 1024**2)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_batch_uses_current_unit_estimate_not_sum_and_keeps_review(client, monkeypatch):
    queued = queue(client, count=3)
    # Instrument metadata/sensors, not a real RSS acceptance test. Three source
    # estimates cannot fit together; each safely fits the unchanged factor.
    with database() as db:
        record = db.get(ImportRecord, uuid.UUID(queued["import_id"]))
        for artifact in record.artifacts:
            artifact.byte_size = 6 * 1024**2
        db.commit()
    checked = []
    original = uploads.require_analysis_memory_headroom

    def check(size):
        checked.append(size)
        return original(size)

    monkeypatch.setattr(uploads, "require_analysis_memory_headroom", check)
    session = _complete_analysis(client, queued)
    assert session["state"] == "READY", session
    assert checked and max(checked) == 6 * 1024**2
    assert len(checked) >= 9  # Recognition, full validation and draft, each unit.
    assert client.get("/api/conversations").json() == []


def test_unit_headroom_is_checked_before_source_read(client, monkeypatch):
    queued = queue(client, count=2)
    from test_import_analysis_queue import claim
    from app.services.background_jobs import process_background_job
    calls = []
    original = service._group_documents

    def read(record, group):
        calls.append(str(group.id))
        result = original(record, group)
        # The first parser finishes; the next unit must wait, not read bytes.
        monkeypatch.setattr(uploads, "available_memory_bytes", lambda: 100 * 1024**2)
        return result

    monkeypatch.setattr(service, "_group_documents", read)
    job_id, factory = claim(queued)
    process_background_job(job_id, session_factory=factory)
    assert len(calls) == 1
    assert client.get("/api/conversations").json() == []
    task = client.get(f"/api/tasks/{job_id}").json()
    assert task["status"] == "queued" and task["phase"] == "waiting_resources", task


def test_source_objects_and_invalid_tracebacks_do_not_overlap_next_unit(client, monkeypatch):
    queued = queue(client, count=3)
    previous = []
    original_read = service._group_documents
    original_analyze = service.analyze_documents
    analyzed = 0

    def read(record, group):
        if any(ref() is not None for ref in previous):
            gc.collect()
        assert all(ref() is None for ref in previous), "Previous source retained across unit boundary"
        documents = original_read(record, group)
        previous[:] = [weakref.ref(document) for document in documents]
        return documents

    def analyze(documents):
        nonlocal analyzed
        analyzed += 1
        if analyzed == 1:
            raise AdaptiveImportError("JSON_INVALID", "Synthetic invalid source.", layer="parse")
        return original_analyze(documents)

    monkeypatch.setattr(service, "_group_documents", read)
    monkeypatch.setattr(service, "analyze_documents", analyze)
    result = _complete_analysis(client, queued)
    assert result["state"] == "RESOLVING", result
    assert len(result["groups"]) == 3
    assert sum(family["resolution_status"] == "INVALID" for family in result["families"]) == 1
    assert client.get("/api/conversations").json() == []


def test_validation_and_draft_release_previous_successful_unit(client, monkeypatch):
    queued = queue(client, count=3)
    previous = []
    original = service._group_documents

    def read(record, group):
        if any(ref() is not None for ref in previous):
            gc.collect()
        assert all(ref() is None for ref in previous), "Previous source body overlaps current read"
        documents = original(record, group)
        previous[:] = [weakref.ref(document) for document in documents]
        return documents

    monkeypatch.setattr(service, "_group_documents", read)
    assert _complete_analysis(client, queued)["state"] == "READY"


def test_unit_progress_brackets_work_and_never_marks_an_interrupted_unit_complete():
    from app.services.adaptive_import.memory_budget import processing_unit, unit_progress_reporting
    events = []
    with unit_progress_reporting(lambda *value: events.append(value)):
        with processing_unit("recognition", 1, 2):
            assert events == [("recognition", 1, 2, False)]
        with pytest.raises(ValueError):
            with processing_unit("recognition", 2, 2):
                raise ValueError("Synthetic interruption")
    assert events == [
        ("recognition", 1, 2, False), ("recognition", 1, 2, True), ("recognition", 2, 2, False),
    ]
