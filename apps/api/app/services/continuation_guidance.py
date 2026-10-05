"""Small, read-only guidance counts from the Index's declared message ranges.

This is not semantic validation. Unknown or foreign ranges never become a
fabricated uncovered count, and no continuation files are modified here.
"""
import hashlib
import json
import uuid

from sqlalchemy import func

from app.models.context_continuation import ContextMemberObject, ContinuationRevision, ContinuationState
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.services.continuation_candidates import ContinuationError, read_object

MESSAGE_THRESHOLD = 100
CHARACTER_THRESHOLD = 60_000


def index_ranges(value, conversation_id, message_count):
    if not isinstance(value, dict):
        return None
    try:
        if uuid.UUID(str(value.get('conversation_id'))) != conversation_id:
            return None
    except (ValueError, TypeError, AttributeError):
        return None
    coverage = value.get('coverage')
    if not isinstance(coverage, dict):
        return None

    def bounds(row):
        if not isinstance(row, dict):
            return None
        start, end = row.get('seq_start'), row.get('seq_end')
        if type(start) is not int or type(end) is not int or not 1 <= start <= end <= message_count:
            return None
        return start, end

    outer = bounds(coverage)
    if outer is None:
        return None
    segments = value.get('segments')
    if not isinstance(segments, list) or not segments:
        return None
    ranges = []
    for segment in segments:
        span = bounds(segment)
        if span is None or span[0] < outer[0] or span[1] > outer[1]:
            return None
        ranges.append(span)
    # Count the union: gaps remain uncovered; overlapping segments count once.
    merged = []
    for start, end in sorted(ranges):
        if merged and start <= merged[-1][1] + 1:
            merged[-1] = (merged[-1][0], max(end, merged[-1][1]))
        else:
            merged.append((start, end))
    return merged


def guidance_counts(db, conversation):
    state = db.get(ContinuationState, conversation.id)
    revision = db.get(ContinuationRevision, state.adopted_revision_id) if state and state.adopted_revision_id else None
    index_digest = revision.index_sha256 if revision else None
    # Database computes sizes; do not return/load conversation bodies for a hint.
    body = MessageVersion.display_text
    nonblank = func.length(func.trim(func.replace(func.replace(func.replace(body, '\n', ''), '\r', ''), '\t', '')))
    query = db.query(Message.id, func.length(body), nonblank).join(
        MessageVersion, MessageVersion.id == Message.current_version_id,
    ).filter(Message.conversation_id == conversation.id, Message.is_deleted.is_(False)).order_by(Message.order_key)
    total = query.count()
    ranges, coverage = [], 'none'
    if index_digest:
        coverage = 'unknown'
        try:
            value = json.loads(read_object(db.get(ContextMemberObject, index_digest)))
            ranges = index_ranges(value, conversation.id, total)
            if ranges is not None:
                coverage = 'declared'
        except (ContinuationError, ValueError, UnicodeError, TypeError):
            ranges = None
    uncovered_count = uncovered_characters = 0
    span_index = 0
    order_digest = hashlib.sha256()
    for seq, (message_id, size, nonempty) in enumerate(query.yield_per(512), 1):
        if coverage == 'unknown':
            continue
        while span_index < len(ranges) and seq > ranges[span_index][1]:
            span_index += 1
        indexed = span_index < len(ranges) and ranges[span_index][0] <= seq <= ranges[span_index][1]
        if indexed:
            order_digest.update(str(message_id).encode('ascii'))
        elif nonempty:
            uncovered_count += 1
            uncovered_characters += size or 0
    # A saved Index is bound to the order at its update. Insertions/deletions
    # inside its ranges must not silently assign its old sequence numbers anew.
    bound = revision.source_metadata.get('guidance_index_order') if revision else None
    if coverage == 'declared' and bound and bound != order_digest.hexdigest():
        coverage = 'unknown'
    known = coverage != 'unknown'
    return {
        'coverage': coverage, 'index_digest': index_digest,
        'unindexed_messages': uncovered_count if known else None,
        'unindexed_characters': uncovered_characters if known else None,
        'suggest_maintenance': known and (uncovered_count >= MESSAGE_THRESHOLD or uncovered_characters >= CHARACTER_THRESHOLD),
        'message_threshold': MESSAGE_THRESHOLD, 'character_threshold': CHARACTER_THRESHOLD,
        'source_revision': conversation.offline_revision,
    }


def index_order_binding(db, conversation_id, raw):
    """Bind declarations to local IDs, not content or semantic correctness."""
    rows = db.query(Message.id).join(MessageVersion, MessageVersion.id == Message.current_version_id).filter(
        Message.conversation_id == conversation_id, Message.is_deleted.is_(False),
    ).order_by(Message.order_key)
    ranges = index_ranges(json.loads(raw), conversation_id, rows.count())
    if ranges is None:
        return None
    digest = hashlib.sha256()
    pointer = 0
    for seq, (message_id,) in enumerate(rows.yield_per(512), 1):
        while pointer < len(ranges) and seq > ranges[pointer][1]:
            pointer += 1
        if pointer < len(ranges) and ranges[pointer][0] <= seq <= ranges[pointer][1]:
            digest.update(str(message_id).encode('ascii'))
    return digest.hexdigest()
