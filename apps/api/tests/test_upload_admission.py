import asyncio
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
import threading
import time
from types import SimpleNamespace

import pytest
from fastapi import UploadFile

from app.core.config import Settings
from app.services import uploads


def _upload(size: int) -> UploadFile:
    return UploadFile(filename="large.md", file=BytesIO(b"x" * size))


def _settings(**values: int) -> Settings:
    settings = {
        "UPLOAD_HEAVY_THRESHOLD_MB": 1,
        "UPLOAD_MAX_ACTIVE_ANALYSIS": 1,
        "UPLOAD_QUEUE_MAX_SIZE": 1,
        "UPLOAD_MEMORY_RESERVE_MB": 64,
        "UPLOAD_QUEUE_WAIT_SECONDS": 1,
    }
    settings.update(values)
    return Settings(_env_file=None, **settings)


def test_multipart_parser_spool_threshold_is_configurable() -> None:
    from starlette.formparsers import MultiPartParser

    original = MultiPartParser.spool_max_size
    try:
        assert Settings(_env_file=None).multipart_spool_max_size_kb == 64
        uploads.configure_multipart_parser(_settings(MULTIPART_SPOOL_MAX_SIZE_KB=128))
        assert MultiPartParser.spool_max_size == 128 * 1024
    finally:
        MultiPartParser.spool_max_size = original


def test_multipart_file_above_threshold_spills_before_endpoint_runs() -> None:
    from starlette.datastructures import Headers
    from starlette.formparsers import MultiPartParser

    boundary = "chat-reader-test-boundary"
    payload = b"x" * (128 * 1024 + 1)
    body = (
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="files"; filename="one.json"\r\n'
        "Content-Type: application/json\r\n\r\n"
    ).encode() + payload + f"\r\n--{boundary}--\r\n".encode()

    async def stream():
        yield body

    original = MultiPartParser.spool_max_size
    try:
        uploads.configure_multipart_parser(_settings(MULTIPART_SPOOL_MAX_SIZE_KB=128))
        form = asyncio.run(
            MultiPartParser(
                Headers({"Content-Type": f"multipart/form-data; boundary={boundary}"}),
                stream(),
            ).parse()
        )
        uploaded = form["files"]
        assert uploaded.file._rolled is True
        uploaded.file.close()
    finally:
        MultiPartParser.spool_max_size = original


@pytest.mark.parametrize("kind", ["analysis", "staging"])
def test_concurrent_threadpool_entry_initializes_only_one_admission_slot(monkeypatch, kind):
    getter = uploads._semaphore if kind == "analysis" else uploads._staging_semaphore
    prefix = "_analysis" if kind == "analysis" else "_staging"
    monkeypatch.setattr(uploads, prefix + "_slots", None)
    monkeypatch.setattr(uploads, prefix + "_slot_count", None)
    monkeypatch.setattr(uploads, "get_settings", lambda: _settings())
    factory = threading.BoundedSemaphore
    created = []
    entered = threading.Barrier(8)

    def measured_factory(count):
        # Widen the first-use race; no real import or source data is involved.
        time.sleep(0.03)
        result = factory(count)
        created.append(result)
        return result

    monkeypatch.setattr(uploads, "threading", SimpleNamespace(BoundedSemaphore=measured_factory))

    def get_slot(_):
        entered.wait(timeout=5)
        return getter()

    with ThreadPoolExecutor(max_workers=8) as pool:
        slots = list(pool.map(get_slot, range(8)))
    assert len(created) == 1, "Concurrent requests constructed independent analysis gates."
    assert all(item is slots[0] for item in slots)


def test_bounded_reader_accepts_exact_limit_and_rejects_one_extra_byte() -> None:
    async def exercise() -> None:
        assert await uploads.read_upload_bounded(_upload(1024), 1024) == b"x" * 1024
        with pytest.raises(uploads.UploadLimitError) as caught:
            await uploads.read_upload_bounded(_upload(1025), 1024)
        assert caught.value.code == "FILE_TOO_LARGE"
        assert caught.value.status_code == 413

    asyncio.run(exercise())


def test_synchronous_bounded_reader_accepts_exact_limit_and_rejects_one_extra_byte() -> None:
    assert uploads.read_upload_bounded_sync(_upload(1024), 1024) == b"x" * 1024
    with pytest.raises(uploads.UploadLimitError) as caught:
        uploads.read_upload_bounded_sync(_upload(1025), 1024)
    assert caught.value.code == "FILE_TOO_LARGE"
    assert caught.value.status_code == 413


