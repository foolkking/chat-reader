"""Message-level canonical writes; the caller owns the atomic outer transaction."""
import hashlib
import json
import uuid
from dataclasses import replace
from datetime import datetime, timezone

from sqlalchemy import insert

from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.render_block import RenderBlock
from app.services.adaptive_import.bounded_io import checkpoint
from app.services.canonical.block_builder import iter_basic_render_blocks
from app.services.database.bulk_insert import insert_rows
from app.services.import_pipeline.canonical_draft import (
    BLOCK_BUILDER_VERSION, MARKDOWN_PARSER_VERSION, NORMALIZER_VERSION, SEARCH_DOCUMENT_VERSION,
)


def conversation_hash(messages):
    """Equivalent to content_hash('\\n'.join(plain_text)), without that join."""
    digest = hashlib.sha256(f"{NORMALIZER_VERSION}\n\n".encode())
    started = False
    pending_newlines = 0
    first_message = True
    for message in messages:
        if not first_message:
            pending_newlines += 1
        first_message = False
        for index, line in enumerate(message.plain_text.replace("\r\n", "\n").replace("\r", "\n").split("\n")):
            if index:
                pending_newlines += 1
            line = line.rstrip()
            if not started:
                line = line.lstrip()
            if not line:
                continue
            if started:
                while pending_newlines:
                    amount = min(pending_newlines, 65536)
                    digest.update(b"\n" * amount)
                    pending_newlines -= amount
            else:
                pending_newlines = 0
            digest.update(line.encode("utf-8"))
            started = True
        checkpoint()
    return digest.hexdigest()


def persist_stream_messages(db, conversation, draft, attachment_map, report, processed_before, total):
    from app.services.canonical.persistence import (
        _persist_canjson_private_content, _rewrite_persistable_attachment_ids, _report,
    )
    for index, (message, record) in enumerate(zip(draft.messages, draft.stream_records, strict=True)):
        checkpoint()
        message = _rewrite_persistable_attachment_ids([message], attachment_map)[0]
        identity = _persist_one(db, conversation, message)
        unit = replace(draft, messages=[message], source_refs=record.get("source_refs", []),
                       attachments=record.get("attachments", []), annotations=[], notebooks=[], stream_records=None)
        _persist_canjson_private_content(db, conversation, unit, identity, attachment_map)
        db.flush()
        completed = processed_before + index + 1
        _report(report, "persisting", min(75, 10 + round(65 * completed / max(total, 1))), completed, total)
        checkpoint()


def _persist_one(db, conversation, message):
    from app.services.canonical.persistence import PersistableVersion
    message_id = uuid.uuid4()
    versions = message.versions or [PersistableVersion(
        source_id=message.source_current_version_id, version_number=1,
        plain_text=message.plain_text, display_text=message.display_text,
        content_hash=message.content_hash, edit_type=message.edit_type, edit_reason=None,
        created_at=None, based_on_source_version_id=None)]
    version_ids = {item.source_id or f"version-{index}": uuid.uuid4() for index, item in enumerate(versions)}
    current_index = next((index for index, item in enumerate(versions)
                          if message.source_current_version_id and item.source_id == message.source_current_version_id), len(versions) - 1)
    current = versions[current_index]
    current_id = version_ids[current.source_id or f"version-{current_index}"]
    # Match the existing bulk writer: current_version_id is a logical pointer,
    # and the version's message FK is satisfied by inserting Message first.
    db.execute(insert(Message), [{
        "id": message_id, "conversation_id": conversation.id, "role": message.role,
        "order_key": message.order_key, "turn_index": message.turn_index, "created_at": message.created_at,
        "current_version_id": current_id, "created_by": "import", "source_type": "import",
        "content_hash": current.content_hash, "block_count": 0, "char_count": len(current.display_text),
        "is_heavy": len(current.display_text) > 12000,
    }])
    current_blocks = 0
    for version_index, version in enumerate(versions):
        version_id = version_ids[version.source_id or f"version-{version_index}"]
        db.execute(insert(MessageVersion), [{
            "id": version_id, "message_id": message_id, "version_number": version.version_number,
            "plain_text": version.plain_text, "display_text": version.display_text, "blocks": [],
            "edit_type": version.edit_type, "edit_reason": version.edit_reason,
            "created_at": version.created_at or datetime.now(timezone.utc), "created_by": "import",
            "based_on_version_id": version_ids.get(version.based_on_source_version_id or ""),
            "content_hash": version.content_hash, "normalizer_version": NORMALIZER_VERSION,
            "markdown_parser_version": MARKDOWN_PARSER_VERSION, "block_builder_version": BLOCK_BUILDER_VERSION,
            "search_document_version": SEARCH_DOCUMENT_VERSION,
        }])
        rows, size = [], 0
        for block_index, block in enumerate(iter_basic_render_blocks(version.display_text)):
            row = {"id": uuid.uuid4(), "message_version_id": version_id, "block_index": block_index,
                   "block_type": block.block_type, "plain_text": block.plain_text, "data": block.data,
                   "char_count": block.char_count, "collapsed_by_default": block.collapsed_by_default,
                   "render_priority": block.render_priority}
            row_size = len(json.dumps(row, ensure_ascii=False, default=str).encode("utf-8"))
            if rows and (len(rows) >= 500 or size + row_size > 256 * 1024):
                insert_rows(db, RenderBlock, rows)
                rows, size = [], 0
                checkpoint()
            rows.append(row)
            size += row_size
            if version_index == current_index:
                current_blocks += 1
        if rows:
            insert_rows(db, RenderBlock, rows)
    db.query(Message).filter(Message.id == message_id).update(
        {"block_count": current_blocks, "is_heavy": len(current.display_text) > 12000 or current_blocks > 80},
        synchronize_session=False)
    return {message.source_message_id: (message_id, version_ids)}
