import asyncio
from io import BytesIO

import pytest
from fastapi import UploadFile

from app.core.config import Settings
from app.services import uploads


def _upload(size: int) -> UploadFile:
    return UploadFile(filename="large.md", file=BytesIO(b"x" * size))


def _settings(**values: int) -> Settings:
    return Settings(
        _env_file=None,
        UPLOAD_HEAVY_THRESHOLD_MB=1,
        UPLOAD_MAX_ACTIVE_ANALYSIS=1,
        UPLOAD_QUEUE_MAX_SIZE=1,
        UPLOAD_MEMORY_RESERVE_MB=64,
        UPLOAD_QUEUE_WAIT_SECONDS=1,
        **values,
    )


def test_bounded_reader_accepts_exact_limit_and_rejects_one_extra_byte() -> None:
    async def exercise() -> None:
        assert await uploads.read_upload_bounded(_upload(1024), 1024) == b"x" * 1024
        with pytest.raises(uploads.UploadLimitError) as caught:
            await uploads.read_upload_bounded(_upload(1025), 1024)
        assert caught.value.code == "FILE_TOO_LARGE"
        assert caught.value.status_code == 413

    asyncio.run(exercise())


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


def test_heavy_upload_waits_for_memory_and_returns_retryable_pressure_error(
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
