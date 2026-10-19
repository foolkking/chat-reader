"""Compressed input must not bypass admission by using a small gzip size."""
import gzip
import random
import string
import uuid
from types import SimpleNamespace

import pytest

from app.core.config import get_settings
from app.services import uploads
from app.services.adaptive_import import service
from app.services.adaptive_import.analysis import analyze_documents, default_mapping
from app.services.adaptive_import.contracts import SourceDocument
from app.services.import_pipeline import canjson_parser
from app.services.import_pipeline.source_detector import detect_source_profile
from test_canjson_parser import _jsonl, _manifest, _message
from test_import_preview_api import client  # noqa: F401


@pytest.fixture
def compressed_source(monkeypatch):
    monkeypatch.setenv("UPLOAD_HEAVY_THRESHOLD_MB", "1")
    monkeypatch.setenv("UPLOAD_MEMORY_RESERVE_MB", "64")
    monkeypatch.setenv("UPLOAD_ANALYSIS_MEMORY_FACTOR", "32")
    get_settings.cache_clear()
    generator = random.Random(20261019)
    block = "".join(generator.choices(string.ascii_letters + string.digits, k=8192))
    body = block * 256
    message = _message()
    message["current_version"]["content_markdown"] = body
    raw = _jsonl(_manifest(), message)
    compressed = gzip.compress(raw)
    assert len(compressed) < 1024 * 1024 < len(raw)
    assert len(raw) < len(compressed) * get_settings().canjson_max_compression_ratio
    yield compressed, body
    get_settings.cache_clear()


@pytest.mark.parametrize("available", [0, None])
def test_expanded_gzip_rechecks_headroom_before_parsing_large_json(compressed_source, monkeypatch, available):
    compressed, _ = compressed_source
    monkeypatch.setattr(uploads, "available_memory_bytes", lambda: available)
    parsed_sizes = []
    original = canjson_parser.json.loads
    def capture(raw, *args, **kwargs):
        parsed_sizes.append(len(raw))
        return original(raw, *args, **kwargs)
    monkeypatch.setattr(canjson_parser.json, "loads", capture)
    with pytest.raises(uploads.UploadLimitError) as error:
        canjson_parser.parse_canjson_v2(compressed, compressed=True)
    assert error.value.code == "UPLOAD_MEMORY_PRESSURE"
    assert error.value.status_code == 429
    assert parsed_sizes and max(parsed_sizes) < 64 * 1024


def test_gzip_source_detection_cannot_decode_an_unadmitted_large_manifest(compressed_source, monkeypatch):
    _, body = compressed_source
    manifest = {**_manifest(), "synthetic_padding": body}
    compressed = gzip.compress(_jsonl(manifest, _message()))
    monkeypatch.setattr(uploads, "available_memory_bytes", lambda: 0)
    with pytest.raises(uploads.UploadLimitError):
        detect_source_profile("synthetic.canonical.jsonl.gz", compressed)


def test_gzip_expansion_reads_small_chunks_and_does_not_reacquire_the_analysis_slot(
    compressed_source, monkeypatch,
):
    compressed, body = compressed_source
    monkeypatch.setattr(uploads, "available_memory_bytes", lambda: 16 * 1024**3)
    original = gzip.GzipFile
    requests = []
    class MeasuredGzip(original):
        def readline(self, size=-1):
            requests.append(size)
            assert 0 < size <= 64 * 1024
            return super().readline(size)
    monkeypatch.setattr(canjson_parser.gzip, "GzipFile", MeasuredGzip)
    with uploads.bounded_analysis_admission_sync([len(compressed)], force_memory_check=True):
        result = canjson_parser.parse_canjson_v2(compressed, compressed=True)
    assert len(requests) > 32
    assert result.conversation.messages[0].display_text == body


def test_gzip_preview_memory_pressure_is_retryable_not_a_format_error(client, compressed_source, monkeypatch, tmp_path):
    compressed, _ = compressed_source
    monkeypatch.setattr(uploads, "available_memory_bytes", lambda: 0)
    response = client.post("/api/imports/preview",
        files={"files": ("synthetic.canonical.jsonl.gz", compressed, "application/gzip")})
    assert response.status_code == 429, response.text[:500]
    assert response.json()["detail"]["code"] == "UPLOAD_MEMORY_PRESSURE"
    assert response.headers["retry-after"] == "15"
    assert not [path for path in (tmp_path / "storage" / "imports").rglob("*") if path.is_file()]


def test_adaptive_validation_does_not_turn_memory_pressure_into_mapping_drift(compressed_source, monkeypatch):
    compressed, _ = compressed_source
    group = SimpleNamespace(id=uuid.uuid4(), display_name="Synthetic gzip")
    family = SimpleNamespace(groups=[group])
    documents = [SourceDocument(artifact_id="synthetic", filename="synthetic.canonical.jsonl.gz",
        extension=".gz", content=compressed)]
    monkeypatch.setattr(service, "_group_documents", lambda *_: documents)
    monkeypatch.setattr(uploads, "available_memory_bytes", lambda: 0)
    with pytest.raises(uploads.UploadLimitError):
        service.evaluate_family(SimpleNamespace(), family, None, "CanJSON", builtin_key="builtin:canjson-v2")


