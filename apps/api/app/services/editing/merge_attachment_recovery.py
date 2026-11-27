"""Target-only recovery of attachment references during conversation merge.

The caller authorizes and snapshots the source conversations, builds one
attachment map per source, and validates the final copied graph and hashes.
This module neither resolves external files nor changes any source rows.
All writes belong to the caller's transaction; exceptions must roll it back.
"""

import uuid
from bisect import bisect_left, bisect_right
from collections import Counter
from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from app.models.attachment import Attachment, MessageVersionAttachment
from app.models.import_record import utc_now
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.render_block import RenderBlock
from app.services.database.bulk_insert import insert_rows
from app.services.editing.attachment_reference_rewriter import (
    MarkdownReferenceContext,
    attachment_block_ids,
    attachment_blocks_ids,
    attachment_markdown_ids,
    attachment_source_references,
    markdown_reference_context,
)

_QUERY_BATCH_SIZE = 200


@dataclass
class MergeAttachmentRecovery:
    target_id: uuid.UUID
    maps_by_source: dict[uuid.UUID, dict[uuid.UUID, uuid.UUID]]
    # Target identities, including pre-existing owned missing attachments
    # cloned by the caller. Never count a source identity across scopes.
    missing_attachment_ids: set[uuid.UUID] = field(default_factory=set)
    repaired_occurrences: int = 0
    unlocated_occurrences: int = 0

    def mapping_for(self, source_conv_id: uuid.UUID) -> dict[uuid.UUID, uuid.UUID]:
        if source_conv_id == self.target_id or source_conv_id not in self.maps_by_source:
            raise ValueError("Merge attachment source scope is not registered.")
        return self.maps_by_source[source_conv_id]

    def ensure_references(
        self, db: Session, source_conv_id: uuid.UUID, ids: set[uuid.UUID],
    ) -> None:
        """Map unavailable references without looking up their attachment rows.

        The caller populated this source's map with its owned attachments.
        A reference absent from that map is therefore unavailable in THIS
        source, even when another authorized merge source owns the same ID.
        """
        mapping = self.mapping_for(source_conv_id)
        unmapped = sorted(ids - mapping.keys(), key=str)
        for offset in range(0, len(unmapped), _QUERY_BATCH_SIZE):
            rows = []
            additions = {}
            for source_id in unmapped[offset:offset + _QUERY_BATCH_SIZE]:
                target_id = uuid.uuid4()
                additions[source_id] = target_id
                rows.append({
                    "id": target_id,
                    "conversation_id": self.target_id,
                    "asset_object_id": None,
                    "import_id": None,
                    "original_filename": "missing-attachment.bin",
                    "display_name": "Unavailable attachment",
                    "declared_mime_type": None,
                    "detected_mime_type": None,
                    "status": "missing",
                    "scan_status": "not_available",
                    "source_type": "conversation_merge",
                    "source_attachment_id": str(source_id),
                    "metadata_": {
                        "merge_recovery": {
                            "reason": "reference_unavailable",
                            "source_conversation_id": str(source_conv_id),
                        },
                    },
                    "resolution_status": "missing",
                    "created_at": utc_now(),
                    "deleted_at": None,
                })
            insert_rows(db, Attachment, rows)
            mapping.update(additions)
            self.missing_attachment_ids.update(additions.values())

    def summary(self) -> dict[str, int]:
        return {
            "missing_attachments": len(self.missing_attachment_ids),
            "repaired_occurrences": self.repaired_occurrences,
            "unlocated_occurrences": self.unlocated_occurrences,
        }


