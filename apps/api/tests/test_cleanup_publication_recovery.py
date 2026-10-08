"""Publication recovery compares public state, independently of personal grants."""
import pytest

from test_auth import auth_client, owner_login  # noqa: F401


def setup_rule(client):
    assert owner_login(client).status_code == 200
    response = client.post("/api/content-cleanup/rules", json={"name": "Synthetic private", "match_value": "SYNTHETIC_PUBLICATION"})
    assert response.status_code == 201
    rule = response.json()
    path = f"/api/admin/noise-rules/{rule['id']}"
    assert client.put(path + "/publication", json={"revision_id": rule["revision_id"], "name": "Synthetic original"}).status_code == 200
    state = next(item for item in client.get("/api/admin/noise-rules").json()["items"] if item["id"] == rule["id"])
    return rule, path, state


@pytest.mark.parametrize("action", ["publish", "withdraw"])
def test_stale_publication_cannot_replace_newer_name(auth_client, action):
    rule, path, before = setup_rule(auth_client)
    base = before.get("publication_token", "0" * 64)
    assert auth_client.put(path + "/publication", json={"revision_id": rule["revision_id"], "name": "Synthetic newer", "base_publication_token": base}).status_code == 200
    if action == "publish":
        result = auth_client.put(path + "/publication", json={"revision_id": rule["revision_id"], "name": "Synthetic stale", "base_publication_token": base})
    else:
        result = auth_client.request("DELETE", path + "/publication", json={"base_publication_token": base})
    assert result.status_code == 409, "An old administrator window must not overwrite or withdraw newer publication"
    saved = next(item for item in auth_client.get("/api/admin/noise-rules").json()["items"] if item["id"] == rule["id"])
    assert saved["name"] == "Synthetic newer" and saved["published_revision_id"] == rule["revision_id"]


def test_reads_and_acknowledgements_agree_and_legacy_withdraw_is_preserved(auth_client):
    rule, path, before = setup_rule(auth_client)
    assert auth_client.get(path).json() == before
    assert before["published_revision"] == 1
    saved = auth_client.put(path + "/publication", json={"revision_id": rule["revision_id"], "name": "Synthetic revised", "base_publication_token": before["publication_token"]})
    assert saved.status_code == 200 and saved.json()["published"]
    current = saved.json()["rule"]
    assert current == auth_client.get(path).json()
    assert current["publication_token"] != before["publication_token"]
    removed = auth_client.request("DELETE", path + "/publication?return_state=true", json={"base_publication_token": current["publication_token"]})
    assert removed.status_code == 200
    assert removed.json() == auth_client.get(path).json()
    assert removed.json()["published_revision_id"] is None and removed.json()["published_revision"] is None
    repeated = auth_client.request("DELETE", path + "/publication?return_state=true", json={"base_publication_token": removed.json()["publication_token"]})
    assert repeated.status_code == 200 and repeated.json() == removed.json()
    assert auth_client.delete(path + "/publication").status_code == 204


def test_same_values_after_withdraw_and_republish_still_conflict(auth_client):
    rule, path, before = setup_rule(auth_client)
    assert auth_client.delete(path + "/publication").status_code == 204
    assert auth_client.put(path + "/publication", json={"revision_id": rule["revision_id"], "name": before["name"]}).status_code == 200
    assert auth_client.request("DELETE", path + "/publication", json={"base_publication_token": before["publication_token"]}).status_code == 409
    assert auth_client.get(path).json()["published_revision_id"] == rule["revision_id"]


def test_private_edit_does_not_change_publication_base(auth_client):
    rule, path, before = setup_rule(auth_client)
    assert auth_client.patch(f"/api/content-cleanup/rules/{rule['id']}", json={"name": "Synthetic private rename", "match_value": "SYNTHETIC_REPAIRED"}).status_code == 200
    current = auth_client.get(path).json()
    assert current["publication_token"] == before["publication_token"] and current["revision_count"] == 2
    assert current["published_revision_id"] == rule["revision_id"]


def test_publication_state_and_actions_are_root_only(auth_client):
    from test_admin_system import _normal_user_session
    rule, path, before = setup_rule(auth_client)
    _, token = _normal_user_session(auth_client)
    auth_client.cookies.clear(); auth_client.cookies.set("chat_reader_session", token)
    assert auth_client.get(path).status_code == 404
    assert auth_client.put(path + "/publication", json={"revision_id": rule["revision_id"], "name": "Synthetic denied", "base_publication_token": before["publication_token"]}).status_code == 404
    assert auth_client.request("DELETE", path + "/publication?return_state=true", json={"base_publication_token": before["publication_token"]}).status_code == 404


@pytest.mark.parametrize("action", ["publish", "withdraw"])
def test_audit_and_publication_commit_together(auth_client, monkeypatch, action):
    from app.api.routes import admin_noise_rules
    rule, path, before = setup_rule(auth_client)
    def fail_audit(*args, **kwargs):
        raise RuntimeError("Synthetic audit failure")
    with monkeypatch.context() as patch:
        patch.setattr(admin_noise_rules, "record_admin_audit", fail_audit)
        if action == "publish":
            response = auth_client.put(path + "/publication", json={"revision_id": rule["revision_id"], "name": "Synthetic uncommitted", "base_publication_token": before["publication_token"]})
        else:
            response = auth_client.request("DELETE", path + "/publication?return_state=true", json={"base_publication_token": before["publication_token"]})
        assert response.status_code == 500
    assert auth_client.get(path).json() == before


def test_read_only_checks_and_rejected_writes_do_not_add_success_audits(auth_client):
    from app.core import auth_middleware
    from app.models.administration import AdminAuditLog
    rule, path, before = setup_rule(auth_client)
    with auth_middleware.SessionLocal() as db:
        count = db.query(AdminAuditLog).filter_by(resource_type="NOISE_RULE").count()
    for _ in range(3):
        assert auth_client.get(path).json() == before
    assert auth_client.put(path + "/publication", json={"revision_id": rule["revision_id"], "name": "Synthetic rejected", "base_publication_token": "0" * 64}).status_code == 409
    assert auth_client.request("DELETE", path + "/publication", json={"base_publication_token": "bad"}).status_code == 422
    with auth_middleware.SessionLocal() as db:
        assert db.query(AdminAuditLog).filter_by(resource_type="NOISE_RULE").count() == count
