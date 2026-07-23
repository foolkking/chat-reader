import hashlib
import json
import uuid
from http import HTTPStatus

from sqlalchemy.orm import Session

from app.models.annotation import AnnotationSyncReceipt, ConversationAnnotation, ConversationNotebook
from app.models.conversation import Conversation
from app.models.import_record import utc_now
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.heading import Heading
from app.schemas.annotation import (
    AnnotationCreate,
    AnnotationRead,
    AnnotationSyncRequest,
    AnnotationSyncResponse,
    AnnotationUpdate,
    NotebookBlock,
    NotebookPut,
    NotebookRead,
    SyncOperation,
    SyncOperationResult,
)
from app.services.preferences import DEFAULT_SUBJECT_KEY


class AnnotationError(ValueError):
    def __init__(self, message: str, status_code: int = HTTPStatus.BAD_REQUEST) -> None:
        super().__init__(message)
        self.status_code = status_code


def list_annotations(
    db: Session, conversation_id: uuid.UUID, *, include_deleted: bool = False
) -> list[ConversationAnnotation]:
    _conversation(db, conversation_id)
    query = db.query(ConversationAnnotation).filter(
        ConversationAnnotation.conversation_id == conversation_id,
        ConversationAnnotation.subject_key == DEFAULT_SUBJECT_KEY,
    )
    if not include_deleted:
        query = query.filter(ConversationAnnotation.is_deleted.is_(False))
    return query.outerjoin(Message, Message.id == ConversationAnnotation.message_id).order_by(
        Message.order_key.asc(),
        ConversationAnnotation.start_block_index.asc(),
        ConversationAnnotation.created_at.asc(),
        ConversationAnnotation.id.asc(),
    ).all()


def create_annotation(
    db: Session, conversation_id: uuid.UUID, payload: AnnotationCreate
) -> ConversationAnnotation:
    conversation = _conversation(db, conversation_id)
    _validate_annotation_anchor(db, conversation_id, payload)
    annotation_id = payload.id or uuid.uuid4()
    if db.get(ConversationAnnotation, annotation_id) is not None:
        raise AnnotationError("Annotation id already exists.", HTTPStatus.CONFLICT)
    now = utc_now()
    values = _annotation_values(payload)
    values["metadata_"] = _annotation_metadata(db, conversation_id, payload)
    annotation = ConversationAnnotation(
        id=annotation_id,
        subject_key=DEFAULT_SUBJECT_KEY,
        conversation_id=conversation_id,
        **values,
        revision=1,
        created_at=now,
        updated_at=now,
    )
    db.add(annotation)
    _touch_conversation(conversation)
    db.flush()
    return annotation


def update_annotation(
    db: Session, annotation_id: uuid.UUID, payload: AnnotationUpdate
) -> ConversationAnnotation:
    annotation = _annotation(db, annotation_id)
    if annotation.revision != payload.base_revision:
        raise AnnotationError("Annotation revision conflict.", HTTPStatus.CONFLICT)
    values = payload.model_dump(exclude_unset=True, exclude={"base_revision"})
    if "metadata" in values:
        values["metadata_"] = values.pop("metadata")
    for key, value in values.items():
        setattr(annotation, key, value)
    annotation.revision += 1
    annotation.updated_at = utc_now()
    _validate_existing_anchor(db, annotation)
    annotation.metadata_ = _annotation_metadata(db, annotation.conversation_id, _annotation_create_from_model(annotation))
    _touch_conversation(_conversation(db, annotation.conversation_id))
    db.flush()
    return annotation


def delete_annotation(db: Session, annotation_id: uuid.UUID, base_revision: int) -> ConversationAnnotation:
    annotation = _annotation(db, annotation_id)
    if annotation.revision != base_revision:
        raise AnnotationError("Annotation revision conflict.", HTTPStatus.CONFLICT)
    annotation.is_deleted = True
    annotation.revision += 1
    annotation.updated_at = utc_now()
    _touch_conversation(_conversation(db, annotation.conversation_id))
    db.flush()
    return annotation


def get_notebook(db: Session, conversation_id: uuid.UUID) -> ConversationNotebook:
    conversation = _conversation(db, conversation_id)
    notebook = (
        db.query(ConversationNotebook)
        .filter(
            ConversationNotebook.conversation_id == conversation_id,
            ConversationNotebook.subject_key == DEFAULT_SUBJECT_KEY,
            ConversationNotebook.is_conflict.is_(False),
        )
        .order_by(ConversationNotebook.created_at.asc())
        .first()
    )
    if notebook is not None:
        return notebook
    now = utc_now()
    notebook = ConversationNotebook(
        id=uuid.uuid4(),
        subject_key=DEFAULT_SUBJECT_KEY,
        conversation_id=conversation_id,
        title=None,
        blocks=[],
        revision=1,
        created_at=now,
        updated_at=now,
    )
    db.add(notebook)
    _touch_conversation(conversation)
    db.flush()
    return notebook


