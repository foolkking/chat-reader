import io
import json
import uuid
import zipfile
from pathlib import Path

from app.core.config import get_settings
from app.core.database import get_db
from app.main import app
from app.models.attachment import AssetObject, Attachment, MessageVersionAttachment
from app.models.annotation import ConversationAnnotation, ConversationNotebook
from app.models.conversation import Conversation
from app.models.conversation_event import ConversationEvent
from app.models.heading import Heading
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.project import Project
from app.models.project_conversation import ProjectConversation
from app.models.reading_position import ReadingPosition
from app.models.render_block import RenderBlock
from app.models.search_document import SearchDocument
from app.models.source_message_ref import SourceMessageRef
from background_job_test_utils import process_queued_jobs
from test_import_preview_api import client  # noqa: F401


def _process_task(task_id: str) -> None:
    process_queued_jobs(until_job_id=task_id)


def _import_attachment_conversation(client) -> str:
    preview = client.post(
        "/api/imports/preview",
        files={
            "files": (
                "archive-source.json",
                json.dumps(
                    {
                        "metadata": {"powered_by": "ChatGPT Exporter", "title": "System archive fixture"},
                        "messages": [{"role": "Prompt", "say": "Attach evidence here."}],
                    }
                ).encode(),
                "application/json",
            )
        },
    ).json()
    commit = client.post(f"/api/imports/{preview['import_id']}/commit")
    assert commit.status_code == 200, commit.text
    return commit.json()["conversation_ids"][0]


