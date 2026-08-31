import io
import json
import uuid
import zipfile
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from app.core.database import get_db
from app.core.config import get_settings
from app.main import app
from app.models.annotation import ConversationAnnotation
from app.models.attachment import Attachment, MessageVersionAttachment
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


def test_merge_rewrites_attachment_references_and_blocks_without_mutating_source(
    client: TestClient,
    monkeypatch,
    tmp_path,
) -> None:
    monkeypatch.setenv("OFFLINE_STORAGE_DIR", str(tmp_path / "offline"))
    get_settings.cache_clear()
    source_id = _commit_messages(client, "Attachment source", [{"role": "Prompt", "say": "Attach this file."}])
    target_id = _commit_messages(client, "Attachment target", [{"role": "Prompt", "say": "Keep target."}])
    source_message = _window(client, source_id)[0]

    session = client.post(
        f"/api/conversations/{source_id}/attachment-upload-sessions",
        json={
            "target_message_id": source_message["id"],
            "base_message_version_id": source_message["current_version"]["id"],
        },
    )
    assert session.status_code == 201, session.text
    uploaded = client.post(
        f"/api/attachment-upload-sessions/{session.json()['id']}/items",
        files={"file": ("evidence.txt", b"attachment body", "text/plain")},
    )
    assert uploaded.status_code == 201, uploaded.text
    promoted = client.post(
        f"/api/conversations/{source_id}/attachments",
        json={"upload_item_ids": [uploaded.json()["id"]]},
    )
    assert promoted.status_code == 201, promoted.text
    source_attachment_id = promoted.json()["items"][0]["id"]
    source_text = (
        f"# Attachment evidence\n\nBefore\n\n"
        f"[Evidence](cr-asset://{source_attachment_id.upper()})\n\nAfter"
    )
    saved = client.patch(
        f"/api/messages/{source_message['id']}",
        json={"content_markdown": source_text, "base_version_id": source_message["current_version"]["id"]},
    )
    assert saved.status_code == 200, saved.text
    source_version_id = uuid.UUID(saved.json()["message"]["current_version"]["id"])
    with _database_session() as db:
        source_attachment_block = next(
            block
            for block in (
                db.query(RenderBlock)
                .filter(RenderBlock.message_version_id == source_version_id)
                .all()
            )
            if source_attachment_id.lower() in " ".join([
                block.plain_text or "",
                json.dumps(block.data or {}, sort_keys=True),
            ]).lower()
        )
        source_attachment_block.sanitized_html = (
            f'<a href="cr-asset://{source_attachment_id}">Evidence</a>'
        )
        db.commit()

    queued = client.post(
        "/api/conversations/merge",
        json={"conversation_ids": [source_id, target_id], "title": "Attachment merge"},
    )
    assert queued.status_code == 202, queued.text
    _complete_background_job(queued.json()["job_id"])
    task = client.get(f"/api/tasks/{queued.json()['job_id']}").json()
    assert task["status"] == "committed", task
    merged_id = task["result"]["conversation_id"]

    merged_message = next(item for item in _window(client, merged_id) if "Evidence" in item["current_version"]["display_text"])
    merged_version = merged_message["current_version"]
    assert source_attachment_id.lower() not in merged_version["display_text"].lower()
    target_attachment_ids = {
        item["id"] for item in client.get(f"/api/conversations/{merged_id}/attachments").json()["items"]
    }
    assert target_attachment_ids
    target_attachment_id = next(iter(target_attachment_ids))
    merged_blocks = merged_version["blocks"]
    assert any(str(attachment_id) in str(merged_blocks) for attachment_id in target_attachment_ids)
    occurrences = client.get(f"/api/conversations/{merged_id}/attachments").json()["items"][0]["occurrences"]
    assert occurrences and all(item["message_version_id"] == merged_version["id"] for item in occurrences)
    with _database_session() as db:
        merged_message_row = db.get(Message, uuid.UUID(merged_message["id"]))
        merged_version_row = db.get(MessageVersion, uuid.UUID(merged_version["id"]))
        assert merged_message_row is not None and merged_version_row is not None
        assert merged_message_row.content_hash == merged_version_row.content_hash
        source_message_row = db.get(Message, uuid.UUID(source_message["id"]))
        assert source_message_row is not None
        assert merged_message_row.content_hash != source_message_row.content_hash

        merged_projection = " ".join([
            merged_version_row.display_text,
            merged_version_row.plain_text,
            json.dumps(merged_version_row.blocks, sort_keys=True),
        ]).lower()
        assert source_attachment_id.lower() not in merged_projection
        assert any(item.lower() in merged_projection for item in target_attachment_ids)
        merged_render_blocks = (
            db.query(RenderBlock)
            .filter(RenderBlock.message_version_id == merged_version_row.id)
            .all()
        )
        render_projection = " ".join(
            " ".join([
                block.plain_text or "",
                json.dumps(block.data or {}, sort_keys=True),
                block.sanitized_html or "",
            ])
            for block in merged_render_blocks
        ).lower()
        assert source_attachment_id.lower() not in render_projection
        assert any(item.lower() in render_projection for item in target_attachment_ids)
        assert "<a href=\"cr-asset://" in render_projection

    message_detail = client.get(f"/api/messages/{merged_message['id']}")
    assert message_detail.status_code == 200
    assert message_detail.json()["current_version"]["id"] == merged_version["id"]
    assert message_detail.json()["render_blocks"]
    viewer_content = client.get(f"/api/attachments/{target_attachment_id}/content")
    assert viewer_content.status_code == 200
    assert viewer_content.content == b"attachment body"
    search = client.get("/api/search", params={"q": "Before", "conversation_id": merged_id})
    assert search.status_code == 200
    assert search.json()["total"] >= 1
    toc = client.get(f"/api/conversations/{merged_id}/toc")
    assert toc.status_code == 200
    assert any(item["text"] == "Attachment evidence" for item in toc.json()["items"])

    offline = client.post(
        "/api/offline/packages",
        json={"scope": "conversation", "conversation_id": merged_id, "include_assets": "all"},
        headers={"Idempotency-Key": "merged-attachment-offline"},
    )
    assert offline.status_code == 202, offline.text
    _complete_background_job(offline.json()["job_id"])
    offline_task = client.get(f"/api/tasks/{offline.json()['job_id']}")
    assert offline_task.status_code == 200
    assert offline_task.json()["status"] == "committed"
    archive = client.get(f"/api/offline/packages/{offline.json()['package_id']}/download")
    assert archive.status_code == 200
    with zipfile.ZipFile(io.BytesIO(archive.content)) as bundle:
        offline_payload = json.loads(bundle.read("package.json"))
        packaged_conversation = next(
            item for item in offline_payload["conversations"] if item["id"] == merged_id
        )
        packaged_message = next(
            item
            for item in packaged_conversation["messages"]
            if item["id"] == merged_message["id"]
        )
        packaged_projection = json.dumps(packaged_message, sort_keys=True).lower()
        assert source_attachment_id.lower() not in packaged_projection
        assert target_attachment_id.lower() in packaged_projection
        packaged_attachment = next(
            item
            for item in packaged_conversation["attachments"]
            if item["id"] == target_attachment_id
        )
        assert packaged_attachment["occurrences"][0]["message_version_id"] == merged_version["id"]
        assert packaged_attachment["content_path"] in bundle.namelist()
        assert bundle.read(packaged_attachment["content_path"]) == b"attachment body"
        assert any(item["text"] == "Attachment evidence" for item in packaged_conversation["headings"])
        assert any("Before" in (item.get("plain_text") or "") for item in packaged_conversation["search_documents"])
    source_after = _window(client, source_id)[0]["current_version"]["display_text"]
    assert source_attachment_id.upper() in source_after


