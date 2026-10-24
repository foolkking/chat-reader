"""Import result reads must not materialize unrelated event history."""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import event
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Query, Session

from app.core.database import get_db
from app.main import app
from app.models.conversation import Conversation
from app.models.conversation_event import ConversationEvent
from app.models.import_record import ImportRecord
from app.models.user import User
from app.services.conversations.conversation_deletion import delete_conversation_record
from app.services.import_queue import conversation_ids_for_import
from app.services.ownership import LEGACY_OWNER_USER_ID, OwnershipScope
from test_import_preview_api import client  # noqa: F401


def test_import_results_filter_in_sql_and_load_only_matching_id_rows(client, monkeypatch):
    import_id = uuid.uuid4()
    ids = [uuid.uuid4() for _ in range(3)]
    unrelated_conversation_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        db.add_all([
            Conversation(
                id=identity, owner_user_id=LEGACY_OWNER_USER_ID,
                title="Synthetic result", display_title="Synthetic result",
                source_type="test", source_profile="test", parser_version="test-v1",
            )
            for identity in [*ids, unrelated_conversation_id]
        ])
        db.flush()
        db.add(ImportRecord(
            id=import_id, owner_user_id=LEGACY_OWNER_USER_ID,
            source_profile="synthetic", source_fingerprint=str(import_id),
            status="committed", phase="committed", completed_at=now,
            conversation_id=ids[0],
        ))
        db.add_all([
            ConversationEvent(
                conversation_id=ids[0], event_type="conversation_imported",
                payload={"import_id": str(uuid.uuid4()), "synthetic_metadata": "x" * 2048},
            )
            for _ in range(1000)
        ])
        db.add_all([
            ConversationEvent(
                conversation_id=identity, event_type="conversation_imported",
                payload={"import_id": str(import_id)}, created_at=now + timedelta(seconds=index),
            )
            for index, identity in enumerate([ids[0], ids[1], ids[1], ids[2]])
        ])
        # Matching payload alone must not admit another event kind.
        db.add(ConversationEvent(
            conversation_id=unrelated_conversation_id, event_type="synthetic_unrelated",
            payload={"import_id": str(import_id)},
        ))
        db.commit()
        engine = db.get_bind()
    finally:
        db.close()
        generator.close()

    materialized_rows = []
    postgres_queries = []
    original_all = Query.all

    def observe_all(query):
        rows = original_all(query)
        if any(column.get("entity") is ConversationEvent for column in query.column_descriptions):
            materialized_rows.append(len(rows))
            postgres_queries.append(query.statement.compile(dialect=postgresql.dialect()))
        return rows

    monkeypatch.setattr(Query, "all", observe_all)
    loaded_events = []
    statements = []

    def observe_sql(_connection, _cursor, statement, parameters, _context, _many):
        if "FROM conversation_events" in statement:
            statements.append((statement, parameters))

    event.listen(engine, "before_cursor_execute", observe_sql)
    try:
        with Session(engine) as reader:
            event.listen(reader, "loaded_as_persistent", lambda _db, row: loaded_events.append(row)
                         if isinstance(row, ConversationEvent) else None)
            record = reader.get(ImportRecord, import_id)
            assert conversation_ids_for_import(reader, record) == ids
        assert materialized_rows == [4], "Unrelated event rows must be filtered before Python materialization."
        assert loaded_events == [], "Result lookup needs IDs, not event ORM objects or payloads."
        assert len(statements) == 1
        assert str(import_id) in statements[0][1]
        assert "->>" in str(postgres_queries[0])
        assert str(import_id) in postgres_queries[0].params.values()

        expected = [str(identity) for identity in ids]
        assert client.get(f"/api/tasks/{import_id}").json()["result"]["conversation_ids"] == expected
        active = client.get("/api/tasks/active").json()
        matching = next(task for task in active if task["job_id"] == str(import_id))
        assert matching["result"]["conversation_ids"] == expected
        assert client.get(f"/api/imports/{import_id}/status").json()["conversation_ids"] == expected
        assert materialized_rows == [4, 4, 4, 4]
    finally:
        event.remove(engine, "before_cursor_execute", observe_sql)


@pytest.mark.parametrize("status", ["previewed", "queued", "processing", "failed"])
@pytest.mark.parametrize("has_primary", [False, True])
def test_uncommitted_import_result_keeps_its_existing_fast_path(client, status, has_primary):
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        primary_id = uuid.uuid4() if has_primary else None
        record = ImportRecord(
            id=uuid.uuid4(), source_profile="synthetic", source_fingerprint="synthetic",
            status=status, conversation_id=primary_id,
        )

        def reject_event_query(_connection, _cursor, statement, _parameters, _context, _many):
            assert "conversation_events" not in statement

        engine = db.get_bind()
        event.listen(engine, "before_cursor_execute", reject_event_query)
        try:
            assert conversation_ids_for_import(db, record) == ([primary_id] if primary_id else [])
        finally:
            event.remove(engine, "before_cursor_execute", reject_event_query)
    finally:
        db.close()
        generator.close()


