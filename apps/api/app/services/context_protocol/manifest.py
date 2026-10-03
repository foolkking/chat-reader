from __future__ import annotations

from .safety import load_protocol_json
from typing import Any

from .model import PackageManifestInfo
from .source import PackageSource, PackageError
from .safety import is_safe_member_name


def normalize_manifest(raw: dict) -> dict:
    """Normalize historical exporter shapes without dropping checksum declarations."""
    raw = dict(raw)
    files = raw.get("files", {})
    if isinstance(files, list):
        normalized = {}
        for item in files:
            if not isinstance(item, dict) or not isinstance(item.get("path"), str):
                raise PackageError("invalid manifest file declaration")
            path = item["path"]
            if path in normalized:
                raise PackageError("duplicate manifest file declaration")
            normalized[path] = {k: v for k, v in item.items() if k != "path"}
        files = normalized
    if not isinstance(files, dict):
        raise PackageError("manifest files must be an object or legacy array")
    for path, metadata in files.items():
        if not is_safe_member_name(path) or not isinstance(metadata, dict):
            raise PackageError("invalid manifest file declaration")
    raw["files"] = files
    conversation = raw.get("conversation", {})
    scope = raw.get("scope", {})
    if not isinstance(conversation, dict) or not isinstance(scope, dict):
        raise PackageError("invalid manifest conversation or scope")
    conversation = dict(conversation)
    for old, new in (("conversation_id", "id"), ("conversation_revision", "conversation_revision"),
                     ("message_count", "message_count"), ("current_versions_only", "current_versions_only")):
        if old in scope:
            if new in conversation and conversation[new] != scope[old]:
                raise PackageError("conflicting manifest conversation and scope")
            conversation[new] = scope[old]
    raw["conversation"] = conversation
    return raw


def load_package_manifest(source: PackageSource) -> PackageManifestInfo:
    try:
        raw = load_protocol_json(source.read_text("manifest.json"))
    except Exception as e:
        raise PackageError(f"manifest.json is unreadable: {e}") from e
    if not isinstance(raw, dict):
        raise PackageError("manifest.json must contain a JSON object")
    raw = normalize_manifest(raw)
    entrypoint = raw.get("entrypoint")
    entrypoint_source = "manifest"
    if not isinstance(entrypoint, str) or not entrypoint:
        if source.exists("conversation.canjsonl"):
            entrypoint = "conversation.canjsonl"
            entrypoint_source = "legacy_fallback"
        else:
            raise PackageError("manifest entrypoint is missing and no legacy conversation.canjsonl exists")
    return PackageManifestInfo(
        raw=raw,
        format=raw.get("format"),
        format_version=str(raw.get("format_version")) if raw.get("format_version") is not None else None,
        entrypoint=entrypoint,
        entrypoint_source=entrypoint_source,
        conversation=raw.get("conversation") if isinstance(raw.get("conversation"), dict) else {},
        conversation_completeness=raw.get("conversation_completeness"),
        asset_completeness=raw.get("asset_completeness"),
        attachments=raw.get("attachments") if isinstance(raw.get("attachments"), dict) else {},
        included_content=raw.get("included_content") if isinstance(raw.get("included_content"), dict) else {},
        files=raw.get("files") if isinstance(raw.get("files"), dict) else {},
        continuation=raw.get("continuation") if isinstance(raw.get("continuation"), dict) else None,
    )
