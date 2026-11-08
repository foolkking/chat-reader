"""Synthetic v2 contract tests; legacy small-ZIP and JSON guards stay separate."""
import io
import errno
import json
import uuid
import zipfile
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from pathlib import Path

import pytest

from app.core.config import get_settings
from app.models.background_job import BackgroundJob
from app.models.import_record import ImportRecord
from app.services import uploads
from app.services.adaptive_import import memory_budget as budget
from app.services.adaptive_import.analysis import analyze_documents, default_mapping
from app.services.adaptive_import.contracts import AdaptiveImportError, SourceDocument
from app.services.adaptive_import.manifest_stream import read_manifest
from app.services.adaptive_import.normalization import normalize_group
from app.services.adaptive_import.profiles import normalize_builtin
from app.services.adaptive_import.resource_wait import defer_resource, finish_wait
from app.services.adaptive_import.stream_markdown import resource_chunks
from app.services.background_jobs import claim_next_job, process_background_job
from app.services.canonical.stream_persistence import conversation_hash
from app.services.import_pipeline.canonical_draft import content_hash
from app.services.import_pipeline.record_spool import RecordSpool
from test_adaptive_import_api import _complete_analysis
from test_import_analysis_queue import claim, database, small_conversation_zip
from test_import_preview_api import client

MIB = 1024**2


@pytest.fixture
def bounded_client(client, monkeypatch):
    monkeypatch.setenv("IMPORT_BOUNDED_ZIP_ENABLED", "true")
    get_settings.cache_clear()
    monkeypatch.setattr(budget, "effective_total_memory_bytes", lambda: 640 * MIB)
    # Unit/integration fixtures isolate decisions; the separate exact-image CI
    # gate exercises unmodified real RSS/cgroup probes, including file cache.
    monkeypatch.setattr(budget, "process_resident_memory_bytes", lambda: 80 * MIB)
    yield client
    get_settings.cache_clear()


def queued(client, content=None):
    response = client.post("/api/adaptive-import/sessions", files=[
        ("files", ("synthetic.zip", content or small_conversation_zip(), "application/zip")),
    ])
    assert response.status_code == 201, response.text
    return response.json()


@pytest.mark.parametrize("total,reserve", [(320, 128), (640, 128), (1871, 1871 / 8), (4096, 512), (8192, 512)])
def test_effective_capacity_not_zip_size_drives_reserve(monkeypatch, total, reserve):
    monkeypatch.setattr(budget, "effective_total_memory_bytes", lambda: total * MIB)
    assert budget.adaptive_reserve_bytes() == int(reserve * MIB)


def test_unknown_capacity_fails_closed(monkeypatch):
    monkeypatch.setattr(budget, "effective_total_memory_bytes", lambda: None)
    with pytest.raises(uploads.UploadLimitError, match="headroom"):
        budget.adaptive_reserve_bytes()


@pytest.mark.parametrize("bodies", [
    ["  alpha  \r\n\r\n", " beta\t\n\n"], ["", "\n", " \t"],
    ["\n a", "", "b\n"], ["中文\n\n", "\n后续  "], ["a", "\n ", "\tb"],
])
def test_incremental_hash_matches_legacy(bodies):
    messages = [SimpleNamespace(plain_text=body) for body in bodies]
    assert conversation_hash(messages) == content_hash("\n".join(bodies))


def test_manifest_discards_messages_but_validates_every_byte():
    data = {"version": "1", "messages": [{"body": "private synthetic" * 500} for _ in range(12)],
            "assets": [{"path": "assets/a.png", "width": 12, "height": 7, "body": {"unneeded": [1, 2]}}]}
    result = read_manifest(io.BytesIO(json.dumps(data).encode()), 5000)
    assert result == {"version": "1", "messages": [], "message_count": 12,
                      "assets": [{"path": "assets/a.png", "width": 12, "height": 7}]}
    assert "private synthetic" not in json.dumps(result)


@pytest.mark.parametrize("raw", [b'{"messages":[1,]}', b'{"assets":[{"path":"\\q"}]}',
                                     b'{"messages": [NaN]}', b'{"version":"1"} garbage',
                                     b'{"messages":' + b'[' * 66 + b'0' + b']' * 66 + b'}'])
