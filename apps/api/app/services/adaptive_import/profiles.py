from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.models.import_profile import ImportProfile, ImportProfileRevision
from app.services.adaptive_import.analysis import default_mapping
from app.services.adaptive_import.normalization import _draft_conversation, _draft_message
from app.services.adaptive_import.contracts import AnalysisResult, MatchResult, SourceDocument
from app.services.import_pipeline.canjson_parser import CanJsonParseError, parse_canjson_v1, parse_canjson_v2
from app.services.import_pipeline.exporter_aligner import align_exporter_sources
from app.services.import_pipeline.exporter_json_parser import ExporterJsonParseError, parse_exporter_json
from app.services.import_pipeline.exporter_markdown_parser import ExporterMarkdownPairingError, parse_exporter_markdown
from app.services.import_pipeline.source_detector import detect_source_profile
from app.schemas.import_schema import SourceProfile

MATCHER_VERSION = "adaptive-matcher-v1"


@dataclass(frozen=True)
class BuiltinProfile:
    key: str
    name: str
    source_mode: str
    description: str


BUILTINS = (
    BuiltinProfile("builtin:chat-reader-exporter", "Chat Reader Native JSON / Markdown", "JSON_MARKDOWN", "Chat Reader exporter JSON with optional Markdown body."),
    BuiltinProfile("builtin:chat-reader-markdown-v2", "Chat Reader Native Markdown Export v2", "MARKDOWN", "Chat Reader canonical Markdown export, version 2."),
    BuiltinProfile("builtin:canjson-v1", "CanJSON v1", "JSON", "CanJSON compatibility document, version 1."),
    BuiltinProfile("builtin:canjson-v2", "CanJSON v2", "JSON", "CanJSON compatibility document, version 2."),
    BuiltinProfile("builtin:chat-reader-markdown", "Chat Reader Prompt / Response Markdown", "MARKDOWN", "Prompt and Response Markdown conversation."),
)


def match_profile(db: Session, analysis: AnalysisResult, documents: list[SourceDocument]) -> MatchResult:
    builtin = match_builtin(analysis, documents)
    if builtin is not None:
        return MatchResult(
            status="EXACT_MATCH", profile_key=builtin.key, profile_id=None, revision_id=None,
            profile_name=builtin.name, evidence={"matcher": MATCHER_VERSION, "kind": "BUILTIN"},
        )
    candidates: list[tuple[int, str, ImportProfile, ImportProfileRevision, dict[str, Any]]] = []
    profiles = db.query(ImportProfile).filter(ImportProfile.status == "ACTIVE", ImportProfile.source_mode == analysis.mode).all()
    for profile in profiles:
        for revision in profile.revisions:
            if revision.status not in {"VERIFIED", "SUPERSEDED"}:
                continue
            status, score, evidence = _revision_match(analysis, revision)
            if status != "NO_MATCH":
                candidates.append((score, status, profile, revision, evidence))
    candidates = _best_revision_per_profile(candidates)
    exact = [item for item in candidates if item[1] == "EXACT_MATCH"]
    compatible = [item for item in candidates if item[1] == "COMPATIBLE"]
    ranked = exact or compatible
    if ranked:
        best_score = max(item[0] for item in ranked)
        best = [item for item in ranked if item[0] == best_score]
        if len(best) > 1:
            return MatchResult(
                status="AMBIGUOUS", profile_key=None, profile_id=None, revision_id=None, profile_name=None,
                evidence={"candidates": [_candidate_evidence(item) for item in best]},
            )
        _, status, profile, revision, evidence = best[0]
        return MatchResult(
            status=status, profile_key=None, profile_id=str(profile.id), revision_id=str(revision.id),
            profile_name=profile.name, evidence=evidence,
        )
    drifted = [item for item in candidates if item[1] == "DRIFTED"]
    if drifted:
        drifted.sort(key=lambda item: item[0], reverse=True)
        _, _, profile, revision, evidence = drifted[0]
        return MatchResult(
            status="DRIFTED", profile_key=None, profile_id=str(profile.id), revision_id=str(revision.id),
            profile_name=profile.name, evidence=evidence,
        )
    return MatchResult(status="UNKNOWN", profile_key=None, profile_id=None, revision_id=None, profile_name=None)


