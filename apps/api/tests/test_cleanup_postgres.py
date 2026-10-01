"""Cleanup leases, FK persistence and migration with actual PostgreSQL."""
import os
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from sqlalchemy.orm import Session

from app.models.content_cleanup import ContentCleanupOccurrence
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.user import User
from app.services.content_cleanup import apply_scan, create_scan, process_scan_chunk, update_decisions
from app.services.editing.message_edit_service import create_manual_conversation
from app.services.ownership import OwnershipScope
from test_import_profile_postgres import isolated_schema  # noqa: F401

pytestmark = pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1", reason="requires explicitly selected disposable PostgreSQL")


def seed(engine):
    with Session(engine) as db:
        user = User(normalized_email="cleanup-postgres@example.test")
        db.add(user)
        db.flush()
        scope = OwnershipScope(user.id)
        result = create_manual_conversation(db, title="Synthetic cleanup", user_text="Synthetic question",
            assistant_text="Before \ue200cite\ue202turn12search4\ue201 after.", ownership_scope=scope)
        scan, _ = create_scan(db, source="BATCH", scope_type="CURRENT_CONVERSATION", conversation_ids=[result.conversation.id], ownership_scope=scope)
        db.commit()
        while not process_scan_chunk(db, scan.id)["done"]:
            db.commit()
        db.commit()
        return scan.id, result.messages[1].id


def test_concurrent_apply_creates_one_version(isolated_schema):
    engine, migrate = isolated_schema
    migrate("head")
    scan_id, message_id = seed(engine)
    with Session(engine) as db:
        occurrence = db.query(ContentCleanupOccurrence).filter_by(scan_id=scan_id).one()
        update_decisions(db, scan_id, {occurrence.id: "DELETE"})
        db.commit()
    barrier = Barrier(2)

    def apply():
        with Session(engine) as db:
            barrier.wait(timeout=10)
            try:
                result = apply_scan(db, scan_id)
                db.commit()
                return result["applied"]
            except ValueError:
                db.rollback()
                return 0

    with ThreadPoolExecutor(max_workers=2) as executor:
        assert sorted(executor.map(lambda _: apply(), range(2))) == [0, 1]
    with Session(engine) as db:
        message = db.get(Message, message_id)
        assert db.query(MessageVersion).filter_by(message_id=message_id).count() == 2
        assert db.get(MessageVersion, message.current_version_id).display_text == "Before  after."


def test_migration_resets_legacy_automatic_selection_without_changing_content(isolated_schema):
    engine, migrate = isolated_schema
    migrate("head")
    scan_id, message_id = seed(engine)
    with Session(engine) as db:
        occurrence = db.query(ContentCleanupOccurrence).filter_by(scan_id=scan_id).one()
        occurrence.decision = "DELETE"
        before_id = db.get(Message, message_id).current_version_id
        db.commit()
    migrate("20260930_0035", "downgrade")
    migrate("head")
    with Session(engine) as db:
        occurrence = db.query(ContentCleanupOccurrence).filter_by(scan_id=scan_id).one()
        assert occurrence.decision == "KEEP"
        assert occurrence.decision_updated_at is None
        assert db.get(Message, message_id).current_version_id == before_id


def test_exception_migration_foreign_keys_and_concurrent_confirmation(isolated_schema):
    from app.models.content_cleanup import ContentCleanupException
    from app.services.cleanup_learning import preview_exception, save_exception
    engine, migrate = isolated_schema
    migrate("head")
    scan_id, message_id = seed(engine)
    with Session(engine) as db:
        occurrence = db.query(ContentCleanupOccurrence).filter_by(scan_id=scan_id).one()
        occurrence_id = occurrence.id
        scope = OwnershipScope(db.query(User.id).filter_by(normalized_email="cleanup-postgres@example.test").scalar())
        token = preview_exception(db, scope, scan_id, occurrence.id)["preview_token"]
    barrier = Barrier(2)

    def save():
        with Session(engine) as db:
            barrier.wait(timeout=10)
            item = save_exception(db, scope, scan_id, occurrence_id, token)
            db.commit()
            return item.id

    with ThreadPoolExecutor(max_workers=2) as executor:
        ids = list(executor.map(lambda _: save(), range(2)))
    assert ids[0] == ids[1]
    with Session(engine) as db:
        assert db.query(ContentCleanupException).count() == 1
        assert db.query(MessageVersion).filter_by(message_id=message_id).count() == 1
        # A real FK cascade removes only this account's private exception.
        db.query(User).filter_by(id=scope.owner_user_id).delete(synchronize_session=False)
        db.commit()
        assert db.query(ContentCleanupException).count() == 0


def test_concurrent_rule_edits_keep_one_new_revision_and_reject_stale_base(isolated_schema):
    from types import SimpleNamespace
    from fastapi import HTTPException, Request
    from app.api.routes.content_cleanup import update_rule
    from app.models.content_cleanup import ContentCleanupRuleRevision
    from app.schemas.content_cleanup import CleanupRuleUpdate
    from app.services.content_cleanup import create_literal_rule
    engine, migrate = isolated_schema
    migrate("head")
    seed(engine)
    with Session(engine) as db:
        user_id = db.query(User.id).filter_by(normalized_email="cleanup-postgres@example.test").scalar()
        rule = create_literal_rule(db, name="Synthetic version race", match_value="ORIGINAL", ownership_scope=OwnershipScope(user_id))
        db.commit()
        rule_id = rule.id
    barrier = Barrier(2)

    def edit(value):
        request = Request({"type": "http", "state": {"auth": SimpleNamespace(user_id=user_id, principal_id="synthetic-user")}})
        with Session(engine) as db:
            barrier.wait(timeout=10)
            try:
                update_rule(rule_id, CleanupRuleUpdate(match_value=value, base_revision=1), request, db)
                return 200
            except HTTPException as exc:
                db.rollback()
                return exc.status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        assert sorted(executor.map(edit, ["FIRST", "SECOND"])) == [200, 409]
    with Session(engine) as db:
        revisions = db.query(ContentCleanupRuleRevision).filter_by(rule_id=rule_id).order_by(ContentCleanupRuleRevision.revision).all()
        assert len(revisions) == 2
        assert revisions[0].match_value == "ORIGINAL"
        assert revisions[1].match_value in {"FIRST", "SECOND"}
