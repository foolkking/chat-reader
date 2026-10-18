"""Batch drafts release completed conversations before loading the next one."""
import gc
import json
import uuid
import weakref
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

from app.core.config import get_settings
from app.services.import_pipeline import draft_store
from app.services.import_pipeline.exporter_aligner import align_exporter_sources
from app.services.import_pipeline.exporter_json_parser import parse_exporter_json
from test_import_preview_api import client as _preview_client
from test_adaptive_import_api import _complete_analysis

client = _preview_client


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
