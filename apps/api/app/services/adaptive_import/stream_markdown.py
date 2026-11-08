"""Disk-backed Markdown analysis and normalization for bounded ZIP imports."""
from __future__ import annotations

import re
from collections import Counter
from dataclasses import replace
from pathlib import Path

from app.services.adaptive_import.bounded_io import MESSAGE_BYTES, checkpoint, text_lines, unit_too_large
from app.services.adaptive_import.contracts import AdaptiveImportError, AnalysisResult
from app.services.import_pipeline.canonical_draft import CanonicalDraftMessage, CanonicalDraftVersion
from app.services.import_pipeline.record_spool import MappedSequence, RecordSpool


def decode_message(raw):
    return CanonicalDraftMessage(**{key: value for key, value in raw.items() if key != "versions"},
                                 versions=[CanonicalDraftVersion(**item) for item in raw.get("versions", [])])


def analyze_path(document):
    from app.services.adaptive_import.analysis import (
        ANALYZER_VERSION, _ROLE_ALIASES, _heading_metadata, analyze_documents, signature_digest,
    )
    from app.services.adaptive_import.contracts import SourceDocument
    path = document.path
    # Existing native/transcript detectors remain authoritative for bounded inputs.
    if path.stat().st_size <= MESSAGE_BYTES:
        return analyze_documents([SourceDocument(document.artifact_id, document.filename,
                                                 document.extension, path.read_bytes())])
    buckets = {}
    active = None
    fence_styles = set()
    has_title = False
    context = instruction = rescue = False
    references = 0
    nonempty = False
    header = []
    native_header = []
    native_markers = 0
    for number, source in enumerate(text_lines(path), 1):
        line = source.rstrip("\r\n")
        if number <= 8:
            header.append(line)
        if number <= 64 and sum(len(value) for value in native_header) < 65536:
            native_header.append(line)
        native_markers += int(bool(re.match(r"^<!--\s*chat-reader-message\b", line)))
        nonempty |= bool(line.strip())
        has_title |= bool(re.match(r"^#\s+\S", line))
        context |= bool(re.search(r"conversation\s+context\s+package|context\s+package|接续上下文", line, re.I))
        instruction |= bool(re.search(r"instruction\s+boundary|当前有效指令|历史上下文|你的任务不是简单总结|\bfull\s+file\s+size\b", line, re.I))
        rescue |= bool(re.match(r"^name:\s*chat-reader-conversation-rescue\s*$", line) or "Conversation Rescue & Canonicalization Skill" in line)
        references += int(bool(re.match(r"^\s*\[L\d+(?:[-–]\d+)?\]", line)))
        fence = re.match(r"^ {0,3}(`{3,}|~{3,})", line)
        if fence:
            fence_styles.add(fence[1][:3])
        if active:
            if fence and fence[1][0] == active[0] and len(fence[1]) >= active[1] and not line[fence.end():].strip():
                active = None
            continue
        if fence:
            active = (fence[1][0], len(fence[1]))
            continue
        heading = re.match(r"^ {0,3}(#{1,6})[ \t]+(.+?)\s*#*\s*$", line)
        label = re.match(r"^\s*([^:#：]{1,40})\s*[:：]\s*$", line) if not heading else None
        metadata = _heading_metadata(heading[2]) if heading else None
        role = metadata["role"] if metadata else label[1].strip() if label else ""
        if role.casefold() not in _ROLE_ALIASES:
            continue
        key = ("HEADING", len(heading[1])) if heading else ("LINE_LABEL", None)
        item = buckets.setdefault(key, {"kind": key[0], "level": key[1], "count": 0,
                                       "roles": Counter(), "first_line": number,
                                       "identity_count": 0, "timestamp_count": 0})
        item["count"] += 1
        item["roles"][role] += 1
        item["identity_count"] += int(bool(metadata and metadata["external_id"]))
        item["timestamp_count"] += int(bool(metadata and metadata["timestamp"]))
        if number % 256 == 0:
            checkpoint()
    if not nonempty:
        raise AdaptiveImportError("MARKDOWN_EMPTY", "The Markdown file is empty.", layer="file")
    front_matter = re.match(r"\A---\n(?P<body>.*?)(?:\n---)\s*", "\n".join(native_header), re.S)
    if native_markers and front_matter and re.search(r'^format:\s*["\']chat-reader-markdown-export["\']\s*$', front_matter["body"], re.M) and re.search(r'^version:\s*["\']?2["\']?\s*$', front_matter["body"], re.M):
        signature = {"version": ANALYZER_VERSION, "mode": "MARKDOWN",
                     "builtin": "chat-reader-markdown-v2", "message_markers": native_markers}
        return AnalysisResult("MARKDOWN", signature, signature_digest(signature),
                              {"boundaries": [], "suggested": {"native": True, "title": "FIRST_H1_OR_FILENAME",
                               "boundary": {"kind": "NATIVE_MARKER", "level": None}, "role_mapping": {}, "preamble": "IGNORE"}},
                              semantic={"native": True}, handling_class="SUPPORTED")
    # The native marker and Normalizer formats need their own exact boundary rules.
    if len(header) >= 3 and header[0].startswith("# ") and header[1] == "" and header[2].startswith("**User:** "):
        signature = {"version": ANALYZER_VERSION, "mode": "MARKDOWN", "builtin": "chatgpt-markdown-transcript-v1"}
        return AnalysisResult("MARKDOWN", signature, signature_digest(signature),
                              {"boundaries": [], "suggested": {"title": "FIRST_H1_OR_FILENAME",
                               "boundary": {"kind": "NATIVE_MARKER", "level": None}, "role_mapping": {}, "preamble": "IGNORE"}},
                              handling_class="SUPPORTED")
    if rescue or (context and instruction and references >= 3):
        raise AdaptiveImportError("DOCUMENT_NOT_TRANSCRIPT", "This is an instruction document, not a transcript.", layer="analysis")
    if active:
        raise AdaptiveImportError("MARKDOWN_FENCE_UNCLOSED", "A fenced code block is not closed.", layer="analysis")
    viable = [{**item, "roles": dict(item["roles"])} for item in buckets.values() if item["count"] >= 2]
    viable.sort(key=lambda item: (-item["count"], item["kind"], item["level"] or 0))
    if not viable:
        raise unit_too_large()  # A boundary-free document is one real message.
    selected = viable[0]
    roles = sorted(selected["roles"])
    suggestions = {role: _ROLE_ALIASES[role.casefold()] for role in roles}
    boundary = {"kind": selected["kind"], "level": selected["level"]}
    signature = {"version": ANALYZER_VERSION, "mode": "MARKDOWN", "boundary": boundary,
                 "role_labels": roles, "has_title": has_title, "fence_styles": sorted(fence_styles)}
    return AnalysisResult("MARKDOWN", signature, signature_digest(signature),
                          {"boundaries": viable, "suggested": {"boundary": boundary,
                           "role_mapping": suggestions, "preamble": "IGNORE", "title": "FIRST_H1_OR_FILENAME"}},
                          semantic={"role_values": roles, "role_suggestions": suggestions})


