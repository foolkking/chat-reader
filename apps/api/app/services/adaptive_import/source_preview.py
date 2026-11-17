"""Bounded, analysis-produced previews. Reading never normalizes a source."""
import hashlib
import json
import uuid
from itertools import islice
from pathlib import Path

from app.core.config import get_settings
from app.services.adaptive_import.contracts import AdaptiveImportError

KEY = "_source_preview"
MAX_BYTES = 160_000


def binding(record, group, family) -> dict:
    artifacts = {str(item.id): item for item in record.artifacts}
    sources = []
    for identifier in group.artifact_ids:
        item = artifacts.get(str(identifier))
        if item is None or item.import_id != record.id:
            raise AdaptiveImportError("PREVIEW_SOURCE_MISMATCH", "Refresh this import before continuing.", layer="validation")
        summary = item.parsed_summary or {}
        archive_id = summary.get("archive_artifact_id")
        archive = artifacts.get(str(archive_id)) if archive_id else None
        if archive_id and (archive is None or archive.import_id != record.id):
            raise AdaptiveImportError("PREVIEW_SOURCE_MISMATCH", "Archive source is unavailable.", layer="validation")
        sources.append({
            "artifact_id": str(item.id), "filename": item.filename, "sha256": item.sha256,
            "source_revision": summary.get("source_revision", 0),
            "archive": None if archive is None else {
                "artifact_id": str(archive.id), "sha256": archive.sha256,
                "source_revision": (archive.parsed_summary or {}).get("source_revision", 0),
                "member_id": summary.get("archive_member_id"),
                "path": summary.get("archive_path") or item.filename,
            },
        })
    return {
        "version": 1, "import_id": str(record.id), "group_id": str(group.id),
        "family_id": str(family.id), "source_fingerprint": record.source_fingerprint,
        "revision_id": str(family.matched_revision_id) if family.matched_revision_id else None,
        "builtin_key": family.matched_profile_key, "sources": sources,
    }


def _root(record) -> Path:
    root = Path(get_settings().import_storage_dir).resolve()
    path = root / str(record.id) / "source-previews"
    if not path.resolve().is_relative_to(root / str(record.id)) or path.is_symlink():
        raise AdaptiveImportError("PREVIEW_SOURCE_MISMATCH", "Preview location is unavailable.", layer="validation")
    return path


def save_preview(record, group, family, drafts) -> None:
    identity = binding(record, group, family)
    sample = drafts[0] if drafts else None
    payload = {
        **identity, "conversation_count": len(drafts),
        "preview": None if sample is None else {
            "title": sample.title[:2000], "message_count": len(sample.messages),
            "messages": [{"role": message.role, "content": message.display_text[:2000],
                          "content_truncated": len(message.display_text) > 2000}
                         for message in islice(sample.messages, 12)],
        },
    }
    data = json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    if len(data) > MAX_BYTES:
        raise AdaptiveImportError("PREVIEW_LIMIT", "The source preview exceeds its bound.", layer="validation")
    digest = hashlib.sha256(data).hexdigest()
    root = _root(record)
    root.mkdir(parents=True, exist_ok=True)
    name = f"{group.id}-{uuid.uuid4().hex}.json"
    with (root / name).open("xb") as output:
        output.write(data)
    group.profile_resolution = {**(group.profile_resolution or {}), KEY: {
        "binding": identity, "filename": name, "sha256": digest,
    }}


def read_preview(record, group, family) -> dict:
    saved = (group.profile_resolution or {}).get(KEY)
    if not isinstance(saved, dict):
        raise AdaptiveImportError("PREVIEW_UNAVAILABLE", "This older import has no source preview. Rebuild it explicitly.", layer="validation", action="rebuild_preview")
    identity = binding(record, group, family)
    if saved.get("binding") != identity:
        raise AdaptiveImportError("PREVIEW_SOURCE_MISMATCH", "Sources changed. Rebuild this import preview.", layer="validation", action="rebuild_preview")
    name = saved.get("filename", "")
    if not name or Path(name).name != name:
        raise AdaptiveImportError("PREVIEW_SOURCE_MISMATCH", "Preview identity is invalid.", layer="validation")
    path = _root(record) / name
    try:
        if path.is_symlink():
            raise ValueError("symlink")
        with path.open("rb") as source:
            data = source.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES or hashlib.sha256(data).hexdigest() != saved.get("sha256"):
            raise ValueError("digest")
        payload = json.loads(data)
        if any(payload.get(key) != value for key, value in identity.items()):
            raise ValueError("binding")
        return payload
    except (OSError, ValueError, TypeError) as exc:
        raise AdaptiveImportError("PREVIEW_UNAVAILABLE", "The saved preview is unavailable. Rebuild it explicitly.", layer="validation", action="rebuild_preview") from exc


def verify_preview_bindings(record) -> None:
    """Legacy drafts remain readable; new analysis metadata must never be reused."""
    families = {item.id: item for item in record.structure_families}
    for group in record.input_groups:
        saved = (group.profile_resolution or {}).get(KEY)
        if saved is None:
            continue
        family = families.get(group.family_id)
        if family is None or saved.get("binding") != binding(record, group, family):
            raise AdaptiveImportError("PREVIEW_SOURCE_MISMATCH", "Sources changed. Rebuild this import preview.", layer="validation")


def source_title(record) -> str:
    from app.services.adaptive_import.ordering import ordered_artifacts
    from app.services.adaptive_import.archive_sources import ARCHIVE_DOCUMENT_SOURCE_TYPE
    names = [item.filename for item in ordered_artifacts(record) if item.source_type != ARCHIVE_DOCUMENT_SOURCE_TYPE]
    if names:
        return names[0] if len(names) == 1 else f"{names[0]} (+{len(names) - 1})"
    return record.json_filename or record.md_filename or record.csv_filename or "未命名导入"
