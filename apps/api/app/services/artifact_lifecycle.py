from __future__ import annotations

import hashlib
import logging
import os
import re
import uuid
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

logger = logging.getLogger(__name__)
_STAGING_NAME = re.compile(r"^\..+\.tmp\.[0-9a-f]{32}$")


class ArtifactLifecycleError(RuntimeError):
    """Raised before a database reference is allowed to become canonical."""


@dataclass(frozen=True)
class PublishedArtifact:
    path: Path
    sha256: str
    byte_size: int


def validate_final_artifact(
    path: Path,
    *,
    expected_sha256: str,
    expected_size: int,
    verify_hash: bool = False,
) -> bool:
    path = path.resolve()
    if not path.is_file() or path.stat().st_size != expected_size:
        return False
    if not verify_hash:
        return True
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest() == expected_sha256


def classify_artifact_files(
    db,
    *,
    roots: dict[str, Path],
) -> dict[str, dict[str, int]]:
    """Dry-run-only classifier for export/offline files; never deletes anything."""
    from app.models.export_artifact import ExportArtifact
    from app.models.offline_package_artifact import OfflinePackageArtifact

    referenced: dict[str, set[Path]] = {category: set() for category in roots}
    superseded: set[Path] = set()
    for row in db.query(ExportArtifact).all():
        referenced.setdefault("export", set()).add(Path(row.storage_uri).resolve())
    for row in db.query(OfflinePackageArtifact).all():
        referenced.setdefault("offline", set()).add(Path(row.storage_uri).resolve())
    from app.models.background_job import BackgroundJob
    offline_root = Path(roots.get("offline", Path("."))).resolve()
    for job in db.query(BackgroundJob).filter(BackgroundJob.job_type == "offline_package").all():
        filename = (job.result or {}).get("filename")
        if isinstance(filename, str) and filename:
            candidate = (offline_root / filename).resolve()
            if candidate not in referenced.get("offline", set()):
                superseded.add(candidate)
    result = {
        "SAFE_TEMP": {"candidate_count": 0, "candidate_bytes": 0},
        "ORPHAN_FINAL": {"candidate_count": 0, "candidate_bytes": 0},
        "SUPERSEDED_ARTIFACT": {"candidate_count": 0, "candidate_bytes": 0},
        "UNSAFE_PROTECTED": {"candidate_count": 0, "candidate_bytes": 0},
    }
    for category, root_value in roots.items():
        root = Path(root_value).resolve()
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            resolved = path.resolve()
            if not resolved.is_relative_to(root):
                bucket = "UNSAFE_PROTECTED"
            elif resolved in referenced.get(category, set()):
                bucket = "UNSAFE_PROTECTED"
            elif _STAGING_NAME.fullmatch(path.name):
                bucket = "SAFE_TEMP"
            elif resolved in superseded:
                bucket = "SUPERSEDED_ARTIFACT"
            elif category == "export" and (path.suffix in {".zip", ".cr"} or path.name.endswith(".context.zip")):
                bucket = "ORPHAN_FINAL"
            elif category == "offline" and path.suffix == ".crpkg":
                bucket = "ORPHAN_FINAL"
            else:
                bucket = "UNSAFE_PROTECTED"
            if bucket in {"ORPHAN_FINAL", "SUPERSEDED_ARTIFACT"}:
                logger.info(
                    "artifact_orphan_candidate category=%s candidate_type=%s byte_size=%s",
                    category,
                    bucket,
                    path.stat().st_size,
                )
            result[bucket]["candidate_count"] += 1
            result[bucket]["candidate_bytes"] += path.stat().st_size
    return result


def staging_path(final_path: Path) -> Path:
    """Create a server-owned staging name beside its immutable final path."""
    final_path.parent.mkdir(parents=True, exist_ok=True)
    return final_path.with_name(f".{final_path.name}.tmp.{uuid.uuid4().hex}")


def publish_zip_artifact(
    temporary: Path,
    final_path: Path,
    *,
    category: str,
    artifact_id: uuid.UUID,
    required_entries: Iterable[str] = (),
) -> PublishedArtifact:
    temporary = temporary.resolve()
    final_path = final_path.resolve()
    if temporary.parent != final_path.parent:
        raise ArtifactLifecycleError("Artifact staging and final paths must share a directory.")
    if not temporary.is_file():
        raise ArtifactLifecycleError("Artifact staging file is missing.")
    try:
        if os.stat(temporary.parent).st_dev != os.stat(final_path.parent).st_dev:
            raise ArtifactLifecycleError("Artifact staging and final paths must share a filesystem.")
    except OSError as exc:
        raise ArtifactLifecycleError("Artifact storage is unavailable.") from exc

    logger.info("artifact_staging category=%s artifact_id=%s", category, artifact_id)
    digest, byte_size = _validate_zip(temporary, required_entries)
    logger.info(
        "artifact_validated category=%s artifact_id=%s byte_size=%s",
        category,
        artifact_id,
        byte_size,
    )
    try:
        os.replace(temporary, final_path)
    except OSError as exc:
        raise ArtifactLifecycleError("Artifact publication failed.") from exc
    if not final_path.is_file() or final_path.stat().st_size != byte_size:
        raise ArtifactLifecycleError("Published artifact failed final size validation.")
    logger.info(
        "artifact_published category=%s artifact_id=%s byte_size=%s",
        category,
        artifact_id,
        byte_size,
    )
    return PublishedArtifact(path=final_path, sha256=digest, byte_size=byte_size)


def cleanup_committed_artifacts(
    paths: Iterable[Path],
    *,
    root: Path,
    category: str,
) -> int:
    """Best-effort post-commit cleanup. Failures are debt, never publication failure."""
    root = root.resolve()
    failures = 0
    for candidate in paths:
        path = candidate.resolve()
        if not path.is_relative_to(root):
            failures += 1
            logger.warning("artifact_cleanup_failed category=%s reason=outside_root", category)
            continue
        try:
            path.unlink(missing_ok=True)
        except OSError:
            failures += 1
            logger.warning("artifact_cleanup_failed category=%s reason=unlink_failed", category)
    return failures


def _validate_zip(path: Path, required_entries: Iterable[str]) -> tuple[str, int]:
    byte_size = path.stat().st_size
    if byte_size <= 0:
        raise ArtifactLifecycleError("Artifact is empty.")
    try:
        with zipfile.ZipFile(path) as archive:
            names = set(archive.namelist())
            # Opening the central directory proves the archive is readable without
            # decompressing a potentially multi-gigabyte attachment export.
            if not archive.infolist():
                raise ArtifactLifecycleError("Artifact archive contains no entries.")
    except (OSError, zipfile.BadZipFile) as exc:
        raise ArtifactLifecycleError("Artifact archive is unreadable.") from exc
    missing = set(required_entries) - names
    if missing:
        raise ArtifactLifecycleError("Artifact archive is missing required entries.")
    try:
        with zipfile.ZipFile(path) as archive:
            for entry in required_entries:
                with archive.open(entry) as source:
                    source.read(1)
    except (KeyError, OSError, zipfile.BadZipFile) as exc:
        raise ArtifactLifecycleError("Artifact archive required entry is unreadable.") from exc
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest(), byte_size
