"""Real API regressions: literal examples cannot lock unrelated operations."""
import uuid

import pytest

from app.models.message_version import MessageVersion
from app.models.render_block import RenderBlock
from app.models.attachment import Attachment
from app.services.editing.attachment_integrity import audit_conversation_attachment_integrity
from test_import_preview_api import client  # noqa: F401
from test_merge_history_and_cancellation import (
    _commit_messages, _complete_background_job, _database_session, _window,
)


@pytest.mark.parametrize("operation", ["merge", "split", "cr_restore"])
@pytest.mark.parametrize("with_attachment", [False, True])
def test_copy_operations_preserve_literal_examples_and_rewrite_only_live_references(client, operation, with_attachment):
    conversation_id = _commit_messages(client, "Synthetic reference semantics", [
        {"role": "Prompt", "say": "Synthetic source"},
    ])
    message = _window(client, conversation_id)[0]
    attachment_id = str(uuid.uuid4())
    if with_attachment:
        session = client.post(
            f"/api/conversations/{conversation_id}/attachment-upload-sessions",
            json={"target_message_id": message["id"], "base_message_version_id": message["current_version"]["id"]},
        )
        assert session.status_code == 201, session.text
        item = client.post(f"/api/attachment-upload-sessions/{session.json()['id']}/items",
                           files={"file": ("synthetic.txt", b"synthetic attachment", "text/plain")})
        assert item.status_code == 201, item.text
        promoted = client.post(f"/api/conversations/{conversation_id}/attachments",
                               json={"upload_item_ids": [item.json()["id"]]})
        assert promoted.status_code == 201, promoted.text
        attachment_id = promoted.json()["items"][0]["id"]
    literal = (
        f"Inline `[example](cr-asset://{attachment_id})`.\n\n"
        f"```markdown\n![example](cr-asset://{attachment_id})\n"
        f"[unrelated](cr-asset://{uuid.uuid4()})\n```\n\n"
        f"    [indented](cr-asset://{attachment_id})"
    )
    live = f"\n\n[File][resource]\n\n[resource]: cr-asset://{attachment_id}" if with_attachment else ""
    saved = client.patch(f"/api/messages/{message['id']}", json={
        "content_markdown": literal + live, "base_version_id": message["current_version"]["id"],
    })
    assert saved.status_code == 200, saved.text
    with _database_session() as db:
        issues = audit_conversation_attachment_integrity(db, uuid.UUID(conversation_id))
        assert not [issue for issue in issues if issue.code != "OCCURRENCE_ON_STALE_VERSION"]
    if operation == "merge":
        other_id = _commit_messages(client, "Synthetic peer", [{"role": "Response", "say": "Peer"}])
        queued = client.post("/api/conversations/merge", json={"conversation_ids": [conversation_id, other_id]})
        assert queued.status_code == 202, queued.text
        _complete_background_job(queued.json()["job_id"])
        task = client.get(f"/api/tasks/{queued.json()['job_id']}").json()
        assert task["status"] == "committed", task
        target_id = task["result"]["conversation_id"]
    elif operation == "split":
        copied = client.post(f"/api/conversations/{conversation_id}/split", json={
            "start_message_id": message["id"], "end_message_id": message["id"], "title": "Synthetic copy",
        })
        assert copied.status_code == 200, copied.text
        target_id = copied.json()["conversation_id"]
    else:
        queued = client.post(f"/api/conversations/{conversation_id}/exports", headers={"Idempotency-Key": "synthetic-reference-roundtrip"})
        assert queued.status_code == 202, queued.text
        _complete_background_job(queued.json()["job_id"])
        task = client.get(f"/api/tasks/{queued.json()['job_id']}").json()
        assert task["status"] == "committed", task
        archive = client.get(task["result"]["download_url"])
        assert archive.status_code == 200
        preview = client.post("/api/imports/preview", files={
            "files": ("synthetic.cr", archive.content, "application/vnd.chat-reader.archive+zip"),
        })
        assert preview.status_code == 200, preview.text
        restored = client.post(f"/api/imports/{preview.json()['import_id']}/commit")
        assert restored.status_code == 200, restored.text
        target_id = restored.json()["conversation_ids"][0]
    copied_version = _window(client, target_id)[0]["current_version"]
    target_attachments = client.get(f"/api/conversations/{target_id}/attachments").json()["items"]
    expected = literal
    if with_attachment:
        assert len(target_attachments) == 1
        target_attachment_id = target_attachments[0]["id"]
        assert target_attachment_id != attachment_id
        expected += live.replace(attachment_id, target_attachment_id)
        assert len(target_attachments[0]["occurrences"]) == 1
    else:
        assert target_attachments == []
    assert copied_version["display_text"] == expected
    with _database_session() as db:
        version = db.get(MessageVersion, uuid.UUID(copied_version["id"]))
        code = db.query(RenderBlock).filter_by(message_version_id=version.id, block_type="code").one()
        assert attachment_id in code.data["code"]
        assert not [issue for issue in audit_conversation_attachment_integrity(db, uuid.UUID(target_id))
                    if issue.code != "OCCURRENCE_ON_STALE_VERSION"]
    assert _window(client, conversation_id)[0]["current_version"]["display_text"] == literal + live


