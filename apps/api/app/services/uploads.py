from __future__ import annotations

import asyncio
import ctypes
import sys
import threading
import time
from contextlib import asynccontextmanager, contextmanager
from typing import AsyncIterator, Iterable, Iterator

from fastapi import UploadFile

from app.core.config import get_settings


class UploadLimitError(ValueError):
    def __init__(self, code: str, message: str, *, status_code: int) -> None:
        super().__init__(message)
        self.code = code
        self.status_code = status_code


_analysis_slots: threading.BoundedSemaphore | None = None
_analysis_slot_count: int | None = None
_queue_lock = threading.Lock()
_queued_heavy_requests = 0


def available_memory_bytes() -> int | None:
    """Best-effort available-memory probe without an optional dependency."""
    if sys.platform.startswith("linux"):
        try:
            with open("/proc/meminfo", encoding="ascii") as handle:
                for line in handle:
                    if line.startswith("MemAvailable:"):
                        return int(line.split()[1]) * 1024
        except (OSError, ValueError, IndexError):
            return None
    if sys.platform == "win32":
        class MemoryStatus(ctypes.Structure):
            _fields_ = [
                ("length", ctypes.c_ulong),
                ("memory_load", ctypes.c_ulong),
                ("total_physical", ctypes.c_ulonglong),
                ("available_physical", ctypes.c_ulonglong),
                ("total_page_file", ctypes.c_ulonglong),
                ("available_page_file", ctypes.c_ulonglong),
                ("total_virtual", ctypes.c_ulonglong),
                ("available_virtual", ctypes.c_ulonglong),
                ("available_extended_virtual", ctypes.c_ulonglong),
            ]
        status = MemoryStatus()
        status.length = ctypes.sizeof(MemoryStatus)
        try:
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
                return int(status.available_physical)
        except (AttributeError, OSError):
            return None
    return None


def _semaphore() -> threading.BoundedSemaphore:
    global _analysis_slots, _analysis_slot_count
    configured = get_settings().upload_max_active_analysis
    if _analysis_slots is None or _analysis_slot_count != configured:
        _analysis_slots = threading.BoundedSemaphore(configured)
        _analysis_slot_count = configured
    return _analysis_slots


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
    """Serialize memory-heavy parsing while allowing small uploads through."""
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
            deadline = time.monotonic() + settings.upload_queue_wait_seconds
            while not _memory_is_available(settings.upload_memory_reserve_mb):
                if time.monotonic() >= deadline:
                    raise _memory_pressure_error()
                await asyncio.sleep(1)
            yield
        finally:
            semaphore.release()
    finally:
        with _queue_lock:
            _queued_heavy_requests = max(0, _queued_heavy_requests - 1)


@contextmanager
def bounded_upload_analysis_sync(files: Iterable[UploadFile]) -> Iterator[None]:
    """Synchronous admission guard for FastAPI thread-pool upload routes."""
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
    semaphore = _semaphore()
    try:
        if not semaphore.acquire(timeout=settings.upload_queue_wait_seconds):
            raise UploadLimitError(
                "UPLOAD_QUEUE_TIMEOUT",
                "The server is still processing another large upload. Try again shortly.",
                status_code=429,
            )
        try:
            deadline = time.monotonic() + settings.upload_queue_wait_seconds
            while not _memory_is_available(settings.upload_memory_reserve_mb):
                if time.monotonic() >= deadline:
                    raise _memory_pressure_error()
                time.sleep(1)
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
    semaphore = _semaphore()
    try:
        if not semaphore.acquire(timeout=settings.upload_queue_wait_seconds):
            raise UploadLimitError(
                "UPLOAD_QUEUE_TIMEOUT",
                "The server is still processing another large upload. Try again shortly.",
                status_code=429,
            )
        try:
            yield
        finally:
            semaphore.release()
    finally:
        with _queue_lock:
            _queued_heavy_requests = max(0, _queued_heavy_requests - 1)


def _memory_is_available(reserve_mb: int) -> bool:
    available = available_memory_bytes()
    return available is None or available >= reserve_mb * 1024 * 1024


def _memory_pressure_error() -> UploadLimitError:
    return UploadLimitError(
        "UPLOAD_MEMORY_PRESSURE",
        "The server is low on memory. The large upload was kept out of analysis; try again shortly.",
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
