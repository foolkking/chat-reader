import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.models.annotation import ConversationAnnotation
from app.models.attachment import Attachment, MessageVersionAttachment
from app.models.conversation import Conversation
from app.models.heading import Heading
from app.models.import_record import utc_now
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.render_block import RenderBlock
from app.models.source_message_ref import SourceMessageRef
from app.services.database.bulk_insert import insert_rows
from app.services.import_pipeline.canonical_draft import content_hash, normalize_text
from app.services.search.search_indexer import rebuild_search_documents_for_conversation
from app.services.editing.attachment_reference_rewriter import (
    assert_attachment_references_mapped as _assert_attachment_references_mapped,
    attachment_data_ids as _attachment_data_ids,
    rewrite_attachment_data as _rewrite_attachment_data,
    rewrite_attachment_text as _rewrite_attachment_text,
)

MergeProgressCallback = Callable[[str, int, int, int], None]
MERGE_BATCH_SIZE = 200
VERSION_BATCH_SIZE = 50


@dataclass(frozen=True)
class MergeCopyResult:
    message_count: int
    version_count: int
    block_count: int
    annotation_count: int
    heading_count: int
    attachment_count: int


@dataclass(frozen=True)
class _MessagePlan:
    source_id: uuid.UUID
    source_conversation_id: uuid.UUID
    target_id: uuid.UUID
    source_current_version_id: uuid.UUID
    role: str
    author_label: str | None
    order_key: str
    turn_index: int | None
    created_at: object
    content_hash: str | None
    estimated_height: int | None
    block_count: int
    char_count: int
    is_heavy: bool


def copy_conversation_history(
    db: Session,
    *,
    target: Conversation,
    sources: Sequence[Conversation],
    progress_callback: MergeProgressCallback | None = None,
) -> MergeCopyResult:
    plans = _message_plans(db, sources)
    total = len(plans)
    _report(progress_callback, "creating", 10, 0, total)

    source_message_ids = [plan.source_id for plan in plans]
    message_id_map = {plan.source_id: plan.target_id for plan in plans}
    version_rows = _version_identity_rows(db, source_message_ids)
    version_id_map = {row.id: uuid.uuid4() for row in version_rows}
    validate_source_attachment_integrity(
        db,
        {plan.source_id: plan.source_conversation_id for plan in plans},
        list(version_id_map),
    )
    attachment_id_map = _insert_attachments(db, target, sources)
    block_id_map: dict[uuid.UUID, uuid.UUID] = {}
    for plan in plans:
        if plan.source_current_version_id not in version_id_map:
            raise ValueError(f"Current version is missing for source message {plan.source_id}.")

    _insert_messages(db, target, plans, version_id_map, progress_callback)
    _insert_source_refs(db, target, plans, progress_callback)
    current_plain_text, current_content_hashes, version_count = _insert_versions(
        db,
        plans=plans,
        version_rows=version_rows,
        message_id_map=message_id_map,
        version_id_map=version_id_map,
        attachment_id_map=attachment_id_map,
        progress_callback=progress_callback,
    )
    _update_current_message_hashes(db, current_content_hashes)
    block_count = _insert_render_blocks(
        db,
        source_version_ids=list(version_id_map),
        version_id_map=version_id_map,
        block_id_map=block_id_map,
        attachment_id_map=attachment_id_map,
        total_messages=total,
        progress_callback=progress_callback,
    )
    attachment_count = _insert_attachment_links(db, version_id_map, attachment_id_map)
    _validate_attachment_copy(db, target, version_id_map, block_id_map, attachment_id_map)
    annotation_count = _insert_annotations(
        db,
        target=target,
        sources=sources,
        message_id_map=message_id_map,
        version_id_map=version_id_map,
        total_messages=total,
        progress_callback=progress_callback,
    )
    heading_count = _insert_headings(
        db,
        target=target,
        sources=sources,
        message_id_map=message_id_map,
        version_id_map=version_id_map,
        block_id_map=block_id_map,
        message_order={plan.source_id: plan.order_key for plan in plans},
        total_messages=total,
        progress_callback=progress_callback,
    )

    _update_target_stats(target, plans, current_plain_text)
    db.flush()
    _report(progress_callback, "search", 88, total, total)
    rebuild_search_documents_for_conversation(db, target.id)
    _report(progress_callback, "publishing", 98, total, total)
    return MergeCopyResult(
        message_count=total,
        version_count=version_count,
        block_count=block_count,
        annotation_count=annotation_count,
        heading_count=heading_count,
        attachment_count=attachment_count,
    )


