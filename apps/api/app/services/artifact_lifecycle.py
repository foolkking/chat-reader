from __future__ import annotations

import hashlib
import logging
import os
import re
import uuid
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable

from app.core.observability import structured_event

logger = logging.getLogger(__name__)
_STAGING_NAME = re.compile(r"^\.(?P<base>.+)\.tmp\.[0-9a-f]{32}$")
_OFFLINE_FINAL_NAME = re.compile(
    r"^offline-(?:all|project|conversation)-(?P<job_id>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.crpkg$"
)
_EXPORT_JOB_TYPES = {"system_archive_export", "conversation_export", "attachment_batch_download"}
_ELIGIBLE_CATEGORIES = {"SAFE_TEMP", "ORPHAN_FINAL", "SUPERSEDED_ARTIFACT"}
_MANAGED_ROOTS = {"export", "offline"}
_REFERENCE_QUERY_CHUNK_SIZE = 500


class ArtifactLifecycleError(RuntimeError):
    """Raised before a database reference is allowed to become canonical."""


@dataclass(frozen=True)
class PublishedArtifact:
    path: Path
    sha256: str
    byte_size: int


@dataclass(frozen=True)
class CleanupCandidate:
    storage_category: str
    candidate_type: str
    root: Path
    path: Path
    byte_size: int
    mtime_ns: int
    age_seconds: float
    token: str


@dataclass(frozen=True)
class CleanupScan:
    summary: dict[str, dict[str, int]]
    candidates: tuple[CleanupCandidate, ...]
    complete: bool = True


@dataclass(frozen=True)
class CleanupApplyResult:
    category: str
    requested_count: int
    deleted_count: int
    deleted_bytes: int
    already_absent_count: int
    skipped_changed_count: int
    failed_count: int

    def as_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "category": self.category,
            "requested_count": self.requested_count,
            "deleted_count": self.deleted_count,
            "deleted_bytes": self.deleted_bytes,
            "already_absent_count": self.already_absent_count,
            "skipped_changed_count": self.skipped_changed_count,
            "failed_count": self.failed_count,
        }
        result["failure_categories"] = {"unlink_failed": self.failed_count} if self.failed_count else {}
        return result


@dataclass(frozen=True)
class _ScannedArtifactFile:
    category: str
    root: Path
    path: Path
    relative: Path | None
    stat_size: int
    mtime_ns: int
    age_seconds: float
    job_id: uuid.UUID | None
    is_symlink: bool


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
    grace_seconds: int = 24 * 60 * 60,
    now: datetime | None = None,
) -> dict[str, dict[str, int]]:
    """Return aggregate cleanup classification; this function never deletes."""
    return scan_cleanup_candidates(db, roots=roots, grace_seconds=grace_seconds, now=now).summary


