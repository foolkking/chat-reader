from __future__ import annotations

import hashlib
import json
import re
import uuid
import zipfile
from collections.abc import Iterable, Iterator
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.attachment import Attachment, AssetObject, MessageVersionAttachment
from app.models.conversation import Conversation
from app.models.export_artifact import ExportArtifact
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.services.assets.asset_store import get_asset_store
from app.services.assets.scanner import scan_status_allows_use
from app.services.exporting.export_service import ExportOptions, ExportError, export_conversation_canjson_v2, export_conversation_markdown_v2


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
    options: ExportOptions | None = None,
    progress_callback=None,
) -> ExportArtifact:
    if bundle_format not in {MARKDOWN_BUNDLE_FORMAT, CANJSON_BUNDLE_FORMAT}:
        raise ExportError("Unsupported attachment bundle format.")
    conversation = db.get(Conversation, conversation_id)
    if conversation is None or conversation.deleted_at is not None:
        raise ExportError("Conversation not found.", 404)
    attachment_rows = _current_attachments(db, conversation.id)
    object_paths: dict[uuid.UUID, str] = {}
    exportable_assets: list[tuple[Attachment, AssetObject, Path, str]] = []
    excluded_attachment_ids: set[uuid.UUID] = set()
    missing_attachments = 0
    portable_paths = _portable_attachment_paths(attachment_rows) if bundle_format == MARKDOWN_BUNDLE_FORMAT else {}
    for attachment in attachment_rows:
        asset = attachment.asset_object
        if asset is None or asset.status != "available" or not scan_status_allows_use(asset.scan_status):
            missing_attachments += 1
            continue
        try:
            source = get_asset_store().resolve_key(asset.storage_key)
        except (ValueError, FileNotFoundError):
            missing_attachments += 1
            continue
        if _sha256_file(source) != asset.sha256 or source.stat().st_size != asset.byte_size:
            raise ExportError("Attachment object failed integrity validation.")
        object_path = (
            portable_paths[attachment.id]
            if bundle_format == MARKDOWN_BUNDLE_FORMAT
            else f"assets/objects/{asset.sha256[:2]}/{asset.sha256}"
        )
        object_paths[attachment.id] = object_path
        exportable_assets.append((attachment, asset, source, object_path))
    export_root = Path(get_settings().export_storage_dir).resolve()
    export_dir = (export_root / str(job_id)).resolve()
    if not export_dir.is_relative_to(export_root):
        raise ExportError("Invalid export storage path.")
    export_dir.mkdir(parents=True, exist_ok=True)
    suffix = "-markdown.zip" if bundle_format == MARKDOWN_BUNDLE_FORMAT else ".context.zip"
    destination = export_dir / f"{_safe_filename(conversation.display_title)}{suffix}"
    checksums: dict[str, dict[str, Any]] = {}

    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True, compresslevel=6) as archive:
        if bundle_format == MARKDOWN_BUNDLE_FORMAT:
            export_options = options or ExportOptions(format="markdown_v2", message_ids=[])
            export_options = ExportOptions(**{**export_options.__dict__, "format": "markdown_v2", "preserve_attachment_uris": True})
            result = export_conversation_markdown_v2(db, conversation.id, export_options)
            checksums["conversation.md"] = _write_stream(
                archive,
                "conversation.md",
                _rewrite_markdown(result.content, object_paths, {row.id: row.display_name for row in attachment_rows}),
            )
        else:
            export_options = options or ExportOptions(format="canjson_v2", message_ids=[])
            export_options = ExportOptions(**{**export_options.__dict__, "format": "canjson_v2"})
            result = export_conversation_canjson_v2(db, conversation.id, export_options)
            checksums["conversation.canjsonl"] = _write_stream(
                archive,
                "conversation.canjsonl",
                _rewrite_canjson(
                    result.content,
                    object_paths,
                    excluded_ids=excluded_attachment_ids,
                ),
            )

        available_objects = 0
        total_bytes = 0
        written_object_paths: set[str] = set()
        for _attachment, asset, source, path_name in exportable_assets:
            if path_name in written_object_paths:
                continue
            archive.write(source, path_name)
            written_object_paths.add(path_name)
            checksums[path_name] = {"sha256": asset.sha256, "byte_size": asset.byte_size}
            available_objects += 1
            total_bytes += asset.byte_size
            if progress_callback:
                progress_callback("assets", min(95, 50 + available_objects), available_objects, max(len(attachment_rows), 1))

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
                    "message_count": conversation.message_count,
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
            _write_json(archive, "manifest.json", manifest)

    digest = _sha256_file(destination)
    artifact = ExportArtifact(
        id=uuid.uuid4(),
        job_id=job_id,
        conversation_id=conversation.id,
        format=bundle_format,
        filename=destination.name,
        storage_uri=str(destination),
        sha256=digest,
        byte_size=destination.stat().st_size,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
    )
    db.add(artifact)
    db.flush()
    if progress_callback:
        progress_callback("publishing", 99, 1, 1)
    return artifact


