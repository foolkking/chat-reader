import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, TypeVar

from sqlalchemy import insert
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.conversation import Conversation
from app.models.conversation_event import ConversationEvent
from app.models.import_record import ImportRecord
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.render_block import RenderBlock
from app.models.source_artifact import SourceArtifact
from app.models.source_message_ref import SourceMessageRef
from app.services.canonical.block_builder import build_basic_render_blocks
from app.services.database.bulk_insert import insert_rows
from app.services.import_pipeline.canonical_draft import (
    PARSER_VERSION,
    CanonicalDraftConversation,
    CanonicalDraftMessage,
    content_hash,
    normalize_text,
)
from app.services.import_pipeline.exporter_aligner import align_exporter_sources
from app.services.import_pipeline.exporter_json_parser import parse_exporter_json
from app.services.import_pipeline.exporter_markdown_parser import parse_exporter_markdown
from app.services.import_pipeline.official_json_parser import OfficialConversationResult, parse_official_json
from app.services.import_pipeline.official_normalizer import _extract_content, _metadata_preview
from app.services.import_pipeline.official_primary_path import resolve_primary_path
from app.services.projects.project_service import add_conversation_to_project, ensure_default_project
from app.services.search.search_indexer import rebuild_search_documents_for_conversation
from app.services.toc.toc_builder import rebuild_headings_for_conversation
from app.services.exporting.cr_archive import CrArchiveError, import_cr_archive


class CommitImportError(ValueError):
    pass


T = TypeVar("T")


@dataclass(frozen=True)
class CommitImportResult:
    import_id: uuid.UUID
    status: str
    conversation_ids: list[uuid.UUID]
    conversation_count: int
    message_count: int
    warnings: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class PersistableMessage:
    role: str
    plain_text: str
    display_text: str
    order_key: str
    turn_index: int | None
    created_at: datetime | None
    content_hash: str
    edit_type: str
    warnings: list[str]
    source_json_index: int | None = None
    source_markdown_index: int | None = None
    source_conversation_id: str | None = None
    source_node_id: str | None = None
    source_message_id: str | None = None
    parent_node_id: str | None = None
    child_node_ids: list[str] = field(default_factory=list)
    is_primary_path: bool = True
    raw_metadata: dict = field(default_factory=dict)


@dataclass(frozen=True)
class PersistableConversation:
    title: str
    display_title: str
    source_type: str
    source_profile: str
    external_source_id: str | None
    created_at: datetime | None
    updated_at: datetime | None
    imported_at: datetime
    first_user_message: str | None
    parser_version: str
    render_version: int
    content_hash: str | None
    sort_time: datetime | None
    alignment_status: str
    branch_count: int
    cleaned_thinking_summary_count: int
    warnings: list[str]
    messages: list[PersistableMessage]


ProgressCallback = Callable[[str, int, int, int], None]


