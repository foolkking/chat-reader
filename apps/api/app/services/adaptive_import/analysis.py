from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any

from app.services.adaptive_import.contracts import AdaptiveImportError, AnalysisResult, SourceDocument

ANALYZER_VERSION = "adaptive-structure-v1"
_ROLE_KEYS = ("role", "author", "speaker", "sender", "type")
_CONTENT_KEYS = ("content", "text", "say", "message", "body", "parts")
_TITLE_KEYS = ("title", "name", "subject")
_TIME_KEYS = ("created_at", "create_time", "timestamp", "time", "date")
_ROLE_ALIASES = {
    "user": "user", "human": "user", "you": "user", "prompt": "user", "me": "user", "我": "user", "用户": "user", "提问": "user", "提问者": "user",
    "assistant": "assistant", "ai": "assistant", "chatgpt": "assistant", "response": "assistant", "bot": "assistant", "助手": "assistant", "ai助手": "assistant", "ai 助手": "assistant",
    "system": "system", "系统": "system", "developer": "developer", "tool": "tool",
}


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def signature_digest(signature: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_json(signature)).hexdigest()


def analyze_documents(documents: list[SourceDocument]) -> AnalysisResult:
    json_docs = [item for item in documents if item.extension in {".json", ".jsonl", ".gz"}]
    markdown_docs = [item for item in documents if item.extension in {".md", ".markdown"}]
    if len(json_docs) > 1 or len(markdown_docs) > 1 or not documents:
        raise AdaptiveImportError(
            "GROUP_AMBIGUOUS",
            "A conversation group must contain at most one JSON and one Markdown file.",
            layer="grouping",
            action="open_group_resolver",
        )
    if json_docs and markdown_docs:
        json_analysis = analyze_json(json_docs[0].content)
        markdown_analysis = analyze_markdown(markdown_docs[0].content)
        signature = {"version": ANALYZER_VERSION, "mode": "JSON_MARKDOWN", "json": json_analysis.signature, "markdown": markdown_analysis.signature}
        return AnalysisResult(
            mode="JSON_MARKDOWN",
            signature=signature,
            signature_digest=signature_digest(signature),
            mapping_candidates={
                "json": json_analysis.mapping_candidates,
                "markdown": markdown_analysis.mapping_candidates,
                "relation": {"candidates": ["ORDER", "ID", "ROLE_TIMESTAMP"], "suggested": "ORDER"},
            },
            diagnostics=[*json_analysis.diagnostics, *markdown_analysis.diagnostics],
            semantic={"json": json_analysis.semantic, "markdown": markdown_analysis.semantic},
            handling_class="MAPPABLE",
        )
    if json_docs:
        from app.schemas.import_schema import SourceProfile
        from app.services.import_pipeline.source_detector import detect_source_profile
        detection = detect_source_profile(json_docs[0].filename, json_docs[0].content)
        if detection.source_profile == SourceProfile.chat_reader_canjson_v2:
            signature = {"version": ANALYZER_VERSION, "mode": "JSON", "builtin": "canjson-v2"}
            return AnalysisResult(
                mode="JSON", signature=signature, signature_digest=signature_digest(signature),
                mapping_candidates={"message_locators": [], "suggested": {}}, semantic={}, handling_class="SUPPORTED",
            )
        return analyze_json(json_docs[0].content)
    if markdown_docs:
        native = _analyze_native_markdown(markdown_docs[0].content)
        if native is not None:
            return native
        return analyze_markdown(markdown_docs[0].content)
    raise AdaptiveImportError("SOURCE_UNSUPPORTED", "Only JSON and Markdown files can be analyzed.", layer="file")


