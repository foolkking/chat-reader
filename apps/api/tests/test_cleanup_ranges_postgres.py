"""Explicitly opted-in disposable PostgreSQL: range bases and safe downgrade."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

from sqlalchemy import inspect
from sqlalchemy.orm import Session

from app.models.content_cleanup import ContentCleanupOccurrence
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.services.cleanup_ranges import range_edit_token, save_ranges
from test_cleanup_postgres import isolated_schema, pytestmark, seed  # noqa: F401


def test_concurrent_range_saves_reject_the_stale_base(isolated_schema):
    engine, migrate = isolated_schema
    migrate("head")
    scan_id, message_id = seed(engine)
    with Session(engine) as db:
        item = db.query(ContentCleanupOccurrence).filter_by(scan_id=scan_id).one()
        item_id, token = item.id, range_edit_token(item)
        start, end = item.start_offset, item.end_offset
        version_id = db.get(Message, message_id).current_version_id
    barrier = Barrier(2)

    def save(left):
        with Session(engine) as db:
            # Load stale ORM state before competing for the scan lock.
            db.get(ContentCleanupOccurrence, item_id)
            barrier.wait(timeout=10)
            ranges = [{"start_offset": left, "end_offset": end - 1}]
            try:
                save_ranges(db, scan_id, item_id, base_edit_token=token, ranges=ranges)
                db.commit()
                return "saved"
            except ValueError:
                db.rollback()
                return "conflict"

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(save, [start, start + 1])) == ["conflict", "saved"]
    with Session(engine) as db:
        assert db.get(Message, message_id).current_version_id == version_id
        assert db.query(MessageVersion).filter_by(message_id=message_id).count() == 1


def test_downgrade_revokes_narrowed_consent_without_changing_canonical_source(isolated_schema):
    engine, migrate = isolated_schema
    migrate("head")
    scan_id, message_id = seed(engine)
    with Session(engine) as db:
        item = db.query(ContentCleanupOccurrence).filter_by(scan_id=scan_id).one()
        save_ranges(db, scan_id, item.id, base_edit_token=range_edit_token(item), ranges=[
            {"start_offset": item.start_offset + 1, "end_offset": item.end_offset - 1},
        ])
        version_id = db.get(Message, message_id).current_version_id
        original = db.get(MessageVersion, version_id).display_text
        db.commit()
    migrate("20261008_0050", "downgrade")
    assert "reviewed_ranges" not in {column["name"] for column in inspect(engine).get_columns("content_cleanup_occurrences")}
    migrate("head")
    with Session(engine) as db:
        item = db.query(ContentCleanupOccurrence).filter_by(scan_id=scan_id).one()
        assert item.decision == "KEEP" and item.reviewed_ranges is None and item.decision_updated_at is None
        assert db.get(Message, message_id).current_version_id == version_id
        assert db.get(MessageVersion, version_id).display_text == original
