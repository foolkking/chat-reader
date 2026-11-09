from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import stat
import tempfile
import uuid
import zipfile
from contextlib import contextmanager
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import unquote, urlsplit

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.import_record import ImportRecord
from app.models.source_artifact import SourceArtifact
from app.schemas.import_schema import SourceProfile
from app.services.adaptive_import.contracts import AdaptiveImportError
from app.services.storage.local_storage import save_import_file, save_import_file_stream


CATALOG_VERSION = 1
MAX_CATALOG_BYTES = 8 * 1024 * 1024
MAX_CATALOG_LINKS = 32768
ARCHIVE_SOURCE_TYPE = "adaptive_archive"
ARCHIVE_DOCUMENT_SOURCE_TYPE = "adaptive_archive_document"
_MARKDOWN_EXTENSIONS = {".md", ".markdown"}
_REFERENCE_RE = re.compile(
    r"""(?P<prefix>!?\[[^\]\r\n]*\]\(\s*|^\s*\[[^\]\r\n]+\]:\s*|(?:src|href)\s*=\s*["'])
        (?P<target>[^"'\s)>]+)
        (?P<suffix>\s*(?:["'][^"']*["'])?\s*\)|(?:\s+["'(].*)?$|["'])""",
    re.IGNORECASE | re.MULTILINE | re.VERBOSE,
)
_ROLE_HEADING_RE = re.compile(
    r"^ {0,3}#{2}[ \t]+(?:[*_]{0,3})?(?:我|用户|user|human|chatgpt|assistant|助手)(?:[*_]{0,3})?(?:\s|$)",
    re.IGNORECASE,
)


def prepare_archive_sources(db: Session, record: ImportRecord) -> list[Path]:
    """Inspect newly staged ZIPs and materialize their selected Markdown members.

    The returned paths belong to superseded derived sources. Callers that
    replace/reclassify an already analyzed archive remove them only after the
    database transaction commits.
    """

    stale_paths: list[Path] = []
    for artifact in list(record.artifacts):
        if artifact.source_type != ARCHIVE_SOURCE_TYPE:
            continue
        summary = artifact.parsed_summary or {}
        if summary.get("archive_catalog_version") == CATALOG_VERSION:
            continue
        catalog = inspect_archive(record, artifact)
        _require_importable_catalog(catalog)
        stale_paths.extend(_replace_materialized_documents(db, record, artifact, catalog))
        _write_catalog(record.id, artifact.id, catalog)
        artifact.parsed_summary = _artifact_summary(catalog)
    db.flush()
    db.expire(record, ["artifacts"])
    return stale_paths


