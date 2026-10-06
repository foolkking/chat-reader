from __future__ import annotations

import hashlib
import json
import re
import time
import uuid
import zipfile
from collections.abc import Iterable, Iterator
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.core.config import get_settings
from app.models.attachment import Attachment, AssetObject, MessageVersionAttachment
from app.models.conversation import Conversation
from app.models.export_artifact import ExportArtifact
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.user import User
from app.services.assets.asset_store import LocalAssetStore, get_asset_store
from app.services.assets.scanner import scan_status_allows_use
from app.services.artifact_lifecycle import publish_zip_artifact, staging_path
from app.services.exporting.archive_transaction import archive_read_snapshot, track_archive_object
from app.services.exporting.export_service import ExportOptions, ExportError, _write_export_event, export_conversation_canjson_v2, export_conversation_markdown_v2
from app.services.ownership import OwnershipScope


MARKDOWN_BUNDLE_FORMAT = "chat-reader-markdown-bundle"
CANJSON_BUNDLE_FORMAT = "chat-reader-canjson-bundle"
BUNDLE_VERSION = 1
BUNDLE_MIME = "application/zip"


def create_attachment_bundle(
    db: Session,
    *,
    conversation_id: uuid.UUID,
    job_id: uuid.UUID,
    bundle_format: str,
    ownership_scope: OwnershipScope,
    options: ExportOptions | None = None,
    progress_callback=None,
) -> ExportArtifact:
    if bundle_format not in {MARKDOWN_BUNDLE_FORMAT, CANJSON_BUNDLE_FORMAT}:
        raise ExportError("Unsupported attachment bundle format.")
    export_options = options or ExportOptions(format="canjson_v2", message_ids=[])
    if export_options.message_ids or export_options.include_versions or export_options.compression != "none":
        raise ExportError("Attachment bundles export current full conversations only.", 422)
    export_options = ExportOptions(**{**export_options.__dict__,
        "format": "markdown_v2" if bundle_format == MARKDOWN_BUNDLE_FORMAT else "canjson_v2",
        "preserve_attachment_uris": True})
    root = Path(get_settings().export_storage_dir).resolve()
    directory = (root / str(job_id)).resolve()
    if not directory.is_relative_to(root):
        raise ExportError("ATTACHMENT_EXPORT_STORAGE_UNAVAILABLE", 503)
    temporary = None
    try:
        with archive_read_snapshot(db) as snapshot:
            conversation = _require_source(snapshot, conversation_id, ownership_scope)
            suffix = "-markdown.zip" if bundle_format == MARKDOWN_BUNDLE_FORMAT else ".context.zip"
            destination = directory / f"{_safe_filename(conversation.display_title)}{suffix}"
            temporary = staging_path(destination)
            asset_ids, message_count = _write_bundle(snapshot, conversation, temporary,
                bundle_format, export_options, progress_callback)
        # The snapshot provides content consistency, never continuing authorization.
        _require_source(db, conversation_id, ownership_scope)
        _require_assets(db, asset_ids)
        if progress_callback:
            progress_callback("publishing", 98, 1, 1)
        if temporary.stat().st_size > get_settings().bundle_max_compressed_bytes:
            raise ExportError("ATTACHMENT_EXPORT_LIMIT", 413)
        artifact_id = uuid.uuid4()
        track_archive_object(db, LocalAssetStore(root), destination.relative_to(root).as_posix())
        published = publish_zip_artifact(temporary, destination, category="export", artifact_id=artifact_id,
            required_entries=(("conversation.md",) if bundle_format == MARKDOWN_BUNDLE_FORMAT else ("manifest.json", "conversation.canjsonl")))
        artifact = ExportArtifact(id=artifact_id, job_id=job_id, conversation_id=conversation_id,
            format=bundle_format, filename=destination.name, storage_uri=str(destination),
            sha256=published.sha256, byte_size=published.byte_size,
            expires_at=datetime.now(timezone.utc) + timedelta(hours=24))
        db.add(artifact)
        _write_export_event(db, conversation_id, export_options, message_count)
        db.flush()
        if progress_callback:
            progress_callback("publishing", 99, 1, 1)
        return artifact
    except OSError as error:
        raise ExportError("ATTACHMENT_EXPORT_STORAGE_UNAVAILABLE", 503) from error
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def _require_source(db: Session, conversation_id: uuid.UUID, scope: OwnershipScope) -> Conversation:
    if scope.owner_user_id is not None:
        user = db.get(User, scope.owner_user_id, populate_existing=True)
        if user is None or not user.can_login:
            raise ExportError("ATTACHMENT_EXPORT_ACCOUNT_UNAVAILABLE", 403)
    conversation = db.scalar(select(Conversation).where(Conversation.id == conversation_id,
        Conversation.deleted_at.is_(None), scope.predicate(Conversation)).execution_options(populate_existing=True))
    if conversation is None:
        raise ExportError("ATTACHMENT_EXPORT_SOURCE_UNAVAILABLE", 404)
    return conversation