def test_import_result_order_is_primary_then_event_time_and_stable_tiebreaker(client):
    import_id = uuid.uuid4()
    primary_id, later_id, earlier_id = (uuid.UUID(int=value) for value in [3, 2, 1])
    now = datetime.now(timezone.utc)
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        db.add_all([
            Conversation(
                id=identity, title="Synthetic result", display_title="Synthetic result",
                source_type="test", source_profile="test", parser_version="test-v1",
            )
            for identity in [primary_id, later_id, earlier_id]
        ])
        db.flush()
        db.add_all([
            ConversationEvent(
                id=event_id, conversation_id=identity, event_type="conversation_imported",
                payload={"import_id": str(import_id)}, created_at=now,
            )
            for event_id, identity in [
                (uuid.UUID(int=2), later_id), (uuid.UUID(int=1), earlier_id),
            ]
        ])
        db.commit()
        record = ImportRecord(
            id=import_id, source_profile="synthetic", source_fingerprint="synthetic",
            status="committed", conversation_id=primary_id,
        )
        assert conversation_ids_for_import(db, record) == [primary_id, earlier_id, later_id]
        assert conversation_ids_for_import(db, record) == [primary_id, earlier_id, later_id]
    finally:
        db.close()
        generator.close()


def test_batch_import_keeps_surviving_results_after_primary_is_deleted(client):
    import_id = uuid.uuid4()
    ids = [uuid.uuid4() for _ in range(3)]
    now = datetime.now(timezone.utc)
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        # Exercise the declared ON DELETE SET NULL/CASCADE semantics, not a
        # manual ImportRecord edit that could hide a foreign-key regression.
        db.connection().exec_driver_sql("PRAGMA foreign_keys=ON")
        db.add_all([
            Conversation(
                id=identity, owner_user_id=LEGACY_OWNER_USER_ID,
                title="Synthetic batch result", display_title="Synthetic batch result",
                source_type="test", source_profile="test", parser_version="test-v1",
                message_count=index + 1,
            )
            for index, identity in enumerate(ids)
        ])
        db.flush()
        db.add(ImportRecord(
            id=import_id, owner_user_id=LEGACY_OWNER_USER_ID,
            source_profile="synthetic", source_fingerprint=str(import_id),
            status="committed", phase="completed", completed_at=now,
            conversation_id=ids[0],
        ))
        db.add_all([
            ConversationEvent(
                conversation_id=identity, event_type="conversation_imported",
                payload={"import_id": str(import_id)}, created_at=now + timedelta(seconds=index),
            )
            for index, identity in enumerate([ids[0], ids[1], ids[1], ids[2]])
        ])
        db.commit()
    finally:
        db.close()
        generator.close()

    def assert_results(remaining):
        expected = [str(identity) for identity in remaining]
        task = client.get(f"/api/tasks/{import_id}")
        status = client.get(f"/api/imports/{import_id}/status")
        active = client.get("/api/tasks/active")
        assert task.status_code == status.status_code == active.status_code == 200
        assert task.json()["status"] == "committed"
        assert task.json()["result"]["conversation_ids"] == expected
        assert status.json()["conversation_ids"] == expected
        assert status.json()["conversation_count"] == len(expected)
        assert status.json()["message_count"] == sum(ids.index(identity) + 1 for identity in remaining)
        visible = next(row for row in active.json() if row["job_id"] == str(import_id))
        assert visible["result"]["conversation_ids"] == expected

    assert_results(ids)
    for index, identity in enumerate(ids):
        response = client.delete(f"/api/conversations/{identity}")
        assert response.status_code == 204, response.text
        generator = app.dependency_overrides[get_db]()
        db = next(generator)
        try:
            assert db.get(ImportRecord, import_id).conversation_id is None
            assert db.get(Conversation, identity) is None
            assert db.query(ConversationEvent).filter_by(conversation_id=identity).count() == 0
        finally:
            db.close()
            generator.close()
        assert_results(ids[index + 1:])