def inspect_archive(record: ImportRecord, artifact: SourceArtifact) -> dict[str, Any]:
    archive_path = _artifact_path(record, artifact)
    settings = get_settings()
    from app.services.adaptive_import.memory_budget import streaming_budget, preflight_directory
    if streaming_budget():
        with archive_path.open("rb") as source:
            preflight_directory(source)
    try:
        archive = zipfile.ZipFile(archive_path, "r")
    except (OSError, zipfile.BadZipFile) as exc:
        raise AdaptiveImportError("ZIP_INVALID", "The ZIP file is damaged or unsupported.", layer="archive") from exc

    with archive:
        infos, wrapper = _validated_members(archive)
        effective = {
            _effective_path(info.filename, wrapper): info
            for info in infos
            if not info.is_dir()
        }
        lowered = {path.casefold(): path for path in effective}
        primary_path = lowered.get("conversation.md")
        manifest_path = lowered.get("manifest.json")
        manifest = _read_manifest(archive, effective[manifest_path]) if primary_path and manifest_path else None
        dedicated = bool(primary_path and manifest_path and _is_exporter_manifest(manifest))
        archive_kind = "conversation_export" if dedicated else "markdown_zip"

        manifest_assets: dict[str, dict[str, Any]] = {}
        invalid_manifest_asset_paths: list[str] = []
        manifest_messages = 0
        if manifest:
            raw_messages = manifest.get("messages")
            manifest_messages = int(manifest.get("message_count", len(raw_messages) if isinstance(raw_messages, list) else 0))
            for item in manifest.get("assets") or []:
                if not isinstance(item, dict) or not isinstance(item.get("path"), str):
                    continue
                normalized = _effective_reference_path(item["path"], wrapper)
                if normalized:
                    manifest_assets[normalized] = item
                else:
                    invalid_manifest_asset_paths.append(str(item["path"])[:240])

        members: list[dict[str, Any]] = []
        by_path: dict[str, dict[str, Any]] = {}
        for path, info in sorted(effective.items()):
            extension = Path(path).suffix.casefold()
            member_id = str(uuid.uuid5(artifact.id, path))
            metadata = manifest_assets.get(path)
            member = {
                "member_id": member_id,
                "path": path,
                "zip_path": info.filename,
                "extension": extension,
                "byte_size": info.file_size,
                "compressed_size": info.compress_size,
                "crc": info.CRC,
                "kind": "markdown" if extension in _MARKDOWN_EXTENSIONS else "file",
                "use": "excluded",
                "owner_document_ids": [],
                "referenced_by": [],
                "reference_count": 0,
                "manifest_kind": str(metadata.get("kind"))[:80] if metadata and metadata.get("kind") else None,
                "width": _positive_int(metadata.get("width")) if metadata else None,
                "height": _positive_int(metadata.get("height")) if metadata else None,
            }
            members.append(member)
            by_path[path] = member

        documents = [member for member in members if member["kind"] == "markdown"]
        if not documents:
            raise AdaptiveImportError(
                "ZIP_MARKDOWN_REQUIRED",
                "The ZIP does not contain a Markdown document to import.",
                layer="archive",
            )

        if dedicated:
            for member in members:
                if member["path"] == primary_path:
                    member["use"] = "conversation"
                elif member["path"].casefold() == "manifest.json":
                    member["use"] = "excluded"
                elif member["path"] in manifest_assets:
                    member["use"] = "attachment"
                    member["owner_document_ids"] = [by_path[primary_path]["member_id"]]
            documents = [by_path[primary_path]]
        else:
            for member in documents:
                member["use"] = "conversation"

        missing_references: set[str] = set()
        missing_manifest_assets = sorted(path for path in manifest_assets if path not in by_path)

        def missing_member(path: str) -> dict[str, Any]:
            if path in by_path:
                return by_path[path]
            if len(members) >= settings.bundle_max_entries:
                raise AdaptiveImportError("ZIP_METADATA_LIMIT", "The ZIP resource index exceeds its bounded limit.", layer="archive")
            member = {
                "member_id": str(uuid.uuid5(artifact.id, path)),
                "path": path, "zip_path": None, "extension": Path(path).suffix.casefold(),
                "byte_size": None, "compressed_size": None, "crc": None,
                "kind": "file", "availability": "missing", "use": "attachment",
                "owner_document_ids": [], "referenced_by": [], "reference_count": 0,
                # Manifest geometry is not evidence of a decoded original.
                "width": None, "height": None, "manifest_kind": None,
            }
            members.append(member)
            by_path[path] = member
            return member

        if dedicated:
            for path in missing_manifest_assets:
                missing_member(path)["owner_document_ids"] = [by_path[primary_path]["member_id"]]
        catalog_links = 0
        visible_messages = 0

        def register_references(text: str, document: dict[str, Any]) -> None:
            nonlocal catalog_links
            references, missing = _document_references(text, document["path"], set(by_path))
            for path in missing:
                missing_member(path)
            for reference in references | missing:
                target = by_path[reference]
                if target.get("availability") == "missing":
                    missing_references.add(reference)
                target["reference_count"] += 1
                if document["member_id"] not in target["referenced_by"]:
                    catalog_links += 1
                    if catalog_links > MAX_CATALOG_LINKS:
                        raise AdaptiveImportError("ZIP_METADATA_LIMIT", "The ZIP ownership index exceeds its bounded limit.", layer="archive")
                    target["referenced_by"].append(document["member_id"])
                if target["use"] == "excluded" and target["kind"] != "markdown":
                    target["use"] = "attachment"
                if target["use"] == "attachment" and document["member_id"] not in target["owner_document_ids"]:
                    target["owner_document_ids"].append(document["member_id"])

        for document in documents:
            _small_import_checkpoint()
            if streaming_budget():
                from app.services.adaptive_import.stream_markdown import resource_chunks
                with _disk_member(record, archive, effective[document["path"]]) as text_path:
                    for text in resource_chunks(text_path):
                        if dedicated and document["path"] == primary_path:
                            visible_messages += _visible_role_heading_count(text)
                        register_references(text, document)
                continue
            raw = _read_member_bytes(archive, effective[document["path"]], settings.bundle_max_object_bytes)
            try:
                text = raw.decode("utf-8-sig")
            except UnicodeDecodeError as exc:
                raise AdaptiveImportError(
                    "MARKDOWN_ENCODING_INVALID",
                    "Markdown members in a ZIP must use UTF-8.",
                    layer="archive",
                    pointer=document["member_id"],
                ) from exc
            if dedicated and document["path"] == primary_path:
                visible_messages = _visible_role_heading_count(text)
            register_references(text, document)

        issues: list[dict[str, Any]] = []
        if dedicated and manifest_messages:
            if visible_messages and visible_messages != manifest_messages:
                issues.append({
                    "code": "MANIFEST_MESSAGE_COUNT_MISMATCH",
                    "severity": "warning",
                    "message": (
                        f"The manifest lists {manifest_messages} message references, while the Markdown "
                        f"contains {visible_messages} visible message boundaries. Markdown boundaries will be used."
                    ),
                })
        if missing_manifest_assets:
            issues.append({
                "code": "MANIFEST_ASSET_MISSING",
                "severity": "warning",
                "message": f"The manifest references {len(missing_manifest_assets)} missing archive resources.",
            })
        if invalid_manifest_asset_paths:
            issues.append({
                "code": "MANIFEST_ASSET_PATH_INVALID",
                "severity": "error",
                "message": f"The manifest contains {len(invalid_manifest_asset_paths)} unsafe asset paths.",
            })
        if missing_references:
            issues.append({
                "code": "MARKDOWN_RESOURCE_MISSING",
                "severity": "warning",
                "message": f"Markdown references {len(missing_references)} missing relative resources.",
            })

        catalog = {
            "version": CATALOG_VERSION,
            "source_sha256": getattr(artifact, "sha256", None),
            "artifact_id": str(artifact.id),
            "archive_kind": archive_kind,
            "wrapper_prefix": wrapper,
            "classification_version": int((getattr(artifact, "parsed_summary", None) or {}).get("classification_version") or 0) + 1,
            "materialization_token": uuid.uuid4().hex,
            "members": members,
            "issues": issues,
            "manifest_message_count": manifest_messages,
        }
        _refresh_catalog_summary(catalog)
        from app.services.adaptive_import.memory_budget import validate_catalog_budget
        validate_catalog_budget(catalog)
        return catalog


def archive_catalog(record: ImportRecord, artifact_id: uuid.UUID) -> dict[str, Any]:
    artifact = next(
        (item for item in record.artifacts if item.id == artifact_id and item.source_type == ARCHIVE_SOURCE_TYPE),
        None,
    )
    if artifact is None:
        raise AdaptiveImportError("ARCHIVE_NOT_FOUND", "The ZIP source was not found.", layer="archive")
    return _read_catalog(record.id, artifact.id, (artifact.parsed_summary or {}).get("catalog_file"))


def restore_archive_catalog(import_id: uuid.UUID, artifact_id: uuid.UUID, catalog: dict[str, Any]) -> None:
    """Restore the last known catalog after a database-side failure.

    The catalog is a derived preview, not canonical data.  Keeping the old
    snapshot on disk when a classification transaction rolls back prevents a
    later preview request from presenting choices that the database did not
    accept.
    """

    _write_catalog(import_id, artifact_id, catalog)


