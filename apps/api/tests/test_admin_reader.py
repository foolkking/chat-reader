import uuid

from app.core import auth_middleware
from app.models.administration import AdminAuditLog
from app.models.attachment import AssetObject, MessageVersionAttachment
from app.models.render_block import RenderBlock
from test_auth import auth_client, owner_login  # noqa: F401
from test_admin_system import _normal_user_session, _attachment


def test_admin_turn_search_attachment_scope_and_audit(auth_client):
    uid, token = _normal_user_session(auth_client)
    other, _ = _normal_user_session(auth_client)
    auth_client.cookies.set("chat_reader_session", token)
    created = auth_client.post("/api/conversations", json={"title": "Synthetic %_ title", "messages": [
        {"role": "user", "content_markdown": "Synthetic first question"},
        {"role": "assistant", "content_markdown": "Synthetic first answer"},
    ]})
    assert created.status_code == 201
    value = created.json(); cid = value["conversation"]["id"]
    first, second = value["messages"]
    inserted = auth_client.post(f"/api/conversations/{cid}/messages/insert", json={
        "anchor_message_id": second["id"], "position": "after", "mode": "pair", "messages": [
            {"role": "user", "content_markdown": "Synthetic searchable 10%_ question"},
            {"role": "assistant", "content_markdown": "Synthetic searchable 10%_ answer"},
        ]})
    assert inserted.status_code == 201
    target = inserted.json()["messages"][0]["id"]
    _drain_derived()
    with auth_middleware.SessionLocal() as db:
        asset = AssetObject(sha256="c" * 64, byte_size=1, detected_mime_type="text/plain", storage_key="objects/synthetic", storage_backend="local", status="available", scan_status="clean")
        db.add(asset); db.flush()
        attachment = _attachment(uuid.UUID(cid), asset.id, "synthetic-admin-file")
        db.add(attachment); db.flush()
        block = db.query(RenderBlock).filter_by(message_version_id=uuid.UUID(second["current_version"]["id"])).first()
        db.add(MessageVersionAttachment(message_version_id=block.message_version_id, attachment_id=attachment.id, block_index=block.block_index))
        aid = str(attachment.id)
        db.commit()
    base = f"/api/admin/content/users/{uid}/conversations/{cid}"
    assert auth_client.get(base).status_code == 404
    assert auth_client.get(f"{base}/search?q=Synthetic").status_code == 404
    assert owner_login(auth_client).status_code == 200
    assert auth_client.get(f"/api/conversations/{cid}").status_code == 404
    read = auth_client.get(f"{base}/reader-turn").json()
    assert [item["id"] for item in read["items"]] == [first["id"], second["id"]]
    assert read["next_anchor_message_id"] == target and read["total_messages"] == 4
    embedded = read["items"][1]["render_blocks"][0]["data"]["attachment"]
    assert embedded["content_url"].startswith(f"/api/admin/content/users/{uid}/attachments/{aid}")
    assert auth_client.get(f"/api/admin/content/users/{other}/attachments/{aid}").status_code == 404
    assert auth_client.get(f"/api/admin/content/users/{other}/conversations/{cid}/reader-turn").status_code == 404
    next_turn = auth_client.get(f"{base}/reader-turn", params={"anchor_message_id": target}).json()
    assert len(next_turn["items"]) == 2 and next_turn["previous_anchor_message_id"] == first["id"]
    search = auth_client.get(f"{base}/search", params={"q": "%_", "limit": 1}).json()
    assert search["total"] == 2 and search["items"][0]["message_id"] == target
    assert auth_client.get(f"{base}/search", params={"q": "%_", "offset": 1, "limit": 1}).json()["items"][0]["message_id"] != target
    assert auth_client.get(f"/api/admin/content/users/{uid}/conversations", params={"q": "%_"}).json()["total"] == 1
    assert auth_client.get(f"/api/admin/content/users/{uid}/attachments").json()["total"] == 1
    with auth_middleware.SessionLocal() as db:
        actions = {row.action for row in db.query(AdminAuditLog).filter_by(target_user_id=uid).all()}
        assert {"VIEW_USER_CONVERSATION", "SEARCH_USER_CONVERSATION", "LIST_USER_CONVERSATIONS", "LIST_USER_ATTACHMENTS"} <= actions
        assert all(not row.event_metadata for row in db.query(AdminAuditLog).filter_by(target_user_id=uid))

    auth_client.cookies.clear()
    auth_client.cookies.set("chat_reader_session", token)
    assert auth_client.delete(f"/api/messages/{target}").status_code == 200
    _drain_derived()
    assert owner_login(auth_client).status_code == 200
    assert auth_client.get(f"{base}/search", params={"q": "%_"}).json()["total"] == 1
    auth_client.cookies.clear()
    auth_client.cookies.set("chat_reader_session", token)
    assert auth_client.post(f"/api/messages/{target}/restore").status_code == 200
    _drain_derived()
    assert owner_login(auth_client).status_code == 200
    assert auth_client.get(f"{base}/search", params={"q": "%_"}).json()["total"] == 2


def _drain_derived():
    from app.services.background_jobs import claim_next_job, process_background_job
    from app.models.background_job import BackgroundJob
    with auth_middleware.SessionLocal() as db:
        job_id = claim_next_job(db, job_type="conversation_derived_rebuild")
        assert job_id is not None
        db.commit()
    process_background_job(job_id, session_factory=auth_middleware.SessionLocal)
    with auth_middleware.SessionLocal() as db:
        assert db.get(BackgroundJob, job_id).status == "committed"
