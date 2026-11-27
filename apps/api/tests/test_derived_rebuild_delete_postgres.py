"""Exercise the same index COPY and conversation cascade that run in production."""
import time
from concurrent.futures import ThreadPoolExecutor
from queue import Queue
from threading import Event
from uuid import UUID

import pytest
from sqlalchemy import select, text

from app.models.background_job import BackgroundJob
from app.models.conversation import Conversation
from app.models.conversation_event import ConversationEvent
from app.models.search_document import SearchDocument
from app.services.background_jobs import claim_next_job, process_background_job
from app.services.derived_rebuild import rebuild_conversation_derived_data
from app.services.search import search_indexer
from test_import_profile_postgres import isolated_schema, pytestmark  # noqa: F401
from test_selective_append_postgres import pg_client  # noqa: F401


def create_conversation(client):
    created = client.post("/api/conversations", json={
        "title": "Synthetic rebuild and deletion",
        "messages": [{"role": "user", "content_markdown": "Synthetic question"},
                     {"role": "assistant", "content_markdown": "Synthetic answer"}],
    })
    assert created.status_code == 201
    return created.json()


def test_delete_during_worker_search_publication(pg_client, monkeypatch):
    client, factory = pg_client
    created = create_conversation(client)
    cid = UUID(created["conversation"]["id"])
    inserted = client.post(f"/api/conversations/{cid}/messages/insert", json={
        "anchor_message_id": created["messages"][-1]["id"],
        "position": "after", "mode": "single",
        "messages": [{"role": "user", "content_markdown": "Synthetic inserted text"}],
    })
    assert inserted.status_code == 201
    with factory() as db:
        job_id = claim_next_job(db, job_type="conversation_derived_rebuild")
        assert job_id is not None
        assert db.get(BackgroundJob, job_id).payload["conversation_id"] == str(cid)
        db.commit()

    # Pause with the old search rows already removed, immediately before the
    # real COPY takes foreign-key locks on the parent and message versions.
    ready = Queue()
    resume = Event()
    copy_errors = []
    insert_rows = search_indexer.insert_rows

    def pause_copy(db, model, rows):
        if model is SearchDocument and not resume.is_set():
            ready.put(db.scalar(text("SELECT pg_backend_pid()")))
            assert resume.wait(20), "Delete never reached its competing transaction"
        try:
            return insert_rows(db, model, rows)
        except Exception as exc:
            copy_errors.append(exc)
            raise

    monkeypatch.setattr(search_indexer, "insert_rows", pause_copy)
    with ThreadPoolExecutor(max_workers=2) as pool:
        worker = pool.submit(process_background_job, job_id, session_factory=factory)
        try:
            worker_pid = ready.get(timeout=20)
            deletion = pool.submit(client.delete, f"/api/conversations/{cid}")
            deadline = time.monotonic() + 10
            while True:
                with factory() as observer:
                    blocked = observer.scalar(text("""
                        SELECT EXISTS (SELECT 1 FROM pg_stat_activity
                            WHERE datname = current_database()
                              AND :worker = ANY(pg_blocking_pids(pid)))
                    """), {"worker": worker_pid})
                if blocked:
                    break
                assert time.monotonic() < deadline, "Delete and index publication did not overlap"
                time.sleep(0.02)
        finally:
            resume.set()
        assert deletion.result(timeout=15).status_code == 204
        worker.result(timeout=15)

    assert not copy_errors
    with factory() as db:
        assert db.get(BackgroundJob, job_id).status == "cancelled"
        assert db.get(Conversation, cid) is None
        assert db.scalar(select(SearchDocument.id).where(SearchDocument.conversation_id == cid)) is None


@pytest.mark.parametrize("boundary", ["rebuilding_versions", "rebuilding_indexes"])
def test_tombstone_between_committed_phases_stops_rebuild(pg_client, boundary):
    client, factory = pg_client
    cid = UUID(create_conversation(client)["conversation"]["id"])

    def publish_tombstone(phase, *_):
        if phase == boundary:
            with factory() as writer:
                writer.execute(text(
                    "UPDATE conversations SET status='deleted', deleted_at=now() WHERE id=:cid"
                ), {"cid": cid})
                writer.commit()

    with factory() as db:
        with pytest.raises(ValueError, match="Conversation not found"):
            rebuild_conversation_derived_data(
                db, cid, commit_batches=True, progress_callback=publish_tombstone,
            )
        db.rollback()
        assert db.get(Conversation, cid).deleted_at is not None
        assert db.scalar(select(ConversationEvent.id).where(
            ConversationEvent.conversation_id == cid,
            ConversationEvent.event_type == "derived_data_rebuilt",
        )) is None