def update_archive_classification(
    db: Session,
    record: ImportRecord,
    artifact: SourceArtifact,
    *,
    expected_version: int,
    changes: list[dict[str, Any]],
) -> list[Path]:
    catalog = archive_catalog(record, artifact.id)
    if int(catalog.get("classification_version") or 0) != expected_version:
        raise AdaptiveImportError(
            "ARCHIVE_CLASSIFICATION_STALE",
            "The ZIP preview changed. Refresh it before saving classifications.",
            layer="archive",
        )
    members = {str(item.get("member_id")): item for item in catalog.get("members") or [] if isinstance(item, dict)}
    for change in changes:
        member = members.get(str(change.get("member_id") or ""))
        if member is None:
            raise AdaptiveImportError("ARCHIVE_MEMBER_NOT_FOUND", "A ZIP member is no longer available.", layer="archive")
        use = str(change.get("use") or "")
        if use not in {"conversation", "attachment", "excluded"}:
            raise AdaptiveImportError("ARCHIVE_CLASSIFICATION_INVALID", "ZIP member classification is invalid.", layer="archive")
        if use == "conversation" and member.get("kind") != "markdown":
            raise AdaptiveImportError("ARCHIVE_CONVERSATION_NOT_MARKDOWN", "Only Markdown can be imported as a conversation.", layer="archive")
        owners = [str(value) for value in change.get("owner_document_ids") or []]
        if len(owners) != len(set(owners)) or any(
            owner not in members or members[owner].get("kind") != "markdown"
            for owner in owners
        ):
            raise AdaptiveImportError("ARCHIVE_ATTACHMENT_OWNER_INVALID", "An attachment owner is invalid.", layer="archive")
        member["use"] = use
        member["owner_document_ids"] = owners if use == "attachment" else []

    conversations = {member_id for member_id, member in members.items() if member.get("use") == "conversation"}
    from app.services.adaptive_import.memory_budget import streaming_budget
    if streaming_budget() and sum(len(member.get("owner_document_ids") or []) for member in members.values()) > MAX_CATALOG_LINKS:
        raise AdaptiveImportError("ZIP_METADATA_LIMIT", "The ZIP ownership index exceeds its bounded limit.", layer="archive")
    if not conversations:
        raise AdaptiveImportError("ARCHIVE_CONVERSATION_REQUIRED", "Keep at least one Markdown conversation.", layer="archive")
    for member in members.values():
        if member.get("use") != "attachment":
            continue
        owners = [owner for owner in member.get("owner_document_ids") or [] if owner in conversations]
        if not owners:
            raise AdaptiveImportError(
                "ARCHIVE_ATTACHMENT_OWNER_REQUIRED",
                "Every included attachment must belong to at least one imported Markdown conversation.",
                layer="archive",
                pointer=str(member.get("member_id") or ""),
            )
        member["owner_document_ids"] = owners

    catalog["classification_version"] = expected_version + 1
    catalog["materialization_token"] = uuid.uuid4().hex
    _refresh_catalog_summary(catalog)
    _require_importable_catalog(catalog)
    stale_paths = _replace_materialized_documents(db, record, artifact, catalog)
    _write_catalog(record.id, artifact.id, catalog)
    artifact.parsed_summary = _artifact_summary(catalog)
    db.flush()
    db.expire(record, ["artifacts"])
    return stale_paths


def archive_enrichment_for_artifact(
    record: ImportRecord,
    artifact: SourceArtifact,
) -> list[dict[str, Any]]:
    summary = artifact.parsed_summary or {}
    archive_id = summary.get("archive_artifact_id")
    member_id = summary.get("archive_member_id")
    if not archive_id or not member_id:
        return []
    catalog = archive_catalog(record, uuid.UUID(str(archive_id)))
    owned = [
        member for member in catalog.get("members") or []
        if isinstance(member, dict)
        and member.get("use") == "attachment"
        and str(member_id) in (member.get("owner_document_ids") or [])
    ]
    attachments: list[dict[str, Any]] = []
    for member in owned:
        source_id = str(member["member_id"])
        metadata = {
            "archive_artifact_id": str(archive_id),
            "archive_member_id": source_id,
            "archive_path": member["path"],
            "archive_classification_version": catalog["classification_version"],
            **({"width": member["width"]} if member.get("width") else {}),
            **({"height": member["height"]} if member.get("height") else {}),
            **({"manifest_kind": member["manifest_kind"]} if member.get("manifest_kind") else {}),
        }
        attachments.append({
            "record_type": "attachment",
            "id": source_id,
            "original_filename": Path(str(member["path"])).name,
            "display_name": Path(str(member["path"])).name,
            "declared_mime_type": None,
            "detected_mime_type": None,
            "metadata": metadata,
        })
    # Real block occurrences are constructed once by the caller. Do not scan
    # every message again for every attachment or fabricate a last-message ref
    # for manifest-only resources.
    return attachments


