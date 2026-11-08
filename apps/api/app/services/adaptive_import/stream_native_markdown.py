"""Bounded versions of the two existing explicit Markdown message grammars."""
from collections import deque
from dataclasses import replace
import re

from app.services.adaptive_import.bounded_io import MESSAGE_BYTES, text_lines, unit_too_large
from app.services.adaptive_import.normalization import _draft_conversation, _draft_message
from app.services.adaptive_import.stream_markdown import decode_message
from app.services.import_pipeline.record_spool import MappedSequence, RecordSpool


def normalize_native_path(document, key):
    metadata = {"title": document.filename.rsplit(".", 1)[0], "conversation": {}}
    counts = {"user": 0, "assistant": 0, "empty": 0, "first": None}
    transcript = key == "builtin:chatgpt-markdown-transcript-v1"

    def records():
        iterator = _transcript(document.path, metadata) if transcript else _native(document.path, metadata)
        for index, item in enumerate(iterator):
            role, body, timestamp, model = item
            if not transcript and role not in {"user", "assistant", "system", "developer", "tool"}:
                continue
            identity = f"transcript:{index + 1}" if transcript else None
            message = _draft_message(role, body, index, timestamp, identity, source_markdown_index=index)
            counts["user"] += role == "user"
            counts["assistant"] += role == "assistant"
            counts["empty"] += not message.plain_text.strip()
            if role == "user" and counts["first"] is None:
                counts["first"] = message.plain_text
            refs = []
            if transcript:
                refs = [{"message_id": identity, "source_message_id": identity, "source_index": index,
                         "source_type": "adaptive_markdown", "source_profile": "chatgpt-markdown-transcript-v1",
                         "source_metadata": {"timestamp_display": timestamp or "Unknown", "model": model,
                          "locator_kind": "transcript_order",
                          **({"conversation": metadata["conversation"]} if index == 0 else {})}}]
            yield {"message": message, "source_refs": refs, "attachments": []}
    spool = RecordSpool.write(document.path.parent, records(), prefix="native")
    if not len(spool):
        raise ValueError("Native Markdown contains no messages.")
    name = "ChatGPT Markdown Transcript Profile v1" if transcript else "Chat Reader Native Markdown Export v2"
    header = _draft_conversation(metadata["title"], [], name, source_type="adaptive_markdown")
    extra = {}
    if transcript:
        from app.services.import_pipeline.exporter_json_parser import extract_conversation_id
        extra = {"created_at": metadata["conversation"].get("created"), "updated_at": metadata["conversation"].get("updated"),
                 "external_source_id": extract_conversation_id(metadata["conversation"].get("link"))}
    return [replace(header, messages=MappedSequence(spool, lambda raw: decode_message(raw["message"])),
                    stream_records=spool, message_count=len(spool), turn_count=counts["user"],
                    prompt_count=counts["user"], response_count=counts["assistant"],
                    first_user_message=counts["first"], empty_message_count=counts["empty"], **extra)]


def _native(path, metadata):
    from app.services.import_pipeline.exporter_markdown_parser import (
        _marker_metadata, _marker_role, _next_fence_state, _remove_generated_message_heading, _split_time_from_body,
    )
    def source_lines():
        for line in text_lines(path):
            if line.strip().startswith("# ") and not metadata.get("title_found"):
                metadata["title"] = line.strip()[2:].strip()
                metadata["title_found"] = True
            yield line
    source = iter(source_lines())
    fence, length = None, 0
    for line in source:
        stripped = line.strip()
        fence, length, changed = _next_fence_state(stripped, fence, length)
        if changed or fence or stripped != "<!-- chat-reader-message":
            continue
        lines, size = [], 0
        for line in source:
            if line.strip() == "-->":
                break
            size += len(line.encode("utf-8"))
            if size > 65536:
                raise ValueError("Native marker metadata is too large.")
            lines.append(line.strip())
        else:
            raise ValueError("Native marker is not closed.")
        info = _marker_metadata(lines)
        role = _marker_role(info.get("role"))
        body, size = [], 0
        for line in source:
            fence, length, changed = _next_fence_state(line.strip(), fence, length)
            if not changed and not fence and line.strip() == "<!-- /chat-reader-message -->":
                break
            body.append(line)
            size += len(line.encode("utf-8"))
            if size > MESSAGE_BYTES:
                raise unit_too_large()
        else:
            raise ValueError("Native message is not closed.")
        text = _remove_generated_message_heading("".join(body).strip(), role, info.get("order_key"))
        timestamp = info.get("created_at")
        if timestamp is None:
            timestamp, text = _split_time_from_body(text)
        yield role, text, timestamp, None