def commit_import_preview(
    import_id: uuid.UUID,
    db: Session,
    progress_callback: ProgressCallback | None = None,
) -> CommitImportResult:
    import_record = db.get(ImportRecord, import_id)
    if import_record is None:
        raise CommitImportError("Import record not found.")
    if import_record.committed_at is not None or import_record.status == "committed":
        raise CommitImportError("Import has already been committed.")

    artifacts = (
        db.query(SourceArtifact)
        .filter(SourceArtifact.import_id == import_id)
        .order_by(SourceArtifact.created_at.asc())
        .all()
    )
    if not artifacts:
        raise CommitImportError("Import has no source artifacts to commit.")

    archive_artifact = next((artifact for artifact in artifacts if artifact.source_profile == "chat_reader_archive_v1"), None)
    if archive_artifact is not None:
        try:
            conversation, message_count = import_cr_archive(
                db,
                import_record=import_record,
                artifact=archive_artifact,
                progress_callback=progress_callback,
            )
        except CrArchiveError as exc:
            raise CommitImportError(str(exc)) from exc
        now = datetime.now(timezone.utc)
        import_record.conversation_id = conversation.id
        import_record.status = "committed"
        import_record.phase = "completed"
        import_record.progress = 100
        import_record.processed_messages = message_count
        import_record.total_messages = message_count
        import_record.committed_at = now
        import_record.completed_at = now
        import_record.heartbeat_at = now
        import_record.error_message = None
        db.add(
            ConversationEvent(
                id=uuid.uuid4(),
                conversation_id=conversation.id,
                event_type="conversation_imported",
                payload={"import_id": str(import_id), "source_profile": "chat_reader_archive_v1"},
                created_by="system",
            )
        )
        db.commit()
        return CommitImportResult(
            import_id=import_id,
            status="committed",
            conversation_ids=[conversation.id],
            conversation_count=1,
            message_count=message_count,
            warnings=[],
        )

    _report(progress_callback, "parsing", 3, 0, 0)
    persistable = _build_persistable_conversations(import_id, artifacts)
    if not persistable:
        raise CommitImportError("No supported canonical conversation could be built from this import.")

    total_expected_messages = sum(len(draft.messages) for draft in persistable)
    _report(progress_callback, "persisting", 10, 0, total_expected_messages)

    conversation_ids: list[uuid.UUID] = []
    total_messages = 0
    all_warnings: list[str] = []
    default_project = ensure_default_project(db)

    for conversation_draft in persistable:
        conversation = _persist_conversation(
            import_record,
            artifacts,
            conversation_draft,
            db,
            progress_callback=progress_callback,
            processed_before=total_messages,
            total_messages=total_expected_messages,
        )
        add_conversation_to_project(db, default_project.id, conversation.id, added_by="system")
        conversation_ids.append(conversation.id)
        total_messages += conversation.message_count
        all_warnings.extend(conversation_draft.warnings)

    for index, conversation_id in enumerate(conversation_ids, start=1):
        _report(progress_callback, "headings", 75 + round(10 * (index - 1) / max(len(conversation_ids), 1)), total_messages, total_expected_messages)
        rebuild_headings_for_conversation(db, conversation_id)
    _report(progress_callback, "headings", 85, total_messages, total_expected_messages)

    for index, conversation_id in enumerate(conversation_ids, start=1):
        _report(progress_callback, "search", 85 + round(13 * (index - 1) / max(len(conversation_ids), 1)), total_messages, total_expected_messages)
        rebuild_search_documents_for_conversation(db, conversation_id)
    _report(progress_callback, "search", 98, total_messages, total_expected_messages)

    for conversation_id in conversation_ids:
        conversation = db.get(Conversation, conversation_id)
        if conversation is not None:
            conversation.status = "active"

    import_record.conversation_id = conversation_ids[0] if conversation_ids else None
    import_record.status = "committed"
    import_record.phase = "completed"
    import_record.progress = 100
    import_record.processed_messages = total_messages
    import_record.total_messages = total_expected_messages
    import_record.committed_at = datetime.now(timezone.utc)
    import_record.completed_at = import_record.committed_at
    import_record.heartbeat_at = import_record.committed_at
    import_record.error_message = None
    import_record.warnings = list(dict.fromkeys((import_record.warnings or []) + all_warnings))
    db.commit()

    return CommitImportResult(
        import_id=import_id,
        status="committed",
        conversation_ids=conversation_ids,
        conversation_count=len(conversation_ids),
        message_count=total_messages,
        warnings=import_record.warnings,
    )


def _build_persistable_conversations(import_id: uuid.UUID, artifacts: list[SourceArtifact]) -> list[PersistableConversation]:
    profiles = {artifact.source_profile for artifact in artifacts}
    if profiles & {"chatgpt_exporter_json", "chatgpt_exporter_markdown"}:
        return _build_exporter_conversations(import_id, artifacts)
    if profiles & {"official_conversations_json", "official_conversation_json"}:
        return _build_official_conversations(import_id, artifacts)
    return []


