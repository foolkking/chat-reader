from __future__ import annotations

import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier, BrokenBarrierError, Lock
from types import SimpleNamespace

import pytest

from app.core.config import get_settings
from app.services.assets import scanner as scanner_module
from app.services.assets.scanner import (
    AssetScanError,
    ClamAVScanner,
    DisabledScanner,
    RemoteScanner,
    configured_scanner_name,
    detect_mime_type,
)


@pytest.fixture(autouse=True)
def _reset_settings_cache() -> None:
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_disabled_scanner_reports_policy_status_without_claiming_clean(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("ALLOW_UNSCANNED_ATTACHMENTS", "true")
    get_settings.cache_clear()

    result = DisabledScanner().scan(tmp_path / "not-opened.bin")

    assert result.status == "scanner_disabled"
    assert result.provider == "disabled"
    assert result.allowed_by_policy is True
    assert result.detail == "scan_skipped_by_deployment_policy"


class _FakeClamConnection:
    def __init__(self, response: bytes) -> None:
        self.response = response
        self.sent = bytearray()
        self._read = False

    def __enter__(self) -> _FakeClamConnection:
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def sendall(self, data: bytes) -> None:
        self.sent.extend(data)

    def recv(self, size: int) -> bytes:
        del size
        if self._read:
            return b""
        self._read = True
        return self.response


@pytest.mark.parametrize(
    ("response", "expected_status", "expected_allowed"),
    [
        (b"stream: OK\0", "clean", True),
        (b"stream: Eicar-Test-Signature FOUND\0", "infected", False),
    ],
)
def test_clamav_scanner_parses_stream_result(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    response: bytes,
    expected_status: str,
    expected_allowed: bool,
) -> None:
    source = tmp_path / "sample.bin"
    source.write_bytes(b"sample-content")
    connection = _FakeClamConnection(response)
    monkeypatch.setattr(scanner_module.socket, "create_connection", lambda *args, **kwargs: connection)

    result = ClamAVScanner().scan(source)

    assert result.status == expected_status
    assert result.allowed_by_policy is expected_allowed
    assert bytes(connection.sent).startswith(b"zINSTREAM\0")
    assert bytes(connection.sent).endswith(b"\0\0\0\0")
    assert b"sample-content" in connection.sent


class _FakeRemoteResponse:
    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, str]:
        return {"status": "clean", "detail": "remote-node"}


def test_remote_scanner_uses_configured_endpoint_and_token(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    source = tmp_path / "sample.bin"
    source.write_bytes(b"remote-content")
    monkeypatch.setenv("REMOTE_SCANNER_URL", "https://scanner.invalid/v1/scan")
    monkeypatch.setenv("REMOTE_SCANNER_TOKEN", "test-token")
    get_settings.cache_clear()
    captured: dict[str, object] = {}

    def fake_post(url: str, **kwargs: object) -> _FakeRemoteResponse:
        captured["url"] = url
        captured.update(kwargs)
        return _FakeRemoteResponse()

    monkeypatch.setattr(scanner_module.httpx, "post", fake_post)

    result = RemoteScanner().scan(source)

    assert result.status == "clean"
    assert result.provider == "remote"
    assert result.allowed_by_policy is True
    assert result.detail == "remote-node"
    assert captured["url"] == "https://scanner.invalid/v1/scan"
    assert captured["headers"] == {"Authorization": "Bearer test-token"}


def test_invalid_scanner_provider_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ATTACHMENT_SCANNER", "unknown-provider")
    get_settings.cache_clear()

    with pytest.raises(AssetScanError, match="Unsupported attachment scanner provider"):
        configured_scanner_name()


def test_detect_mime_type_serializes_python_magic_first_use(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    sources = [tmp_path / "first.txt", tmp_path / "second.txt"]
    for source in sources:
        source.write_text("concurrent upload", encoding="utf-8")

    start = Barrier(3)
    overlap = Barrier(2, timeout=0.1)
    counter_lock = Lock()
    active = 0
    max_active = 0

    def from_file(path: str, *, mime: bool) -> str:
        nonlocal active, max_active
        del path, mime
        with counter_lock:
            active += 1
            max_active = max(max_active, active)
        try:
            try:
                overlap.wait()
            except BrokenBarrierError:
                pass
            if max_active > 1:
                raise NameError("MAGIC_NONE is not defined")
            return "text/plain"
        finally:
            with counter_lock:
                active -= 1

    monkeypatch.setitem(sys.modules, "magic", SimpleNamespace(from_file=from_file))

    def detect(source: Path) -> tuple[str, str | None]:
        start.wait()
        return detect_mime_type(source, source.name)

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(detect, source) for source in sources]
        start.wait()
        results = [future.result(timeout=2) for future in futures]

    assert results == [("text/plain", ".txt"), ("text/plain", ".txt")]
    assert max_active == 1