def list_notebook_conflicts(db: Session, conversation_id: uuid.UUID) -> list[ConversationNotebook]:
    _conversation(db, conversation_id)
    return (
        db.query(ConversationNotebook)
        .filter(
            ConversationNotebook.conversation_id == conversation_id,
            ConversationNotebook.subject_key == DEFAULT_SUBJECT_KEY,
            ConversationNotebook.is_conflict.is_(True),
        )
        .order_by(ConversationNotebook.created_at.asc())
        .all()
    )


def put_notebook(
    db: Session, conversation_id: uuid.UUID, payload: NotebookPut
) -> ConversationNotebook:
    notebook = get_notebook(db, conversation_id)
    if payload.base_revision not in {0, notebook.revision}:
        raise AnnotationError("Notebook revision conflict.", HTTPStatus.CONFLICT)
    _validate_notebook_references(db, conversation_id, payload.blocks)
    notebook.title = payload.title.strip() or None if payload.title else None
    notebook.blocks = [block.model_dump(mode="json") for block in payload.blocks]
    notebook.revision += 1
    notebook.updated_at = utc_now()
    _touch_conversation(_conversation(db, conversation_id))
    db.flush()
    return notebook


def sync_annotations(db: Session, payload: AnnotationSyncRequest) -> AnnotationSyncResponse:
    results: list[SyncOperationResult] = []
    for operation in payload.operations:
        request_hash = _operation_hash(operation)
        receipt = db.get(AnnotationSyncReceipt, operation.operation_id)
        if receipt is not None:
            if receipt.request_hash != request_hash:
                raise AnnotationError("operation_id was reused with a different payload.", HTTPStatus.CONFLICT)
            saved = dict(receipt.response)
            saved["status"] = "duplicate"
            results.append(SyncOperationResult.model_validate(saved))
            continue
        result = _apply_sync_operation(db, operation)
        response_payload = result.model_dump(mode="json")
        db.add(
            AnnotationSyncReceipt(
                operation_id=operation.operation_id,
                subject_key=DEFAULT_SUBJECT_KEY,
                entity_type=operation.entity_type,
                entity_id=operation.entity_id,
                request_hash=request_hash,
                response=response_payload,
            )
        )
        db.flush()
        results.append(result)
    return AnnotationSyncResponse(results=results)


def annotation_read(annotation: ConversationAnnotation) -> AnnotationRead:
    return AnnotationRead(
        id=annotation.id,
        conversation_id=annotation.conversation_id,
        message_id=annotation.message_id,
        message_version_id=annotation.message_version_id,
        annotation_type=annotation.annotation_type,
        color=annotation.color,
        start_block_index=annotation.start_block_index,
        start_offset=annotation.start_offset,
        end_block_index=annotation.end_block_index,
        end_offset=annotation.end_offset,
        quote=annotation.quote,
        prefix=annotation.prefix,
        suffix=annotation.suffix,
        comment_markdown=annotation.comment_markdown,
        anchor_status=annotation.anchor_status,
        revision=annotation.revision,
        is_deleted=annotation.is_deleted,
        conflict_of_id=annotation.conflict_of_id,
        metadata=annotation.metadata_ or {},
        created_at=annotation.created_at,
        updated_at=annotation.updated_at,
    )


def notebook_read(notebook: ConversationNotebook) -> NotebookRead:
    return NotebookRead(
        id=notebook.id,
        conversation_id=notebook.conversation_id,
        title=notebook.title,
        blocks=[NotebookBlock.model_validate(block) for block in notebook.blocks],
        revision=notebook.revision,
        is_conflict=notebook.is_conflict,
        conflict_of_id=notebook.conflict_of_id,
        created_at=notebook.created_at,
        updated_at=notebook.updated_at,
    )


