from __future__ import annotations

import asyncio
import threading
import time
from contextlib import asynccontextmanager, contextmanager
from typing import AsyncIterator, Iterable, Iterator

from fastapi import UploadFile

from app.core.config import Settings, get_settings
from app.core.memory import available_memory_bytes


class UploadLimitError(ValueError):
    def __init__(self, code: str, message: str, *, status_code: int) -> None:
        super().__init__(message)
        self.code = code
        self.status_code = status_code


_analysis_slots: threading.BoundedSemaphore | None = None
_analysis_slot_count: int | None = None
_staging_slots: threading.BoundedSemaphore | None = None
_staging_slot_count: int | None = None
_queue_lock = threading.Lock()
_slot_lock = threading.Lock()
_queued_heavy_requests = 0
_MIB = 1024 * 1024


def configure_multipart_parser(settings: Settings | None = None) -> None:
    """Lower Starlette's per-file in-memory multipart spool threshold.

    Multipart parsing happens before FastAPI invokes an endpoint, so the
    endpoint-level analysis admission cannot protect against many small files
    that remain in memory as ``SpooledTemporaryFile`` instances. Starlette
    exposes this threshold as a process-wide parser setting; configure it once
    during application construction. Files above the threshold spill to the
    task's normal temporary directory instead of accumulating in API RSS.
    """
    from starlette.formparsers import MultiPartParser

    active_settings = settings or get_settings()
    MultiPartParser.spool_max_size = active_settings.multipart_spool_max_size_kb * 1024


def _semaphore() -> threading.BoundedSemaphore:
    global _analysis_slots, _analysis_slot_count
    configured = get_settings().upload_max_active_analysis
    # FastAPI sync routes may enter from several threads on the first request.
    # Publish a single gate, not a separate semaphore per racing initializer.
    with _slot_lock:
        if _analysis_slots is None or _analysis_slot_count != configured:
            _analysis_slots = threading.BoundedSemaphore(configured)
            _analysis_slot_count = configured
        return _analysis_slots


def _staging_semaphore() -> threading.BoundedSemaphore:
    """Return the independent slot used by attachment disk staging.

    Staging only copies an already-spooled upload to controlled storage. It
    must not wait behind the parser's memory-heavy analysis slot, otherwise a
    completed browser upload can sit until the reverse proxy times out.
    """
    global _staging_slots, _staging_slot_count
    configured = get_settings().upload_max_active_analysis
    with _slot_lock:
        if _staging_slots is None or _staging_slot_count != configured:
            _staging_slots = threading.BoundedSemaphore(configured)
            _staging_slot_count = configured
        return _staging_slots


def upload_size(upload: UploadFile) -> int:
    """Return the spooled upload size without materialising it in memory."""
    handle = upload.file
    current = handle.tell()
    handle.seek(0, 2)
    size = handle.tell()
    handle.seek(current)
    return size


@asynccontextmanager
async def bounded_upload_analysis(files: Iterable[UploadFile]) -> AsyncIterator[None]:
    """Serialize memory-heavy parsing while allowing small uploads through.

    The aggregate size is intentionally part of admission. A request made up
    of many individually-small files can consume more memory than one large
    file once analysis builds a batch plan.
    """
    async with bounded_analysis_admission(upload_size(upload) for upload in files):
        yield


@asynccontextmanager
async def bounded_analysis_admission(sizes: Iterable[int]) -> AsyncIterator[None]:
    """Admit an analysis using persisted upload sizes, without reading bodies."""
    settings = get_settings()
    size_values = [max(0, int(size)) for size in sizes]
    threshold = settings.upload_heavy_threshold_mb * 1024 * 1024
    is_heavy = max(size_values, default=0) > threshold or sum(size_values) > threshold
    if not is_heavy:
        yield
        return
    required_memory = _required_analysis_memory_bytes(size_values, settings)

    global _queued_heavy_requests
    with _queue_lock:
        if _queued_heavy_requests >= settings.upload_queue_max_size:
            raise UploadLimitError(
                "UPLOAD_QUEUE_FULL",
                "The server is processing other large uploads. Try again shortly.",
                status_code=429,
            )
        _queued_heavy_requests += 1
    semaphore = _semaphore()
    try:
        acquire_deadline = time.monotonic() + settings.upload_queue_wait_seconds
        while not semaphore.acquire(blocking=False):
            if time.monotonic() >= acquire_deadline:
                raise UploadLimitError(
                    "UPLOAD_QUEUE_TIMEOUT",
                    "The server is still processing another large upload. Try again shortly.",
                    status_code=429,
                )
            await asyncio.sleep(0.1)
        try:
            if not _memory_is_available(required_memory):
                raise _memory_pressure_error()
            yield
        finally:
            semaphore.release()
    finally:
        with _queue_lock:
            _queued_heavy_requests = max(0, _queued_heavy_requests - 1)


@contextmanager
def bounded_upload_analysis_sync(files: Iterable[UploadFile]) -> Iterator[None]:
    """Synchronous admission guard for FastAPI thread-pool upload routes."""
    with bounded_analysis_admission_sync(upload_size(upload) for upload in files):
        yield


