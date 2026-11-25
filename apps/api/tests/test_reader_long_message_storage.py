"""Synthetic long-message regressions; text storage never relaxes metadata guards."""
import hashlib
import io
import json
import random
import zipfile
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.services.adaptive_import import memory_budget
from app.services.canonical import block_builder
from app.services.import_pipeline import record_spool
from app.services.import_pipeline.record_spool import MAX_RECORD_BYTES, RecordSpool
from app.services.uploads import UploadLimitError


def _message(body, display=None):
    return {"message": {"plain_text": body, "display_text": body if display is None else display,
                        "role": "assistant", "source_message_id": "synthetic-long-message"},
            "source_refs": [{"source_index": 0}]}


def _small_spill(tmp_path):
    spool = RecordSpool.write(tmp_path, [_message("synthetic text\n" * 22000)], spill_text=True)
    raw = json.loads(spool.path.read_bytes())
    reference = raw["message"]["plain_text"]
    return spool, raw, spool.path.with_name(reference["text_file"])


def test_text_spill_over_16_mib_roundtrips_exact_body_without_oversized_metadata(tmp_path):
    body = "s" * (17 * 1024**2) + '\r\n中文𠜎"\\\t\nend'
    assert len(body.encode()) > MAX_RECORD_BYTES
    spool = RecordSpool.write(tmp_path, [_message(body)], spill_text=True)
    assert MAX_RECORD_BYTES == 16 * 1024**2
    assert spool.path.stat().st_size < 2048
    assert len(list(tmp_path.glob("*-text-*.utf8"))) == 1
    descriptor = spool.descriptor()
    reopened = RecordSpool.open_verified(tmp_path, descriptor)
    first = reopened[0]
    assert first == _message(body)
    assert first["message"]["plain_text"] is first["message"]["display_text"]
    del first
    for restored in reopened:
        assert restored == _message(body)
        assert restored["message"]["plain_text"] is restored["message"]["display_text"]
    assert reopened.descriptor() == descriptor


def test_distinct_plain_and_display_text_are_not_coalesced(tmp_path):
    body = "synthetic plain\n" * 20000
    display = "synthetic display\n" * 20000
    spool = RecordSpool.write(tmp_path, [_message(body, display)], spill_text=True)
    assert len(list(tmp_path.glob("*-text-*.utf8"))) == 2
    assert spool[0] == _message(body, display)


def test_text_spill_decoder_never_uses_whole_file_read_bytes(tmp_path, monkeypatch):
    spool, _, _ = _small_spill(tmp_path)
    def forbidden(*args, **kwargs):
        raise AssertionError("Body decoding must remain interruptible.")
    monkeypatch.setattr(Path, "read_bytes", forbidden)
    assert spool[0] == _message("synthetic text\n" * 22000)


def test_text_spill_decoder_checks_budget_during_body_read_and_keeps_source(tmp_path, monkeypatch):
    spool, _, path = _small_spill(tmp_path)
    calls = []
    def fail_after_second_chunk():
        calls.append(True)
        if len(calls) == 2:
            raise UploadLimitError("IMPORT_WORKSPACE_EXCEEDED", "synthetic budget", status_code=422)
    monkeypatch.setattr(record_spool, "checkpoint", fail_after_second_chunk)
    with pytest.raises(UploadLimitError) as error:
        spool[0]
    assert error.value.code == "IMPORT_WORKSPACE_EXCEEDED"
    assert len(calls) == 2
    assert path.is_file() and spool.path.is_file()


@pytest.mark.parametrize("failure", ["missing", "truncated", "same-length-corruption"])
def test_text_spill_rejects_missing_and_corrupt_payloads(tmp_path, failure):
    spool, _, path = _small_spill(tmp_path)
    if failure == "missing":
        path.unlink()
    elif failure == "truncated":
        with path.open("r+b") as stream:
            stream.truncate(path.stat().st_size - 1)
    else:
        with path.open("r+b") as stream:
            stream.write(b"X")
    reopened = RecordSpool.open_verified(tmp_path, spool.descriptor())
    with pytest.raises(ValueError, match="integrity"):
        reopened[0]
    with pytest.raises(ValueError, match="integrity"):
        list(reopened)


@pytest.mark.parametrize("name", [
    "../outside.utf8", "nested/file.utf8", r"nested\file.utf8",
    r"C:\outside.utf8", "/outside.utf8", "file.utf8:stream", "", None,
])
def test_text_spill_rejects_nonlocal_paths_before_reading(tmp_path, name):
    spool, raw, _ = _small_spill(tmp_path)
    raw["message"]["plain_text"]["text_file"] = name
    with pytest.raises(ValueError, match="text path"):
        spool._decode(json.dumps(raw))


@pytest.mark.parametrize("field,value", [
    ("bytes", -1), ("bytes", True), ("bytes", "1"), ("sha256", None),
    ("sha256", ["a"] * 64), ("sha256", "g" * 64),
])
def test_text_spill_rejects_malformed_integrity_metadata(tmp_path, field, value):
    spool, raw, _ = _small_spill(tmp_path)
    raw["message"]["plain_text"][field] = value
    with pytest.raises(ValueError, match="text reference"):
        spool._decode(json.dumps(raw))


