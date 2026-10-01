import uuid

from test_admin_system import _normal_user_session
from test_auth import auth_client, owner_login  # noqa: F401


def operation(snapshot, changes, operation_id=None):
    return {"operation_id": operation_id or str(uuid.uuid4()), "changes": changes,
        "base_revisions": {key: snapshot["field_revisions"][key] for key in changes}}


def test_fields_merge_and_same_field_requires_explicit_resolution(auth_client):
    client = auth_client
    assert owner_login(client).status_code == 200
    base = client.get("/api/preferences").json()
    first = client.post("/api/preferences/sync", json=operation(base, {"theme_mode": "dark"})).json()
    second = client.post("/api/preferences/sync", json=operation(base, {"locale_mode": "zh-CN", "theme_mode": "system"})).json()
    assert first["conflicts"] == []
    assert second["applied"] == ["locale_mode"]
    assert second["conflicts"] == ["theme_mode"]
    persisted = client.get("/api/preferences").json()
    assert persisted["theme_mode"] == "dark"
    assert persisted["locale_mode"] == "zh-CN"
    assert persisted["field_revisions"]["reader_font_size_px"] == base["field_revisions"]["reader_font_size_px"]
    resolved = client.post("/api/preferences/sync", json=operation(persisted, {"theme_mode": "system"})).json()
    assert resolved["conflicts"] == []
    assert client.get("/api/preferences").json()["theme_mode"] == "system"


def test_replay_is_idempotent_and_cannot_change_request(auth_client):
    assert owner_login(auth_client).status_code == 200
    base = auth_client.get("/api/preferences").json()
    request = operation(base, {"reader_default_focus": True, "annotation_default_position": "docked"})
    first = auth_client.post("/api/preferences/sync", json=request)
    assert first.status_code == 200
    assert auth_client.post("/api/preferences/sync", json=request).json() == first.json()
    assert auth_client.get("/api/preferences").json()["field_revisions"]["reader_default_focus"] == 2
    request["changes"]["reader_default_focus"] = False
    assert auth_client.post("/api/preferences/sync", json=request).status_code == 409
    assert auth_client.get("/api/preferences").json()["reader_default_focus"] is True


def test_legacy_patch_advances_only_changed_fields(auth_client):
    assert owner_login(auth_client).status_code == 200
    base = auth_client.get("/api/preferences").json()
    changed = auth_client.patch("/api/preferences", json={"reader_font_size_px": 20}).json()
    assert changed["field_revisions"]["reader_font_size_px"] == base["field_revisions"]["reader_font_size_px"] + 1
    assert changed["field_revisions"]["theme_mode"] == base["field_revisions"]["theme_mode"]
    assert auth_client.patch("/api/preferences", json={"reader_font_size_px": 20}).json()["field_revisions"] == changed["field_revisions"]
    conflict = auth_client.post("/api/preferences/sync", json=operation(base, {"reader_font_size_px": 18})).json()
    assert conflict["conflicts"] == ["reader_font_size_px"]


def test_preferences_and_receipts_are_account_scoped(auth_client):
    client = auth_client
    _, user_token = _normal_user_session(client)
    assert owner_login(client).status_code == 200
    base = client.get("/api/preferences").json()
    request = operation(base, {"theme_mode": "dark"})
    assert client.post("/api/preferences/sync", json=request).status_code == 200
    client.cookies.clear()
    client.cookies.set("chat_reader_session", user_token)
    mine = client.get("/api/preferences").json()
    assert mine["theme_mode"] == "light"
    # The same operation UUID in another account is independent.
    request = operation(mine, {"theme_mode": "system"}, request["operation_id"])
    assert client.post("/api/preferences/sync", json=request).json()["preferences"]["theme_mode"] == "system"
    assert owner_login(client).status_code == 200
    assert client.get("/api/preferences").json()["theme_mode"] == "dark"


def test_rejects_missing_extra_or_invalid_base_revisions(auth_client):
    assert owner_login(auth_client).status_code == 200
    request = {"operation_id": str(uuid.uuid4()), "changes": {"theme_mode": "dark"}, "base_revisions": {}}
    assert auth_client.post("/api/preferences/sync", json=request).status_code == 422
    request["base_revisions"] = {"theme_mode": 0}
    assert auth_client.post("/api/preferences/sync", json=request).status_code == 422
    request["base_revisions"] = {"theme_mode": 1, "locale_mode": 1}
    assert auth_client.post("/api/preferences/sync", json=request).status_code == 422