def sections(path: Path, boundary: dict, labels: set[str]):
    """Yield preamble and real message sections, keeping at most one body."""
    from app.services.adaptive_import.normalization import _boundary_metadata
    kind, level = boundary.get("kind"), boundary.get("level")
    heading = re.compile(rf"^ {{0,3}}#{{{int(level)}}}[ \t]+(.+?)\s*#*\s*$") if kind == "HEADING" and level else None
    label = re.compile(r"^\s*([^:#：]{1,40})\s*[:：]\s*$") if kind == "LINE_LABEL" else None
    active = None
    metadata = None
    body = []
    size = 0
    for number, source in enumerate(text_lines(path), 1):
        line = source.rstrip("\r\n")
        fence = re.match(r"^ {0,3}(`{3,}|~{3,})", line)
        match = None
        if active:
            if fence and fence[1][0] == active[0] and len(fence[1]) >= active[1] and not line[fence.end():].strip():
                active = None
        elif fence:
            active = (fence[1][0], len(fence[1]))
        else:
            match = heading.match(line) if heading else label.match(line) if label else None
        candidate = _boundary_metadata(match[1]) if match else None
        if candidate and candidate["label"].casefold() in labels:
            yield metadata, "\n".join(body)
            metadata = {**candidate, "line": number}
            body, size = [], 0
        else:
            size += len(line.encode("utf-8")) + 1
            if size > MESSAGE_BYTES:
                raise unit_too_large()
            body.append(line)
        if number % 256 == 0:
            checkpoint()
    yield metadata, "\n".join(body)


def normalize_path(document, spec, profile_name, *, builtin_key=None):
    from app.services.adaptive_import.normalization_cache import cached_normalization
    return cached_normalization(document, spec, profile_name, builtin_key,
                                lambda: _normalize_path(document, spec, profile_name, builtin_key=builtin_key))