def recover_occurrences(
    db: Session,
    *,
    source_version_id: uuid.UUID,
    target_version_id: uuid.UUID,
    attachment_id_map: dict[uuid.UUID, uuid.UUID],
    recovery: MergeAttachmentRecovery,
) -> int:
    """Copy/recover one version's occurrences after its target blocks exist.

    Preserve original occurrence keys, repeated links and presentation fields.
    Only a unique real block can relocate an invalid original link. Otherwise
    keep it unlocated. Missing block associations are added from typed target
    references, never by rebuilding the body or matching attachment names.

    This is called once per newly copied target version. Transaction retries
    create a new target and recovery object; they must not replay this helper
    against an already published version.
    """
    source_conv_id = (
        db.query(Message.conversation_id)
        .join(MessageVersion, MessageVersion.message_id == Message.id)
        .filter(MessageVersion.id == source_version_id)
        .scalar()
    )
    if source_conv_id is None or attachment_id_map != recovery.mapping_for(source_conv_id):
        raise ValueError("Merge occurrence source mapping is inconsistent.")
    version = (
        db.query(MessageVersion)
        .join(Message, Message.id == MessageVersion.message_id)
        .filter(
            MessageVersion.id == target_version_id,
            Message.conversation_id == recovery.target_id,
        )
        .one_or_none()
    )
    if version is None:
        raise ValueError("Merge occurrence target version is outside the target conversation.")
    if db.query(MessageVersionAttachment.id).filter(
        MessageVersionAttachment.message_version_id == target_version_id,
    ).first() is not None:
        raise ValueError("Merge occurrence target version already has attachment links.")

    blocks = (
        db.query(RenderBlock)
        .filter(RenderBlock.message_version_id == target_version_id)
        .order_by(RenderBlock.block_index)
        .all()
    )
    projections = [{
        name: getattr(block, name)
        for name in ("block_index", "block_type", "plain_text", "data", "sanitized_html")
    } for block in blocks]
    context = markdown_reference_context(
        version.display_text or "", blocks=version.blocks or projections,
    )
    version_references = (
        attachment_markdown_ids(version.display_text or "", context)
        | attachment_blocks_ids(version.blocks or [], context)
    )
    projected_references = {
        block["block_index"]: attachment_block_ids(block, context) for block in projections
    }
    counts_by_block, source_counts = _occurrence_counts(blocks, projected_references, context)
    references_by_block = {index: set(counts) for index, counts in counts_by_block.items()}
    candidate_blocks: dict[uuid.UUID, list[int]] = {}
    for block_index, identities in references_by_block.items():
        for attachment_id in identities:
            candidate_blocks.setdefault(attachment_id, []).append(block_index)

    source_links = (
        db.query(MessageVersionAttachment)
        .filter(MessageVersionAttachment.message_version_id == source_version_id)
        .order_by(MessageVersionAttachment.display_order, MessageVersionAttachment.id)
        .all()
    )
    if any(link.attachment_id not in attachment_id_map for link in source_links):
        raise ValueError("Merge occurrence references were not prepared in their source scope.")
    referenced_ids = version_references | set().union(*projected_references.values())
    linked_ids = {attachment_id_map[link.attachment_id] for link in source_links}
    required_ids = referenced_ids | linked_ids
    if not required_ids.issubset(set(attachment_id_map.values())):
        raise ValueError("Merge occurrence references are outside their source mapping.")
    _verify_target_attachments(db, recovery.target_id, required_ids)

    rows = []
    covered: Counter[tuple[uuid.UUID, int]] = Counter()
    linked_counts: Counter[uuid.UUID] = Counter()
    repaired = 0
    unlocated = 0
    next_order = max((link.display_order for link in source_links), default=-1) + 1
    for link in source_links:
        attachment_id = attachment_id_map[link.attachment_id]
        block_index = link.block_index
        if attachment_id not in references_by_block.get(block_index, set()):
            candidates = candidate_blocks.get(attachment_id, [])
            block_index = candidates[0] if len(candidates) == 1 else None
            if block_index is not None:
                repaired += 1
        if block_index is None:
            unlocated += 1
        else:
            covered[attachment_id, block_index] += 1
        linked_counts[attachment_id] += 1
        rows.append({
            "id": uuid.uuid4(),
            "message_version_id": target_version_id,
            "attachment_id": attachment_id,
            "occurrence_key": link.occurrence_key,
            "placement": link.placement,
            "relation_type": link.relation_type,
            "display_order": link.display_order,
            "block_index": block_index,
            "display_mode": link.display_mode,
            "alt_text": link.alt_text,
            "caption": link.caption,
        })

    for block in blocks:
        for attachment_id in sorted(references_by_block[block.block_index], key=str):
            missing = counts_by_block[block.block_index][attachment_id] - covered[attachment_id, block.block_index]
            for _ in range(max(missing, 0)):
                rows.append(_new_occurrence(
                    target_version_id, attachment_id, next_order, block,
                ))
                next_order += 1
                covered[attachment_id, block.block_index] += 1
                linked_counts[attachment_id] += 1
                repaired += 1

    # A genuine source reference without a real render block must remain
    # associated with the copied version, but has no fabricated navigation.
    for attachment_id in sorted(referenced_ids, key=str):
        missing = max(source_counts[attachment_id], 1) - linked_counts[attachment_id]
        for _ in range(max(missing, 0)):
            rows.append(_new_occurrence(target_version_id, attachment_id, next_order, None))
            next_order += 1
            repaired += 1
            unlocated += 1

    for offset in range(0, len(rows), _QUERY_BATCH_SIZE):
        insert_rows(db, MessageVersionAttachment, rows[offset:offset + _QUERY_BATCH_SIZE])
    recovery.repaired_occurrences += repaired
    recovery.unlocated_occurrences += unlocated
    return len(rows)


