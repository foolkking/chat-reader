"""Synthetic end-to-end transaction boundaries; never replay user sources."""
import uuid
from pathlib import Path

import pytest

from app.core.config import get_settings
from app.core.database import get_db
from app.main import app
from app.models.attachment import Attachment, AssetObject, AttachmentUploadItem, MessageVersionAttachment
from test_import_preview_api import client  # noqa: F401
from test_attachment_upload_api import _conversation_with_message, _create_session, _upload
from test_attachment_reference_contract import CASES


@pytest.fixture(autouse=True)
def local_assets(monkeypatch):
    monkeypatch.setenv("ASSET_STORAGE_BACKEND", "local")
    monkeypatch.setenv("ATTACHMENT_SCANNER", "disabled")
    monkeypatch.setenv("ALLOW_UNSCANNED_ATTACHMENTS", "true")
    get_settings.cache_clear()


def session():
    return app.dependency_overrides[get_db]()


def uploaded(client):
    conversation, message = _conversation_with_message(client)
    item = _upload(client, _create_session(client, conversation)["id"])
    return conversation, message, item


def test_response_failure_cannot_delete_committed_attachment(client, monkeypatch):
    conversation, _, item = uploaded(client)
    import app.api.routes.attachments as routes
    original = routes.attachment_read
    monkeypatch.setattr(routes, "attachment_read", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("synthetic response")))
    result = client.post(f"/api/conversations/{conversation}/attachments", json={"upload_item_ids": [item["id"]]})
    assert result.status_code == 500
    monkeypatch.setattr(routes, "attachment_read", original)
    gen = session()
    db = next(gen)
    try:
        attachment = db.query(Attachment).filter_by(source_attachment_id=item["id"]).one()
        asset = db.get(AssetObject, attachment.asset_object_id)
        assert (Path(get_settings().asset_storage_dir) / asset.storage_key).is_file()
    finally:
        gen.close()
    replay = client.post(f"/api/conversations/{conversation}/attachments", json={"upload_item_ids": [item["id"]]})
    assert replay.status_code == 201
    assert len(replay.json()["items"]) == 1


def test_failed_finalize_retains_same_item_bytes_for_retry(client, monkeypatch):
    conversation, _, item = uploaded(client)
    import app.services.assets.image_geometry as geometry
    original = geometry.ingested_geometry
    monkeypatch.setattr(geometry, "ingested_geometry", lambda *a: (_ for _ in ()).throw(RuntimeError("synthetic prepare")))
    result = client.post(f"/api/conversations/{conversation}/attachments", json={"upload_item_ids": [item["id"]]})
    assert result.status_code == 500
    monkeypatch.setattr(geometry, "ingested_geometry", original)
    gen = session()
    db = next(gen)
    try:
        row = db.get(AttachmentUploadItem, uuid.UUID(item["id"]))
        assert row.validation_status == "ready"
        assert (Path(get_settings().asset_storage_dir) / row.temporary_storage_key).is_file()
    finally:
        gen.close()
    assert client.post(f"/api/conversations/{conversation}/attachments", json={"upload_item_ids": [item["id"]]}).status_code == 201


def test_edit_retains_known_missing_reference_but_does_not_authorize_new_missing_bind(client):
    conversation, message, item = uploaded(client)
    attachment = client.post(f"/api/conversations/{conversation}/attachments", json={"upload_item_ids": [item["id"]]}).json()["items"][0]
    aid = attachment["id"]
    first = client.patch(f"/api/messages/{message['id']}", json={
        "content_markdown": f"[one](cr-asset://{aid})\n\n[two](cr-asset://{aid})",
        "base_version_id": message["current_version"]["id"],
    })
    assert first.status_code == 200
    gen = session()
    db = next(gen)
    try:
        row = db.get(Attachment, uuid.UUID(aid))
        row.asset_object_id = None
        row.status = row.resolution_status = "missing"
        db.commit()
    finally:
        gen.close()
    second = client.patch(f"/api/messages/{message['id']}", json={
        "content_markdown": f"Retained prose [two](cr-asset://{aid}).",
        "base_version_id": first.json()["current_version_id"],
    })
    assert second.status_code == 200, second.text
    assert len(second.json()["attachment_occurrences"]) == 1
    expanded = client.patch(f"/api/messages/{message['id']}", json={
        "content_markdown": f"[one](cr-asset://{aid}) [extra](cr-asset://{aid})",
        "base_version_id": second.json()["current_version_id"],
    })
    assert expanded.status_code == 422
    _, other = _conversation_with_message(client)
    assert client.patch(f"/api/messages/{other['id']}", json={
        "content_markdown": f"[foreign](cr-asset://{aid})",
    }).status_code == 422


def test_inline_code_is_not_an_attachment_occurrence(client):
    _, message, _ = uploaded(client)
    result = client.patch(f"/api/messages/{message['id']}", json={
        "content_markdown": "Example `[file](cr-asset://11111111-1111-4111-8111-111111111111)` only.",
        "base_version_id": message["current_version"]["id"],
    })
    assert result.status_code == 200, result.text
    assert result.json()["attachment_occurrences"] == []


def test_replace_current_requires_content_baseline_and_rejects_stale_writer(client):
    _, message, _ = uploaded(client)
    first = client.patch(f"/api/messages/{message['id']}", json={"content_markdown": "Synthetic v2"})
    assert first.status_code == 200
    base = first.json()["message_version"]
    payload = {"base_version_id": base["id"], "base_content_hash": base["source_content_hash"], "save_mode": "replace_current"}
    assert client.patch(f"/api/messages/{message['id']}", json={**payload, "content_markdown": "Writer A"}).status_code == 200
    assert client.patch(f"/api/messages/{message['id']}", json={**payload, "content_markdown": "Stale writer B"}).status_code == 409