def scan_cleanup_candidates(
    db,
    *,
    roots: dict[str, Path],
    grace_seconds: int = 24 * 60 * 60,
    now: datetime | None = None,
    max_files: int | None = None,
) -> CleanupScan:
    """Classify managed export/offline files using canonical references and job state."""
    from app.models.export_artifact import ExportArtifact
    from app.models.offline_package_artifact import OfflinePackageArtifact
    from app.models.background_job import BackgroundJob

    # Scan the managed roots first. Database lookups are then scoped to the
    # paths/jobs that actually exist in this bounded filesystem snapshot. This
    # prevents diagnostics from loading every historical artifact/job row.
    result = {
        "SAFE_TEMP": {"candidate_count": 0, "candidate_bytes": 0},
        "ORPHAN_FINAL": {"candidate_count": 0, "candidate_bytes": 0},
        "SUPERSEDED_ARTIFACT": {"candidate_count": 0, "candidate_bytes": 0},
        "UNSAFE_PROTECTED": {"candidate_count": 0, "candidate_bytes": 0},
    }
    candidates: list[CleanupCandidate] = []
    complete = True
    now = now or datetime.now(timezone.utc)
    now_timestamp = now.timestamp()
    scanned: list[_ScannedArtifactFile] = []
    scanned_files = 0
    for category, root_value in roots.items():
        root = Path(root_value).resolve()
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            if max_files is not None and scanned_files >= max_files:
                complete = False
                break
            scanned_files += 1
            resolved = path.resolve()
            try:
                stat = path.stat()
            except OSError:
                continue
            age_seconds = max(0.0, now_timestamp - stat.st_mtime)
            relative = resolved.relative_to(root) if resolved.is_relative_to(root) else None
            job_id = _artifact_job_id(category, relative, path.name) if relative is not None else None
            scanned.append(
                _ScannedArtifactFile(
                    category=category,
                    root=root,
                    path=resolved,
                    relative=relative,
                    stat_size=stat.st_size,
                    mtime_ns=stat.st_mtime_ns,
                    age_seconds=age_seconds,
                    job_id=job_id,
                    is_symlink=path.is_symlink(),
                )
            )
        if not complete:
            break

    scanned_paths: dict[str, set[Path]] = {category: set() for category in roots}
    for item in scanned:
        scanned_paths.setdefault(item.category, set()).add(item.path)
    referenced = _referenced_paths_for_snapshot(db, scanned_paths, ExportArtifact, OfflinePackageArtifact)
    active_job_ids = _active_job_ids_for_snapshot(db, scanned, BackgroundJob)
    superseded = _superseded_paths_for_snapshot(db, scanned, referenced, BackgroundJob)

    for item in scanned:
        category = item.category
        root = item.root
        path = item.path
        relative = item.relative
        stat_size = item.stat_size
        active = item.job_id in active_job_ids.get(category, set()) if item.job_id is not None else bool(active_job_ids.get(category))
        if category not in _MANAGED_ROOTS or item.is_symlink or relative is None:
            bucket = "UNSAFE_PROTECTED"
        elif path in referenced.get(category, set()):
            bucket = "UNSAFE_PROTECTED"
        elif active or item.age_seconds < grace_seconds:
            bucket = "UNSAFE_PROTECTED"
        elif _STAGING_NAME.fullmatch(path.name) and _is_server_controlled_path(category, relative, path.name):
            bucket = "SAFE_TEMP"
        elif path in superseded:
            bucket = "SUPERSEDED_ARTIFACT"
        elif category == "export" and _is_server_controlled_path(category, relative, path.name) and (
            path.suffix in {".zip", ".cr"} or path.name.endswith(".context.zip")
        ):
            bucket = "ORPHAN_FINAL"
        elif category == "offline" and _is_server_controlled_path(category, relative, path.name) and path.suffix == ".crpkg":
            bucket = "ORPHAN_FINAL"
        else:
            bucket = "UNSAFE_PROTECTED"
        if bucket in _ELIGIBLE_CATEGORIES:
            token = _candidate_token(category, relative, bucket, stat_size, item.mtime_ns)
            candidates.append(
                CleanupCandidate(
                    storage_category=category,
                    candidate_type=bucket,
                    root=root,
                    path=path,
                    byte_size=stat_size,
                    mtime_ns=item.mtime_ns,
                    age_seconds=item.age_seconds,
                    token=token,
                )
            )
        result[bucket]["candidate_count"] += 1
        result[bucket]["candidate_bytes"] += stat_size
    return CleanupScan(summary=result, candidates=tuple(candidates), complete=complete)


def _chunks(values: Iterable[Any], size: int = _REFERENCE_QUERY_CHUNK_SIZE) -> Iterable[list[Any]]:
    chunk: list[Any] = []
    for value in values:
        chunk.append(value)
        if len(chunk) == size:
            yield chunk
            chunk = []
    if chunk:
        yield chunk


def _referenced_paths_for_snapshot(db, scanned_paths, export_model, offline_model) -> dict[str, set[Path]]:
    referenced: dict[str, set[Path]] = {category: set() for category in scanned_paths}
    for category, model in (("export", export_model), ("offline", offline_model)):
        values = [str(path) for path in scanned_paths.get(category, set())]
        for chunk in _chunks(values):
            for (storage_uri,) in db.query(model.storage_uri).filter(model.storage_uri.in_(chunk)).all():
                referenced.setdefault(category, set()).add(Path(storage_uri).resolve())
    return referenced


def _active_job_ids_for_snapshot(db, scanned: list[_ScannedArtifactFile], background_job_model) -> dict[str, set[uuid.UUID]]:
    active_job_ids: dict[str, set[uuid.UUID]] = {"export": set(), "offline": set()}
    job_ids = {item.job_id for item in scanned if item.job_id is not None}
    if not job_ids:
        return active_job_ids
    for chunk in _chunks(job_ids):
        rows = (
            db.query(background_job_model.id, background_job_model.job_type)
            .filter(
                background_job_model.id.in_(chunk),
                background_job_model.status.in_(("queued", "processing", "cancelling")),
            )
            .all()
        )
        for job_id, job_type in rows:
            if job_type in _EXPORT_JOB_TYPES:
                active_job_ids["export"].add(job_id)
            elif job_type == "offline_package":
                active_job_ids["offline"].add(job_id)
    return active_job_ids


def _superseded_paths_for_snapshot(db, scanned, referenced, background_job_model) -> set[Path]:
    offline_root = next((item.root for item in scanned if item.category == "offline"), None)
    if offline_root is None:
        return set()
    job_ids = {
        item.job_id
        for item in scanned
        if item.category == "offline" and item.job_id is not None
    }
    superseded: set[Path] = set()
    for chunk in _chunks(job_ids):
        rows = (
            db.query(background_job_model.id, background_job_model.result)
            .filter(
                background_job_model.id.in_(chunk),
                background_job_model.job_type == "offline_package",
                background_job_model.status == "committed",
            )
            .all()
        )
        for _, result in rows:
            filename = (result or {}).get("filename")
            if not isinstance(filename, str) or not filename:
                continue
            candidate = (offline_root / filename).resolve()
            if (
                candidate.is_relative_to(offline_root)
                and candidate.name == filename
                and candidate not in referenced.get("offline", set())
            ):
                superseded.add(candidate)
    return superseded


