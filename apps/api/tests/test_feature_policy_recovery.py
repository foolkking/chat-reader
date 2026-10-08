"""Policy concurrency contract and real persisted API outcomes."""
from datetime import datetime, timezone
from app.core import auth_middleware
from app.models.administration import AdminAuditLog, InstanceFeaturePolicy
from app.services.feature_policies import feature_policy_revision
from test_auth import auth_client, owner_login  # noqa: F401


def same_policy(actual, expected):
    # SQLite loses timezone metadata; PostgreSQL preserves the UTC offset.
    for value in (actual, expected):
        value["updated_at"] = datetime.fromisoformat(value["updated_at"]).replace(tzinfo=timezone.utc)
    assert actual == expected


def test_stale_policy_rejects_without_reopening_permissions_or_audit(auth_client):
    assert owner_login(auth_client).status_code == 200
    original = auth_client.get("/api/admin/features").json()
    remote = auth_client.put("/api/admin/features", json={"allow_share_links": False, "export_retention_minutes": 8})
    assert remote.status_code == 200
    stale = auth_client.put("/api/admin/features", json={"base_revision": original["revision"], "maximum_merge_message_count": 1200})
    assert stale.status_code == 409
    assert stale.json() == {"detail": "FEATURE_POLICY_CHANGED"}
    same_policy(auth_client.get("/api/admin/features").json(), remote.json())
    with auth_middleware.SessionLocal() as db:
        assert db.query(AdminAuditLog).filter_by(action="GLOBAL_FEATURE_CHANGED").count() == 1
        assert db.get(InstanceFeaturePolicy, 1).allow_share_links is False
    adopted = auth_client.put("/api/admin/features", json={"base_revision": remote.json()["revision"], "maximum_merge_message_count": 1200})
    assert adopted.status_code == 200
    assert adopted.json()["allow_share_links"] is False
    assert adopted.json()["export_retention_minutes"] == 8
    assert adopted.json()["maximum_merge_message_count"] == 1200
    with auth_middleware.SessionLocal() as db:
        rows = db.query(AdminAuditLog).filter_by(action="GLOBAL_FEATURE_CHANGED").all()
        assert len(rows) == 2
        assert any(row.event_metadata["changed_fields"] == ["maximum_merge_message_count"] for row in rows)


def test_default_revision_stable_through_rolled_back_reads_and_noop(auth_client):
    assert owner_login(auth_client).status_code == 200
    first = auth_client.get("/api/admin/features").json()
    second = auth_client.get("/api/admin/features").json()
    assert first["revision"] == second["revision"]
    noop = auth_client.put("/api/admin/features", json={"base_revision": first["revision"]})
    assert noop.status_code == 200 and noop.json()["revision"] == first["revision"]
    with auth_middleware.SessionLocal() as db:
        assert db.query(AdminAuditLog).filter_by(action="GLOBAL_FEATURE_CHANGED").count() == 0
        assert feature_policy_revision(db.get(InstanceFeaturePolicy, 1)) == first["revision"]


def test_legacy_partial_write_and_result_check_do_not_repeat_changes(auth_client):
    assert owner_login(auth_client).status_code == 200
    assert auth_client.put("/api/admin/features", json={"allow_user_import": False, "export_retention_minutes": 9}).status_code == 200
    updated = auth_client.put("/api/admin/features", json={"maximum_merge_message_count": 1400})
    assert updated.status_code == 200
    assert updated.json()["allow_user_import"] is False
    assert updated.json()["export_retention_minutes"] == 9
    for _ in range(2):
        same_policy(auth_client.get("/api/admin/features").json(), updated.json())
    with auth_middleware.SessionLocal() as db:
        assert db.query(AdminAuditLog).filter_by(action="GLOBAL_FEATURE_CHANGED").count() == 2
        assert db.get(InstanceFeaturePolicy, 1).maximum_merge_message_count == 1400


def test_rechecking_then_another_remote_update_conflicts_again(auth_client):
    assert owner_login(auth_client).status_code == 200
    for limit in (1500, 1600):
        base = auth_client.get("/api/admin/features").json()["revision"]
        assert auth_client.put("/api/admin/features", json={"maximum_merge_message_count": limit}).status_code == 200
        result = auth_client.put("/api/admin/features", json={"base_revision": base, "maximum_merge_message_count": 1700})
        assert result.status_code == 409
        assert auth_client.get("/api/admin/features").json()["maximum_merge_message_count"] == limit