def test_manifest_malformed_or_nested_input_rejected(raw):
    with pytest.raises((ValueError, UnicodeError)):
        read_manifest(io.BytesIO(raw), 5000)


def test_record_spool_offsets_integrity_and_bounded_reads(tmp_path):
    spool = RecordSpool.write(tmp_path, ({"index": i, "text": "合成" * i} for i in range(40)))
    descriptor = spool.descriptor()
    reopened = RecordSpool.open_verified(tmp_path, descriptor)
    assert reopened[-1]["index"] == 39
    assert [item["index"] for item in reopened[:3]] == [0, 1, 2]
    with reopened.path.with_suffix(".idx").open("r+b") as data:
        data.write(b"x")
    with pytest.raises(ValueError, match="integrity"):
        RecordSpool.open_verified(tmp_path, descriptor)


@pytest.mark.parametrize("name", ["../records.jsonl", "nested/records.jsonl", "nested\\records.jsonl",
                                "records.jsonl:stream", "records.idx", ""])
def test_record_spool_rejects_nonlocal_descriptor_names(tmp_path, name):
    spool = RecordSpool.write(tmp_path, [{"message": "synthetic"}])
    with pytest.raises(ValueError, match="integrity"):
        RecordSpool.open_verified(tmp_path, {**spool.descriptor(), "file": name})


@pytest.mark.parametrize("index_link", [False, True])
def test_record_spool_rejects_data_and_index_symlinks(tmp_path, index_link):
    spool = RecordSpool.write(tmp_path, [{"message": "synthetic"}])
    descriptor = spool.descriptor()
    path = spool.path.with_suffix(".idx") if index_link else spool.path
    target = path.with_name("target-" + path.name)
    path.replace(target)
    try:
        path.symlink_to(target.name)
    except OSError:
        pytest.skip("Symlinks are unavailable on this test platform.")
    with pytest.raises(ValueError, match="integrity"):
        RecordSpool.open_verified(tmp_path, descriptor)


def test_markdown_spool_preserves_legacy_roles_times_fences_and_preamble(tmp_path):
    body = "# Synthetic title\n\nPreamble.\n\n## User\nQuestion.\n\n## Assistant\n```\n## User\nnot a boundary\n```\nAnswer."
    path = tmp_path / "sample.md"
    path.write_text(body, encoding="utf-8")
    legacy = SourceDocument("synthetic", path.name, ".md", body.encode())
    streamed = SourceDocument("synthetic", path.name, ".md", b"", path)
    mapping = default_mapping(analyze_documents([legacy]))
    for preamble in ("KEEP", "IGNORE"):
        mapping["noise_rules"] = [{"region": "PREAMBLE", "action": preamble}]
        old = normalize_group([legacy], mapping, "Synthetic")[0]
        new = normalize_group([streamed], mapping, "Synthetic")[0]
        assert list(new.messages) == old.messages
        assert new.title == old.title
        assert new.first_user_message == old.first_user_message
        repeated = normalize_group([streamed], mapping, "Synthetic")[0]
        assert repeated.stream_records.path == new.stream_records.path


def test_long_document_is_not_one_large_message(tmp_path):
    # No blank separators: real role headings, not chunk length, split messages.
    body = "# Long fixture\n" + "".join(
        f"## {'User' if index % 2 == 0 else 'Assistant'}\n" + "Synthetic body.\n" * 6000
        for index in range(36))
    path = tmp_path / "long.md"
    path.write_text(body, encoding="utf-8")
    assert path.stat().st_size > MIB
    document = SourceDocument("synthetic", path.name, ".md", b"", path)
    analysis = analyze_documents([document])
    draft = normalize_group([document], default_mapping(analysis), "Synthetic")[0]
    assert draft.message_count == 36 and len(draft.stream_records) == 36
    assert "".join(resource_chunks(path)) == body


def test_oversized_single_message_is_not_truncated(tmp_path):
    path = tmp_path / "too-large.md"
    path.write_text("# Single\n" + "x" * (MIB + 1), encoding="utf-8")
    with pytest.raises(AdaptiveImportError) as caught:
        analyze_documents([SourceDocument("synthetic", path.name, ".md", b"", path)])
    assert caught.value.code == "IMPORT_MESSAGE_TOO_LARGE"
    assert path.stat().st_size > MIB