def _normalize_path(document, spec, profile_name, *, builtin_key=None):
    from app.services.adaptive_import.analysis import default_mapping
    from app.services.adaptive_import.normalization import _draft_conversation, _draft_message, _markdown_title
    from app.services.adaptive_import.contracts import CANONICAL_ROLES
    path = document.path
    if builtin_key in {"builtin:chat-reader-markdown-v2", "builtin:chatgpt-markdown-transcript-v1"}:
        from app.services.adaptive_import.stream_native_markdown import normalize_native_path
        return normalize_native_path(document, builtin_key)
    if builtin_key in {"builtin:conversation-zip-markdown-v1", "builtin:chat-reader-markdown"}:
        spec = default_mapping(analyze_path(document))
        if builtin_key == "builtin:conversation-zip-markdown-v1":
            profile_name = "Conversation export ZIP"
    if builtin_key == "builtin:single-assistant-markdown-v1":
        profile_name = "Single Markdown message"
    roles = {str(key).casefold(): value for key, value in (spec.get("role_mapping") or {}).items()}
    single = builtin_key == "builtin:single-assistant-markdown-v1" or (spec.get("messages") or {}).get("single_message")
    metadata = {"title": None, "first": None, "user": 0, "assistant": 0, "empty": 0}
    for line in text_lines(path):
        title = _markdown_title(line)
        if title:
            metadata["title"] = title
            break
    message_spec = spec.get("messages") or {}
    keep = any(rule.get("region") == "PREAMBLE" and rule.get("action") == "KEEP" for rule in spec.get("noise_rules", []))

    def records():
        if single:
            if path.stat().st_size > MESSAGE_BYTES:
                raise unit_too_large()
            text = path.read_bytes().decode("utf-8-sig")
            metadata["title"] = _markdown_title(text)
            message = _draft_message("assistant", text, 0, None, None, source_markdown_index=0)
            metadata["assistant"], metadata["empty"] = 1, int(not message.plain_text.strip())
            yield {"message": message, "source_refs": [], "attachments": []}
            return
        preamble = ""
        count = 0
        for boundary, body in sections(path, message_spec.get("boundary") or {}, set(roles)):
            if metadata["title"] is None:
                metadata["title"] = _markdown_title(body)
            if boundary is None:
                preamble = body.strip() if keep else ""
                continue
            role = roles.get(boundary["label"].casefold())
            if role not in CANONICAL_ROLES:
                raise AdaptiveImportError("ROLE_UNMAPPED", "A message role is not mapped.", layer="normalization")
            text = body.strip()
            if count == 0 and preamble:
                text = f"{preamble}\n\n{text}".strip()
            if len(text.encode("utf-8")) > MESSAGE_BYTES:
                raise unit_too_large()
            message = _draft_message(role, text, count,
                boundary["timestamp"] if message_spec.get("timestamp") == "BOUNDARY_METADATA_TIMESTAMP" else None,
                boundary["external_id"] if message_spec.get("external_id") == "BOUNDARY_METADATA_ID" else None,
                source_markdown_index=count)
            metadata["user"] += int(role == "user")
            metadata["assistant"] += int(role == "assistant")
            metadata["empty"] += int(not message.plain_text.strip())
            if role == "user" and metadata["first"] is None:
                metadata["first"] = message.plain_text
            yield {"message": message, "source_refs": [], "attachments": []}
            count += 1
        if not count:
            raise AdaptiveImportError("MARKDOWN_BOUNDARY_MISSING", "Configured Markdown boundaries were not found.", layer="normalization")

    spool = RecordSpool.write(path.parent, records(), prefix="messages")
    draft = _draft_conversation(metadata["title"] or Path(document.filename).stem, [], profile_name, source_type="adaptive_markdown")
    return [replace(draft, messages=MappedSequence(spool, lambda raw: decode_message(raw["message"])),
                    stream_records=spool, message_count=len(spool), turn_count=metadata["user"],
                    prompt_count=metadata["user"], response_count=metadata["assistant"],
                    first_user_message=metadata["first"], empty_message_count=metadata["empty"])]


def resource_chunks(path: Path):
    """Paragraph scanner with fenced/literal regions kept intact across IO reads."""
    buffer = []
    size = 0
    fence = None
    literals = {"pre": 0, "code": 0}
    for line in text_lines(path):
        # A role heading is a real message boundary, not a size-based split.
        # This permits long transcripts without blank separator lines.
        from app.services.adaptive_import.analysis import _ROLE_ALIASES, _heading_metadata
        heading = re.match(r"^ {0,3}#{1,6}[ \t]+(.+?)\s*#*\s*$", line.rstrip("\r\n"))
        role = _heading_metadata(heading[1])["role"].casefold() if heading else ""
        marker_start = line.strip() == "<!-- chat-reader-message"
        if buffer and not fence and not any(literals.values()) and (role in _ROLE_ALIASES or marker_start):
            yield "".join(buffer)
            buffer, size = [], 0
            checkpoint()
        size += len(line.encode("utf-8"))
        if size > MESSAGE_BYTES:
            raise unit_too_large()
        buffer.append(line)
        prefix = re.match(r"^(?: {0,3}>[ \t]?)*", line)[0]
        body = re.sub(r"^ {0,3}(?:[-+*]|\d+[.)])[ \t]+", "", line[len(prefix):])
        marker = re.match(r"(`{3,}|~{3,})(.*)", body.lstrip())
        if fence and prefix.count(">") < fence[2]:
            fence = None
        if fence:
            if marker and marker[1][0] == fence[0] and len(marker[1]) >= fence[1] and not marker[2].strip():
                fence = None
        elif marker:
            fence = (marker[1][0], len(marker[1]), prefix.count(">"))
        if not fence:
            for tag in re.finditer(r"<(/?)(code|pre)\b[^<>]*>", body, re.I):
                name = tag[2].casefold()
                if tag[1]:
                    literals[name] = max(0, literals[name] - 1)
                elif not tag[1] and not tag[0].endswith("/>"):
                    literals[name] += 1
        if not line.strip() and not fence and not any(literals.values()):
            yield "".join(buffer)
            buffer, size = [], 0
            checkpoint()
    if buffer:
        yield "".join(buffer)
