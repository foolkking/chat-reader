"""Bounded parser policies, never a general materialization-memory bypass.

Source JSON/mixed parsers keep their existing admission. ZIPs, standalone
Markdown and separately qualified canonical draft units use effective capacity,
live headroom and a checked 64 MiB workspace delta. A whole v1 JSONL reader
never inherits this budget merely because its source was small.
"""
from __future__ import annotations

import hashlib
import json
import struct
import threading
import uuid
import zipfile
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

from app.core.config import get_settings
from app.core.memory import effective_total_memory_bytes, process_resident_memory_bytes
from app.services import uploads

MIB = 1024 * 1024
RESERVE_BYTES = 128 * MIB
WORKSPACE_BYTES = 64 * MIB
MAX_ARCHIVE_BYTES = 32 * MIB
MAX_DIRECTORY_BYTES = 256 * 1024
MAX_TEXT_BYTES = 256 * 1024
MAX_DRAFT_BYTES = MIB
MAX_ENTRIES = 256
MAX_ATTACHMENTS = 128
MAX_ATTACHMENT_BYTES = 16 * MIB
MAX_MESSAGES = 256
MAX_BLOCKS = 2048
MAX_REFERENCES = 1024
_local_lane = threading.Lock()
_active: ContextVar[SmallImportBudget | None] = ContextVar("small_import_budget", default=None)
_sequential_record: ContextVar[str | None] = ContextVar("sequential_analysis_record", default=None)


@dataclass
class SmallImportBudget:
    baseline_rss: int
    stage: str
    streaming: bool = False
    reserve_bytes: int = RESERVE_BYTES
    scratch_directory: Path | None = None

    def checkpoint(self) -> None:
        available = uploads.available_memory_bytes()
        resident = process_resident_memory_bytes()
        if available is None or resident is None or available < self.reserve_bytes:
            error = uploads._memory_pressure_error()
            error.stage = self.stage
            raise error
        if resident - self.baseline_rss > WORKSPACE_BYTES:
            if self.streaming:
                error = uploads.UploadLimitError(
                    "IMPORT_WORKSPACE_EXCEEDED",
                    "The bounded import exceeded its workspace budget. Saved sources are retained.",
                    status_code=422,
                )
                error.stage = self.stage
                raise error
            raise limit_error()


def current_budget() -> SmallImportBudget | None:
    return _active.get()


_control_checkpoint: ContextVar = ContextVar("adaptive_import_control_checkpoint", default=None)
_unit_progress: ContextVar = ContextVar("adaptive_import_unit_progress", default=None)


@contextmanager
def unit_progress_reporting(callback):
    token = _unit_progress.set(callback)
    try:
        yield
    finally:
        _unit_progress.reset(token)


@contextmanager
def processing_unit(stage, index, total):
    callback = _unit_progress.get()
    checkpoint()
    if callback:
        callback(stage, index, total, False)
    yield
    checkpoint()
    if callback:
        callback(stage, index, total, True)


@contextmanager
def control_checkpoints(callback):
    """Observe worker control at the existing bounded IO/parser checkpoints."""
    token = _control_checkpoint.set(callback)
    try:
        callback()
        yield
        callback()
    finally:
        _control_checkpoint.reset(token)


def checkpoint() -> None:
    from app.services.execution_control import execution_checkpoint
    execution_checkpoint()
    control = _control_checkpoint.get()
    if control is not None:
        control()
    budget = current_budget()
    if budget is not None:
        budget.checkpoint()


def limit_error() -> uploads.UploadLimitError:
    error = uploads.UploadLimitError(
        "SMALL_IMPORT_BUDGET_EXCEEDED",
        "This import exceeds the bounded small-ZIP budget. Source files are retained. "
        "Retry with more memory available or use a smaller archive.",
        status_code=429,
    )
    if current_budget() is not None:
        error.stage = current_budget().stage
    return error


def enforce_limit(value: int, maximum: int) -> None:
    if current_budget() is not None and not streaming_budget() and value > maximum:
        raise limit_error()


