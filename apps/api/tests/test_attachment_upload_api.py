import json
import uuid
from pathlib import Path

from app.core.config import get_settings
from app.core.database import get_db
from app.main import app
from app.models.attachment import Attachment, AssetObject, AttachmentUploadItem, MessageVersionAttachment
from app.models.background_job import BackgroundJob
from app.models.message_version import MessageVersion
from test_import_preview_api import client  # noqa: F401


def _conversation_with_message(client) -> tuple[str, dict]:
    preview = client.post(
        "/api/imports/preview",
        files={
            "files": (
                "upload.json",
                json.dumps({
                    "metadata": {"title": "Upload test", "powered_by": "ChatGPT Exporter"},
                    "messages": [{"role": "Prompt", "say": "Attach evidence here."}],
                }).encode(),
                "application/json",
            )
        },
    )
    assert preview.status_code == 200, preview.text
    commit = client.post(f"/api/imports/{preview.json()['import_id']}/commit")
    assert commit.status_code == 200, commit.text
    conversation_id = commit.json()["conversation_ids"][0]
    window = client.get(
        f"/api/conversations/{conversation_id}/message-window",
        params={"limit": 10, "include_blocks": True},
    )
    assert window.status_code == 200, window.text
    return conversation_id, window.json()["items"][0]


def _create_session(client, conversation_id: str, message: dict | None = None) -> dict:
    payload = {}
    if message is not None:
        payload = {
            "target_message_id": message["id"],
            "base_message_version_id": message["current_version"]["id"],
        }
    response = client.post(
        f"/api/conversations/{conversation_id}/attachment-upload-sessions",
        json=payload,
    )
    assert response.status_code == 201, response.text
    return response.json()


