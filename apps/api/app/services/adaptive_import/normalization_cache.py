"""Reusable, immutable completed normalization checkpoints in the owned session.

Only a complete verified spool is published. Source/configuration/parser changes
select another key; a partial write can never become a canonical import plan.
"""
import hashlib
import json
import os
import uuid
from dataclasses import fields

from app.services.adaptive_import.bounded_io import file_hash, release_file_cache
from app.services.import_pipeline.canonical_draft import (
    BLOCK_BUILDER_VERSION, PARSER_VERSION, CanonicalDraftConversation,
)
from app.services.import_pipeline.record_spool import MappedSequence, RecordSpool, json_default


def cached_normalization(document, spec, profile_name, builtin_key, build):
    from app.services.adaptive_import.stream_markdown import decode_message
    configuration = json.dumps(
        ["bounded-markdown-v1", PARSER_VERSION, BLOCK_BUILDER_VERSION, file_hash(document.path),
         document.filename, spec, profile_name, builtin_key],
        sort_keys=True, ensure_ascii=False, separators=(",", ":"),
    ).encode("utf-8")
    key = hashlib.sha256(configuration).hexdigest()
    path = document.path.parent / f".normalized-{key}.json"
    try:
        if path.is_file() and not path.is_symlink() and path.stat().st_size <= 2 * 1024 * 1024:
            cached = json.loads(path.read_bytes())
            if cached["key"] != key:
                raise ValueError("Invalid normalization checkpoint.")
            spool = RecordSpool.open_verified(path.parent, cached["records"])
            header = cached["header"]
            if header["message_count"] != len(spool):
                raise ValueError("Invalid normalization count.")
            return [CanonicalDraftConversation(**header, stream_records=spool,
                messages=MappedSequence(spool, lambda raw: decode_message(raw["message"])))]
    except (OSError, ValueError, KeyError, TypeError) as exc:
        # A cache is never the source of truth. Keep retained source bytes and
        # rebuild only the derived checkpoint; admission failures still escape.
        from app.services.adaptive_import.memory_budget import checkpoint
        from app.services.uploads import UploadLimitError
        if isinstance(exc, UploadLimitError):
            raise
        checkpoint()
    drafts = build()
    if len(drafts) == 1 and isinstance(drafts[0].stream_records, RecordSpool):
        draft = drafts[0]
        payload = {"key": key, "records": draft.stream_records.descriptor(),
                   "header": {field.name: getattr(draft, field.name) for field in fields(draft)
                              if field.name not in {"messages", "stream_records"}}}
        temporary = path.with_name(f".checkpoint-{uuid.uuid4().hex}.tmp")
        try:
            with temporary.open("x", encoding="utf-8", newline="\n") as output:
                json.dump(payload, output, ensure_ascii=False, separators=(",", ":"), default=json_default)
                release_file_cache(output, written=True)
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)
    return drafts