def _transcript(path, metadata):
    from app.services.import_pipeline.transcript_markdown import _FENCE, _TIMESTAMP
    source = iter(text_lines(path))
    header = [next(source, "").rstrip("\r\n") for _ in range(8)]
    if not header[0].startswith("# ") or header[1] or header[7]:
        raise ValueError("Incomplete transcript header.")
    metadata["title"] = header[0][2:]
    values = {}
    for index, name in enumerate(("User", "Created", "Updated", "Exported", "Link"), 2):
        prefix = f"**{name}:** "
        if not header[index].startswith(prefix) or not header[index][len(prefix):].strip():
            raise ValueError("Incomplete transcript metadata.")
        values[name.lower()] = header[index][len(prefix):].rstrip()
    if values["link"] == "N/A":
        values.pop("link")
    else:
        match = re.fullmatch(r"\[([^\]]+)\]\(([^)]+)\)", values["link"])
        if not match or match[1] != match[2]:
            raise ValueError("Transcript link label and target must match.")
        values["link"] = match[2]
    metadata["conversation"] = values
    pending = deque()
    previous = ""
    fence = literal = None
    length = 0
    current = None
    body, size = [], 0
    while True:
        while len(pending) < 3:
            raw = next(source, None)
            if raw is None:
                break
            pending.append(raw.rstrip("\r\n"))
        if not pending:
            break
        line = pending.popleft()
        candidate = None
        if not fence and not literal and line in {"## Prompt:", "## Response:"} and previous == "" and len(pending) >= 2 and pending[1] == "":
            meta = pending[0]
            timestamp, separator, model = meta.partition(" · ") if line == "## Response:" else (meta, "", "")
            if _TIMESTAMP.fullmatch(timestamp) and (line == "## Prompt:" or separator and model.strip()):
                candidate = ("user" if line == "## Prompt:" else "assistant", None if timestamp == "Unknown" else timestamp, model or None)
        if candidate:
            if current:
                # Exactly one separator before the next boundary is not body.
                text = "\n".join(body[:-1] if body and body[-1] == "" else body)
                if not text.strip():
                    raise ValueError("Transcript messages must have content.")
                yield current[0], text, current[1], current[2]
            elif body:
                raise ValueError("Transcript has no valid first boundary.")
            pending.popleft()
            pending.popleft()
            current, body, size, previous = candidate, [], 0, ""
            continue
        if literal:
            if re.search(rf"</{literal}\s*>", line, re.I):
                literal = None
        else:
            token = _FENCE.match(line)
            if token:
                if fence is None:
                    fence, length = token[1][0], len(token[1])
                elif token[1][0] == fence and len(token[1]) >= length and not token[2].strip():
                    fence = None
            elif fence is None:
                html = re.match(r"^ {0,3}<(pre|code)(?:\s|>)", line, re.I)
                if html and not re.search(rf"</{html[1]}\s*>", line, re.I):
                    literal = html[1]
        body.append(line)
        size += len(line.encode("utf-8")) + 1
        if size > MESSAGE_BYTES:
            raise unit_too_large()
        previous = line
    if not current or not "\n".join(body).strip():
        raise ValueError("Transcript messages must have content.")
    yield current[0], "\n".join(body), current[1], current[2]
