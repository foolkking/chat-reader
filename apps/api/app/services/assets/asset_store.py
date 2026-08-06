import hashlib
import os
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

from app.core.config import get_settings


@dataclass(frozen=True)
class StagedAsset:
    path: Path
    sha256: str
    byte_size: int


class AssetStore(ABC):
    backend: str

    @abstractmethod
    def stage(self, source: BinaryIO, *, max_bytes: int, quarantine: bool = True) -> StagedAsset:
        raise NotImplementedError

    @abstractmethod
    def object_key(self) -> str:
        raise NotImplementedError

    @abstractmethod
    def promote(self, staged_path: Path, storage_key: str) -> Path:
        raise NotImplementedError

    @abstractmethod
    def delete_key(self, storage_key: str) -> None:
        raise NotImplementedError

    @abstractmethod
    def resolve_key(self, storage_key: str, *, must_exist: bool = True) -> Path:
        """Return a local, read-only materialization suitable for streaming."""
        raise NotImplementedError

    @abstractmethod
    def temporary_key(self, staged_path: Path) -> str:
        raise NotImplementedError

    @abstractmethod
    def resolve_temporary_key(self, storage_key: str) -> Path:
        raise NotImplementedError


class LocalAssetStore(AssetStore):
    backend = "local"
    def __init__(self, root: Path | None = None) -> None:
        self.root = (root or Path(get_settings().asset_storage_dir)).resolve()
        for name in ("objects", "derivatives", "quarantine", "temp"):
            (self.root / name).mkdir(parents=True, exist_ok=True)

    def stage(self, source: BinaryIO, *, max_bytes: int, quarantine: bool = True) -> StagedAsset:
        directory = self.root / ("quarantine" if quarantine else "temp")
        path = directory / f"{uuid.uuid4()}.part"
        digest = hashlib.sha256()
        byte_size = 0
        with path.open("xb") as destination:
            while True:
                chunk = source.read(1024 * 1024)
                if not chunk:
                    break
                byte_size += len(chunk)
                if byte_size > max_bytes:
                    destination.close()
                    path.unlink(missing_ok=True)
                    raise ValueError("Asset exceeds the configured size limit.")
                digest.update(chunk)
                destination.write(chunk)
            destination.flush()
            os.fsync(destination.fileno())
        os.chmod(path, 0o600)
        return StagedAsset(path=path, sha256=digest.hexdigest(), byte_size=byte_size)

    def object_key(self) -> str:
        object_id = uuid.uuid4().hex
        return f"objects/{object_id[:2]}/{object_id}"

    def promote(self, staged_path: Path, storage_key: str) -> Path:
        source = self._resolve_staging(staged_path)
        destination = self.resolve_key(storage_key, must_exist=False)
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists():
            raise ValueError("Asset storage key already exists.")
        source.replace(destination)
        os.chmod(destination, 0o600)
        return destination

    def resolve_key(self, storage_key: str, *, must_exist: bool = True) -> Path:
        if not storage_key or "\\" in storage_key or storage_key.startswith("/"):
            raise ValueError("Invalid asset storage key.")
        path = (self.root / storage_key).resolve()
        if not path.is_relative_to(self.root):
            raise ValueError("Invalid asset storage path.")
        if must_exist and not path.is_file():
            raise FileNotFoundError("Asset object is missing.")
        return path

    def temporary_key(self, staged_path: Path) -> str:
        return self._resolve_staging(staged_path).relative_to(self.root).as_posix()

    def resolve_temporary_key(self, storage_key: str) -> Path:
        path = self.resolve_key(storage_key)
        if not (path.is_relative_to(self.root / "quarantine") or path.is_relative_to(self.root / "temp")):
            raise ValueError("Invalid temporary asset key.")
        return path

    def delete_key(self, storage_key: str) -> None:
        self.resolve_key(storage_key, must_exist=False).unlink(missing_ok=True)

    def _resolve_staging(self, path: Path) -> Path:
        resolved = path.resolve()
        if not (resolved.is_relative_to(self.root / "quarantine") or resolved.is_relative_to(self.root / "temp")):
            raise ValueError("Invalid staged asset path.")
        if not resolved.is_file():
            raise FileNotFoundError("Staged asset is missing.")
        return resolved


