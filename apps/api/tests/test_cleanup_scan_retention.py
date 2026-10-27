"""A scan page holds IDs, not a page of full ORM source bodies."""
import gc
import uuid
import weakref

import pytest
from sqlalchemy import event, update

from app.models.content_cleanup import ContentCleanupOccurrence
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.services import content_cleanup as cleanup
from test_import_preview_api import client  # noqa: F401
from test_cleanup_safety import MARKER, create_review, session


@pytest.mark.parametrize("chunk_size", [1, 20])
def test_completed_source_rows_are_released_before_next_message(client, chunk_size):
    conversation_ids = []
    for index in range(10):
        response = client.post("/api/conversations", json={
            "title": "Synthetic bounded scan",
            "messages": [
                {"role": "user", "content_markdown": f"Question {index} " + "body " * 2000},
                {"role": "assistant", "content_markdown": f"Retained {index} " + "body " * 2000 + MARKER},
            ],
        })
        assert response.status_code == 201, response.text[:500]
        conversation_ids.append(response.json()["conversation"]["id"])
    started = client.post("/api/content-cleanup/scans", json={
        "source": "BATCH", "scope_type": "SELECTED_CONVERSATIONS",
        "conversation_ids": conversation_ids,
    })
    assert started.status_code == 202, started.text
    scan_id = uuid.UUID(started.json()["id"])
    source_refs = []
    live_counts = []

    def loaded(_db, instance):
        if isinstance(instance, MessageVersion):
            source_refs.append(weakref.ref(instance))
            gc.collect()
            live_counts.append(sum(ref() is not None for ref in source_refs))

    with session() as db:
        event.listen(db, "loaded_as_persistent", loaded)
        try:
            while not cleanup.process_scan_chunk(db, scan_id, chunk_size=chunk_size)["done"]:
                db.commit()
            db.commit()
        finally:
            event.remove(db, "loaded_as_persistent", loaded)
        assert db.query(ContentCleanupOccurrence).filter_by(scan_id=scan_id).count() == 10

    assert len(source_refs) == 20
    assert max(live_counts) == 1, "A prior full source was retained while loading the next."
    gc.collect()
    assert all(ref() is None for ref in source_refs)


def test_message_moved_out_of_scope_after_id_page_is_not_scanned(client):
    conversations = []
    for label in ("target", "outside"):
        response = client.post("/api/conversations", json={
            "title": f"Synthetic {label}",
            "messages": [
                {"role": "user", "content_markdown": "Retained question."},
                {"role": "assistant", "content_markdown": "Retained " + MARKER},
            ],
        })
        assert response.status_code == 201, response.text[:500]
        conversations.append(response.json())
    target, outside = conversations
    moved_message_id = uuid.UUID(target["messages"][1]["id"])
    started = client.post("/api/content-cleanup/scans", json={
        "source": "BATCH", "scope_type": "SELECTED_CONVERSATIONS",
        "conversation_ids": [target["conversation"]["id"]],
    })
    assert started.status_code == 202, started.text
    scan_id = uuid.UUID(started.json()["id"])
    moved = False

    def move_before_full_source_read(state):
        nonlocal moved
        if (state.is_select and not moved and any(
            item["entity"] is MessageVersion for item in state.statement.column_descriptions
        )):
            moved = True
            state.session.execute(update(Message).where(Message.id == moved_message_id).values(
                conversation_id=uuid.UUID(outside["conversation"]["id"]),
                order_key="synthetic-moved",
            ))

    with session() as db:
        event.listen(db, "do_orm_execute", move_before_full_source_read)
        try:
            result = cleanup.process_scan_chunk(db, scan_id)
            db.commit()
        finally:
            event.remove(db, "do_orm_execute", move_before_full_source_read)
        assert moved and result["processed"] == 2
        assert db.query(ContentCleanupOccurrence).filter_by(scan_id=scan_id).count() == 0
        assert cleanup.process_scan_chunk(db, scan_id)["done"]


def test_many_candidate_positions_match_legacy_offsets_across_crlf(client):
    source = ("Retained prefix\r\n" + MARKER + "\r\n") * 120 + "Tail " + MARKER
    scan_id, _ = create_review(client, [source])
    with session() as db:
        rows = db.query(ContentCleanupOccurrence).filter_by(scan_id=scan_id).order_by(
            ContentCleanupOccurrence.start_offset,
        ).all()
        assert len(rows) >= 100
        for row in rows:
            assert row.line_start == source.count("\n", 0, row.start_offset) + 1
            assert row.column_start == row.start_offset - source.rfind("\n", 0, row.start_offset)
            assert row.line_end == source.count("\n", 0, row.end_offset) + 1
            assert row.column_end == row.end_offset - source.rfind("\n", 0, row.end_offset)


def test_many_candidate_positions_on_one_line_keep_legacy_offsets(client):
    source = ("Retained " + MARKER + " ") * 120 + "tail"
    scan_id, _ = create_review(client, [source])
    with session() as db:
        rows = db.query(ContentCleanupOccurrence).filter_by(scan_id=scan_id).order_by(
            ContentCleanupOccurrence.start_offset,
        ).all()
        assert len(rows) >= 100
        for row in rows:
            assert row.line_start == 1
            assert row.column_start == row.start_offset + 1
            assert row.line_end == 1
            assert row.column_end == row.end_offset + 1
