import json
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from app.core.database import get_db
from app.main import app
from app.models.annotation import ConversationAnnotation
from app.models.background_job import BackgroundJob
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.render_block import RenderBlock
from app.services.background_jobs import (
    BackgroundJobCancelled,
    claim_next_job,
    process_background_job,
    recover_stale_jobs,
    retry_background_job,
)
from app.services.editing.message_edit_service import merge_conversations
from test_import_preview_api import client  # noqa: F401
from background_job_test_utils import process_queued_jobs


def _commit_messages(client: TestClient, title: str, messages: list[dict]) -> str:
    preview = client.post(
        "/api/imports/preview",
        files={
            "files": (
                f"{title}.json",
                json.dumps(
                    {"metadata": {"title": title, "powered_by": "ChatGPT Exporter"}, "messages": messages}
                ).encode(),
                "application/json",
            )
        },
    )
    assert preview.status_code == 200
    commit = client.post(f"/api/imports/{preview.json()['import_id']}/commit")
    assert commit.status_code == 200
    return commit.json()["conversation_ids"][0]


def _window(client: TestClient, conversation_id: str) -> list[dict]:
    response = client.get(
        f"/api/conversations/{conversation_id}/message-window",
        params={"limit": 50, "include_blocks": True},
    )
    assert response.status_code == 200
    return response.json()["items"]


def _complete_background_job(job_id: str) -> None:
    process_queued_jobs(until_job_id=job_id)


@contextmanager
def _database_session():
    override = app.dependency_overrides[get_db]
    generator = override()
    db = next(generator)
    try:
        yield db
    finally:
        db.close()
        generator.close()


def test_merge_copies_all_versions_blocks_current_pointer_and_annotations(client: TestClient) -> None:
    first_id = _commit_messages(
        client,
        "History source",
        [
            {"role": "Prompt", "say": "Question"},
            {"role": "Response", "say": "# Original heading\n\nOriginal answer"},
        ],
    )
    second_id = _commit_messages(
        client,
        "Second source",
        [{"role": "Prompt", "say": "Second question"}, {"role": "Response", "say": "Second answer"}],
    )
    source_assistant = _window(client, first_id)[1]
    initial_id = source_assistant["current_version"]["id"]

    second_version_response = client.patch(
        f"/api/messages/{source_assistant['id']}",
        json={"display_text": "# Edited heading\n\nSecond version body", "base_version_id": initial_id},
    )
    assert second_version_response.status_code == 200
    second_version = second_version_response.json()["message"]["current_version"]
    third_version_response = client.patch(
        f"/api/messages/{source_assistant['id']}",
        json={"display_text": "# Latest heading\n\nThird version body", "base_version_id": second_version["id"]},
    )
    assert third_version_response.status_code == 200
    third_version = third_version_response.json()["message"]["current_version"]
    selected = client.put(
        f"/api/messages/{source_assistant['id']}/current-version",
        json={"version_id": second_version["id"]},
    )
    assert selected.status_code == 200

    annotation = client.post(
        f"/api/conversations/{first_id}/annotations",
        json={
            "message_id": source_assistant["id"],
            "message_version_id": second_version["id"],
            "annotation_type": "highlight",
            "color": "yellow",
            "start_block_index": 0,
            "start_offset": 0,
            "end_block_index": 0,
            "end_offset": len("Edited heading"),
            "quote": "Edited heading",
            "comment_markdown": "Merged annotation",
        },
    )
    assert annotation.status_code == 201

    queued = client.post(
        "/api/conversations/merge",
        json={"conversation_ids": [first_id, second_id], "title": "History merge"},
    )
    assert queued.status_code == 202
    _complete_background_job(queued.json()["job_id"])
    task = client.get(f"/api/tasks/{queued.json()['job_id']}").json()
    assert task["status"] == "committed"
    merged_id = task["result"]["conversation_id"]

    merged_assistant = next(
        message for message in _window(client, merged_id)
        if message["current_version"]["display_text"].endswith("Second version body")
    )
    merged_history = client.get(f"/api/messages/{merged_assistant['id']}/versions").json()
    assert [item["version_number"] for item in merged_history["items"]] == [3, 2, 1]
    by_number = {item["version_number"]: item for item in merged_history["items"]}
    assert by_number[2]["is_current"] is True
    assert by_number[2]["id"] not in {initial_id, second_version["id"], third_version["id"]}
    assert by_number[2]["based_on_version_id"] == by_number[1]["id"]
    assert by_number[3]["based_on_version_id"] == by_number[2]["id"]

    merged_annotations = client.get(f"/api/conversations/{merged_id}/annotations").json()
    assert len(merged_annotations) == 1
    assert merged_annotations[0]["message_id"] == merged_assistant["id"]
    assert merged_annotations[0]["message_version_id"] == by_number[2]["id"]
    assert merged_annotations[0]["quote"] == "Edited heading"
    assert client.get(f"/api/conversations/{merged_id}/notebook").json()["blocks"] == []

    toc = client.get(f"/api/conversations/{merged_id}/toc").json()["items"]
    assert any(item["text"] == "Edited heading" for item in toc)
    search = client.get("/api/search", params={"q": "Second version body", "conversation_id": merged_id})
    assert search.status_code == 200
    assert search.json()["total"] >= 1

    source_history = client.get(f"/api/messages/{source_assistant['id']}/versions").json()
    assert [item["id"] for item in source_history["items"]] == [third_version["id"], second_version["id"], initial_id]
    assert len(client.get(f"/api/conversations/{first_id}/annotations").json()) == 1

    with _database_session() as db:
        source_version_ids = [uuid.UUID(item["id"]) for item in source_history["items"]]
        merged_version_ids = [uuid.UUID(item["id"]) for item in merged_history["items"]]
        source_block_count = db.query(RenderBlock).filter(RenderBlock.message_version_id.in_(source_version_ids)).count()
        merged_block_count = db.query(RenderBlock).filter(RenderBlock.message_version_id.in_(merged_version_ids)).count()
        assert merged_block_count == source_block_count


