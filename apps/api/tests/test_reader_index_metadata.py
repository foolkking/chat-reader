"""Reader metadata is interruptible without reinstating body/message-count caps."""
import hashlib
import io
import json
import zipfile

import pytest

from app.core.config import get_settings
from app.core.memory import process_resident_memory_bytes
from app.services.adaptive_import import memory_budget
from app.services.adaptive_import.contracts import AdaptiveImportError
from app.services.adaptive_import.reader_package import index_rows, messages, package_header
from app.services.uploads import UploadLimitError


def row():
    return {"id": "synthetic-first", "parent": None, "source_path": ["synthetic-first"], "role": "user",
            "offset": 23, "bytes": 4, "sha256": hashlib.sha256(b"body").hexdigest(), "assets": [], "at": None}


class MeasuredStream(io.BytesIO):
    def read(self, size=-1):
        assert 0 <= size <= 64 * 1024, "metadata reads must not allocate a whole archive member"
        return super().read(size)

    def readline(self, *args):
        raise AssertionError("Do not allocate whole JSONL rows before checking memory.")


def test_index_stream_keeps_large_rows_and_unbounded_message_count():
    value = row()
    value["source_path"] = [f"node-{i}" for i in range(12000)]
    raw = json.dumps(value, ensure_ascii=False).encode() + b"\n"
    assert len(raw) > 64 * 1024
    assert list(index_rows(MeasuredStream(raw))) == [value]
    small = json.dumps(row()).encode() + b"\n"
    assert sum(1 for _ in index_rows(MeasuredStream(small * 50001))) == 50001


@pytest.mark.parametrize("prefix", [b"", b" \t", b"\xef\xbb\xbf"])
@pytest.mark.parametrize("suffix", [b"\n", b" \t\r\n"])
def test_index_stream_matches_json_whitespace_utf8_and_bom(prefix, suffix):
    value = row()
    raw = prefix + json.dumps(value).encode() + suffix
    assert list(index_rows(MeasuredStream(raw * 2))) == [value, value]


@pytest.mark.parametrize("raw", [
    b"{}\n\n", b"{}", b"{}\n ", b"[]\n", b'{"a":\n1}\n', b'{"a":NaN}\n',
    b'{"a":"\xff"}\n', b'{"a":"unterminated}\n', b'{"a":1}{}\n',
])
def test_invalid_index_is_not_normalized_into_a_valid_record(raw):
    with pytest.raises(AdaptiveImportError):
        list(index_rows(MeasuredStream(raw)))


def test_index_metadata_retains_archive_byte_budget(monkeypatch):
    monkeypatch.setenv("BUNDLE_MAX_OBJECT_BYTES", "8")
    get_settings.cache_clear()
    try:
        with pytest.raises(AdaptiveImportError):
            list(index_rows(MeasuredStream(json.dumps(row()).encode() + b"\n")))
    finally:
        get_settings.cache_clear()


def test_index_large_metadata_checkpoint_preserves_control_error(monkeypatch):
    from app.services.adaptive_import import manifest_stream
    calls = []

    def stopped():
        calls.append(True)
        if len(calls) == 2:
            raise UploadLimitError("IMPORT_WORKSPACE_EXCEEDED", "synthetic guard", status_code=422)
    monkeypatch.setattr(manifest_stream, "checkpoint", stopped)
    with pytest.raises(UploadLimitError) as caught:
        list(index_rows(MeasuredStream(b" " * (3 * 65536) + b"{}\n")))
    assert caught.value.code == "IMPORT_WORKSPACE_EXCEEDED"
    assert len(calls) == 2


def test_reader_index_never_allocates_large_whitespace_row_before_workspace_check(tmp_path, monkeypatch):
    from app.services import extension_import
    title, body = "Synthetic", b"body"
    prefix = b"# Synthetic\n\n## User\n\n"
    value = {**row(), "offset": len(prefix)}
    head = {"version": "reader-chat-v1", "source_id": "synthetic-review", "title": title, "lineage": "tree",
            "messages": [], "assets": [], "partial": False}
    path = tmp_path / "large-whitespace-index.zip"
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr("manifest.json", json.dumps(head))
        archive.writestr("conversation.md", prefix + body + b"\n\n")
        with archive.open("reader/source.jsonl", "w") as index:
            for _ in range(96 * 16):
                index.write(b" " * 65536)
            index.write(json.dumps(value).encode() + b"\n")
    read = zipfile.ZipExtFile.read

    def measured(source, size=-1):
        if source.name == "reader/source.jsonl":
            assert 0 <= size <= 65536
        return read(source, size)
    monkeypatch.setattr(zipfile.ZipExtFile, "read", measured)
    baseline = process_resident_memory_bytes()
    assert baseline is not None
    peak = [baseline]

    def measured_resident():
        resident = process_resident_memory_bytes()
        if resident is not None:
            peak[0] = max(peak[0], resident)
        return resident  # Observe the real probe; do not waive the guard.
    monkeypatch.setattr(memory_budget, "process_resident_memory_bytes", measured_resident)
    budget = memory_budget.SmallImportBudget(baseline, "metadata-audit", streaming=True)
    token = memory_budget._active.set(budget)
    try:
        with zipfile.ZipFile(path) as archive:
            rows = list(messages(archive, package_header(archive)))
        assert len(rows) == 1 and rows[0][1] == body.decode()
        assert extension_import.source_summary(path)[1] == 1
        budget.checkpoint()
        assert peak[0] - baseline <= memory_budget.WORKSPACE_BYTES
        print("synthetic_index_peak_workspace_bytes", peak[0] - baseline)
    finally:
        memory_budget._active.reset(token)