def _insert_attachment_links(
    db: Session,
    version_id_map: dict[uuid.UUID, uuid.UUID],
    attachment_id_map: dict[uuid.UUID, uuid.UUID],
) -> int:
    copied = 0
    source_version_ids = list(version_id_map)
    for version_ids in _batches(source_version_ids, VERSION_BATCH_SIZE):
        rows = (
            db.query(
                MessageVersionAttachment.message_version_id,
                MessageVersionAttachment.attachment_id,
                MessageVersionAttachment.occurrence_key,
                MessageVersionAttachment.placement,
                MessageVersionAttachment.relation_type,
                MessageVersionAttachment.display_order,
                MessageVersionAttachment.block_index,
                MessageVersionAttachment.display_mode,
                MessageVersionAttachment.alt_text,
                MessageVersionAttachment.caption,
            )
            .filter(MessageVersionAttachment.message_version_id.in_(version_ids))
            .yield_per(MERGE_BATCH_SIZE)
        )
        output = [
            {
                "id": uuid.uuid4(),
                "message_version_id": version_id_map[row.message_version_id],
                "attachment_id": _mapped_attachment_id(row.attachment_id, attachment_id_map),
                "occurrence_key": row.occurrence_key,
                "placement": row.placement,
                "relation_type": row.relation_type,
                "display_order": row.display_order,
                "block_index": row.block_index,
                "display_mode": row.display_mode,
                "alt_text": row.alt_text,
                "caption": row.caption,
            }
            for row in rows
        ]
        if output:
            insert_rows(db, MessageVersionAttachment, output)
            copied += len(output)
    return copied


def _mapped_attachment_id(source_id: uuid.UUID, attachment_id_map: dict[uuid.UUID, uuid.UUID]) -> uuid.UUID:
    target_id = attachment_id_map.get(source_id)
    if target_id is None:
        raise ValueError(f"Attachment occurrence {source_id} cannot be mapped during merge.")
    return target_id


def validate_source_attachment_integrity(
    db: Session,
    source_conversation_by_message: dict[uuid.UUID, uuid.UUID],
    source_version_ids: list[uuid.UUID],
) -> None:
    """Reject broken source references before cloning them into a merge target.

    Target-side validation cannot detect an occurrence from source A that
    points at an Attachment owned by source B when both sources participate in
    the merge. Validate ownership and block identity against each source
    MessageVersion before any target messages, versions, blocks, or links are
    inserted.
    """
    for version_ids in _batches(source_version_ids, VERSION_BATCH_SIZE):
        versions = (
            db.query(
                MessageVersion.id,
                MessageVersion.message_id,
                MessageVersion.display_text,
                MessageVersion.blocks,
            )
            .filter(MessageVersion.id.in_(version_ids))
            .all()
        )
        blocks = (
            db.query(
                RenderBlock.message_version_id,
                RenderBlock.block_index,
                RenderBlock.plain_text,
                RenderBlock.data,
                RenderBlock.sanitized_html,
            )
            .filter(RenderBlock.message_version_id.in_(version_ids))
            .all()
        )
        links = (
            db.query(
                MessageVersionAttachment.message_version_id,
                MessageVersionAttachment.attachment_id,
                MessageVersionAttachment.block_index,
            )
            .filter(MessageVersionAttachment.message_version_id.in_(version_ids))
            .all()
        )

        blocks_by_version: dict[uuid.UUID, list] = {}
        for block in blocks:
            blocks_by_version.setdefault(block.message_version_id, []).append(block)
        links_by_version: dict[uuid.UUID, list] = {}
        for link in links:
            links_by_version.setdefault(link.message_version_id, []).append(link)

        referenced_attachment_ids: set[uuid.UUID] = set()
        references_by_version: dict[uuid.UUID, set[uuid.UUID]] = {}
        block_references_by_version: dict[uuid.UUID, dict[int, set[uuid.UUID]]] = {}
        for version in versions:
            version_references = (
                _attachment_data_ids(version.display_text or "")
                | _attachment_data_ids(version.blocks or [])
            )
            block_references: dict[int, set[uuid.UUID]] = {}
            for block in blocks_by_version.get(version.id, []):
                block_references[block.block_index] = (
                    _attachment_data_ids(block.data or {})
                    | _attachment_data_ids(block.plain_text or "")
                    | _attachment_data_ids(block.sanitized_html or "")
                )
                version_references.update(block_references[block.block_index])
            references_by_version[version.id] = version_references
            block_references_by_version[version.id] = block_references
            referenced_attachment_ids.update(version_references)
        referenced_attachment_ids.update(link.attachment_id for link in links)

        attachment_owner_by_id = {
            row.id: row.conversation_id
            for row in db.query(Attachment.id, Attachment.conversation_id).filter(
                Attachment.id.in_(referenced_attachment_ids),
                Attachment.deleted_at.is_(None),
            ).all()
        } if referenced_attachment_ids else {}

        for version in versions:
            source_conversation_id = source_conversation_by_message.get(version.message_id)
            if source_conversation_id is None:
                raise ValueError("Source message version is outside the selected merge conversations.")
            version_links = links_by_version.get(version.id, [])
            version_references = references_by_version.get(version.id, set())
            linked_ids = {link.attachment_id for link in version_links}
            for attachment_id in version_references | linked_ids:
                if attachment_owner_by_id.get(attachment_id) != source_conversation_id:
                    raise ValueError(
                        "Source attachment is missing, inactive, or belongs to another conversation."
                    )
            if not version_references.issubset(linked_ids):
                raise ValueError("Source message attachment reference has no occurrence link.")

            block_references = block_references_by_version.get(version.id, {})
            for link in version_links:
                if link.block_index is None or link.block_index not in block_references:
                    raise ValueError("Source attachment occurrence points to a missing render block.")
                if link.attachment_id not in block_references[link.block_index]:
                    raise ValueError(
                        "Source attachment occurrence does not match its render block reference."
                    )