def _occurrence_counts(
    blocks: list[RenderBlock],
    projected_references: dict[int, set[uuid.UUID]],
    context: MarkdownReferenceContext,
) -> tuple[dict[int, Counter[uuid.UUID]], Counter[uuid.UUID]]:
    """Count real uses, not repeated representations or definition destinations.

    The shared context supplies only proven source-to-block spans. Work in its
    normalized coordinate space, so CRLF source and LF projections agree.
    Intersecting reference spans also cover a standalone file's label-only
    projection without treating a reference definition as another occurrence.
    """
    references = []
    for reference in attachment_source_references(context.projection_source or ""):
        try:
            identity = uuid.UUID(reference.identifier)
        except ValueError:
            # Invalid identities are not new file authority. Their write-time
            # validation and opaque rendering remain the caller's contracts.
            continue
        references.append((reference.start, reference.end, identity))
    starts = [start for start, _end, _identity in references]
    furthest_ends = []
    furthest = 0
    for _start, end, _identity in references:
        furthest = max(furthest, end)
        furthest_ends.append(furthest)
    source_counts = Counter(identity for _start, _end, identity in references)
    counts_by_block = {}
    for block in blocks:
        identities = projected_references[block.block_index]
        span = context.block_spans.get(block.block_index)
        if span is None:
            # Typed legacy projections may not have a source anchor. Preserve
            # their proven association, but do not invent repeated uses.
            counts_by_block[block.block_index] = Counter({identity: 1 for identity in identities})
            continue
        lower, upper = span
        first = bisect_right(furthest_ends, lower)
        last = bisect_left(starts, upper)
        counts = Counter(
            identity for _start, end, identity in references[first:last]
            if end > lower and identity in identities
        )
        if block.block_type in {"image", "attachment"}:
            # A structured standalone block is itself one actual placement.
            for identity in identities:
                counts[identity] = max(counts[identity], 1)
        counts_by_block[block.block_index] = counts
    return counts_by_block, source_counts


def _verify_target_attachments(
    db: Session, target_id: uuid.UUID, required_ids: set[uuid.UUID],
) -> None:
    identities = sorted(required_ids, key=str)
    for offset in range(0, len(identities), _QUERY_BATCH_SIZE):
        batch = identities[offset:offset + _QUERY_BATCH_SIZE]
        found = {
            row.id for row in db.query(Attachment.id).filter(
                Attachment.conversation_id == target_id,
                Attachment.deleted_at.is_(None),
                Attachment.id.in_(batch),
            )
        }
        if found != set(batch):
            raise ValueError("Merge occurrence target attachment ownership is invalid.")


def _new_occurrence(
    version_id: uuid.UUID, attachment_id: uuid.UUID, display_order: int, block: RenderBlock | None,
) -> dict:
    # Labels are from the copied target block, not the unavailable attachment.
    data = block.data if block is not None and isinstance(block.data, dict) else {}
    image = block is not None and block.block_type == "image"
    return {
        "id": uuid.uuid4(),
        "message_version_id": version_id,
        "attachment_id": attachment_id,
        "occurrence_key": f"merge-recovered-{uuid.uuid4().hex}",
        "placement": "inline",
        "relation_type": "inline" if image else "file",
        "display_order": display_order,
        "block_index": block.block_index if block is not None else None,
        "display_mode": "inline" if image else "card",
        "alt_text": data.get("alt") if isinstance(data.get("alt"), str) else None,
        "caption": data.get("caption") if isinstance(data.get("caption"), str) else None,
    }