def test_zip_beyond_old_text_block_caps_commits_v2_atomically(bounded_client, tmp_path):
    raw = io.BytesIO()
    body = "# Synthetic\n\n" + "".join(
        f"## {'User' if index % 2 == 0 else 'Assistant'}\n\n" +
        "\n\n".join(f"Paragraph {line}: " + "x" * 55 for line in range(180)) + "\n\n"
        for index in range(36))
    with zipfile.ZipFile(raw, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr("conversation.md", body)
        archive.writestr("manifest.json", json.dumps({"version": "1", "assets": [], "messages": [{}] * 52}))
    ready = _complete_analysis(bounded_client, queued(bounded_client, raw.getvalue()))
    assert ready["state"] == "READY" and ready["message_count"] == 36
    with database() as db:
        record = db.get(ImportRecord, uuid.UUID(ready["import_id"]))
        assert record.draft_summary["format_version"] == 2
        from app.services.import_pipeline.draft_store import iter_import_draft
        drafts = list(iter_import_draft(record, db=db))
        assert len(drafts) == 1 and len(drafts[0].messages) == 36
        from app.services.canonical.block_builder import iter_basic_render_blocks
        assert sum(sum(1 for _ in iter_basic_render_blocks(m.display_text)) for m in drafts[0].messages) > 6000
    response = bounded_client.post(f"/api/imports/{ready['import_id']}/commit")
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "committed"
    assert response.json()["message_count"] == 36


def test_resource_backoff_reuses_job_and_releases_claim(bounded_client, monkeypatch):
    session = queued(bounded_client)
    task_id, factory = claim(session)
    monkeypatch.setattr(uploads, "available_memory_bytes", lambda: 191 * MIB)
    process_background_job(task_id, session_factory=factory)
    task = bounded_client.get(f"/api/tasks/{task_id}").json()
    assert task["status"] == "queued" and task["phase"] == "waiting_resources"
    assert task["attempt_count"] == 0 and task["cancellable"]
    with database() as db:
        assert claim_next_job(db, job_type="adaptive_import_analysis") is None
        job = db.get(BackgroundJob, task_id)
        job.next_run_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()
    monkeypatch.setattr(uploads, "available_memory_bytes", lambda: 192 * MIB)
    ready = _complete_analysis(bounded_client, session)
    assert ready["state"] == "READY" and ready["failure"] is None


def test_resource_wait_limit_counts_wait_not_work_and_is_manually_resumable(bounded_client, monkeypatch):
    session = queued(bounded_client)
    task_id, factory = claim(session)
    with database() as db:
        row = db.get(BackgroundJob, task_id)
        row.result = {"resource_wait": {"waiting_since": (datetime.now(timezone.utc) - timedelta(seconds=1801)).isoformat(),
                                       "waited_seconds": 0, "checks": 4}}
        finish_wait(row, "result")
        record = db.get(ImportRecord, uuid.UUID(session["import_id"]))
        assert defer_resource(row, record, uploads._memory_pressure_error(), stage="analysis")
        assert row.status == "failed" and row.phase == "resource_paused"
        db.commit()
    paused = bounded_client.get(f"/api/tasks/{task_id}").json()
    assert paused["error_message"] == "IMPORT_RESOURCE_WAIT_EXPIRED"
    assert paused["failure"]["code"] == "IMPORT_RESOURCE_WAIT_EXPIRED"
    retried = bounded_client.post(f"/api/tasks/{task_id}/retry").json()
    assert retried["job_id"] == str(task_id) and retried["status"] == "queued"
    assert retried["resource_wait"] is None
    assert _complete_analysis(bounded_client, session)["state"] == "READY"


def test_replacement_health_and_reanalysis_are_worker_operations(bounded_client, monkeypatch):
    ready = _complete_analysis(bounded_client, queued(bounded_client))
    import_id = ready["import_id"]
    family_id = ready["families"][0]["id"]
    response = bounded_client.post(f"/api/adaptive-import/sessions/{import_id}/families/{family_id}/health")
    assert response.status_code == 202
    health_job = response.json()["operation_task_id"]
    restored = _complete_analysis(bounded_client, response.json())
    assert restored["state"] == "READY"
    health = bounded_client.get(f"/api/tasks/{health_job}").json()["result"]["operation_result"]
    assert health["valid"]
    replacement = bounded_client.put(f"/api/adaptive-import/sessions/{import_id}/artifacts/{ready['archives'][0]['artifact_id']}",
                                     files={"file": ("replacement.zip", small_conversation_zip(), "application/zip")})
    assert replacement.status_code == 202
    assert _complete_analysis(bounded_client, replacement.json())["state"] == "READY"


def test_corrupt_stream_draft_does_not_publish_any_conversation(bounded_client):
    ready = _complete_analysis(bounded_client, queued(bounded_client))
    with database() as db:
        record = db.get(ImportRecord, uuid.UUID(ready["import_id"]))
        root = Path(get_settings().import_storage_dir) / str(record.id)
        manifest = json.loads((Path(get_settings().import_storage_dir) / record.draft_storage_uri).read_text())
        header = RecordSpool.open_verified(root, manifest["conversations"])[0]
        with (root / header["records"]["file"]).open("ab") as source:
            source.write(b"corrupt")
    response = bounded_client.post(f"/api/imports/{ready['import_id']}/commit")
    assert response.status_code >= 400
    assert bounded_client.get("/api/conversations").json() == []


def test_late_stream_commit_failure_rolls_back_preceding_conversation(bounded_client, monkeypatch):
    from app.models.conversation import Conversation
    from app.models.message import Message
    from app.services.canonical import persistence
    from app.services.adaptive_import.bounded_io import file_hash

    response = bounded_client.post("/api/adaptive-import/sessions", files=[
        ("files", (name, small_conversation_zip(), "application/zip"))
        for name in ("first.zip", "second.zip")
    ])
    assert response.status_code == 201, response.text
    ready = _complete_analysis(bounded_client, response.json())
    assert ready["state"] == "READY" and ready["conversation_count"] == 2
    persist = persistence._persist_conversation
    writes = []

    def fail_after_second_write(*args, **kwargs):
        conversation = persist(*args, **kwargs)
        writes.append(conversation.id)
        if len(writes) == 2:
            raise uploads.UploadLimitError("IMPORT_STORAGE_FULL", "Synthetic storage failure.", status_code=507)
        return conversation

    monkeypatch.setattr(persistence, "_persist_conversation", fail_after_second_write)
    with database() as db:
        record = db.get(ImportRecord, uuid.UUID(ready["import_id"]))
        root = Path(get_settings().import_storage_dir) / str(record.id)
        source_hashes = [(root / artifact.safe_filename, artifact.sha256)
                         for artifact in record.artifacts]
        draft = Path(get_settings().import_storage_dir) / record.draft_storage_uri
        with pytest.raises(persistence.CommitImportError, match="no conversation was published"):
            persistence.commit_import_preview(record.id, db)
        assert len(writes) == 2
        assert db.query(Conversation).count() == 0
        assert db.query(Message).count() == 0
        assert draft.is_file()
        assert all(file_hash(path) == digest for path, digest in source_hashes)


@pytest.mark.parametrize("ending", ["", "\n", "\n\n", "\r\n"])
def test_stream_transcript_matches_existing_profile_exactly(tmp_path, ending):
    from test_transcript_markdown import transcript
    text = transcript().rstrip("\n") + ending
    path = tmp_path / "transcript.md"
    path.write_bytes(text.encode())
    key = "builtin:chatgpt-markdown-transcript-v1"
    old = normalize_builtin(key, [SourceDocument("synthetic", path.name, ".md", text.encode())])[0]
    new = normalize_builtin(key, [SourceDocument("synthetic", path.name, ".md", b"", path)])[0]
    assert list(new.messages) == old.messages
    assert (new.title, new.created_at, new.updated_at) == (old.title, old.created_at, old.updated_at)
    assert [ref for item in new.stream_records for ref in item["source_refs"]] == old.source_refs


def test_stream_native_markers_keep_roles_timestamps_and_literal_markers(tmp_path):
    text = ('---\nformat: "chat-reader-markdown-export"\nversion: 2\n---\n# Native fixture\n\n'
            '<!-- chat-reader-message\nrole: "user"\norder_key: "0001"\ncreated_at: "2026-01-01T10:00:00Z"\n-->\n'
            '## User · 0001\n\nQuestion\n<!-- /chat-reader-message -->\n\n'
            '<!-- chat-reader-message\nrole: "unknown"\n-->\nIgnored unknown role.\n<!-- /chat-reader-message -->\n\n'
            '<!-- chat-reader-message\nrole: "assistant"\norder_key: "0003"\n-->\n'
            '## Assistant · 0003\n\n````md\n<!-- /chat-reader-message -->\n```\n````\n'
            'Answer\n<!-- /chat-reader-message -->\n')
    path = tmp_path / "native.md"
    path.write_text(text, encoding="utf-8")
    key = "builtin:chat-reader-markdown-v2"
    old = normalize_builtin(key, [SourceDocument("synthetic", path.name, ".md", text.encode())])[0]
    new = normalize_builtin(key, [SourceDocument("synthetic", path.name, ".md", b"", path)])[0]
    assert list(new.messages) == old.messages
    assert new.message_count == 2 and new.title == old.title


def test_literal_resource_scanning_does_not_rewrite_nested_pre_code(tmp_path):
    from app.services.adaptive_import.archive_sources import _rewrite_document_references
    text = ('<pre><code>\n\n[synthetic](assets/a.bin)\n</code>\n\n'
            '[still literal](assets/a.bin)\n</pre>\n\n[real](assets/a.bin)\n')
    path = tmp_path / "literal.md"
    path.write_text(text, encoding="utf-8")
    members = {"synthetic": {"path": "assets/a.bin", "member_id": "synthetic", "use": "attachment"}}
    expected = _rewrite_document_references(text, "conversation.md", members)
    assert "".join(_rewrite_document_references(chunk, "conversation.md", members)
                   for chunk in resource_chunks(path)) == expected


def test_workspace_and_storage_failures_are_not_automatic_retries():
    record = SimpleNamespace(artifacts=[SimpleNamespace(source_type="adaptive_archive")])
    row = SimpleNamespace(payload={}, result={}, attempt_count=1)
    for error in [uploads.UploadLimitError("IMPORT_WORKSPACE_EXCEEDED", "bounded", status_code=422),
                  OSError(errno.ENOSPC, "synthetic storage full")]:
        assert not defer_resource(row, record, error, stage="analysis")


@pytest.mark.parametrize("storage_errno", [errno.ENOSPC, errno.EDQUOT])
def test_health_storage_exhaustion_is_not_reported_as_mapping_drift(bounded_client, monkeypatch, storage_errno):
    from app.services.adaptive_import import service
    ready = _complete_analysis(bounded_client, queued(bounded_client))
    family_id = ready["families"][0]["id"]
    with database() as db:
        record = db.get(ImportRecord, uuid.UUID(ready["import_id"]))
        original_draft = record.draft_storage_uri
        original_resolution = record.structure_families[0].resolution_status

    def no_space(*args, **kwargs):
        raise OSError(storage_errno, "Synthetic storage capacity failure.")

    monkeypatch.setattr(service, "normalize_builtin", no_space)
    response = bounded_client.post(f"/api/adaptive-import/sessions/{ready['import_id']}/families/{family_id}/health")
    assert response.status_code == 202
    job_id, factory = claim(response.json())
    process_background_job(job_id, session_factory=factory)
    task = bounded_client.get(f"/api/tasks/{job_id}").json()
    assert task["status"] == "failed"
    assert task["failure"]["code"] == "IMPORT_STORAGE_FULL"
    assert not task["failure"]["retryable"]
    with database() as db:
        record = db.get(ImportRecord, uuid.UUID(ready["import_id"]))
        assert record.draft_storage_uri == original_draft
        assert record.structure_families[0].resolution_status == original_resolution
        assert (Path(get_settings().import_storage_dir) / original_draft).is_file()


def test_json_replacement_does_not_borrow_zip_admission(bounded_client, monkeypatch):
    from app.services.adaptive_import.operations import operation_admission
    with database() as db:
        record = SimpleNamespace(id=uuid.uuid4(), artifacts=[
            SimpleNamespace(id="old", source_type="adaptive_archive", byte_size=1)], draft_summary={})
        payload = {"operation": "replace", "arguments": {"artifact_id": "old", "filename": "source.json",
                   "stored": {"byte_size": 10 * MIB, "safe_filename": "source.json"}}}
        monkeypatch.setattr(uploads, "available_memory_bytes", lambda: 192 * MIB)
        with pytest.raises(uploads.UploadLimitError) as caught:
            with operation_admission(db, record, payload):
                pytest.fail("JSON must still require standard materialization admission.")
        assert caught.value.code == "UPLOAD_MEMORY_PRESSURE"


def test_normalization_generation_is_immutable_when_mapping_changes(tmp_path):
    body = "# Title\n\nPreamble\n\n## User\nQuestion\n\n## Assistant\nAnswer"
    path = tmp_path / "source.md"
    path.write_text(body, encoding="utf-8")
    document = SourceDocument("synthetic", path.name, ".md", b"", path)
    mapping = default_mapping(analyze_documents([document]))
    first = normalize_group([document], mapping, "Synthetic")[0]
    descriptor = first.stream_records.descriptor()
    mapping["noise_rules"] = [{"region": "PREAMBLE", "action": "KEEP"}]
    second = normalize_group([document], mapping, "Synthetic")[0]
    assert first.stream_records.path != second.stream_records.path
    assert first.stream_records.descriptor() == descriptor
    assert "Preamble" not in first.messages[0].display_text
    assert "Preamble" in second.messages[0].display_text


def test_waiting_commit_can_be_cancelled_without_losing_source_or_draft(bounded_client):
    from app.services.import_queue import queue_import, claim_next_import
    ready = _complete_analysis(bounded_client, queued(bounded_client))
    with database() as db:
        record = db.get(ImportRecord, uuid.UUID(ready["import_id"]))
        queue_import(record, db)
        assert defer_resource(record, record, uploads._memory_pressure_error(), stage="commit")
        original_uri = record.draft_storage_uri
        db.commit()
    cancelled = bounded_client.post(f"/api/tasks/{ready['import_id']}/cancel")
    assert cancelled.status_code == 200 and cancelled.json()["status"] == "cancelled"
    with database() as db:
        record = db.get(ImportRecord, uuid.UUID(ready["import_id"]))
        assert record.session_state == "READY" and record.next_run_at is None
        assert record.draft_storage_uri == original_uri
        assert (Path(get_settings().import_storage_dir) / original_uri).is_file()
        assert claim_next_import(db) is None
    assert bounded_client.post(f"/api/imports/{ready['import_id']}/commit").status_code == 200


@pytest.mark.parametrize("name", ["../escape.md", "/absolute.md", "assets/../../escape.md"])
def test_bounded_archive_retains_path_security(bounded_client, name):
    raw = io.BytesIO()
    with zipfile.ZipFile(raw, "w", zipfile.ZIP_STORED) as archive:
        archive.writestr(name, "# Synthetic\n\n## User\nQuestion\n\n## Assistant\nAnswer")
    session = queued(bounded_client, raw.getvalue())
    task_id, factory = claim(session)
    process_background_job(task_id, session_factory=factory)
    task = bounded_client.get(f"/api/tasks/{task_id}").json()
    assert task["status"] == "failed" and task["failure"]["code"] == "ZIP_PATH_UNSAFE"
    assert bounded_client.get("/api/conversations").json() == []


def test_stream_blocks_preserve_task_ordinals_and_offsets():
    from app.services.canonical.block_builder import extract_markdown_tasks, iter_basic_render_blocks
    text = "# Tasks\n\n- [x] Same\n- [ ] Other\n\n```\n- [x] Not a task\n```\n\n- [ ] Same\n"
    expected = extract_markdown_tasks(text)
    actual = [task for block in iter_basic_render_blocks(text) for task in block.data.get("tasks", [])]
    assert [item["task_key"] for item in actual] == [item.task_key for item in expected]
    assert [item["checked_offset"] for item in actual] == [item.checked_offset for item in expected]
    assert [item["ordinal"] for item in actual] == [0, 1, 2]