def _validate_attachment_copy(
    db: Session,
    target: Conversation,
    version_id_map: dict[uuid.UUID, uuid.UUID],
    block_id_map: dict[uuid.UUID, uuid.UUID],
    attachment_id_map: dict[uuid.UUID, uuid.UUID],
) -> None:
    """Verify copied references and occurrence links are scoped to the target conversation."""
    target_attachment_ids = set(attachment_id_map.values())
    actual_target_attachment_ids = {
        row.id for row in db.query(Attachment.id).filter(Attachment.conversation_id == target.id).all()
    }
    if not target_attachment_ids.issubset(actual_target_attachment_ids):
        raise ValueError("Merged attachment mapping is incomplete for the target conversation.")

    target_version_ids = set(version_id_map.values())
    versions = db.query(MessageVersion).filter(MessageVersion.id.in_(target_version_ids)).all()
    if len(versions) != len(version_id_map):
        raise ValueError("Merged message version mapping is incomplete.")
    target_message_ids = {
        row.id for row in db.query(Message.id).filter(Message.conversation_id == target.id).all()
    }
    links = db.query(MessageVersionAttachment).filter(
        MessageVersionAttachment.message_version_id.in_(target_version_ids)
    ).all()
    links_by_version: dict[object, list[MessageVersionAttachment]] = {}
    for link in links:
        links_by_version.setdefault(link.message_version_id, []).append(link)

    blocks = db.query(RenderBlock).filter(RenderBlock.id.in_(block_id_map.values())).all()
    if len(blocks) != len(block_id_map):
        raise ValueError("Merged render block mapping is incomplete.")
    blocks_by_version: dict[object, list[RenderBlock]] = {}
    for block in blocks:
        blocks_by_version.setdefault(block.message_version_id, []).append(block)

    for version in versions:
        if version.message_id not in target_message_ids:
            raise ValueError("Merged message version is outside the target conversation.")
        referenced_ids = _attachment_data_ids(version.display_text) | _attachment_data_ids(version.blocks or [])
        if not referenced_ids.issubset(target_attachment_ids):
            raise ValueError("Merged message contains an attachment reference outside the target conversation.")
        version_links = links_by_version.get(version.id, [])
        linked_ids = {link.attachment_id for link in version_links}
        if not referenced_ids.issubset(linked_ids):
            raise ValueError("Merged message attachment reference has no occurrence link on its current version.")

        version_blocks = blocks_by_version.get(version.id, [])
        block_by_index = {block.block_index: block for block in version_blocks}
        block_references: dict[int, set] = {}
        for block in version_blocks:
            block_references[block.block_index] = (
                _attachment_data_ids(block.data or {})
                | _attachment_data_ids(block.plain_text or "")
                | _attachment_data_ids(block.sanitized_html or "")
            )
            if not block_references[block.block_index].issubset(target_attachment_ids):
                raise ValueError("Merged render block contains an attachment reference outside the target conversation.")
        for link in version_links:
            if link.attachment_id not in target_attachment_ids:
                raise ValueError("Merged attachment occurrence points outside the target conversation.")
            if link.block_index is not None and link.block_index not in block_by_index:
                raise ValueError("Merged attachment occurrence points to a missing render block.")
            if link.block_index is not None and link.attachment_id not in block_references.get(link.block_index, set()):
                raise ValueError("Merged attachment occurrence does not match its render block reference.")