@contextmanager
def bounded_analysis_admission_sync(
    sizes: Iterable[int], *, force_memory_check: bool = False,
) -> Iterator[None]:
    """Synchronous admission; persistent worker analysis also checks small batches."""
    settings = get_settings()
    size_values = [max(0, int(size)) for size in sizes]
    threshold = settings.upload_heavy_threshold_mb * 1024 * 1024
    is_heavy = max(size_values, default=0) > threshold or sum(size_values) > threshold
    if not is_heavy and not force_memory_check:
        yield
        return
    required_memory = _required_analysis_memory_bytes(size_values, settings)

    global _queued_heavy_requests
    with _queue_lock:
        if _queued_heavy_requests >= settings.upload_queue_max_size:
            raise UploadLimitError(
                "UPLOAD_QUEUE_FULL",
                "The server is processing other large uploads. Try again shortly.",
                status_code=429,
            )
        _queued_heavy_requests += 1
    semaphore = _semaphore()
    try:
        if not semaphore.acquire(timeout=settings.upload_queue_wait_seconds):
            raise UploadLimitError(
                "UPLOAD_QUEUE_TIMEOUT",
                "The server is still processing another large upload. Try again shortly.",
                status_code=429,
            )
        try:
            if not _memory_is_available(required_memory):
                raise _memory_pressure_error()
            yield
        finally:
            semaphore.release()
    finally:
        with _queue_lock:
            _queued_heavy_requests = max(0, _queued_heavy_requests - 1)


@contextmanager
def bounded_upload_staging_sync(files: Iterable[UploadFile]) -> Iterator[None]:
    """Serialize large disk staging without requiring analysis memory headroom.

    Starlette has already spooled multipart uploads before the route runs, and
    attachment staging copies that file to controlled storage in bounded
    chunks. Requiring the import parser's memory reserve here made a completed
    upload wait until the proxy timed out on small-memory deployments even
    though this path never materialises the attachment in memory.
    """
    settings = get_settings()
    threshold = settings.upload_heavy_threshold_mb * 1024 * 1024
    is_heavy = any(upload_size(upload) > threshold for upload in files)
    if not is_heavy:
        yield
        return

    global _queued_heavy_requests
    with _queue_lock:
        if _queued_heavy_requests >= settings.upload_queue_max_size:
            raise UploadLimitError(
                "UPLOAD_QUEUE_FULL",
                "The server is processing other large uploads. Try again shortly.",
                status_code=429,
            )
        _queued_heavy_requests += 1
    semaphore = _staging_semaphore()
    try:
        # Do not block the request thread while an import is being parsed.
        # A retryable response is safer than holding a worker until nginx's
        # request timeout, and the parser's slot is intentionally unrelated.
        if not semaphore.acquire(blocking=False):
            raise UploadLimitError(
                "UPLOAD_STAGING_BUSY",
                "The server is staging another large attachment. Try again shortly.",
                status_code=429,
            )
        try:
            yield
        finally:
            semaphore.release()
    finally:
        with _queue_lock:
            _queued_heavy_requests = max(0, _queued_heavy_requests - 1)


def _required_analysis_memory_bytes(sizes: Iterable[int], settings: Settings) -> int:
    """Estimate input working set plus fixed headroom for one heavy analysis."""
    reserve_bytes = settings.upload_memory_reserve_mb * _MIB
    input_bytes = sum(max(0, int(size)) for size in sizes)
    factor = max(1, settings.upload_analysis_memory_factor)
    return reserve_bytes + input_bytes * factor


def require_analysis_memory_headroom(input_bytes: int) -> None:
    """Recheck a growing decoded input without taking a second parser slot.

    Compressed inputs can expand after the outer upload/worker admission.
    This is only a headroom estimate, not a reservation or a replacement for
    the caller's existing concurrency gate.
    """
    required = _required_analysis_memory_bytes([input_bytes], get_settings())
    if not _memory_is_available(required):
        raise _memory_pressure_error()


def _memory_is_available(required_bytes: int) -> bool:
    available = available_memory_bytes()
    # Heavy parsing fails closed if this host/container cannot report
    # headroom; a missing metric must not silently disable admission.
    return available is not None and available >= required_bytes


def _memory_pressure_error() -> UploadLimitError:
    return UploadLimitError(
        "UPLOAD_MEMORY_PRESSURE",
        "There is not enough memory headroom to safely analyze this upload. Reduce the file size or split the batch, then retry.",
        status_code=429,
    )


async def read_upload_bounded(upload: UploadFile, max_bytes: int) -> bytes:
    """Read a spooled upload in bounded chunks with an explicit hard limit."""
    declared_size = upload_size(upload)
    if declared_size > max_bytes:
        raise UploadLimitError(
            "FILE_TOO_LARGE",
            f"{upload.filename or 'upload'} exceeds the configured per-file limit.",
            status_code=413,
        )
    await upload.seek(0)
    content = bytearray()
    while True:
        chunk = await upload.read(min(1024 * 1024, max_bytes + 1 - len(content)))
        if not chunk:
            return bytes(content)
        content.extend(chunk)
        if len(content) > max_bytes:
            raise UploadLimitError(
                "FILE_TOO_LARGE",
                f"{upload.filename or 'upload'} exceeds the configured per-file limit.",
                status_code=413,
            )


def read_upload_bounded_sync(upload: UploadFile, max_bytes: int) -> bytes:
    """Synchronous bounded reader for routes executed in FastAPI's thread pool."""
    declared_size = upload_size(upload)
    if declared_size > max_bytes:
        raise UploadLimitError(
            "FILE_TOO_LARGE",
            f"{upload.filename or 'upload'} exceeds the configured per-file limit.",
            status_code=413,
        )
    upload.file.seek(0)
    content = bytearray()
    while True:
        chunk = upload.file.read(min(1024 * 1024, max_bytes + 1 - len(content)))
        if not chunk:
            return bytes(content)
        content.extend(chunk)
        if len(content) > max_bytes:
            raise UploadLimitError(
                "FILE_TOO_LARGE",
                f"{upload.filename or 'upload'} exceeds the configured per-file limit.",
                status_code=413,
            )