def analyze_json(content: bytes) -> AnalysisResult:
    try:
        payload = json.loads(content.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        pointer = f"line:{getattr(exc, 'lineno', 1)}"
        raise AdaptiveImportError("JSON_INVALID", "The JSON file is not valid UTF-8 JSON.", layer="file", pointer=pointer) from exc
    paths: dict[str, str] = {}
    arrays: list[dict[str, Any]] = []
    _describe_json(payload, "$", paths, arrays, 0)
    candidates = _json_mapping_candidates(payload, arrays)
    if not candidates["message_locators"]:
        raise AdaptiveImportError(
            "NO_MESSAGE_STRUCTURE",
            "No array of message-like objects was found in this JSON file.",
            layer="analysis",
            action="inspect_source",
        )
    signature = {
        "version": ANALYZER_VERSION,
        "mode": "JSON",
        "root_type": _type_name(payload),
        "paths": [{"path": path, "type": paths[path]} for path in sorted(paths)],
        "arrays": [{"path": item["path"], "item_paths": item["item_paths"]} for item in sorted(arrays, key=lambda item: item["path"])],
    }
    selected = candidates["suggested"]
    semantic = {
        "role_values": selected.get("role_values", []),
        "role_suggestions": {value: _ROLE_ALIASES[value.casefold()] for value in selected.get("role_values", []) if value.casefold() in _ROLE_ALIASES},
    }
    diagnostics = []
    unknown_roles = sorted(set(semantic["role_values"]) - set(semantic["role_suggestions"]))
    if unknown_roles:
        diagnostics.append({
            "code": "ROLE_MAPPING_REQUIRED", "layer": "mapping", "blocking": True,
            "message": "Some source role values need an explicit canonical mapping.",
            "pointer": selected.get("role"), "values": unknown_roles, "action": "map_roles",
        })
    return AnalysisResult(
        mode="JSON",
        signature=signature,
        signature_digest=signature_digest(signature),
        mapping_candidates=candidates,
        diagnostics=diagnostics,
        semantic=semantic,
        handling_class="MAPPABLE",
    )


def analyze_markdown(content: bytes) -> AnalysisResult:
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise AdaptiveImportError("MARKDOWN_ENCODING_INVALID", "Markdown must be UTF-8.", layer="file") from exc
    if not text.strip():
        raise AdaptiveImportError("MARKDOWN_EMPTY", "The Markdown file is empty.", layer="file")
    if re.search(r"^name:\s*chat-reader-conversation-rescue\s*$", text, re.MULTILINE) or "Conversation Rescue & Canonicalization Skill" in text:
        raise AdaptiveImportError(
            "DOCUMENT_NOT_TRANSCRIPT",
            "This file is a conversion instruction document, not a Conversation transcript.",
            layer="analysis",
            action="open_rescue",
        )
    patterns, fence_unclosed = _markdown_patterns(text)
    if fence_unclosed:
        raise AdaptiveImportError(
            "MARKDOWN_FENCE_UNCLOSED", "A fenced code block is not closed.", layer="analysis", action="inspect_source"
        )
    viable = [item for item in patterns if item["count"] >= 2 and len(item["roles"]) >= 1]
    if not viable:
        raise AdaptiveImportError(
            "NO_MESSAGE_STRUCTURE", "No repeated role boundary was found in this Markdown file.", layer="analysis", action="inspect_source"
        )
    viable.sort(key=lambda item: (-item["count"], item["kind"], item.get("level") or 0))
    selected = viable[0]
    role_values = sorted(selected["roles"])
    role_suggestions = {value: _ROLE_ALIASES[value.casefold()] for value in role_values if value.casefold() in _ROLE_ALIASES}
    signature = {
        "version": ANALYZER_VERSION,
        "mode": "MARKDOWN",
        "boundary": {"kind": selected["kind"], "level": selected.get("level")},
        "role_labels": role_values,
        "has_title": bool(re.search(r"^#\s+\S", text, re.MULTILINE)),
        "fence_styles": sorted(set(re.findall(r"^\s{0,3}(```|~~~)", text, re.MULTILINE))),
    }
    candidates = {
        "boundaries": viable,
        "suggested": {
            "boundary": {"kind": selected["kind"], "level": selected.get("level")},
            "role_mapping": role_suggestions,
            "preamble": "IGNORE",
            "title": "FIRST_H1_OR_FILENAME",
        },
    }
    diagnostics = []
    unknown = sorted(set(role_values) - set(role_suggestions))
    if unknown:
        diagnostics.append({
            "code": "ROLE_MAPPING_REQUIRED", "layer": "mapping", "blocking": True,
            "message": "Some Markdown role labels need an explicit canonical mapping.",
            "pointer": f"line:{selected['first_line']}", "values": unknown, "action": "map_roles",
        })
    return AnalysisResult(
        mode="MARKDOWN",
        signature=signature,
        signature_digest=signature_digest(signature),
        mapping_candidates=candidates,
        diagnostics=diagnostics,
        semantic={"role_values": role_values, "role_suggestions": role_suggestions},
        handling_class="MAPPABLE",
    )


def _analyze_native_markdown(content: bytes) -> AnalysisResult | None:
    """Recognize Chat Reader's own Markdown export before generic boundary discovery."""
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        return None
    front_matter = re.match(r"\A---\r?\n(?P<body>.*?)(?:\r?\n---)\s*", text, re.DOTALL)
    if front_matter is None or not re.search(r'^format:\s*["\']chat-reader-markdown-export["\']\s*$', front_matter.group("body"), re.MULTILINE):
        return None
    version = re.search(r'^version:\s*["\']?2["\']?\s*$', front_matter.group("body"), re.MULTILINE)
    markers = len(re.findall(r"^<!--\s*chat-reader-message\b", text, re.MULTILINE))
    if version is None or markers < 1:
        return None
    signature = {
        "version": ANALYZER_VERSION,
        "mode": "MARKDOWN",
        "builtin": "chat-reader-markdown-v2",
        "message_markers": markers,
    }
    return AnalysisResult(
        mode="MARKDOWN",
        signature=signature,
        signature_digest=signature_digest(signature),
        mapping_candidates={
            "boundaries": [],
            "suggested": {
                "native": True,
                "title": "FIRST_H1_OR_FILENAME",
                "boundary": {"kind": "NATIVE_MARKER", "level": None},
                "role_mapping": {},
                "preamble": "IGNORE",
            },
        },
        semantic={"native": True},
        handling_class="SUPPORTED",
    )


def default_mapping(analysis: AnalysisResult) -> dict[str, Any]:
    if analysis.mode == "JSON":
        selected = analysis.mapping_candidates["suggested"]
        return {
            "source_mode": "JSON",
            "conversation": {"title": selected.get("title")},
            "messages": {
                "locator": selected["locator"],
                "role": selected["role"],
                "content": selected["content"],
                "external_id": selected.get("external_id"),
                "timestamp": selected.get("timestamp"),
            },
            "role_mapping": analysis.semantic.get("role_suggestions", {}),
            "unknown_role": "ASK",
            "noise_rules": [],
            "transforms": {},
        }
    if analysis.mode == "MARKDOWN":
        suggested = analysis.mapping_candidates["suggested"]
        return {
            "source_mode": "MARKDOWN",
            "conversation": {"title": suggested["title"]},
            "messages": {
                "boundary": suggested["boundary"],
                "external_id": "BOUNDARY_METADATA_ID",
                "timestamp": "BOUNDARY_METADATA_TIMESTAMP",
            },
            "role_mapping": suggested["role_mapping"],
            "unknown_role": "ASK",
            "noise_rules": [{"region": "PREAMBLE", "action": suggested["preamble"]}],
            "transforms": {},
        }
    return {
        "source_mode": "JSON_MARKDOWN",
        "json": default_mapping(_child_analysis(analysis, "json")),
        "markdown": default_mapping(_child_analysis(analysis, "markdown")),
        "relation": {"type": "ORDER", "content_source": "MARKDOWN", "role_source": "JSON", "timestamp_source": "JSON"},
    }


def _child_analysis(analysis: AnalysisResult, key: str) -> AnalysisResult:
    signature = analysis.signature[key]
    candidates = analysis.mapping_candidates[key]
    semantic = analysis.semantic[key]
    mode = "JSON" if key == "json" else "MARKDOWN"
    return AnalysisResult(mode=mode, signature=signature, signature_digest=signature_digest(signature), mapping_candidates=candidates, semantic=semantic)


def normalized_stem(filename: str) -> str:
    stem = Path(filename).stem.casefold().strip().rstrip(". ")
    stem = re.sub(r"\s*\(\d+\)$", "", stem).strip().rstrip(". ")
    return re.sub(r"[\s_-]+", "-", stem)


def _describe_json(value: Any, path: str, paths: dict[str, str], arrays: list[dict[str, Any]], depth: int) -> None:
    if depth > 24:
        paths[path] = "depth_limited"
        return
    paths[path] = _type_name(value)
    if isinstance(value, dict):
        for key in sorted(value):
            _describe_json(value[key], f"{path}.{key}", paths, arrays, depth + 1)
    elif isinstance(value, list):
        items = value[:1000]
        object_items = [item for item in items if isinstance(item, dict)]
        item_paths = sorted({key for item in object_items for key in _relative_leaf_paths(item)})
        arrays.append({"path": f"{path}[*]", "item_paths": item_paths, "sample": object_items[:1000]})
        merged = object_items[0] if object_items else (items[0] if items else None)
        if merged is not None:
            _describe_json(merged, f"{path}[*]", paths, arrays, depth + 1)


def _relative_leaf_paths(value: Any, prefix: str = "$") -> set[str]:
    result: set[str] = set()
    if isinstance(value, dict):
        for key, child in value.items():
            result |= _relative_leaf_paths(child, f"{prefix}.{key}")
    elif isinstance(value, list):
        if value:
            result |= _relative_leaf_paths(value[0], f"{prefix}[*]")
        else:
            result.add(f"{prefix}[*]")
    else:
        result.add(prefix)
    return result


def _json_mapping_candidates(payload: Any, arrays: list[dict[str, Any]]) -> dict[str, Any]:
    candidates: list[dict[str, Any]] = []
    for array in arrays:
        samples = array["sample"]
        if not samples:
            continue
        paths = array["item_paths"]
        role = _best_relative_path(paths, _ROLE_KEYS)
        content = _best_relative_path(paths, _CONTENT_KEYS)
        if not role or not content:
            continue
        role_values = sorted({str(value) for sample in samples for value in _select_relative(sample, role) if value is not None})
        candidate = {
            "locator": array["path"], "role": role, "content": content,
            "external_id": _best_relative_path(paths, ("id", "message_id", "uuid")),
            "timestamp": _best_relative_path(paths, _TIME_KEYS),
            "title": _best_root_path(payload, _TITLE_KEYS),
            "role_values": role_values,
            "score": 100 + min(len(samples), 20),
        }
        candidates.append(candidate)
    candidates.sort(key=lambda item: (-item["score"], item["locator"]))
    return {"message_locators": candidates, "suggested": candidates[0] if candidates else {}}


def _best_relative_path(paths: list[str], names: tuple[str, ...]) -> str | None:
    for name in names:
        exact = next((path for path in paths if path.casefold() == f"$.{name}"), None)
        if exact:
            return exact
    for name in names:
        nested = next((path for path in paths if path.casefold().endswith(f".{name}")), None)
        if nested:
            return nested
    return None


def _best_root_path(payload: Any, names: tuple[str, ...]) -> str | None:
    if not isinstance(payload, dict):
        return None
    for name in names:
        if name in payload and isinstance(payload[name], (str, int, float)):
            return f"$.{name}"
    metadata = payload.get("metadata")
    if isinstance(metadata, dict):
        for name in names:
            if name in metadata:
                return f"$.metadata.{name}"
    return None


def _select_relative(value: Any, selector: str) -> list[Any]:
    from app.services.adaptive_import.selector import evaluate_selector
    return evaluate_selector(value, selector)


def _markdown_patterns(text: str) -> tuple[list[dict[str, Any]], bool]:
    heading = re.compile(r"^ {0,3}(#{1,6})[ \t]+(.+?)\s*#*\s*$")
    label = re.compile(r"^\s*([^:#：]{1,40})\s*[:：]\s*$")
    active: tuple[str, int] | None = None
    buckets: dict[tuple[str, int | None], dict[str, Any]] = {}
    for line_no, line in enumerate(text.splitlines(), 1):
        fence = re.match(r"^ {0,3}(`{3,}|~{3,})", line)
        if active:
            if fence and fence.group(1)[0] == active[0] and len(fence.group(1)) >= active[1] and not line[fence.end():].strip():
                active = None
            continue
        if fence:
            active = (fence.group(1)[0], len(fence.group(1)))
            continue
        match = heading.match(line)
        if match:
            level = len(match.group(1))
            role = _heading_role(match.group(2))
            if role:
                bucket = buckets.setdefault(("HEADING", level), {"kind": "HEADING", "level": level, "count": 0, "roles": Counter(), "first_line": line_no, "identity_count": 0, "timestamp_count": 0})
                bucket["count"] += 1
                bucket["roles"][role] += 1
                metadata = _heading_metadata(match.group(2))
                bucket["identity_count"] += int(bool(metadata["external_id"]))
                bucket["timestamp_count"] += int(bool(metadata["timestamp"]))
            continue
        match = label.match(line)
        if match and match.group(1).strip().casefold() in _ROLE_ALIASES:
            role = match.group(1).strip()
            bucket = buckets.setdefault(("LINE_LABEL", None), {"kind": "LINE_LABEL", "level": None, "count": 0, "roles": Counter(), "first_line": line_no, "identity_count": 0, "timestamp_count": 0})
            bucket["count"] += 1
            bucket["roles"][role] += 1
    return [
        {**item, "roles": dict(item["roles"])}
        for item in buckets.values()
    ], active is not None


def _heading_role(label: str) -> str | None:
    value = _heading_metadata(label)["role"]
    return value if value.casefold() in _ROLE_ALIASES else None


def _heading_metadata(label: str) -> dict[str, str | None]:
    value = re.split(r"\s+(?:[-–—·]|\|)\s+", label.strip(), maxsplit=1)[0]
    # Exporters commonly wrap a model name in Markdown emphasis, e.g.
    # ``ChatGPT *(gpt-5)*``. It is decoration, not a distinct role label.
    value = re.sub(r"\s*[*_]{0,3}\s*\([^)]*\)\s*[*_]{0,3}\s*$", "", value)
    value = re.sub(r"^[*_]{1,3}|[*_]{1,3}$", "", value).strip()
    value = re.sub(r"\s*\([^)]*\)\s*$", "", value).strip().rstrip(":：").strip()
    external_id_match = re.search(
        r"(?:^|[\s|,;\[(])(?:id|message[_\s-]?id|uuid)\s*[:=]\s*([A-Za-z0-9._:-]{1,200})",
        label,
        re.IGNORECASE,
    )
    timestamp_match = re.search(
        r"\b(\d{4}-\d{2}-\d{2}[T ][0-2]\d:[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-][0-2]\d(?::?[0-5]\d)?)?)\b",
        label,
    )
    return {
        "role": value,
        "external_id": external_id_match.group(1) if external_id_match else None,
        "timestamp": timestamp_match.group(1) if timestamp_match else None,
    }


def _type_name(value: Any) -> str:
    if value is None: return "null"
    if isinstance(value, bool): return "boolean"
    if isinstance(value, int): return "integer"
    if isinstance(value, float): return "number"
    if isinstance(value, str): return "string"
    if isinstance(value, list): return "array"
    if isinstance(value, dict): return "object"
    return "unknown"