def test_system_archive_v4_empty_instance_restore_round_trip(client, tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("ASSET_STORAGE_DIR", str(tmp_path / "assets"))
    monkeypatch.setenv("ASSET_STORAGE_BACKEND", "local")
    monkeypatch.setenv("ATTACHMENT_SCANNER", "disabled")
    monkeypatch.setenv("ALLOW_UNSCANNED_ATTACHMENTS", "true")
    monkeypatch.setenv("EXPORT_STORAGE_DIR", str(tmp_path / "exports"))
    monkeypatch.setenv("IMPORT_STORAGE_DIR", str(tmp_path / "imports"))
    get_settings.cache_clear()
    conversation_id = _import_attachment_conversation(client)
    upload_session = client.post(
        f"/api/conversations/{conversation_id}/attachment-upload-sessions",
        json={},
    ).json()
    upload_items = []
    for filename, content in (
        ("evidence.txt", b"attachment body\n"),
        ("round-trip-unreferenced-a.txt", b"shared unreferenced bytes\n"),
        ("round-trip-unreferenced-b.txt", b"shared unreferenced bytes\n"),
    ):
        item = client.post(
            f"/api/attachment-upload-sessions/{upload_session['id']}/items",
            files={"file": (filename, content, "text/plain")},
        )
        assert item.status_code == 201, item.text
        upload_items.append(item.json()["id"])
    finalized = client.post(
        f"/api/conversations/{conversation_id}/attachments",
        json={"upload_item_ids": upload_items},
    )
    assert finalized.status_code == 201, finalized.text
    assert len(finalized.json()["items"]) == 3
    referenced_attachment_id = next(
        item["id"] for item in finalized.json()["items"] if item["display_name"] == "evidence.txt"
    )
    detail = client.get(f"/api/conversations/{conversation_id}/message-window", params={"limit": 10}).json()
    message = detail["items"][0]
    edited = client.patch(
        f"/api/messages/{message['id']}",
        json={
            "content_markdown": message["current_version"]["display_text"]
            + f"\n\n[Evidence](cr-asset://{referenced_attachment_id})\n\nSystem archive edit.",
            "base_version_id": message["current_version"]["id"],
        },
    )
    assert edited.status_code == 200, edited.text

    queued = client.post(
        "/api/system/archive/exports",
        json={"include_archived": True},
        headers={"Idempotency-Key": "system-archive-round-trip"},
    )
    assert queued.status_code == 202, queued.text
    _process_task(queued.json()["job_id"])
    task = client.get(f"/api/tasks/{queued.json()['job_id']}").json()
    assert task["status"] == "committed", task
    archive_response = client.get(task["result"]["download_url"])
    assert archive_response.status_code == 200
    archive_bytes = archive_response.content
    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as package:
        manifest = json.loads(package.read("manifest.json"))
        assert manifest["format"] == "chat-reader-system-archive"
        assert manifest["version"] == 4
        assert manifest["restore_mode"] == "empty_instance_only"
        names = set(package.namelist())
        assert "data/message_versions.jsonl" in names
        assert "data/attachment_occurrences.jsonl" in names
        assert any(name.startswith("assets/objects/") for name in names)
        assert not names.intersection({"data/render_blocks.jsonl", "data/headings.jsonl", "data/search_documents.jsonl", "data/events.jsonl"})

    tampered_buffer = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as source, zipfile.ZipFile(
        tampered_buffer, "w", zipfile.ZIP_DEFLATED
    ) as target:
        for info in source.infolist():
            payload = source.read(info.filename)
            if info.filename == "data/conversations.jsonl":
                payload += b"\n"
            target.writestr(info.filename, payload)
    tampered_archive = tampered_buffer.getvalue()

    nonempty = client.post(
        "/api/system/archive/restore",
        files={"file": ("system.cr", archive_bytes, "application/vnd.chat-reader.archive+zip")},
    )
    assert nonempty.status_code == 409

    override = app.dependency_overrides[get_db]
    generator = override()
    db = next(generator)
    try:
        db.query(ConversationAnnotation).delete(synchronize_session=False)
        db.query(ConversationNotebook).delete(synchronize_session=False)
        db.query(ReadingPosition).delete(synchronize_session=False)
        db.query(MessageVersionAttachment).delete(synchronize_session=False)
        db.query(SourceMessageRef).delete(synchronize_session=False)
        db.query(Heading).delete(synchronize_session=False)
        db.query(SearchDocument).delete(synchronize_session=False)
        db.query(ConversationEvent).delete(synchronize_session=False)
        db.query(RenderBlock).delete(synchronize_session=False)
        db.query(Attachment).delete(synchronize_session=False)
        db.query(MessageVersion).delete(synchronize_session=False)
        db.query(Message).delete(synchronize_session=False)
        db.query(ProjectConversation).delete(synchronize_session=False)
        db.query(Conversation).delete(synchronize_session=False)
        db.query(AssetObject).delete(synchronize_session=False)
        db.query(Project).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()
        generator.close()

    tampered = client.post(
        "/api/system/archive/restore",
        files={"file": ("tampered.cr", tampered_archive, "application/vnd.chat-reader.archive+zip")},
    )
    assert tampered.status_code == 400
    assert "size validation" in tampered.json()["detail"].lower()

    restored = client.post(
        "/api/system/archive/restore",
        files={"file": ("system.cr", archive_bytes, "application/vnd.chat-reader.archive+zip")},
    )
    assert restored.status_code == 200, restored.text
    assert restored.json()["restored"]["conversations"] == 1
    assert restored.json()["restored"]["attachments"] == 3
    assert restored.json()["restored"]["attachment_occurrences"] == 1

    generator = override()
    db = next(generator)
    try:
        restored_conversation = db.get(Conversation, uuid.UUID(conversation_id))
        assert restored_conversation is not None
        restored_message = db.query(Message).filter(Message.conversation_id == restored_conversation.id).one()
        assert db.query(MessageVersion).filter(MessageVersion.message_id == restored_message.id).count() == 2
        assert db.query(RenderBlock).join(MessageVersion).filter(MessageVersion.message_id == restored_message.id).count() > 0
        restored_attachments = db.query(Attachment).filter(Attachment.conversation_id == restored_conversation.id).all()
        assert len(restored_attachments) == 3
        assert all(attachment.scan_status == "scanner_disabled" for attachment in restored_attachments)
        referenced_attachment = next(
            attachment for attachment in restored_attachments
            if attachment.display_name == "evidence.txt"
        )
        unreferenced_attachments = [
            attachment for attachment in restored_attachments
            if attachment.display_name.startswith("round-trip-unreferenced-")
        ]
        assert len(unreferenced_attachments) == 2
        assert all(attachment.status == "available" for attachment in unreferenced_attachments)
        assert all(
            db.query(MessageVersionAttachment)
            .filter(MessageVersionAttachment.attachment_id == attachment.id)
            .count() == 0
            for attachment in unreferenced_attachments
        )
        assert unreferenced_attachments[0].id != unreferenced_attachments[1].id
        assert unreferenced_attachments[0].asset_object_id == unreferenced_attachments[1].asset_object_id
        assert db.query(MessageVersionAttachment).filter(
            MessageVersionAttachment.attachment_id == referenced_attachment.id
        ).count() == 1
        attachment_id = referenced_attachment.id
    finally:
        db.close()
        generator.close()
    content = client.get(f"/api/attachments/{attachment_id}/content")
    assert content.status_code == 200
    assert content.content == b"attachment body\n"