def _upload(client, session_id: str, name: str = "evidence.md", body: bytes = b"# Evidence\n\nUpload body.\n") -> dict:
    response = client.post(
        f"/api/attachment-upload-sessions/{session_id}/items",
        files={"file": (name, body, "text/markdown")},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_disabled_scanner_upload_finalize_then_fast_message_save_and_unplaced_file(client, tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("ASSET_STORAGE_DIR", str(tmp_path / "assets"))
    monkeypatch.setenv("ASSET_STORAGE_BACKEND", "local")
    monkeypatch.setenv("ATTACHMENT_SCANNER", "disabled")
    monkeypatch.setenv("ALLOW_UNSCANNED_ATTACHMENTS", "true")
    get_settings.cache_clear()

    capabilities = client.get("/api/capabilities")
    assert capabilities.status_code == 200
    attachment_capabilities = capabilities.json()["attachments"]
    assert attachment_capabilities["scanner_provider"] == "disabled"
    assert attachment_capabilities["scanner_enabled"] is False
    assert attachment_capabilities["allow_unscanned_attachments"] is True
    assert attachment_capabilities["unscanned_status"] == "scanner_disabled"

    conversation_id, message = _conversation_with_message(client)
    session = _create_session(client, conversation_id, message)
    item = _upload(client, session["id"])
    assert item["validation_status"] == "ready"
    assert item["scan_status"] == "scanner_disabled"

    promoted = client.post(
        f"/api/conversations/{conversation_id}/attachments",
        json={"upload_item_ids": [item["id"]]},
    )
    assert promoted.status_code == 201, promoted.text
    attachment_id = promoted.json()["items"][0]["id"]
    updated_text = message["current_version"]["display_text"] + f"\n\n[Attachment](cr-asset://{attachment_id})"
    saved = client.patch(
        f"/api/messages/{message['id']}",
        json={
            "content_markdown": updated_text,
            "base_version_id": message["current_version"]["id"],
        },
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["version_number"] == 2
    saved_text = saved.json()["message"]["current_version"]["display_text"]
    assert "cr-upload://" not in saved_text
    assert "cr-asset://" in saved_text
    assert saved.json()["message_version"]["id"] == saved.json()["current_version_id"]
    assert saved.json()["render_blocks"]
    assert len(saved.json()["attachment_occurrences"]) == 1
    assert saved.json()["conversation_attachment_summary"]["used"] == 1

    attachments = client.get(f"/api/conversations/{conversation_id}/attachments")
    assert attachments.status_code == 200
    used = attachments.json()["items"]
    assert len(used) == 1
    assert used[0]["scan_status"] == "scanner_disabled"
    assert used[0]["is_used"] is True
    assert used[0]["occurrence_count"] == 1

    unplaced_session = _create_session(client, conversation_id)
    unplaced_item = _upload(client, unplaced_session["id"], "later.txt", b"later attachment\n")
    finalized = client.post(
        f"/api/conversations/{conversation_id}/attachments",
        json={"upload_item_ids": [unplaced_item["id"]]},
    )
    assert finalized.status_code == 201, finalized.text
    assert finalized.json()["items"][0]["is_used"] is False
    all_files = client.get(f"/api/conversations/{conversation_id}/attachments").json()["items"]
    assert len(all_files) == 2
    assert sum(item["is_used"] for item in all_files) == 1

    cancel_session = _create_session(client, conversation_id)
    cancel_item = _upload(client, cancel_session["id"], "cancel.txt", b"cancel me")
    cancelled = client.delete(
        f"/api/attachment-upload-sessions/{cancel_session['id']}/items/{cancel_item['id']}"
    )
    assert cancelled.status_code == 204
    assert client.get(f"/api/attachment-upload-sessions/{cancel_session['id']}").json()["items"] == []


def test_upload_rolls_back_when_base_version_is_stale(client, tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("ASSET_STORAGE_DIR", str(tmp_path / "assets"))
    monkeypatch.setenv("ASSET_STORAGE_BACKEND", "local")
    monkeypatch.setenv("ATTACHMENT_SCANNER", "disabled")
    monkeypatch.setenv("ALLOW_UNSCANNED_ATTACHMENTS", "true")
    get_settings.cache_clear()
    conversation_id, message = _conversation_with_message(client)
    stale_session = _create_session(client, conversation_id, message)
    stale_item = _upload(client, stale_session["id"], "stale.txt", b"stale")
    finalized = client.post(
        f"/api/conversations/{conversation_id}/attachments",
        json={"upload_item_ids": [stale_item["id"]]},
    )
    assert finalized.status_code == 201, finalized.text
    attachment_id = finalized.json()["items"][0]["id"]

    concurrent = client.patch(
        f"/api/messages/{message['id']}",
        json={
            "display_text": message["current_version"]["display_text"] + "\n\nConcurrent edit.",
            "base_version_id": message["current_version"]["id"],
        },
    )
    assert concurrent.status_code == 200, concurrent.text
    stale = client.patch(
        f"/api/messages/{message['id']}",
        json={
            "content_markdown": f"[Stale](cr-asset://{attachment_id})",
            "base_version_id": message["current_version"]["id"],
        },
    )
    assert stale.status_code == 409, stale.text

    session_state = client.get(f"/api/attachment-upload-sessions/{stale_session['id']}").json()
    assert session_state["status"] == "committed"
    assert session_state["items"][0]["validation_status"] == "committed"
    attachments = client.get(f"/api/conversations/{conversation_id}/attachments").json()["items"]
    assert len(attachments) == 1
    assert attachments[0]["is_used"] is False

    override = app.dependency_overrides[get_db]
    generator = override()
    db = next(generator)
    try:
        assert db.query(Attachment).filter(Attachment.conversation_id == uuid.UUID(conversation_id)).count() == 1
        assert db.query(MessageVersionAttachment).count() == 0
        item = db.get(AttachmentUploadItem, uuid.UUID(stale_item["id"]))
        assert item is not None and item.validation_status == "committed"
    finally:
        db.close()
        generator.close()


def test_message_save_rejects_unresolved_upload_references_with_line_number(
    client, tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("ASSET_STORAGE_DIR", str(tmp_path / "assets"))
    monkeypatch.setenv("ASSET_STORAGE_BACKEND", "local")
    monkeypatch.setenv("ATTACHMENT_SCANNER", "disabled")
    monkeypatch.setenv("ALLOW_UNSCANNED_ATTACHMENTS", "true")
    get_settings.cache_clear()

    conversation_id, message = _conversation_with_message(client)
    session = _create_session(client, conversation_id, message)
    item = _upload(client, session["id"], "pending.txt", b"pending\n")

    missing_item = client.patch(
        f"/api/messages/{message['id']}",
        json={
            "display_text": f"First line.\n\n[Attachment](cr-upload://{item['id']})",
            "base_version_id": message["current_version"]["id"],
            "upload_item_ids": [],
        },
    )
    assert missing_item.status_code == 422
    assert "Line 3" in missing_item.json()["detail"]

    draft_marker = client.patch(
        f"/api/messages/{message['id']}",
        json={
            "display_text": "First line.\n\n[Uploading](cr-upload://draft-local-token)",
            "base_version_id": message["current_version"]["id"],
            "upload_item_ids": [],
        },
    )
    assert draft_marker.status_code == 422
    assert "Line 3" in draft_marker.json()["detail"]
    assert "invalid attachment upload reference" in draft_marker.json()["detail"]

    session_state = client.get(f"/api/attachment-upload-sessions/{session['id']}").json()
    assert session_state["status"] == "open"
    assert session_state["items"][0]["validation_status"] == "ready"
    assert client.get(f"/api/conversations/{conversation_id}/attachments").json()["items"] == []


def test_message_save_rejects_legacy_implicit_upload_finalize(client, tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("ASSET_STORAGE_DIR", str(tmp_path / "assets"))
    monkeypatch.setenv("ASSET_STORAGE_BACKEND", "local")
    monkeypatch.setenv("ATTACHMENT_SCANNER", "disabled")
    monkeypatch.setenv("ALLOW_UNSCANNED_ATTACHMENTS", "true")
    get_settings.cache_clear()

    conversation_id, message = _conversation_with_message(client)
    session = _create_session(client, conversation_id, message)
    item = _upload(client, session["id"], "legacy.txt", b"legacy upload\n")
    response = client.patch(
        f"/api/messages/{message['id']}",
        json={
            "content_markdown": f"[Attachment](cr-upload://{item['id']})",
            "base_version_id": message["current_version"]["id"],
            "upload_item_ids": [item["id"]],
        },
    )
    assert response.status_code == 409, response.text
    assert "finalized before saving" in response.json()["detail"]
    assert client.get(f"/api/conversations/{conversation_id}/attachments").json()["items"] == []


def test_message_save_occurrence_contract_detach_and_lightweight_rebuild(
    client, tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("ASSET_STORAGE_DIR", str(tmp_path / "assets"))
    monkeypatch.setenv("ASSET_STORAGE_BACKEND", "local")
    monkeypatch.setenv("ATTACHMENT_SCANNER", "disabled")
    monkeypatch.setenv("ALLOW_UNSCANNED_ATTACHMENTS", "true")
    get_settings.cache_clear()

    conversation_id, message = _conversation_with_message(client)
    session = _create_session(client, conversation_id, message)
    item = _upload(client, session["id"], "twice.png", b"not-real-image-bytes")
    promoted = client.post(
        f"/api/conversations/{conversation_id}/attachments",
        json={"upload_item_ids": [item["id"]]},
    )
    assert promoted.status_code == 201, promoted.text
    attachment = promoted.json()["items"][0]
    attachment_id = attachment["id"]
    markdown = (
        f"First\n\n![copy one](cr-asset://{attachment_id})\n\n"
        f"Second\n\n![copy two](cr-asset://{attachment_id})"
    )
    saved = client.patch(
        f"/api/messages/{message['id']}",
        json={
            "content_markdown": markdown,
            "base_version_id": message["current_version"]["id"],
            "attachment_occurrences": [
                {
                    "occurrence_key": "draft-one",
                    "attachment_id": attachment_id,
                    "placement": "inline",
                    "display_order": 0,
                    "alt_text": "copy one",
                },
                {
                    "occurrence_key": "draft-two",
                    "attachment_id": attachment_id,
                    "placement": "inline",
                    "display_order": 1,
                    "alt_text": "copy two",
                },
            ],
        },
    )
    assert saved.status_code == 200, saved.text
    payload = saved.json()
    assert [row["occurrence_key"] for row in payload["attachment_occurrences"]] == ["draft-one", "draft-two"]
    assert payload["conversation_attachment_summary"] == {"total": 1, "used": 1, "missing": 0}

    listed = client.get(f"/api/conversations/{conversation_id}/attachments")
    assert listed.status_code == 200, listed.text
    listed_attachment = listed.json()["items"][0]
    assert listed_attachment["occurrence_count"] == 2
    assert listed_attachment["message_count"] == 1
    assert {row["message_role"] for row in listed_attachment["occurrences"]} == {"user"}
    assert {row["version_number"] for row in listed_attachment["occurrences"]} == {2}
    assert all(row["message_preview"] for row in listed_attachment["occurrences"])

    mismatch = client.patch(
        f"/api/messages/{message['id']}",
        json={
            "content_markdown": markdown + "\n\nMismatch.",
            "base_version_id": payload["current_version_id"],
            "attachment_occurrences": [{
                "occurrence_key": "only-one",
                "attachment_id": attachment_id,
                "placement": "inline",
                "display_order": 0,
            }],
        },
    )
    assert mismatch.status_code == 422, mismatch.text

    kept = client.patch(
        f"/api/messages/{message['id']}",
        json={
            "content_markdown": "References removed, file retained.",
            "base_version_id": payload["current_version_id"],
            "removed_attachment_actions": [{
                "attachment_id": attachment_id,
                "action": "keep_in_conversation",
            }],
        },
    )
    assert kept.status_code == 200, kept.text
    retained = client.get(f"/api/conversations/{conversation_id}/attachments").json()["items"]
    assert len(retained) == 1
    assert retained[0]["is_used"] is False
    assert retained[0]["occurrence_count"] == 2

    detached = client.patch(
        f"/api/messages/{message['id']}",
        json={
            "content_markdown": "References removed, file detached.",
            "base_version_id": kept.json()["current_version_id"],
            "removed_attachment_actions": [{
                "attachment_id": attachment_id,
                "action": "detach_from_conversation",
            }],
        },
    )
    assert detached.status_code == 200, detached.text
    assert client.get(f"/api/conversations/{conversation_id}/attachments").json()["items"] == []
    assert client.get(f"/api/attachments/{attachment_id}/content").status_code == 200

    override = app.dependency_overrides[get_db]
    generator = override()
    db = next(generator)
    try:
        stored = db.get(Attachment, uuid.UUID(attachment_id))
        assert stored is not None and stored.status == "detached" and stored.deleted_at is None
        assert db.query(MessageVersion).filter(MessageVersion.message_id == uuid.UUID(message["id"])).count() == 4
        jobs = db.query(BackgroundJob).filter(BackgroundJob.job_type == "conversation_derived_rebuild").all()
        assert jobs
        assert any(job.payload.get("rebuild_versions") is False for job in jobs)
    finally:
        db.close()
        generator.close()


def test_hard_delete_preserves_asset_object_shared_by_another_conversation(
    client, tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("ASSET_STORAGE_DIR", str(tmp_path / "assets"))
    monkeypatch.setenv("ASSET_STORAGE_BACKEND", "local")
    monkeypatch.setenv("ATTACHMENT_SCANNER", "disabled")
    monkeypatch.setenv("ALLOW_UNSCANNED_ATTACHMENTS", "true")
    get_settings.cache_clear()

    conversation_ids: list[str] = []
    attachment_ids: list[str] = []
    for _ in range(2):
        conversation_id, _message = _conversation_with_message(client)
        session = _create_session(client, conversation_id)
        item = _upload(client, session["id"], "shared.txt", b"same physical bytes\n")
        finalized = client.post(
            f"/api/conversations/{conversation_id}/attachments",
            json={"upload_item_ids": [item["id"]]},
        )
        assert finalized.status_code == 201, finalized.text
        conversation_ids.append(conversation_id)
        attachment_ids.append(finalized.json()["items"][0]["id"])

    override = app.dependency_overrides[get_db]
    generator = override()
    db = next(generator)
    try:
        attachments = db.query(Attachment).filter(Attachment.id.in_([uuid.UUID(item) for item in attachment_ids])).all()
        assert len(attachments) == 2
        assert len({item.asset_object_id for item in attachments}) == 1
        assert db.query(AssetObject).filter(AssetObject.id == attachments[0].asset_object_id).count() == 1
    finally:
        db.close()
        generator.close()

    assert client.delete(f"/api/conversations/{conversation_ids[0]}").status_code == 204
    remaining = client.get(f"/api/attachments/{attachment_ids[1]}/content")
    assert remaining.status_code == 200
    assert remaining.content == b"same physical bytes\n"