def _insert_attachments(
    db: Session,
    target: Conversation,
    sources: Sequence[Conversation],
) -> dict[uuid.UUID, uuid.UUID]:
    rows = (
        db.query(Attachment)
        .filter(Attachment.conversation_id.in_([source.id for source in sources]), Attachment.deleted_at.is_(None))
        .order_by(Attachment.created_at, Attachment.id)
        .all()
    )
    attachment_id_map = {row.id: uuid.uuid4() for row in rows}
    if rows:
        insert_rows(db, Attachment, [{
            "id": attachment_id_map[row.id],
            "conversation_id": target.id,
            "asset_object_id": row.asset_object_id,
            "import_id": row.import_id,
            "original_filename": row.original_filename,
            "display_name": row.display_name,
            "declared_mime_type": row.declared_mime_type,
            "detected_mime_type": row.detected_mime_type,
            "status": row.status,
            "scan_status": row.scan_status,
            "source_type": "conversation_merge",
            "source_attachment_id": str(row.id),
            "metadata_": {**(row.metadata_ or {}), "merged_from_source_type": row.source_type},
            "resolution_status": row.resolution_status,
            "created_at": row.created_at,
            "deleted_at": None,
        } for row in rows])
    return attachment_id_map


def _message_plans(db: Session, sources: Sequence[Conversation]) -> list[_MessagePlan]:
    plans: list[_MessagePlan] = []
    turn_index = 0
    for source in sources:
        rows = (
            db.query(
                Message.id,
                Message.conversation_id,
                Message.current_version_id,
                Message.role,
                Message.author_label,
                Message.created_at,
                Message.content_hash,
                Message.estimated_height,
                Message.block_count,
                Message.char_count,
                Message.is_heavy,
            )
            .filter(Message.conversation_id == source.id, Message.is_deleted.is_(False))
            .order_by(Message.order_key.asc(), Message.created_in_system_at.asc())
            .all()
        )
        for row in rows:
            if row.current_version_id is None:
                raise ValueError(f"Source message {row.id} has no current version.")
            if row.role == "user":
                turn_index += 1
            plans.append(
                _MessagePlan(
                    source_id=row.id,
                    source_conversation_id=row.conversation_id,
                    target_id=uuid.uuid4(),
                    source_current_version_id=row.current_version_id,
                    role=row.role,
                    author_label=row.author_label,
                    order_key=f"{len(plans) + 1:06d}",
                    turn_index=turn_index if row.role in {"user", "assistant"} else None,
                    created_at=row.created_at,
                    content_hash=row.content_hash,
                    estimated_height=row.estimated_height,
                    block_count=row.block_count,
                    char_count=row.char_count,
                    is_heavy=row.is_heavy,
                )
            )
    return plans


def _version_identity_rows(db: Session, message_ids: list[uuid.UUID]):
    rows = []
    for batch in _batches(message_ids, MERGE_BATCH_SIZE):
        rows.extend(
            db.query(
                MessageVersion.id,
                MessageVersion.message_id,
                MessageVersion.based_on_version_id,
            )
            .filter(MessageVersion.message_id.in_(batch))
            .order_by(MessageVersion.message_id.asc(), MessageVersion.version_number.asc())
            .all()
        )
    return rows