def relocate_annotations_for_new_version(
    db: Session,
    *,
    message: Message,
    version: MessageVersion,
    block_texts: list[str],
) -> None:
    annotations = (
        db.query(ConversationAnnotation)
        .filter(
            ConversationAnnotation.message_id == message.id,
            ConversationAnnotation.subject_key == DEFAULT_SUBJECT_KEY,
            ConversationAnnotation.is_deleted.is_(False),
        )
        .all()
    )
    if not annotations:
        return
    now = utc_now()
    for annotation in annotations:
        if annotation.annotation_type == "bookmark":
            annotation.message_version_id = version.id
            annotation.anchor_status = "active"
            annotation.revision += 1
            annotation.updated_at = now
            continue
        match = _relocate_quote(
            block_texts,
            annotation.quote or "",
            annotation.prefix or "",
            annotation.suffix or "",
        )
        if match is None:
            annotation.anchor_status = "stale"
        else:
            start_block, start_offset, end_block, end_offset = match
            annotation.message_version_id = version.id
            annotation.start_block_index = start_block
            annotation.start_offset = start_offset
            annotation.end_block_index = end_block
            annotation.end_offset = end_offset
            annotation.anchor_status = "relocated"
            annotation.metadata_ = _annotation_metadata(db, annotation.conversation_id, _annotation_create_from_model(annotation))
        annotation.revision += 1
        annotation.updated_at = now
    db.flush()


def _apply_sync_operation(db: Session, operation: SyncOperation) -> SyncOperationResult:
    _conversation(db, operation.conversation_id)
    if operation.entity_type == "annotation":
        return _sync_annotation(db, operation)
    return _sync_notebook(db, operation)


def _sync_annotation(db: Session, operation: SyncOperation) -> SyncOperationResult:
    existing = db.get(ConversationAnnotation, operation.entity_id)
    if existing is not None and existing.conversation_id != operation.conversation_id:
        raise AnnotationError("Annotation does not belong to the conversation.", HTTPStatus.CONFLICT)
    if operation.action == "delete":
        if existing is None:
            return SyncOperationResult(
                operation_id=operation.operation_id,
                entity_type="annotation",
                entity_id=operation.entity_id,
                status="applied",
                revision=max(operation.base_revision, 1),
            )
        if existing.revision == operation.base_revision:
            deleted = delete_annotation(db, existing.id, operation.base_revision)
            return _sync_result(operation, deleted.id, "applied", deleted.revision)
        conflict = _clone_annotation(db, existing, conflict_of_id=existing.id)
        return _sync_result(operation, existing.id, "conflict", existing.revision, conflict.id)

    payload = AnnotationCreate.model_validate({**operation.payload, "id": operation.entity_id})
    if existing is None:
        created = create_annotation(db, operation.conversation_id, payload)
        return _sync_result(operation, created.id, "applied", created.revision)
    if existing.revision != operation.base_revision:
        conflict = _annotation_from_payload(
            db,
            operation.conversation_id,
            payload,
            annotation_id=uuid.uuid4(),
            conflict_of_id=existing.id,
            revision=1,
        )
        return _sync_result(operation, existing.id, "conflict", existing.revision, conflict.id)
    update_payload = AnnotationUpdate.model_validate({**operation.payload, "base_revision": operation.base_revision})
    updated = update_annotation(db, existing.id, update_payload)
    return _sync_result(operation, updated.id, "applied", updated.revision)


def _sync_notebook(db: Session, operation: SyncOperation) -> SyncOperationResult:
    current = (
        db.query(ConversationNotebook)
        .filter(
            ConversationNotebook.conversation_id == operation.conversation_id,
            ConversationNotebook.subject_key == DEFAULT_SUBJECT_KEY,
            ConversationNotebook.is_conflict.is_(False),
        )
        .first()
    )
    payload = NotebookPut.model_validate({**operation.payload, "id": operation.entity_id, "base_revision": operation.base_revision})
    if current is None:
        now = utc_now()
        _validate_notebook_references(db, operation.conversation_id, payload.blocks)
        current = ConversationNotebook(
            id=operation.entity_id,
            subject_key=DEFAULT_SUBJECT_KEY,
            conversation_id=operation.conversation_id,
            title=payload.title,
            blocks=[block.model_dump(mode="json") for block in payload.blocks],
            revision=1,
            created_at=now,
            updated_at=now,
        )
        db.add(current)
        _touch_conversation(_conversation(db, operation.conversation_id))
        db.flush()
        return _sync_result(operation, current.id, "applied", current.revision)
    if current.revision != operation.base_revision:
        conflict = _clone_notebook_from_payload(db, current, payload)
        return _sync_result(operation, current.id, "conflict", current.revision, conflict.id)
    current.title = payload.title
    current.blocks = [block.model_dump(mode="json") for block in payload.blocks]
    current.revision += 1
    current.updated_at = utc_now()
    _touch_conversation(_conversation(db, operation.conversation_id))
    db.flush()
    return _sync_result(operation, current.id, "applied", current.revision)


