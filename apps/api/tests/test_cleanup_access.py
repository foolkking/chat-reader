"""All new review surfaces enforce account ownership, including bulk writes."""
from app.core.config import get_settings
from test_auth import auth_client  # noqa: F401
from test_admin_system import _normal_user_session


def test_learning_and_personal_exceptions_cannot_cross_accounts(auth_client, tmp_path, monkeypatch):
    import uuid
    from app.core import auth_middleware
    from app.services.content_cleanup import process_scan_chunk
    for key in ("IMPORT_STORAGE_DIR", "EXPORT_STORAGE_DIR", "ASSET_STORAGE_DIR", "OFFLINE_STORAGE_DIR"):
        monkeypatch.setenv(key, str(tmp_path / key))
    get_settings.cache_clear()
    try:
        _, token_a = _normal_user_session(auth_client)
        _, token_b = _normal_user_session(auth_client)
        auth_client.cookies.clear()
        auth_client.cookies.set("chat_reader_session", token_a)
        created = auth_client.post("/api/conversations", json={"title": "Synthetic personal exception", "messages": [
            {"role": "user", "content_markdown": "Synthetic question"},
            {"role": "assistant", "content_markdown": "Before cite turn12search4 after."}]}).json()
        scan = auth_client.post("/api/content-cleanup/scans", json={"source": "BATCH", "scope_type": "CURRENT_CONVERSATION", "conversation_ids": [created["conversation"]["id"]]}).json()
        with auth_middleware.SessionLocal() as db:
            while not process_scan_chunk(db, uuid.UUID(scan["id"]))["done"]:
                db.commit()
            db.commit()
        occurrence = auth_client.get(f"/api/content-cleanup/scans/{scan['id']}/occurrences").json()[0]
        prefix = f"/api/content-cleanup/scans/{scan['id']}/occurrences/{occurrence['id']}/exception"
        preview = auth_client.get(prefix).json()
        saved = auth_client.post(prefix, json={"confirmed": True, "preview_token": preview["preview_token"]}).json()
        config = {"name": "Synthetic personal", "match_value": "NOISE"}
        trial = auth_client.post("/api/content-cleanup/rules/trial", json=config).json()
        rule = auth_client.post("/api/content-cleanup/rules/learn", json={**config, "confirmed": True, "preview_token": trial["preview_token"]}).json()
        auth_client.cookies.clear()
        auth_client.cookies.set("chat_reader_session", token_b)
        assert auth_client.get(prefix).status_code == 404
        assert auth_client.post(prefix, json={"confirmed": True, "preview_token": preview["preview_token"]}).status_code == 404
        assert auth_client.get("/api/content-cleanup/exceptions").json()["items"] == []
        assert auth_client.delete(f"/api/content-cleanup/exceptions/{saved['id']}").status_code == 204
        assert auth_client.get(f"/api/content-cleanup/rules/{rule['id']}/revisions").status_code == 404
        assert auth_client.post("/api/content-cleanup/rules/trial", json={**config, "rule_id": rule["id"], "base_revision": 1}).status_code == 404
        assert auth_client.post("/api/content-cleanup/rules/trial", json={**config, "conversation_id": created["conversation"]["id"]}).status_code == 404
        assert auth_client.post("/api/content-cleanup/rules/learn", json={**config, "confirmed": True, "preview_token": trial["preview_token"]}).status_code == 409
        auth_client.cookies.clear()
        auth_client.cookies.set("chat_reader_session", token_a)
        assert auth_client.get("/api/content-cleanup/exceptions").json()["total"] == 1
    finally:
        get_settings.cache_clear()


def test_review_groups_previews_and_bulk_decisions_are_owner_scoped(auth_client, tmp_path, monkeypatch):
    for key in ("IMPORT_STORAGE_DIR", "EXPORT_STORAGE_DIR", "ASSET_STORAGE_DIR", "OFFLINE_STORAGE_DIR"):
        monkeypatch.setenv(key, str(tmp_path / key))
    get_settings.cache_clear()
    try:
        _, author_token = _normal_user_session(auth_client)
        _, other_token = _normal_user_session(auth_client)
        auth_client.cookies.clear()
        auth_client.cookies.set("chat_reader_session", author_token)
        created = auth_client.post("/api/conversations", json={"title": "Synthetic scoped review", "messages": [
            {"role": "user", "content_markdown": "Synthetic question"},
            {"role": "assistant", "content_markdown": "Synthetic cite turn12search4 answer"}]})
        assert created.status_code == 201
        scan = auth_client.post("/api/content-cleanup/scans", json={"source": "BATCH", "scope_type": "CURRENT_CONVERSATION", "conversation_ids": [created.json()["conversation"]["id"]]})
        assert scan.status_code == 202
        prefix = f"/api/content-cleanup/scans/{scan.json()['id']}"
        assert auth_client.get(prefix + "/groups").status_code == 200
        auth_client.cookies.clear()
        auth_client.cookies.set("chat_reader_session", other_token)
        for suffix in ("", "/groups", "/review", "/preview", "/occurrences"):
            assert auth_client.get(prefix + suffix).status_code == 404
        assert auth_client.get(prefix + "/groups", params={"q": "Synthetic"}).status_code == 404
        auth_client.cookies.clear()
        auth_client.cookies.set("chat_reader_session", author_token)
        preview = auth_client.post("/api/imports/preview", files={"files": ("synthetic.json", b'{"metadata":{"powered_by":"ChatGPT Exporter"},"messages":[]}', "application/json")})
        assert preview.status_code == 200
        import_id = preview.json()["import_id"]
        assert auth_client.get("/api/content-cleanup/scans/pending", params={"import_id": import_id}).status_code == 200
        auth_client.cookies.clear()
        auth_client.cookies.set("chat_reader_session", other_token)
        assert auth_client.get("/api/content-cleanup/scans/pending", params={"import_id": import_id}).status_code == 404
        assert auth_client.get(prefix + "/outcome").status_code == 404
        assert auth_client.patch(prefix + "/decisions/filter", json={"decision": "DELETE", "all_matching": True}).status_code == 404
        assert auth_client.post(prefix + "/rescan").status_code == 404
        assert auth_client.post(prefix + "/apply", json={"preview_token": "0" * 64}).status_code == 409
        # The deleted scan must not remove the owner's receipt boundary.
        import uuid
        from app.core import auth_middleware
        from app.services.content_cleanup import process_scan_chunk
        auth_client.cookies.clear()
        auth_client.cookies.set("chat_reader_session", author_token)
        with auth_middleware.SessionLocal() as db:
            while not process_scan_chunk(db, uuid.UUID(scan.json()["id"]))["done"]:
                db.commit()
            db.commit()
        assert auth_client.patch(prefix + "/decisions/filter", json={"decision": "DELETE", "all_matching": True}).status_code == 200
        assert auth_client.post(prefix + "/apply").json()["applied"] == 1
        assert auth_client.get(prefix + "/outcome").json()["status"] == "COMPLETED"
        auth_client.cookies.clear()
        auth_client.cookies.set("chat_reader_session", other_token)
        assert auth_client.get(prefix + "/outcome").status_code == 404
        assert auth_client.post(prefix + "/apply").status_code == 409
    finally:
        get_settings.cache_clear()
