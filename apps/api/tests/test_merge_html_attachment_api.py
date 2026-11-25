"""Synthetic reproduction of imported HTML cards; never copy production text."""
import io
import json
import uuid

from PIL import Image
import pytest

from app.core.config import get_settings
from app.models.attachment import Attachment, MessageVersionAttachment
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.render_block import RenderBlock
from app.services.adaptive_import import memory_budget
from app.services.editing.conversation_merge_service import validate_source_attachment_integrity
from background_job_test_utils import process_queued_jobs
from test_adaptive_import_api import _create, _zip_bytes
from test_import_analysis_queue import database
from test_import_preview_api import client  # noqa: F401
from test_merge_history_and_cancellation import _commit_messages, _window


@pytest.fixture(params=[False, True], ids=["legacy-v1", "bounded-v2"])
def cards_client(client, monkeypatch, request):
    monkeypatch.setenv("IMPORT_BOUNDED_ZIP_ENABLED", str(request.param).lower())
    monkeypatch.setattr(memory_budget, "effective_total_memory_bytes", lambda: 640 * 1024**2)
    monkeypatch.setattr(memory_budget, "process_resident_memory_bytes", lambda: 80 * 1024**2)
    get_settings.cache_clear()
    yield client
    get_settings.cache_clear()


def _cards(client):
    image = io.BytesIO()
    Image.new("RGB", (4, 3), (8, 100, 65)).save(image, "PNG")
    assets = {
        "note-a.txt": b"Synthetic first note",
        "note-b.txt": b"Synthetic second note",
        "image-a.png": image.getvalue(),
        "image-b.png": image.getvalue(),
    }
    body = (
        '<div class="card"><a href="assets/note-a.txt">Note A</a></div>\n'
        '<div class="card"><img src="assets/image-a.png" alt="Image A"></div>\n'
        '<div class="card"><a href="assets/note-b.txt">Note B</a></div>\n'
        '<div class="card"><img src="assets/image-b.png" alt="Image B"></div>'
    )
    session = _create(client, [("cards.zip", _zip_bytes({
        "conversation.md": (
            "# Synthetic HTML cards\n\n## User\nRead the cards.\n\n"
            f"## Assistant\n# Card evidence\n\n{body}\n\n## Assistant\nFollowing answer."
        ).encode(),
        "manifest.json": json.dumps({
            "version": "1",
            "assets": [{"path": f"assets/{name}"} for name in assets],
            "messages": [{"id": "u"}, {"id": "a"}, {"id": "b"}],
        }).encode(),
        **{f"assets/{name}": data for name, data in assets.items()},
    }), "application/zip")])
    assert session["state"] == "READY", session
    result = client.post(f"/api/imports/{session['import_id']}/commit")
    assert result.status_code == 200, result.text
    assert result.json()["message_count"] == 3
    return result.json()["conversation_ids"][0], assets


def _snapshot(conversation_id):
    """Compare canonical rows, including historical versions and occurrences."""
    with database() as db:
        messages = db.query(Message).filter_by(conversation_id=uuid.UUID(conversation_id)).all()
        versions = db.query(MessageVersion).filter(
            MessageVersion.message_id.in_([m.id for m in messages]),
        ).all()
        attachments = db.query(Attachment).filter_by(conversation_id=uuid.UUID(conversation_id)).all()
        blocks = db.query(RenderBlock).filter(
            RenderBlock.message_version_id.in_([v.id for v in versions]),
        ).all()
        links = db.query(MessageVersionAttachment).filter(
            MessageVersionAttachment.message_version_id.in_([v.id for v in versions]),
        ).all()
        return json.dumps([
            [{column.key: str(getattr(row, column.key)) for column in row.__mapper__.column_attrs}
             for row in sorted(rows, key=lambda row: str(row.id))]
            for rows in [messages, versions, attachments, blocks, links]
        ], sort_keys=True)


