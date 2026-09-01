import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, TypeVar

from sqlalchemy import insert
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.conversation import Conversation
from app.models.attachment import Attachment, MessageVersionAttachment
from app.models.annotation import ConversationAnnotation, ConversationNotebook
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
    BLOCK_BUILDER_VERSION,
    MARKDOWN_PARSER_VERSION,
    NORMALIZER_VERSION,
    PARSER_VERSION,
    SEARCH_DOCUMENT_VERSION,
    CanonicalDraftConversation,
    CanonicalDraftMessage,
    content_hash,
    normalize_text,
)
from app.services.import_pipeline.exporter_aligner import align_exporter_sources
from app.services.import_pipeline.exporter_json_parser import parse_exporter_json
from app.services.import_pipeline.exporter_markdown_parser import parse_exporter_markdown
from app.services.import_pipeline.draft_store import ImportDraftError, read_import_draft
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
    source_current_version_id: str | None = None
    versions: list["PersistableVersion"] = field(default_factory=list)


@dataclass(frozen=True)
class PersistableVersion:
    source_id: str | None
    version_number: int
    plain_text: str
    display_text: str
    content_hash: str
    edit_type: str
    edit_reason: str | None
    created_at: datetime | None
    based_on_source_version_id: str | None


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
    annotations: list[dict] = field(default_factory=list)
    notebooks: list[dict] = field(default_factory=list)
    source_refs: list[dict] = field(default_factory=list)
    attachments: list[dict] = field(default_factory=list)


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

    archive_artifact = next(
        (artifact for artifact in artifacts if artifact.source_profile in {"chat_reader_cr_v2", "chat_reader_archive_v1"}),
        None,
    )
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
        import_record.session_state = "COMPLETED"
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
                payload={"import_id": str(import_id), "source_profile": archive_artifact.source_profile},
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
    if import_record.draft_storage_uri:
        try:
            persistable = [_from_exporter_draft(draft) for draft in read_import_draft(import_record)]
        except ImportDraftError as exc:
            raise CommitImportError(str(exc)) from exc
    else:
        persistable = _build_persistable_conversations(import_id, artifacts)
    if not persistable:
        raise CommitImportError("No supported canonical conversation could be built from this import.")

    total_expected_messages = sum(len(draft.messages) for draft in persistable)
    _report(progress_callback, "persisting", 10, 0, total_expected_messages)

    conversation_ids: list[uuid.UUID] = []
    total_messages = 0
    all_warnings: list[str] = []
    from app.services.ownership import OwnershipScope
    import_scope = OwnershipScope(import_record.owner_user_id, include_legacy_unowned=import_record.owner_user_id is None)
    default_project = ensure_default_project(db, import_scope)

    for conversation_draft in persistable:
        try:
            with db.begin_nested():
                conversation = _persist_conversation(
                    import_record,
                    artifacts,
                    conversation_draft,
                    db,
                    progress_callback=progress_callback,
                    processed_before=total_messages,
                    total_messages=total_expected_messages,
                )
                add_conversation_to_project(db, default_project.id, conversation.id, added_by="system", ownership_scope=import_scope)
                _report(progress_callback, "headings", 78, total_messages, total_expected_messages)
                rebuild_headings_for_conversation(db, conversation.id)
                _report(progress_callback, "search", 88, total_messages, total_expected_messages)
                rebuild_search_documents_for_conversation(db, conversation.id)
                conversation.status = "active"
                db.flush()
            conversation_ids.append(conversation.id)
            total_messages += conversation.message_count
            all_warnings.extend(conversation_draft.warnings)
        except Exception as exc:
            failure = f"Conversation {conversation_draft.title!r} failed canonical commit ({type(exc).__name__}: {str(exc)[:300]})."
            all_warnings.append(failure)
            if len(persistable) == 1:
                raise CommitImportError(failure) from exc

    if not conversation_ids:
        raise CommitImportError("No conversation could be committed from this import.")
    _report(progress_callback, "search", 98, total_messages, total_expected_messages)

    import_record.conversation_id = conversation_ids[0] if conversation_ids else None
    import_record.status = "committed"
    import_record.phase = "completed"
    import_record.session_state = "COMPLETED"
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
    markdown_result = (
        parse_exporter_markdown(
            _read_artifact(import_id, markdown_artifact),
            json_result.messages if json_result is not None else None,
        )
        if markdown_artifact
        else None
    )
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
            source_message_id=message.source_message_id,
            source_current_version_id=message.source_current_version_id,
            versions=[
                PersistableVersion(
                    source_id=version.source_id,
                    version_number=version.version_number,
                    plain_text=version.plain_text,
                    display_text=version.display_text,
                    content_hash=version.content_hash,
                    edit_type=version.edit_type,
                    edit_reason=version.edit_reason,
                    created_at=_parse_datetime(version.created_at),
                    based_on_source_version_id=version.based_on_source_version_id,
                )
                for version in message.versions
            ],
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
        annotations=draft.annotations,
        notebooks=draft.notebooks,
        source_refs=draft.source_refs,
        attachments=draft.attachments,
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
        owner_user_id=import_record.owner_user_id,
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

    attachment_map = _persist_canjson_attachments(db, import_record, conversation, draft)
    persistable_messages = _rewrite_persistable_attachment_ids(draft.messages, attachment_map)
    identity_map = _persist_messages(
        conversation,
        persistable_messages,
        db,
        preserved_source_message_ids={
            str(ref.get("message_id"))
            for ref in draft.source_refs
            if isinstance(ref, dict) and ref.get("message_id")
        },
        progress_callback=progress_callback,
        processed_before=processed_before,
        total_messages=total_messages,
    )
    _persist_canjson_private_content(db, conversation, draft, identity_map, attachment_map)

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
    preserved_source_message_ids: set[str] | None = None,
    progress_callback: ProgressCallback | None = None,
    processed_before: int = 0,
    total_messages: int = 0,
) -> dict[str, tuple[uuid.UUID, dict[str, uuid.UUID]]]:
    preserved_source_message_ids = preserved_source_message_ids or set()
    completed = 0
    identity_map: dict[str, tuple[uuid.UUID, dict[str, uuid.UUID]]] = {}
    for batch in _batches(drafts, 25):
        message_rows: list[dict] = []
        version_rows: list[dict] = []
        block_rows: list[dict] = []
        source_ref_rows: list[dict] = []

        for draft in batch:
            message_id = uuid.uuid4()
            version_drafts = draft.versions or [
                PersistableVersion(
                    source_id=draft.source_current_version_id,
                    version_number=1,
                    plain_text=draft.plain_text,
                    display_text=draft.display_text,
                    content_hash=draft.content_hash,
                    edit_type=draft.edit_type,
                    edit_reason=None,
                    created_at=None,
                    based_on_source_version_id=None,
                )
            ]
            version_ids = {version.source_id or f"version-{index}": uuid.uuid4() for index, version in enumerate(version_drafts)}
            current_source_id = draft.source_current_version_id
            current_index = next(
                (index for index, version in enumerate(version_drafts) if current_source_id and version.source_id == current_source_id),
                len(version_drafts) - 1,
            )
            current_version_draft = version_drafts[current_index]
            current_key = current_version_draft.source_id or f"version-{current_index}"
            current_version_id = version_ids[current_key]
            current_blocks = build_basic_render_blocks(current_version_draft.display_text)
            if draft.source_message_id:
                identity_map[draft.source_message_id] = (message_id, dict(version_ids))
            char_count = len(current_version_draft.display_text)
            block_count = len(current_blocks)
            message_rows.append(
                {
                    "id": message_id,
                    "conversation_id": conversation.id,
                    "role": draft.role,
                    "order_key": draft.order_key,
                    "turn_index": draft.turn_index,
                    "created_at": draft.created_at,
                    "current_version_id": current_version_id,
                    "created_by": "import",
                    "source_type": "import",
                    "content_hash": current_version_draft.content_hash,
                    "block_count": block_count,
                    "char_count": char_count,
                    "is_heavy": char_count > 12000 or block_count > 80,
                }
            )
            for version_index, version in enumerate(version_drafts):
                version_key = version.source_id or f"version-{version_index}"
                version_id = version_ids[version_key]
                based_on_id = version_ids.get(version.based_on_source_version_id or "")
                version_rows.append(
                    {
                        "id": version_id,
                        "message_id": message_id,
                        "version_number": version.version_number,
                        "plain_text": version.plain_text,
                        "display_text": version.display_text,
                        "blocks": [],
                        "edit_type": version.edit_type,
                        "edit_reason": version.edit_reason,
                        "created_at": version.created_at or datetime.now(timezone.utc),
                        "created_by": "import",
                        "based_on_version_id": based_on_id,
                        "content_hash": version.content_hash,
                        "normalizer_version": NORMALIZER_VERSION,
                        "markdown_parser_version": MARKDOWN_PARSER_VERSION,
                        "block_builder_version": BLOCK_BUILDER_VERSION,
                        "search_document_version": SEARCH_DOCUMENT_VERSION,
                    }
                )
                version_blocks = build_basic_render_blocks(version.display_text)
                block_rows.extend(
                    {
                        "id": uuid.uuid4(),
                        "message_version_id": version_id,
                        "block_index": block_index,
                        "block_type": block.block_type,
                        "plain_text": block.plain_text,
                        "data": block.data,
                        "char_count": block.char_count,
                        "collapsed_by_default": block.collapsed_by_default,
                        "render_priority": block.render_priority,
                    }
                    for block_index, block in enumerate(version_blocks)
                )
            if not draft.source_message_id or draft.source_message_id not in preserved_source_message_ids:
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
        if source_ref_rows:
            db.execute(insert(SourceMessageRef), source_ref_rows)
        completed += len(batch)
        processed = processed_before + completed
        progress = 10 + round(65 * processed / max(total_messages, 1))
        _report(progress_callback, "persisting", min(progress, 75), processed, total_messages)
    return identity_map


