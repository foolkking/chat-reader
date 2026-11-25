"""Merge recovery reuses missing attachments; it never mutates an input."""
import uuid
from datetime import datetime, timezone

import pytest

from app.models.attachment import Attachment, MessageVersionAttachment
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.services.editing.attachment_integrity import audit_conversation_attachment_integrity
from background_job_test_utils import process_queued_jobs
from test_adaptive_import_api import _create
from test_import_analysis_queue import database
from test_import_preview_api import client  # noqa: F401
from test_merge_history_and_cancellation import _commit_messages, _window
from test_merge_html_attachment_api import cards_client, _cards, _snapshot  # noqa: F401
from test_zip_missing_resources import missing_zip


def _merge(client, source_id, peer_id, *, key="synthetic-reference-recovery"):
    payload = {"conversation_ids": [source_id, peer_id], "title": "Synthetic recovered merge"}
    accepted = client.post("/api/conversations/merge", json=payload, headers={"Idempotency-Key": key})
    assert accepted.status_code == 202, accepted.text
    job_id = accepted.json()["job_id"]
    process_queued_jobs(until_job_id=job_id)
    task = client.get(f"/api/tasks/{job_id}").json()
    assert task["status"] == "committed", task
    replay = client.post("/api/conversations/merge", json=payload, headers={"Idempotency-Key": key})
    assert replay.json()["job_id"] == job_id
    assert client.get(f"/api/tasks/{job_id}").json()["result"] == task["result"]
    return task["result"]


def test_merge_keeps_existing_import_missing_resources_without_reimport(cards_client):
    imported = _create(cards_client, [("missing.zip", missing_zip(present=True), "application/zip")])
    saved = cards_client.post(f"/api/imports/{imported['import_id']}/commit")
    assert saved.status_code == 200 and saved.json()["status"] == "committed", saved.text
    source_id = saved.json()["conversation_ids"][0]
    peer_id = _commit_messages(cards_client, "Peer", [{"role": "Prompt", "say": "Synthetic peer"}])
    source_before = _snapshot(source_id)
    result = _merge(cards_client, source_id, peer_id)
    assert result["attachment_recovery"] == {
        "missing_attachments": 2, "repaired_occurrences": 0, "unlocated_occurrences": 0,
    }
    items = cards_client.get(f"/api/conversations/{result['conversation_id']}/attachments").json()["items"]
    assert len(items) == 3
    missing = [item for item in items if item["status"] == "missing"]
    assert len(missing) == 2
    assert all(item["asset_object"] is None and item["content_url"] is None and item["download_url"] is None for item in missing)
    available = next(item for item in items if item["status"] == "available")
    assert cards_client.get(available["content_url"]).content == b"Synthetic available file."
    assert _snapshot(source_id) == source_before


def test_dangling_reference_becomes_missing_target_not_whole_merge_failure(cards_client):
    source_id, _ = _cards(cards_client)
    peer_id = _commit_messages(cards_client, "Peer", [{"role": "Prompt", "say": "Synthetic peer"}])
    with database() as db:
        gone = db.query(Attachment).filter_by(conversation_id=uuid.UUID(source_id)).first()
        gone_id = str(gone.id)
        db.delete(gone)
        db.commit()
    original = _snapshot(source_id)
    result = _merge(cards_client, source_id, peer_id)
    assert result["attachment_recovery"]["missing_attachments"] == 1
    assert result["attachment_recovery"]["repaired_occurrences"] == 1
    target_id = result["conversation_id"]
    items = cards_client.get(f"/api/conversations/{target_id}/attachments").json()["items"]
    missing = next(item for item in items if item["status"] == "missing")
    assert missing["resolution_status"] == "missing" and missing["scan_status"] == "not_available"
    assert missing["asset_object"] is None and len(missing["occurrences"]) == 1
    assert missing["content_url"] is None and missing["download_url"] is None
    body = _window(cards_client, target_id)[1]["current_version"]["display_text"]
    assert gone_id not in body and missing["id"] in body and "Note A" in body and "Note B" in body
    assert _snapshot(source_id) == original
    with database() as db:
        assert not audit_conversation_attachment_integrity(db, uuid.UUID(target_id))