def _build_exporter_conversations(import_id: uuid.UUID, artifacts: list[SourceArtifact]) -> list[PersistableConversation]:
    json_artifact = next((artifact for artifact in artifacts if artifact.source_profile == "chatgpt_exporter_json"), None)
    markdown_artifact = next((artifact for artifact in artifacts if artifact.source_profile == "chatgpt_exporter_markdown"), None)
    json_result = parse_exporter_json(_read_artifact(import_id, json_artifact)) if json_artifact else None
    markdown_result = parse_exporter_markdown(_read_artifact(import_id, markdown_artifact)) if markdown_artifact else None
    alignment = align_exporter_sources(json_result, markdown_result)
    if alignment.conversation is None:
        return []
    return [_from_exporter_draft(alignment.conversation)]


def _from_exporter_draft(draft: CanonicalDraftConversation) -> PersistableConversation:
    messages = [
        PersistableMessage(
            role=message.role,
            plain_text=message.plain_text,
            display_text=message.display_text,
            order_key=message.order_key,
            turn_index=message.turn_index,
            created_at=_parse_datetime(message.created_at),
            content_hash=message.content_hash,
            edit_type=message.edit_type,
            warnings=message.warnings,
            source_json_index=message.source_json_index,
            source_markdown_index=message.source_markdown_index,
            raw_metadata={"display_source": message.display_source},
        )
        for message in draft.messages
    ]
    return PersistableConversation(
        title=draft.title,
        display_title=draft.display_title,
        source_type=draft.source_type,
        source_profile=draft.source_profile,
        external_source_id=draft.external_source_id,
        created_at=_parse_datetime(draft.created_at),
        updated_at=_parse_datetime(draft.updated_at),
        imported_at=_parse_datetime(draft.imported_at) or datetime.now(timezone.utc),
        first_user_message=draft.first_user_message,
        parser_version=draft.parser_version,
        render_version=draft.render_version,
        content_hash=content_hash("\n".join(message.plain_text for message in draft.messages)),
        sort_time=_parse_datetime(draft.updated_at) or _parse_datetime(draft.created_at),
        alignment_status=draft.alignment_status,
        branch_count=0,
        cleaned_thinking_summary_count=draft.cleaned_thinking_summary_count,
        warnings=draft.warnings,
        messages=messages,
    )


def _build_official_conversations(import_id: uuid.UUID, artifacts: list[SourceArtifact]) -> list[PersistableConversation]:
    official_artifact = next(
        (
            artifact
            for artifact in artifacts
            if artifact.source_profile in {"official_conversations_json", "official_conversation_json"}
        ),
        None,
    )
    if official_artifact is None:
        return []
    parse_result = parse_official_json(_read_artifact(import_id, official_artifact))
    return [_from_official_conversation(conversation, parse_result.source_profile) for conversation in parse_result.conversations]


