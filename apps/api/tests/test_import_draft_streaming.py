"""Batch drafts release completed conversations before loading the next one."""
import gc
import json
import uuid
import weakref
import hashlib
import io
from dataclasses import asdict, replace
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy.orm import sessionmaker

from app.core.config import get_settings
from app.models.import_record import ImportRecord
from app.services.canonical import persistence
from app.services.canonical.persistence import commit_import_preview
from app.services.import_queue import claim_next_import, process_import
from app.services.import_pipeline import draft_store
from app.services import uploads
from app.services.import_pipeline.exporter_aligner import align_exporter_sources
from app.services.import_pipeline.exporter_json_parser import parse_exporter_json
from test_import_preview_api import client as _preview_client
from test_adaptive_import_api import _complete_analysis
from test_import_analysis_queue import database

client = _preview_client


@pytest.fixture(autouse=True)
def synthetic_headroom(monkeypatch):
    # These kilobyte fixtures test protocol/lifecycle behavior, not host capacity.
    # Negative cases override this probe explicitly; never bypass admission.
    monkeypatch.setattr(uploads, "available_memory_bytes", lambda: 16 * 1024 * 1024 * 1024)


def source() -> bytes:
    return json.dumps({
        "metadata": {"powered_by": "ChatGPT Exporter", "title": "Synthetic stream"},
        "messages": [{"role": "Prompt", "say": "Retained synthetic source."}],
    }).encode()


def test_draft_writer_consumes_a_generator_without_retaining_previous_conversations(tmp_path, monkeypatch):
    monkeypatch.setattr(draft_store, "get_settings", lambda: SimpleNamespace(
        import_storage_dir=tmp_path, import_draft_ttl_hours=24, max_import_file_size_mb=1,
    ))
    refs = []

    def conversations():
        for index in range(20):
            gc.collect()
            assert not refs or refs[-1]() is None, "The writer retained the previous full conversation."
            item = align_exporter_sources(parse_exporter_json(source()), None).conversation
            item = replace(item, title=f"Synthetic {index}")
            refs.append(weakref.ref(item))
            yield item
            del item

    storage_uri, digest, summary, expires = draft_store.write_import_draft(uuid.uuid4(), conversations())
    assert summary == {"conversation_count": 20, "message_count": 20}
    record = SimpleNamespace(
        draft_storage_uri=storage_uri, draft_sha256=digest, draft_summary=summary, draft_expires_at=expires,
    )
    assert [item.title for item in draft_store.read_import_draft(record)] == [
        f"Synthetic {index}" for index in range(20)
    ]
    assert all(ref() is None for ref in refs)


def test_late_invalid_stream_rolls_back_all_canonical_conversations(client):
    response = client.post("/api/adaptive-import/sessions", files=[
        ("files", ("one.json", source(), "application/json")),
        ("files", ("two.json", source(), "application/json")),
    ])
    assert response.status_code == 201, response.text
    session = _complete_analysis(client, response.json())
    assert session["conversation_count"] == 2 and session["state"] == "READY"
    path = Path(get_settings().import_storage_dir) / session["import_id"] / "canonical-draft.jsonl"
    with path.open("ab") as handle:
        handle.write(b"invalid trailing draft\n")
    result = client.post(f"/api/imports/{session['import_id']}/commit")
    assert result.status_code == 400, result.text
    assert client.get("/api/conversations").json() == []


def test_incremental_writer_preserves_original_draft_bytes_and_hash(tmp_path, monkeypatch):
    monkeypatch.setattr(draft_store, "get_settings", lambda: SimpleNamespace(
        import_storage_dir=tmp_path, import_draft_ttl_hours=24, max_import_file_size_mb=1,
    ))
    conversation = align_exporter_sources(parse_exporter_json(source()), None).conversation
    expected = (json.dumps(asdict(conversation), ensure_ascii=False, separators=(",", ":")) + "\n").encode()
    storage_uri, digest, _, _ = draft_store.write_import_draft(uuid.uuid4(), [conversation])
    assert (tmp_path / storage_uri).read_bytes() == expected
    assert digest == hashlib.sha256(expected).hexdigest()