def archive_missing_member(record: ImportRecord, attachment: dict[str, Any], verified: set[str] | None = None) -> bool:
    """Only an owned server catalog can authorize a fileless attachment.

    Never use an imported metadata flag as evidence, or catch a failed read as
    'missing'. Verify the immutable source once per commit/conversation.
    """
    metadata = attachment.get("metadata") or {}
    try:
        archive_id = uuid.UUID(str(metadata["archive_artifact_id"]))
        member_id = str(metadata["archive_member_id"])
    except (KeyError, TypeError, ValueError) as exc:
        raise AdaptiveImportError("ARCHIVE_MEMBER_NOT_FOUND", "Invalid ZIP resource identity.", layer="archive") from exc
    catalog = archive_catalog(record, archive_id)
    revision = metadata.get("archive_classification_version")
    if revision is not None and revision != catalog["classification_version"]:
        raise AdaptiveImportError("ARCHIVE_CLASSIFICATION_STALE", "The ZIP classification changed.", layer="archive")
    member = next((item for item in catalog["members"] if item["member_id"] == member_id), None)
    if member is None or member.get("use") != "attachment":
        raise AdaptiveImportError("ARCHIVE_MEMBER_NOT_FOUND", "The ZIP resource is unavailable.", layer="archive")
    if member.get("availability") != "missing":
        return False
    artifact = next(item for item in record.artifacts if item.id == archive_id and item.source_type == ARCHIVE_SOURCE_TYPE)
    key = f"{archive_id}:{catalog['classification_version']}"
    if verified is None or key not in verified:
        from app.services.adaptive_import.bounded_io import file_hash
        digest = file_hash(_artifact_path(record, artifact))
        if not catalog.get("source_sha256") or digest != artifact.sha256 or digest != catalog["source_sha256"]:
            raise AdaptiveImportError("ZIP_INVALID", "The retained ZIP source changed.", layer="archive")
        with zipfile.ZipFile(_artifact_path(record, artifact)) as archive:
            infos, wrapper = _validated_members(archive)
            present = {_effective_path(info.filename, wrapper) for info in infos}
            if any(item.get("availability") == "missing" and item["path"] in present for item in catalog["members"]):
                raise AdaptiveImportError("ZIP_INVALID", "The ZIP resource index changed.", layer="archive")
        if verified is not None:
            verified.add(key)
    return True


def archive_member_stream(record: ImportRecord, attachment: dict[str, Any]):
    metadata = attachment.get("metadata") if isinstance(attachment.get("metadata"), dict) else {}
    try:
        archive_id = uuid.UUID(str(metadata["archive_artifact_id"]))
        member_id = str(metadata["archive_member_id"])
    except (KeyError, TypeError, ValueError) as exc:
        raise AdaptiveImportError(
            "ARCHIVE_MEMBER_NOT_FOUND",
            "The ZIP attachment reference is invalid.",
            layer="archive",
        ) from exc
    archive_artifact = next(
        (item for item in record.artifacts if item.id == archive_id and item.source_type == ARCHIVE_SOURCE_TYPE),
        None,
    )
    if archive_artifact is None:
        raise AdaptiveImportError("ARCHIVE_NOT_FOUND", "The ZIP source is unavailable.", layer="archive")
    catalog = archive_catalog(record, archive_id)
    member = next(
        (item for item in catalog.get("members") or [] if isinstance(item, dict) and item.get("member_id") == member_id),
        None,
    )
    if member is None or member.get("use") != "attachment":
        raise AdaptiveImportError("ARCHIVE_MEMBER_NOT_FOUND", "The ZIP attachment is unavailable.", layer="archive")
    zip_path = member.get("zip_path")
    if not isinstance(zip_path, str) or not zip_path:
        raise AdaptiveImportError("ARCHIVE_MEMBER_NOT_FOUND", "The ZIP attachment is unavailable.", layer="archive")
    try:
        archive = zipfile.ZipFile(_artifact_path(record, archive_artifact), "r")
    except (OSError, zipfile.BadZipFile) as exc:
        raise AdaptiveImportError("ZIP_INVALID", "The ZIP file is damaged or unavailable.", layer="archive") from exc
    try:
        source = archive.open(zip_path, "r")
    except (KeyError, OSError, RuntimeError, zipfile.BadZipFile) as exc:
        archive.close()
        raise AdaptiveImportError("ARCHIVE_MEMBER_NOT_FOUND", "The ZIP attachment is unavailable.", layer="archive") from exc
    from app.services.adaptive_import.memory_budget import BudgetedArchiveStream, current_budget
    if current_budget() is not None:
        source = BudgetedArchiveStream(source, archive.fp)
    return archive, source, member


def remove_archive_sidecar(import_id: uuid.UUID, artifact_id: uuid.UUID) -> None:
    _catalog_path(import_id, artifact_id).unlink(missing_ok=True)


@contextmanager
def archive_file_recovery(record: ImportRecord):
    """Restore overwritten derived files if a ZIP mutation/DB commit fails.

    The caller holds the ImportRecord row lock until this context has restored
    files, then rolls the DB transaction back. Source files are never removed;
    only files newly created by this serialized mutation are cleaned up.
    """
    root = _session_root(record.id)
    before = {path for path in root.iterdir() if path.is_file()}
    from app.services.adaptive_import.memory_budget import streaming_budget
    # V2 publication uses fresh filenames. Backing up a possibly very large
    # legacy conversation file here would defeat the disk-backed lane.
    overwritten = [] if streaming_budget() else [
        root / "canonical-draft.jsonl",
        *[_catalog_path(record.id, artifact.id) for artifact in record.artifacts
          if artifact.source_type == ARCHIVE_SOURCE_TYPE],
    ]
    with tempfile.TemporaryDirectory(prefix="adaptive-zip-recovery-") as temporary:
        backups: list[tuple[Path, Path]] = []
        for index, path in enumerate(overwritten):
            if path.is_symlink() or path.resolve().parent != root:
                raise AdaptiveImportError("SOURCE_PATH_INVALID", "The import session storage path is invalid.", layer="file")
            if path.is_file():
                backup = Path(temporary) / str(index)
                shutil.copyfile(path, backup)
                backups.append((path, backup))
        try:
            yield
        except Exception:
            for path, backup in backups:
                shutil.copyfile(backup, path)
            for path in root.iterdir():
                if path not in before and not path.is_symlink() and path.is_file() and path.resolve().parent == root:
                    path.unlink(missing_ok=True)
            raise