def _assert_graph_and_bytes(client, conversation_id, assets):
    with database() as db:
        messages = db.query(Message).filter_by(
            conversation_id=uuid.UUID(conversation_id), is_deleted=False,
        ).all()
        versions = db.query(MessageVersion).filter(
            MessageVersion.message_id.in_([m.id for m in messages]),
        ).all()
        validate_source_attachment_integrity(
            db, {m.id: m.conversation_id for m in messages}, [v.id for v in versions],
        )
        for message in messages:
            assert message.content_hash == db.get(MessageVersion, message.current_version_id).content_hash
    response = client.get(f"/api/conversations/{conversation_id}/attachments")
    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == 4
    for item in items:
        assert item["occurrences"]
        content = client.get(item["content_url"])
        assert content.status_code == 200
        assert content.content == assets[item["original_filename"].split("/")[-1]]
    return items


def test_imported_html_cards_merge_remaps_all_bindings_without_source_changes(cards_client):
    source_id, assets = _cards(cards_client)
    peer_id = _commit_messages(cards_client, "Synthetic peer", [{"role": "Prompt", "say": "Peer"}])
    original = _snapshot(source_id)
    source_attachments = cards_client.get(f"/api/conversations/{source_id}/attachments").json()["items"]
    with database() as db:
        source_links = db.query(MessageVersionAttachment).filter(
            MessageVersionAttachment.attachment_id.in_([uuid.UUID(a["id"]) for a in source_attachments]),
        ).all()
        assert len(source_links) == 4
        assert len({(link.message_version_id, link.block_index) for link in source_links}) == 1
        block = db.query(RenderBlock).filter_by(
            message_version_id=source_links[0].message_version_id, block_index=source_links[0].block_index,
        ).one()
        assert block.block_type == "paragraph" and not block.sanitized_html
        assert set(block.data) == {"text"}

    payload = {"conversation_ids": [source_id, peer_id], "title": "Synthetic card merge"}
    queued = cards_client.post("/api/conversations/merge", json=payload,
                               headers={"Idempotency-Key": "synthetic-html-merge"})
    assert queued.status_code == 202, queued.text
    process_queued_jobs(until_job_id=queued.json()["job_id"])
    task = cards_client.get(f"/api/tasks/{queued.json()['job_id']}").json()
    assert task["status"] == "committed", task
    assert task["result"]["message_count"] == 4
    target_id = task["result"]["conversation_id"]
    target_attachments = _assert_graph_and_bytes(cards_client, target_id, assets)
    target_projection = json.dumps(_window(cards_client, target_id))
    for source in source_attachments:
        assert source["id"] not in target_projection
    for target in target_attachments:
        assert target["id"] in target_projection
    assert _snapshot(source_id) == original
    replay = cards_client.post("/api/conversations/merge", json=payload,
                               headers={"Idempotency-Key": "synthetic-html-merge"})
    assert replay.status_code == 202 and replay.json()["job_id"] == queued.json()["job_id"]
    with database() as db:
        assert db.query(Conversation).filter_by(source_type="merged").count() == 1


@pytest.mark.parametrize("operation", ["split", "adjacent_merge", "edit"])
def test_html_card_followup_operations_keep_occurrences(cards_client, operation):
    source_id, assets = _cards(cards_client)
    messages = _window(cards_client, source_id)
    card_message = messages[1]
    original = _snapshot(source_id)
    if operation == "split":
        result = cards_client.post(f"/api/conversations/{source_id}/split", json={
            "start_message_id": card_message["id"], "title": "Synthetic card excerpt",
        })
        assert result.status_code == 200, result.text
        target_id = result.json()["conversation_id"]
        assert _snapshot(source_id) == original
    elif operation == "adjacent_merge":
        result = cards_client.post("/api/messages/merge", json={
            "message_ids": [card_message["id"], messages[2]["id"]], "separator": "\n\n",
        })
        assert result.status_code == 200, result.text
        target_id = source_id
    else:
        result = cards_client.patch(f"/api/messages/{card_message['id']}", json={
            "content_markdown": card_message["current_version"]["display_text"] + "\n\nA new synthetic paragraph.",
            "base_version_id": card_message["current_version"]["id"],
        })
        assert result.status_code == 200, result.text
        target_id = source_id
    _assert_graph_and_bytes(cards_client, target_id, assets)


