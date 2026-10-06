"""Concurrent commits must not change an already preparing direct download."""
import gzip
import hashlib
import json
import os

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.api.routes.exports import direct_export_response
from app.models.annotation import ConversationNotebook
from app.models.conversation import Conversation
from app.models.conversation_event import ConversationEvent
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.user import User
from app.schemas.export import ExportOptions
from app.services.exporting import export_service
from test_import_profile_postgres import isolated_schema  # noqa: F401

pytestmark = pytest.mark.skipif(
    os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1",
    reason="requires disposable PostgreSQL",
)


def add_message(db, conversation_id, index, body):
    message = Message(conversation_id=conversation_id, role="user", order_key=f"{index:06}")
    db.add(message)
    db.flush()
    version = MessageVersion(message_id=message.id, version_number=1, plain_text=body,
                             display_text=body, edit_type="manual", content_hash=hashlib.sha256(body.encode()).hexdigest())
    db.add(version)
    db.flush()
    message.current_version_id = version.id
    return message


@pytest.mark.parametrize("format,compression", [
    ("markdown_v2", "none"), ("canjson_v2", "none"),
    ("canjson_v2", "gzip"), ("canonical_json", "none"),
])
def test_concurrent_edit_delete_insert_and_notes_keep_one_snapshot(isolated_schema, monkeypatch, format, compression):
    engine, migrate = isolated_schema
    migrate("head")
    with Session(engine) as db:
        owner = User(normalized_email="snapshot@example.test")
        db.add(owner)
        db.flush()
        conversation = Conversation(owner_user_id=owner.id, title="Before title", display_title="Before title",
                                    source_type="manual", source_profile="test", parser_version="test", message_count=105)
        db.add(conversation)
        db.flush()
        messages = [add_message(db, conversation.id, index, f"BEFORE-{index:03}: " + "synthetic " * 1400) for index in range(105)]
        notebook = ConversationNotebook(conversation_id=conversation.id, subject_key=str(owner.id),
                                        title="Before notebook", blocks=[{"type": "markdown", "markdown": "BEFORE-NOTES"}])
        db.add(notebook)
        db.commit()
        conversation_id, edited_id, deleted_id, notebook_id = conversation.id, messages[-1].id, messages[-2].id, notebook.id
        reordered_id = messages[0].id

    changed = False
    iterator_name = "_iter_message_payloads" if format == "canonical_json" else "_current_message_batches"
    original = getattr(export_service, iterator_name)

    def with_concurrent_commit(*args, **kwargs):
        nonlocal changed
        for batch in original(*args, **kwargs):
            yield batch
            if changed:
                continue
            changed = True
            with Session(engine) as editor:
                edited = editor.get(Message, edited_id)
                replacement = MessageVersion(message_id=edited.id, version_number=2, plain_text="AFTER-EDIT",
                    display_text="AFTER-EDIT", edit_type="manual", content_hash=hashlib.sha256(b"AFTER-EDIT").hexdigest())
                editor.add(replacement)
                editor.flush()
                edited.current_version_id = replacement.id
                editor.get(Message, deleted_id).is_deleted = True
                editor.get(Message, reordered_id).order_key = "000200"
                add_message(editor, conversation_id, 106, "AFTER-INSERT")
                editor.get(Conversation, conversation_id).display_title = "AFTER-TITLE"
                editor.get(ConversationNotebook, notebook_id).blocks = [{"type": "markdown", "markdown": "AFTER-NOTES"}]
                editor.commit()

    monkeypatch.setattr(export_service, iterator_name, with_concurrent_commit)
    options = ExportOptions(format=format, message_ids=[], include_notebook=True, compression=compression)
    reader_engine = create_engine(engine.url, pool_size=1, max_overflow=0, pool_timeout=0.5)
    try:
        with Session(reader_engine) as db:
            # One pool slot must suffice even after the route's ownership lookup.
            db.get(Conversation, conversation_id)
            response = direct_export_response(db, conversation_id, options)
            assert changed
            assert reader_engine.pool.checkedout() == 0, "Slow download retains a database snapshot"
            chunks = list(response.content)
            assert chunks and max(map(len, chunks)) <= 64 * 1024
            assert response.content.stream.closed
    finally:
        reader_engine.dispose()
    body = b"".join(chunks)
    assert int(response.headers["content-length"]) == len(body)
    if compression == "gzip":
        body = gzip.decompress(body)
    assert b"Before title" in body and b"BEFORE-NOTES" in body
    assert b"AFTER-" not in body
    for index in range(105):
        assert f"BEFORE-{index:03}:".encode() in body
    if format == "canjson_v2":
        records = [json.loads(line) for line in body.splitlines()]
        assert records[0]["selection"]["message_count"] == records[-1]["message_count"] == 105
        assert sum(row["record_type"] == "message" for row in records) == 105
    if format == "canonical_json":
        result = json.loads(body)
        assert result["conversation"]["message_count"] == len(result["messages"]) == 105
    with Session(engine) as db:
        assert db.get(Conversation, conversation_id).display_title == "AFTER-TITLE"
        assert db.get(Message, deleted_id).is_deleted
        assert db.get(Message, reordered_id).order_key == "000200"
        assert db.get(ConversationNotebook, notebook_id).blocks[0]["markdown"] == "AFTER-NOTES"
        event = db.scalar(select(ConversationEvent).where(ConversationEvent.conversation_id == conversation_id))
        assert event.payload["message_count"] == 105