def test_orphaned_occurrence_is_retained_without_fabricating_block_navigation(cards_client):
    source_id, _ = _cards(cards_client)
    peer_id = _commit_messages(cards_client, "Peer", [{"role": "Prompt", "say": "Synthetic peer"}])
    message = _window(cards_client, source_id)[0]
    with database() as db:
        attachment = db.query(Attachment).filter_by(conversation_id=uuid.UUID(source_id)).first()
        db.add(MessageVersionAttachment(
            id=uuid.uuid4(), message_version_id=uuid.UUID(message["current_version"]["id"]),
            attachment_id=attachment.id, occurrence_key="synthetic-orphan",
            block_index=998, alt_text="Retained synthetic label", caption="Retained caption",
            display_order=0, relation_type="file", placement="inline", display_mode="card",
        ))
        db.commit()
    original = _snapshot(source_id)
    result = _merge(cards_client, source_id, peer_id)
    assert result["attachment_recovery"] == {
        "missing_attachments": 0, "repaired_occurrences": 0, "unlocated_occurrences": 1,
    }
    target_id = uuid.UUID(result["conversation_id"])
    with database() as db:
        occurrence = db.query(MessageVersionAttachment).join(
            MessageVersion, MessageVersion.id == MessageVersionAttachment.message_version_id,
        ).join(Message, Message.id == MessageVersion.message_id).filter(
            Message.conversation_id == target_id, MessageVersionAttachment.occurrence_key == "synthetic-orphan",
        ).one()
        assert occurrence.block_index is None
        assert occurrence.alt_text == "Retained synthetic label" and occurrence.caption == "Retained caption"
        assert db.get(Attachment, occurrence.attachment_id).conversation_id == target_id
        assert not audit_conversation_attachment_integrity(db, target_id)
    assert _window(cards_client, str(target_id))[0]["current_version"]["display_text"] == message["current_version"]["display_text"]
    assert _snapshot(source_id) == original


def test_reference_to_unselected_conversation_copies_no_foreign_bytes_or_metadata(cards_client):
    source_id, _ = _cards(cards_client)
    private_id, _ = _cards(cards_client)
    peer_id = _commit_messages(cards_client, "Peer", [{"role": "Prompt", "say": "Synthetic peer"}])
    with database() as db:
        original_attachment = db.query(Attachment).filter_by(conversation_id=uuid.UUID(source_id)).first()
        old_id = str(original_attachment.id)
        foreign = db.query(Attachment).filter_by(conversation_id=uuid.UUID(private_id)).first()
        foreign_id = str(foreign.id)
        foreign.display_name = "Must not copy private metadata"
        # A legacy corrupt occurrence may name an inaccessible object. It is
        # preserved as an unavailable declaration, never looked up by name.
        link = db.query(MessageVersionAttachment).filter_by(attachment_id=original_attachment.id).one()
        link.attachment_id = foreign.id
        db.commit()
    original = _snapshot(source_id)
    private_before = _snapshot(private_id)
    result = _merge(cards_client, source_id, peer_id)
    assert result["attachment_recovery"]["missing_attachments"] == 1
    assert result["attachment_recovery"]["unlocated_occurrences"] == 1
    items = cards_client.get(f"/api/conversations/{result['conversation_id']}/attachments").json()["items"]
    assert all(item["display_name"] != "Must not copy private metadata" for item in items)
    missing = next(item for item in items if item["status"] == "missing")
    assert missing["source_attachment_id"] == foreign_id
    assert missing["asset_object"] is None and missing["content_url"] is None
    available = next(item for item in items if item["source_attachment_id"] == old_id)
    assert available["status"] == "available" and len(available["occurrences"]) == 1
    assert cards_client.get(available["content_url"]).status_code == 200
    assert _snapshot(source_id) == original and _snapshot(private_id) == private_before


@pytest.mark.parametrize("unavailable", ["deleted_object", "rejected_scan", "unresolved"])
def test_merge_does_not_promote_an_owned_unavailable_asset(cards_client, unavailable):
    source_id, _ = _cards(cards_client)
    peer_id = _commit_messages(cards_client, "Peer", [{"role": "Prompt", "say": "Synthetic peer"}])
    with database() as db:
        source_attachment = db.query(Attachment).filter_by(
            conversation_id=uuid.UUID(source_id), original_filename="note-a.txt",
        ).one()
        source_attachment_id = str(source_attachment.id)
        asset = source_attachment.asset_object
        if unavailable == "deleted_object":
            asset.status = "deleted"
            asset.deleted_at = datetime.now(timezone.utc)
            asset.storage_deleted_at = datetime.now(timezone.utc)
        elif unavailable == "rejected_scan":
            asset.scan_status = "infected"
        else:
            source_attachment.resolution_status = "unresolved"
        db.commit()
    original = _snapshot(source_id)
    result = _merge(cards_client, source_id, peer_id)
    assert result["attachment_recovery"]["missing_attachments"] == 1
    assert result["attachment_recovery"]["unlocated_occurrences"] == 0
    items = cards_client.get(f"/api/conversations/{result['conversation_id']}/attachments").json()["items"]
    copied = next(item for item in items if item["source_attachment_id"] == source_attachment_id)
    assert cards_client.get(f"/api/attachments/{copied['id']}/content").status_code >= 400
    assert _snapshot(source_id) == original