class S3CompatibleAssetStore(AssetStore):
    """S3 adapter used by larger deployments.

    Staging remains local so hashing, MIME detection and scanning happen before
    an object is published. Runtime use requires the optional boto3 package.
    """

    backend = "s3"

    def __init__(
        self,
        *,
        bucket: str,
        endpoint_url: str | None = None,
        region_name: str | None = None,
        prefix: str = "attachments",
    ) -> None:
        try:
            import boto3  # type: ignore[import-not-found]
        except ImportError as exc:
            raise RuntimeError("S3 storage requires the optional boto3 package.") from exc
        self.bucket = bucket
        self.prefix = prefix.strip("/")
        self.client = boto3.client("s3", endpoint_url=endpoint_url, region_name=region_name)
        self.staging = LocalAssetStore()
        self.cache_root = self.staging.root / "s3-cache"
        self.cache_root.mkdir(parents=True, exist_ok=True)

    def stage(self, source: BinaryIO, *, max_bytes: int, quarantine: bool = True) -> StagedAsset:
        return self.staging.stage(source, max_bytes=max_bytes, quarantine=quarantine)

    def object_key(self) -> str:
        object_id = uuid.uuid4().hex
        suffix = f"objects/{object_id[:2]}/{object_id}"
        return f"{self.prefix}/{suffix}" if self.prefix else suffix

    def promote(self, staged_path: Path, storage_key: str) -> Path:
        source = self.staging._resolve_staging(staged_path)
        self.client.upload_file(str(source), self.bucket, storage_key)
        source.unlink(missing_ok=True)
        return Path(storage_key)

    def delete_key(self, storage_key: str) -> None:
        if storage_key.startswith("quarantine/") or storage_key.startswith("temp/"):
            self.staging.delete_key(storage_key)
            return
        self.client.delete_object(Bucket=self.bucket, Key=storage_key)
        self._cache_path(storage_key).unlink(missing_ok=True)

    def resolve_key(self, storage_key: str, *, must_exist: bool = True) -> Path:
        if not storage_key or "\\" in storage_key or storage_key.startswith("/") or ".." in storage_key.split("/"):
            raise ValueError("Invalid asset storage key.")
        cached = self._cache_path(storage_key)
        if cached.is_file():
            return cached
        cached.parent.mkdir(parents=True, exist_ok=True)
        temporary = cached.with_suffix(f".{uuid.uuid4().hex}.part")
        try:
            self.client.download_file(self.bucket, storage_key, str(temporary))
        except Exception as exc:
            temporary.unlink(missing_ok=True)
            if must_exist:
                raise FileNotFoundError("Asset object is missing.") from exc
            return cached
        os.chmod(temporary, 0o600)
        temporary.replace(cached)
        return cached

    def temporary_key(self, staged_path: Path) -> str:
        return self.staging.temporary_key(staged_path)

    def resolve_temporary_key(self, storage_key: str) -> Path:
        return self.staging.resolve_temporary_key(storage_key)

    def _cache_path(self, storage_key: str) -> Path:
        digest = hashlib.sha256(storage_key.encode("utf-8")).hexdigest()
        return self.cache_root / digest[:2] / digest


def get_asset_store() -> AssetStore:
    settings = get_settings()
    backend = settings.asset_storage_backend.strip().lower()
    if backend == "local":
        return LocalAssetStore()
    if backend == "s3":
        if not settings.asset_s3_bucket:
            raise RuntimeError("ASSET_S3_BUCKET is required when ASSET_STORAGE_BACKEND=s3.")
        return S3CompatibleAssetStore(
            bucket=settings.asset_s3_bucket,
            endpoint_url=settings.asset_s3_endpoint_url,
            region_name=settings.asset_s3_region,
            prefix=settings.asset_s3_prefix,
        )
    raise RuntimeError(f"Unsupported asset storage backend: {settings.asset_storage_backend}")