@pytest.mark.parametrize(
    ("corruption", "error_match"),
    [
        ("inactive_attachment", "missing, inactive, or belongs to another conversation"),
        ("missing_occurrence", "has no occurrence link"),
        ("missing_block", "points to a missing render block"),
        ("cross_conversation", "missing, inactive, or belongs to another conversation"),
    ],
)
def test_merge_fails_closed_for_broken_source_attachment_graph(
    client: TestClient,
    corruption: str,
    error_match: str,
) -> None:
    source_id = _commit_messages(client, "Broken attachment source", [{"role": "Prompt", "say": "Source"}])
    other_id = _commit_messages(client, "Broken attachment peer", [{"role": "Prompt", "say": "Peer"}])
    source_message = _window(client, source_id)[0]
    session = client.post(
        f"/api/conversations/{source_id}/attachment-upload-sessions",
        json={
            "target_message_id": source_message["id"],
            "base_message_version_id": source_message["current_version"]["id"],
        },
    )
    uploaded = client.post(
        f"/api/attachment-upload-sessions/{session.json()['id']}/items",
        files={"file": ("evidence.txt", b"attachment body", "text/plain")},
    )
    promoted = client.post(
        f"/api/conversations/{source_id}/attachments",
        json={"upload_item_ids": [uploaded.json()["id"]]},
    )
    attachment_id = promoted.json()["items"][0]["id"]
    saved = client.patch(
        f"/api/messages/{source_message['id']}",
        json={
            "content_markdown": f"[Evidence](cr-asset://{attachment_id})",
            "base_version_id": source_message["current_version"]["id"],
        },
    )
    assert saved.status_code == 200, saved.text

    with _database_session() as db:
        source_uuid = uuid.UUID(source_id)
        other_uuid = uuid.UUID(other_id)
        attachment = db.get(Attachment, uuid.UUID(attachment_id))
        assert attachment is not None
        version_id = uuid.UUID(saved.json()["message"]["current_version"]["id"])
        occurrence = (
            db.query(MessageVersionAttachment)
            .filter(MessageVersionAttachment.message_version_id == version_id)
            .one()
        )
        if corruption == "inactive_attachment":
            attachment.deleted_at = datetime.now(timezone.utc)
        elif corruption == "missing_occurrence":
            db.delete(occurrence)
        elif corruption == "missing_block":
            occurrence.block_index = 999
        elif corruption == "cross_conversation":
            attachment.conversation_id = other_uuid
        db.commit()

        merged_before = db.query(Conversation).filter(Conversation.source_type == "merged").count()
        with pytest.raises(ValueError, match=error_match):
            merge_conversations(db, [source_uuid, other_uuid], title="Must roll back")
        db.rollback()

        assert db.query(Conversation).filter(Conversation.source_type == "merged").count() == merged_before
        source_after = db.get(MessageVersion, version_id)
        assert source_after is not None
        assert attachment_id in source_after.display_text