def _require_assets(db: Session, asset_ids: set[uuid.UUID]) -> None:
    ordered = list(asset_ids)
    for offset in range(0, len(ordered), 200):
        batch = ordered[offset:offset + 200]
        rows = list(db.scalars(select(AssetObject).where(AssetObject.id.in_(batch))
            .execution_options(populate_existing=True)))
        if len(rows) != len(batch) or any(row.status != "available" or row.deleted_at is not None
                or not scan_status_allows_use(row.scan_status) for row in rows):
            raise ExportError("ATTACHMENT_EXPORT_ASSET_UNAVAILABLE", 409)


def _write_bundle(db, conversation, temporary, bundle_format, export_options, progress_callback):
    budget = _WriteBudget(progress_callback)
    attachment_rows = _current_attachments(db, conversation.id)
    if len(attachment_rows) > get_settings().bundle_max_entries:
        raise ExportError("ATTACHMENT_EXPORT_LIMIT", 413)
    object_paths: dict[uuid.UUID, str] = {}
    exportable_assets: list[tuple[Attachment, AssetObject, Path, str]] = []
    missing_attachments = 0
    portable_paths = _portable_attachment_paths(attachment_rows) if bundle_format == MARKDOWN_BUNDLE_FORMAT else {}
    for attachment in attachment_rows:
        asset = attachment.asset_object
        if asset is None or asset.status != "available" or asset.deleted_at is not None or not scan_status_allows_use(asset.scan_status):
            missing_attachments += 1
            continue
        try:
            source = get_asset_store().resolve_key(asset.storage_key)
            source_size = source.stat().st_size
        except (ValueError, FileNotFoundError):
            missing_attachments += 1
            continue
        if asset.byte_size > get_settings().bundle_max_object_bytes:
            raise ExportError("ATTACHMENT_EXPORT_LIMIT", 413)
        if source_size != asset.byte_size:
            raise ExportError("ATTACHMENT_EXPORT_INTEGRITY", 409)
        object_path = (
            portable_paths[attachment.id]
            if bundle_format == MARKDOWN_BUNDLE_FORMAT
            else f"assets/objects/{asset.sha256[:2]}/{asset.sha256}"
        )
        object_paths[attachment.id] = object_path
        exportable_assets.append((attachment, asset, source, object_path))
    object_count = len(set(object_paths.values()))
    if object_count > get_settings().bundle_max_objects:
        raise ExportError("ATTACHMENT_EXPORT_LIMIT", 413)
    checksums: dict[str, dict[str, Any]] = {}

    with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True, compresslevel=6) as archive:
        if bundle_format == MARKDOWN_BUNDLE_FORMAT:
            result = export_conversation_markdown_v2(db, conversation.id, export_options, record_event=False)
            checksums["conversation.md"] = _write_stream(
                archive,
                "conversation.md",
                _rewrite_markdown(result.content, object_paths, {row.id: row.display_name for row in attachment_rows}),
                budget=budget,
            )
        else:
            result = export_conversation_canjson_v2(db, conversation.id, export_options, record_event=False)
            if result.message_count > get_settings().canjson_max_messages:
                raise ExportError("ATTACHMENT_EXPORT_LIMIT", 413)
            checksums["conversation.canjsonl"] = _write_stream(
                archive,
                "conversation.canjsonl",
                _rewrite_canjson(
                    result.content,
                    object_paths,
                    excluded_ids=set(),
                ),
                budget=budget,
            )

        available_objects = 0
        total_bytes = 0
        written_object_paths: set[str] = set()
        for _attachment, asset, source, path_name in exportable_assets:
            if path_name in written_object_paths:
                continue
            budget.phase = "assets"
            budget.processed = available_objects
            budget.total = max(object_count, 1)
            actual = _write_stream(archive, path_name, _asset_chunks(source, asset.byte_size), budget=budget)
            if actual != {"sha256": asset.sha256, "byte_size": asset.byte_size}:
                raise ExportError("ATTACHMENT_EXPORT_INTEGRITY", 409)
            written_object_paths.add(path_name)
            checksums[path_name] = actual
            available_objects += 1
            total_bytes += asset.byte_size
            budget.processed = available_objects
            if progress_callback:
                progress_callback("assets", 50 + int(45 * available_objects / budget.total), available_objects, budget.total)

        if bundle_format == CANJSON_BUNDLE_FORMAT:
            reference_count = _current_reference_count(db, conversation.id)
            physical_objects = len({row.asset_object_id for row in attachment_rows if row.asset_object_id})
            completeness = _asset_completeness(
                requested=True,
                record_count=len(attachment_rows),
                missing_count=missing_attachments,
                excluded_count=0,
            )
            manifest = {
                "format": "chat-reader-context-package",
                "format_version": "1.0",
                "entrypoint": "conversation.canjsonl",
                "conversation": {
                    "id": str(conversation.id),
                    "title": conversation.display_title,
                    "message_count": result.message_count,
                    "conversation_revision": conversation.offline_revision,
                    "current_versions_only": True,
                },
                "conversation_completeness": "complete",
                "asset_completeness": completeness,
                "attachments": {
                    "requested": True,
                    "metadata_included": True,
                    "binary_objects_included": bool(written_object_paths),
                    "record_count": len(attachment_rows),
                    "reference_count": reference_count,
                    "resolved_attachment_count": len(object_paths),
                    "physical_object_count": physical_objects,
                    "available_object_count": len(written_object_paths),
                    "missing_object_count": missing_attachments,
                    "excluded_object_count": 0,
                    "completeness": completeness,
                    "total_available_bytes": total_bytes,
                },
                "included_content": {
                    "conversation_description": export_options.include_description,
                    "annotations": export_options.include_annotations,
                    "notebook": export_options.include_notebook,
                    "source_refs": export_options.include_source_refs,
                },
                "files": checksums,
            }
            _write_json(archive, "manifest.json", manifest, budget=budget)
    return {asset.id for _, asset, _, _ in exportable_assets}, result.message_count