def test_cancel_endpoint_and_stale_retry_limit(client: TestClient) -> None:
    first_id = _commit_messages(client, "Cancel one", [{"role": "Prompt", "say": "one"}])
    second_id = _commit_messages(client, "Cancel two", [{"role": "Prompt", "say": "two"}])
    queued = client.post("/api/conversations/merge", json={"conversation_ids": [first_id, second_id]})
    task_id = queued.json()["job_id"]

    cancelled = client.post(f"/api/tasks/{task_id}/cancel")
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"
    assert cancelled.json()["cancellable"] is False
    assert client.post(f"/api/tasks/{task_id}/cancel").json()["status"] == "cancelled"

    running = client.post("/api/conversations/merge", json={"conversation_ids": [first_id, second_id]})
    running_id = running.json()["job_id"]
    with _database_session() as db:
        assert claim_next_job(db) == uuid.UUID(running_id)
        db.commit()
    cancelling_response = client.post(f"/api/tasks/{running_id}/cancel")
    assert cancelling_response.status_code == 200
    assert cancelling_response.json()["status"] == "cancelling"
    assert client.post(f"/api/tasks/{running_id}/cancel").json()["status"] == "cancelling"
    with _database_session() as db:
        testing_session_local = sessionmaker(bind=db.get_bind(), autoflush=False, autocommit=False)
    process_background_job(uuid.UUID(running_id), testing_session_local)
    with _database_session() as db:
        running_job = db.get(BackgroundJob, uuid.UUID(running_id))
        assert running_job is not None
        assert running_job.status == "cancelled"

    completed = client.post("/api/conversations/merge", json={"conversation_ids": [first_id, second_id]})
    _complete_background_job(completed.json()["job_id"])
    rejected = client.post(f"/api/tasks/{completed.json()['job_id']}/cancel")
    assert rejected.status_code == 409

    with _database_session() as db:
        now = datetime.now(timezone.utc)
        processing = BackgroundJob(
            id=uuid.uuid4(), job_type="conversation_merge", status="processing", phase="blocks",
            progress=50, processed_items=1, total_items=2, payload={}, result={},
            attempt_count=2, heartbeat_at=now - timedelta(minutes=10),
        )
        exhausted = BackgroundJob(
            id=uuid.uuid4(), job_type="conversation_merge", status="processing", phase="blocks",
            progress=50, processed_items=1, total_items=2, payload={}, result={},
            attempt_count=3, heartbeat_at=now - timedelta(minutes=10),
        )
        cancelling = BackgroundJob(
            id=uuid.uuid4(), job_type="conversation_merge", status="cancelling", phase="cancelling",
            progress=50, processed_items=1, total_items=2, payload={}, result={},
            attempt_count=1, heartbeat_at=now - timedelta(minutes=10),
        )
        db.add_all([processing, exhausted, cancelling])
        db.commit()
        assert recover_stale_jobs(db, stale_after_seconds=60) >= 3
        assert processing.status == "queued"
        assert exhausted.status == "failed"
        assert cancelling.status == "cancelled"
        retry_background_job(exhausted)
        assert exhausted.status == "queued"
        assert exhausted.attempt_count == 0
        db.commit()


def test_merge_cancellation_rolls_back_target_conversation(client: TestClient) -> None:
    first_id = _commit_messages(
        client,
        "Rollback source one",
        [{"role": "Prompt", "say": "one"}, {"role": "Response", "say": "# Heading\n\nBody"}],
    )
    second_id = _commit_messages(
        client,
        "Rollback source two",
        [{"role": "Prompt", "say": "two"}, {"role": "Response", "say": "Answer"}],
    )
    with _database_session() as db:
        before = db.query(Conversation).filter(Conversation.source_type == "merged").count()

        def cancel_during_copy(phase: str, progress: int, processed: int, total: int) -> None:
            if phase == "blocks":
                raise BackgroundJobCancelled("cancel test")

        with pytest.raises(BackgroundJobCancelled):
            merge_conversations(
                db,
                [uuid.UUID(first_id), uuid.UUID(second_id)],
                progress_callback=cancel_during_copy,
            )
        db.rollback()
        after = db.query(Conversation).filter(Conversation.source_type == "merged").count()
        assert after == before
        assert db.query(Message).filter(Message.conversation_id.in_([uuid.UUID(first_id), uuid.UUID(second_id)])).count() == 4
        assert db.query(MessageVersion).join(Message).filter(Message.conversation_id.in_([uuid.UUID(first_id), uuid.UUID(second_id)])).count() == 4
        assert db.query(ConversationAnnotation).filter(ConversationAnnotation.conversation_id.in_([uuid.UUID(first_id), uuid.UUID(second_id)])).count() == 0
