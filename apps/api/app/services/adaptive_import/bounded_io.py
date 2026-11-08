"""Task-owned sequential IO. No source body or global cache is retained."""
from __future__ import annotations

import errno
import hashlib
import os
from pathlib import Path

from app.services.adaptive_import.contracts import AdaptiveImportError

CHUNK_BYTES = 64 * 1024
MESSAGE_BYTES = 1024 * 1024


def release_file_cache(handle, *, written: bool = False) -> None:
    """Best effort only; admission still observes the unadjusted cgroup usage."""
    if written:
        # A failed flush is a real persistence failure, not an advisory miss.
        handle.flush()
        os.fsync(handle.fileno())
    try:
        if hasattr(os, "posix_fadvise"):
            os.posix_fadvise(handle.fileno(), 0, 0, os.POSIX_FADV_DONTNEED)
    except (OSError, AttributeError, ValueError):
        pass


def checkpoint() -> None:
    from app.services.adaptive_import.memory_budget import checkpoint as check
    check()


def copy_stream(source, target, *, maximum: int) -> tuple[int, str]:
    digest = hashlib.sha256()
    size = 0
    try:
        while chunk := source.read(CHUNK_BYTES):
            size += len(chunk)
            if size > maximum:
                raise AdaptiveImportError("ZIP_MEMBER_TOO_LARGE", "A ZIP member exceeds its size limit.", layer="archive")
            target.write(chunk)
            digest.update(chunk)
            if size % (4 * MESSAGE_BYTES) < CHUNK_BYTES:
                release_file_cache(target, written=True)
                release_file_cache(source)
                checkpoint()
        release_file_cache(target, written=True)
        checkpoint()
    except OSError as exc:
        if exc.errno in {errno.ENOSPC, errno.EDQUOT}:
            raise AdaptiveImportError("IMPORT_STORAGE_FULL", "Import storage is full. Saved source files are retained.", layer="file") from exc
        raise
    return size, digest.hexdigest()


def file_hash(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as source:
        since_release = 0
        while chunk := source.read(CHUNK_BYTES):
            result.update(chunk)
            since_release += len(chunk)
            if since_release >= MESSAGE_BYTES:
                release_file_cache(source)
                checkpoint()
                since_release = 0
        release_file_cache(source)
        checkpoint()
    return result.hexdigest()


def text_lines(path: Path):
    """Universal newlines, strict UTF-8, and a bound even without any newline."""
    try:
        with path.open("r", encoding="utf-8-sig", newline=None) as source:
            since_release = 0
            while line := source.readline(MESSAGE_BYTES + 1):
                size = len(line.encode("utf-8"))
                if size > MESSAGE_BYTES:
                    raise unit_too_large()
                yield line
                since_release += size
                if since_release >= MESSAGE_BYTES:
                    release_file_cache(source)
                    checkpoint()
                    since_release = 0
            release_file_cache(source)
    except UnicodeDecodeError as exc:
        raise AdaptiveImportError("MARKDOWN_ENCODING_INVALID", "Markdown must be UTF-8.", layer="file") from exc


def unit_too_large():
    return AdaptiveImportError(
        "IMPORT_MESSAGE_TOO_LARGE",
        "One message exceeds the 1 MiB bounded-processing limit. Source files are retained; no message was truncated.",
        layer="normalization", action="inspect_source",
    )


def storage_error(exc):
    """Only translate capacity errors, never persist an OS path or errno text."""
    if isinstance(exc, OSError) and exc.errno in {errno.ENOSPC, errno.EDQUOT}:
        return AdaptiveImportError(
            "IMPORT_STORAGE_FULL", "Import storage is full. Saved source files are retained.",
            layer="file", action="retry",
        )
    return exc


def reraise_storage_failure(exc):
    """Storage exhaustion is not an invalid mapping or replace-source action."""
    converted = storage_error(exc)
    if getattr(converted, "code", None) == "IMPORT_STORAGE_FULL":
        if converted is exc:
            raise exc
        raise converted from exc


class CacheBoundedReader:
    """File-compatible scanner input; HTTP multipart still sees fileno/seek."""
    def __init__(self, source):
        self.source = source
        self.since_release = 0

    def __getattr__(self, name):
        return getattr(self.source, name)

    def read(self, size=-1):
        if size < 0:
            raise ValueError("Unbounded scanner reads are not supported.")
        raw = self.source.read(min(size, CHUNK_BYTES))
        self.since_release += len(raw)
        if self.since_release >= MESSAGE_BYTES or not raw:
            release_file_cache(self.source)
            checkpoint()
            self.since_release = 0
        return raw