def test_merge_worker_rolls_back_target_when_source_occurrence_is_missing(client: TestClient) -> None:
    source_id = _commit_messages(client, "Worker integrity source", [{"role": "Prompt", "say": "Source"}])
    peer_id = _commit_messages(client, "Worker integrity peer", [{"role": "Prompt", "say": "Peer"}])
    source_message = _window(client, source_id)[0]
    upload_session = client.post(
        f"/api/conversations/{source_id}/attachment-upload-sessions",
        json={
            "target_message_id": source_message["id"],
            "base_message_version_id": source_message["current_version"]["id"],
        },
    )
    uploaded = client.post(
        f"/api/attachment-upload-sessions/{upload_session.json()['id']}/items",
        files={"file": ("worker-evidence.txt", b"attachment body", "text/plain")},
    )
    promoted = client.post(
        f"/api/conversations/{source_id}/attachments",
        json={"upload_item_ids": [uploaded.json()["id"]]},
    )
    attachment_id = promoted.json()["items"][0]["id"]
    saved = client.patch(
        f"/api/messages/{source_message['id']}",
        json={
            "content_markdown": f"[Evidence](cr-asset://{attachment_id})",
            "base_version_id": source_message["current_version"]["id"],
        },
    )
    assert saved.status_code == 200, saved.text
    version_id = uuid.UUID(saved.json()["message"]["current_version"]["id"])

    with _database_session() as db:
        occurrence = (
            db.query(MessageVersionAttachment)
            .filter(MessageVersionAttachment.message_version_id == version_id)
            .one()
        )
        db.delete(occurrence)
        db.commit()
        merged_before = db.query(Conversation).filter(Conversation.source_type == "merged").count()

    queued = client.post(
        "/api/conversations/merge",
        json={"conversation_ids": [source_id, peer_id], "title": "Must not publish"},
    )
    assert queued.status_code == 202, queued.text
    _complete_background_job(queued.json()["job_id"])
    task = client.get(f"/api/tasks/{queued.json()['job_id']}")
    assert task.status_code == 200
    assert task.json()["status"] == "failed"
    assert task.json()["result"] == {}

    with _database_session() as db:
        assert db.query(Conversation).filter(Conversation.source_type == "merged").count() == merged_before
        source_after = db.get(MessageVersion, version_id)
        assert source_after is not None
        assert attachment_id in source_after.display_text


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
