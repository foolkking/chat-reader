from __future__ import annotations

import json
import stat
import uuid
import zipfile
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from pathlib import Path, PurePosixPath
from typing import Any, Callable

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.attachment import Attachment, AssetObject, AssetObjectLease, MessageVersionAttachment
from app.models.conversation import Conversation
from app.models.render_block import RenderBlock
from app.models.import_record import ImportRecord
from app.models.source_artifact import SourceArtifact
from app.services.assets.asset_store import get_asset_store
from app.services.assets.scanner import AssetScanError, detect_mime_type, scan_attachment, scan_status_allows_use
from app.services.import_pipeline.canjson_parser import CanJsonParseError, parse_canjson_v2
from app.services.import_pipeline.canonical_draft import (
    CanonicalDraftConversation,
    CanonicalDraftMessage,
    CanonicalDraftVersion,
    content_hash,
    normalize_text,
)
from app.services.import_pipeline.draft_store import attach_import_draft


ProgressCallback = Callable[[str, int, int, int], None]


class BundleImportError(ValueError):
    pass


@dataclass(frozen=True)
class BundlePreviewResult:
    message_count: int
    attachment_count: int
    object_count: int
    warnings: list[str]


def publish_bundle_attachments(
    db: Session,
    *,
    import_record: ImportRecord,
    artifact: SourceArtifact,
    conversation: Conversation,
    draft: CanonicalDraftConversation,
    identity_map: dict[str, tuple[uuid.UUID, dict[str, uuid.UUID]]],
) -> int:
    summary = artifact.parsed_summary or {}
    raw_references = summary.get("references")
    if not isinstance(raw_references, list):
        raise BundleImportError("Bundle preview attachment references are missing.")
    raw_attachments = summary.get("attachments")
    if not isinstance(raw_attachments, list):
        raise BundleImportError("Bundle preview attachment records are missing.")
    attachments: dict[str, Attachment] = {}
    for raw in raw_attachments:
        if not isinstance(raw, dict):
            raise BundleImportError("Bundle preview contains an invalid attachment record.")
        attachment_id = uuid.UUID(str(raw["id"]))
        asset_object_id = uuid.UUID(str(raw["asset_object_id"])) if raw.get("asset_object_id") else None
        attachment = Attachment(
            id=attachment_id,
            conversation_id=conversation.id,
            asset_object_id=asset_object_id,
            import_id=import_record.id,
            original_filename=str(raw.get("original_filename") or "attachment.bin")[:500],
            display_name=str(raw.get("display_name") or raw.get("original_filename") or "Attachment")[:500],
            declared_mime_type=_optional_text(raw.get("declared_mime_type")),
            detected_mime_type=_optional_text(raw.get("detected_mime_type")),
            status=str(raw.get("status") or ("available" if asset_object_id else "missing")),
            scan_status=str(raw.get("scan_status") or ("unscanned" if asset_object_id else "not_available")),
            source_type="crbundle",
            source_attachment_id=str(raw.get("source_attachment_id") or raw.get("source_id") or attachment_id),
            metadata_=raw.get("metadata") if isinstance(raw.get("metadata"), dict) else {},
            resolution_status=str(raw.get("resolution_status") or ("resolved" if asset_object_id else "missing")),
        )
        db.add(attachment)
        attachments[str(attachment.id)] = attachment
    db.flush()
    current_versions = {
        item.source_message_id: item.source_current_version_id
        for item in draft.messages
        if item.source_message_id
    }
    seen: set[tuple[uuid.UUID, uuid.UUID, str, int]] = set()
    created = 0
    for raw in raw_references:
        if not isinstance(raw, dict):
            raise BundleImportError("Bundle preview contains an invalid attachment reference.")
        attachment = attachments.get(str(raw.get("attachment_id") or ""))
        mapped = identity_map.get(str(raw.get("message_id") or ""))
        if attachment is None or mapped is None:
            raise BundleImportError("Bundle attachment reference could not be mapped during commit.")
        source_version_id = str(
            raw.get("message_version_id")
            or current_versions.get(str(raw.get("message_id") or ""))
            or ""
        )
        version_id = mapped[1].get(source_version_id)
        if version_id is None:
            raise BundleImportError("Bundle attachment version could not be mapped during commit.")
        relation_type = str(raw.get("relation_type") or "file")[:50]
        display_order = int(raw.get("display_order") or 0)
        identity = (version_id, attachment.id, relation_type, display_order)
        if identity in seen:
            continue
        seen.add(identity)
        block_index = raw.get("block_index")
        if block_index is None:
            blocks = (
                db.query(RenderBlock)
                .filter(RenderBlock.message_version_id == version_id)
                .order_by(RenderBlock.block_index.asc())
                .all()
            )
            block_index = next(
                (
                    block.block_index
                    for block in blocks
                    if isinstance(block.data, dict)
                    and str(block.data.get("attachmentId") or "") == str(attachment.id)
                ),
                None,
            )
        db.add(
            MessageVersionAttachment(
                id=uuid.uuid4(),
                message_version_id=version_id,
                attachment_id=attachment.id,
                occurrence_key=str(raw.get("occurrence_key") or uuid.uuid4().hex)[:255],
                placement=str(raw.get("placement") or "inline")[:50],
                relation_type=relation_type,
                display_order=display_order,
                block_index=int(block_index) if block_index is not None else None,
                display_mode=str(raw.get("display_mode") or "card")[:50],
                alt_text=_optional_text(raw.get("alt_text")),
                caption=_optional_text(raw.get("caption")),
            )
        )
        created += 1

    object_ids = {attachment.asset_object_id for attachment in attachments.values() if attachment.asset_object_id}
    if object_ids:
        objects = db.query(AssetObject).filter(AssetObject.id.in_(object_ids)).all()
        for asset_object in objects:
            if not scan_status_allows_use(asset_object.scan_status):
                raise BundleImportError("Bundle attachment is not allowed by the deployment scan policy.")
            get_asset_store().resolve_key(asset_object.storage_key)
            asset_object.status = "available"
        db.query(AssetObjectLease).filter(
            AssetObjectLease.asset_object_id.in_(object_ids),
            AssetObjectLease.holder_type == "import",
            AssetObjectLease.holder_id == str(import_record.id),
        ).delete(synchronize_session=False)
    conversation.render_version = max(conversation.render_version, 3)
    return created


