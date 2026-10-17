"""NFKC provenance, protection and canonical publication on disposable PostgreSQL."""
import os

import pytest
from sqlalchemy.orm import Session

from app.models.content_cleanup import ContentCleanupOccurrence
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.user import User
from app.services import content_cleanup as cleanup
from app.services.cleanup_ranges import range_edit_token, save_ranges
from app.services.cleanup_review import preview_changes
from app.services.editing.message_edit_service import create_manual_conversation
from app.services.ownership import OwnershipScope
from test_import_profile_postgres import isolated_schema  # noqa: F401

pytestmark = pytest.mark.skipif(
    os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1",
    reason="requires explicitly selected disposable PostgreSQL",
)


@pytest.mark.parametrize("raw,literal", [
    ("NOISE cafe\u0301", "NOISE caf\u00e9"),
    ("NOISE a\u0315\u0300", "NOISE \u00e0\u0315"),
    ("NOISE \u1100\u1161\u11a8", "NOISE \uac01"),
], ids=["accent", "mark-order", "hangul"])
def test_normalized_ranges_publish_only_the_explicit_raw_refinements(isolated_schema, raw, literal):
    engine, migrate = isolated_schema
    migrate("head")
    prefix = "🙂 Retain\r\n"
    source = prefix + raw + "\r\nAfter. Code `" + raw + "` kept."
    with Session(engine) as db:
        owner = User(normalized_email="unicode-cleanup@example.test")
        db.add(owner)
        db.flush()
        scope = OwnershipScope(owner.id)
        cleanup.create_literal_rule(db, name="Synthetic Unicode", match_value=literal,
            matcher_mode="NORMALIZED", ownership_scope=scope)
        created = create_manual_conversation(db, title="Synthetic Unicode", user_text="Synthetic question",
            assistant_text=source, ownership_scope=scope)
        message_id, conversation_id = created.messages[1].id, created.conversation.id
        scan, _ = cleanup.create_scan(db, source="BATCH", scope_type="CURRENT_CONVERSATION",
            conversation_ids=[conversation_id], ownership_scope=scope)
        db.commit()
        while not cleanup.process_scan_chunk(db, scan.id)["done"]:
            db.commit()
        db.commit()
        rows = db.query(ContentCleanupOccurrence).filter_by(scan_id=scan.id).order_by(
            ContentCleanupOccurrence.start_offset).all()
        assert [item.decision for item in rows] == ["KEEP", "PROTECTED"]
        item = rows[0]
        assert (item.start_offset, item.end_offset) == (len(prefix), len(prefix) + len(raw))
        message = db.get(Message, message_id)
        original_version = message.current_version_id
        revision = db.get(Conversation, conversation_id).offline_revision
        ranges = [
            {"start_offset": item.start_offset, "end_offset": item.start_offset + 1},
            {"start_offset": item.end_offset - 1, "end_offset": item.end_offset},
        ]
        save_ranges(db, scan.id, item.id, base_edit_token=range_edit_token(item), ranges=ranges)
        db.commit()
        proposed = preview_changes(db, scan.id, limit=10, offset=0)["items"][0]
        assert not proposed["conflict"] and proposed["before"] == source
        assert proposed["removed_ranges"] == ranges
        expected = source
        for span in reversed(ranges):
            expected = expected[:span["start_offset"]] + expected[span["end_offset"]:]
        assert proposed["after"] == expected and f"Code `{raw}` kept." in expected
        assert db.get(Message, message_id).current_version_id == original_version
        assert cleanup.apply_scan(db, scan.id) == {"applied": 1, "conflicts": 0}
        db.commit()
        db.expire_all()
        message = db.get(Message, message_id)
        assert message.current_version_id != original_version
        assert db.get(MessageVersion, message.current_version_id).display_text == expected
        assert db.get(MessageVersion, original_version).display_text == source
        assert db.query(MessageVersion).filter_by(message_id=message_id).count() == 2
        assert db.get(Conversation, conversation_id).offline_revision > revision
