"""Actual draft-reader boundaries; separate Linux measurements cover real RSS."""
import hashlib
import io
import json
from pathlib import Path
from types import SimpleNamespace
import uuid

import pytest

from app.core.config import get_settings
from app.services import uploads
from app.services.adaptive_import import memory_budget
from app.services.import_pipeline.draft_units import Scanner, NotUnitCompatible
from test_import_preview_api import client
from test_import_analysis_queue import database

MIB = 1024**2


@pytest.mark.parametrize("value", [
    {"text": 'quotes " \\" backslash \\\\ [] 中文🙂', "nested": [True, False, None, -2.5e3]},
    ["a\\", '"', "\\\"", {"text": "中" * 30000}],
    "unicode😀\n\t\"\\\\end",
    [{"nested": [i, {"v": "escaped\\\""}]} for i in range(500)],
    1, None, False,
])
def test_unit_scanner_preserves_json_exactly_across_buffers(value):
    raw = json.dumps(value, ensure_ascii=False).encode()
    scanner = Scanner(io.BytesIO(b" \n" + raw + b" ,"))
    got, span = scanner.value(2 * MIB)
    assert got == value
    assert span == (2, len(raw), hashlib.sha256(raw).digest())
    scanner.expect(b",")
    scanner.whitespace()
    assert not scanner.fill()


@pytest.mark.parametrize("prefix", [65530, 65531, 65532, 65533, 65534, 65535, 65536])
def test_unit_scanner_escapes_at_every_chunk_boundary(prefix):
    value = {"text": "a" * prefix + '\\"[}中文🙂\\\\finish'}
    raw = json.dumps(value, ensure_ascii=False).encode()
    scanner = Scanner(io.BytesIO(raw + b","))
    assert scanner.value(2 * MIB)[0] == value
    scanner.expect(b",")


@pytest.mark.parametrize("raw", [b'{"a": [}', b'{"a": "unfinished}', b'{"x": \\}', b'["\\z"]', b'[[1]'])
def test_unit_scanner_rejects_invalid_json(raw):
    with pytest.raises((ValueError, json.JSONDecodeError)):
        Scanner(io.BytesIO(raw)).value(2 * MIB)


def source(count=2):
    return json.dumps({
        "metadata": {"title": "Synthetic units", "powered_by": "ChatGPT Exporter"},
        "messages": [{"role": "Prompt" if i % 2 == 0 else "Response",
                      "say": f"Message {i} 中文\n\n" + "bounded " * 100} for i in range(count)],
    }).encode()


def constrain(monkeypatch):
    # These are boundary/atomicity tests, not evidence of real memory savings.
    monkeypatch.setattr(uploads, "available_memory_bytes", lambda: 400 * MIB)
    monkeypatch.setattr(memory_budget, "effective_total_memory_bytes", lambda: 640 * MIB)
    monkeypatch.setattr(memory_budget, "process_resident_memory_bytes", lambda: 80 * MIB)


def preview(client, count=2):
    response = client.post("/api/imports/preview", files={
        "files": ("synthetic.json", source(count), "application/json"),
    })
    assert response.status_code == 200, response.text
    return response.json()["import_id"]


def test_low_memory_commits_old_draft_by_messages_without_materializing_conversation(client, monkeypatch):
    from app.services.import_pipeline import draft_store
    ident = preview(client, 80)
    constrain(monkeypatch)
    def never(*a, **k):
        raise AssertionError("The whole-conversation reader ran in the bounded lane")
    monkeypatch.setattr(draft_store, "_admitted_draft_lines", never)
    response = client.post(f"/api/imports/{ident}/commit")
    assert response.status_code == 200, response.text
    assert response.json()["message_count"] == 80
    folder = Path(get_settings().import_storage_dir) / ident
    assert not list(folder.glob(".commit-units-*"))


def test_high_memory_retains_original_bulk_reader(client, monkeypatch):
    from app.services.import_pipeline import draft_units
    ident = preview(client)
    monkeypatch.setattr(uploads, "available_memory_bytes", lambda: 16 * 1024**3)
    def never(*a, **k):
        raise AssertionError("High headroom needlessly paid the small-unit indexing cost")
    monkeypatch.setattr(draft_units, "indexed_drafts", never)
    response = client.post(f"/api/imports/{ident}/commit")
    assert response.status_code == 200, response.text


