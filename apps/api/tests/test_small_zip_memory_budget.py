"""The reduced reserve is a bounded ZIP policy, not a general memory bypass."""
import io
import json
import struct
import uuid
import zipfile
from pathlib import Path
from dataclasses import replace

import pytest

from app.core.config import get_settings
from app.models.import_record import ImportRecord
from app.services.adaptive_import import memory_budget as budget
from app.services.background_jobs import process_background_job
from app.services import uploads
from app.services.task_errors import import_failure_from_exception, public_import_failure
from test_import_analysis_queue import claim, database, small_conversation_zip
from test_import_preview_api import client
from test_adaptive_import_api import _complete_analysis

MIB = 1024**2


@pytest.fixture(autouse=True)
def legacy_small_zip_policy(monkeypatch):
    monkeypatch.setenv("IMPORT_BOUNDED_ZIP_ENABLED", "false")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def queued_zip(client, content=None):
    response = client.post("/api/adaptive-import/sessions", files=[
        ("files", ("synthetic.zip", content or small_conversation_zip(), "application/zip")),
    ])
    assert response.status_code == 201, response.text
    return response.json()


def test_runtime_fixture_preserves_actual_markdown_boundaries_and_attachment_shape(client, monkeypatch):
    from scripts.verify_small_zip_memory import synthetic_zip
    content = synthetic_zip()
    assert 1_400_000 <= len(content) <= 1_600_000
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        assert len(archive.infolist()) == 18
        assert len(archive.read("conversation.md")) == 22587
    monkeypatch.setattr(uploads, "available_memory_bytes", lambda: 224 * MIB)
    ready = _complete_analysis(client, queued_zip(client, content))
    receipt = ready["analysis_summary"]["small_zip_profile"]
    assert {key: receipt[key] for key in (
        "conversation_count", "message_count", "block_count", "attachment_count", "reference_count",
    )} == {
        "conversation_count": 1, "message_count": 4, "block_count": 177,
        "attachment_count": 14, "reference_count": 13,
    }


@pytest.mark.parametrize("headroom", [None, 0, 191 * MIB])
def test_small_zip_rejection_is_safe_before_parsing_and_original_job_retries(client, monkeypatch, headroom):
    queued = queued_zip(client)
    job_id, factory = claim(queued)
    with monkeypatch.context() as patch:
        patch.setattr(uploads, "available_memory_bytes", lambda: headroom)
        patch.setattr("app.services.adaptive_import.service.analyze_documents", lambda *_: pytest.fail("Parser entered before admission."))
        process_background_job(job_id, session_factory=factory)
    failed = client.get(f"/api/tasks/{job_id}").json()
    expected = {"code": "UPLOAD_MEMORY_PRESSURE", "stage": "admission", "retryable": True}
    assert failed["status"] == "failed" and failed["failure"] == expected
    stored = client.get(f"/api/adaptive-import/sessions/{queued['import_id']}").json()
    assert stored["state"] == "FAILED" and stored["failure"] == expected
    assert not stored["analysis_summary"].get("small_zip_profile")
    assert client.get("/api/conversations").json() == []
    assert client.post(f"/api/tasks/{job_id}/retry").json()["job_id"] == str(job_id)
    monkeypatch.setattr(uploads, "available_memory_bytes", lambda: 192 * MIB)
    current = client.get(f"/api/adaptive-import/sessions/{queued['import_id']}").json()
    ready = _complete_analysis(client, current)
    assert ready["state"] == "READY" and ready["failure"] is None
    assert ready["analysis_summary"]["small_zip_profile"]["message_count"] == 4


@pytest.mark.parametrize("disabled", [True, False])
def test_disabled_policy_or_unknown_rss_cannot_reduce_the_standard_reserve(client, monkeypatch, disabled):
    queued = queued_zip(client)
    monkeypatch.setattr(uploads, "available_memory_bytes", lambda: 224 * MIB)
    if disabled:
        monkeypatch.setenv("IMPORT_SMALL_ZIP_ENABLED", "false")
        get_settings.cache_clear()
    else:
        monkeypatch.setattr(budget, "process_resident_memory_bytes", lambda: None)
    job_id, factory = claim(queued)
    process_background_job(job_id, session_factory=factory)
    result = client.get(f"/api/tasks/{job_id}").json()
    assert result["failure"]["code"] == "UPLOAD_MEMORY_PRESSURE"