def preview_bundle_import(
    db: Session,
    *,
    import_id: uuid.UUID,
    progress_callback: ProgressCallback | None = None,
) -> BundlePreviewResult:
    record = db.get(ImportRecord, import_id)
    if record is None:
        raise BundleImportError("Bundle import record was not found.")
    artifact = (
        db.query(SourceArtifact)
        .filter(
            SourceArtifact.import_id == import_id,
            SourceArtifact.source_profile == "chat_reader_bundle_v1",
        )
        .one_or_none()
    )
    if artifact is None:
        raise BundleImportError("Bundle source artifact was not found.")

    settings = get_settings()
    archive_path = _artifact_path(import_id, artifact)
    if archive_path.stat().st_size > settings.bundle_max_compressed_bytes:
        raise BundleImportError("Bundle exceeds the compressed size limit.")

    created_storage_keys: list[str] = []
    store = get_asset_store()
    try:
        with zipfile.ZipFile(archive_path) as archive:
            entries = _validate_archive(archive)
            manifest = _read_json(archive, entries, "manifest.json", max_bytes=1024 * 1024)
            _validate_manifest(manifest)
            fixture_bundle = manifest.get("format") == "chat-reader-import-bundle"
            canonical_path = str(
                manifest.get("canjson_file")
                if fixture_bundle
                else manifest.get("conversation_path") or "conversation.canonical.jsonl"
            )
            attachments_path = str(
                manifest.get("attachment_index")
                if fixture_bundle
                else manifest.get("attachments_path") or "attachments.jsonl"
            )
            canonical_bytes = _read_member(
                archive,
                entries,
                canonical_path,
                max_bytes=settings.max_import_file_size_mb * 1024 * 1024,
            )
            try:
                parsed, fixture_references = (
                    _parse_import_bundle_canjson(canonical_bytes)
                    if fixture_bundle
                    else (parse_canjson_v2(canonical_bytes), [])
                )
            except CanJsonParseError as exc:
                raise BundleImportError(str(exc)) from exc
            attachment_records = _read_jsonl(archive, entries, attachments_path)
            objects, attachments, references = (
                _normalize_import_bundle_records(
                    attachment_records,
                    fixture_references,
                    asset_root=str(manifest.get("asset_root") or "assets/objects"),
                )
                if fixture_bundle
                else _normalize_records(attachment_records)
            )
            if len(objects) > settings.bundle_max_objects:
                raise BundleImportError("Bundle contains too many physical objects.")
            _report(progress_callback, "validating", 10, 0, len(objects))

            source_attachment_ids = {item["id"] for item in attachments}
            object_ids = {item["id"] for item in objects}
            for item in attachments:
                if item.get("asset_object_id") and item["asset_object_id"] not in object_ids:
                    raise BundleImportError(f"Attachment {item['id']!r} references an unknown object.")
            for item in references:
                if item["attachment_id"] not in source_attachment_ids:
                    raise BundleImportError("Attachment reference points to an unknown attachment.")

            message_ids, version_ids = _source_identity_sets(parsed.conversation)
            _validate_reference_targets(references, message_ids, version_ids)

            object_map: dict[str, AssetObject] = {}
            warnings = list(parsed.warnings)
            lease_expires_at = datetime.now(timezone.utc) + timedelta(hours=settings.import_draft_ttl_hours)
            for index, item in enumerate(objects):
                member_path = item["path"]
                member = entries.get(member_path)
                if member is None or member.is_dir():
                    raise BundleImportError(f"Bundle object {member_path!r} is missing.")
                if member.file_size > settings.bundle_max_object_bytes:
                    raise BundleImportError(f"Bundle object {member_path!r} exceeds the per-file limit.")
                with archive.open(member) as source:
                    staged = store.stage(source, max_bytes=settings.bundle_max_object_bytes, quarantine=True)
                if staged.sha256 != item["sha256"] or staged.byte_size != item["byte_size"]:
                    staged.path.unlink(missing_ok=True)
                    raise BundleImportError(f"Bundle object {member_path!r} failed hash or size validation.")
                detected_mime, detected_extension = detect_mime_type(staged.path, item.get("filename") or member_path)
                try:
                    scan = scan_attachment(staged.path)
                except AssetScanError as exc:
                    staged.path.unlink(missing_ok=True)
                    raise BundleImportError(str(exc)) from exc
                if not scan.allowed_by_policy:
                    staged.path.unlink(missing_ok=True)
                    raise BundleImportError(f"Bundle object {member_path!r} was quarantined by the scanner.")
                existing = (
                    db.query(AssetObject)
                    .filter(AssetObject.sha256 == staged.sha256, AssetObject.byte_size == staged.byte_size)
                    .one_or_none()
                )
                if existing is not None:
                    staged.path.unlink(missing_ok=True)
                    if not scan_status_allows_use(existing.scan_status) or existing.status not in {"staging", "available"}:
                        raise BundleImportError("A matching physical object exists but is not safe to reuse.")
                    asset_object = existing
                else:
                    storage_key = store.object_key()
                    store.promote(staged.path, storage_key)
                    created_storage_keys.append(storage_key)
                    asset_object = AssetObject(
                        id=uuid.uuid4(),
                        sha256=staged.sha256,
                        byte_size=staged.byte_size,
                        detected_mime_type=detected_mime,
                        detected_extension=detected_extension,
                        storage_backend=store.backend,
                        storage_key=storage_key,
                        scan_status=scan.status,
                        status="staging",
                    )
                    db.add(asset_object)
                    db.flush()
                declared_mime = item.get("declared_mime_type")
                if declared_mime and declared_mime.casefold() != detected_mime.casefold():
                    warnings.append(f"Object {item['id']} declared {declared_mime} but was detected as {detected_mime}.")
                object_map[item["id"]] = asset_object
                if not (
                    db.query(AssetObjectLease)
                    .filter(
                        AssetObjectLease.asset_object_id == asset_object.id,
                        AssetObjectLease.holder_type == "import",
                        AssetObjectLease.holder_id == str(import_id),
                    )
                    .first()
                ):
                    db.add(
                        AssetObjectLease(
                            id=uuid.uuid4(),
                            asset_object_id=asset_object.id,
                            holder_type="import",
                            holder_id=str(import_id),
                            expires_at=lease_expires_at,
                        )
                    )
                _report(progress_callback, "scanning", 15 + round(55 * (index + 1) / max(len(objects), 1)), index + 1, len(objects))

            attachment_map: dict[str, uuid.UUID] = {}
            for item in attachments:
                attachment_map[item["id"]] = uuid.uuid4()

            references = _merge_inline_references(parsed.conversation, references, source_attachment_ids)
            _validate_reference_targets(references, message_ids, version_ids)
            canonical_ids = {source_id: str(value) for source_id, value in attachment_map.items()}
            rewritten = _rewrite_conversation_attachment_ids(parsed.conversation, canonical_ids)
            attach_import_draft(record, [rewritten])

            artifact.parsed_summary = {
                "format": "chat-reader-attachment-bundle",
                "version": 1,
                "title": rewritten.display_title,
                "message_count": len(rewritten.messages),
                "attachment_count": len(attachments),
                "object_count": len(objects),
                "total_object_bytes": sum(item["byte_size"] for item in objects),
                "references": [
                    {
                        **item,
                        "attachment_id": canonical_ids[item["attachment_id"]],
                    }
                    for item in references
                ],
                "attachments": [
                    {
                        **item,
                        "id": canonical_ids[item["id"]],
                        "source_id": item["id"],
                        "source_attachment_id": item.get("source_attachment_id") or item["id"],
                        "asset_object_id": (
                            str(object_map[item["asset_object_id"]].id)
                            if item.get("asset_object_id")
                            else None
                        ),
                        "detected_mime_type": (
                            object_map[item["asset_object_id"]].detected_mime_type
                            if item.get("asset_object_id")
                            else item.get("detected_mime_type")
                        ),
                        "scan_status": (
                            object_map[item["asset_object_id"]].scan_status
                            if item.get("asset_object_id")
                            else "not_available"
                        ),
                        "status": "available" if item.get("asset_object_id") else "missing",
                    }
                    for item in attachments
                ],
                "resolved_attachment_count": sum(bool(item.get("asset_object_id")) for item in attachments),
                "missing_attachment_count": sum(not item.get("asset_object_id") for item in attachments),
                "unplaced_attachment_count": len(source_attachment_ids - {item["attachment_id"] for item in references}),
                "occurrence_count": len(references),
            }
            record.source_profile = "chat_reader_bundle_v1"
            record.status = "previewed"
            record.phase = "previewed"
            record.progress = 100
            record.processed_messages = 0
            record.total_messages = len(rewritten.messages)
            record.alignment_status = "exact"
            record.detected_title = rewritten.display_title
            record.warnings = list(dict.fromkeys(warnings))
            record.completed_at = datetime.now(timezone.utc)
            record.heartbeat_at = record.completed_at
            record.error_message = None
            record.draft_summary = {
                **(record.draft_summary or {}),
                "attachment_count": len(attachments),
                "object_count": len(objects),
            }
            db.flush()
            return BundlePreviewResult(
                message_count=len(rewritten.messages),
                attachment_count=len(attachments),
                object_count=len(objects),
                warnings=record.warnings,
            )
    except (zipfile.BadZipFile, OSError, json.JSONDecodeError) as exc:
        for storage_key in created_storage_keys:
            store.delete_key(storage_key)
        raise BundleImportError("Bundle archive is invalid or unreadable.") from exc
    except Exception:
        for storage_key in created_storage_keys:
            store.delete_key(storage_key)
        raise