def _current_attachments(db: Session, conversation_id: uuid.UUID) -> list[Attachment]:
    return (
        db.query(Attachment)
        .options(joinedload(Attachment.asset_object))
        .filter(
            Attachment.conversation_id == conversation_id,
            Attachment.deleted_at.is_(None),
            Attachment.status != "detached",
        )
        .order_by(Attachment.created_at.asc(), Attachment.id.asc())
        .limit(get_settings().bundle_max_entries + 1)
        .all()
    )


def _rewrite_markdown(
    chunks: Iterable[bytes],
    object_paths: dict[uuid.UUID, str],
    attachment_names: dict[uuid.UUID, str],
) -> Iterator[bytes]:
    paths = {str(key): value for key, value in object_paths.items()}
    names = {str(key): value for key, value in attachment_names.items()}
    with closing(_lines(chunks, get_settings().bundle_max_expanded_bytes)) as lines:
        for line, ending in lines:
            yield (_rewrite_markdown_line(line.decode("utf-8"), paths, names) + ending).encode("utf-8")


def _rewrite_canjson(
    chunks: Iterable[bytes],
    object_paths: dict[uuid.UUID, str],
    *,
    excluded_ids: set[uuid.UUID],
) -> Iterator[bytes]:
    with closing(_lines(chunks, get_settings().canjson_max_line_bytes)) as lines:
        for line, ending in lines:
            if not line:
                yield ending.encode()
                continue
            record = json.loads(line)
            if record.get("record_type") == "attachment":
                attachment_id = uuid.UUID(str(record["id"]))
                path = object_paths.get(attachment_id)
                if path:
                    asset = record.get("asset_object") or {}
                    record["resolution_status"] = "available"
                    record["object"] = {
                        "path": path,
                        "sha256": asset.get("sha256"),
                        "byte_size": asset.get("byte_size"),
                    }
                elif attachment_id in excluded_ids:
                    record["resolution_status"] = "excluded"
                    record["object"] = None
                else:
                    record["resolution_status"] = "missing"
                    record["object"] = None
            yield (json.dumps(record, ensure_ascii=False, separators=(",", ":")) + ending).encode("utf-8")