@pytest.mark.parametrize("operation", ["split_conversation", "split_message", "merge_messages"])
@pytest.mark.parametrize("foreign", [False, True])
def test_existing_missing_files_survive_explicit_message_transform(client, operation, foreign):
    conversation_id = _commit_messages(client, "Synthetic missing transformations", [
        {"role": "Response", "say": "First section"},
        {"role": "Response", "say": "Second section"},
    ])
    messages = _window(client, conversation_id)
    session = client.post(f"/api/conversations/{conversation_id}/attachment-upload-sessions", json={}).json()
    item = client.post(f"/api/attachment-upload-sessions/{session['id']}/items",
                      files={"file": ("synthetic.txt", b"synthetic", "text/plain")}).json()
    attached = client.post(f"/api/conversations/{conversation_id}/attachments",
                          json={"upload_item_ids": [item["id"]]}).json()["items"][0]
    source = f"Before\n\n[missing](cr-asset://{attached['id']})"
    saved = client.patch(f"/api/messages/{messages[1]['id']}", json={"content_markdown": source})
    assert saved.status_code == 200, saved.text
    other_id = _commit_messages(client, "Synthetic other owner scope", [{"role": "Prompt", "say": "Peer"}]) if foreign else None
    with _database_session() as db:
        attachment = db.get(Attachment, uuid.UUID(attached["id"]))
        attachment.asset_object_id = None
        attachment.status = attachment.resolution_status = "missing"
        attachment.scan_status = "not_available"
        if foreign:
            attachment.conversation_id = uuid.UUID(other_id)
        db.commit()
    if operation == "split_conversation":
        result = client.post(f"/api/conversations/{conversation_id}/split", json={
            "start_message_id": messages[1]["id"], "end_message_id": messages[1]["id"],
        })
    elif operation == "split_message":
        result = client.post(f"/api/messages/{messages[1]['id']}/split", json={"split_offset": len("Before\n\n")})
    else:
        result = client.post("/api/messages/merge", json={"message_ids": [message["id"] for message in messages]})
    if foreign:
        assert result.status_code == 422, result.text
        assert result.json()["detail"]["code"] == "attachment_integrity_invalid"
        unchanged = _window(client, conversation_id)
        assert len(unchanged) == 2 and unchanged[1]["current_version"]["display_text"] == source
        return
    assert result.status_code == 200, result.text
    target_id = result.json()["conversation_id"] if operation == "split_conversation" else conversation_id
    attachment = client.get(f"/api/conversations/{target_id}/attachments").json()["items"][0]
    assert attachment["status"] == "missing"
    assert attachment["content_url"] is None and attachment["asset_object"] is None
    assert attachment["current_occurrence_count"] == 1
    assert sum(occurrence["is_current_version"] for occurrence in attachment["occurrences"]) == 1


def test_message_merge_preserves_indented_code_in_canonical_source(client):
    literal = f"    [literal](cr-asset://{uuid.uuid4()})"
    conversation_id = _commit_messages(client, "Synthetic indentation", [
        {"role": "Response", "say": "First"}, {"role": "Response", "say": "Second"},
    ])
    messages = _window(client, conversation_id)
    saved = client.patch(f"/api/messages/{messages[0]['id']}", json={"content_markdown": literal})
    assert saved.status_code == 200, saved.text
    response = client.post("/api/messages/merge", json={"message_ids": [item["id"] for item in messages]})
    assert response.status_code == 200, response.text
    assert _window(client, conversation_id)[0]["current_version"]["display_text"] == literal + "\n\nSecond"