def execute_cleanup_candidates(
    db,
    *,
    roots: dict[str, Path],
    category: str,
    confirmed_tokens: Iterable[str],
    grace_seconds: int = 24 * 60 * 60,
    before_recheck: Callable[[], None] | None = None,
) -> CleanupApplyResult:
    """Delete only explicitly confirmed candidates after a fresh per-object recheck."""
    if category not in _ELIGIBLE_CATEGORIES:
        raise ArtifactLifecycleError("Cleanup apply requires one eligible category.")
    tokens = tuple(dict.fromkeys(confirmed_tokens))
    if not tokens:
        raise ArtifactLifecycleError("Cleanup apply requires at least one confirmed candidate token.")
    initial = scan_cleanup_candidates(db, roots=roots, grace_seconds=grace_seconds)
    initial_by_token = {
        item.token: item
        for item in initial.candidates
        if item.candidate_type == category and item.token in tokens
    }
    if before_recheck is not None:
        before_recheck()

    deleted_count = 0
    deleted_bytes = 0
    already_absent_count = 0
    skipped_changed_count = 0
    failed_count = 0
    for token in tokens:
        initial_candidate = initial_by_token.get(token)
        if initial_candidate is None:
            skipped_changed_count += 1
            continue
        db.expire_all()
        fresh = scan_cleanup_candidates(db, roots=roots, grace_seconds=grace_seconds)
        current = next(
            (
                item
                for item in fresh.candidates
                if item.token == token and item.candidate_type == category
            ),
            None,
        )
        if current is None:
            if not initial_candidate.path.exists():
                already_absent_count += 1
            else:
                skipped_changed_count += 1
            continue
        try:
            current.path.unlink()
        except FileNotFoundError:
            already_absent_count += 1
        except OSError:
            failed_count += 1
        else:
            deleted_count += 1
            deleted_bytes += current.byte_size

    outcome = CleanupApplyResult(
        category=category,
        requested_count=len(tokens),
        deleted_count=deleted_count,
        deleted_bytes=deleted_bytes,
        already_absent_count=already_absent_count,
        skipped_changed_count=skipped_changed_count,
        failed_count=failed_count,
    )
    structured_event(logger, logging.INFO if failed_count == 0 else logging.WARNING, "artifact_cleanup_apply", **outcome.as_dict())
    return outcome


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

    structured_event(logger, logging.INFO, "artifact_staging", category=category, artifact_id=str(artifact_id))
    digest, byte_size = _validate_zip(temporary, required_entries)
    structured_event(
        logger,
        logging.INFO,
        "artifact_validated",
        category=category,
        artifact_id=str(artifact_id),
        byte_size=byte_size,
    )
    try:
        os.replace(temporary, final_path)
    except OSError as exc:
        raise ArtifactLifecycleError("Artifact publication failed.") from exc
    if not final_path.is_file() or final_path.stat().st_size != byte_size:
        raise ArtifactLifecycleError("Published artifact failed final size validation.")
    structured_event(
        logger,
        logging.INFO,
        "artifact_published",
        category=category,
        artifact_id=str(artifact_id),
        byte_size=byte_size,
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
            structured_event(logger, logging.WARNING, "artifact_cleanup_failed", category=category, reason="outside_root")
            continue
        try:
            path.unlink(missing_ok=True)
        except OSError:
            failures += 1
            structured_event(logger, logging.WARNING, "artifact_cleanup_failed", category=category, reason="unlink_failed")
    return failures


def _is_server_controlled_path(category: str, relative: Path, filename: str) -> bool:
    if category == "export":
        if len(relative.parts) < 2:
            return False
        try:
            uuid.UUID(relative.parts[0])
        except (ValueError, AttributeError):
            return False
        return True
    if category == "offline":
        match = _STAGING_NAME.fullmatch(filename)
        final_name = match.group("base") if match else filename
        return _OFFLINE_FINAL_NAME.fullmatch(final_name) is not None
    return False


def _artifact_job_id(category: str, relative: Path | None, filename: str) -> uuid.UUID | None:
    if relative is None:
        return None
    if category == "export" and relative.parts:
        try:
            return uuid.UUID(relative.parts[0])
        except (ValueError, AttributeError):
            return None
    if category == "offline":
        staging_match = _STAGING_NAME.fullmatch(filename)
        final_name = staging_match.group("base") if staging_match else filename
        match = _OFFLINE_FINAL_NAME.fullmatch(final_name)
        if match is not None:
            return uuid.UUID(match.group("job_id"))
    return None


def _candidate_token(category: str, relative: Path, candidate_type: str, byte_size: int, mtime_ns: int) -> str:
    identity = "\0".join((category, relative.as_posix(), candidate_type, str(byte_size), str(mtime_ns)))
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()[:24]


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
