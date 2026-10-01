"""Versioned configuration identity, independent of names, samples and owners.

Keep v1 deterministic: migrations also use it to identify pre-grant duplicates.
New parser semantics must use a new identity version rather than editing v1.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any


def normalize_mapping_v1(mapping: dict[str, Any]) -> dict[str, Any]:
    mode = mapping.get("source_mode")
    if mode == "JSON_MARKDOWN":
        relation = mapping.get("relation") or {}
        return {"source_mode": mode, "json": normalize_mapping_v1(mapping.get("json") or {}),
                "markdown": normalize_mapping_v1(mapping.get("markdown") or {}),
                "relation": {key: relation.get(key, default) for key, default in {
                    "type": "ORDER", "content_source": "MARKDOWN", "role_source": "JSON", "timestamp_source": "JSON",
                }.items()}}
    conversation = mapping.get("conversation") or {}
    messages = mapping.get("messages") or {}
    # Unknown metadata is not part of the parser contract and must never become
    # a public configuration carrying filenames, samples or conversation data.
    result = {
        "source_mode": mode,
        "conversation": {key: conversation.get(key) for key in ("locator", "title")},
        "messages": {key: messages.get(key) for key in ("locator", "role", "content", "timestamp", "external_id")},
        "role_mapping": {str(key).casefold(): value for key, value in (mapping.get("role_mapping") or {}).items()},
        "unknown_role": "ASK",
        "noise_rules": [{key: rule[key] for key in ("region", "action", "selector", "equals") if key in rule}
                        for rule in mapping.get("noise_rules") or []],
        "transforms": {"content": (mapping.get("transforms") or {}).get("content") or []},
    }
    if mode == "MARKDOWN":
        boundary = messages.get("boundary") or {}
        result["messages"]["boundary"] = {"kind": boundary.get("kind"), "level": boundary.get("level")}
    return result


def _structure(value: Any, key: str = "") -> Any:
    if isinstance(value, dict):
        return {name: _structure(item, name) for name, item in value.items()}
    if isinstance(value, list):
        items = [_structure(item) for item in value]
        if key in {"paths", "arrays", "item_paths", "role_labels", "fence_styles", "required_paths", "role_values"}:
            return sorted(items, key=lambda item: json.dumps(item, sort_keys=True, ensure_ascii=False))
        return items
    return value


def configuration_digest_v1(*, source_mode: str, source_signature: dict, match_spec: dict,
                            mapping_spec: dict, validation_spec: dict,
                            matcher_version: str, normalizer_version: str) -> str:
    configuration = {
        "identity_version": 1, "source_mode": source_mode,
        "source_signature": _structure(source_signature), "match_spec": _structure(match_spec),
        "mapping_spec": normalize_mapping_v1(mapping_spec),
        "validation_spec": {"minimum_messages": 1, "content_non_empty": True, "role_coverage": True, **validation_spec},
        "matcher_version": matcher_version, "normalizer_version": normalizer_version,
    }
    encoded = json.dumps(configuration, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def verification_summary_v1(summary: dict) -> dict:
    result = {"valid": summary.get("valid") is True}
    for key in ("conversation_count", "message_count", "group_count"):
        if isinstance(summary.get(key), int) and not isinstance(summary[key], bool):
            result[key] = max(0, summary[key])
    return result