def _lines(chunks: Iterable[bytes], limit: int):
    """Bound pending bytes and propagate writer interruption to the DB iterator."""
    iterator = iter(chunks)
    pending = bytearray()
    try:
        for chunk in iterator:
            start = 0
            while start < len(chunk):
                end = chunk.find(b"\n", start)
                stop = len(chunk) if end < 0 else end
                if len(pending) + stop - start > limit:
                    raise ExportError("ATTACHMENT_EXPORT_LIMIT", 413)
                pending.extend(chunk[start:stop])
                if end < 0:
                    break
                yield bytes(pending), "\n"
                pending.clear()
                start = end + 1
        if pending:
            yield bytes(pending), ""
    finally:
        close = getattr(iterator, "close", None)
        if close is not None:
            close()


def _asset_chunks(source: Path, expected_size: int):
    size = 0
    with source.open("rb") as handle:
        while chunk := handle.read(min(1024 * 1024, max(1, expected_size - size + 1))):
            size += len(chunk)
            if size > expected_size:
                raise ExportError("ATTACHMENT_EXPORT_INTEGRITY", 409)
            yield chunk


class _WriteBudget:
    def __init__(self, callback):
        self.callback = callback
        self.expanded = 0
        self.last_report = 0.0
        self.phase = "exporting"
        self.processed = 0
        self.total = 1

    def consume(self, size):
        self.expanded += size
        if self.expanded > get_settings().bundle_max_expanded_bytes:
            raise ExportError("ATTACHMENT_EXPORT_LIMIT", 413)

    def check(self, archive):
        if archive.fp.tell() > get_settings().bundle_max_compressed_bytes:
            raise ExportError("ATTACHMENT_EXPORT_LIMIT", 413)
        if self.callback and time.monotonic() - self.last_report >= 0.25:
            progress = 10 if self.phase == "exporting" else 50 + int(45 * self.processed / self.total)
            self.callback(self.phase, progress, self.processed, self.total)
            self.last_report = time.monotonic()


def _write_stream(archive: zipfile.ZipFile, name: str, chunks: Iterable[bytes], *, budget: _WriteBudget) -> dict[str, Any]:
    digest = hashlib.sha256()
    size = 0
    iterator = iter(chunks)
    try:
        if len(archive.filelist) >= get_settings().bundle_max_entries:
            raise ExportError("ATTACHMENT_EXPORT_LIMIT", 413)
        with archive.open(name, "w", force_zip64=True) as destination:
            for chunk in iterator:
                for offset in range(0, len(chunk), 1024 * 1024):
                    part = chunk[offset:offset + 1024 * 1024]
                    budget.consume(len(part))
                    digest.update(part)
                    size += len(part)
                    destination.write(part)
                    budget.check(archive)
        budget.check(archive)
    finally:
        close = getattr(iterator, "close", None)
        if close is not None:
            close()
    return {"sha256": digest.hexdigest(), "byte_size": size}