@pytest.mark.parametrize("corruption", ["cross_conversation", "missing_block", "wrong_block"])
def test_html_card_reference_problem_preserves_merge_without_borrowing_files(cards_client, corruption):
    source_id, assets = _cards(cards_client)
    peer_id = _commit_messages(cards_client, "Synthetic peer", [{"role": "Prompt", "say": "Peer"}])
    with database() as db:
        attachment = db.query(Attachment).filter_by(conversation_id=uuid.UUID(source_id)).first()
        affected_id = str(attachment.id)
        link = db.query(MessageVersionAttachment).filter_by(attachment_id=attachment.id).one()
        if corruption == "cross_conversation":
            attachment.conversation_id = uuid.UUID(peer_id)
        elif corruption == "missing_block":
            link.block_index = 999
        else:
            link.block_index = 0  # Real heading, but it does not bind this attachment.
        db.commit()
    original = _snapshot(source_id)
    queued = cards_client.post("/api/conversations/merge", json={"conversation_ids": [source_id, peer_id]})
    assert queued.status_code == 202
    process_queued_jobs(until_job_id=queued.json()["job_id"])
    task = cards_client.get(f"/api/tasks/{queued.json()['job_id']}").json()
    assert task["status"] == "committed", task
    target_id = task["result"]["conversation_id"]
    recovery = task["result"]["attachment_recovery"]
    assert task["result"]["message_count"] == 4
    if corruption == "cross_conversation":
        assert recovery["missing_attachments"] == 1
        items = cards_client.get(f"/api/conversations/{target_id}/attachments").json()["items"]
        missing = [item for item in items if item["status"] == "missing"]
        assert len(missing) == 1
        assert missing[0]["asset_object"] is None and missing[0]["content_url"] is None
        # The other selected source legitimately owns a copy of this file. It
        # must not be used to repair the broken source's reference.
        legitimate = next(item for item in items if item["source_attachment_id"] == affected_id and item["status"] == "available")
        body = _window(cards_client, target_id)[1]["current_version"]["display_text"]
        assert missing[0]["id"] in body and legitimate["id"] not in body and affected_id not in body
    else:
        assert recovery["missing_attachments"] == recovery["unlocated_occurrences"] == 0
        assert recovery["repaired_occurrences"] >= 1
        _assert_graph_and_bytes(cards_client, target_id, assets)
    assert _snapshot(source_id) == original
    with database() as db:
        assert db.query(Conversation).filter_by(source_type="merged").count() == 1


def test_failed_html_merge_retries_original_receipt_once_after_repair(cards_client, monkeypatch):
    import app.services.editing.conversation_merge_service as copying

    source_id, assets = _cards(cards_client)
    peer_id = _commit_messages(cards_client, "Retry peer", [{"role": "Prompt", "say": "Peer"}])
    original = _snapshot(source_id)
    payload = {"conversation_ids": [source_id, peer_id], "title": "Recover the same request"}
    accepted = cards_client.post("/api/conversations/merge", json=payload,
                                 headers={"Idempotency-Key": "synthetic-retry-html-merge"})
    assert accepted.status_code == 202
    job_id = accepted.json()["job_id"]
    validator = copying._validate_attachment_copy

    def old_failure(*_args, **_kwargs):
        raise ValueError("Source attachment occurrence does not match its render block reference.")

    monkeypatch.setattr(copying, "_validate_attachment_copy", old_failure)
    process_queued_jobs(until_job_id=job_id)
    assert cards_client.get(f"/api/tasks/{job_id}").json()["status"] == "failed"
    assert _snapshot(source_id) == original
    with database() as db:
        assert db.query(Conversation).filter_by(source_type="merged").count() == 0
    monkeypatch.setattr(copying, "_validate_attachment_copy", validator)
    for _ in range(2):
        retry = cards_client.post(f"/api/tasks/{job_id}/retry")
        assert retry.status_code == 200 and retry.json()["job_id"] == job_id
    process_queued_jobs(until_job_id=job_id)
    completed = cards_client.get(f"/api/tasks/{job_id}").json()
    assert completed["status"] == "committed"
    assert completed["result"]["message_count"] == 4
    _assert_graph_and_bytes(cards_client, completed["result"]["conversation_id"], assets)
    assert _snapshot(source_id) == original
    replay = cards_client.post("/api/conversations/merge", json=payload,
                               headers={"Idempotency-Key": "synthetic-retry-html-merge"})
    assert replay.json()["job_id"] == job_id
    assert not process_queued_jobs()
    with database() as db:
        assert db.query(Conversation).filter_by(source_type="merged").count() == 1