def _insert_messages(
    db: Session,
    target: Conversation,
    plans: list[_MessagePlan],
    version_id_map: dict[uuid.UUID, uuid.UUID],
    progress_callback: MergeProgressCallback | None,
) -> None:
    now = utc_now()
    for offset, batch in _enumerated_batches(plans, MERGE_BATCH_SIZE):
        insert_rows(
            db,
            Message,
            [
                {
                    "id": plan.target_id,
                    "conversation_id": target.id,
                    "role": plan.role,
                    "author_label": plan.author_label,
                    "order_key": plan.order_key,
                    "turn_index": plan.turn_index,
                    "created_at": plan.created_at,
                    "created_in_system_at": now,
                    "current_version_id": version_id_map[plan.source_current_version_id],
                    "is_deleted": False,
                    "deleted_at": None,
                    "deleted_by": None,
                    "delete_reason": None,
                    "created_by": "user",
                    "source_type": "conversation_merge",
                    "content_hash": plan.content_hash,
                    "estimated_height": plan.estimated_height,
                    "measured_height": None,
                    "block_count": plan.block_count,
                    "char_count": plan.char_count,
                    "is_heavy": plan.is_heavy,
                }
                for plan in batch
            ],
        )
        processed = min(offset + len(batch), len(plans))
        progress = 10 + round(12 * processed / max(len(plans), 1))
        _report(progress_callback, "messages", progress, processed, len(plans))


def _insert_source_refs(
    db: Session,
    target: Conversation,
    plans: list[_MessagePlan],
    progress_callback: MergeProgressCallback | None,
) -> None:
    plan_by_id = {plan.source_id: plan for plan in plans}
    seen_messages: set[uuid.UUID] = set()
    now = utc_now()
    for source_ids in _batches(list(plan_by_id), MERGE_BATCH_SIZE):
        rows = (
            db.query(
                SourceMessageRef.message_id,
                SourceMessageRef.source_type,
                SourceMessageRef.source_profile,
                SourceMessageRef.source_conversation_id,
                SourceMessageRef.source_node_id,
                SourceMessageRef.source_message_id,
                SourceMessageRef.source_json_index,
                SourceMessageRef.source_markdown_index,
                SourceMessageRef.parent_node_id,
                SourceMessageRef.child_node_ids,
                SourceMessageRef.is_primary_path,
                SourceMessageRef.branch_index,
                SourceMessageRef.raw_metadata,
                SourceMessageRef.created_at,
            )
            .filter(SourceMessageRef.message_id.in_(source_ids))
            .yield_per(MERGE_BATCH_SIZE)
        )
        output: list[dict] = []
        for row in rows:
            plan = plan_by_id[row.message_id]
            seen_messages.add(row.message_id)
            metadata = dict(row.raw_metadata or {})
            metadata["merged_from_message_id"] = str(plan.source_id)
            output.append(
                {
                    "id": uuid.uuid4(),
                    "message_id": plan.target_id,
                    "source_type": row.source_type,
                    "source_profile": row.source_profile,
                    "source_conversation_id": row.source_conversation_id,
                    "source_node_id": row.source_node_id,
                    "source_message_id": row.source_message_id,
                    "source_json_index": row.source_json_index,
                    "source_markdown_index": row.source_markdown_index,
                    "parent_node_id": row.parent_node_id,
                    "child_node_ids": row.child_node_ids or [],
                    "is_primary_path": row.is_primary_path,
                    "branch_index": row.branch_index,
                    "raw_metadata": metadata,
                    "created_at": row.created_at,
                }
            )
            if len(output) >= MERGE_BATCH_SIZE:
                insert_rows(db, SourceMessageRef, output)
                output.clear()
                _report(progress_callback, "source_refs", 24, len(seen_messages), len(plans))
        if output:
            insert_rows(db, SourceMessageRef, output)

    missing = [plan for plan in plans if plan.source_id not in seen_messages]
    for batch in _batches(missing, MERGE_BATCH_SIZE):
        insert_rows(
            db,
            SourceMessageRef,
            [
                {
                    "id": uuid.uuid4(),
                    "message_id": plan.target_id,
                    "source_type": target.source_type,
                    "source_profile": target.source_profile,
                    "source_conversation_id": str(plan.source_conversation_id),
                    "source_node_id": None,
                    "source_message_id": str(plan.source_id),
                    "source_json_index": None,
                    "source_markdown_index": None,
                    "parent_node_id": None,
                    "child_node_ids": [],
                    "is_primary_path": True,
                    "branch_index": None,
                    "raw_metadata": {"source_operation": "conversation_merge"},
                    "created_at": now,
                }
                for plan in batch
            ],
        )
    _report(progress_callback, "source_refs", 24, len(plans), len(plans))