def test_heavy_upload_queue_rejects_capacity_without_starting_second_analysis(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(uploads, "get_settings", lambda: _settings())
    monkeypatch.setattr(uploads, "available_memory_bytes", lambda: 1024 * 1024 * 1024)
    uploads._analysis_slots = None
    uploads._analysis_slot_count = None
    uploads._queued_heavy_requests = 0

    async def exercise() -> None:
        entered = asyncio.Event()
        release = asyncio.Event()

        async def first() -> None:
            async with uploads.bounded_upload_analysis([_upload(2 * 1024 * 1024)]):
                entered.set()
                await release.wait()

        running = asyncio.create_task(first())
        await entered.wait()
        try:
            with pytest.raises(uploads.UploadLimitError) as caught:
                async with uploads.bounded_upload_analysis([_upload(2 * 1024 * 1024)]):
                    raise AssertionError("queue-full upload must not enter analysis")
            assert caught.value.code == "UPLOAD_QUEUE_FULL"
            assert caught.value.status_code == 429
        finally:
            release.set()
            await running

    asyncio.run(exercise())
    assert uploads._queued_heavy_requests == 0


def test_many_individually_small_files_share_the_heavy_analysis_gate(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(uploads, "get_settings", lambda: _settings())
    monkeypatch.setattr(uploads, "available_memory_bytes", lambda: 1024 * 1024 * 1024)
    uploads._analysis_slots = None
    uploads._analysis_slot_count = None
    uploads._queued_heavy_requests = 0

    async def exercise() -> None:
        entered = asyncio.Event()
        release = asyncio.Event()

        async def first() -> None:
            # Neither file is individually above the 1 MiB threshold, but the
            # request is heavy as a batch.
            async with uploads.bounded_analysis_admission([700 * 1024, 700 * 1024]):
                entered.set()
                await release.wait()

        running = asyncio.create_task(first())
        await entered.wait()
        try:
            with pytest.raises(uploads.UploadLimitError) as caught:
                async with uploads.bounded_analysis_admission([2 * 1024 * 1024]):
                    raise AssertionError("a second heavy request must not enter analysis")
            assert caught.value.code == "UPLOAD_QUEUE_FULL"
            assert caught.value.status_code == 429
        finally:
            release.set()
            await running

    asyncio.run(exercise())
    assert uploads._queued_heavy_requests == 0


def test_synchronous_many_small_files_share_the_heavy_analysis_gate(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(uploads, "get_settings", lambda: _settings())
    monkeypatch.setattr(uploads, "available_memory_bytes", lambda: 1024 * 1024 * 1024)
    uploads._analysis_slots = None
    uploads._analysis_slot_count = None
    uploads._queued_heavy_requests = 0

    with uploads.bounded_analysis_admission_sync([700 * 1024, 700 * 1024]):
        with pytest.raises(uploads.UploadLimitError) as caught:
            with uploads.bounded_analysis_admission_sync([2 * 1024 * 1024]):
                raise AssertionError("a second heavy request must not enter analysis")
        assert caught.value.code == "UPLOAD_QUEUE_FULL"
        assert caught.value.status_code == 429

    assert uploads._queued_heavy_requests == 0


def test_heavy_upload_rejects_when_memory_headroom_is_insufficient(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(uploads, "get_settings", lambda: _settings())
    monkeypatch.setattr(uploads, "available_memory_bytes", lambda: 1)
    uploads._analysis_slots = None
    uploads._analysis_slot_count = None
    uploads._queued_heavy_requests = 0

    async def exercise() -> None:
        with pytest.raises(uploads.UploadLimitError) as caught:
            async with uploads.bounded_upload_analysis([_upload(2 * 1024 * 1024)]):
                raise AssertionError("memory-pressure upload must not enter analysis")
        assert caught.value.code == "UPLOAD_MEMORY_PRESSURE"
        assert caught.value.status_code == 429

    asyncio.run(exercise())
    assert uploads._queued_heavy_requests == 0


def test_heavy_analysis_requires_input_scaled_headroom(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = _settings(
        UPLOAD_MEMORY_RESERVE_MB=64,
        UPLOAD_ANALYSIS_MEMORY_FACTOR=32,
        UPLOAD_QUEUE_WAIT_SECONDS=1,
    )
    monkeypatch.setattr(uploads, "get_settings", lambda: settings)
    monkeypatch.setattr(uploads, "available_memory_bytes", lambda: 128 * 1024 * 1024 - 1)
    uploads._analysis_slots = None
    uploads._analysis_slot_count = None
    uploads._queued_heavy_requests = 0

    clock = [0.0]

    def monotonic() -> float:
        current = clock[0]
        clock[0] += 1.0
        return current

    monkeypatch.setattr(uploads, "time", SimpleNamespace(monotonic=monotonic, sleep=lambda _: None))
    required = uploads._required_analysis_memory_bytes([2 * 1024 * 1024], settings)
    assert required == 128 * 1024 * 1024
    aggregate_required = uploads._required_analysis_memory_bytes(
        [700 * 1024, 700 * 1024], settings
    )
    assert aggregate_required == 64 * 1024 * 1024 + 1_400 * 1024 * 32
    with pytest.raises(uploads.UploadLimitError) as caught:
        with uploads.bounded_analysis_admission_sync([2 * 1024 * 1024]):
            raise AssertionError("analysis must wait for estimated working-set headroom")
    assert caught.value.code == "UPLOAD_MEMORY_PRESSURE"
    assert "split the batch" in str(caught.value)
    assert uploads._queued_heavy_requests == 0


def test_heavy_analysis_enters_at_exact_input_scaled_headroom(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = _settings(
        UPLOAD_MEMORY_RESERVE_MB=64,
        UPLOAD_ANALYSIS_MEMORY_FACTOR=32,
    )
    monkeypatch.setattr(uploads, "get_settings", lambda: settings)
    monkeypatch.setattr(uploads, "available_memory_bytes", lambda: 128 * 1024 * 1024)
    uploads._analysis_slots = None
    uploads._analysis_slot_count = None
    uploads._queued_heavy_requests = 0

    with uploads.bounded_analysis_admission_sync([2 * 1024 * 1024]):
        assert uploads._queued_heavy_requests == 1
    assert uploads._queued_heavy_requests == 0


def test_memory_admission_multiplier_defaults_to_synthetic_expansion_margin() -> None:
    assert Settings(_env_file=None).upload_analysis_memory_factor == 32


def test_heavy_analysis_fails_closed_when_memory_headroom_is_unknown(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(uploads, "get_settings", lambda: _settings())
    monkeypatch.setattr(uploads, "available_memory_bytes", lambda: None)
    uploads._analysis_slots = None
    uploads._analysis_slot_count = None
    uploads._queued_heavy_requests = 0

    with pytest.raises(uploads.UploadLimitError) as caught:
        with uploads.bounded_analysis_admission_sync([2 * 1024 * 1024]):
            raise AssertionError("heavy analysis must not bypass an unavailable memory probe")
    assert caught.value.code == "UPLOAD_MEMORY_PRESSURE"
    assert uploads._queued_heavy_requests == 0


def test_synchronous_attachment_staging_uses_the_shared_heavy_slot_without_memory_gate(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(uploads, "get_settings", lambda: _settings())
    monkeypatch.setattr(uploads, "available_memory_bytes", lambda: 1)
    uploads._analysis_slots = None
    uploads._analysis_slot_count = None
    uploads._staging_slots = None
    uploads._staging_slot_count = None
    uploads._queued_heavy_requests = 0

    with uploads.bounded_upload_staging_sync([_upload(2 * 1024 * 1024)]):
        assert uploads._queued_heavy_requests == 1

    assert uploads._queued_heavy_requests == 0


def test_attachment_staging_does_not_wait_for_parser_slot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(uploads, "get_settings", lambda: _settings())
    uploads._analysis_slots = None
    uploads._analysis_slot_count = None
    uploads._staging_slots = None
    uploads._staging_slot_count = None
    uploads._queued_heavy_requests = 0

    # Simulate the parser already holding its only memory-heavy slot.
    assert uploads._semaphore().acquire(blocking=False)
    try:
        with uploads.bounded_upload_staging_sync([_upload(2 * 1024 * 1024)]):
            pass
    finally:
        uploads._semaphore().release()


def test_attachment_staging_busy_is_immediately_retryable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(uploads, "get_settings", lambda: _settings())
    uploads._analysis_slots = None
    uploads._analysis_slot_count = None
    uploads._staging_slots = None
    uploads._staging_slot_count = None
    uploads._queued_heavy_requests = 0

    assert uploads._staging_semaphore().acquire(blocking=False)
    try:
        with pytest.raises(uploads.UploadLimitError) as caught:
            with uploads.bounded_upload_staging_sync([_upload(2 * 1024 * 1024)]):
                pass
        assert caught.value.code == "UPLOAD_STAGING_BUSY"
        assert caught.value.status_code == 429
    finally:
        uploads._staging_semaphore().release()
