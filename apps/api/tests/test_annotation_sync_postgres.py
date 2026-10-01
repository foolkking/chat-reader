"""Concurrent sync receipt and notebook writes under real PostgreSQL locks/FKs."""
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from sqlalchemy.orm import Session

from app.models.annotation import AnnotationSyncReceipt, ConversationNotebook
from app.models.conversation import Conversation
from app.models.user import User
from app.schemas.annotation import AnnotationSyncRequest, NotebookPut
from app.services.annotations import AnnotationError, get_notebook, put_notebook, sync_annotations
from test_import_profile_postgres import isolated_schema  # noqa: F401

pytestmark = pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1", reason="requires disposable PostgreSQL")


def seed(engine):
    with Session(engine) as db:
        user = User(normalized_email="sync-test@example.test")
        db.add(user)
        db.flush()
        conversation = Conversation(owner_user_id=user.id, title="Synthetic", display_title="Synthetic",
            source_type="test", source_profile="test", parser_version="test")
        db.add(conversation)
        db.flush()
        subject = str(user.id)
        notebook = get_notebook(db, conversation.id, subject_key=subject)
        db.commit()
        return subject, conversation.id, notebook.id


def operation(conversation_id, notebook_id, title="Synthetic draft"):
    return {"operation_id": str(uuid.uuid4()), "entity_type": "notebook", "entity_id": str(notebook_id),
        "action": "upsert", "conversation_id": str(conversation_id), "base_revision": 1,
        "payload": {"title": title, "blocks": []}}


def test_concurrent_retry_applies_once_and_preserves_receipt(isolated_schema):
    engine, migrate = isolated_schema
    migrate("head")
    subject, conversation_id, notebook_id = seed(engine)
    request = AnnotationSyncRequest.model_validate({"operations": [operation(conversation_id, notebook_id)]})
    barrier = Barrier(2)

    def run(_):
        with Session(engine) as db:
            barrier.wait(timeout=10)
            result = sync_annotations(db, request, subject_key=subject).results[0]
            db.commit()
            return result.status, result.revision

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(run, range(2)))
    assert sorted(results) == [("applied", 2), ("duplicate", 2)]
    with Session(engine) as db:
        assert db.query(AnnotationSyncReceipt).count() == 1
        assert db.query(ConversationNotebook).count() == 1
        assert db.get(ConversationNotebook, notebook_id).title == "Synthetic draft"
        assert db.get(ConversationNotebook, notebook_id).revision == 2


def test_concurrent_distinct_edits_retain_the_losing_draft_once(isolated_schema):
    engine, migrate = isolated_schema
    migrate("head")
    subject, conversation_id, notebook_id = seed(engine)
    requests = [AnnotationSyncRequest.model_validate({"operations": [operation(conversation_id, notebook_id, f"Draft {i}")]}) for i in range(2)]
    barrier = Barrier(2)

    def run(request):
        with Session(engine) as db:
            # Simulate an entity already loaded before a competing write.
            db.get(ConversationNotebook, notebook_id)
            barrier.wait(timeout=10)
            result = sync_annotations(db, request, subject_key=subject).results[0]
            db.commit()
            return result.status

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(run, requests))
    assert sorted(results) == ["applied", "conflict"]
    with Session(engine) as db:
        assert {item.title for item in db.query(ConversationNotebook)} == {"Draft 0", "Draft 1"}
        assert db.query(ConversationNotebook).filter_by(is_conflict=True).count() == 1
        for request in requests:
            assert sync_annotations(db, request, subject_key=subject).results[0].status == "duplicate"
        db.commit()
        assert db.query(ConversationNotebook).count() == 2
        assert db.query(AnnotationSyncReceipt).count() == 2


def test_online_bootstrap_cannot_overwrite_concurrent_edit_with_zero_revision(isolated_schema):
    engine, migrate = isolated_schema
    migrate("head")
    subject, conversation_id, notebook_id = seed(engine)
    barrier = Barrier(2)

    def run(index):
        with Session(engine) as db:
            db.get(ConversationNotebook, notebook_id)
            barrier.wait(timeout=10)
            try:
                result = put_notebook(db, conversation_id, NotebookPut(base_revision=0, title=f"Draft {index}", blocks=[]), subject_key=subject)
                db.commit()
                return result.revision
            except AnnotationError as error:
                db.rollback()
                return error.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(run, range(2)))
    assert sorted(results) == [2, 409]
    with Session(engine) as db:
        assert db.get(ConversationNotebook, notebook_id).revision == 2
        assert db.query(ConversationNotebook).count() == 1


@pytest.mark.parametrize("choice", ["local", "server", "merge"])
def test_conflict_resolution_concurrent_retry_and_owner_isolation(isolated_schema, choice):
    engine, migrate = isolated_schema
    migrate("head")
    subject, conversation_id, notebook_id = seed(engine)
    with Session(engine) as db:
        put_notebook(db, conversation_id, NotebookPut(base_revision=1, title="Server", blocks=[]), subject_key=subject)
        conflict = sync_annotations(db, AnnotationSyncRequest.model_validate({"operations": [operation(conversation_id, notebook_id, "Local")]}), subject_key=subject).results[0]
        db.commit()
    op = {"operation_id": str(uuid.uuid4()), "entity_type": "notebook", "entity_id": str(notebook_id),
        "action": "resolve", "conversation_id": str(conversation_id), "base_revision": 2,
        "payload": {"conflict_copy_id": str(conflict.conflict_copy_id), "conflict_revision": 1, "choice": choice,
            "notebook": {"title": "Merged" if choice == "merge" else "Local", "blocks": []}}}
    request = AnnotationSyncRequest.model_validate({"operations": [op]})
    with Session(engine) as db:
        with pytest.raises(AnnotationError) as error:
            sync_annotations(db, request, subject_key=str(uuid.uuid4()))
        assert error.value.status_code == 404
        db.rollback()
        stale = AnnotationSyncRequest.model_validate({"operations": [{**op, "base_revision": 1}]})
        with pytest.raises(AnnotationError) as error:
            sync_annotations(db, stale, subject_key=subject)
        assert error.value.status_code == 409
        db.rollback()
        assert db.get(ConversationNotebook, conflict.conflict_copy_id) is not None
    barrier = Barrier(2)

    def run(_):
        with Session(engine) as db:
            barrier.wait(timeout=10)
            result = sync_annotations(db, request, subject_key=subject).results[0]
            db.commit()
            return result.status

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(run, range(2))) == ["applied", "duplicate"]
    with Session(engine) as db:
        note = db.get(ConversationNotebook, notebook_id)
        assert note.title == {"local": "Local", "server": "Server", "merge": "Merged"}[choice]
        assert note.revision == (2 if choice == "server" else 3)
        assert db.query(ConversationNotebook).count() == 1
        assert db.query(AnnotationSyncReceipt).count() == 2
