"""Source replacement migration and concurrent edit/cleanup on PostgreSQL."""
import time
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models.content_cleanup import ContentCleanupOccurrence, ContentCleanupScanTarget
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.services import content_cleanup as cleanup
from app.services.cleanup_review import preview_changes
from app.services.editing.message_edit_service import edit_message, MessageEditError
from test_cleanup_postgres import isolated_schema, pytestmark, seed  # noqa: F401


@pytest.mark.parametrize("changed", [False, True])
def test_source_hash_migration_only_backfills_provably_unchanged_targets(isolated_schema, changed):
    engine, migrate = isolated_schema; migrate("head")
    scan_id, message_id = seed(engine)
    with Session(engine) as db:
        message = db.get(Message, message_id)
        version_id = message.current_version_id
        source_hash = cleanup.source_fingerprint(db.get(MessageVersion, version_id).display_text)
        target = db.query(ContentCleanupScanTarget).filter_by(scan_id=scan_id).one()
        if changed:
            target.base_conversation_revision -= 1
        db.commit()
    migrate("20261007_0049", "downgrade")
    migrate("head")
    with Session(engine) as db:
        occurrence = db.query(ContentCleanupOccurrence).filter_by(scan_id=scan_id).one()
        assert occurrence.source_content_hash == (None if changed else source_hash)
        cleanup.update_decisions(db, scan_id, {occurrence.id: "DELETE"}); db.commit()
        assert occurrence.decision == ("CONFLICT" if changed else "DELETE")
        assert db.get(Message, message_id).current_version_id == version_id
        assert db.query(MessageVersion).filter_by(message_id=message_id).count() == 1


def test_concurrent_edit_and_cleanup_cannot_overwrite_one_another(isolated_schema, monkeypatch):
    engine, migrate = isolated_schema; migrate("head")
    scan_id, message_id = seed(engine)
    with Session(engine) as db:
        item = db.query(ContentCleanupOccurrence).filter_by(scan_id=scan_id).one()
        cleanup.update_decisions(db, scan_id, {item.id: "DELETE"}); db.commit()
        base_id = db.get(Message, message_id).current_version_id
    reached, release = Event(), Event()
    original = cleanup._create_version
    def held(*args, **kwargs):
        reached.set(); assert release.wait(15)
        return original(*args, **kwargs)
    monkeypatch.setattr(cleanup, "_create_version", held)

    def apply():
        with Session(engine) as db:
            try:
                result = cleanup.apply_scan(db, scan_id); db.commit(); return result
            except MessageEditError:
                db.rollback(); return "conflict"

    replacement = "Synthetic concurrent edit must remain."
    def edit():
        with Session(engine) as db:
            db.execute(text("SET application_name = 'cleanup-source-editor-test'"))
            try:
                edit_message(db, message_id, replacement, base_version_id=base_id)
                db.commit(); return "saved"
            except MessageEditError as error:
                db.rollback(); assert error.status_code == 409; return "conflict"

    with ThreadPoolExecutor(max_workers=2) as pool:
        applying = pool.submit(apply)
        assert reached.wait(15)
        editing = pool.submit(edit)
        try:
            deadline = time.monotonic() + 10
            while not editing.done():
                with engine.connect() as db:
                    waiting = db.execute(text("SELECT count(*) FROM pg_stat_activity WHERE application_name = 'cleanup-source-editor-test' AND cardinality(pg_blocking_pids(pid)) > 0")).scalar()
                if waiting:
                    break
                assert time.monotonic() < deadline, "Editor neither finished nor reached a database lock"
                time.sleep(0.02)
        finally:
            release.set()
        applied, edited = applying.result(timeout=20), editing.result(timeout=20)
    with Session(engine) as db:
        message = db.get(Message, message_id)
        current = db.get(MessageVersion, message.current_version_id)
        assert db.query(MessageVersion).filter_by(message_id=message_id).count() == 2
        if edited == "saved":
            assert applied == "conflict" and current.display_text == replacement
        else:
            assert applied == {"applied": 1, "conflicts": 0}
            assert current.display_text == "Before  after."


def test_cached_same_id_source_cannot_overwrite_whitespace_replacement(isolated_schema):
    engine, migrate = isolated_schema; migrate("head")
    _, message_id = seed(engine)
    source = "Synthetic first line.\n\nSynthetic next line."
    with Session(engine) as db:
        base_id = edit_message(db, message_id, source).current_version.id
        db.commit()
    with Session(engine) as stale:
        cached_message = stale.get(Message, message_id)
        cached_version = stale.get(MessageVersion, base_id)
        expected_hash = cached_message.content_hash
        replacement = "Synthetic first line.  \n\nSynthetic next line."
        with Session(engine) as writer:
            edit_message(writer, message_id, replacement, base_version_id=base_id, save_mode="replace_current")
            writer.commit()
            assert writer.get(Message, message_id).content_hash == expected_hash
        assert cached_version.display_text == source
        with pytest.raises(MessageEditError) as rejected:
            edit_message(stale, message_id, "This stale draft must not win.", base_version_id=base_id)
        assert rejected.value.status_code == 409
        stale.rollback()
    with Session(engine) as db:
        assert db.get(Message, message_id).current_version_id == base_id
        assert db.get(MessageVersion, base_id).display_text == replacement
        assert db.query(MessageVersion).filter_by(message_id=message_id).count() == 2


def test_edit_during_preview_cannot_issue_a_token_for_different_source(isolated_schema, monkeypatch):
    engine, migrate = isolated_schema; migrate("head")
    scan_id, message_id = seed(engine)
    with Session(engine) as db:
        item = db.query(ContentCleanupOccurrence).filter_by(scan_id=scan_id).one()
        cleanup.update_decisions(db, scan_id, {item.id: "DELETE"}); db.commit()
    matcher = cleanup._occurrence_still_matches
    changed = False
    def edit_after_matching(*args, **kwargs):
        nonlocal changed
        result = matcher(*args, **kwargs)
        if not changed:
            changed = True
            with Session(engine) as writer:
                edit_message(writer, message_id, "Synthetic source changed during preview.")
                writer.commit()
        return result
    monkeypatch.setattr(cleanup, "_occurrence_still_matches", edit_after_matching)
    with Session(engine) as db:
        with pytest.raises(ValueError, match="Source changed while preparing"):
            preview_changes(db, scan_id, limit=10, offset=0)
    with Session(engine) as db:
        current = db.get(MessageVersion, db.get(Message, message_id).current_version_id)
        assert current.display_text == "Synthetic source changed during preview."
        assert db.query(MessageVersion).filter_by(message_id=message_id).count() == 2
