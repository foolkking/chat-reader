"""Actual personal/system rule lifecycle, version access and pinned reviews."""
import uuid

from app.core import auth_middleware
from app.core.config import get_settings
from app.models.content_cleanup import ContentCleanupRuleGrant
from app.services.content_cleanup import process_scan_chunk
from test_auth import auth_client, owner_login  # noqa: F401
from test_admin_system import _normal_user_session


def test_rule_learning_publication_withdrawal_and_personal_isolation(auth_client, tmp_path, monkeypatch):
    for key in ("IMPORT_STORAGE_DIR", "EXPORT_STORAGE_DIR", "ASSET_STORAGE_DIR", "OFFLINE_STORAGE_DIR"):
        monkeypatch.setenv(key, str(tmp_path / key))
    get_settings.cache_clear()
    try:
        account_a, token_a = _normal_user_session(auth_client)
        _, token_b = _normal_user_session(auth_client)
        account_c, token_c = _normal_user_session(auth_client)

        def login(token):
            auth_client.cookies.clear()
            auth_client.cookies.set("chat_reader_session", token)

        def root():
            auth_client.cookies.clear()
            assert owner_login(auth_client).status_code == 200

        def my_rules():
            return [row for row in auth_client.get("/api/content-cleanup/rules").json() if row["kind"] != "BUILTIN"]

        login(token_a)
        created = auth_client.post("/api/content-cleanup/rules", json={"name": "A private name", "match_value": "SYNTHETIC_NOISE"})
        assert created.status_code == 201, created.text
        rule = created.json()
        login(token_b)
        assert my_rules() == []
        assert auth_client.patch(f"/api/content-cleanup/rules/{rule['id']}", json={"status": "DISABLED"}).status_code == 404
        assert auth_client.get("/api/admin/noise-rules").status_code == 404
        root()
        candidates = auth_client.get("/api/admin/noise-rules").json()["items"]
        assert len(candidates) == 1 and candidates[0]["name"] == "Text rule"
        assert "A private name" not in str(candidates)
        admin_revisions = auth_client.get(f"/api/admin/noise-rules/{rule['id']}/revisions").json()
        assert admin_revisions["items"][0]["validated"]
        assert "A private name" not in str(admin_revisions)
        publication = f"/api/admin/noise-rules/{rule['id']}/publication"
        assert auth_client.put(publication, json={"name": "Published noise", "revision_id": rule["revision_id"]}).status_code == 200
        assert auth_client.put(publication, json={"name": "Published noise", "revision_id": rule["revision_id"]}).status_code == 200
        login(token_b)
        assert len(my_rules()) == 1 and not my_rules()[0]["held"] and my_rules()[0]["system_provided"]
        assert auth_client.patch(f"/api/content-cleanup/rules/{rule['id']}", json={"status": "DISABLED", "name": "B label"}).status_code == 200
        login(token_a)
        assert my_rules()[0]["name"] == "A private name" and my_rules()[0]["status"] == "ACTIVE"
        revised = auth_client.patch(f"/api/content-cleanup/rules/{rule['id']}", json={"match_value": "SYNTHETIC_NEW", "base_revision_id": rule["revision_id"]})
        assert revised.status_code == 200, revised.text
        assert revised.json()["revision"] == 2
        login(token_b)
        assert my_rules()[0]["name"] == "B label" and my_rules()[0]["revision"] == 1
        assert len(auth_client.get(f"/api/content-cleanup/rules/{rule['id']}/revisions").json()) == 1
        assert auth_client.patch(f"/api/content-cleanup/rules/{rule['id']}", json={"current_revision_id": revised.json()["revision_id"]}).status_code == 404
        login(token_c)
        created_conversation = auth_client.post("/api/conversations", json={"title": "Synthetic public-rule review", "messages": [
            {"role": "user", "content_markdown": "Synthetic question"}, {"role": "assistant", "content_markdown": "Before SYNTHETIC_NOISE after."}]}).json()
        scan = auth_client.post("/api/content-cleanup/scans", json={"scope_type": "CURRENT_CONVERSATION", "conversation_ids": [created_conversation["conversation"]["id"]]}).json()
        root()
        assert auth_client.delete(publication).status_code == 204
        login(token_b)
        assert my_rules() == []
        # The admitted scan continues after withdrawal. Only successful explicit
        # application grants C the pinned version, not reading the registry.
        with auth_middleware.SessionLocal() as db:
            assert db.get(ContentCleanupRuleGrant, (account_c, uuid.UUID(rule["revision_id"]))) is None
            while not process_scan_chunk(db, uuid.UUID(scan["id"]))["done"]:
                db.commit()
            db.commit()
        login(token_c)
        hits = auth_client.get(f"/api/content-cleanup/scans/{scan['id']}/occurrences").json()
        assert len(hits) == 1 and hits[0]["rule_name"] == "Published noise"
        assert auth_client.patch(f"/api/content-cleanup/scans/{scan['id']}/decisions", json={"decisions": [{"occurrence_id": hits[0]["id"], "decision": "DELETE"}]}).status_code == 200
        assert auth_client.post(f"/api/content-cleanup/scans/{scan['id']}/apply").json()["applied"] == 1
        assert len(my_rules()) == 1 and my_rules()[0]["held"] and not my_rules()[0]["system_provided"]
        assert my_rules()[0]["revision"] == 1
        message = auth_client.get(f"/api/messages/{created_conversation['messages'][1]['id']}").json()
        assert message["current_version"]["display_text"] == "Before  after."
        assert auth_client.delete(f"/api/content-cleanup/rules/{rule['id']}").status_code == 204
        assert my_rules() == []
        relearned = auth_client.post("/api/content-cleanup/rules", json={"name": "C label", "match_value": "SYNTHETIC_NOISE"}).json()
        assert relearned["id"] == rule["id"] and relearned["revision"] == 1
        root()
        assert auth_client.put(publication, json={"name": "Public second revision", "revision_id": revised.json()["revision_id"]}).status_code == 200
        login(token_c)
        assert len(my_rules()) == 1 and my_rules()[0]["name"] == "C label" and my_rules()[0]["revision"] == 1
        assert len(auth_client.get(f"/api/content-cleanup/rules/{rule['id']}/revisions").json()) == 2
        # Selecting a publicly available revision is explicit, but selection alone
        # never acquires it. Withdrawal falls back to the held revision.
        assert auth_client.patch(f"/api/content-cleanup/rules/{rule['id']}", json={"current_revision_id": revised.json()["revision_id"]}).status_code == 200
        assert my_rules()[0]["revision_id"] == revised.json()["revision_id"]
        assert not my_rules()[0]["revision_held"]
        root()
        assert auth_client.put(publication, json={"name": "Wrong revision", "revision_id": str(uuid.uuid4())}).status_code == 404
        assert auth_client.delete(publication).status_code == 204
        login(token_c)
        assert my_rules()[0]["revision_id"] == rule["revision_id"]
        assert auth_client.patch(f"/api/content-cleanup/rules/{rule['id']}", json={"current_revision_id": revised.json()["revision_id"]}).status_code == 404
        login(token_a)
        assert my_rules()[0]["name"] == "A private name" and my_rules()[0]["revision"] == 2
        with auth_middleware.SessionLocal() as db:
            assert db.query(ContentCleanupRuleGrant).filter_by(user_id=account_a).count() == 2
    finally:
        get_settings.cache_clear()


def test_same_text_with_different_boundary_role_or_case_is_not_merged(auth_client):
    _, token = _normal_user_session(auth_client)
    auth_client.cookies.clear()
    auth_client.cookies.set("chat_reader_session", token)
    configs = [{}, {"boundary_mode": "WHOLE_LINE"}, {"role_filter": "assistant"}, {"case_sensitive": False}, {"matcher_mode": "NORMALIZED"}]
    ids = [auth_client.post("/api/content-cleanup/rules", json={"name": "Synthetic identity", "match_value": "SYNTHETIC_NOISE", **config}).json()["id"] for config in configs]
    assert len(set(ids)) == 5
    again = auth_client.post("/api/content-cleanup/rules", json={"name": "Renamed for me", "match_value": "SYNTHETIC_NOISE"}).json()
    assert again["id"] == ids[0]