def test_text_spill_rejects_conflicting_shared_reference(tmp_path):
    spool, raw, _ = _small_spill(tmp_path)
    raw["message"]["display_text"]["bytes"] += 1
    with pytest.raises(ValueError, match="Conflicting"):
        spool._decode(json.dumps(raw))


def test_text_spill_rejects_path_reported_as_symlink(tmp_path, monkeypatch):
    # Unit-test the boundary on Windows without requiring symlink privileges.
    spool, _, path = _small_spill(tmp_path)
    original = Path.is_symlink
    monkeypatch.setattr(Path, "is_symlink", lambda item: item == path or original(item))
    with pytest.raises(ValueError, match="integrity"):
        spool[0]


def test_text_spill_rejects_resolution_outside_own_directory(tmp_path, monkeypatch):
    spool, _, path = _small_spill(tmp_path)
    original = Path.resolve
    outside = tmp_path.parent / "outside.utf8"
    monkeypatch.setattr(Path, "resolve", lambda item, *a, **k:
                        outside if item == path else original(item, *a, **k))
    with pytest.raises(ValueError, match="integrity"):
        spool[0]


def test_text_spill_checks_utf8_even_when_hash_is_valid(tmp_path):
    spool, raw, old = _small_spill(tmp_path)
    data = b"\xff"
    digest = hashlib.sha256(data).hexdigest()
    path = spool.path.with_name(spool.path.stem + "-text-" + digest + ".utf8")
    path.write_bytes(data)
    raw["message"]["plain_text"] = {"text_file": path.name, "bytes": 1, "sha256": digest}
    with pytest.raises(UnicodeDecodeError):
        spool._decode(json.dumps(raw))
    assert old.is_file()


@pytest.mark.parametrize("flag", [True, False, 2, "1", {}, []])
def test_unknown_text_storage_descriptor_is_rejected(tmp_path, flag):
    spool, _, _ = _small_spill(tmp_path)
    with pytest.raises(ValueError, match="Unknown"):
        RecordSpool.open_verified(tmp_path, {**spool.descriptor(), "text_sidecars": flag})


def test_metadata_limit_still_rejects_and_cleans_only_this_generation(tmp_path):
    previous = RecordSpool.write(tmp_path, [_message("kept\n" * 60000)], spill_text=True)
    before = set(tmp_path.iterdir())
    with pytest.raises(ValueError, match="too large"):
        RecordSpool.write(tmp_path, [{**_message("new\n" * 100000),
                                     "unbounded_metadata": "x" * MAX_RECORD_BYTES}], spill_text=True)
    assert set(tmp_path.iterdir()) == before
    assert previous[0] == _message("kept\n" * 60000)


SEPARATORS = ("\n", "\r", "\r\n", "\v", "\f", "\x1c", "\x1d", "\x1e",
              "\x85", "\u2028", "\u2029")


@pytest.mark.parametrize("separator", SEPARATORS)
@pytest.mark.parametrize("ending", ["", "text", "\n"])
def test_source_line_iterator_keeps_splitlines_semantics(separator, ending):
    text = separator + "first" + separator * 2 + "中文𠜎" + separator + ending
    assert list(block_builder._source_lines(text)) == text.splitlines(keepends=True)
    assert "".join(block_builder._source_lines(text)) == text


def test_source_line_iterator_empty_and_mixed_separators():
    assert list(block_builder._source_lines("")) == []
    randomizer = random.Random(411)
    text = "".join(randomizer.choice(("a", "中", "\x00", *SEPARATORS)) for _ in range(10000))
    assert list(block_builder._source_lines(text)) == text.splitlines(keepends=True)


@pytest.mark.parametrize("separator", SEPARATORS)
def test_streamed_lines_preserve_blocks_task_offsets_fences_and_source_ranges(monkeypatch, separator):
    text = separator.join([
        "> checking approach", "Reasoning: 9s", "", "# Title", "",
        "- [x] Same", "- [ ] Other", "", "```python title=example",
        "- [x] inside code", "## not a heading", "```", "",
        "![image](cr-asset://synthetic-file)", "", "- [ ] Same", "",
        "    [literal](cr-asset://synthetic-not-an-asset)", "", "last paragraph",
    ])
    actual_blocks = list(block_builder.iter_basic_render_blocks(text))
    actual_tasks = block_builder.extract_markdown_tasks(text)
    monkeypatch.setattr(block_builder, "_source_lines", lambda value: iter(value.splitlines(keepends=True)))
    assert actual_blocks == list(block_builder.iter_basic_render_blocks(text))
    assert actual_tasks == block_builder.extract_markdown_tasks(text)


