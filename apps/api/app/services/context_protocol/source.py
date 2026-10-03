from __future__ import annotations

import hashlib
import os
import shutil
import stat
import unicodedata
import zipfile
from contextlib import contextmanager
from pathlib import Path, PurePosixPath
from typing import BinaryIO, Iterator

MAX_BUFFERED_MEMBER_BYTES = 16 * 1024**2
MAX_JSONL_RECORD_BYTES = 8 * 1024**2

from .safety import is_safe_member_name, normalize_member_name


class PackageError(Exception):
    pass


class AmbiguousPackageRoot(PackageError):
    pass


class UnsafePackagePath(PackageError):
    pass


class PackageSource:
    """Read-only abstraction over a .zip package or extracted package directory."""

    def __init__(self, path: str | os.PathLike[str]):
        self.path = Path(path).resolve()
        self.kind: str
        self._zip: zipfile.ZipFile | None = None
        self._root_prefix = ""
        self._members: list[str] = []
        self._zip_names: dict[str, str] = {}
        self.unsafe_member_paths: list[str] = []

        if self.path.is_file() and zipfile.is_zipfile(self.path):
            self.kind = "zip"
            self._zip = zipfile.ZipFile(self.path, "r")
            try:
                infos = self._zip.infolist()
                if len(infos) > 100000 or sum(i.file_size for i in infos) > 2 * 1024**3:
                    raise PackageError("package resource limit exceeded")
                seen = set()
                for info in infos:
                    name = normalize_member_name(info.filename).rstrip("/")
                    path_key = unicodedata.normalize("NFC", name).casefold()
                    if not is_safe_member_name(name) or path_key in seen:
                        raise UnsafePackagePath("unsafe or duplicate package member")
                    seen.add(path_key)
                    self._zip_names[normalize_member_name(info.filename)] = info.filename
                    if info.flag_bits & 1 or stat.S_ISLNK(info.external_attr >> 16):
                        raise PackageError("encrypted or linked package member")
                    if info.file_size > 512 * 1024**2:
                        raise PackageError("package member resource limit exceeded")
            except Exception:
                self._zip.close()
                raise
            files = {unicodedata.normalize("NFC", normalize_member_name(i.filename)).casefold() for i in infos if not i.is_dir()}
            for name in seen:
                if any('/'.join(name.split('/')[:i]) in files for i in range(1, len(name.split('/')))):
                    self.close()
                    raise UnsafePackagePath("package file/directory collision")
            self._members = [normalize_member_name(i.filename) for i in self._zip.infolist() if not i.is_dir()]
            self.unsafe_member_paths = [n for n in self._members if not is_safe_member_name(n)]
            safe_members = [n for n in self._members if is_safe_member_name(n)]
            manifests = [n for n in safe_members if PurePosixPath(n).name == "manifest.json"]
            if len(manifests) != 1:
                self.close()
                if len(manifests) > 1:
                    raise AmbiguousPackageRoot(f"multiple manifest.json roots: {manifests[:10]}")
                raise PackageError("manifest.json not found")
            parent = str(PurePosixPath(manifests[0]).parent)
            self._root_prefix = "" if parent == "." else parent.rstrip("/") + "/"
            if any(not name.startswith(self._root_prefix) for name in self._members):
                self.close()
                raise AmbiguousPackageRoot("files outside package root")
        elif self.path.is_dir():
            self.kind = "directory"
            all_files: list[Path] = []
            seen = set()
            total_size = 0
            entry_count = 0
            for base, directories, files in os.walk(self.path, followlinks=False):
                for name in directories + files:
                    p = Path(base) / name
                    entry_count += 1
                    if entry_count > 100000:
                        raise PackageError("package resource limit exceeded")
                    info = p.lstat()
                    if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
                        raise UnsafePackagePath("linked package member")
                    rel = p.relative_to(self.path).as_posix()
                    path_key = unicodedata.normalize("NFC", rel).casefold()
                    if not is_safe_member_name(rel) or path_key in seen:
                        raise UnsafePackagePath("unsafe or duplicate package member")
                    seen.add(path_key)
                    if p.is_file():
                        if not stat.S_ISREG(info.st_mode):
                            raise PackageError("nonregular package member")
                        total_size += info.st_size
                        if info.st_size > 512 * 1024**2 or total_size > 2 * 1024**3:
                            raise PackageError("package resource limit exceeded")
                        all_files.append(p)
                    elif not p.is_dir():
                        raise PackageError("nonregular package member")
            manifests = [p for p in all_files if p.name == "manifest.json"]
            if len(manifests) != 1:
                if manifests:
                    raise AmbiguousPackageRoot("multiple manifest.json roots")
                raise PackageError("manifest.json not found")
            self._dir_root = manifests[0].parent
            if any(not p.is_relative_to(self._dir_root) for p in all_files):
                raise AmbiguousPackageRoot("files outside package root")
            self._members = [p.relative_to(self._dir_root).as_posix() for p in all_files]

        else:
            raise PackageError("input is neither a ZIP archive nor a directory")

    def close(self) -> None:
        if self._zip is not None:
            self._zip.close()

    def __enter__(self) -> "PackageSource":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()

    @property
    def package_root(self) -> str:
        if self.kind == "zip":
            return self._root_prefix.rstrip("/")
        return str(self._dir_root)

    def _zip_member(self, relpath: str) -> str:
        rel = normalize_member_name(relpath)
        if not is_safe_member_name(rel):
            raise UnsafePackagePath(relpath)
        return self._root_prefix + rel

    def _dir_member(self, relpath: str) -> Path:
        rel = normalize_member_name(relpath)
        if not is_safe_member_name(rel):
            raise UnsafePackagePath(relpath)
        p = (self._dir_root / rel).resolve()
        try:
            p.relative_to(self._dir_root)
        except ValueError as e:
            raise UnsafePackagePath(relpath) from e
        return p

    def exists(self, relpath: str) -> bool:
        if self.kind == "zip":
            return self._zip_member(relpath) in self._zip_names
        return self._dir_member(relpath).is_file()

    def list_members(self) -> list[str]:
        if self.kind == "zip":
            out = []
            for name in self._members:
                if self._root_prefix and not name.startswith(self._root_prefix):
                    continue
                out.append(name[len(self._root_prefix):])
            return sorted(out)
        return sorted(self._members)

    @contextmanager
    def open_binary(self, relpath: str) -> Iterator[BinaryIO]:
        if self.kind == "zip":
            member = self._zip_member(relpath)
            try:
                fh = self._zip.open(self._zip_names[member], "r")
            except KeyError as e:
                raise FileNotFoundError(relpath) from e
            try:
                yield fh
            finally:
                fh.close()
        else:
            p = self._dir_member(relpath)
            with p.open("rb") as fh:
                yield fh

    def read_bytes(self, relpath: str, max_bytes: int = MAX_BUFFERED_MEMBER_BYTES) -> bytes:
        if self.byte_size(relpath) > max_bytes:
            raise PackageError("buffered member resource limit exceeded")
        with self.open_binary(relpath) as fh:
            data = fh.read(max_bytes + 1)
        if len(data) > max_bytes:
            raise PackageError("buffered member resource limit exceeded")
        return data

    def iter_record_lines(self, relpath: str) -> Iterator[bytes]:
        with self.open_binary(relpath) as fh:
            while True:
                raw = fh.readline(MAX_JSONL_RECORD_BYTES + 1)
                if not raw:
                    return
                if len(raw) > MAX_JSONL_RECORD_BYTES:
                    raise PackageError("JSONL record resource limit exceeded")
                yield raw

    def read_text(self, relpath: str, encoding: str = "utf-8") -> str:
        return self.read_bytes(relpath).decode(encoding)

    def byte_size(self, relpath: str) -> int:
        if self.kind == "zip":
            info = self._zip.getinfo(self._zip_names[self._zip_member(relpath)])
            return int(info.file_size)
        return int(self._dir_member(relpath).stat().st_size)

    def sha256(self, relpath: str) -> str:
        h = hashlib.sha256()
        with self.open_binary(relpath) as fh:
            while True:
                chunk = fh.read(1024 * 1024)
                if not chunk:
                    break
                h.update(chunk)
        return h.hexdigest()

    def copy_member(self, relpath: str, destination: str | os.PathLike[str]) -> None:
        dest = Path(destination)
        dest.parent.mkdir(parents=True, exist_ok=True)
        with self.open_binary(relpath) as src, dest.open("wb") as dst:
            shutil.copyfileobj(src, dst, length=1024 * 1024)

    def zip_resource_summary(self) -> dict:
        if self.kind != "zip":
            sizes = [self.byte_size(m) for m in self.list_members()]
            return {
                "entry_count": len(sizes),
                "declared_uncompressed_bytes": sum(sizes),
                "largest_member_bytes": max(sizes, default=0),
                "max_compression_ratio": None,
            }
        infos = [i for i in self._zip.infolist() if not i.is_dir()]
        ratios = []
        for i in infos:
            if i.compress_size > 0:
                ratios.append(i.file_size / i.compress_size)
        return {
            "entry_count": len(infos),
            "declared_uncompressed_bytes": sum(i.file_size for i in infos),
            "largest_member_bytes": max((i.file_size for i in infos), default=0),
            "max_compression_ratio": max(ratios, default=0.0),
        }
