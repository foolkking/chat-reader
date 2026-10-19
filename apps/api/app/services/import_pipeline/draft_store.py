from __future__ import annotations

import hashlib
import json
import os
import uuid
from collections.abc import Iterable
from contextlib import closing
from dataclasses import fields, is_dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.core.config import get_settings
from app.models.import_record import ImportRecord
from app.services.import_pipeline.canonical_draft import (
    CanonicalDraftConversation,
    CanonicalDraftMessage,
    CanonicalDraftVersion,
)
from app.services.uploads import UploadLimitError, bounded_analysis_admission_sync


class ImportDraftError(ValueError):
    pass


def _draft_json_default(value):
    if is_dataclass(value) and not isinstance(value, type):
        # JSONEncoder traverses the existing lists lazily. asdict() would first
        # clone every message/version container in this conversation.
        return {field.name: getattr(value, field.name) for field in fields(value)}
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def write_import_draft(
    import_id: uuid.UUID,
    conversations: Iterable[CanonicalDraftConversation],
) -> tuple[str, str, dict, datetime]:
    root = Path(get_settings().import_storage_dir).resolve()
    directory = (root / str(import_id)).resolve()
    if not directory.is_relative_to(root):
        raise ImportDraftError("Invalid import draft path.")
    directory.mkdir(parents=True, exist_ok=True)
    destination = directory / "canonical-draft.jsonl"
    temporary = directory / f".{destination.name}.{uuid.uuid4().hex}.tmp"
    digest = hashlib.sha256()
    message_count = 0
    conversation_count = 0
    encoder = json.JSONEncoder(ensure_ascii=False, separators=(",", ":"), default=_draft_json_default)
    try:
        with temporary.open("xb") as handle:
            for conversation in conversations:
                for chunk in encoder.iterencode(conversation):
                    encoded = chunk.encode("utf-8")
                    handle.write(encoded)
                    digest.update(encoded)
                handle.write(b"\n")
                digest.update(b"\n")
                conversation_count += 1
                message_count += len(conversation.messages)
                del encoded, conversation
            handle.flush()
            os.fsync(handle.fileno())
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=get_settings().import_draft_ttl_hours)
    summary = {"conversation_count": conversation_count, "message_count": message_count}
    return str(destination.relative_to(root)), digest.hexdigest(), summary, expires_at


def attach_import_draft(record: ImportRecord, conversations: Iterable[CanonicalDraftConversation]) -> None:
    storage_uri, sha256, summary, expires_at = write_import_draft(record.id, conversations)
    record.draft_storage_uri = storage_uri
    record.draft_sha256 = sha256
    record.draft_summary = summary
    record.draft_expires_at = expires_at


def read_import_draft(record: ImportRecord) -> list[CanonicalDraftConversation]:
    return list(iter_import_draft(record))


def iter_import_draft(record: ImportRecord):
    if not record.draft_storage_uri or not record.draft_sha256:
        raise ImportDraftError("Import preview has no durable canonical draft.")
    root = Path(get_settings().import_storage_dir).resolve()
    stored_path = Path(record.draft_storage_uri)
    path = stored_path.resolve() if stored_path.is_absolute() else (root / stored_path).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise ImportDraftError("Import draft is missing.")
    if record.draft_expires_at is not None:
        expires_at = record.draft_expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at <= datetime.now(timezone.utc):
            raise ImportDraftError("Import draft has expired.")
    expected_conversations = int((record.draft_summary or {}).get("conversation_count") or 0)
    expected_messages = int((record.draft_summary or {}).get("message_count") or 0)
    actual_conversations = 0
    actual_messages = 0
    max_line_bytes = max(1, get_settings().max_import_file_size_mb * 1024 * 1024 * 2)

    with path.open("rb") as handle, closing(_admitted_draft_lines(handle, max_line_bytes)) as lines:
        for line_number, raw_line in enumerate(lines, start=1):
            if not raw_line.strip():
                continue
            try:
                payload = json.loads(raw_line)
                raw_messages = payload.pop("messages")
                if not isinstance(raw_messages, list):
                    raise TypeError("messages must be a list")
                messages = []
                for raw_message in raw_messages:
                    versions = [CanonicalDraftVersion(**item) for item in raw_message.pop("versions", [])]
                    messages.append(CanonicalDraftMessage(**raw_message, versions=versions))
                conversation = CanonicalDraftConversation(**payload, messages=messages)
            except (KeyError, TypeError, ValueError, json.JSONDecodeError, RecursionError) as exc:
                raise ImportDraftError(f"Import draft line {line_number} is invalid.") from exc
            del raw_line
            actual_conversations += 1
            actual_messages += len(messages)
            yield conversation
            del conversation, messages, payload, raw_messages

    if expected_conversations and actual_conversations != expected_conversations:
        raise ImportDraftError("Import draft conversation count does not match preview.")
    if expected_messages and actual_messages != expected_messages:
        raise ImportDraftError("Import draft message count does not match preview.")


def _admitted_draft_lines(handle, max_line_bytes: int):
    """Measure one record in bounded reads before materializing/parsing it.

    Preview and commit may run hours apart under different memory pressure.
    Keep admission for the current conversation through its persistence, not
    for the sum of independent conversations in a multi-file batch.
    """
    line_number = 0
    while True:
        start = handle.tell()
        size = 0
        while True:
            chunk = handle.readline(min(1024 * 1024, max_line_bytes + 1 - size))
            if not chunk:
                break
            size += len(chunk)
            if size > max_line_bytes:
                raise ImportDraftError(f"Import draft line {line_number + 1} exceeds the configured size limit.")
            if chunk.endswith(b"\n"):
                break
        if not size:
            return
        del chunk
        line_number += 1
        handle.seek(start)
        try:
            with bounded_analysis_admission_sync([size], force_memory_check=True):
                yield handle.read(size)
        except UploadLimitError as exc:
            raise ImportDraftError(
                "The server cannot safely commit this import under current memory pressure. "
                "Retry when other work finishes, or split the source into smaller conversations."
            ) from exc