def _current_attachments(db: Session, conversation_id: uuid.UUID) -> list[Attachment]:
    return (
        db.query(Attachment)
        .filter(
            Attachment.conversation_id == conversation_id,
            Attachment.deleted_at.is_(None),
            Attachment.status != "detached",
        )
        .order_by(Attachment.created_at.asc(), Attachment.id.asc())
        .all()
    )


def _rewrite_markdown(
    chunks: Iterable[bytes],
    object_paths: dict[uuid.UUID, str],
    attachment_names: dict[uuid.UUID, str],
) -> Iterator[bytes]:
    paths = {str(key): value for key, value in object_paths.items()}
    names = {str(key): value for key, value in attachment_names.items()}
    pending = b""
    for chunk in chunks:
        pending += chunk
        while b"\n" in pending:
            line, pending = pending.split(b"\n", 1)
            yield (_rewrite_markdown_line(line.decode("utf-8"), paths, names) + "\n").encode("utf-8")
    if pending:
        yield _rewrite_markdown_line(pending.decode("utf-8"), paths, names).encode("utf-8")


def _rewrite_canjson(
    chunks: Iterable[bytes],
    object_paths: dict[uuid.UUID, str],
    *,
    excluded_ids: set[uuid.UUID],
) -> Iterator[bytes]:
    pending = b""
    for chunk in chunks:
        pending += chunk
        while b"\n" in pending:
            line, pending = pending.split(b"\n", 1)
            if not line:
                yield b"\n"
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
            yield (json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    if pending:
        yield pending


def _write_stream(archive: zipfile.ZipFile, name: str, chunks: Iterable[bytes]) -> dict[str, Any]:
    digest = hashlib.sha256()
    size = 0
    with archive.open(name, "w") as destination:
        for chunk in chunks:
            digest.update(chunk)
            size += len(chunk)
            destination.write(chunk)
    return {"sha256": digest.hexdigest(), "byte_size": size}


def _write_json(archive: zipfile.ZipFile, name: str, value: dict[str, Any]) -> dict[str, Any]:
    encoded = (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    return _write_stream(archive, name, (encoded,))


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _safe_filename(value: str) -> str:
    safe = "".join("-" if char in r'\\/:*?"<>|\x00' else char for char in value)
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
            return f"{prefix}[{label}]({path})"
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
        .join(MessageVersion, MessageVersion.id == MessageVersionAttachment.message_version_id)
        .join(Message, Message.id == MessageVersion.message_id)
        .filter(Message.conversation_id == conversation_id, Message.current_version_id == MessageVersion.id)
        .count()
    )


def _asset_completeness(*, requested: bool, record_count: int, missing_count: int, excluded_count: int) -> str:
    if not requested:
        return "metadata_only" if record_count else "none"
    if record_count == 0:
        return "none"
    return "partial" if missing_count or excluded_count else "complete"