def _persist_canjson_private_content(
    db: Session,
    conversation: Conversation,
    draft: PersistableConversation,
    identity_map: dict[str, tuple[uuid.UUID, dict[str, uuid.UUID]]],
    attachment_map: dict[str, uuid.UUID],
) -> None:
    subject_key = str(conversation.owner_user_id) if conversation.owner_user_id else "local:default"
    _persist_canjson_source_refs(db, draft, identity_map)
    _persist_canjson_attachment_refs(db, draft, identity_map, attachment_map)
    annotation_ids: dict[str, uuid.UUID] = {}
    for raw in draft.annotations:
        if not isinstance(raw, dict):
            continue
        source_message_id = str(raw.get("message_id") or "")
        mapped = identity_map.get(source_message_id)
        if mapped is None:
            continue
        source_annotation_id = str(raw.get("id") or uuid.uuid4())
        annotation_id = uuid.uuid4()
        annotation_ids[source_annotation_id] = annotation_id
        source_version_id = str(raw.get("version_id") or raw.get("message_version_id") or "")
        mapped_version_id = mapped[1].get(source_version_id)
        status = str(raw.get("anchor_status") or "valid")
        status = {"active": "valid", "relocated": "remapped", "stale": "needs_review"}.get(status, status)
        if status not in {"valid", "remapped", "orphaned", "needs_review"}:
            status = "needs_review"
        db.add(
            ConversationAnnotation(
                id=annotation_id,
                subject_key=subject_key,
                conversation_id=conversation.id,
                message_id=mapped[0],
                message_version_id=mapped_version_id,
                annotation_type=str(raw.get("annotation_type") or "highlight"),
                color=raw.get("color"),
                start_block_index=raw.get("start_block_index"),
                start_offset=raw.get("start_offset"),
                end_block_index=raw.get("end_block_index"),
                end_offset=raw.get("end_offset"),
                quote=raw.get("quoted_text") or raw.get("quote"),
                prefix=raw.get("prefix") or raw.get("before_context"),
                suffix=raw.get("suffix") or raw.get("after_context"),
                comment_markdown=str(raw.get("comment_markdown") or ""),
                anchor_status=status,
                revision=1,
                metadata_={"source_annotation_id": source_annotation_id},
            )
        )

    for raw in draft.notebooks:
        if not isinstance(raw, dict):
            continue
        blocks = raw.get("blocks") if isinstance(raw.get("blocks"), list) else None
        if blocks is None:
            blocks = [{"id": str(uuid.uuid4()), "type": "markdown", "markdown": str(raw.get("content_markdown") or "")}]
        mapped_blocks = []
        for raw_block in blocks:
            if not isinstance(raw_block, dict):
                continue
            block = dict(raw_block)
            block["id"] = str(uuid.uuid4())
            if block.get("annotation_id"):
                mapped_annotation_id = annotation_ids.get(str(block["annotation_id"]))
                if mapped_annotation_id is None:
                    continue
                block["annotation_id"] = str(mapped_annotation_id)
            mapped_blocks.append(block)
        db.add(
            ConversationNotebook(
                id=uuid.uuid4(),
                subject_key=subject_key,
                conversation_id=conversation.id,
                title=str(raw.get("title") or "Imported notes"),
                blocks=mapped_blocks,
                revision=1,
            )
        )


