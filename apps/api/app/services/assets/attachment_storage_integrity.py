"""Read-only reconciliation between attachment metadata and local asset files."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
import hashlib
from pathlib import Path, PurePosixPath
import uuid

from sqlalchemy.orm import Session

from app.models.attachment import AssetObject, Attachment
from app.models.conversation import Conversation


_TECHNICAL_DIRECTORIES = frozenset({"quarantine", "temp", "s3-cache"})


@dataclass(frozen=True)
class AttachmentStorageIssue:
    code: str
    asset_object_id: uuid.UUID | None = None
    attachment_id: uuid.UUID | None = None
    storage_key: str | None = None
    expected_bytes: int | None = None
    actual_bytes: int | None = None


@dataclass(frozen=True)
class AttachmentStorageAudit:
    complete: bool
    scanned_asset_object_count: int
    scanned_active_attachment_count: int
    scanned_file_count: int
    sha256_verified_count: int
    issues: tuple[AttachmentStorageIssue, ...]

    @property
    def clean(self) -> bool:
        return self.complete and not self.issues

    @property
    def issue_counts(self) -> dict[str, int]:
        return dict(sorted(Counter(issue.code for issue in self.issues).items()))


def audit_local_attachment_storage(
    db: Session,
    asset_root: Path,
    *,
    max_records: int = 1_000_000,
    max_files: int = 1_000_000,
    verify_sha256: bool = False,
) -> AttachmentStorageAudit:
    """Compare current metadata with local storage without changing either side.

    Technical staging/cache directories are intentionally outside the orphan
    check. Their lifecycle is owned by the existing artifact cleanup workflow.
    """
    if max_records < 1 or max_files < 1:
        raise ValueError("Audit limits must be at least 1.")

    root = asset_root.resolve()
    issues: list[AttachmentStorageIssue] = []
    complete = True

    object_rows = (
        db.query(
            AssetObject.id,
            AssetObject.storage_backend,
            AssetObject.storage_key,
            AssetObject.byte_size,
            AssetObject.sha256,
            AssetObject.status,
            AssetObject.deleted_at,
        )
        .order_by(AssetObject.id)
        .limit(max_records + 1)
        .all()
    )
    objects_complete = len(object_rows) <= max_records
    if not objects_complete:
        complete = False
        object_rows = object_rows[:max_records]

    attachment_rows = (
        db.query(
            Attachment.id,
            Attachment.asset_object_id,
            AssetObject.id,
            AssetObject.status,
            AssetObject.storage_backend,
            AssetObject.deleted_at,
        )
        .join(Conversation, Conversation.id == Attachment.conversation_id)
        .outerjoin(AssetObject, AssetObject.id == Attachment.asset_object_id)
        .filter(
            Conversation.deleted_at.is_(None),
            Attachment.deleted_at.is_(None),
            Attachment.status == "available",
            Attachment.resolution_status == "resolved",
        )
        .order_by(Attachment.id)
        .limit(max_records + 1)
        .all()
    )
    if len(attachment_rows) > max_records:
        complete = False
        attachment_rows = attachment_rows[:max_records]

    for attachment_id, requested_asset_id, asset_id, status, backend, deleted_at in attachment_rows:
        if requested_asset_id is None or asset_id is None:
            issues.append(AttachmentStorageIssue(
                "ACTIVE_ATTACHMENT_WITHOUT_ASSET_OBJECT",
                asset_object_id=requested_asset_id,
                attachment_id=attachment_id,
            ))
        elif deleted_at is not None or status != "available":
            issues.append(AttachmentStorageIssue(
                "ACTIVE_ATTACHMENT_WITH_UNAVAILABLE_ASSET",
                asset_object_id=asset_id,
                attachment_id=attachment_id,
            ))
        elif backend != "local":
            issues.append(AttachmentStorageIssue(
                "ACTIVE_ATTACHMENT_BACKEND_MISMATCH",
                asset_object_id=asset_id,
                attachment_id=attachment_id,
            ))

    known_paths: set[Path] = set()
    sha256_verified_count = 0
    for asset_id, backend, storage_key, expected_size, expected_sha256, status, deleted_at in object_rows:
        if backend != "local":
            continue
        try:
            path = _resolve_storage_key(root, storage_key)
        except ValueError:
            issues.append(AttachmentStorageIssue(
                "INVALID_STORAGE_KEY",
                asset_object_id=asset_id,
                storage_key=storage_key,
            ))
            continue
        known_paths.add(path)
        if status != "available" or deleted_at is not None:
            continue
        if PurePosixPath(storage_key).parts[0] in _TECHNICAL_DIRECTORIES:
            issues.append(AttachmentStorageIssue(
                "AVAILABLE_ASSET_IN_TECHNICAL_STORAGE",
                asset_object_id=asset_id,
                storage_key=storage_key,
            ))
        if path.is_symlink():
            issues.append(AttachmentStorageIssue(
                "SYMLINK_ASSET_FILE",
                asset_object_id=asset_id,
                storage_key=storage_key,
            ))
            continue
        if not path.is_file():
            issues.append(AttachmentStorageIssue(
                "MISSING_ASSET_FILE",
                asset_object_id=asset_id,
                storage_key=storage_key,
                expected_bytes=expected_size,
            ))
            continue
        try:
            actual_size = path.stat().st_size
        except OSError:
            issues.append(AttachmentStorageIssue(
                "ASSET_FILE_READ_ERROR",
                asset_object_id=asset_id,
                storage_key=storage_key,
            ))
            continue
        if actual_size != expected_size:
            issues.append(AttachmentStorageIssue(
                "ASSET_SIZE_MISMATCH",
                asset_object_id=asset_id,
                storage_key=storage_key,
                expected_bytes=expected_size,
                actual_bytes=actual_size,
            ))
            continue
        if verify_sha256:
            try:
                actual_sha256 = _sha256(path)
            except OSError:
                issues.append(AttachmentStorageIssue(
                    "ASSET_FILE_READ_ERROR",
                    asset_object_id=asset_id,
                    storage_key=storage_key,
                ))
                continue
            sha256_verified_count += 1
            if actual_sha256 != expected_sha256:
                issues.append(AttachmentStorageIssue(
                    "ASSET_SHA256_MISMATCH",
                    asset_object_id=asset_id,
                    storage_key=storage_key,
                    expected_bytes=expected_size,
                    actual_bytes=actual_size,
                ))

    scanned_file_count = 0
    if not root.is_dir():
        issues.append(AttachmentStorageIssue("ASSET_ROOT_MISSING"))
    elif objects_complete:
        try:
            for candidate in root.rglob("*"):
                try:
                    relative = candidate.relative_to(root)
                except ValueError:
                    complete = False
                    continue
                if relative.parts and relative.parts[0] in _TECHNICAL_DIRECTORIES:
                    continue
                if not candidate.is_file() and not candidate.is_symlink():
                    continue
                scanned_file_count += 1
                if scanned_file_count > max_files:
                    complete = False
                    scanned_file_count = max_files
                    break
                storage_key = relative.as_posix()
                if candidate.is_symlink():
                    issues.append(AttachmentStorageIssue("UNSAFE_FILESYSTEM_ENTRY", storage_key=storage_key))
                    continue
                try:
                    resolved = candidate.resolve()
                except OSError:
                    issues.append(AttachmentStorageIssue("FILESYSTEM_ENTRY_CHANGED", storage_key=storage_key))
                    continue
                if not resolved.is_relative_to(root):
                    issues.append(AttachmentStorageIssue("UNSAFE_FILESYSTEM_ENTRY", storage_key=storage_key))
                elif resolved not in known_paths:
                    issues.append(AttachmentStorageIssue(
                        "ORPHAN_ASSET_FILE",
                        storage_key=storage_key,
                        actual_bytes=_safe_file_size(candidate),
                    ))
        except OSError:
            complete = False
            issues.append(AttachmentStorageIssue("FILESYSTEM_SCAN_ERROR"))

    return AttachmentStorageAudit(
        complete=complete,
        scanned_asset_object_count=len(object_rows),
        scanned_active_attachment_count=len(attachment_rows),
        scanned_file_count=scanned_file_count,
        sha256_verified_count=sha256_verified_count,
        issues=tuple(issues),
    )


def _resolve_storage_key(root: Path, storage_key: str) -> Path:
    if not storage_key or "\\" in storage_key or Path(storage_key).is_absolute():
        raise ValueError("Invalid asset storage key.")
    key = PurePosixPath(storage_key)
    if key.is_absolute() or any(part in {"", ".", ".."} for part in key.parts):
        raise ValueError("Invalid asset storage key.")
    path = (root / Path(*key.parts)).resolve()
    if not path.is_relative_to(root):
        raise ValueError("Invalid asset storage key.")
    return path


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _safe_file_size(path: Path) -> int | None:
    try:
        return path.stat().st_size
    except OSError:
        return None