def test_unit_writer_preserves_bulk_source_positions_and_canonical_content(client, monkeypatch):
    from app.models.message import Message
    from app.models.message_version import MessageVersion
    from app.models.source_message_ref import SourceMessageRef
    from app.models.render_block import RenderBlock
    results = []
    for bounded in (False, True):
        ident = preview(client, 6)
        if bounded:
            constrain(monkeypatch)
        response = client.post(f"/api/imports/{ident}/commit")
        assert response.status_code == 200, response.text
        cid = uuid.UUID(response.json()["conversation_ids"][0])
        with database() as db:
            messages = db.query(Message).filter(Message.conversation_id == cid).order_by(Message.order_key).all()
            rows = []
            for message in messages:
                version = db.get(MessageVersion, message.current_version_id)
                refs = db.query(SourceMessageRef).filter(SourceMessageRef.message_id == message.id).all()
                assert len(refs) == 1
                ref = refs[0]
                blocks = db.query(RenderBlock).filter(RenderBlock.message_version_id == version.id).order_by(RenderBlock.block_index).all()
                rows.append({
                    "message": [message.role, message.order_key, message.turn_index, message.char_count,
                                message.block_count, message.content_hash, message.is_heavy],
                    "version": [version.plain_text, version.display_text, version.content_hash,
                                version.edit_type, version.normalizer_version],
                    "origin": [ref.source_type, ref.source_profile, ref.source_conversation_id,
                               ref.source_message_id, ref.source_json_index, ref.source_markdown_index,
                               ref.source_node_id, ref.parent_node_id, ref.child_node_ids,
                               ref.is_primary_path, ref.raw_metadata],
                    "blocks": [[b.block_type, b.plain_text, b.data, b.char_count,
                                b.collapsed_by_default, b.render_priority] for b in blocks],
                })
            results.append(rows)
    assert results[0] == results[1]


@pytest.mark.parametrize("corruption", ["digest", "tail", "count", "duplicate"])
def test_all_units_validated_before_any_canonical_write(client, monkeypatch, corruption):
    from app.models.import_record import ImportRecord
    from app.services.canonical import persistence
    ident = preview(client)
    with database() as db:
        record = db.get(ImportRecord, uuid.UUID(ident))
        path = Path(get_settings().import_storage_dir) / record.draft_storage_uri
        raw = path.read_bytes()
        if corruption == "digest":
            path.write_bytes(raw.replace(b"Message", b"Changed", 1))
        else:
            if corruption == "tail":
                raw += b'{"invalid":"tail"\n'
            elif corruption == "count":
                raw = raw.replace(b'"message_count":2', b'"message_count":3')
            else:
                raw = raw.replace(b'{"title":', b'{"title":"duplicate","title":', 1)
            path.write_bytes(raw)
            record.draft_sha256 = hashlib.sha256(raw).hexdigest()
            db.commit()
    constrain(monkeypatch)
    called = []
    monkeypatch.setattr(persistence, "_persist_conversation", lambda *a, **k: called.append(True))
    response = client.post(f"/api/imports/{ident}/commit")
    assert response.status_code == 400, response.text
    assert not called
    assert client.get("/api/conversations").json() == []


@pytest.mark.parametrize("field", ["annotations", "notebooks", "source_refs", "attachments"])
def test_private_content_cannot_be_discarded_to_qualify_for_small_units(client, monkeypatch, field):
    from app.models.import_record import ImportRecord
    ident = preview(client)
    with database() as db:
        record = db.get(ImportRecord, uuid.UUID(ident))
        path = Path(get_settings().import_storage_dir) / record.draft_storage_uri
        data = json.loads(path.read_bytes())
        data[field] = [{"preserve": "synthetic private content"}]
        raw = (json.dumps(data) + "\n").encode()
        path.write_bytes(raw)
        record.draft_sha256 = hashlib.sha256(raw).hexdigest()
        db.commit()
    constrain(monkeypatch)
    response = client.post(f"/api/imports/{ident}/commit")
    assert response.status_code == 429, response.text
    assert response.json()["detail"]["failure"] == {
        "code": "UPLOAD_MEMORY_PRESSURE", "stage": "commit", "retryable": True,
    }
    assert client.get("/api/conversations").json() == []
    assert path.read_bytes() == raw


def test_late_message_failure_rolls_back_every_message_and_removes_only_temporary_index(client, monkeypatch):
    from app.services.canonical import stream_persistence
    ident = preview(client, 20)
    root = Path(get_settings().import_storage_dir) / ident
    before = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in root.iterdir()}
    constrain(monkeypatch)
    persist = stream_persistence._persist_one
    calls = []
    def fail(db, conversation, message):
        calls.append(True)
        if len(calls) == 19:
            raise ValueError("Synthetic late message failure")
        return persist(db, conversation, message)
    monkeypatch.setattr(stream_persistence, "_persist_one", fail)
    response = client.post(f"/api/imports/{ident}/commit")
    assert response.status_code == 400, response.text
    assert len(calls) == 19
    assert client.get("/api/conversations").json() == []
    assert {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in root.iterdir()} == before