def streaming_budget() -> bool:
    budget = current_budget()
    return budget is not None and budget.streaming


def bounded_zip_session(record) -> bool:
    if not get_settings().import_bounded_zip_enabled:
        return False
    originals = [item for item in record.artifacts if item.source_type != "adaptive_archive_document"]
    return bool(originals) and all(item.source_type == "adaptive_archive" for item in originals)


def bounded_markdown_session(record) -> bool:
    """Only standalone Markdown uses the existing message-level text parser.

    JSON and mixed mappings still need their original materialization guard.
    This selects a parser, not permission to trust filenames as valid content.
    """
    originals = list(record.artifacts)
    return bool(originals) and all(
        item.source_type == "adaptive_source"
        and (getattr(item, "file_extension", None) or "").casefold() in {".md", ".markdown"}
        for item in originals
    )


def prefer_bounded_markdown(record) -> bool:
    if not bounded_markdown_session(record):
        return False
    available = uploads.available_memory_bytes()
    required = uploads._required_analysis_memory_bytes(
        [max((int(item.byte_size or 0) for item in record.artifacts), default=0)], get_settings(),
    )
    return available is not None and available < required


@contextmanager
def bounded_unit_admission(db, record, *, stage):
    """For callers that actually enforce bounded message records and disk IO.

    Reuse the ZIP lane's live 64-MiB delta, capacity-based reserve and database
    serialization. Never apply this context around a materializing parser.
    """
    if current_budget() is not None:
        checkpoint()
        yield
        return
    reserve = adaptive_reserve_bytes()
    baseline = process_resident_memory_bytes()
    if baseline is None:
        raise uploads._memory_pressure_error()
    with uploads.bounded_analysis_admission_sync(
        [0], force_memory_check=True, db=db, wait_for_slot=False,
        required_memory_bytes=reserve + WORKSPACE_BYTES,
    ):
        token = _active.set(SmallImportBudget(
            baseline, stage, streaming=True, reserve_bytes=reserve,
            scratch_directory=Path(get_settings().import_storage_dir).resolve() / str(record.id),
        ))
        try:
            checkpoint()
            yield
            checkpoint()
        finally:
            _active.reset(token)


@contextmanager
def sequential_analysis_admission(db, record, *, archive_changes=None):
    """Hold one parser lane; admit only bytes of the unit actually being read.

    Bounded ZIPs retain their session-wide live workspace budget. Materializing
    JSON/mixed imports retain the normal reserve and factor, but do not charge
    independent, unopened sources as though they were all resident together.
    """
    if prefer_bounded_markdown(record):
        with bounded_unit_admission(db, record, stage="analysis"):
            yield
        return
    originals = [item for item in record.artifacts if item.source_type != "adaptive_archive_document"]
    if bounded_zip_session(record) or (
        len(originals) == 1 and originals[0].source_type == "adaptive_archive"
    ):
        with import_analysis_admission(
            db, record, stage="analysis", force_memory_check=True, archive_changes=archive_changes,
        ):
            yield
        return
    with uploads.bounded_analysis_admission_sync([0], force_memory_check=True, wait_for_slot=False, db=db):
        token = _sequential_record.set(str(record.id))
        try:
            checkpoint()
            yield
            checkpoint()
        finally:
            _sequential_record.reset(token)


@contextmanager
def analysis_unit(record, artifacts):
    """Call before reading a unit, and keep its objects inside this scope."""
    checkpoint()
    if _sequential_record.get() is not None and _sequential_record.get() == str(record.id):
        uploads.require_analysis_memory_headroom(sum(
            max(0, int(item.byte_size or 0)) for item in artifacts
        ))
    yield
    checkpoint()