@pytest.mark.parametrize("identity", ["foreign", "nonexistent", "invalid"])
def test_html_source_edit_cannot_grant_attachment_access(cards_client, identity):
    source_id, _assets = _cards(cards_client)
    target_id = _commit_messages(cards_client, "Private target", [{"role": "Prompt", "say": "Untouched"}])
    attachment = cards_client.get(f"/api/conversations/{source_id}/attachments").json()["items"][0]
    attachment_id = attachment["id"] if identity == "foreign" else str(uuid.uuid4()) if identity == "nonexistent" else "not-a-uuid"
    message = _window(cards_client, target_id)[0]
    original = _snapshot(target_id)
    result = cards_client.patch(f"/api/messages/{message['id']}", json={
        "content_markdown": f'<div><a href="cr-asset://{attachment_id}">Private file</a></div>',
        "base_version_id": message["current_version"]["id"],
    })
    assert result.status_code == 422, result.text
    assert _snapshot(target_id) == original


@pytest.mark.parametrize("opening,closing", [("<pre>", "</pre>"), ("<code>", "</code>"), ("<!--", "-->")])
def test_merge_keeps_cross_paragraph_html_literals_with_same_live_identity(cards_client, opening, closing):
    source_id, _assets = _cards(cards_client)
    peer_id = _commit_messages(cards_client, "Literal peer", [{"role": "Prompt", "say": "Peer"}])
    message = _window(cards_client, source_id)[1]
    attachment = cards_client.get(f"/api/conversations/{source_id}/attachments").json()["items"][0]
    identity = attachment["id"]
    tag = f'<a href="cr-asset://{identity}">The same source bytes</a>'
    literal = f"{opening}\n\n{tag}\n\n{closing}"
    source = literal + "\n\n" + tag
    edited = cards_client.patch(f"/api/messages/{message['id']}", json={
        "content_markdown": source, "base_version_id": message["current_version"]["id"],
    })
    assert edited.status_code == 200, edited.text
    assert len(edited.json()["attachment_occurrences"]) == 1
    original = _snapshot(source_id)
    queued = cards_client.post("/api/conversations/merge", json={"conversation_ids": [source_id, peer_id]})
    assert queued.status_code == 202
    process_queued_jobs(until_job_id=queued.json()["job_id"])
    task = cards_client.get(f"/api/tasks/{queued.json()['job_id']}").json()
    assert task["status"] == "committed", task
    target_id = task["result"]["conversation_id"]
    merged = next(row for row in _window(cards_client, target_id) if "The same source bytes" in row["current_version"]["display_text"])
    mapped = cards_client.get(f"/api/conversations/{target_id}/attachments").json()["items"]
    mapped_identity = next(a["id"] for a in mapped if a["source_attachment_id"] == identity)
    expected = literal + "\n\n" + tag.replace(identity, mapped_identity)
    assert merged["current_version"]["display_text"] == expected
    literal_blocks = [b for b in merged["current_version"]["blocks"] if b["plain_text"] == tag]
    mapped_blocks = [b for b in merged["current_version"]["blocks"] if b["plain_text"] == tag.replace(identity, mapped_identity)]
    assert len(literal_blocks) == len(mapped_blocks) == 1
    assert literal_blocks[0]["data"]["text"] == tag
    assert mapped_blocks[0]["data"]["text"] == tag.replace(identity, mapped_identity)
    assert _snapshot(source_id) == original