def match_builtin(analysis: AnalysisResult, documents: list[SourceDocument]) -> BuiltinProfile | None:
    if analysis.signature.get("builtin") == "chat-reader-markdown-v2":
        return _builtin("builtin:chat-reader-markdown-v2")
    json_doc = next((item for item in documents if item.extension in {".json", ".jsonl", ".gz"}), None)
    markdown_doc = next((item for item in documents if item.extension in {".md", ".markdown"}), None)
    if json_doc:
        detection = detect_source_profile(json_doc.filename, json_doc.content)
        if detection.source_profile == SourceProfile.chat_reader_canjson_v1:
            return _builtin("builtin:canjson-v1")
        if detection.source_profile == SourceProfile.chat_reader_canjson_v2:
            return _builtin("builtin:canjson-v2")
        if detection.source_profile == SourceProfile.chatgpt_exporter_json:
            if markdown_doc:
                try:
                    parsed = parse_exporter_json(json_doc.content)
                    parse_exporter_markdown(markdown_doc.content, parsed.messages)
                except (ExporterJsonParseError, ExporterMarkdownPairingError):
                    return None
            return _builtin("builtin:chat-reader-exporter")
    if markdown_doc and not json_doc:
        try:
            parsed = parse_exporter_markdown(markdown_doc.content)
        except ExporterMarkdownPairingError:
            return None
        if parsed.sections:
            return _builtin("builtin:chat-reader-markdown")
    return None


def normalize_builtin(key: str, documents: list[SourceDocument]):
    json_doc = next((item for item in documents if item.extension in {".json", ".jsonl", ".gz"}), None)
    markdown_doc = next((item for item in documents if item.extension in {".md", ".markdown"}), None)
    if key == "builtin:canjson-v1" and json_doc:
        try: return [parse_canjson_v1(json_doc.content).conversation]
        except CanJsonParseError as exc: raise ValueError(str(exc)) from exc
    if key == "builtin:canjson-v2" and json_doc:
        try: return [parse_canjson_v2(json_doc.content, compressed=json_doc.filename.casefold().endswith(".gz")).conversation]
        except CanJsonParseError as exc: raise ValueError(str(exc)) from exc
    if key == "builtin:chat-reader-markdown-v2" and markdown_doc:
        try:
            parsed = parse_exporter_markdown(markdown_doc.content)
        except ExporterMarkdownPairingError as exc:
            raise ValueError(str(exc)) from exc
        messages = [
            _draft_message(
                section.role,
                section.markdown_text,
                index,
                section.time,
                None,
                source_markdown_index=section.index,
            )
            for index, section in enumerate(parsed.sections)
            if section.role in {"user", "assistant", "system", "developer", "tool"}
        ]
        if not messages:
            raise ValueError("Native Markdown export contains no canonical messages.")
        title = parsed.title or markdown_doc.filename.rsplit(".", 1)[0]
        return [_draft_conversation(title, messages, "Chat Reader Native Markdown Export v2", source_type="adaptive_markdown")]
    if key == "builtin:chat-reader-exporter" and json_doc:
        parsed_json = parse_exporter_json(json_doc.content)
        parsed_markdown = parse_exporter_markdown(markdown_doc.content, parsed_json.messages) if markdown_doc else None
        aligned = align_exporter_sources(parsed_json, parsed_markdown)
        if aligned.conversation is None:
            raise ValueError("Chat Reader native sources could not be aligned.")
        return [aligned.conversation]
    if key == "builtin:chat-reader-markdown" and markdown_doc:
        from app.services.adaptive_import.normalization import normalize_group
        from app.services.adaptive_import.analysis import analyze_markdown
        analysis = analyze_markdown(markdown_doc.content)
        mapping = default_mapping(analysis)
        return normalize_group(documents, mapping, "builtin:chat-reader-markdown")
    raise ValueError("Built-in profile does not match this input group.")