def _artifact_path(import_id: uuid.UUID, artifact: SourceArtifact) -> Path:
    root = Path(get_settings().import_storage_dir).resolve()
    path = (root / str(import_id) / artifact.safe_filename).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise BundleImportError("Bundle source file is missing.")
    return path


def _validate_archive(archive: zipfile.ZipFile) -> dict[str, zipfile.ZipInfo]:
    settings = get_settings()
    infos = archive.infolist()
    if len(infos) > settings.bundle_max_entries:
        raise BundleImportError("Bundle contains too many ZIP entries.")
    total_expanded = 0
    entries: dict[str, zipfile.ZipInfo] = {}
    for info in infos:
        name = info.filename
        path = PurePosixPath(name)
        if (
            not name
            or "\\" in name
            or path.is_absolute()
            or any(part in {"", ".", ".."} for part in path.parts)
            or len(path.parts) > settings.bundle_max_path_depth
        ):
            raise BundleImportError("Bundle contains an unsafe ZIP path.")
        if name in entries:
            raise BundleImportError("Bundle contains duplicate ZIP paths.")
        mode = (info.external_attr >> 16) & 0xFFFF
        if stat.S_ISLNK(mode):
            raise BundleImportError("Bundle may not contain symbolic links.")
        if info.flag_bits & 0x1:
            raise BundleImportError("Encrypted ZIP entries are not supported.")
        if name.casefold().endswith(".crbundle"):
            raise BundleImportError("Nested archives are not supported in a bundle.")
        total_expanded += info.file_size
        if total_expanded > settings.bundle_max_expanded_bytes:
            raise BundleImportError("Bundle exceeds the expanded size limit.")
        ratio = info.file_size / max(info.compress_size, 1)
        if ratio > settings.bundle_max_compression_ratio:
            raise BundleImportError("Bundle contains a suspicious compression ratio.")
        entries[name] = info
    return entries