def _persist_canjson_attachments(
    db: Session,
    import_record: ImportRecord,
    conversation: Conversation,
    draft: PersistableConversation,
) -> dict[str, uuid.UUID]:
    mapping: dict[str, uuid.UUID] = {}
    for raw in draft.attachments:
        if not isinstance(raw, dict) or raw.get("record_type") != "attachment":
            continue
        source_id = str(raw.get("id") or "").strip()
        if not source_id or source_id in mapping:
            raise CommitImportError("CanJSON attachment ids must be present and unique.")
        attachment_id = uuid.uuid4()
        mapping[source_id] = attachment_id
        metadata = raw.get("metadata") if isinstance(raw.get("metadata"), dict) else {}
        if isinstance(raw.get("asset_object"), dict):
            metadata = {**metadata, "asset_object": raw["asset_object"]}
        original_filename = Path(str(raw.get("original_filename") or raw.get("display_name") or "attachment.bin")).name
        db.add(Attachment(
            id=attachment_id,
            conversation_id=conversation.id,
            asset_object_id=None,
            import_id=import_record.id,
            original_filename=original_filename[:500] or "attachment.bin",
            display_name=str(raw.get("display_name") or original_filename or "Attachment")[:500],
            declared_mime_type=_optional_text(raw.get("declared_mime_type")),
            detected_mime_type=_optional_text(raw.get("detected_mime_type")),
            status="missing",
            scan_status="not_available",
            source_type="canjson",
            source_attachment_id=source_id,
            metadata_=metadata,
            resolution_status="unresolved",
        ))
    return mapping