def adaptive_reserve_bytes() -> int:
    total = effective_total_memory_bytes()
    if total is None:
        raise uploads._memory_pressure_error()
    return min(512 * MIB, max(128 * MIB, total // 8))


def preflight_directory(source: BinaryIO) -> None:
    """Check allocation size before ZipFile reads the directory, not afterwards."""
    from app.services.adaptive_import.contracts import AdaptiveImportError
    position = source.tell()
    try:
        source.seek(0, 2)
        size = source.tell()
        source.seek(max(0, size - 65557))
        tail = source.read(65557)
        offset = tail.rfind(b"PK\x05\x06")
        if offset < 0 or offset + 22 > len(tail):
            raise ValueError()
        _, disk, directory_disk, disk_count, count, length, start, comment = struct.unpack_from("<4s4H2LH", tail, offset)
        if (disk or directory_disk or disk_count != count or count == 65535
                or b"PK\x06\x07" in tail[max(0, offset - 20):offset]):
            raise AdaptiveImportError("ZIP_MEMBER_UNSUPPORTED", "Split and ZIP64 archives are not supported by bounded import.", layer="archive")
        if (offset + 22 + comment != len(tail) or start + length != size - len(tail) + offset
                or count > get_settings().bundle_max_entries or length > 4 * MIB):
            raise AdaptiveImportError("ZIP_ENTRY_LIMIT", "The ZIP directory exceeds the bounded metadata limit.", layer="archive")
    except (ValueError, struct.error) as exc:
        raise AdaptiveImportError("ZIP_INVALID", "The ZIP directory is invalid.", layer="archive") from exc
    finally:
        source.seek(position)


def validate_catalog_budget(catalog: dict) -> None:
    if current_budget() is None:
        return
    if streaming_budget():
        checkpoint()
        return
    members = [item for item in catalog.get("members", []) if isinstance(item, dict)]
    documents = [item for item in members if item.get("use") == "conversation"]
    attachments = [item for item in members if item.get("use") == "attachment"]
    enforce_limit(len(documents), 1)
    enforce_limit(len(attachments), MAX_ATTACHMENTS)
    for document in documents:
        enforce_limit(int(document.get("byte_size") or 0), MAX_TEXT_BYTES)
    for attachment in attachments:
        enforce_limit(int(attachment.get("byte_size") or 0), MAX_ATTACHMENT_BYTES)
    checkpoint()


class BudgetedArchiveStream:
    """Only used by bounded imports; asset-store reads remain streaming."""

    def __init__(self, source, archive_file=None):
        self.source = source
        self.archive_file = archive_file
        self.bytes_read = 0

    def read(self, size=-1):
        if size < 0:
            raise limit_error()
        checkpoint()
        result = self.source.read(min(size, 64 * 1024))
        self.bytes_read += len(result)
        if self.archive_file is not None and self.bytes_read >= 1024 * 1024:
            from app.services.adaptive_import.bounded_io import release_file_cache
            release_file_cache(self.archive_file)
            self.bytes_read = 0
        checkpoint()
        return result

    def close(self):
        self.source.close()
        if self.archive_file is not None:
            from app.services.adaptive_import.bounded_io import release_file_cache
            release_file_cache(self.archive_file)


def _bounded_directory(source: BinaryIO) -> bool:
    """Read at most a ZIP comment plus EOCD; reject ZIP64/multi-volume here."""
    source.seek(0, 2)
    size = source.tell()
    if not 22 <= size <= MAX_ARCHIVE_BYTES:
        return False
    source.seek(max(0, size - 65557))
    tail = source.read(65557)
    offset = tail.rfind(b"PK\x05\x06")
    if offset < 0 or offset + 22 > len(tail):
        return False
    _, disk, directory_disk, disk_count, count, length, start, comment = struct.unpack_from("<4s4H2LH", tail, offset)
    end = size - len(tail) + offset
    return (
        disk == directory_disk == 0 and disk_count == count
        and 0 < count <= MAX_ENTRIES and 0 < length <= MAX_DIRECTORY_BYTES
        and offset + 22 + comment == len(tail)
        and start + length == end
        and b"PK\x06\x07" not in tail[max(0, offset - 20):offset]
    )


def _qualifies(source: BinaryIO) -> bool:
    from app.services.adaptive_import.archive_sources import (
        _conversation_document_paths, _effective_path, _is_exporter_manifest, _read_member_bytes, _validated_members,
    )

    position = source.tell()
    try:
        if not _bounded_directory(source):
            return False
        source.seek(0)
        with zipfile.ZipFile(source) as archive:
            infos, wrapper = _validated_members(archive)
            if len(infos) > MAX_ENTRIES or sum(info.file_size for info in infos) > MAX_ARCHIVE_BYTES:
                return False
            paths = {_effective_path(info.filename, wrapper): info for info in infos}
            lower = {path.casefold(): path for path in paths}
            main, manifest_path = lower.get("conversation.md"), lower.get("manifest.json")
            manifest = None
            if main and manifest_path:
                info = paths[manifest_path]
                if info.file_size > MAX_TEXT_BYTES:
                    return False
                manifest = json.loads(_read_member_bytes(archive, info, MAX_TEXT_BYTES))
            dedicated = bool(main and _is_exporter_manifest(manifest))
            documents = [paths[main]] if dedicated else [
                paths[path] for path in _conversation_document_paths(paths)
            ]
            if len(documents) != 1 or documents[0].file_size > MAX_TEXT_BYTES:
                return False
            return len(infos) <= MAX_ENTRIES
    except (OSError, ValueError, RuntimeError, zipfile.BadZipFile, NotImplementedError):
        # Qualification is not format validation. The normal guarded path
        # remains responsible for precise archive/encoding/policy diagnostics.
        return False
    finally:
        source.seek(position)


def _owned_archive(record, *, replacement=None) -> tuple[Path | None, BinaryIO | None]:
    originals = [
        item for item in record.artifacts
        if getattr(item, "source_type", None) != "adaptive_archive_document"
        and (replacement is None or item.id != replacement[0])
    ]
    if replacement is not None:
        _, upload = replacement
        if originals or Path(upload.filename or "").suffix.casefold() != ".zip":
            return None, None
        return None, upload.file
    if len(originals) != 1 or getattr(originals[0], "source_type", None) != "adaptive_archive":
        return None, None
    from app.services.adaptive_import.archive_sources import _artifact_path
    return _artifact_path(record, originals[0]), None


def _catalog_selection_qualifies(record, archive_changes=None) -> bool:
    """Do not apply an initial one-document proof to a broader explicit review."""
    from app.services.adaptive_import.archive_sources import CATALOG_VERSION, archive_catalog
    from app.services.adaptive_import.contracts import AdaptiveImportError

    originals = [item for item in record.artifacts if item.source_type != "adaptive_archive_document"]
    if len(originals) != 1 or originals[0].source_type != "adaptive_archive":
        return False
    artifact = originals[0]
    summary = getattr(artifact, "parsed_summary", None) or {}
    if not summary.get("archive_catalog_version"):
        return archive_changes is None
    if summary["archive_catalog_version"] != CATALOG_VERSION:
        return False
    try:
        catalog = archive_catalog(record, artifact.id)
        selection = {
            member["member_id"]: {"use": member["use"], "byte_size": member.get("byte_size")}
            for member in catalog["members"]
        }
        if archive_changes is not None:
            if (str(artifact.id) != archive_changes.get("artifact_id")
                    or catalog["classification_version"] != archive_changes.get("expected_version")):
                return False
            for change in archive_changes.get("changes") or []:
                member = selection.get(str(change.get("member_id")))
                if member is None or change.get("use") not in {"conversation", "attachment", "excluded"}:
                    return False
                # A newly enabled body and its references have not been
                # bounded yet. Admit that first inspection with normal RAM.
                if change["use"] == "conversation" and member["use"] != "conversation":
                    return False
                member["use"] = change["use"]
            for change in archive_changes.get("reference_changes") or []:
                target_id = change.get("target_member_id")
                if target_id is not None:
                    target = selection.get(str(target_id))
                    if target is None or target["use"] == "conversation":
                        return False
                    target["use"] = "attachment"
        documents = [member for member in selection.values() if member["use"] == "conversation"]
        attachments = [member for member in selection.values() if member["use"] == "attachment"]
        return (
            len(documents) == 1 and int(documents[0]["byte_size"] or 0) <= MAX_TEXT_BYTES
            and len(attachments) <= MAX_ATTACHMENTS
            and all(int(member["byte_size"] or 0) <= MAX_ATTACHMENT_BYTES for member in attachments)
        )
    except (AdaptiveImportError, OSError, ValueError, TypeError, KeyError):
        return False


@contextmanager
def import_analysis_admission(
    db, record, *, stage="analysis", force_memory_check=False,
    sizes=None, replacement=None, archive_changes=None,
):
    """Share the normal semaphore and a DB-wide lightweight lane.

    PostgreSQL's transaction lock remains held through commit/rollback. It is
    non-blocking so a synchronous request cannot deadlock the worker's record
    locks. SQLite's process lane is only a local-test substitute.
    """
    if current_budget() is not None:
        checkpoint()
        yield
        return
    if (replacement is None and bounded_markdown_session(record)
            and ((stage != "commit" and prefer_bounded_markdown(record))
                 or (stage == "commit" and (record.draft_summary or {}).get("format_version") == 2))):
        with bounded_unit_admission(db, record, stage=stage):
            yield
        return
    # A legacy v1 JSONL line contains an entire conversation. Merely enabling
    # the new parser must not grant that reader the new low-memory admission.
    if (bounded_zip_session(record) and replacement is None
            and (stage != "commit" or (record.draft_summary or {}).get("format_version") == 2)):
        reserve = adaptive_reserve_bytes()
        baseline = process_resident_memory_bytes()
        if baseline is None:
            raise uploads._memory_pressure_error()
        with uploads.bounded_analysis_admission_sync(
            sizes or [0], force_memory_check=True, db=db,
            required_memory_bytes=reserve + WORKSPACE_BYTES,
            wait_for_slot=False,
        ):
            token = _active.set(SmallImportBudget(
                baseline, stage, streaming=True, reserve_bytes=reserve,
                scratch_directory=Path(get_settings().import_storage_dir).resolve() / str(record.id),
            ))
            try:
                checkpoint()
                from app.services.adaptive_import.archive_sources import _artifact_path
                originals = [item for item in record.artifacts if item.source_type == "adaptive_archive"]
                for artifact in originals if stage != "analysis" or len(originals) == 1 else []:
                    if artifact.source_type == "adaptive_archive":
                        with _artifact_path(record, artifact).open("rb") as source:
                            preflight_directory(source)
                yield
                checkpoint()
            finally:
                _active.reset(token)
        return
    source_sizes = sizes if sizes is not None else [
        max(0, int(getattr(item, "byte_size", 0) or 0)) for item in record.artifacts
    ]
    # ZIP inspection is always parsing, even below the legacy heavy-upload
    # size threshold. A failed qualification must not turn into a tiny-file
    # bypass (including ZIP -> text replacement of an existing archive).
    force_memory_check = force_memory_check or any(
        getattr(item, "source_type", None) == "adaptive_archive" for item in record.artifacts
    ) or (
        replacement is not None
        and Path(replacement[1].filename or "").suffix.casefold() == ".zip"
    )
    baseline = process_resident_memory_bytes()
    profile = None
    available = uploads.available_memory_bytes()
    if (get_settings().import_small_zip_enabled and baseline is not None
            and available is not None and available >= RESERVE_BYTES + WORKSPACE_BYTES):
        path, stream = _owned_archive(record, replacement=replacement)
        if path is not None:
            with path.open("rb") as source:
                qualifies = _qualifies(source)
        elif stream is not None:
            qualifies = _qualifies(stream)
        else:
            qualifies = False
        if qualifies and (replacement is not None or _catalog_selection_qualifies(record, archive_changes)):
            if stage != "commit":
                profile = {"kind": "bounded_analysis"}
            else:
                profile = _profile_for(record, stage=stage)
    if profile is None:
        with uploads.bounded_analysis_admission_sync(
            source_sizes, force_memory_check=force_memory_check, db=db,
        ):
            yield
        return
    if db.get_bind().dialect.name != "postgresql":
        if not _local_lane.acquire(blocking=False):
            raise uploads.UploadLimitError("UPLOAD_QUEUE_FULL", "Another bounded import is running. Retry shortly.", status_code=429)
        lane = _local_lane
    else:
        lane = None
    try:
        with uploads.bounded_analysis_admission_sync(
            source_sizes, force_memory_check=True,
            db=db,
            required_memory_bytes=RESERVE_BYTES + WORKSPACE_BYTES,
        ):
            token = _active.set(SmallImportBudget(baseline_rss=baseline, stage=stage))
            try:
                checkpoint()
                yield
                checkpoint()
            finally:
                _active.reset(token)
    finally:
        if lane is not None:
            lane.release()


def small_zip_receipt(record) -> dict | None:
    """Return a content-free receipt only for a completed bounded import plan."""
    profile = _profile_for(record, stage="analysis")
    if profile is None or getattr(record, "session_state", None) != "READY":
        return None
    from app.services.adaptive_import.archive_sources import archive_catalog

    archive_id = profile["archive_artifact_id"]
    try:
        catalog = archive_catalog(record, uuid.UUID(archive_id))
    except (OSError, ValueError, KeyError, zipfile.BadZipFile):
        return None
    if catalog.get("archive_kind") not in {"conversation_export", "markdown_zip"} or any(
        isinstance(issue, dict) and str(issue.get("severity") or "").casefold() == "error"
        for issue in catalog.get("issues", [])
    ):
        return None
    documents = [
        item for item in catalog.get("members", [])
        if isinstance(item, dict) and item.get("use") == "conversation"
    ]
    assets = [
        item for item in catalog.get("members", [])
        if isinstance(item, dict) and item.get("use") == "attachment"
    ]
    if len(documents) != 1 or len(assets) > MAX_ATTACHMENTS:
        return None
    if int(documents[0].get("byte_size") or 0) > MAX_TEXT_BYTES:
        return None
    refs = sum(max(0, int(item.get("reference_count") or 0)) for item in assets)
    if refs > MAX_REFERENCES:
        return None
    derived = [
        item for item in record.artifacts
        if getattr(item, "source_type", None) == "adaptive_archive_document"
        and str((item.parsed_summary or {}).get("archive_artifact_id")) == archive_id
    ]
    if len(derived) != 1 or (derived[0].parsed_summary or {}).get("archive_member_id") != documents[0]["member_id"]:
        return None
    root = Path(get_settings().import_storage_dir).resolve()
    draft = Path(record.draft_storage_uri or "")
    draft = draft.resolve() if draft.is_absolute() else (root / draft).resolve()
    if not draft.is_relative_to(root) or not draft.is_file() or draft.stat().st_size > MAX_DRAFT_BYTES:
        return None
    messages = int((record.draft_summary or {}).get("message_count") or 0)
    if (int((record.draft_summary or {}).get("conversation_count") or 0) != 1
            or not 0 < messages <= MAX_MESSAGES):
        return None
    try:
        payload = json.loads(draft.read_bytes())
        draft_messages = payload.get("messages")
        if not isinstance(draft_messages, list) or len(draft_messages) != messages:
            return None
        from app.services.canonical.block_builder import build_basic_render_blocks
        blocks = 0
        for item in draft_messages:
            blocks += len(build_basic_render_blocks(str(item.get("display_text") or "")))
            if blocks > MAX_BLOCKS:
                return None
        attachments = payload.get("attachments")
        if not isinstance(attachments, list):
            return None
        attachment_count = sum(item.get("record_type") == "attachment" for item in attachments)
        reference_count = sum(item.get("record_type") == "attachment_ref" for item in attachments)
        if attachment_count != len(assets) or reference_count > MAX_REFERENCES:
            return None
    except uploads.UploadLimitError:
        raise
    except (OSError, ValueError, TypeError):
        return None
    return {
        **profile,
        "classification_version": int(catalog.get("classification_version") or 0),
        "document_sha256": derived[0].sha256,
        "source_fingerprint": getattr(record, "source_fingerprint", ""),
        "draft_sha256": record.draft_sha256,
        "draft_bytes": draft.stat().st_size,
        "conversation_count": 1,
        "message_count": messages,
        "block_count": blocks,
        "attachment_count": attachment_count,
        "reference_count": reference_count,
    }


def _profile_for(record, *, stage: str) -> dict | None:
    from app.services.adaptive_import.archive_sources import _artifact_path, archive_catalog

    originals = [
        item for item in record.artifacts
        if getattr(item, "source_type", None) != "adaptive_archive_document"
    ]
    if len(originals) != 1:
        return None
    archive = originals[0]
    if getattr(archive, "source_type", None) != "adaptive_archive":
        return None
    if stage == "commit":
        receipt = (record.analysis_summary or {}).get("small_zip_profile")
        if not isinstance(receipt, dict) or receipt.get("kind") != "small_conversation_zip_v1":
            return None
        try:
            catalog = archive_catalog(record, archive.id)
            current_fingerprint = ",".join(sorted(
                item.sha256 for item in record.artifacts
                if item.source_type != "adaptive_archive_document"
            ))
            derived = [
                item for item in record.artifacts
                if item.source_type == "adaptive_archive_document"
                and str((item.parsed_summary or {}).get("archive_artifact_id")) == str(archive.id)
            ]
            root = Path(get_settings().import_storage_dir).resolve()
            draft = Path(record.draft_storage_uri or "")
            draft = draft.resolve() if draft.is_absolute() else (root / draft).resolve()
            if (
                len(derived) != 1 or not draft.is_relative_to(root) or not draft.is_file()
                or draft.stat().st_size > MAX_DRAFT_BYTES
                or record.draft_sha256 != receipt.get("draft_sha256")
                or archive.sha256 != receipt.get("archive_sha256")
                or derived[0].sha256 != receipt.get("document_sha256")
                or int(catalog.get("classification_version") or 0) != receipt.get("classification_version")
                or current_fingerprint != receipt.get("source_fingerprint")
                or (record.draft_summary or {}).get("conversation_count") != 1
                or (record.draft_summary or {}).get("message_count") != receipt.get("message_count")
                or draft.stat().st_size != receipt.get("draft_bytes")
                or _file_hash(draft) != record.draft_sha256
                or _file_hash(_artifact_path(record, archive)) != archive.sha256
                or _file_hash(_artifact_path(record, derived[0])) != derived[0].sha256
                or not 0 < int(receipt.get("block_count") or 0) <= MAX_BLOCKS
                or int(receipt.get("attachment_count") or 0) > MAX_ATTACHMENTS
                or int(receipt.get("reference_count") or 0) > MAX_REFERENCES
                or any(
                    isinstance(issue, dict) and str(issue.get("severity") or "").casefold() == "error"
                    for issue in catalog.get("issues", [])
                )
            ):
                return None
            return receipt
        except (OSError, ValueError, TypeError, KeyError):
            return None
    try:
        path = _artifact_path(record, archive)
        with path.open("rb") as source:
            if not _qualifies(source):
                return None
        return {
            "kind": "small_conversation_zip_v1",
            "archive_artifact_id": str(archive.id),
            "archive_sha256": archive.sha256,
            "archive_bytes": int(archive.byte_size or 0),
        }
    except (OSError, ValueError):
        return None


def _file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(64 * 1024):
            digest.update(chunk)
    return digest.hexdigest()