def _replace_materialized_documents(
    db: Session,
    record: ImportRecord,
    archive_artifact: SourceArtifact,
    catalog: dict[str, Any],
) -> list[Path]:
    from app.services.adaptive_import.memory_budget import validate_catalog_budget
    validate_catalog_budget(catalog)
    old = [
        artifact for artifact in record.artifacts
        if artifact.source_type == ARCHIVE_DOCUMENT_SOURCE_TYPE
        and str((artifact.parsed_summary or {}).get("archive_artifact_id")) == str(archive_artifact.id)
    ]
    old_paths = [_artifact_path(record, artifact) for artifact in old]
    created_paths: list[Path] = []
    created: list[SourceArtifact] = []
    try:
        with zipfile.ZipFile(_artifact_path(record, archive_artifact), "r") as archive:
            members = {
                str(item["member_id"]): item
                for item in catalog.get("members") or []
                if isinstance(item, dict)
            }
            importable = [item for item in members.values() if item.get("use") == "conversation"]
            materialization_token = str(
                catalog.get("materialization_token")
                or f"v{catalog.get('classification_version', 1)}"
            )[:12]
            for member in importable:
                _small_import_checkpoint()
                filename = (
                        f"{archive_artifact.id.hex[:8]}-"
                        f"{str(member['member_id'])[:8]}-"
                        f"{materialization_token}-"
                        f"{Path(str(member['path'])).name}"
                )
                from app.services.adaptive_import.memory_budget import streaming_budget
                if streaming_budget():
                    from app.services.adaptive_import.stream_markdown import resource_chunks
                    with _disk_member(record, archive, archive.getinfo(str(member["zip_path"]))) as text_path:
                        chunks = (_rewrite_document_references(text, str(member["path"]), members).encode("utf-8")
                                  for text in resource_chunks(text_path))
                        stored, digest = save_import_file_stream(
                            record.id, filename, _ChunkReader(chunks),
                            max_bytes=get_settings().bundle_max_expanded_bytes, chunk_size=64 * 1024,
                        )
                else:
                    raw = _read_member_bytes(archive, archive.getinfo(str(member["zip_path"])), get_settings().bundle_max_object_bytes)
                    rewritten = _rewrite_document_references(raw.decode("utf-8-sig"), str(member["path"]), members).encode("utf-8")
                    stored = save_import_file(record.id, filename, rewritten)
                    digest = hashlib.sha256(rewritten).hexdigest()
                path = _session_root(record.id) / stored.safe_filename
                created_paths.append(path)
                derived = SourceArtifact(
                    id=uuid.uuid4(),
                    import_id=record.id,
                    source_type=ARCHIVE_DOCUMENT_SOURCE_TYPE,
                    source_profile=SourceProfile.unknown.value,
                    filename=str(member["path"]),
                    safe_filename=stored.safe_filename,
                    sha256=digest,
                    byte_size=stored.byte_size,
                    mime_guess="text/markdown",
                    file_extension=Path(str(member["path"])).suffix.casefold(),
                    raw_storage_uri=stored.raw_storage_uri,
                    parsed_summary={
                        "archive_artifact_id": str(archive_artifact.id),
                        "archive_member_id": str(member["member_id"]),
                        "archive_kind": catalog["archive_kind"],
                    },
                )
                db.add(derived)
                created.append(derived)
            db.flush()
        for artifact in old:
            db.delete(artifact)
        db.flush()
        return old_paths
    except Exception:
        for path in created_paths:
            path.unlink(missing_ok=True)
        for artifact in created:
            try:
                db.expunge(artifact)
            except Exception:
                pass
        raise


def _rewrite_document_references(
    text: str,
    document_path: str,
    members: dict[str, dict[str, Any]],
) -> str:
    by_path = {str(item["path"]): item for item in members.values()}
    member_paths = set(by_path)
    output: list[str] = []
    cursor = 0
    document = by_path.get(document_path)
    document_id = str(document["member_id"]) if document else None
    for match in archive_reference_matches(text):
        resolved = _resolve_reference(document_path, match.group("target"), member_paths)
        member = by_path.get(resolved or "")
        if member is None:
            continue
        output.append(text[cursor:match.start("target")])
        # An attachment assigned to another document is not available here.
        # Do not leave an unresolved cr-asset identity in this conversation.
        included = member.get("use") == "attachment" and document_id in (member.get("owner_document_ids") or [])
        scheme = "cr-asset" if included else "cr-archive-member"
        output.append(f"{scheme}://{member['member_id']}")
        cursor = match.end("target")
    output.append(text[cursor:])
    return "".join(output)


def _document_references(
    text: str,
    document_path: str,
    member_paths: set[str],
) -> tuple[set[str], set[str]]:
    result: set[str] = set()
    missing: set[str] = set()
    for match in archive_reference_matches(text):
        candidate = _reference_candidate(document_path, match.group("target"))
        if candidate in member_paths:
            result.add(candidate)
        elif candidate:
            missing.add(candidate)
    return result, missing


