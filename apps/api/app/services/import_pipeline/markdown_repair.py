from __future__ import annotations

import uuid
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.conversation_event import ConversationEvent
from app.models.import_record import ImportRecord
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.source_artifact import SourceArtifact
from app.models.source_message_ref import SourceMessageRef
from app.services.editing.message_edit_service import create_system_message_version, refresh_conversation_stats
from app.services.import_pipeline.canonical_draft import CanonicalDraftMessage
from app.services.import_pipeline.exporter_aligner import align_exporter_sources
from app.services.import_pipeline.exporter_json_parser import parse_exporter_json
from app.services.import_pipeline.exporter_markdown_parser import parse_exporter_markdown
from app.services.search.search_indexer import rebuild_search_and_toc_for_conversation

VALID_MESSAGE_ALIGNMENTS = frozenset({"exact", "normalized", "by_order"})


@dataclass
class MarkdownRepairResult:
    scanned_imports: int = 0
    eligible_imports: int = 0
    repaired_imports: int = 0
    scanned_messages: int = 0
    eligible_messages: int = 0
    repaired_messages: int = 0
    skipped_missing_artifacts: int = 0
    skipped_conflicts: int = 0
    skipped_modified_messages: int = 0
    skipped_unmapped_messages: int = 0
    failed_imports: int = 0


def repair_exporter_markdown_imports(
    db: Session,
    *,
    import_id: uuid.UUID | None = None,
    dry_run: bool = True,
) -> MarkdownRepairResult:
    """Restore validated Markdown display bodies for legacy exporter pair imports."""
    query = (
        db.query(ImportRecord)
        .filter(
            ImportRecord.source_profile == "chatgpt_exporter_combo",
            ImportRecord.status == "committed",
            ImportRecord.conversation_id.is_not(None),
        )
        .order_by(ImportRecord.committed_at.asc(), ImportRecord.created_at.asc())
    )
    if import_id is not None:
        query = query.filter(ImportRecord.id == import_id)

    result = MarkdownRepairResult()
    for record in query.all():
        result.scanned_imports += 1
        try:
            with db.begin_nested():
                changed = _repair_one_import(db, record, result, dry_run=dry_run)
                if changed:
                    result.repaired_imports += 1
        except Exception:
            result.failed_imports += 1
    return result


def _repair_one_import(db: Session, record: ImportRecord, result: MarkdownRepairResult, *, dry_run: bool) -> bool:
    artifacts = (
        db.query(SourceArtifact)
        .filter(SourceArtifact.import_id == record.id)
        .order_by(SourceArtifact.created_at.asc())
        .all()
    )
    json_artifact = next((item for item in artifacts if item.source_profile == "chatgpt_exporter_json"), None)
    markdown_artifact = next((item for item in artifacts if item.source_profile == "chatgpt_exporter_markdown"), None)
    if json_artifact is None or markdown_artifact is None:
        result.skipped_missing_artifacts += 1
        return False

    json_result = parse_exporter_json(_read_artifact(record.id, json_artifact))
    alignment = align_exporter_sources(
        json_result,
        parse_exporter_markdown(_read_artifact(record.id, markdown_artifact), json_result.messages),
    )
    if alignment.conversation is None or alignment.alignment_status != "exact_match":
        result.skipped_conflicts += 1
        return False

    markdown_by_json_index = {
        message.source_json_index: message
        for message in alignment.conversation.messages
        if message.source_json_index is not None
        and message.source_markdown_index is not None
        and message.alignment_status in VALID_MESSAGE_ALIGNMENTS
    }
    rows = (
        db.query(Message, MessageVersion, SourceMessageRef)
        .join(MessageVersion, MessageVersion.id == Message.current_version_id)
        .join(SourceMessageRef, SourceMessageRef.message_id == Message.id)
        .filter(
            Message.conversation_id == record.conversation_id,
            Message.is_deleted.is_(False),
            SourceMessageRef.source_profile == "chatgpt_exporter_combo",
        )
        .order_by(Message.order_key.asc(), SourceMessageRef.created_at.asc())
        .all()
    )

    changed = False
    eligible = False
    changed_messages = 0
    seen_messages: set[uuid.UUID] = set()
    for message, current_version, source_ref in rows:
        if message.id in seen_messages:
            continue
        seen_messages.add(message.id)
        result.scanned_messages += 1
        draft = markdown_by_json_index.get(source_ref.source_json_index)
        if draft is None:
            result.skipped_unmapped_messages += 1
            continue
        if (source_ref.raw_metadata or {}).get("display_source") == "markdown":
            continue
        if current_version.created_by != "import":
            result.skipped_modified_messages += 1
            continue

        eligible = True
        result.eligible_messages += 1
        if dry_run:
            continue
        _apply_markdown_version(db, message, current_version, source_ref, draft)
        result.repaired_messages += 1
        changed_messages += 1
        changed = True

    if eligible:
        result.eligible_imports += 1
    if not changed:
        return False

    assert record.conversation_id is not None
    refresh_conversation_stats(db, record.conversation_id)
    rebuild_search_and_toc_for_conversation(db, record.conversation_id)
    db.add(
        ConversationEvent(
            id=uuid.uuid4(),
            conversation_id=record.conversation_id,
            event_type="import_markdown_repaired",
            payload={"import_id": str(record.id), "repaired_messages": changed_messages},
            created_by="system",
        )
    )
    db.flush()
    return True


def _apply_markdown_version(
    db: Session,
    message: Message,
    current_version: MessageVersion,
    source_ref: SourceMessageRef,
    draft: CanonicalDraftMessage,
) -> None:
    metadata = dict(source_ref.raw_metadata or {})
    metadata["display_source"] = "markdown"
    source_ref.raw_metadata = metadata
    if current_version.display_text == draft.display_text and current_version.plain_text == draft.plain_text:
        return
    create_system_message_version(
        db,
        message=message,
        text=draft.display_text,
        plain_text=draft.plain_text,
        edit_type="import_markdown_repair",
        edit_reason="apply validated paired Markdown source",
    )


def _read_artifact(import_id: uuid.UUID, artifact: SourceArtifact) -> bytes:
    root = Path(get_settings().import_storage_dir).resolve()
    import_directory = (root / str(import_id)).resolve()
    path = (import_directory / artifact.safe_filename).resolve()
    if path.parent != import_directory or not path.is_file():
        raise FileNotFoundError("Stored import artifact is unavailable.")
    return path.read_bytes()