def test_commit_admission_refuses_low_memory_before_materializing_a_draft(monkeypatch):
    monkeypatch.setattr(uploads, "available_memory_bytes", lambda: 0)
    requested = []

    class Source(io.BytesIO):
        def read(self, size=-1):
            requested.append(size)
            raise AssertionError("The full draft was read before memory admission.")

    with pytest.raises(draft_store.ImportDraftError, match="memory pressure"):
        list(draft_store._admitted_draft_lines(Source(b'{"synthetic":"body"}\n'), 1024))
    assert requested == []


def test_draft_size_is_checked_before_any_full_record_read():
    class Source(io.BytesIO):
        def read(self, size=-1):
            raise AssertionError("An oversized draft was materialized.")

        def readline(self, size=-1):
            assert 0 < size <= 129
            return super().readline(size)

    with pytest.raises(draft_store.ImportDraftError, match="configured size limit"):
        list(draft_store._admitted_draft_lines(Source(b"x" * 256), 128))


def test_draft_admission_is_per_conversation_and_released_when_closed(monkeypatch):
    from contextlib import contextmanager
    active, sizes = [], []

    @contextmanager
    def admitted(sources, *, force_memory_check):
        assert force_memory_check and not active
        sizes.append(sources)
        active.append(True)
        try:
            yield
        finally:
            active.pop()

    monkeypatch.setattr(draft_store, "bounded_analysis_admission_sync", admitted)
    lines = draft_store._admitted_draft_lines(io.BytesIO(b"first\nsecond\n"), 128)
    assert next(lines) == b"first\n" and active
    assert next(lines) == b"second\n" and active
    lines.close()
    assert not active and sizes == [[6], [7]]


def test_persistence_failure_releases_admission_even_when_traceback_is_retained(client, monkeypatch):
    from contextlib import contextmanager

    monkeypatch.setenv("IMPORT_COMMIT_INLINE", "true")
    get_settings.cache_clear()
    preview = client.post("/api/imports/preview",
        files={"files": ("synthetic.json", source(), "application/json")})
    assert preview.status_code == 200, preview.text
    active, retained_errors = [], []

    @contextmanager
    def admitted(*_, **__):
        assert not active
        active.append(True)
        try:
            yield
        finally:
            active.pop()

    def fail_persistence(*_, **__):
        error = ValueError("Synthetic persistence failure")
        retained_errors.append(error)
        raise error

    monkeypatch.setattr(draft_store, "bounded_analysis_admission_sync", admitted)
    monkeypatch.setattr(persistence, "_persist_conversation", fail_persistence)
    response = client.post(f"/api/imports/{preview.json()['import_id']}/commit")
    assert response.status_code == 400, response.text
    assert retained_errors[0].__traceback__ is not None
    assert active == [], "A retained exception must not retain the admission slot."
    assert client.get("/api/conversations").json() == []


@pytest.mark.parametrize("available", [0, None])
def test_commit_memory_failure_is_visible_retryable_and_preserves_sources(client, tmp_path, monkeypatch, available):
    monkeypatch.setenv("IMPORT_COMMIT_INLINE", "false")
    get_settings.cache_clear()
    preview = client.post("/api/imports/preview",
        files={"files": ("synthetic.json", source(), "application/json")})
    assert preview.status_code == 200, preview.text
    import_id = preview.json()["import_id"]
    root = tmp_path / "storage" / "imports" / import_id
    before = {path.name: path.read_bytes() for path in root.iterdir()}
    assert client.post(f"/api/imports/{import_id}/commit").status_code == 202
    with database() as db:
        factory = sessionmaker(bind=db.get_bind(), expire_on_commit=False)
        claimed = claim_next_import(db)
        db.commit()
    with monkeypatch.context() as patch:
        patch.setattr(uploads, "available_memory_bytes", lambda: available)
        assert process_import(claimed, session_factory=factory) is None
    failed = client.get(f"/api/tasks/{import_id}").json()
    assert failed["status"] == "failed" and "memory pressure" in failed["error_message"]
    assert client.get("/api/conversations").json() == []
    assert {path.name: path.read_bytes() for path in root.iterdir()} == before
    retry = client.post(f"/api/tasks/{import_id}/retry")
    assert retry.status_code == 200 and retry.json()["job_id"] == import_id
    with database() as db:
        assert claim_next_import(db) == claimed
        db.commit()
        result = commit_import_preview(claimed, db)
        assert result.conversation_count == 1
        assert db.get(ImportRecord, claimed).status == "committed"