def test_stream_block_checkpoint_count_survives_drained_output_queue(monkeypatch):
    calls = []
    checks = []
    monkeypatch.setattr(memory_budget, "current_budget", lambda: SimpleNamespace(stage="analysis"))
    monkeypatch.setattr(memory_budget, "checkpoint", lambda: calls.append(True))
    monkeypatch.setattr(memory_budget, "enforce_limit", lambda count, maximum: checks.append(count))
    assert sum(1 for _ in block_builder.iter_basic_render_blocks("paragraph\n\n" * 65000)) == 65000
    assert len(calls) == (65000 + 63) // 64 + (2 * 65000) // 256
    assert checks == list(range(1, 65001))


def test_small_nonstreaming_block_limit_remains_effective(monkeypatch):
    monkeypatch.setattr(memory_budget, "current_budget", lambda: SimpleNamespace(stage="analysis"))
    monkeypatch.setattr(memory_budget, "checkpoint", lambda: None)
    monkeypatch.setattr(memory_budget, "streaming_budget", lambda: False)
    # Every block is drained from the iterator queue, but the total still counts.
    with pytest.raises(UploadLimitError) as error:
        list(block_builder.iter_basic_render_blocks("paragraph\n\n" * (memory_budget.MAX_BLOCKS + 1)))
    assert getattr(error.value, "code", None) == "SMALL_IMPORT_BUDGET_EXCEEDED"


def test_long_fence_is_checked_before_any_completed_block(monkeypatch):
    calls = []
    monkeypatch.setattr(memory_budget, "current_budget", lambda: SimpleNamespace(stage="analysis"))
    monkeypatch.setattr(memory_budget, "checkpoint", lambda: calls.append(True))
    monkeypatch.setattr(memory_budget, "enforce_limit", lambda *args: None)
    iterator = block_builder.iter_basic_render_blocks("```\n" + "synthetic code\n" * 2048 + "```\n")
    block = next(iterator)
    assert block.block_type == "code"
    assert block.plain_text == "\n".join(["synthetic code"] * 2048)
    assert len(calls) == 8 + 1  # Eight line checkpoints, then the completed block.
    assert list(iterator) == []


def _indexed_package(body, *, declared_hash=None):
    # Exact Reader boundaries; a heading inside a body is not a new message.
    raw = body.encode()
    prefix = b"# Synthetic\n\n## Assistant\n\n"
    row = {"id": "synthetic-message", "parent": None, "source_path": [], "role": "assistant",
           "offset": len(prefix), "bytes": len(raw), "sha256": declared_hash or hashlib.sha256(raw).hexdigest(),
           "assets": [], "at": None}
    meta = {"version": "reader-chat-v1", "source_id": "synthetic-conversation", "title": "Synthetic",
            "lineage": "list", "messages": [], "assets": [], "partial": False}
    result = io.BytesIO()
    with zipfile.ZipFile(result, "w", zipfile.ZIP_STORED) as archive:
        archive.writestr("manifest.json", json.dumps(meta))
        archive.writestr("conversation.md", prefix + raw + b"\n\n")
        archive.writestr("reader/source.jsonl", json.dumps(row) + "\n")
    result.seek(0)
    return result


def test_reader_index_reads_long_body_in_chunks_with_exact_utf8_and_single_boundary(monkeypatch):
    from app.services.adaptive_import.reader_package import messages, package_header
    body = "a" * 65535 + "中文𠜎\r\n## User\nstill one assistant\n" + "continued text\n\n" * 180000
    assert len(body.encode()) > 2 * 1024**2
    reads = []
    original = zipfile.ZipExtFile.read
    def measured(source, size=-1):
        if source.name == "conversation.md":
            assert 0 <= size <= 64 * 1024
            reads.append(size)
        return original(source, size)
    monkeypatch.setattr(zipfile.ZipExtFile, "read", measured)
    with zipfile.ZipFile(_indexed_package(body)) as archive:
        rows = list(messages(archive, package_header(archive)))
    assert len(rows) == 1
    assert rows[0][0]["role"] == "assistant"
    assert rows[0][1] == body
    assert len(reads) > 2


def test_reader_index_rejects_corrupt_body_hash():
    from app.services.adaptive_import.contracts import AdaptiveImportError
    from app.services.adaptive_import.reader_package import messages, package_header
    with zipfile.ZipFile(_indexed_package("synthetic", declared_hash="0" * 64)) as archive:
        with pytest.raises(AdaptiveImportError) as error:
            list(messages(archive, package_header(archive)))
    assert error.value.code == "READER_PACKAGE_INVALID"


def test_reader_index_preserves_memory_failure_code_and_saved_source(monkeypatch):
    from app.services.adaptive_import.reader_package import messages, package_header
    content = _indexed_package("synthetic" * 20000)
    size = content.getbuffer().nbytes
    def exhausted():
        raise UploadLimitError("IMPORT_WORKSPACE_EXCEEDED", "synthetic workspace", status_code=422)
    monkeypatch.setattr(record_spool, "checkpoint", exhausted)
    with zipfile.ZipFile(content) as archive:
        with pytest.raises(UploadLimitError) as error:
            list(messages(archive, package_header(archive)))
    assert error.value.code == "IMPORT_WORKSPACE_EXCEEDED"
    assert content.getbuffer().nbytes == size
