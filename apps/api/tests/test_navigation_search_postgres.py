"""Real migration, stale-writer and bounded grouped-search contracts."""
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from threading import Barrier, Event, Lock
from time import monotonic

import pytest
import sqlalchemy as sa
from fastapi import HTTPException
from sqlalchemy.orm import Session
from starlette.requests import Request

from app.api.routes import conversation_order as conversation_order_route
from app.api.routes.conversation_order import OrderChange, change_order, read_order
from app.models.conversation import Conversation
from app.models.search_document import SearchDocument
from app.models.user import User
from app.models.user_preference import UserPreference
from app.services.ownership import LEGACY_OWNER_USER_ID
from app.services.search.search_service import search
from test_import_profile_postgres import isolated_schema  # noqa: F401

pytestmark = pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1",
    reason="requires explicitly selected disposable PostgreSQL")


def test_upgrade_preserves_preferences_and_distinguishes_unused_manual_positions(isolated_schema):
    engine, migrate = isolated_schema
    migrate("20261112_0061")
    with Session(engine) as db:
        user = User(normalized_email=f"sort-{uuid.uuid4()}@example.test")
        db.add(user)
        db.commit()
        user_id = user.id
    table = sa.Table("user_preferences", sa.MetaData(), autoload_with=engine)
    with engine.begin() as db:
        db.execute(table.update().where(table.c.subject_key == str(LEGACY_OWNER_USER_ID)).values(
            conversation_sort_mode="custom", conversation_sort_direction="asc",
            project_sort_mode="title", project_sort_direction="desc"))
        db.execute(table.insert(), [
            {"subject_key": str(user_id), "conversation_sort_mode": "imported",
             "conversation_sort_direction": "desc", "project_sort_mode": "created", "project_sort_direction": "asc"},
        ])
    migrate("head")
    with Session(engine) as db:
        saved = db.get(UserPreference, str(LEGACY_OWNER_USER_ID))
        untouched = db.get(UserPreference, str(user_id))
        assert saved.navigation_sort["all"] == {"mode": "custom", "direction": "asc"}
        assert saved.project_sort_mode == "title" and saved.project_sort_direction == "desc"
        assert saved.field_revisions["_manual:all:"] == 1
        assert "_manual:all:" not in untouched.field_revisions
        assert untouched.navigation_sort["project_default"]["mode"] == "imported"
        saved.conversation_sort_mode = "content_updated"
        db.commit()
    migrate("20261112_0061", "downgrade")
    migrate("head")


def test_concurrent_anchor_writes_have_exactly_one_winner(isolated_schema, monkeypatch):
    engine, migrate = isolated_schema
    migrate("head")
    request = Request({"type": "http"})
    with Session(engine) as db:
        rows = [Conversation(owner_user_id=LEGACY_OWNER_USER_ID, title=f"Row {i}", display_title=f"Row {i}",
            source_type="manual", source_profile="manual", parser_version="synthetic",
            manual_sort_order=i * 1024, unclassified_sort_order=i * 1024) for i in range(4)]
        db.add_all(rows)
        db.commit()
        ids = [row.id for row in rows]
        version = read_order(request, db=db)["version"]
    first_writer_has_order_lock = Event()
    release_first_writer = Event()
    call_lock = Lock()
    order_lock_calls = 0
    original_lock = conversation_order_route.lock_navigation_order

    def hold_first_writer_after_lock(connection, owner_user_id, *, nowait=False):
        nonlocal order_lock_calls
        original_lock(connection, owner_user_id, nowait=nowait)
        with call_lock:
            order_lock_calls += 1
            is_first = order_lock_calls == 1
        if is_first:
            first_writer_has_order_lock.set()
            if not release_first_writer.wait(timeout=10):
                raise AssertionError("Timed out waiting to release the first ordering writer.")

    monkeypatch.setattr(conversation_order_route, "lock_navigation_order", hold_first_writer_after_lock)

    def move(identifier):
        with Session(engine) as db:
            try:
                change_order(OrderChange(scope="all", expected_version=version, conversation_id=identifier,
                    before_id=ids[0]), request, db)
                return 200
            except HTTPException as error:
                db.rollback()
                return error.status_code

    with ThreadPoolExecutor(2) as executor:
        first_writer = executor.submit(move, ids[2])
        assert first_writer_has_order_lock.wait(timeout=10), "First writer did not acquire the ordering lock."
        competing_writer = executor.submit(move, ids[3])
        try:
            # Keep the first transaction open while the competitor reaches the
            # same scope. Exactly one write must win; the second must fail fast.
            assert competing_writer.result(timeout=10) == 409
        finally:
            release_first_writer.set()
        assert first_writer.result(timeout=10) == 200
    with Session(engine) as db:
        assert read_order(request, db=db)["count"] == 4

    # A different request can acquire the preference fence immediately after
    # our commit. It must not turn a successful write into a post-commit 409.
    with Session(engine) as blocker, Session(engine) as winner:
        version = read_order(request, db=winner)["version"]
        commit = winner.commit

        def commit_then_hold_preference():
            commit()
            conversation_order_route.get_or_create_preferences(blocker, "local:default", nowait=True)

        monkeypatch.setattr(winner, "commit", commit_then_hold_preference)
        saved = change_order(OrderChange(scope="all", expected_version=version,
            conversation_id=ids[3], before_id=ids[0]), request, winner)
        assert saved["count"] == 4 and saved["initialized"]
        assert saved["version"] != version
    with Session(engine) as db:
        assert read_order(request, db=db)["version"] == saved["version"]

    # Retain the original simultaneous-start race as well as the deterministic
    # overlap and post-commit fence controls above.
    version = saved["version"]
    barrier = Barrier(2)

    def simultaneous_move(identifier):
        barrier.wait(timeout=10)
        return move(identifier)

    with ThreadPoolExecutor(2) as executor:
        assert sorted(executor.map(simultaneous_move, ids[2:])) == [200, 409]


