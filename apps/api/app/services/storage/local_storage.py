import hashlib
import os
import re
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

from app.core.config import get_settings


@dataclass(frozen=True)
class StoredFile:
    safe_filename: str
    raw_storage_uri: str
    byte_size: int


def save_import_file(import_id: uuid.UUID, filename: str, content: bytes) -> StoredFile:
    settings = get_settings()
    storage_root = Path(settings.import_storage_dir)
    safe_filename = sanitize_filename(filename)
    import_dir = (storage_root / str(import_id)).resolve()
    storage_root_resolved = storage_root.resolve()

    if not import_dir.is_relative_to(storage_root_resolved):
        raise ValueError("Invalid import storage path.")

    import_dir.mkdir(parents=True, exist_ok=True)
    destination = _unique_destination(import_dir, safe_filename)
    destination.write_bytes(content)

    return StoredFile(
        safe_filename=destination.name,
        raw_storage_uri=f"storage/imports/{import_id}/{destination.name}",
        byte_size=len(content),
    )


def save_import_file_stream(
    import_id: uuid.UUID,
    filename: str,
    source: BinaryIO,
    *,
    max_bytes: int,
    chunk_size: int = 1024 * 1024,
) -> tuple[StoredFile, str]:
    """Persist an uploaded import without materializing the whole file."""
    settings = get_settings()
    storage_root = Path(settings.import_storage_dir)
    safe_filename = sanitize_filename(filename)
    import_dir = (storage_root / str(import_id)).resolve()
    storage_root_resolved = storage_root.resolve()
    if not import_dir.is_relative_to(storage_root_resolved):
        raise ValueError("Invalid import storage path.")

    import_dir.mkdir(parents=True, exist_ok=True)
    destination = _unique_destination(import_dir, safe_filename)
    temporary = import_dir / f".upload-{uuid.uuid4().hex}.part"
    digest = hashlib.sha256()
    byte_size = 0
    try:
        with temporary.open("xb") as target:
            while chunk := source.read(chunk_size):
                byte_size += len(chunk)
                if byte_size > max_bytes:
                    raise ValueError("Uploaded source exceeds the configured per-file limit.")
                digest.update(chunk)
                target.write(chunk)
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary, destination)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise

    return (
        StoredFile(
            safe_filename=destination.name,
            raw_storage_uri=f"storage/imports/{import_id}/{destination.name}",
            byte_size=byte_size,
        ),
        digest.hexdigest(),
    )


def sanitize_filename(filename: str) -> str:
    name = Path(filename).name
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("._")
    return name or "upload.bin"


def _unique_destination(directory: Path, safe_filename: str) -> Path:
    stem = Path(safe_filename).stem
    suffix = Path(safe_filename).suffix
    destination = directory / safe_filename
    counter = 1

    while destination.exists():
        destination = directory / f"{stem}_{counter}{suffix}"
        counter += 1

    if not destination.resolve().is_relative_to(directory.resolve()):
        raise ValueError("Invalid destination path.")

    return destination