def test_known_family_resource_failure_does_not_change_resolution_status(monkeypatch):
    family = SimpleNamespace(resolution_status="EXACT_MATCH", matched_profile_key="builtin:canjson-v2",
        match_evidence={}, groups=[])
    def fail(*_, **__):
        raise uploads.UploadLimitError("UPLOAD_MEMORY_PRESSURE", "retry later", status_code=429)
    monkeypatch.setattr(service, "evaluate_family", fail)
    with pytest.raises(uploads.UploadLimitError):
        service._resolve_known_families(None, SimpleNamespace(structure_families=[family]))
    assert family.resolution_status == "EXACT_MATCH"


def test_native_canjson_analysis_does_not_require_generic_mapping_selectors(compressed_source):
    compressed, _ = compressed_source
    analysis = analyze_documents([SourceDocument("synthetic", "synthetic.canonical.jsonl.gz", ".gz", compressed)])
    assert analysis.signature["builtin"] == "canjson-v2"
    mapping = default_mapping(analysis)
    assert mapping["source_mode"] == "JSON"
    assert mapping["messages"]["locator"] is None


def test_gzip_headroom_is_rechecked_as_multiple_records_accumulate(compressed_source, monkeypatch):
    _, body = compressed_source
    records = []
    for index in range(5):
        message = _message()
        message.update(id=f"message-{index}", order_key=f"{index:06}", seq=index + 1)
        message["current_version"].update(id=f"version-{index}", content_markdown=body[:768 * 1024])
        records.append(message)
    raw = _jsonl(_manifest(message_count=5), *records)
    compressed = gzip.compress(raw)
    assert len(raw) < len(compressed) * get_settings().canjson_max_compression_ratio
    calls = []
    def available():
        calls.append(True)
        return 16 * 1024**3 if len(calls) == 1 else 0
    monkeypatch.setattr(uploads, "available_memory_bytes", available)
    with pytest.raises(uploads.UploadLimitError):
        canjson_parser.parse_canjson_v2(compressed, compressed=True)
    assert len(calls) == 2


def test_background_gzip_resource_failure_preserves_sources_and_retries_same_task(
    client, compressed_source, monkeypatch, tmp_path,
):
    from sqlalchemy.orm import sessionmaker
    from app.core.database import get_db
    from app.main import app
    from app.services.background_jobs import claim_next_job, process_background_job

    compressed, _ = compressed_source
    uploaded = client.post("/api/adaptive-import/sessions",
        files={"files": ("synthetic.canonical.jsonl.gz", compressed, "application/gzip")})
    assert uploaded.status_code == 201
    queued = uploaded.json()
    task_id = uuid.UUID(queued["analysis_task_id"])

    def run_task():
        generator = app.dependency_overrides[get_db]()
        db = next(generator)
        try:
            factory = sessionmaker(bind=db.get_bind(), expire_on_commit=False)
            assert claim_next_job(db, job_type="adaptive_import_analysis") == task_id
            db.commit()
        finally:
            db.close()
            generator.close()
        process_background_job(task_id, session_factory=factory)
        return client.get(f"/api/tasks/{task_id}").json()

    probes = []
    def available():
        probes.append(True)
        return 16 * 1024**3 if len(probes) == 1 else 0
    monkeypatch.setattr(uploads, "available_memory_bytes", available)
    failed = run_task()
    assert failed["status"] == "failed", failed
    assert "memory" in failed["error_message"].lower()
    state = client.get(f"/api/adaptive-import/sessions/{queued['import_id']}").json()
    assert state["state"] == "FAILED"
    root = tmp_path / "storage" / "imports" / queued["import_id"]
    sources = list(root.glob("*.gz"))
    assert len(sources) == 1 and sources[0].read_bytes() == compressed
    assert not (root / "canonical-draft.jsonl").exists()

    monkeypatch.setattr(uploads, "available_memory_bytes", lambda: 16 * 1024**3)
    retry = client.post(f"/api/tasks/{task_id}/retry")
    assert retry.status_code == 200
    completed = run_task()
    assert completed["job_id"] == str(task_id)
    assert completed["status"] == "committed", completed
    state = client.get(f"/api/adaptive-import/sessions/{queued['import_id']}").json()
    assert state["state"] == "READY"
    assert state["conversation_count"] == 1
    assert sources[0].read_bytes() == compressed


@pytest.mark.parametrize("compressed", [False, True])
@pytest.mark.parametrize("ending", [b"", b"\n", b"\r\n"])
def test_chunked_jsonl_reader_keeps_exact_line_limit_and_endings(monkeypatch, compressed, ending):
    monkeypatch.setenv("CANJSON_MAX_LINE_BYTES", "128")
    get_settings.cache_clear()
    raw = b"x" * (128 - len(ending)) + ending
    try:
        source = gzip.compress(raw) if compressed else raw
        assert list(canjson_parser._iter_jsonl_lines(source, compressed=compressed)) == [(1, raw)]
        oversized = b"x" + raw
        source = gzip.compress(oversized) if compressed else oversized
        with pytest.raises(canjson_parser.CanJsonParseError, match="line limit"):
            list(canjson_parser._iter_jsonl_lines(source, compressed=compressed))
    finally:
        get_settings.cache_clear()