def _insert_versions(
    db: Session,
    *,
    plans: list[_MessagePlan],
    version_rows,
    message_id_map: dict[uuid.UUID, uuid.UUID],
    version_id_map: dict[uuid.UUID, uuid.UUID],
    attachment_id_map: dict[uuid.UUID, uuid.UUID],
    progress_callback: MergeProgressCallback | None,
) -> tuple[dict[uuid.UUID, str], dict[uuid.UUID, str], int]:
    current_versions = {plan.source_current_version_id: plan.target_id for plan in plans}
    role_by_message = {plan.source_id: plan.role for plan in plans}
    current_plain_text: dict[uuid.UUID, str] = {}
    current_content_hashes: dict[uuid.UUID, str] = {}
    source_version_ids = [row.id for row in version_rows]
    copied = 0
    for source_ids in _batches(source_version_ids, VERSION_BATCH_SIZE):
        rows = (
            db.query(
                MessageVersion.id,
                MessageVersion.message_id,
                MessageVersion.version_number,
                MessageVersion.plain_text,
                MessageVersion.display_text,
                MessageVersion.blocks,
                MessageVersion.edit_type,
                MessageVersion.edit_reason,
                MessageVersion.created_at,
                MessageVersion.created_by,
                MessageVersion.based_on_version_id,
                MessageVersion.content_hash,
                MessageVersion.normalizer_version,
                MessageVersion.markdown_parser_version,
                MessageVersion.block_builder_version,
                MessageVersion.search_document_version,
            )
            .filter(MessageVersion.id.in_(source_ids))
            .order_by(MessageVersion.message_id.asc(), MessageVersion.version_number.asc())
            .yield_per(VERSION_BATCH_SIZE)
        )
        output: list[dict] = []
        for row in rows:
            _assert_attachment_references_mapped(row.display_text or "", attachment_id_map)
            _assert_attachment_references_mapped(row.blocks or [], attachment_id_map)
            rewritten_display = _rewrite_attachment_text(row.display_text, attachment_id_map)
            rewritten_plain = normalize_text(rewritten_display)
            rewritten_hash = content_hash(rewritten_display, role_by_message.get(row.message_id))
            if row.id in current_versions:
                current_plain_text[current_versions[row.id]] = rewritten_plain
                current_content_hashes[current_versions[row.id]] = rewritten_hash
            output.append(
                {
                    "id": version_id_map[row.id],
                    "message_id": message_id_map[row.message_id],
                    "version_number": row.version_number,
                    "plain_text": rewritten_plain,
                    "display_text": rewritten_display,
                    "blocks": _rewrite_attachment_data(row.blocks or [], attachment_id_map),
                    "edit_type": row.edit_type,
                    "edit_reason": row.edit_reason,
                    "created_at": row.created_at,
                    "created_by": row.created_by,
                    "based_on_version_id": version_id_map.get(row.based_on_version_id),
                    "content_hash": rewritten_hash,
                    "normalizer_version": row.normalizer_version,
                    "markdown_parser_version": row.markdown_parser_version,
                    "block_builder_version": row.block_builder_version,
                    "search_document_version": row.search_document_version,
                }
            )
        insert_rows(db, MessageVersion, output)
        copied += len(output)
        progress = 24 + round(24 * copied / max(len(source_version_ids), 1))
        _report(progress_callback, "versions", progress, len(current_plain_text), len(plans))
    return current_plain_text, current_content_hashes, copied


def _update_current_message_hashes(
    db: Session,
    current_content_hashes: dict[uuid.UUID, str],
) -> None:
    for batch in _batches(list(current_content_hashes.items()), MERGE_BATCH_SIZE):
        db.bulk_update_mappings(
            Message,
            [
                {"id": message_id, "content_hash": current_hash}
                for message_id, current_hash in batch
            ],
        )