def _rewrite_persistable_attachment_ids(
    messages: list[PersistableMessage],
    attachment_map: dict[str, uuid.UUID],
) -> list[PersistableMessage]:
    if not attachment_map:
        return messages
    from dataclasses import replace

    rewritten: list[PersistableMessage] = []
    replacements = {source_id: str(target_id) for source_id, target_id in attachment_map.items()}
    for message in messages:
        versions = []
        for version in message.versions:
            display_text = _rewrite_asset_markdown(version.display_text, replacements)
            versions.append(replace(
                version,
                display_text=display_text,
                plain_text=normalize_text(display_text),
                content_hash=content_hash(display_text, message.role),
            ))
        display_text = _rewrite_asset_markdown(message.display_text, replacements)
        current = next(
            (version for version in versions if version.source_id == message.source_current_version_id),
            versions[-1] if versions else None,
        )
        if current is not None:
            display_text = current.display_text
        rewritten.append(replace(
            message,
            display_text=display_text,
            plain_text=normalize_text(display_text),
            content_hash=content_hash(display_text, message.role),
            versions=versions,
        ))
    return rewritten


def _rewrite_asset_markdown(markdown: str, replacements: dict[str, str]) -> str:
    lines: list[str] = []
    fence: str | None = None
    for line in markdown.splitlines(keepends=True):
        stripped = line.strip()
        if stripped.startswith(("```", "~~~")):
            marker = stripped[:3]
            fence = None if fence == marker else marker if fence is None else fence
            lines.append(line)
            continue
        if fence is None:
            for source_id, target_id in replacements.items():
                line = line.replace(f"cr-asset://{source_id})", f"cr-asset://{target_id})")
        lines.append(line)
    return "".join(lines)


