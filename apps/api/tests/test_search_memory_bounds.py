"""Synthetic attachment/annotation indexing regressions, not capacity tests."""
import hashlib
import uuid
from contextlib import ExitStack
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import event, inspect

from app.models.annotation import ConversationAnnotation
from app.models.attachment import AssetDerivative, AssetObject, Attachment, MessageVersionAttachment
from app.models.message import Message
from app.models.search_document import SearchDocument
from app.services.assets.asset_store import get_asset_store
from app.services.search import annotation_indexer, search_indexer
from test_export_memory_bounds import retained_entities, seed_export
from test_system_archive_integrity import archive_db  # noqa: F401


def seed_attachment_occurrences(db, conversation_id, *, count=129, metadata_chars=8192):
    message = db.query(Message).filter_by(conversation_id=conversation_id).one()
    for index in range(count):
        asset = AssetObject(sha256=hashlib.sha256(str(index).encode()).hexdigest(),
            byte_size=0, detected_mime_type="text/plain", storage_key=f"synthetic/{index}",
            status="available", scan_status="clean")
        db.add(asset)
        db.flush()
        attachment = Attachment(conversation_id=conversation_id, asset_object_id=asset.id,
            display_name=f"File {index:04}", original_filename=f"source-{index:04}.txt",
            metadata_={"unused_large_metadata": "x" * metadata_chars})
        db.add(attachment)
        db.flush()
        db.add(MessageVersionAttachment(message_version_id=message.current_version_id,
            attachment_id=attachment.id, display_order=index, caption="c" * metadata_chars))
    db.commit()


def test_attachment_index_projects_only_required_fields(archive_db):
    conversation_id, _ = seed_export(archive_db, count=1, versions=1)
    seed_attachment_occurrences(archive_db, conversation_id)
    with ExitStack() as stack:
        measurements = {model.__name__: stack.enter_context(retained_entities(model))
            for model in (Attachment, AssetObject, AssetDerivative, MessageVersionAttachment)}
        result = search_indexer.rebuild_search_documents_for_conversation(archive_db, conversation_id)
    assert all(item["loaded"] == 0 for item in measurements.values()), measurements
    assert result.indexed_count == 131  # conversation + message + 129 occurrences
    rows = archive_db.query(SearchDocument).filter_by(document_type="attachment").order_by(
        SearchDocument.title).all()
    assert len(rows) == 129
    assert rows[0].search_text == "File 0000 source-0000.txt"
    assert rows[-1].search_text == "File 0128 source-0128.txt"
    assert all("unused_large_metadata" not in row.metadata_ for row in rows)


def test_attachment_index_uses_newest_ready_extract_and_bounded_file_read(archive_db):
    conversation_id, _ = seed_export(archive_db, count=1, versions=1)
    seed_attachment_occurrences(archive_db, conversation_id, count=1)
    source = archive_db.query(Attachment).one().asset_object_id
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    for index, (name, status) in enumerate((("old", "ready"), ("new", "ready"), ("pending", "pending"))):
        body = (name + " extract\n").encode() + b"x" * (300 * 1024)
        asset = AssetObject(sha256=hashlib.sha256(body).hexdigest(), byte_size=len(body),
            detected_mime_type="text/plain", storage_key=f"extracts/{name}", status="available",
            scan_status="clean")
        path = get_asset_store().resolve_key(asset.storage_key, must_exist=False)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body)
        archive_db.add(asset)
        archive_db.flush()
        archive_db.add(AssetDerivative(source_asset_object_id=source, derivative_asset_object_id=asset.id,
            derivative_type="text_extract", generator="synthetic", generator_version=str(index),
            status=status, created_at=start + timedelta(days=index)))
    archive_db.commit()

    search_indexer.rebuild_search_documents_for_conversation(archive_db, conversation_id)
    row = archive_db.query(SearchDocument).filter_by(document_type="attachment").one()
    assert row.plain_text.startswith("new extract\n")
    assert len(row.plain_text.encode()) == 256 * 1024
    assert row.metadata_["derivative_type"] == "text_extract"


