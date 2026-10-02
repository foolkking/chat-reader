import uuid
from datetime import datetime, timedelta, timezone

from app.core import auth_middleware
from app.models.access import AccountInvitation
from app.models.administration import AdminAuditLog
from app.models.user import User
from app.services.auth import ROOT_ADMIN_USER_ID
from test_auth import auth_client, owner_login  # noqa: F401
from test_admin_system import _normal_user_session


def test_invitation_pages_states_and_secret_free_history(auth_client):
    _, token = _normal_user_session(auth_client)
    auth_client.cookies.set("chat_reader_session", token)
    assert auth_client.get("/api/admin/access/invitations/page").status_code == 404
    assert owner_login(auth_client).status_code == 200
    now = datetime.now(timezone.utc)
    with auth_middleware.SessionLocal() as db:
        for index in range(23):
            db.add(AccountInvitation(created_by_user_id=ROOT_ADMIN_USER_ID, token_digest=f"{index:064x}",
                created_at=now, expires_at=now + timedelta(hours=1)))
        db.add_all([
            AccountInvitation(created_by_user_id=ROOT_ADMIN_USER_ID, token_digest="e" * 64, expires_at=now - timedelta(hours=1)),
            AccountInvitation(created_by_user_id=ROOT_ADMIN_USER_ID, token_digest="f" * 64, expires_at=now - timedelta(hours=1), used_at=now - timedelta(hours=2)),
            AccountInvitation(created_by_user_id=ROOT_ADMIN_USER_ID, token_digest="d" * 64, expires_at=now - timedelta(hours=1), revoked_at=now),
        ])
        db.commit()
    pages = [auth_client.get("/api/admin/access/invitations/page", params={"state": "PENDING", "offset": offset}).json() for offset in (0, 20)]
    assert [len(page["items"]) for page in pages] == [20, 3]
    assert len({row["id"] for page in pages for row in page["items"]}) == 23
    assert all(page["total"] == 23 for page in pages)
    for state in ("USED", "EXPIRED", "REVOKED"):
        page = auth_client.get("/api/admin/access/invitations/page", params={"state": state}).json()
        assert page["total"] == 1 and page["items"][0]["status"] == state
    legacy = auth_client.get("/api/admin/access/invitations")
    assert len(legacy.json()) == 26
    assert "token" not in legacy.text and "invite_url" not in legacy.text
    for params in ({"limit": 101}, {"offset": -1}, {"state": "invalid"}):
        assert auth_client.get("/api/admin/access/invitations/page", params=params).status_code == 422


def test_invitation_revoke_is_durable_idempotent_and_blocks_registration(auth_client):
    assert owner_login(auth_client).status_code == 200
    issued = auth_client.post("/api/admin/access/invitations", json={"expires_in_hours": 1})
    assert issued.status_code == 201
    iid, token = issued.json()["id"], issued.json()["token"]
    for _ in range(2):
        assert auth_client.delete(f"/api/admin/access/invitations/{iid}").status_code == 204
    with auth_middleware.SessionLocal() as db:
        assert db.get(AccountInvitation, uuid.UUID(iid)).revoked_at is not None
        assert db.query(AdminAuditLog).filter_by(action="INVITATION_REVOKED", resource_id=iid).count() == 1
    assert auth_client.put("/api/admin/access/registration", json={"mode": "INVITE_ONLY"}).status_code == 200
    auth_client.cookies.clear()
    result = auth_client.post("/api/auth/register", json={"email": "revoked-invite@example.test", "password": "synthetic invitation passphrase",
        "confirm_password": "synthetic invitation passphrase", "invitation_token": token})
    assert result.status_code == 403
    with auth_middleware.SessionLocal() as db:
        assert db.query(User).filter_by(normalized_email="revoked-invite@example.test").count() == 0


def test_audit_combined_filters_pagination_and_deleted_targets(auth_client):
    target, token = _normal_user_session(auth_client)
    auth_client.cookies.set("chat_reader_session", token)
    assert auth_client.get("/api/admin/audit/page").status_code == 404
    assert auth_client.get("/api/admin/audit/actions").status_code == 404
    assert owner_login(auth_client).status_code == 200
    now = datetime.now(timezone.utc)
    historical = uuid.uuid4()
    with auth_middleware.SessionLocal() as db:
        db.get(User, target).display_name = "Synthetic 10%_reader"
        db.get(User, ROOT_ADMIN_USER_ID).display_name = "Synthetic auditor"
        for index in range(23):
            db.add(AdminAuditLog(actor_user_id=ROOT_ADMIN_USER_ID, target_user_id=target, action="SYNTHETIC_CHECK", result="SUCCESS", created_at=now))
        db.add(AdminAuditLog(actor_user_id=ROOT_ADMIN_USER_ID, target_user_id=historical, action="SYNTHETIC_CHECK", result="FAILURE", created_at=now - timedelta(days=2)))
        db.commit()
    params = {"action": "SYNTHETIC_CHECK", "actor": "auditor", "target": "%_", "result": "SUCCESS",
        "created_after": (now - timedelta(seconds=1)).isoformat(), "created_before": (now + timedelta(seconds=1)).isoformat()}
    pages = [auth_client.get("/api/admin/audit/page", params={**params, "offset": offset}).json() for offset in (0, 20)]
    assert [len(page["items"]) for page in pages] == [20, 3]
    assert len({row["id"] for page in pages for row in page["items"]}) == 23
    assert pages[0]["items"][0]["target_name"] == "Synthetic 10%_reader"
    historical_page = auth_client.get("/api/admin/audit/page", params={"target": str(historical), "result": "FAILURE"}).json()
    assert historical_page["total"] == 1
    assert historical_page["items"][0]["target_email"] is None
    assert auth_client.get("/api/admin/audit/page", params={"target_user_id": str(target), "actor_user_id": str(ROOT_ADMIN_USER_ID)}).json()["total"] == 23
    assert "SYNTHETIC_CHECK" in auth_client.get("/api/admin/audit/actions").json()
    assert len(auth_client.get("/api/admin/audit?action=SYNTHETIC_CHECK").json()) == 24
    for extra in ({"limit": 101}, {"offset": -1}, {"result": "invalid"}, {"created_after": "2026-01-01T00:00"},
                  {"created_after": "2026-10-02T00:00:00Z", "created_before": "2026-10-01T00:00:00Z"}):
        assert auth_client.get("/api/admin/audit/page", params=extra).status_code == 422


def test_supplied_invitation_is_consumed_even_during_open_registration(auth_client):
    assert owner_login(auth_client).status_code == 200
    assert auth_client.put("/api/admin/access/registration", json={"mode": "OPEN"}).status_code == 200
    issued = auth_client.post("/api/admin/access/invitations", json={}).json()
    auth_client.cookies.clear()
    payload = {"email": "open-invite@example.test", "password": "synthetic invitation passphrase",
               "confirm_password": "synthetic invitation passphrase", "invitation_token": issued["token"]}
    assert auth_client.post("/api/auth/register", json=payload).status_code == 201
    auth_client.cookies.clear()
    assert auth_client.post("/api/auth/register", json={**payload, "email": "second-open-invite@example.test"}).status_code == 403
    with auth_middleware.SessionLocal() as db:
        assert db.get(AccountInvitation, uuid.UUID(issued["id"])).used_at is not None
        assert db.query(User).filter_by(normalized_email="second-open-invite@example.test").count() == 0