def _persist_canjson_attachment_refs(
    db: Session,
    draft: PersistableConversation,
    identity_map: dict[str, tuple[uuid.UUID, dict[str, uuid.UUID]]],
    attachment_map: dict[str, uuid.UUID],
) -> None:
    if not attachment_map:
        return
    current_versions = {
        message.source_message_id: message.source_current_version_id
        for message in draft.messages
        if message.source_message_id
    }
    seen: set[tuple[uuid.UUID, uuid.UUID, str, int]] = set()
    for raw in draft.attachments:
        if not isinstance(raw, dict) or raw.get("record_type") != "attachment_ref":
            continue
        attachment_id = attachment_map.get(str(raw.get("attachment_id") or ""))
        source_message_id = str(raw.get("message_id") or "")
        mapped = identity_map.get(source_message_id)
        if attachment_id is None or mapped is None:
            raise CommitImportError("CanJSON attachment reference is invalid.")
        source_version_id = str(raw.get("message_version_id") or current_versions.get(source_message_id) or "")
        version_id = mapped[1].get(source_version_id)
        if version_id is None:
            raise CommitImportError("CanJSON attachment reference points to an unknown version.")
        relation_type = str(raw.get("relation_type") or "file")[:50]
        display_order = int(raw.get("display_order") or 0)
        identity = (version_id, attachment_id, relation_type, display_order)
        if identity in seen:
            continue
        seen.add(identity)
        db.add(MessageVersionAttachment(
            id=uuid.uuid4(),
            message_version_id=version_id,
            attachment_id=attachment_id,
            occurrence_key=str(raw.get("occurrence_key") or uuid.uuid4().hex)[:255],
            placement=str(raw.get("placement") or "inline")[:50],
            relation_type=relation_type,
            display_order=display_order,
            block_index=raw.get("block_index"),
            display_mode=str(raw.get("display_mode") or "card")[:50],
            alt_text=_optional_text(raw.get("alt_text")),
            caption=_optional_text(raw.get("caption")),
        ))

def _persist_canjson_source_refs(
    db: Session,
    draft: PersistableConversation,
    identity_map: dict[str, tuple[uuid.UUID, dict[str, uuid.UUID]]],
) -> None:
    rows: list[dict[str, Any]] = []
    seen: set[tuple[uuid.UUID, str, str, str | None, int | None]] = set()
    for raw in draft.source_refs:
        if not isinstance(raw, dict):
            continue
        mapped = identity_map.get(str(raw.get("message_id") or ""))
        if mapped is None:
            continue
        source_type = _bounded_text(raw.get("source_type"), draft.source_type)
        source_profile = _bounded_text(raw.get("source_profile"), draft.source_profile)
        source_message_id = _optional_text(raw.get("source_message_id"))
        source_index = _optional_non_negative_int(raw.get("source_index"))
        identity = (mapped[0], source_type, source_profile, source_message_id, source_index)
        if identity in seen:
            continue
        seen.add(identity)
        rows.append(
            {
                "id": uuid.uuid4(),
                "message_id": mapped[0],
                "source_type": source_type,
                "source_profile": source_profile,
                "source_conversation_id": _optional_text(raw.get("source_conversation_id")),
                "source_message_id": source_message_id,
                "source_json_index": source_index,
                "source_markdown_index": None,
                "child_node_ids": [],
                "is_primary_path": True,
                "raw_metadata": _sanitize_source_metadata(raw.get("source_metadata")),
            }
        )
    if rows:
        db.execute(insert(SourceMessageRef), rows)


def _sanitize_source_metadata(value: Any, *, depth: int = 0) -> Any:
    if depth >= 8:
        return None
    if isinstance(value, dict):
        result: dict[str, Any] = {}
        for raw_key, raw_value in list(value.items())[:100]:
            key = str(raw_key)[:200]
            lowered = key.casefold()
            if any(marker in lowered for marker in ("path", "uri", "token", "secret", "password", "cookie", "dsn", "connection")):
                continue
            sanitized = _sanitize_source_metadata(raw_value, depth=depth + 1)
            if sanitized is not None:
                result[key] = sanitized
        return result
    if isinstance(value, list):
        return [item for item in (_sanitize_source_metadata(item, depth=depth + 1) for item in value[:100]) if item is not None]
    if isinstance(value, str):
        normalized = value.strip()
        lowered = normalized.casefold()
        if (
            normalized.startswith(("/", "\\\\"))
            or (len(normalized) >= 3 and normalized[1:3] in {":\\", ":/"})
            or "storage/imports" in lowered
            or "postgresql://" in lowered
            or "postgresql+" in lowered
        ):
            return None
        return value[:16_384]
    if isinstance(value, (bool, int, float)) or value is None:
        return value
    return str(value)[:1_024]


def _bounded_text(value: Any, default: str) -> str:
    normalized = str(value or default).strip()
    return (normalized or default)[:200]


def _optional_text(value: Any) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized[:2_048] if normalized else None


def _optional_non_negative_int(value: Any) -> int | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed >= 0 else None


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