def test_plain_markdown_uses_existing_message_spool_under_low_headroom(client, monkeypatch):
    from test_adaptive_import_api import _complete_analysis
    constrain(monkeypatch)
    body = ("# Synthetic\n\n**User:** Synthetic\n**Created:** Unknown\n"
            "**Updated:** Unknown\n**Exported:** Unknown\n**Link:** N/A\n\n") + "\n\n".join(
        ("## Prompt:\nUnknown\n\n" if i % 2 == 0 else "## Response:\nUnknown · Synthetic\n\n")
        + ("bounded " * 500)
        for i in range(80)
    )
    response = client.post("/api/adaptive-import/sessions", files={
        "files": ("synthetic.md", body.encode(), "text/markdown"),
    })
    assert response.status_code == 201, response.text
    ready = _complete_analysis(client, response.json())
    assert ready["state"] == "READY", ready
    from app.models.import_record import ImportRecord
    with database() as db:
        record = db.get(ImportRecord, uuid.UUID(ready["import_id"]))
        assert record.draft_summary["format_version"] == 2
    response = client.post(f"/api/imports/{ready['import_id']}/commit")
    assert response.status_code == 200, response.text
    assert response.json()["message_count"] == 80


def test_mixed_source_never_borrows_plain_markdown_analysis_guard(monkeypatch):
    constrain(monkeypatch)
    record = SimpleNamespace(artifacts=[
        SimpleNamespace(source_type="adaptive_source", file_extension=".md", byte_size=100),
        SimpleNamespace(source_type="adaptive_source", file_extension=".json", byte_size=100),
    ])
    assert not memory_budget.prefer_bounded_markdown(record)


@pytest.mark.parametrize("available", [0, None])
def test_live_headroom_loss_during_one_conversation_does_not_publish_a_prefix(client, monkeypatch, available):
    from app.services.canonical import stream_persistence
    ident = preview(client, 20)
    constrain(monkeypatch)
    persist = stream_persistence._persist_one
    count = 0
    def lower(db, conversation, message):
        nonlocal count
        result = persist(db, conversation, message)
        count += 1
        if count == 12:
            monkeypatch.setattr(uploads, "available_memory_bytes", lambda: available)
        return result
    monkeypatch.setattr(stream_persistence, "_persist_one", lower)
    response = client.post(f"/api/imports/{ident}/commit")
    assert response.status_code == 429, response.text
    assert response.json()["detail"]["failure"]["code"] == "UPLOAD_MEMORY_PRESSURE"
    assert count == 12
    assert client.get("/api/conversations").json() == []
    root = Path(get_settings().import_storage_dir) / ident
    assert (root / "canonical-draft.jsonl").exists()
    assert not list(root.glob(".commit-units-*"))


def test_new_index_disk_exhaustion_is_a_storage_failure_not_source_corruption(client, monkeypatch):
    import errno
    from app.services.import_pipeline import draft_units
    ident = preview(client)
    constrain(monkeypatch)
    def no_space(*a, **k):
        raise OSError(errno.ENOSPC, "Synthetic storage exhaustion")
    monkeypatch.setattr(draft_units.RecordSpool, "write", no_space)
    response = client.post(f"/api/imports/{ident}/commit")
    assert response.status_code == 400, response.text
    assert response.json()["detail"]["failure"]["code"] == "IMPORT_STORAGE_FULL"
    assert client.get("/api/conversations").json() == []


@pytest.mark.parametrize("extension,expected", [(".md", True), (".json", False)])
def test_replacement_budget_uses_new_parser_type_not_original_markdown(monkeypatch, extension, expected):
    from app.services.adaptive_import.operations import prospective_record
    constrain(monkeypatch)
    record = SimpleNamespace(id=uuid.uuid4(), artifacts=[
        SimpleNamespace(id="previous", source_type="adaptive_source", file_extension=".md", byte_size=10)])
    candidate = prospective_record(record, {"operation": "replace", "arguments": {
        "artifact_id": "previous", "filename": "synthetic" + extension,
        "stored": {"safe_filename": "controlled" + extension, "byte_size": 100},
    }})
    assert memory_budget.prefer_bounded_markdown(candidate) is expected


def test_unbounded_single_message_is_not_truncated():
    raw = json.dumps({"body": "x" * (2 * MIB)}).encode()
    with pytest.raises(NotUnitCompatible):
        Scanner(io.BytesIO(raw)).value(2 * MIB)