def test_order_does_not_wait_behind_locked_canonical_writer(isolated_schema, monkeypatch):
    engine, migrate = isolated_schema
    migrate("head")
    request = Request({"type": "http"})
    with Session(engine) as db:
        row = Conversation(owner_user_id=LEGACY_OWNER_USER_ID, title="Writer", display_title="Writer",
            source_type="manual", source_profile="manual", parser_version="synthetic")
        db.add(row); db.commit()
        identifier = row.id
        version = read_order(request, db=db)["version"]
    with Session(engine) as writer, Session(engine) as ordering:
        writer.query(Conversation).filter_by(id=identifier).with_for_update().one()
        started = monotonic()
        with pytest.raises(HTTPException) as failure:
            change_order(OrderChange(scope="all", expected_version=version,
                initialize_from={"mode": "imported", "direction": "desc"}), request, ordering)
        assert failure.value.status_code == 409
        assert monotonic() - started < 3
        writer.rollback()
    # The preference fence precedes canonical locking and must also be nonblocking.
    from app.services.preferences import get_or_create_preferences
    from app.core.config import get_settings
    with Session(engine) as writer:
        get_or_create_preferences(writer, str(LEGACY_OWNER_USER_ID))
        for operation in ("read", "write"):
            with Session(engine) as ordering:
                started = monotonic()
                with pytest.raises(HTTPException) as failure:
                    if operation == "read":
                        read_order(request, db=ordering)
                    else:
                        change_order(OrderChange(scope="all", expected_version=version,
                            initialize_from={"mode": "imported", "direction": "desc"}), request, ordering)
                assert failure.value.status_code == 409
                assert monotonic() - started < 3
                ordering.rollback()
        writer.rollback()
    # Account disable/delete still fences ordering, but never leaves it waiting.
    monkeypatch.setattr(get_settings(), "auth_enabled", True)
    with Session(engine) as writer, Session(engine) as ordering:
        writer.query(User).filter_by(id=LEGACY_OWNER_USER_ID).with_for_update().one()
        started = monotonic()
        with pytest.raises(HTTPException) as failure:
            read_order(request, db=ordering)
        assert failure.value.status_code == 409
        assert monotonic() - started < 3
        writer.rollback()


def test_grouped_pagination_preserves_duplicates_without_loading_all_bodies(isolated_schema):
    engine, migrate = isolated_schema
    migrate("head")
    with Session(engine) as db:
        for index in range(30):
            conversation = Conversation(owner_user_id=LEGACY_OWNER_USER_ID, title=f"Corpus {index}",
                display_title=f"Corpus {index}", source_type="manual", source_profile="manual", parser_version="synthetic")
            db.add(conversation)
            db.flush()
            db.bulk_insert_mappings(SearchDocument, [{
                "id": uuid.uuid4(), "conversation_id": conversation.id, "document_type": "message",
                "title": conversation.title, "plain_text": "中文 alpha 100%_path " + "synthetic " * 2048,
                "search_text": "中文 alpha 100%_path", "metadata_": {}, "created_at": datetime.now(timezone.utc),
            } for _ in range(20)])
        db.commit()
    loaded, statements = [], []
    def observe(_session, row):
        if isinstance(row, SearchDocument):
            loaded.append(row.id)
    def capture(_connection, _cursor, statement, *_args):
        statements.append(statement)
    with Session(engine) as db:
        sa.event.listen(db, "loaded_as_persistent", observe)
        sa.event.listen(engine, "before_cursor_execute", capture)
        try:
            first = search(db, "中文 alpha", grouped=True, limit=10, offset=0)
            second = search(db, "中文 alpha", grouped=True, limit=10, offset=10)
        finally:
            sa.event.remove(engine, "before_cursor_execute", capture)
        assert first.total == second.total == 30 and first.has_more
        assert len(loaded) == 20
        assert len({item.conversation_id for item in first.items + second.items}) == 20
        assert all(item.hit_count == 20 for item in first.items + second.items)
        assert any("row_number() OVER (PARTITION BY" in statement for statement in statements)
        assert search(db, "100%_path", grouped=True, limit=10, offset=0).total == 30
        assert search(db, "100%_missing", grouped=True, limit=10, offset=0).total == 0
        assert search(db, '"中文 alpha"', grouped=True, limit=10, offset=0).total == 30