def create_verified_revision(
    db: Session,
    *,
    analysis: AnalysisResult,
    mapping_spec: dict[str, Any],
    validation_spec: dict[str, Any],
    verification_summary: dict[str, Any],
    name: str,
    existing_profile_id: uuid.UUID | None = None,
) -> tuple[ImportProfile, ImportProfileRevision]:
    now = datetime.now(timezone.utc)
    if existing_profile_id:
        profile = db.get(ImportProfile, existing_profile_id)
        if profile is None or profile.kind != "LEARNED":
            raise ValueError("Learned import profile not found.")
        previous = max(profile.revisions, key=lambda item: item.revision, default=None)
        revision_number = (previous.revision if previous else 0) + 1
    else:
        profile = ImportProfile(name=name, kind="LEARNED", source_mode=analysis.mode, status="ACTIVE")
        db.add(profile)
        db.flush()
        previous = None
        revision_number = 1
    revision = ImportProfileRevision(
        profile_id=profile.id,
        revision=revision_number,
        matcher_version=MATCHER_VERSION,
        normalizer_version="adaptive-normalizer-v1",
        match_spec=_match_spec(analysis, mapping_spec),
        mapping_spec=mapping_spec,
        validation_spec=validation_spec,
        source_signature=analysis.signature,
        signature_digest=analysis.signature_digest,
        status="VERIFIED",
        supersedes_revision_id=previous.id if previous else None,
        verification_summary=verification_summary,
        verified_at=now,
    )
    db.add(revision)
    db.flush()
    if previous and previous.status == "VERIFIED":
        previous.status = "SUPERSEDED"
    profile.current_revision_id = revision.id
    profile.name = name or profile.name
    profile.updated_at = now
    profile.last_used_at = now
    return profile, revision


def profile_payload(profile: ImportProfile) -> dict[str, Any]:
    current = next((item for item in profile.revisions if item.id == profile.current_revision_id), None)
    return {
        "id": str(profile.id), "key": None, "name": profile.name, "kind": profile.kind,
        "source_mode": profile.source_mode, "status": profile.status,
        "current_revision": current.revision if current else None,
        "current_revision_id": str(current.id) if current else None,
        "revision_count": len(profile.revisions),
        "last_used_at": profile.last_used_at,
        "updated_at": profile.updated_at,
    }


def builtin_payload(item: BuiltinProfile) -> dict[str, Any]:
    return {
        "id": None, "key": item.key, "name": item.name, "kind": "BUILTIN", "source_mode": item.source_mode,
        "status": "ACTIVE", "current_revision": None, "current_revision_id": None, "revision_count": None,
        "last_used_at": None, "updated_at": None, "description": item.description,
    }


def _revision_match(analysis: AnalysisResult, revision: ImportProfileRevision) -> tuple[str, int, dict[str, Any]]:
    if analysis.signature_digest == revision.signature_digest:
        if not _semantic_guards_pass(analysis, revision.match_spec):
            return "DRIFTED", 80, {"reason": "semantic_guard_failed", "revision": revision.revision}
        return "EXACT_MATCH", 100, {"reason": "exact_structure", "revision": revision.revision}
    old_paths = _signature_paths(revision.source_signature)
    new_paths = _signature_paths(analysis.signature)
    overlap = len(old_paths & new_paths) / max(1, len(old_paths | new_paths))
    # Compatibility is intentionally one-way: new optional structure may be
    # added, but a path observed by the verified revision may not disappear.
    compatible = old_paths <= new_paths and _semantic_guards_pass(analysis, revision.match_spec)
    if compatible:
        return "COMPATIBLE", 90, {"reason": "required_structure_preserved", "similarity": overlap, "revision": revision.revision}
    if overlap >= 0.55:
        return "DRIFTED", int(overlap * 80), {"reason": "related_structure_changed", "similarity": overlap, "revision": revision.revision}
    return "NO_MATCH", 0, {"similarity": overlap}