@pytest.mark.parametrize("target_index", [0, 1], ids=["primary", "secondary"])
@pytest.mark.parametrize("transition", [
    "delete_gap", "deleted_status", "deleted_timestamp", "owner_changed", "archived",
])
def test_import_results_only_link_to_currently_available_conversations(
    client, monkeypatch, target_index, transition,
):
    import_id = uuid.uuid4()
    ids = [uuid.uuid4() for _ in range(3)]
    now = datetime.now(timezone.utc)
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        db.add_all([
            Conversation(
                id=identity, owner_user_id=LEGACY_OWNER_USER_ID,
                title="Synthetic result visibility", display_title="Synthetic result visibility",
                source_type="test", source_profile="test", parser_version="test-v1",
                message_count=index + 1,
            )
            for index, identity in enumerate(ids)
        ])
        db.flush()
        db.add(ImportRecord(
            id=import_id, owner_user_id=LEGACY_OWNER_USER_ID,
            source_profile="synthetic", source_fingerprint=str(import_id),
            status="committed", phase="completed", completed_at=now,
            conversation_id=ids[0],
        ))
        db.add_all([
            ConversationEvent(
                conversation_id=identity, event_type="conversation_imported",
                payload={"import_id": str(import_id)}, created_at=now + timedelta(seconds=index),
            )
            for index, identity in enumerate([ids[0], ids[1], ids[1], ids[2]])
        ])
        db.commit()
    finally:
        db.close()
        generator.close()

    def assert_results(remaining):
        expected = [str(identity) for identity in remaining]
        task = client.get(f"/api/tasks/{import_id}")
        listing = client.get("/api/tasks/active")
        status = client.get(f"/api/imports/{import_id}/status")
        assert task.status_code == listing.status_code == status.status_code == 200
        assert task.json()["status"] == status.json()["status"] == "committed"
        assert task.json()["result"]["conversation_ids"] == expected
        listed = next(row for row in listing.json() if row["job_id"] == str(import_id))
        assert listed["result"]["conversation_ids"] == expected
        assert status.json()["conversation_ids"] == expected
        assert status.json()["conversation_count"] == len(remaining)
        assert status.json()["message_count"] == sum(ids.index(identity) + 1 for identity in remaining)

    assert_results(ids)
    target_id = ids[target_index]
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        if transition == "delete_gap":
            def pause_before_cascade(_conversation, **_kwargs):
                raise RuntimeError("synthetic-delete-cascade-paused")

            # Execute the real first deletion commit, then stop before its
            # destructive cascade. Subsequent API reads use fresh sessions.
            with monkeypatch.context() as patch:
                patch.setattr(db, "refresh", pause_before_cascade)
                with pytest.raises(RuntimeError, match="synthetic-delete-cascade-paused"):
                    delete_conversation_record(db, target_id, OwnershipScope(LEGACY_OWNER_USER_ID))
            target = db.get(Conversation, target_id)
            assert target.status == "deleted" and target.deleted_at is not None
        else:
            target = db.get(Conversation, target_id)
            if transition == "deleted_status":
                target.status = "deleted"
            elif transition == "deleted_timestamp":
                target.deleted_at = now
            elif transition == "owner_changed":
                other_owner = uuid.uuid4()
                db.add(User(id=other_owner, role="USER", status="ACTIVE"))
                db.flush()
                target.owner_user_id = other_owner
            else:
                target.status = "archived"
            db.commit()
        # Neither the conversation nor its events have been hard-deleted yet.
        assert db.get(ImportRecord, import_id).conversation_id == ids[0]
        assert db.query(ConversationEvent).filter_by(conversation_id=target_id).count() > 0
    finally:
        db.close()
        generator.close()

    assert client.get(f"/api/conversations/{target_id}").status_code == (
        200 if transition == "archived" else 404
    )
    assert_results(ids if transition == "archived" else [
        identity for identity in ids if identity != target_id
    ])


@pytest.mark.parametrize("legacy_unowned", [False, True], ids=["account", "legacy-unowned"])
def test_import_results_do_not_inherit_conversations_from_another_owner(client, legacy_unowned):
    owner = None if legacy_unowned else uuid.uuid4()
    other_owner = uuid.uuid4()
    import_id = uuid.uuid4()
    ids = [uuid.uuid4() for _ in range(3 if owner else 2)]
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        db.add(User(id=other_owner, role="USER", status="ACTIVE"))
        if owner:
            db.add(User(id=owner, role="USER", status="ACTIVE"))
        db.flush()
        db.add_all([
            Conversation(
                id=identity, owner_user_id=result_owner,
                title="Synthetic owner result", display_title="Synthetic owner result",
                source_type="test", source_profile="test", parser_version="test-v1",
            )
            for identity, result_owner in zip(ids, [owner, other_owner, None])
        ])
        db.flush()
        record = ImportRecord(
            id=import_id, owner_user_id=owner,
            source_profile="synthetic", source_fingerprint=str(import_id),
            status="committed", conversation_id=ids[1],
        )
        db.add(record)
        db.add_all([
            ConversationEvent(
                conversation_id=identity, event_type="conversation_imported",
                payload={"import_id": str(import_id)},
            )
            for identity in ids
        ])
        db.commit()
        assert conversation_ids_for_import(db, record) == [ids[0]]
        db.get(Conversation, ids[0]).deleted_at = datetime.now(timezone.utc)
        db.commit()
        assert conversation_ids_for_import(db, record) == []
        # Reading results cannot rewrite historical task ownership or primary.
        assert record.status == "committed" and record.conversation_id == ids[1]
    finally:
        db.close()
        generator.close()
