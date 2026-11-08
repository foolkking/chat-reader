"""Immutable, indexed JSONL sequences for internal import drafts, not exports."""
from __future__ import annotations

import hashlib
import json
import os
import struct
import uuid
from collections.abc import Sequence
from dataclasses import fields, is_dataclass
from pathlib import Path

from app.services.adaptive_import.bounded_io import checkpoint, file_hash, release_file_cache, storage_error

MAX_RECORD_BYTES = 16 * 1024 * 1024
_OFFSET = struct.Struct("<QQ")


def json_default(value):
    if is_dataclass(value):
        return {item.name: getattr(value, item.name) for item in fields(value)}
    raise TypeError(type(value).__name__)


class RecordSpool(Sequence):
    """Only offsets and lengths are read for indexing; never an in-memory index."""

    def __init__(self, path: Path, count: int, *, digest: str | None = None):
        self.path = path
        self.count = count
        self.digest = digest

    def __len__(self):
        return self.count

    def __iter__(self):
        with self.path.open("rb") as data:
            since_release = 0
            for _ in range(self.count):
                raw = data.readline(MAX_RECORD_BYTES + 1)
                if not raw.endswith(b"\n") or len(raw) > MAX_RECORD_BYTES:
                    raise ValueError("Invalid bounded draft record.")
                yield json.loads(raw)
                since_release += len(raw)
                if since_release >= 1024 * 1024:
                    release_file_cache(data)
                    since_release = 0
                checkpoint()
            if data.read(1):
                raise ValueError("Unexpected trailing draft records.")
            release_file_cache(data)

    def __getitem__(self, index):
        if isinstance(index, slice):
            return [self[i] for i in range(*index.indices(self.count))]
        if index < 0:
            index += self.count
        if not 0 <= index < self.count:
            raise IndexError(index)
        with self.path.with_suffix(".idx").open("rb") as offsets:
            offsets.seek(index * _OFFSET.size)
            raw = offsets.read(_OFFSET.size)
        if len(raw) != _OFFSET.size:
            raise ValueError("Invalid draft index.")
        start, size = _OFFSET.unpack(raw)
        if not 0 < size <= MAX_RECORD_BYTES:
            raise ValueError("Invalid draft record length.")
        with self.path.open("rb") as data:
            data.seek(start)
            raw = data.read(size)
            release_file_cache(data)
        if len(raw) != size or not raw.endswith(b"\n"):
            raise ValueError("Truncated draft record.")
        return json.loads(raw)

    def descriptor(self):
        return {"file": self.path.name, "count": self.count,
                "sha256": self.digest or file_hash(self.path),
                "index_sha256": file_hash(self.path.with_suffix(".idx"))}

    @classmethod
    def write(cls, directory: Path, records, *, prefix="records"):
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"{prefix}-{uuid.uuid4().hex}.jsonl"
        index_path = path.with_suffix(".idx")
        count = 0
        digest = hashlib.sha256()
        try:
            with path.open("xb") as data, index_path.open("xb") as offsets:
                for record in records:
                    checkpoint()
                    start = data.tell()
                    size = 0
                    encoder = json.JSONEncoder(ensure_ascii=False, separators=(",", ":"), default=json_default)
                    for part in encoder.iterencode(record):
                        encoded = part.encode("utf-8")
                        size += len(encoded)
                        if size + 1 > MAX_RECORD_BYTES:
                            raise ValueError("Bounded draft record is too large.")
                        data.write(encoded)
                        digest.update(encoded)
                    data.write(b"\n")
                    digest.update(b"\n")
                    offsets.write(_OFFSET.pack(start, size + 1))
                    count += 1
                    if count % 25 == 0:
                        release_file_cache(data, written=True)
                for handle in (data, offsets):
                    handle.flush()
                    os.fsync(handle.fileno())
                    release_file_cache(handle, written=True)
            return cls(path, count, digest=digest.hexdigest())
        except BaseException as exc:
            path.unlink(missing_ok=True)
            index_path.unlink(missing_ok=True)
            converted = storage_error(exc)
            if converted is not exc:
                raise converted from exc
            raise

    @classmethod
    def open_verified(cls, directory: Path, descriptor: dict):
        name = descriptor["file"]
        count = descriptor["count"]
        if (not isinstance(name, str) or Path(name).name != name
                or not name.endswith(".jsonl") or "\\" in name or ":" in name
                or type(count) is not int or count < 0):
            raise ValueError("Import draft integrity check failed.")
        # Inspect before resolving: resolve() alone hides even an in-directory
        # symlink, and the paired offset file must obey the same boundary.
        path = directory / name
        index_path = path.with_suffix(".idx")
        root = directory.resolve()
        if (path.is_symlink() or index_path.is_symlink()
                or path.resolve().parent != root or index_path.resolve().parent != root
                or not path.is_file() or not index_path.is_file()
                or index_path.stat().st_size != count * _OFFSET.size
                or file_hash(path) != descriptor["sha256"]
                or file_hash(index_path) != descriptor["index_sha256"]):
            raise ValueError("Import draft integrity check failed.")
        return cls(path, count, digest=descriptor["sha256"])


class MappedSequence(Sequence):
    def __init__(self, source, transform):
        self.source = source
        self.transform = transform

    def __len__(self):
        return len(self.source)

    def __iter__(self):
        for item in self.source:
            yield self.transform(item)

    def __getitem__(self, index):
        if isinstance(index, slice):
            return [self.transform(item) for item in self.source[index]]
        return self.transform(self.source[index])