def _insert_render_blocks(
    db: Session,
    *,
    source_version_ids: list[uuid.UUID],
    version_id_map: dict[uuid.UUID, uuid.UUID],
    block_id_map: dict[uuid.UUID, uuid.UUID],
    attachment_id_map: dict[uuid.UUID, uuid.UUID],
    total_messages: int,
    progress_callback: MergeProgressCallback | None,
) -> int:
    copied = 0
    for version_ids in _batches(source_version_ids, VERSION_BATCH_SIZE):
        rows = (
            db.query(
                RenderBlock.id,
                RenderBlock.message_version_id,
                RenderBlock.block_index,
                RenderBlock.block_type,
                RenderBlock.plain_text,
                RenderBlock.data,
                RenderBlock.sanitized_html,
                RenderBlock.char_count,
                RenderBlock.estimated_height,
                RenderBlock.measured_height,
                RenderBlock.collapsed_by_default,
                RenderBlock.render_priority,
            )
            .filter(RenderBlock.message_version_id.in_(version_ids))
            .order_by(RenderBlock.message_version_id.asc(), RenderBlock.block_index.asc())
            .yield_per(MERGE_BATCH_SIZE)
        )
        output: list[dict] = []
        for row in rows:
            _assert_attachment_references_mapped(row.data or {}, attachment_id_map)
            _assert_attachment_references_mapped(row.sanitized_html or "", attachment_id_map)
            target_id = uuid.uuid4()
            block_id_map[row.id] = target_id
            output.append(
                {
                    "id": target_id,
                    "message_version_id": version_id_map[row.message_version_id],
                    "block_index": row.block_index,
                    "block_type": row.block_type,
                    "plain_text": _rewrite_attachment_text(row.plain_text or "", attachment_id_map),
                    "data": _rewrite_attachment_data(row.data or {}, attachment_id_map),
                    "sanitized_html": _rewrite_attachment_text(row.sanitized_html or "", attachment_id_map) if row.sanitized_html is not None else None,
                    "char_count": row.char_count,
                    "estimated_height": row.estimated_height,
                    "measured_height": row.measured_height,
                    "collapsed_by_default": row.collapsed_by_default,
                    "render_priority": row.render_priority,
                }
            )
            if len(output) >= MERGE_BATCH_SIZE:
                insert_rows(db, RenderBlock, output)
                copied += len(output)
                output.clear()
                _report(progress_callback, "blocks", 55, total_messages, total_messages)
        if output:
            insert_rows(db, RenderBlock, output)
            copied += len(output)
    _report(progress_callback, "blocks", 65, total_messages, total_messages)
    return copied


def _insert_annotations(
    db: Session,
    *,
    target: Conversation,
    sources: Sequence[Conversation],
    message_id_map: dict[uuid.UUID, uuid.UUID],
    version_id_map: dict[uuid.UUID, uuid.UUID],
    total_messages: int,
    progress_callback: MergeProgressCallback | None,
) -> int:
    source_conversation_ids = [source.id for source in sources]
    identity_rows = (
        db.query(ConversationAnnotation.id, ConversationAnnotation.message_id)
        .filter(
            ConversationAnnotation.conversation_id.in_(source_conversation_ids),
            ConversationAnnotation.is_deleted.is_(False),
        )
        .all()
    )
    included_ids = {
        row.id
        for row in identity_rows
        if row.message_id is None or row.message_id in message_id_map
    }
    annotation_id_map = {source_id: uuid.uuid4() for source_id in included_ids}
    if not annotation_id_map:
        _report(progress_callback, "annotations", 72, total_messages, total_messages)
        return 0

    rows = (
        db.query(
            ConversationAnnotation.id,
            ConversationAnnotation.subject_key,
            ConversationAnnotation.message_id,
            ConversationAnnotation.message_version_id,
            ConversationAnnotation.annotation_type,
            ConversationAnnotation.color,
            ConversationAnnotation.start_block_index,
            ConversationAnnotation.start_offset,
            ConversationAnnotation.end_block_index,
            ConversationAnnotation.end_offset,
            ConversationAnnotation.quote,
            ConversationAnnotation.prefix,
            ConversationAnnotation.suffix,
            ConversationAnnotation.comment_markdown,
            ConversationAnnotation.anchor_status,
            ConversationAnnotation.revision,
            ConversationAnnotation.conflict_of_id,
            ConversationAnnotation.metadata_,
            ConversationAnnotation.created_at,
            ConversationAnnotation.updated_at,
        )
        .filter(ConversationAnnotation.id.in_(included_ids))
        .yield_per(MERGE_BATCH_SIZE)
    )
    output: list[dict] = []
    copied = 0
    for row in rows:
        metadata = dict(row.metadata_ or {})
        metadata["merged_from_annotation_id"] = str(row.id)
        output.append(
            {
                "id": annotation_id_map[row.id],
                "subject_key": row.subject_key,
                "conversation_id": target.id,
                "message_id": message_id_map.get(row.message_id),
                "message_version_id": version_id_map.get(row.message_version_id),
                "annotation_type": row.annotation_type,
                "color": row.color,
                "start_block_index": row.start_block_index,
                "start_offset": row.start_offset,
                "end_block_index": row.end_block_index,
                "end_offset": row.end_offset,
                "quote": row.quote,
                "prefix": row.prefix,
                "suffix": row.suffix,
                "comment_markdown": row.comment_markdown,
                "anchor_status": row.anchor_status,
                "revision": row.revision,
                "is_deleted": False,
                "conflict_of_id": annotation_id_map.get(row.conflict_of_id),
                "metadata_": metadata,
                "created_at": row.created_at,
                "updated_at": row.updated_at,
            }
        )
        if len(output) >= MERGE_BATCH_SIZE:
            insert_rows(db, ConversationAnnotation, output)
            copied += len(output)
            output.clear()
            _report(progress_callback, "annotations", 70, total_messages, total_messages)
    if output:
        insert_rows(db, ConversationAnnotation, output)
        copied += len(output)
    _report(progress_callback, "annotations", 72, total_messages, total_messages)
    return copied