def _annotation_from_payload(
    db: Session,
    conversation_id: uuid.UUID,
    payload: AnnotationCreate,
    *,
    annotation_id: uuid.UUID,
    conflict_of_id: uuid.UUID | None,
    revision: int,
) -> ConversationAnnotation:
    _validate_annotation_anchor(db, conversation_id, payload)
    now = utc_now()
    values = _annotation_values(payload)
    values["metadata_"] = _annotation_metadata(db, conversation_id, payload)
    annotation = ConversationAnnotation(
        id=annotation_id,
        subject_key=DEFAULT_SUBJECT_KEY,
        conversation_id=conversation_id,
        **values,
        revision=revision,
        conflict_of_id=conflict_of_id,
        created_at=now,
        updated_at=now,
    )
    db.add(annotation)
    _touch_conversation(_conversation(db, conversation_id))
    db.flush()
    return annotation


def _clone_annotation(
    db: Session, source: ConversationAnnotation, *, conflict_of_id: uuid.UUID
) -> ConversationAnnotation:
    now = utc_now()
    clone = ConversationAnnotation(
        id=uuid.uuid4(),
        subject_key=source.subject_key,
        conversation_id=source.conversation_id,
        message_id=source.message_id,
        message_version_id=source.message_version_id,
        annotation_type=source.annotation_type,
        color=source.color,
        start_block_index=source.start_block_index,
        start_offset=source.start_offset,
        end_block_index=source.end_block_index,
        end_offset=source.end_offset,
        quote=source.quote,
        prefix=source.prefix,
        suffix=source.suffix,
        comment_markdown=source.comment_markdown,
        anchor_status=source.anchor_status,
        revision=1,
        is_deleted=source.is_deleted,
        conflict_of_id=conflict_of_id,
        metadata_=source.metadata_ or {},
        created_at=now,
        updated_at=now,
    )
    db.add(clone)
    db.flush()
    return clone


def _clone_notebook_from_payload(
    db: Session, current: ConversationNotebook, payload: NotebookPut
) -> ConversationNotebook:
    _validate_notebook_references(db, current.conversation_id, payload.blocks)
    now = utc_now()
    conflict = ConversationNotebook(
        id=uuid.uuid4(),
        subject_key=DEFAULT_SUBJECT_KEY,
        conversation_id=current.conversation_id,
        title=payload.title,
        blocks=[block.model_dump(mode="json") for block in payload.blocks],
        revision=1,
        is_conflict=True,
        conflict_of_id=current.id,
        created_at=now,
        updated_at=now,
    )
    db.add(conflict)
    db.flush()
    return conflict


def _annotation_values(payload: AnnotationCreate) -> dict:
    values = payload.model_dump(exclude={"id", "metadata"})
    values["metadata_"] = payload.metadata
    return values


def _validate_annotation_anchor(db: Session, conversation_id: uuid.UUID, payload: AnnotationCreate) -> None:
    if payload.message_id is None:
        return
    message = db.get(Message, payload.message_id)
    if message is None or message.conversation_id != conversation_id or message.is_deleted:
        raise AnnotationError("Annotation message was not found.", HTTPStatus.NOT_FOUND)
    if payload.message_version_id is not None:
        version = db.get(MessageVersion, payload.message_version_id)
        if version is None or version.message_id != message.id:
            raise AnnotationError("Annotation version was not found.", HTTPStatus.NOT_FOUND)


def _validate_existing_anchor(db: Session, annotation: ConversationAnnotation) -> None:
    payload = _annotation_create_from_model(annotation)
    _validate_annotation_anchor(db, annotation.conversation_id, payload)


def _annotation_create_from_model(annotation: ConversationAnnotation) -> AnnotationCreate:
    return AnnotationCreate(
        message_id=annotation.message_id,
        message_version_id=annotation.message_version_id,
        annotation_type=annotation.annotation_type,
        color=annotation.color,
        start_block_index=annotation.start_block_index,
        start_offset=annotation.start_offset,
        end_block_index=annotation.end_block_index,
        end_offset=annotation.end_offset,
        quote=annotation.quote,
        prefix=annotation.prefix,
        suffix=annotation.suffix,
        comment_markdown=annotation.comment_markdown,
        anchor_status=annotation.anchor_status,
        metadata=annotation.metadata_ or {},
    )