def _from_official_conversation(
    conversation: OfficialConversationResult,
    source_profile: str,
) -> PersistableConversation:
    primary = resolve_primary_path(conversation.mapping, conversation.current_node)
    messages: list[PersistableMessage] = []
    turn_index = 0
    warnings = list(conversation.warnings) + list(primary.warnings)

    for node_id in primary.primary_message_node_ids:
        node = conversation.mapping.get(node_id, {})
        message = node.get("message") if isinstance(node, dict) else {}
        if not isinstance(message, dict):
            continue
        role = _map_official_role(message.get("author", {}).get("role") if isinstance(message.get("author"), dict) else None)
        if role == "user":
            turn_index += 1
        text, content_warnings = _extract_content(message.get("content"))
        if not normalize_text(text):
            warnings.append(f"Filtered empty official message node {node_id}.")
            continue
        metadata_preview = _metadata_preview(message.get("metadata"))
        messages.append(
            PersistableMessage(
                role=role,
                plain_text=text,
                display_text=text,
                order_key=f"{len(messages) + 1:06d}",
                turn_index=turn_index if role in {"user", "assistant"} else None,
                created_at=_parse_datetime(message.get("create_time")),
                content_hash=content_hash(text),
                edit_type="imported",
                warnings=content_warnings,
                source_conversation_id=conversation.external_conversation_id,
                source_node_id=node_id,
                source_message_id=str(message.get("id")) if message.get("id") is not None else None,
                parent_node_id=str(node.get("parent")) if isinstance(node, dict) and node.get("parent") is not None else None,
                child_node_ids=[str(child) for child in node.get("children", [])] if isinstance(node, dict) and isinstance(node.get("children"), list) else [],
                is_primary_path=True,
                raw_metadata=metadata_preview,
            )
        )

    first_user_message = next((message.plain_text for message in messages if message.role == "user"), None)
    return PersistableConversation(
        title=conversation.title,
        display_title=conversation.title,
        source_type="official_chatgpt_export" if source_profile == "official_conversations_json" else "official_chatgpt_conversation",
        source_profile=source_profile,
        external_source_id=conversation.external_conversation_id,
        created_at=_parse_datetime(conversation.create_time),
        updated_at=_parse_datetime(conversation.update_time),
        imported_at=datetime.now(timezone.utc),
        first_user_message=first_user_message,
        parser_version=PARSER_VERSION,
        render_version=1,
        content_hash=content_hash("\n".join(message.plain_text for message in messages)),
        sort_time=_parse_datetime(conversation.update_time) or _parse_datetime(conversation.create_time),
        alignment_status="official_primary_path",
        branch_count=primary.branch_count,
        cleaned_thinking_summary_count=0,
        warnings=warnings,
        messages=messages,
    )


def _persist_conversation(
    import_record: ImportRecord,
    artifacts: list[SourceArtifact],
    draft: PersistableConversation,
    db: Session,
    *,
    progress_callback: ProgressCallback | None = None,
    processed_before: int = 0,
    total_messages: int = 0,
) -> Conversation:
    conversation = Conversation(
        id=uuid.uuid4(),
        title=draft.title,
        display_title=draft.display_title,
        source_type=draft.source_type,
        source_profile=draft.source_profile,
        external_source_id=draft.external_source_id,
        status="importing",
        created_at=draft.created_at,
        updated_at=draft.updated_at,
        imported_at=draft.imported_at,
        message_count=len(draft.messages),
        turn_count=sum(1 for message in draft.messages if message.role == "user"),
        first_user_message=draft.first_user_message,
        parser_version=draft.parser_version,
        render_version=draft.render_version,
        content_hash=draft.content_hash,
        sort_time=draft.sort_time,
    )
    db.add(conversation)
    db.flush()

    _persist_messages(
        conversation,
        draft.messages,
        db,
        progress_callback=progress_callback,
        processed_before=processed_before,
        total_messages=total_messages,
    )

    event_payload = {
        "import_id": str(import_record.id),
        "source_profile": draft.source_profile,
        "source_artifact_ids": [str(artifact.id) for artifact in artifacts],
        "message_count": len(draft.messages),
        "alignment_status": draft.alignment_status,
        "branch_count": draft.branch_count,
        "cleaned_thinking_summary_count": draft.cleaned_thinking_summary_count,
    }
    db.add(
        ConversationEvent(
            id=uuid.uuid4(),
            conversation_id=conversation.id,
            event_type="conversation_imported",
            payload=event_payload,
            created_by="system",
        )
    )
    return conversation