def test_save_request_replay_and_read_only_receipt(client):
    _, message, _ = uploaded(client)
    operation = str(uuid.uuid4())
    payload = {"content_markdown": "Synthetic receipt", "base_version_id": message["current_version"]["id"],
               "operation_id": operation}
    endpoint = f"/api/messages/{message['id']}"
    first = client.patch(endpoint, json=payload)
    assert first.status_code == 200
    replay = client.patch(endpoint, json=payload)
    assert replay.status_code == 200, replay.text
    assert replay.json()["current_version_id"] == first.json()["current_version_id"]
    receipt = client.get(f"{endpoint}/save-requests/{operation}")
    assert receipt.status_code == 200
    assert receipt.json()["current_version_id"] == first.json()["current_version_id"]
    assert client.patch(endpoint, json={**payload, "content_markdown": "Different intent"}).status_code == 409


def test_whitespace_source_change_cannot_be_overwritten(client):
    _, message, _ = uploaded(client)
    endpoint = f"/api/messages/{message['id']}"
    base = client.patch(endpoint, json={"content_markdown": "Synthetic v2"}).json()["message_version"]
    precondition = {"base_version_id": base["id"], "base_content_hash": base["source_content_hash"], "save_mode": "replace_current"}
    changed = client.patch(endpoint, json={**precondition, "content_markdown": "Synthetic v2  \n"})
    assert changed.status_code == 200
    assert changed.json()["message_version"]["content_hash"] == base["content_hash"]
    assert client.patch(endpoint, json={**precondition, "content_markdown": "Stale edit"}).status_code == 409
    assert client.patch(endpoint, json={"save_mode": "replace_current", "content_markdown": "Old client"}).status_code == 409


def test_committed_save_survives_response_failure_and_later_version(client, monkeypatch):
    _, message, _ = uploaded(client)
    import app.api.routes.messages as routes
    endpoint, operation = f"/api/messages/{message['id']}", str(uuid.uuid4())
    original = routes._edit_response
    monkeypatch.setattr(routes, "_edit_response", lambda **kwargs: (_ for _ in ()).throw(RuntimeError("synthetic response")))
    payload = {"operation_id": operation, "content_markdown": "Receipt snapshot"}
    assert client.patch(endpoint, json=payload).status_code == 500
    monkeypatch.setattr(routes, "_edit_response", original)
    receipt = client.get(f"{endpoint}/save-requests/{operation}").json()
    assert receipt["status"] == "confirmed"
    assert client.patch(endpoint, json={"content_markdown": "Later snapshot"}).status_code == 200
    replay = client.patch(endpoint, json=payload).json()
    assert replay == receipt
    assert client.get(endpoint).json()["current_version"]["display_text"] == "Later snapshot"


def test_upload_request_identity_survives_lost_response_and_rejects_new_file(client):
    conversation, _ = _conversation_with_message(client)
    sid, iid = str(uuid.uuid4()), str(uuid.uuid4())
    endpoint = f"/api/conversations/{conversation}/attachment-upload-sessions"
    assert client.post(endpoint, json={"request_id": sid}).json()["id"] == sid
    assert client.post(endpoint, json={"request_id": sid}).json()["id"] == sid
    item_url = f"/api/attachment-upload-sessions/{sid}/items?request_id={iid}"
    files = {"file": ("synthetic.txt", b"synthetic payload", "text/plain")}
    assert client.post(item_url, files=files).json()["id"] == iid
    assert client.post(item_url, files=files).json()["id"] == iid
    assert client.post(item_url, files={"file": ("synthetic.txt", b"changed", "text/plain")}).status_code == 409
    assert len(client.get(f"/api/attachment-upload-sessions/{sid}").json()["items"]) == 1


def test_cleanup_failure_does_not_turn_success_into_failure(client, monkeypatch):
    from app.services.assets.asset_store import LocalAssetStore
    conversation, _, item = uploaded(client)
    original = LocalAssetStore.delete_key
    def refuse_staging(self, key):
        if key.startswith("quarantine/"):
            raise OSError("synthetic cleanup")
        return original(self, key)
    monkeypatch.setattr(LocalAssetStore, "delete_key", refuse_staging)
    response = client.post(f"/api/conversations/{conversation}/attachments", json={"upload_item_ids": [item["id"]]})
    assert response.status_code == 201
    assert response.json()["items"][0]["status"] == "available"


@pytest.mark.parametrize("fixture", [case for case in CASES if case.get("scheme", "cr-asset") == "cr-asset"],
                         ids=lambda case: case["name"])
def test_reference_grammar_reaches_real_api_occurrences(client, fixture):
    conversation, message, item = uploaded(client)
    attachment = client.post(f"/api/conversations/{conversation}/attachments", json={"upload_item_ids": [item["id"]]}).json()["items"][0]
    source = fixture["source"].replace("11111111-1111-4111-8111-111111111111", attachment["id"])
    response = client.patch(f"/api/messages/{message['id']}", json={"content_markdown": source})
    assert response.status_code == 200, response.text
    assert len(response.json()["attachment_occurrences"]) == fixture["count"]
    assert response.json()["message_version"]["display_text"] == source


def test_unavailable_attachment_error_points_to_real_reference_not_earlier_example(client):
    _, message = _conversation_with_message(client)
    identity = str(uuid.uuid4())
    source = f"`[example](cr-asset://{identity})`\n\n[real](cr-asset://{identity})"
    response = client.patch(f"/api/messages/{message['id']}", json={"content_markdown": source})
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "attachment_unavailable"
    assert response.json()["detail"]["line_number"] == 3
