import re
import uuid
from dataclasses import dataclass
from pathlib import Path

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