def _persist_messages(
    conversation: Conversation,
    drafts: list[PersistableMessage],
    db: Session,
    *,
    progress_callback: ProgressCallback | None = None,
    processed_before: int = 0,
    total_messages: int = 0,
) -> None:
    completed = 0
    for batch in _batches(drafts, 25):
        message_rows: list[dict] = []
        version_rows: list[dict] = []
        block_rows: list[dict] = []
        source_ref_rows: list[dict] = []

        for draft in batch:
            message_id = uuid.uuid4()
            version_id = uuid.uuid4()
            block_drafts = build_basic_render_blocks(draft.display_text)
            char_count = len(draft.display_text)
            block_count = len(block_drafts)
            message_rows.append(
                {
                    "id": message_id,
                    "conversation_id": conversation.id,
                    "role": draft.role,
                    "order_key": draft.order_key,
                    "turn_index": draft.turn_index,
                    "created_at": draft.created_at,
                    "current_version_id": version_id,
                    "created_by": "import",
                    "source_type": "import",
                    "content_hash": draft.content_hash,
                    "block_count": block_count,
                    "char_count": char_count,
                    "is_heavy": char_count > 12000 or block_count > 80,
                }
            )
            version_rows.append(
                {
                    "id": version_id,
                    "message_id": message_id,
                    "version_number": 1,
                    "plain_text": draft.plain_text,
                    "display_text": draft.display_text,
                    "blocks": [],
                    "edit_type": draft.edit_type,
                    "created_by": "import",
                    "content_hash": draft.content_hash,
                }
            )
            block_rows.extend(
                {
                    "id": uuid.uuid4(),
                    "message_version_id": version_id,
                    "block_index": index,
                    "block_type": block.block_type,
                    "plain_text": block.plain_text,
                    "data": block.data,
                    "char_count": block.char_count,
                    "collapsed_by_default": block.collapsed_by_default,
                    "render_priority": block.render_priority,
                }
                for index, block in enumerate(block_drafts)
            )
            source_ref_rows.append(
                {
                    "id": uuid.uuid4(),
                    "message_id": message_id,
                    "source_type": conversation.source_type,
                    "source_profile": conversation.source_profile,
                    "source_conversation_id": draft.source_conversation_id or conversation.external_source_id,
                    "source_node_id": draft.source_node_id,
                    "source_message_id": draft.source_message_id,
                    "source_json_index": draft.source_json_index,
                    "source_markdown_index": draft.source_markdown_index,
                    "parent_node_id": draft.parent_node_id,
                    "child_node_ids": draft.child_node_ids,
                    "is_primary_path": draft.is_primary_path,
                    "raw_metadata": {"warnings": draft.warnings, **draft.raw_metadata},
                }
            )

        db.execute(insert(Message), message_rows)
        db.execute(insert(MessageVersion), version_rows)
        for block_batch in _batches(block_rows, 500):
            insert_rows(db, RenderBlock, block_batch)
        db.execute(insert(SourceMessageRef), source_ref_rows)
        completed += len(batch)
        processed = processed_before + completed
        progress = 10 + round(65 * processed / max(total_messages, 1))
        _report(progress_callback, "persisting", min(progress, 75), processed, total_messages)


def _batches(items: list[T], size: int) -> list[list[T]]:
    return [items[index : index + size] for index in range(0, len(items), size)]


def _report(
    callback: ProgressCallback | None,
    phase: str,
    progress: int,
    processed_messages: int,
    total_messages: int,
) -> None:
    if callback is not None:
        callback(phase, progress, processed_messages, total_messages)


def _read_artifact(import_id: uuid.UUID, artifact: SourceArtifact | None) -> bytes:
    if artifact is None:
        raise CommitImportError("Expected source artifact is missing.")
    path = Path(get_settings().import_storage_dir) / str(import_id) / artifact.safe_filename
    if not path.exists():
        raise CommitImportError("Source artifact file is missing from local storage.")
    return path.read_bytes()


def _map_official_role(role: Any) -> str:
    if role in {"user", "assistant", "system", "tool"}:
        return str(role)
    return "unknown"


def _parse_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, int | float):
        return datetime.fromtimestamp(value, tz=timezone.utc)
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            try:
                return datetime.strptime(value, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
            except ValueError:
                return None
    return None