def archive_reference_matches(text: str):
    """Yield source matches without interpreting code examples as resources.

    The same source offsets drive inspection, rewriting and occurrence
    creation. This is a bounded resource scanner, not a Markdown renderer.
    """
    # Store excluded intervals, not an object per input character or multiple
    # full masked copies of a potentially large Markdown member.
    hidden: list[tuple[int, int]] = []

    def hide_line(start: int, end: int) -> None:
        if hidden and hidden[-1][1] == start:
            hidden[-1] = (hidden[-1][0], end)
        else:
            hidden.append((start, end))

    fence: tuple[str, int, int] | None = None
    for line_match in re.finditer(r"[^\n]+(?:\n|$)|\n", text):
        line = line_match.group(0)
        prefix = re.match(r"^(?: {0,3}>[ \t]?)*", line).group(0)
        quote_depth = prefix.count(">")
        body = line[len(prefix):]
        body = re.sub(r"^ {0,3}(?:[-+*]|\d+[.)])[ \t]+", "", body)
        stripped = body.lstrip()
        marker = re.match(r"(`{3,}|~{3,})(.*)", stripped)
        if fence and quote_depth < fence[2]:
            fence = None
        if fence:
            hide_line(*line_match.span())
            if marker and marker[1][0] == fence[0] and len(marker[1]) >= fence[1] and not marker[2].strip():
                fence = None
        elif marker:
            fence = (marker[1][0], len(marker[1]), quote_depth)
            hide_line(*line_match.span())
        elif body.startswith(("    ", "\t")):
            hide_line(*line_match.span())
    hidden = _merge_source_ranges(hidden)
    html_code_tag = re.compile(r"<(/?)(code|pre)\b[^<>]*>", re.IGNORECASE)
    html_hidden: list[tuple[int, int]] = []
    for start, end in _visible_source_ranges(len(text), hidden):
        openings: dict[str, int] = {}
        for match in html_code_tag.finditer(text, start, end):
            tag = match[2].casefold()
            if match[1]:
                opening = openings.pop(tag, None)
                if opening is not None:
                    html_hidden.append((opening, match.end()))
            elif not match.group(0).endswith("/>"):
                openings.setdefault(tag, match.start())
    hidden = _merge_source_ranges([*hidden, *html_hidden])
    inline_hidden: list[tuple[int, int]] = []
    backticks = re.compile(r"`+")

    def hide_inline(start: int, end: int) -> None:
        # Only the last position per run length is needed to tell whether an
        # opener has a closer. Two linear scans avoid both quadratic searches
        # and retaining a match object for every backtick in the document.
        last_run = {
            run.end() - run.start(): run.start()
            for run in backticks.finditer(text, start, end)
        }
        opening: tuple[int, int] | None = None
        for run in backticks.finditer(text, start, end):
            length = run.end() - run.start()
            if opening is None:
                if last_run[length] > run.start():
                    opening = (run.start(), length)
            elif length == opening[1]:
                inline_hidden.append((opening[0], run.end()))
                opening = None

    paragraph_break = re.compile(r"\n[ \t\r]*\n")
    for start, end in _visible_source_ranges(len(text), hidden):
        cursor = start
        for boundary in paragraph_break.finditer(text, start, end):
            hide_inline(cursor, boundary.start())
            cursor = boundary.end()
        hide_inline(cursor, end)
    hidden = _merge_source_ranges([*hidden, *inline_hidden])
    index = 0
    matched_count = 0
    for match in _REFERENCE_RE.finditer(text):
        start, end = match.span("target")
        while index < len(hidden) and hidden[index][1] <= start:
            index += 1
        if index < len(hidden) and hidden[index][0] < end:
            continue
        matched_count += 1
        from app.services.adaptive_import.memory_budget import MAX_REFERENCES, enforce_limit
        enforce_limit(matched_count, MAX_REFERENCES)
        yield match


def _merge_source_ranges(ranges: list[tuple[int, int]]) -> list[tuple[int, int]]:
    merged: list[tuple[int, int]] = []
    for start, end in sorted(ranges):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(end, merged[-1][1]))
        else:
            merged.append((start, end))
    return merged


def _visible_source_ranges(length: int, hidden: list[tuple[int, int]]):
    cursor = 0
    for start, end in hidden:
        if cursor < start:
            yield cursor, start
        cursor = end
    if cursor < length:
        yield cursor, length


def _resolve_reference(document_path: str, raw_target: str, member_paths: set[str]) -> str | None:
    normalized = _reference_candidate(document_path, raw_target)
    return normalized if normalized in member_paths else None


def _reference_candidate(document_path: str, raw_target: str) -> str | None:
    try:
        split = urlsplit(raw_target)
    except ValueError:
        return None
    if split.scheme or split.netloc or raw_target.startswith(("#", "/", "\\")):
        return None
    decoded = split.path
    # Missing-member identities must pass the same portability boundary as
    # real members. Decoding must not turn an absent relative asset into an
    # absolute/drive/NUL path that could later be mistaken for a readable file.
    for _ in range(3):
        if decoded.startswith("/") or any(char in decoded for char in ("\\", ":", "\x00")):
            raise AdaptiveImportError("ZIP_PATH_UNSAFE", "A ZIP resource reference uses an unsafe path.", layer="archive")
        unquoted = unquote(decoded)
        if unquoted == decoded:
            break
        decoded = unquoted
    else:
        raise AdaptiveImportError("ZIP_PATH_UNSAFE", "A ZIP resource reference has excessive path encoding.", layer="archive")
    if not decoded:
        return None
    base = PurePosixPath(document_path).parent
    candidate = base.joinpath(decoded)
    parts: list[str] = []
    for part in candidate.parts:
        if part in {"", "."}:
            continue
        if part == "..":
            if not parts:
                raise AdaptiveImportError("ZIP_PATH_UNSAFE", "A ZIP resource reference escapes its archive.", layer="archive")
            parts.pop()
        else:
            parts.append(part)
    return PurePosixPath(*parts).as_posix()


def _validated_members(archive: zipfile.ZipFile) -> tuple[list[zipfile.ZipInfo], str | None]:
    settings = get_settings()
    infos = archive.infolist()
    if len(infos) > settings.bundle_max_entries:
        raise AdaptiveImportError("ZIP_ENTRY_LIMIT", "The ZIP contains too many entries.", layer="archive")
    expanded = 0
    names: set[str] = set()
    files: list[zipfile.ZipInfo] = []
    for member_index, info in enumerate(infos):
        if member_index % 16 == 0:
            _small_import_checkpoint()
        path = PurePosixPath(info.filename)
        if (
            not info.filename
            or info.orig_filename != info.filename
            or path.is_absolute()
            or ".." in path.parts
            or "\\" in info.filename
            or ":" in info.filename
            or "\x00" in info.filename
            or path.as_posix() != info.filename.rstrip("/")
        ):
            raise AdaptiveImportError("ZIP_PATH_UNSAFE", "The ZIP contains an unsafe path.", layer="archive")
        normalized = path.as_posix()
        if normalized in names:
            raise AdaptiveImportError("ZIP_PATH_DUPLICATE", "The ZIP contains duplicate normalized paths.", layer="archive")
        names.add(normalized)
        mode = stat.S_IFMT(info.external_attr >> 16)
        if info.flag_bits & 1 or mode not in {0, stat.S_IFREG, stat.S_IFDIR}:
            raise AdaptiveImportError("ZIP_MEMBER_UNSUPPORTED", "The ZIP contains an encrypted or linked member.", layer="archive")
        if info.file_size > settings.bundle_max_object_bytes:
            raise AdaptiveImportError("ZIP_MEMBER_TOO_LARGE", "A ZIP member exceeds the configured object limit.", layer="archive")
        expanded += info.file_size
        if expanded > settings.bundle_max_expanded_bytes:
            raise AdaptiveImportError("ZIP_EXPANDED_LIMIT", "The ZIP exceeds the expanded size limit.", layer="archive")
        if info.compress_size and info.file_size / info.compress_size > settings.bundle_max_compression_ratio:
            raise AdaptiveImportError("ZIP_COMPRESSION_UNSAFE", "The ZIP contains an unsafe compression ratio.", layer="archive")
        if not info.is_dir():
            files.append(info)
    wrapper = _common_wrapper(files)
    for info in files:
        effective = PurePosixPath(_effective_path(info.filename, wrapper))
        if len(effective.parts) > settings.bundle_max_path_depth:
            raise AdaptiveImportError("ZIP_PATH_DEPTH_LIMIT", "A ZIP member path is too deeply nested.", layer="archive")
    return files, wrapper