def _write_json(archive: zipfile.ZipFile, name: str, value: dict[str, Any], *, budget: _WriteBudget) -> dict[str, Any]:
    encoded = (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    return _write_stream(archive, name, (encoded,), budget=budget)


def _safe_filename(value: str) -> str:
    safe = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "-", value)
    safe = " ".join(safe.split()).strip(" .-")[:120]
    return safe or "conversation"


_MARKDOWN_ASSET_RE = re.compile(
    r"(?P<image>!)?\[(?P<label>[^\]]*)\]\(cr-asset://(?P<id>[0-9a-fA-F-]{36})(?:\s+[^)]*)?\)"
)


def _rewrite_markdown_line(line: str, paths: dict[str, str], names: dict[str, str]) -> str:
    def replace(match: re.Match[str]) -> str:
        attachment_id = match.group("id")
        path = paths.get(attachment_id)
        label = match.group("label") or names.get(attachment_id, "Attachment")
        if path:
            prefix = "!" if match.group("image") else ""
            return f"{prefix}[{label}]({quote(path, safe='/')})"
        kind = "Image" if match.group("image") else "Attachment"
        return f"{kind}: {names.get(attachment_id, label)} (file unavailable in this export)"

    rendered = _MARKDOWN_ASSET_RE.sub(replace, line)
    for attachment_id, name in names.items():
        token = f"cr-asset://{attachment_id}"
        replacement = paths.get(attachment_id) or f"Attachment: {name} (file unavailable in this export)"
        rendered = rendered.replace(token, replacement)
    return rendered


def _portable_attachment_paths(attachments: list[Attachment]) -> dict[uuid.UUID, str]:
    output: dict[uuid.UUID, str] = {}
    used: set[str] = set()
    for attachment in attachments:
        original = _safe_portable_name(attachment.display_name or attachment.original_filename)
        candidate = original
        folded = candidate.casefold()
        if folded in used:
            stem, suffix = _split_suffix(original)
            identity = attachment.asset_object.sha256[:6] if attachment.asset_object is not None else str(attachment.id)[:6]
            candidate = f"{stem[: max(1, 110 - len(suffix))]}--{identity}{suffix}"
            counter = 2
            while candidate.casefold() in used:
                candidate = f"{stem[: max(1, 104 - len(suffix))]}--{identity}-{counter}{suffix}"
                counter += 1
        used.add(candidate.casefold())
        output[attachment.id] = f"attachments/{candidate}"
    return output


def _safe_portable_name(value: str) -> str:
    basename = value.replace("\\", "/").rsplit("/", 1)[-1]
    cleaned = re.sub(r"[\\/:*?\"<>|\x00-\x1f]+", "-", basename).strip().rstrip(" .")
    cleaned = re.sub(r"\s+", " ", cleaned)
    reserved_stem = cleaned.lstrip(".").upper().split(".")[0]
    if cleaned in {"", ".", ".."} or reserved_stem in {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}:
        cleaned = "attachment"
    return cleaned[:120].rstrip(" .") or "attachment"


def _split_suffix(value: str) -> tuple[str, str]:
    path = Path(value)
    suffix = path.suffix[:20]
    return (value[: -len(suffix)] if suffix else value, suffix)


def _current_reference_count(db: Session, conversation_id: uuid.UUID) -> int:
    return (
        db.query(MessageVersionAttachment.id)
        .join(Attachment, Attachment.id == MessageVersionAttachment.attachment_id)
        .join(MessageVersion, MessageVersion.id == MessageVersionAttachment.message_version_id)
        .join(Message, Message.id == MessageVersion.message_id)
        .filter(Message.conversation_id == conversation_id, Message.current_version_id == MessageVersion.id,
                Message.is_deleted.is_(False), Attachment.deleted_at.is_(None), Attachment.status != "detached")
        .count()
    )


def _asset_completeness(*, requested: bool, record_count: int, missing_count: int, excluded_count: int) -> str:
    if not requested:
        return "metadata_only" if record_count else "none"
    if record_count == 0:
        return "none"
    return "partial" if missing_count or excluded_count else "complete"