def _annotation_metadata(db: Session, conversation_id: uuid.UUID, payload: AnnotationCreate) -> dict:
    metadata = dict(payload.metadata or {})
    if payload.message_id is None:
        return metadata
    message = db.get(Message, payload.message_id)
    if message is None:
        return metadata
    role_number = db.query(Message.id).filter(
        Message.conversation_id == conversation_id,
        Message.role == message.role,
        Message.is_deleted.is_(False),
        Message.order_key <= message.order_key,
    ).count()
    section = None
    if payload.start_block_index is not None:
        section = db.query(Heading).filter(
            Heading.conversation_id == conversation_id,
            Heading.message_id == message.id,
            Heading.block_index <= payload.start_block_index,
        ).order_by(Heading.block_index.desc()).first()
    metadata.update({
        "message_role": message.role,
        "message_order_key": message.order_key,
        "message_role_number": role_number,
        "section_title": section.text if section else None,
    })
    return metadata


def _validate_notebook_references(
    db: Session, conversation_id: uuid.UUID, blocks: list[NotebookBlock]
) -> None:
    annotation_ids = [block.annotation_id for block in blocks if block.annotation_id]
    if not annotation_ids:
        return
    valid = {
        row[0]
        for row in db.query(ConversationAnnotation.id)
        .filter(
            ConversationAnnotation.id.in_(annotation_ids),
            ConversationAnnotation.conversation_id == conversation_id,
            ConversationAnnotation.is_deleted.is_(False),
        )
        .all()
    }
    if any(annotation_id not in valid for annotation_id in annotation_ids):
        raise AnnotationError("Notebook annotation reference was not found.", HTTPStatus.NOT_FOUND)


def _conversation(db: Session, conversation_id: uuid.UUID) -> Conversation:
    conversation = db.get(Conversation, conversation_id)
    if conversation is None or conversation.deleted_at is not None:
        raise AnnotationError("Conversation not found.", HTTPStatus.NOT_FOUND)
    return conversation


def _annotation(db: Session, annotation_id: uuid.UUID) -> ConversationAnnotation:
    annotation = db.get(ConversationAnnotation, annotation_id)
    if annotation is None or annotation.subject_key != DEFAULT_SUBJECT_KEY:
        raise AnnotationError("Annotation not found.", HTTPStatus.NOT_FOUND)
    return annotation


def _touch_conversation(conversation: Conversation) -> None:
    conversation.offline_revision += 1


def _operation_hash(operation: SyncOperation) -> str:
    raw = json.dumps(operation.model_dump(mode="json"), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _relocate_quote(
    block_texts: list[str], quote: str, prefix: str, suffix: str
) -> tuple[int, int, int, int] | None:
    if not quote or not block_texts:
        return None
    starts: list[int] = []
    parts: list[str] = []
    cursor = 0
    for index, text in enumerate(block_texts):
        starts.append(cursor)
        parts.append(text)
        cursor += len(text)
        if index < len(block_texts) - 1:
            parts.append("\n")
            cursor += 1
    combined = "".join(parts)
    candidates: list[tuple[int, int]] = []
    offset = combined.find(quote)
    while offset >= 0:
        score = 0
        if prefix and combined[:offset].endswith(prefix):
            score += 2
        if suffix and combined[offset + len(quote):].startswith(suffix):
            score += 2
        candidates.append((score, offset))
        offset = combined.find(quote, offset + 1)
    if not candidates:
        return None
    _, start = max(candidates, key=lambda item: (item[0], -item[1]))
    end = start + len(quote)
    start_block = _block_for_offset(starts, block_texts, start)
    end_block = _block_for_offset(starts, block_texts, max(start, end - 1))
    if start_block is None or end_block is None:
        return None
    return (
        start_block,
        start - starts[start_block],
        end_block,
        min(len(block_texts[end_block]), end - starts[end_block]),
    )


def _block_for_offset(starts: list[int], block_texts: list[str], offset: int) -> int | None:
    for index, start in enumerate(starts):
        if start <= offset <= start + len(block_texts[index]):
            return index
    return None


def _sync_result(
    operation: SyncOperation,
    entity_id: uuid.UUID,
    status: str,
    revision: int,
    conflict_copy_id: uuid.UUID | None = None,
) -> SyncOperationResult:
    return SyncOperationResult(
        operation_id=operation.operation_id,
        entity_type=operation.entity_type,
        entity_id=entity_id,
        status=status,
        revision=revision,
        conflict_copy_id=conflict_copy_id,
    )