def _common_wrapper(infos: list[zipfile.ZipInfo]) -> str | None:
    if not infos:
        return None
    parts = [PurePosixPath(info.filename).parts for info in infos]
    first = parts[0][0] if len(parts[0]) > 1 else None
    if first and all(len(item) > 1 and item[0] == first for item in parts):
        return first
    return None


def _effective_path(path: str, wrapper: str | None) -> str:
    parts = PurePosixPath(path).parts
    return PurePosixPath(*parts[1:]).as_posix() if wrapper and parts and parts[0] == wrapper else PurePosixPath(path).as_posix()


def _read_manifest(archive: zipfile.ZipFile, info: zipfile.ZipInfo) -> dict[str, Any] | None:
    from app.services.adaptive_import.memory_budget import streaming_budget
    if streaming_budget():
        from app.services.adaptive_import.manifest_stream import read_manifest
        if info.file_size > 4 * 1024 * 1024:
            raise AdaptiveImportError("ZIP_MEMBER_TOO_LARGE", "The manifest exceeds its size limit.", layer="archive")
        try:
            with archive.open(info) as source:
                return read_manifest(source, get_settings().bundle_max_entries)
        except (ValueError, UnicodeError) as exc:
            raise AdaptiveImportError("ZIP_MANIFEST_INVALID", "The manifest is invalid or exceeds its bounded metadata limit.", layer="archive") from exc
    try:
        payload = json.loads(_read_member_bytes(archive, info, min(get_settings().bundle_max_object_bytes, 4 * 1024 * 1024)))
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError):
        return None
    return payload if isinstance(payload, dict) else None


def _is_exporter_manifest(manifest: dict[str, Any] | None) -> bool:
    return bool(
        manifest
        and isinstance(manifest.get("version"), str)
        and isinstance(manifest.get("assets"), list)
        and isinstance(manifest.get("messages"), list)
    )


def _read_member_bytes(archive: zipfile.ZipFile, info: zipfile.ZipInfo, max_bytes: int) -> bytes:
    try:
        with archive.open(info, "r") as source:
            chunks: list[bytes] = []
            size = 0
            while chunk := source.read(1024 * 1024):
                _small_import_checkpoint()
                size += len(chunk)
                if size > max_bytes:
                    raise AdaptiveImportError("ZIP_MEMBER_TOO_LARGE", "A ZIP member exceeds the configured object limit.", layer="archive")
                chunks.append(chunk)
            return b"".join(chunks)
    except zipfile.BadZipFile as exc:
        raise AdaptiveImportError("ZIP_CRC_INVALID", "A ZIP member failed integrity validation.", layer="archive") from exc


def _small_import_checkpoint() -> None:
    from app.services.adaptive_import.memory_budget import checkpoint

    checkpoint()


@contextmanager
def _disk_member(record, archive, info):
    """Transient derived file, never the retained user's source ZIP."""
    from app.services.adaptive_import.bounded_io import copy_stream
    path = _session_root(record.id) / f".member-{uuid.uuid4().hex}.md"
    try:
        from app.services.adaptive_import.memory_budget import BudgetedArchiveStream
        with archive.open(info) as source, path.open("xb") as target:
            copy_stream(BudgetedArchiveStream(source, archive.fp), target,
                        maximum=get_settings().bundle_max_object_bytes)
        yield path
    except zipfile.BadZipFile as exc:
        raise AdaptiveImportError("ZIP_CRC_INVALID", "A ZIP member failed integrity validation.", layer="archive") from exc
    finally:
        path.unlink(missing_ok=True)


class _ChunkReader:
    def __init__(self, chunks):
        self.chunks, self.pending = iter(chunks), b""

    def read(self, size):
        if size < 0:
            raise ValueError("Unbounded reads are not allowed.")
        while not self.pending:
            self.pending = next(self.chunks, None)
            if self.pending is None:
                return b""
        output, self.pending = self.pending[:size], self.pending[size:]
        return output


def _visible_role_heading_count(text: str) -> int:
    count = 0
    fence: tuple[str, int] | None = None
    for line in text.splitlines():
        stripped = line.lstrip()
        match = re.match(r"(`{3,}|~{3,})", stripped)
        if fence:
            if match and match.group(1)[0] == fence[0] and len(match.group(1)) >= fence[1]:
                fence = None
            continue
        if match:
            fence = (match.group(1)[0], len(match.group(1)))
            continue
        if _ROLE_HEADING_RE.match(line):
            count += 1
    return count