def _insert_headings(
    db: Session,
    *,
    target: Conversation,
    sources: Sequence[Conversation],
    message_id_map: dict[uuid.UUID, uuid.UUID],
    version_id_map: dict[uuid.UUID, uuid.UUID],
    block_id_map: dict[uuid.UUID, uuid.UUID],
    message_order: dict[uuid.UUID, str],
    total_messages: int,
    progress_callback: MergeProgressCallback | None,
) -> int:
    slug_counts: dict[str, int] = {}
    output: list[dict] = []
    heading_index = 0
    for source in sources:
        rows = (
            db.query(
                Heading.id,
                Heading.message_id,
                Heading.message_version_id,
                Heading.render_block_id,
                Heading.block_index,
                Heading.level,
                Heading.text,
                Heading.slug,
                Heading.metadata_,
                Heading.created_at,
            )
            .filter(Heading.conversation_id == source.id)
            .order_by(Heading.heading_index.asc())
            .yield_per(MERGE_BATCH_SIZE)
        )
        for row in rows:
            if row.message_id not in message_id_map or row.message_version_id not in version_id_map:
                continue
            base_slug = (row.slug or f"heading-{heading_index}").strip() or f"heading-{heading_index}"
            slug_counts[base_slug] = slug_counts.get(base_slug, 0) + 1
            slug = base_slug if slug_counts[base_slug] == 1 else f"{base_slug}-{slug_counts[base_slug]}"
            metadata = dict(row.metadata_ or {})
            metadata["merged_from_heading_id"] = str(row.id)
            output.append(
                {
                    "id": uuid.uuid4(),
                    "conversation_id": target.id,
                    "message_id": message_id_map[row.message_id],
                    "message_version_id": version_id_map[row.message_version_id],
                    "render_block_id": block_id_map.get(row.render_block_id),
                    "block_index": row.block_index,
                    "heading_index": heading_index,
                    "level": row.level,
                    "text": row.text,
                    "slug": slug,
                    "order_key": message_order[row.message_id],
                    "created_at": row.created_at,
                    "metadata_": metadata,
                }
            )
            heading_index += 1
            if len(output) >= MERGE_BATCH_SIZE:
                insert_rows(db, Heading, output)
                output.clear()
                _report(progress_callback, "headings", 78, total_messages, total_messages)
    if output:
        insert_rows(db, Heading, output)
    _report(progress_callback, "headings", 80, total_messages, total_messages)
    return heading_index


def _update_target_stats(
    target: Conversation,
    plans: list[_MessagePlan],
    current_plain_text: dict[uuid.UUID, str],
) -> None:
    text_parts = [current_plain_text.get(plan.target_id, "") for plan in plans]
    first_user = next((plan for plan in plans if plan.role == "user"), None)
    now = utc_now()
    target.message_count = len(plans)
    target.turn_count = sum(1 for plan in plans if plan.role == "user")
    target.first_user_message = current_plain_text.get(first_user.target_id) if first_user else None
    target.content_hash = content_hash("\n".join(text_parts)) if text_parts else None
    target.updated_at = now
    target.sort_time = now
    target.offline_revision += 1


def _batches(items: Sequence, size: int):
    for offset in range(0, len(items), size):
        yield items[offset : offset + size]


def _enumerated_batches(items: Sequence, size: int):
    for offset in range(0, len(items), size):
        yield offset, items[offset : offset + size]


def _report(
    callback: MergeProgressCallback | None,
    phase: str,
    progress: int,
    processed: int,
    total: int,
) -> None:
    if callback is not None:
        callback(phase, progress, processed, total)