@pytest.mark.parametrize("kind", ["multi-document", "large-document", "many-entries", "expanded"])
def test_nonqualifying_zip_uses_unchanged_standard_admission(client, monkeypatch, kind):
    content = io.BytesIO()
    with zipfile.ZipFile(content, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("one.md", b"x" * (budget.MAX_TEXT_BYTES + 1) if kind == "large-document"
                         else b"# User\nQuestion\n\n# Assistant\nAnswer")
        if kind == "multi-document":
            archive.writestr("two.md", b"# Other document\n")
        elif kind == "many-entries":
            for index in range(budget.MAX_ENTRIES):
                archive.writestr(f"assets/{index}.bin", b"x")
        elif kind == "expanded":
            archive.writestr("expanded.bin", b"x" * (budget.MAX_ARCHIVE_BYTES + 1))
    queued = queued_zip(client, content.getvalue())
    monkeypatch.setattr(uploads, "available_memory_bytes", lambda: 224 * MIB)
    job_id, factory = claim(queued)
    process_background_job(job_id, session_factory=factory)
    assert client.get(f"/api/tasks/{job_id}").json()["failure"]["code"] == "UPLOAD_MEMORY_PRESSURE"


def test_safe_entry_cap_allows_256_members_and_enforces_attachment_cap_after_classification(client, monkeypatch):
    content = io.BytesIO()
    transcript = "# User\nQuestion\n\n# Assistant\n![one](assets/one.bin)"
    with zipfile.ZipFile(content, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr("conversation.md", transcript)
        archive.writestr("manifest.json", json.dumps({"version": "1", "assets": [], "messages": []}))
        archive.writestr("assets/one.bin", b"Synthetic referenced attachment.")
        for index in range(253):
            archive.writestr(f"extras/{index:03}.txt", f"Synthetic excluded resource {index}.")
    with zipfile.ZipFile(io.BytesIO(content.getvalue())) as archive:
        assert len(archive.infolist()) == 256
    monkeypatch.setattr(uploads, "available_memory_bytes", lambda: 224 * MIB)
    queued = queued_zip(client, content.getvalue())
    job_id, factory = claim(queued)
    process_background_job(job_id, session_factory=factory)
    result = client.get(f"/api/tasks/{job_id}").json()
    # The parser gets through low-memory admission; the deliberately undeclared
    # extras remain excluded, while the actual reference is a single attachment.
    assert result["status"] == "committed", result
    ready = client.get(f"/api/adaptive-import/sessions/{queued['import_id']}").json()
    assert ready["analysis_summary"]["small_zip_profile"]["attachment_count"] == 1


@pytest.mark.parametrize("count,length", [(257, 100), (2, budget.MAX_DIRECTORY_BYTES + 1), (65535, 100)])
def test_oversized_directory_is_rejected_before_zipfile_allocates(monkeypatch, count, length):
    source = io.BytesIO(b"x" * 100 + struct.pack("<4s4H2LH", b"PK\x05\x06", 0, 0, count, count, length, 0, 0))
    monkeypatch.setattr(zipfile, "ZipFile", lambda *_: pytest.fail("Unbounded central directory allocated."))
    assert not budget._qualifies(source)
    assert source.tell() == 0


@pytest.mark.parametrize("value,maximum", [
    (budget.MAX_MESSAGES + 1, budget.MAX_MESSAGES),
    (budget.MAX_BLOCKS + 1, budget.MAX_BLOCKS),
    (budget.MAX_REFERENCES + 1, budget.MAX_REFERENCES),
    (budget.MAX_DRAFT_BYTES + 1, budget.MAX_DRAFT_BYTES),
])
def test_budget_caps_fail_instead_of_truncating(monkeypatch, value, maximum):
    monkeypatch.setattr(uploads, "available_memory_bytes", lambda: 224 * MIB)
    monkeypatch.setattr(budget, "process_resident_memory_bytes", lambda: 100 * MIB)
    token = budget._active.set(budget.SmallImportBudget(100 * MIB, "analysis"))
    try:
        with pytest.raises(uploads.UploadLimitError) as error:
            budget.enforce_limit(value, maximum)
        assert error.value.code == "SMALL_IMPORT_BUDGET_EXCEEDED"
    finally:
        budget._active.reset(token)
    budget.enforce_limit(value, maximum)  # standard path is not globally capped


def test_rss_growth_and_lost_headroom_stop_the_active_budget(monkeypatch):
    monkeypatch.setattr(uploads, "available_memory_bytes", lambda: 224 * MIB)
    monkeypatch.setattr(budget, "process_resident_memory_bytes", lambda: 165 * MIB)
    with pytest.raises(uploads.UploadLimitError, match="bounded small-ZIP"):
        budget.SmallImportBudget(100 * MIB, "analysis").checkpoint()
    monkeypatch.setattr(uploads, "available_memory_bytes", lambda: None)
    with pytest.raises(uploads.UploadLimitError) as error:
        budget.SmallImportBudget(100 * MIB, "commit").checkpoint()
    assert error.value.code == "UPLOAD_MEMORY_PRESSURE"


@pytest.mark.parametrize("shape", ["messages", "blocks", "references"])
def test_real_parser_budget_overflow_leaves_source_and_no_partial_preview(client, monkeypatch, shape):
    if shape == "messages":
        transcript = "# Transcript\n\n" + "\n\n".join(
            f"## {'User' if index % 2 == 0 else 'Assistant'}\nSynthetic {index}."
            for index in range(budget.MAX_MESSAGES + 1)
        )
    else:
        body = "\n\n".join(
            (f"Paragraph {index}." if shape == "blocks" else "![synthetic](assets/pic.png)")
            for index in range(budget.MAX_BLOCKS + 1 if shape == "blocks" else budget.MAX_REFERENCES + 1)
        )
        transcript = f"# Transcript\n\n## User\nQuestion.\n\n## Assistant\n{body}"
    content = io.BytesIO()
    with zipfile.ZipFile(content, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr("conversation.md", transcript)
        archive.writestr("manifest.json", json.dumps({
            "version": "1", "messages": [], "assets": [{"path": "assets/pic.png"}],
        }))
        archive.writestr("assets/pic.png", b"\x89PNG\r\n\x1a\nsynthetic")
    queued = queued_zip(client, content.getvalue())
    monkeypatch.setattr(uploads, "available_memory_bytes", lambda: 224 * MIB)
    job_id, factory = claim(queued)
    process_background_job(job_id, session_factory=factory)
    failed = client.get(f"/api/tasks/{job_id}").json()
    assert failed["status"] == "failed"
    assert failed["failure"]["code"] == "SMALL_IMPORT_BUDGET_EXCEEDED"
    assert client.get("/api/conversations").json() == []
    root = Path(get_settings().import_storage_dir) / queued["import_id"]
    assert (root / "synthetic.zip").read_bytes() == content.getvalue()
    assert not (root / "canonical-draft.jsonl").exists()


def test_archive_reads_are_streamed_and_never_allow_unbounded_reads(monkeypatch):
    monkeypatch.setattr(uploads, "available_memory_bytes", lambda: 224 * MIB)
    stream = budget.BudgetedArchiveStream(io.BytesIO(b"x" * (128 * 1024)))
    assert len(stream.read(MIB)) == 64 * 1024
    with pytest.raises(uploads.UploadLimitError):
        stream.read()


def test_oversized_draft_never_replaces_the_previous_durable_preview(client, monkeypatch):
    from app.services.import_pipeline.draft_store import write_import_draft
    from app.services.import_pipeline.exporter_aligner import align_exporter_sources
    from app.services.import_pipeline.exporter_json_parser import parse_exporter_json
    from test_import_analysis_queue import source
    draft = align_exporter_sources(parse_exporter_json(source()), None).conversation
    draft = replace(draft, messages=[replace(draft.messages[0], display_text="x" * budget.MAX_DRAFT_BYTES)])
    identity = uuid.uuid4()
    root = Path(get_settings().import_storage_dir) / str(identity)
    root.mkdir(parents=True)
    previous = root / "canonical-draft.jsonl"
    previous.write_bytes(b"synthetic previous preview\n")
    monkeypatch.setattr(uploads, "available_memory_bytes", lambda: 224 * MIB)
    token = budget._active.set(budget.SmallImportBudget(budget.process_resident_memory_bytes(), "analysis"))
    try:
        with pytest.raises(uploads.UploadLimitError) as error:
            write_import_draft(identity, [draft])
        assert error.value.code == "SMALL_IMPORT_BUDGET_EXCEEDED"
    finally:
        budget._active.reset(token)
    assert previous.read_bytes() == b"synthetic previous preview\n"
    assert [item.name for item in root.iterdir()] == ["canonical-draft.jsonl"]


@pytest.mark.parametrize("mutation", ["draft-bytes", "archive-bytes", "classification", "fingerprint"])
def test_stale_receipt_cannot_admit_low_memory_commit(client, monkeypatch, mutation):
    ready = _complete_analysis(client, queued_zip(client))
    with database() as db:
        record = db.get(ImportRecord, uuid.UUID(ready["import_id"]))
        if mutation.endswith("bytes"):
            if mutation == "draft-bytes":
                path = Path(get_settings().import_storage_dir) / record.draft_storage_uri
            else:
                from app.services.adaptive_import.archive_sources import _artifact_path
                artifact = next(item for item in record.artifacts if item.source_type == "adaptive_archive")
                path = _artifact_path(record, artifact)
            content = path.read_bytes()
            # Same length, so a stat-only check cannot authorize these bytes.
            path.write_bytes(content[:25] + bytes([content[25] ^ 1]) + content[26:])
        else:
            summary = dict(record.analysis_summary)
            receipt = dict(summary["small_zip_profile"])
            receipt["classification_version" if mutation == "classification" else "source_fingerprint"] = "stale"
            summary["small_zip_profile"] = receipt
            record.analysis_summary = summary
            db.commit()
    monkeypatch.setattr(uploads, "available_memory_bytes", lambda: 224 * MIB)
    result = client.post(f"/api/imports/{ready['import_id']}/commit")
    assert result.status_code == 429, result.text
    assert result.json()["detail"]["failure"]["code"] == "UPLOAD_MEMORY_PRESSURE"
    assert client.get("/api/conversations").json() == []


def test_replacement_cannot_borrow_the_previous_zip_qualification(client, monkeypatch):
    ready = _complete_analysis(client, queued_zip(client))
    artifact = ready["archives"][0]
    with database() as db:
        record = db.get(ImportRecord, uuid.UUID(ready["import_id"]))
        original_hash = next(item.sha256 for item in record.artifacts if item.source_type == "adaptive_archive")
    monkeypatch.setattr(uploads, "available_memory_bytes", lambda: 224 * MIB)
    result = client.put(f"/api/adaptive-import/sessions/{ready['import_id']}/artifacts/{artifact['artifact_id']}",
                        files={"file": ("replacement.md", b"# Replacement\n\nSynthetic.", "text/markdown")})
    assert result.status_code == 429
    stored = client.get(f"/api/adaptive-import/sessions/{ready['import_id']}").json()
    assert stored["state"] == "READY"
    assert stored["archives"][0]["artifact_id"] == artifact["artifact_id"]
    with database() as db:
        record = db.get(ImportRecord, uuid.UUID(ready["import_id"]))
        assert next(item.sha256 for item in record.artifacts if item.source_type == "adaptive_archive") == original_hash


def test_memory_loss_during_attachment_commit_rolls_back_all_content(client, monkeypatch):
    from app.models.attachment import Attachment, AssetObject
    from app.services.assets.asset_store import LocalAssetStore
    monkeypatch.setenv("ASSET_STORAGE_DIR", str(Path(get_settings().import_storage_dir).parent / "assets"))
    get_settings.cache_clear()
    ready = _complete_analysis(client, queued_zip(client))
    headroom = [224 * MIB]
    monkeypatch.setattr(uploads, "available_memory_bytes", lambda: headroom[0])
    original_stage = LocalAssetStore.stage

    def stage(self, *args, **kwargs):
        staged = original_stage(self, *args, **kwargs)
        headroom[0] = 0
        return staged

    monkeypatch.setattr(LocalAssetStore, "stage", stage)
    result = client.post(f"/api/imports/{ready['import_id']}/commit")
    assert result.status_code == 429, result.text
    assert client.get("/api/conversations").json() == []
    with database() as db:
        assert db.query(Attachment).count() == db.query(AssetObject).count() == 0
    root = Path(get_settings().asset_storage_dir)
    assert not list(root.rglob("*.part"))
    assert not [path for path in (root / "objects").rglob("*") if path.is_file()]
    assert list((Path(get_settings().import_storage_dir) / ready["import_id"]).glob("*.zip"))


def test_structured_failure_retains_only_safe_cause_and_legacy_codes():
    inner = uploads.UploadLimitError("UPLOAD_MEMORY_PRESSURE", "/private/path/with/secret", status_code=429)
    outer = ValueError("private wrapper")
    outer.__cause__ = inner
    assert import_failure_from_exception(outer, stage="commit") == {
        "code": "UPLOAD_MEMORY_PRESSURE", "stage": "commit", "retryable": True,
    }
    assert import_failure_from_exception(ValueError("credentials"), stage="analysis")["code"] == "TASK_FAILED"
    assert public_import_failure({"code": [], "stage": {}, "retryable": True}) is None
    assert public_import_failure(None, error_message="UPLOAD_MEMORY_PRESSURE")["retryable"] is True
