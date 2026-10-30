"""Synthetic-only CI characterization; query counts contain no user data."""
import json
import time

import pytest
from sqlalchemy import event

from app.services.offline_packages import build_catalog, estimate_catalog_bytes, estimate_conversation_bytes
from test_attachment_bundle import bundle_state, state  # noqa: F401
from test_attachment_storage_integrity import _conversation, _database
from test_import_preview_api import client  # noqa: F401


@pytest.mark.parametrize("size", [47, 470])
def test_offline_catalog_characterization(client, size):
    db, generator = _database()
    statements = []
    def count_statement(*_):
        statements.append(1)
    engine = db.get_bind()
    try:
        db.add_all([_conversation() for _ in range(size)])
        db.commit()
        db.expunge_all()
        event.listen(engine, "before_cursor_execute", count_statement)
        started = time.perf_counter()
        catalog = build_catalog(db)
        elapsed = time.perf_counter() - started
        assert len(catalog.conversations) == size
        assert len(statements) <= 8, "catalog SQL must not grow once per conversation"
        print(json.dumps({"fixture": "synthetic-offline-catalog-v1", "conversations": size,
                          "sql_count": len(statements), "elapsed_ms": round(elapsed * 1000, 2)}))
    finally:
        event.remove(engine, "before_cursor_execute", count_statement)
        db.close()
        generator.close()


def test_equal_sized_distinct_assets_are_counted_once_each(bundle_state):
    from app.models.attachment import AssetObject, Attachment, MessageVersionAttachment
    from app.models.conversation import Conversation
    from app.models.message import Message
    info = bundle_state
    with info["factory"]() as db:
        conversation = db.get(Conversation, info["sources"][0])
        initial = estimate_catalog_bytes(db, [conversation])[conversation.id]
        second = Attachment(conversation_id=conversation.id, asset_object_id=info["assets"][1],
            original_filename="Second same-sized asset", display_name="Second same-sized asset", scan_status="clean")
        db.add(second)
        db.flush()
        message = db.get(Message, info["messages"][0])
        db.add_all([
            MessageVersionAttachment(message_version_id=message.current_version_id, attachment_id=second.id),
            MessageVersionAttachment(message_version_id=message.current_version_id, attachment_id=second.id),
        ])
        db.commit()
        size = db.get(AssetObject, info["assets"][1]).byte_size
        grouped = estimate_catalog_bytes(db, [conversation])[conversation.id]
        assert grouped - initial == size
        assert estimate_conversation_bytes(db, conversation) == grouped