def _match_spec(analysis: AnalysisResult, mapping_spec: dict[str, Any]) -> dict[str, Any]:
    return {
        "source_mode": analysis.mode,
        "required_paths": sorted(_required_paths(mapping_spec)),
        "role_values": sorted(_role_values(analysis)),
        "role_mapping": _role_mapping(mapping_spec),
    }


def _required_paths(mapping: dict[str, Any]) -> set[str]:
    paths: set[str] = set()
    for key, value in mapping.items():
        if key in {"locator", "role", "content", "title", "timestamp", "external_id"} and isinstance(value, str) and value.startswith("$"):
            paths.add(value)
        elif isinstance(value, dict):
            paths |= _required_paths(value)
    return paths


def _signature_paths(signature: dict[str, Any]) -> set[str]:
    if signature.get("mode") == "JSON_MARKDOWN":
        return {f"json:{item}" for item in _signature_paths(signature["json"])} | {f"markdown:{item}" for item in _signature_paths(signature["markdown"])}
    if signature.get("mode") == "MARKDOWN":
        boundary = signature.get("boundary", {})
        return {f"boundary:{boundary.get('kind')}:{boundary.get('level')}", *[f"role:{item}" for item in signature.get("role_labels", [])]}
    return {item["path"] for item in signature.get("paths", [])}


def _semantic_guards_pass(analysis: AnalysisResult, match_spec: dict[str, Any]) -> bool:
    observed = _role_values(analysis)
    mapping = match_spec.get("role_mapping", {})
    return all(value.casefold() in {key.casefold() for key in mapping} for value in observed)


def _role_values(analysis: AnalysisResult) -> set[str]:
    if analysis.mode == "JSON_MARKDOWN":
        return set(analysis.semantic.get("json", {}).get("role_values", [])) | set(analysis.semantic.get("markdown", {}).get("role_values", []))
    return set(analysis.semantic.get("role_values", []))


def _role_mapping(mapping: dict[str, Any]) -> dict[str, str]:
    result = dict(mapping.get("role_mapping") or {})
    for key in ("json", "markdown"):
        if isinstance(mapping.get(key), dict):
            result.update(_role_mapping(mapping[key]))
    return result


def _candidate_evidence(item: tuple[int, str, ImportProfile, ImportProfileRevision, dict[str, Any]]) -> dict[str, Any]:
    score, status, profile, revision, evidence = item
    return {"profile_id": str(profile.id), "revision_id": str(revision.id), "name": profile.name, "status": status, "score": score, **evidence}


def _best_revision_per_profile(
    candidates: list[tuple[int, str, ImportProfile, ImportProfileRevision, dict[str, Any]]],
) -> list[tuple[int, str, ImportProfile, ImportProfileRevision, dict[str, Any]]]:
    by_profile: dict[uuid.UUID, list[tuple[int, str, ImportProfile, ImportProfileRevision, dict[str, Any]]]] = {}
    for candidate in candidates:
        by_profile.setdefault(candidate[2].id, []).append(candidate)
    status_rank = {"EXACT_MATCH": 3, "COMPATIBLE": 2, "DRIFTED": 1}
    return [
        max(
            profile_candidates,
            key=lambda item: (
                status_rank[item[1]],
                item[0],
                item[3].id == item[2].current_revision_id,
                item[3].revision,
            ),
        )
        for profile_candidates in by_profile.values()
    ]


def _builtin(key: str) -> BuiltinProfile:
    return next(item for item in BUILTINS if item.key == key)
