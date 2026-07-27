import uuid

from fastapi.testclient import TestClient

from app.core.database import get_db
from app.main import app
from app.models.annotation import ConversationAnnotation
from app.models.conversation import Conversation
from app.models.import_record import utc_now
from app.models.search_document import SearchDocument
from app.services.search.annotation_indexer import annotation_document_id, backfill_annotation_documents
from test_import_preview_api import client  # noqa: F401
from test_offline_annotations_api import _message_context


def test_annotation_search_create_update_delete_and_conversation_scope(client: TestClient) -> None:
    first_id, message, version = _message_context(client)
    second_id, _, _ = _message_context(client)
    created = client.post(
        f"/api/conversations/{first_id}/annotations",
        json={
            "message_id": message["id"],
            "message_version_id": version["id"],
            "annotation_type": "comment",
            "color": "green",
            "quote": "hello",
            "comment_markdown": "unique annotation needle",
            "start_block_index": 0,
            "start_offset": 0,
            "end_block_index": 0,
            "end_offset": 5,
        },
    )
    assert created.status_code == 201
    annotation = created.json()

    result = client.get("/api/search", params={"q": "annotation needle", "document_type": "annotation"})
    assert result.status_code == 200
    item = result.json()["items"][0]
    assert item["annotation_id"] == annotation["id"]
    assert item["block_index"] == 0
    assert item["character_offset"] == 0
    assert item["annotation_type"] == "comment"
    assert item["annotation_color"] == "green"

    current_scope = client.get("/api/search", params={"q": "annotation needle", "conversation_id": first_id})
    other_scope = client.get("/api/search", params={"q": "annotation needle", "conversation_id": second_id})
    assert current_scope.json()["total"] == 1
    assert other_scope.json()["total"] == 0

    updated = client.patch(
        f"/api/annotations/{annotation['id']}",
        json={"base_revision": annotation["revision"], "comment_markdown": "updated annotation phrase", "color": "pink"},
    )
    assert updated.status_code == 200
    assert client.get("/api/search", params={"q": "updated annotation phrase"}).json()["total"] == 1
    assert client.get("/api/search", params={"q": "unique annotation needle"}).json()["total"] == 0

    deleted = client.delete(f"/api/annotations/{annotation['id']}", params={"base_revision": updated.json()["revision"]})
    assert deleted.status_code == 204
    assert client.get("/api/search", params={"q": "updated annotation phrase"}).json()["total"] == 0


def test_annotation_backfill_is_idempotent_and_preserves_other_documents(client: TestClient) -> None:
    conversation_id, message, version = _message_context(client)
    db = next(app.dependency_overrides[get_db]())
    try:
        annotation = ConversationAnnotation(
            id=uuid.uuid4(),
            conversation_id=uuid.UUID(conversation_id),
            message_id=uuid.UUID(message["id"]),
            message_version_id=uuid.UUID(version["id"]),
            annotation_type="highlight",
            color="yellow",
            quote="backfill quote",
            comment_markdown="backfill annotation text",
        )
        db.add(annotation)
        db.commit()
        non_annotation_ids = {row[0] for row in db.query(SearchDocument.id).filter(SearchDocument.document_type != "annotation").all()}

        first = backfill_annotation_documents(db)
        db.commit()
        second = backfill_annotation_documents(db)
        db.commit()
        assert first.created == 1
        assert first.errors == 0
        assert second.created == 0
        assert second.skipped >= 1
        assert {row[0] for row in db.query(SearchDocument.id).filter(SearchDocument.document_type != "annotation").all()} == non_annotation_ids

        conversation = db.get(Conversation, uuid.UUID(conversation_id))
        conversation.deleted_at = utc_now()
        db.commit()
        cleanup = backfill_annotation_documents(db)
        db.commit()
        assert cleanup.deleted == 1
        assert db.get(SearchDocument, annotation_document_id(annotation.id)) is None
    finally:
        db.close()


def test_annotation_backfill_handles_empty_database(client: TestClient) -> None:
    db = next(app.dependency_overrides[get_db]())
    try:
        result = backfill_annotation_documents(db)
        assert result.errors == 0
        assert result.scanned == 0
    finally:
        db.close()


def test_annotation_backfill_counts_one_row_failure_and_continues(client: TestClient) -> None:
    conversation_id, message, version = _message_context(client)
    db = next(app.dependency_overrides[get_db]())
    try:
        annotation = ConversationAnnotation(
            id=uuid.uuid4(), conversation_id=uuid.UUID(conversation_id), message_id=uuid.UUID(message["id"]),
            message_version_id=uuid.UUID(version["id"]), annotation_type="comment", comment_markdown="collision sample",
        )
        db.add(annotation)
        db.flush()
        db.add(SearchDocument(
            id=annotation_document_id(annotation.id), conversation_id=uuid.UUID(conversation_id), document_type="message",
            plain_text="unrelated", search_text="unrelated", metadata_={},
        ))
        db.commit()
        result = backfill_annotation_documents(db)
        assert result.scanned == 1
        assert result.errors == 1
        assert db.get(SearchDocument, annotation_document_id(annotation.id)).document_type == "message"
    finally:
        db.rollback()
        db.close()