def _refresh_catalog_summary(catalog: dict[str, Any]) -> None:
    members = [item for item in catalog.get("members") or [] if isinstance(item, dict)]
    catalog["document_count"] = sum(item.get("use") == "conversation" for item in members)
    catalog["attachment_count"] = sum(item.get("use") == "attachment" for item in members)
    catalog["missing_attachment_count"] = sum(
        item.get("use") == "attachment" and item.get("availability") == "missing" for item in members
    )
    # One stable warning also survives the existing task/commit warning API.
    catalog["issues"] = [item for item in catalog.get("issues", []) if item.get("code") != "ZIP_MISSING_ATTACHMENTS"]
    if catalog["missing_attachment_count"]:
        catalog["issues"].append({
            "code": "ZIP_MISSING_ATTACHMENTS", "severity": "warning",
            "message": f"ZIP missing attachments: {catalog['missing_attachment_count']}. Text and missing references are retained.",
        })
    catalog["excluded_count"] = sum(item.get("use") == "excluded" for item in members)
    catalog["unreferenced_count"] = sum(
        item.get("use") == "excluded" and item.get("kind") != "markdown" and not item.get("reference_count")
        for item in members
    )


def _artifact_summary(catalog: dict[str, Any]) -> dict[str, Any]:
    return {
        **({"catalog_file": catalog["catalog_file"]} if catalog.get("catalog_file") else {}),
        "archive_catalog_version": CATALOG_VERSION,
        "archive_kind": catalog["archive_kind"],
        "classification_version": catalog["classification_version"],
        "document_count": catalog["document_count"],
        "attachment_count": catalog["attachment_count"],
        "missing_attachment_count": catalog.get("missing_attachment_count", 0),
        "excluded_count": catalog["excluded_count"],
        "unreferenced_count": catalog["unreferenced_count"],
        "issue_count": len(catalog.get("issues") or []),
        "blocking_issue_count": sum(
            str(item.get("severity") or "").casefold() == "error"
            for item in catalog.get("issues") or []
            if isinstance(item, dict)
        ),
    }


def _require_importable_catalog(catalog: dict[str, Any]) -> None:
    errors = [
        item for item in catalog.get("issues") or []
        if isinstance(item, dict) and str(item.get("severity") or "").casefold() == "error"
    ]
    if errors:
        raise AdaptiveImportError(
            str(errors[0].get("code") or "ZIP_CONTENT_INVALID"),
            str(errors[0].get("message") or "The ZIP contains invalid import resources."),
            layer="archive",
        )


def _write_catalog(import_id: uuid.UUID, artifact_id: uuid.UUID, catalog: dict[str, Any]) -> None:
    path = _catalog_path(import_id, artifact_id)
    from app.services.adaptive_import.memory_budget import streaming_budget
    if streaming_budget():
        path = path.with_name(f"archive-{artifact_id}-{uuid.uuid4().hex}.json")
        catalog["catalog_file"] = path.name
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    encoded = json.dumps(catalog, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if streaming_budget() and len(encoded) > MAX_CATALOG_BYTES:
        raise AdaptiveImportError("ZIP_METADATA_LIMIT", "The ZIP metadata exceeds its bounded limit.", layer="archive")
    try:
        with temporary.open("xb") as handle:
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def _read_catalog(import_id: uuid.UUID, artifact_id: uuid.UUID, filename=None) -> dict[str, Any]:
    path = _catalog_path(import_id, artifact_id)
    if filename:
        if not isinstance(filename, str) or Path(filename).name != filename:
            raise AdaptiveImportError("ARCHIVE_CATALOG_INVALID", "The ZIP preview is invalid.", layer="archive")
        selected = (path.parent / filename).resolve()
        if selected.parent != path.parent.resolve() or selected.is_symlink():
            raise AdaptiveImportError("ARCHIVE_CATALOG_INVALID", "The ZIP preview is invalid.", layer="archive")
        path = selected
    try:
        if path.stat().st_size > MAX_CATALOG_BYTES:
            raise AdaptiveImportError("ZIP_METADATA_LIMIT", "The ZIP metadata exceeds its bounded limit.", layer="archive")
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError, RecursionError) as exc:
        raise AdaptiveImportError("ARCHIVE_CATALOG_UNAVAILABLE", "The ZIP preview is unavailable. Reanalyze the source.", layer="archive") from exc
    if not isinstance(payload, dict) or payload.get("version") != CATALOG_VERSION:
        raise AdaptiveImportError("ARCHIVE_CATALOG_INVALID", "The ZIP preview is invalid. Reanalyze the source.", layer="archive")
    return payload


def _catalog_path(import_id: uuid.UUID, artifact_id: uuid.UUID) -> Path:
    return _session_root(import_id) / f"archive-{artifact_id}.json"


def _artifact_path(record: ImportRecord, artifact: SourceArtifact) -> Path:
    root = _session_root(record.id)
    path = (root / artifact.safe_filename).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise AdaptiveImportError("SOURCE_MISSING", "A source file is missing from import storage.", layer="file")
    return path


def _session_root(import_id: uuid.UUID) -> Path:
    root = Path(get_settings().import_storage_dir).resolve()
    target = (root / str(import_id)).resolve()
    if target.parent != root or target.name != str(import_id):
        raise AdaptiveImportError("SOURCE_PATH_INVALID", "The import session storage path is invalid.", layer="file")
    target.mkdir(parents=True, exist_ok=True)
    return target


def _normalize_member_reference(value: str) -> str | None:
    raw = value
    # Validate before normalizing; absolute and platform-specific paths must
    # never be "repaired" into a different archive member's identity.
    for _ in range(3):
        if not raw or raw.startswith("/") or any(char in raw for char in ("\\", ":", "\x00")):
            return None
        if ".." in PurePosixPath(raw).parts:
            return None
        decoded = unquote(raw)
        if decoded == raw:
            break
        raw = decoded
    else:
        return None
    path = PurePosixPath(raw)
    if not raw or path.is_absolute() or ".." in path.parts or path.as_posix() != raw:
        return None
    return path.as_posix()


def _effective_reference_path(value: str, wrapper: str | None) -> str | None:
    normalized = _normalize_member_reference(value)
    if not normalized:
        return None
    if wrapper:
        prefix = f"{wrapper}/"
        if normalized == wrapper:
            return None
        if normalized.startswith(prefix):
            return normalized[len(prefix):]
    return normalized


def _positive_int(value: Any) -> int | None:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if 0 < number <= 100_000 else None