@pytest.mark.parametrize("missing", [False, True])
def test_unavailable_attachment_extract_keeps_filename_search(archive_db, missing):
    conversation_id, _ = seed_export(archive_db, count=1, versions=1)
    seed_attachment_occurrences(archive_db, conversation_id, count=1)
    source = archive_db.query(Attachment).one().asset_object_id
    extract = AssetObject(sha256="d" * 64, byte_size=1, detected_mime_type="text/plain",
        storage_key="synthetic/missing-extract", status="available" if missing else "deleted",
        scan_status="clean")
    archive_db.add(extract)
    archive_db.flush()
    archive_db.add(AssetDerivative(source_asset_object_id=source, derivative_asset_object_id=extract.id,
        derivative_type="text_extract", generator="synthetic", generator_version="missing", status="ready"))
    archive_db.commit()
    search_indexer.rebuild_search_documents_for_conversation(archive_db, conversation_id)
    row = archive_db.query(SearchDocument).filter_by(document_type="attachment").one()
    assert row.search_text == "File 0000 source-0000.txt"
    assert row.plain_text == "File 0000"
    assert row.metadata_["derivative_type"] is None


def test_attachment_projection_uses_one_select_not_per_occurrence_queries(archive_db):
    conversation_id, _ = seed_export(archive_db, count=1, versions=1)
    seed_attachment_occurrences(archive_db, conversation_id)
    queries = []
    def capture(_connection, _cursor, statement, *_):
        queries.append(statement)
    event.listen(archive_db.get_bind(), "before_cursor_execute", capture)
    try:
        rows = list(search_indexer._attachment_rows(archive_db, conversation_id))
    finally:
        event.remove(archive_db.get_bind(), "before_cursor_execute", capture)
    assert len(rows) == 129
    assert len(queries) == 1
    assert "attachments.metadata" not in queries[0]
    assert "message_version_attachments.caption" not in queries[0]


def seed_annotations(db, conversation_id, *, count=33, text_chars=8192):
    for index in range(count):
        db.add(ConversationAnnotation(conversation_id=conversation_id, annotation_type="comment",
            quote=f"quote-{index} " + "q" * text_chars, comment_markdown="a" * text_chars))
    db.commit()


@pytest.mark.parametrize("backfill", [False, True])
def test_annotation_index_body_read_window_is_bounded(archive_db, backfill):
    conversation_id, _ = seed_export(archive_db, count=0)
    seed_annotations(archive_db, conversation_id)
    with retained_entities(ConversationAnnotation) as annotations:
        result = (annotation_indexer.backfill_annotation_documents(archive_db) if backfill else
            annotation_indexer.sync_annotations_for_conversation(archive_db, conversation_id))
    assert result.created == result.scanned == 33
    assert annotations["loaded"] == 33
    assert annotations["peak"] <= 16, annotations
    assert archive_db.query(SearchDocument).filter_by(document_type="annotation").count() == 33


@pytest.mark.parametrize("backfill", [False, True])
def test_stale_annotation_pruning_never_loads_search_bodies(archive_db, backfill):
    conversation_id, _ = seed_export(archive_db, count=0)
    other_id, _ = seed_export(archive_db, count=0)
    ids = []
    for index in range(417):
        document_id = uuid.uuid4()
        ids.append(document_id)
        archive_db.add(SearchDocument(id=document_id, conversation_id=conversation_id,
            document_type="annotation", plain_text="q" * 8192, search_text="a" * 8192,
            metadata_={"quote": "q" * 8192}))
    kept = SearchDocument(conversation_id=conversation_id, document_type="message",
        plain_text="keep this document", search_text="keep", metadata_={})
    foreign = SearchDocument(conversation_id=other_id, document_type="message",
        plain_text="other conversation", search_text="keep", metadata_={})
    archive_db.add_all([kept, foreign])
    archive_db.commit()
    # Existing caller-held identity must be invalidated, not left as a live row.
    held = archive_db.get(SearchDocument, ids[0])
    with retained_entities(SearchDocument) as bodies:
        result = (annotation_indexer.backfill_annotation_documents(archive_db) if backfill else
            annotation_indexer.sync_annotations_for_conversation(archive_db, conversation_id))
    assert result.deleted == 417
    assert bodies["loaded"] == 0, bodies
    assert inspect(held).deleted
    assert archive_db.query(SearchDocument).count() == 2
    archive_db.rollback()
    assert archive_db.query(SearchDocument).count() == 419