def _read_member(
    archive: zipfile.ZipFile,
    entries: dict[str, zipfile.ZipInfo],
    name: str,
    *,
    max_bytes: int,
) -> bytes:
    info = entries.get(name)
    if info is None or info.is_dir():
        raise BundleImportError(f"Bundle member {name!r} is missing.")
    if info.file_size > max_bytes:
        raise BundleImportError(f"Bundle member {name!r} exceeds its size limit.")
    with archive.open(info) as source:
        data = source.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise BundleImportError(f"Bundle member {name!r} exceeds its size limit.")
    return data


def _read_json(
    archive: zipfile.ZipFile,
    entries: dict[str, zipfile.ZipInfo],
    name: str,
    *,
    max_bytes: int,
) -> dict[str, Any]:
    try:
        value = json.loads(_read_member(archive, entries, name, max_bytes=max_bytes))
    except json.JSONDecodeError as exc:
        raise BundleImportError(f"Bundle member {name!r} is not valid JSON.") from exc
    if not isinstance(value, dict):
        raise BundleImportError(f"Bundle member {name!r} must contain an object.")
    return value


def _read_jsonl(
    archive: zipfile.ZipFile,
    entries: dict[str, zipfile.ZipInfo],
    name: str,
) -> list[dict[str, Any]]:
    settings = get_settings()
    raw = _read_member(
        archive,
        entries,
        name,
        max_bytes=min(settings.bundle_max_expanded_bytes, 128 * 1024 * 1024),
    )
    records: list[dict[str, Any]] = []
    for line_number, line in enumerate(raw.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as exc:
            raise BundleImportError(f"attachments.jsonl line {line_number} is invalid JSON.") from exc
        if not isinstance(value, dict):
            raise BundleImportError(f"attachments.jsonl line {line_number} must contain an object.")
        records.append(value)
    return records


def _validate_manifest(manifest: dict[str, Any]) -> None:
    if manifest.get("format") not in {
        "chat-reader-attachment-bundle",
        "chat-reader-standard-bundle",
        "chat-reader-import-bundle",
    } or manifest.get("version") != 1:
        raise BundleImportError("Bundle manifest format or version is unsupported.")


def _normalize_records(
    records: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    objects: list[dict[str, Any]] = []
    attachments: list[dict[str, Any]] = []
    references: list[dict[str, Any]] = []
    seen: dict[str, set[str]] = {"asset_object": set(), "attachment": set()}
    for raw in records:
        record_type = str(raw.get("record_type") or "")
        if record_type == "asset_object":
            source_id = _required_text(raw, "id")
            if source_id in seen[record_type]:
                raise BundleImportError(f"Duplicate asset object id {source_id!r}.")
            seen[record_type].add(source_id)
            sha256 = _required_text(raw, "sha256").casefold()
            if len(sha256) != 64 or any(char not in "0123456789abcdef" for char in sha256):
                raise BundleImportError("Asset object SHA-256 is invalid.")
            byte_size = _required_int(raw, "byte_size")
            objects.append(
                {
                    "id": source_id,
                    "path": _required_text(raw, "path", default=f"assets/objects/{source_id}"),
                    "sha256": sha256,
                    "byte_size": byte_size,
                    "filename": _optional_text(raw.get("filename")),
                    "declared_mime_type": _optional_text(raw.get("mime_type") or raw.get("declared_mime_type")),
                }
            )
        elif record_type == "attachment":
            source_id = _required_text(raw, "id")
            if source_id in seen[record_type]:
                raise BundleImportError(f"Duplicate attachment id {source_id!r}.")
            seen[record_type].add(source_id)
            original_filename = _required_text(raw, "original_filename", default=_required_text(raw, "display_name", default="attachment.bin"))
            attachments.append(
                {
                    "id": source_id,
                    "asset_object_id": _required_text(raw, "asset_object_id"),
                    "original_filename": Path(original_filename).name[:500] or "attachment.bin",
                    "display_name": _required_text(raw, "display_name", default=Path(original_filename).name)[:500],
                    "declared_mime_type": _optional_text(raw.get("declared_mime_type")),
                    "metadata": raw.get("metadata") if isinstance(raw.get("metadata"), dict) else {},
                }
            )
        elif record_type in {"attachment_ref", "attachment_reference"}:
            references.append(
                {
                    "attachment_id": _required_text(raw, "attachment_id"),
                    "message_id": _required_text(raw, "message_id"),
                    "message_version_id": _optional_text(raw.get("message_version_id") or raw.get("version_id")),
                    "relation_type": str(raw.get("relation_type") or "file")[:50],
                    "display_order": int(raw.get("display_order") or 0),
                    "block_index": int(raw["block_index"]) if raw.get("block_index") is not None else None,
                    "display_mode": str(raw.get("display_mode") or "card")[:50],
                    "alt_text": _optional_text(raw.get("alt_text") or raw.get("alt")),
                    "caption": _optional_text(raw.get("caption")),
                }
            )
        elif raw.get("required") is True:
            raise BundleImportError(f"Unsupported required attachment record {record_type!r}.")
    if not objects and any(item.get("asset_object_id") for item in attachments):
        raise BundleImportError("Bundle attachments have no physical objects.")
    return objects, attachments, references


def _normalize_import_bundle_records(
    records: list[dict[str, Any]],
    references: list[dict[str, Any]],
    *,
    asset_root: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    objects_by_hash: dict[tuple[str, int], dict[str, Any]] = {}
    attachments: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    safe_root = PurePosixPath(asset_root)
    if safe_root.is_absolute() or any(part in {"", ".", ".."} for part in safe_root.parts):
        raise BundleImportError("Bundle asset_root is unsafe.")
    for raw in records:
        source_id = _required_text(raw, "id")
        if source_id in seen_ids:
            raise BundleImportError(f"Duplicate attachment id {source_id!r}.")
        seen_ids.add(source_id)
        resolution = str(raw.get("resolution_status") or "resolved")
        resolved = resolution == "resolved"
        sha256 = str(raw.get("sha256") or "").casefold()
        byte_size = _required_int(raw, "byte_size") if resolved else int(raw.get("byte_size") or 0)
        object_id: str | None = None
        if resolved:
            if len(sha256) != 64 or any(char not in "0123456789abcdef" for char in sha256):
                raise BundleImportError(f"Attachment {source_id!r} has an invalid SHA-256.")
            bundle_path = str(raw.get("bundle_path") or f"{asset_root}/{sha256[:2]}/{sha256}")
            path = PurePosixPath(bundle_path)
            if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
                raise BundleImportError("Attachment bundle path is unsafe.")
            if path.parts[: len(safe_root.parts)] != safe_root.parts:
                raise BundleImportError("Attachment object is outside asset_root.")
            object_id = sha256
            objects_by_hash.setdefault(
                (sha256, byte_size),
                {
                    "id": object_id,
                    "path": bundle_path,
                    "sha256": sha256,
                    "byte_size": byte_size,
                    "filename": str(raw.get("original_filename") or "attachment.bin"),
                    "declared_mime_type": _optional_text(raw.get("declared_mime_type")),
                },
            )
        attachments.append(
            {
                "id": source_id,
                "source_attachment_id": str(raw.get("source_attachment_id") or source_id),
                "asset_object_id": object_id,
                "original_filename": Path(str(raw.get("original_filename") or "attachment.bin")).name[:500],
                "display_name": str(raw.get("display_name") or raw.get("original_filename") or "Attachment")[:500],
                "declared_mime_type": _optional_text(raw.get("declared_mime_type")),
                "detected_mime_type": _optional_text(raw.get("detected_mime_type")),
                "resolution_status": resolution,
                "metadata": {
                    "fixture_scan_status": raw.get("scan_status"),
                    "fixture_display_mode": raw.get("display_mode"),
                },
            }
        )
    attachment_ids = {item["id"] for item in attachments}
    for reference in references:
        if reference["attachment_id"] not in attachment_ids:
            raise BundleImportError("Attachment occurrence points to an unknown attachment.")
    return list(objects_by_hash.values()), attachments, references


def _parse_import_bundle_canjson(content: bytes) -> tuple[Any, list[dict[str, Any]]]:
    conversation_record: dict[str, Any] | None = None
    message_records: list[dict[str, Any]] = []
    occurrences: list[dict[str, Any]] = []
    try:
        for line_number, line in enumerate(content.splitlines(), start=1):
            if not line.strip():
                continue
            raw = json.loads(line)
            if not isinstance(raw, dict):
                raise BundleImportError(f"Fixture CanJSON line {line_number} must contain an object.")
            record_type = raw.get("record_type")
            if record_type == "conversation":
                if conversation_record is not None:
                    raise BundleImportError("Fixture CanJSON contains multiple conversation records.")
                conversation_record = raw
            elif record_type == "message":
                message_records.append(raw)
            elif record_type == "attachment_occurrence":
                occurrences.append(raw)
            elif record_type == "attachment":
                continue
            elif raw.get("required") is True:
                raise BundleImportError(f"Unsupported required fixture record {record_type!r}.")
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CanJsonParseError("Fixture CanJSON is not valid UTF-8 JSONL.") from exc
    if conversation_record is None or not message_records:
        raise CanJsonParseError("Fixture CanJSON requires a conversation and messages.")

    messages: list[CanonicalDraftMessage] = []
    version_ids: dict[str, str] = {}
    turn_index = 0
    for index, raw in enumerate(message_records):
        source_id = _required_text(raw, "id")
        role_value = str(raw.get("role") or "unknown").strip().casefold()
        role = "user" if role_value in {"prompt", "user"} else "assistant" if role_value in {"response", "assistant"} else role_value
        if role not in {"user", "assistant", "system", "tool", "developer", "unknown"}:
            role = "unknown"
        if role == "user":
            turn_index += 1
        markdown = str(raw.get("content_markdown") or "").replace("\r\n", "\n").replace("\r", "\n")
        version_id = f"{source_id}:v1"
        version_ids[source_id] = version_id
        created_at = _fixture_datetime(raw.get("time"))
        version = CanonicalDraftVersion(
            source_id=version_id,
            version_number=1,
            display_text=markdown,
            plain_text=normalize_text(markdown),
            content_hash=content_hash(markdown, role),
            created_at=created_at,
        )
        messages.append(
            CanonicalDraftMessage(
                role=role,
                order_key=f"{index + 1:06d}",
                turn_index=turn_index or None,
                created_at=created_at,
                plain_text=version.plain_text,
                display_text=markdown,
                content_hash=version.content_hash,
                source_json_index=index,
                source_markdown_index=None,
                display_source="canjson_fixture",
                alignment_status="exact",
                source_message_id=source_id,
                source_current_version_id=version_id,
                versions=[version],
            )
        )

    message_ids = {item.source_message_id for item in messages}
    normalized_occurrences: list[dict[str, Any]] = []
    occurrence_keys: set[tuple[str, str]] = set()
    for raw in occurrences:
        message_id = _required_text(raw, "message_id")
        if message_id not in message_ids:
            raise BundleImportError("Attachment occurrence points to an unknown message.")
        occurrence_key = _required_text(raw, "occurrence_id")
        identity = (message_id, occurrence_key)
        if identity in occurrence_keys:
            raise BundleImportError("Attachment occurrence keys must be unique within a message version.")
        occurrence_keys.add(identity)
        placement = str(raw.get("placement") or "inline")
        if placement not in {"inline", "after_message"}:
            raise BundleImportError("Attachment occurrence placement is unsupported.")
        normalized_occurrences.append(
            {
                "attachment_id": _required_text(raw, "attachment_id"),
                "message_id": message_id,
                "message_version_id": version_ids[message_id],
                "occurrence_key": occurrence_key,
                "placement": placement,
                "relation_type": str(raw.get("relation_type") or "attachment")[:50],
                "display_order": int(raw.get("display_order") or 0),
                "block_index": None,
                "display_mode": str(raw.get("display_mode") or ("inline" if placement == "inline" else "card"))[:50],
                "alt_text": _optional_text(raw.get("alt")),
                "caption": _optional_text(raw.get("caption")),
            }
        )

    title = str(conversation_record.get("title") or "Attachment import")
    conversation = CanonicalDraftConversation(
        title=title,
        display_title=title,
        source_type="chat_reader_import_bundle",
        source_profile="chat_reader_import_bundle_v1",
        external_source_id=_optional_text(conversation_record.get("id")),
        created_at=messages[0].created_at,
        updated_at=messages[-1].created_at,
        imported_at=datetime.now(timezone.utc).isoformat(),
        message_count=len(messages),
        turn_count=sum(item.role == "user" for item in messages),
        first_user_message=next((item.plain_text for item in messages if item.role == "user"), None),
        parser_version="chat-reader-import-bundle-v1",
        render_version=3,
        warnings=[],
        alignment_status="exact",
        prompt_count=sum(item.role == "user" for item in messages),
        response_count=sum(item.role == "assistant" for item in messages),
        empty_message_count=sum(not item.display_text.strip() for item in messages),
        cleaned_thinking_summary_count=0,
        messages=messages,
    )
    from app.services.import_pipeline.canjson_parser import CanJsonParseResult

    return CanJsonParseResult(conversation=conversation), normalized_occurrences


def _fixture_datetime(value: Any) -> str | None:
    if not value:
        return None
    text = str(value).strip()
    for pattern in ("%Y/%m/%d %H:%M:%S", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(text, pattern).replace(tzinfo=timezone.utc).isoformat()
        except ValueError:
            continue
    return text


def _source_identity_sets(conversation: CanonicalDraftConversation) -> tuple[set[str], dict[str, set[str]]]:
    messages: set[str] = set()
    versions: dict[str, set[str]] = {}
    for message in conversation.messages:
        if not message.source_message_id:
            raise BundleImportError("Bundle CanJSON messages must have stable source ids.")
        messages.add(message.source_message_id)
        versions[message.source_message_id] = {
            version.source_id for version in message.versions if version.source_id
        }
        if message.source_current_version_id:
            versions[message.source_message_id].add(message.source_current_version_id)
    return messages, versions


def _validate_reference_targets(
    references: list[dict[str, Any]],
    message_ids: set[str],
    version_ids: dict[str, set[str]],
) -> None:
    for item in references:
        message_id = item["message_id"]
        if message_id not in message_ids:
            raise BundleImportError("Attachment reference points to an unknown message.")
        version_id = item.get("message_version_id")
        if version_id and version_id not in version_ids.get(message_id, set()):
            raise BundleImportError("Attachment reference points to an unknown message version.")


def _merge_inline_references(
    conversation: CanonicalDraftConversation,
    references: list[dict[str, Any]],
    known_attachment_ids: set[str],
) -> list[dict[str, Any]]:
    result = list(references)
    identities = {
        (item["attachment_id"], item["message_id"], item.get("message_version_id"))
        for item in references
    }
    for message in conversation.messages:
        versions = message.versions or [
            CanonicalDraftVersion(
                source_id=message.source_current_version_id,
                version_number=1,
                display_text=message.display_text,
                plain_text=message.plain_text,
                content_hash=message.content_hash,
            )
        ]
        for version in versions:
            for attachment_id, display_mode, alt in _markdown_asset_references(version.display_text):
                if attachment_id not in known_attachment_ids:
                    raise BundleImportError(f"Markdown references unknown attachment {attachment_id!r}.")
                identity = (attachment_id, message.source_message_id, version.source_id)
                if identity in identities:
                    continue
                identities.add(identity)
                result.append(
                    {
                        "attachment_id": attachment_id,
                        "message_id": message.source_message_id,
                        "message_version_id": version.source_id,
                        "relation_type": "inline" if display_mode == "inline" else "file",
                        "display_order": len(result),
                        "block_index": None,
                        "display_mode": display_mode,
                        "alt_text": alt,
                        "caption": None,
                    }
                )
    return result


def _rewrite_conversation_attachment_ids(
    conversation: CanonicalDraftConversation,
    attachment_ids: dict[str, str],
) -> CanonicalDraftConversation:
    rewritten_messages: list[CanonicalDraftMessage] = []
    for message in conversation.messages:
        rewritten_versions: list[CanonicalDraftVersion] = []
        for version in message.versions:
            display_text = _rewrite_markdown_asset_ids(version.display_text, attachment_ids)
            rewritten_versions.append(
                replace(
                    version,
                    display_text=display_text,
                    plain_text=normalize_text(display_text),
                    content_hash=content_hash(display_text, message.role),
                )
            )
        display_text = _rewrite_markdown_asset_ids(message.display_text, attachment_ids)
        current = next(
            (item for item in rewritten_versions if item.source_id == message.source_current_version_id),
            rewritten_versions[-1] if rewritten_versions else None,
        )
        if current is not None:
            display_text = current.display_text
        rewritten_messages.append(
            replace(
                message,
                display_text=display_text,
                plain_text=normalize_text(display_text),
                content_hash=content_hash(display_text, message.role),
                versions=rewritten_versions,
            )
        )
    return replace(conversation, messages=rewritten_messages)


def _markdown_asset_references(markdown: str) -> list[tuple[str, str, str | None]]:
    result: list[tuple[str, str, str | None]] = []
    fence: str | None = None
    for line in markdown.splitlines():
        stripped = line.strip()
        if stripped.startswith(("```", "~~~")):
            marker = stripped[:3]
            fence = None if fence == marker else marker if fence is None else fence
            continue
        if fence is not None:
            continue
        image_prefix = "!["
        display_mode = "inline" if stripped.startswith(image_prefix) else "card"
        marker = "](cr-asset://"
        if marker not in stripped or not stripped.endswith(")"):
            continue
        label, source_id = stripped.rsplit(marker, 1)
        source_id = source_id[:-1]
        if not source_id:
            continue
        alt = label[2:] if display_mode == "inline" and label.startswith("![") else label[1:] if label.startswith("[") else None
        result.append((source_id, display_mode, alt))
    return result


def _rewrite_markdown_asset_ids(markdown: str, attachment_ids: dict[str, str]) -> str:
    lines: list[str] = []
    fence: str | None = None
    for line in markdown.splitlines(keepends=True):
        stripped = line.strip()
        if stripped.startswith(("```", "~~~")):
            marker = stripped[:3]
            fence = None if fence == marker else marker if fence is None else fence
            lines.append(line)
            continue
        if fence is None:
            for source_id, canonical_id in attachment_ids.items():
                line = line.replace(f"cr-asset://{source_id})", f"cr-asset://{canonical_id})")
        lines.append(line)
    return "".join(lines)


def _required_text(raw: dict[str, Any], key: str, default: str | None = None) -> str:
    value = raw.get(key, default)
    if not isinstance(value, str) or not value.strip():
        raise BundleImportError(f"Attachment record requires {key}.")
    return value.strip()


def _optional_text(value: Any) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized[:4096] if normalized else None


def _required_int(raw: dict[str, Any], key: str) -> int:
    value = raw.get(key)
    if isinstance(value, bool):
        raise BundleImportError(f"Attachment record requires integer {key}.")
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise BundleImportError(f"Attachment record requires integer {key}.") from exc
    if parsed < 0:
        raise BundleImportError(f"Attachment record {key} may not be negative.")
    return parsed


def _report(callback: ProgressCallback | None, phase: str, progress: int, processed: int, total: int) -> None:
    if callback is not None:
        callback(phase, progress, processed, total)
