"""Personal names must not bypass immutable matcher-revision concurrency checks."""
from test_import_preview_api import client  # noqa: F401
import pytest


def trial_input(rule, name):
    return {key: rule[key] for key in ("match_value", "case_sensitive", "role_filter", "matcher_mode", "boundary_mode")} | {
        "name": name, "rule_id": rule["id"], "base_revision": rule["revision"],
        "base_revision_id": rule["revision_id"], "base_edit_token": rule.get("edit_token"),
    }


def test_name_only_change_after_trial_does_not_overwrite(client):
    rule = client.post("/api/content-cleanup/rules", json={"name": "Synthetic original", "match_value": "SYNTHETIC_EDIT_NOISE"}).json()
    first, second = trial_input(rule, "Synthetic first window"), trial_input(rule, "Synthetic second window")
    previews = [client.post("/api/content-cleanup/rules/trial", json=value) for value in (first, second)]
    assert all(response.status_code == 200 for response in previews)
    saved = client.post("/api/content-cleanup/rules/learn", json={**first, "confirmed": True, "preview_token": previews[0].json()["preview_token"]})
    assert saved.status_code == 200
    assert saved.json()["revision_id"] == rule["revision_id"]
    conflict = client.post("/api/content-cleanup/rules/learn", json={**second, "confirmed": True, "preview_token": previews[1].json()["preview_token"]})
    assert conflict.status_code == 409, "A stale name-only draft must not overwrite the first window"
    current = next(item for item in client.get("/api/content-cleanup/rules").json() if item["id"] == rule["id"])
    assert current["name"] == "Synthetic first window"


def test_stale_name_rejected_before_trial_and_explicit_rebase_works(client):
    rule = client.post("/api/content-cleanup/rules", json={"name": "Synthetic original", "match_value": "SYNTHETIC_REBASE_NOISE"}).json()
    url = f"/api/content-cleanup/rules/{rule['id']}"
    newer = client.patch(url, json={"name": "Synthetic remote", "base_edit_token": rule["edit_token"]})
    assert newer.status_code == 200
    assert newer.json()["revision_id"] == rule["revision_id"]
    assert newer.json()["edit_token"] != rule["edit_token"]
    stale = trial_input(rule, "Synthetic local")
    assert client.post("/api/content-cleanup/rules/trial", json=stale).status_code == 409
    assert client.patch(url, json={"name": "Synthetic local", "base_edit_token": rule["edit_token"]}).status_code == 409
    rebased = trial_input(newer.json(), "Synthetic local")
    trial = client.post("/api/content-cleanup/rules/trial", json=rebased)
    assert trial.status_code == 200
    saved = client.post("/api/content-cleanup/rules/learn", json={**rebased, "confirmed": True, "preview_token": trial.json()["preview_token"]})
    assert saved.status_code == 200
    assert saved.json()["name"] == "Synthetic local" and saved.json()["revision_id"] == rule["revision_id"]
    assert len(client.get(url + "/revisions").json()) == 1


@pytest.mark.parametrize("legacy", [False, True])
def test_omitting_base_on_confirmation_cannot_bypass_changed_state(client, legacy):
    rule = client.post("/api/content-cleanup/rules", json={"name": "Synthetic original", "match_value": "SYNTHETIC_LEGACY_NOISE"}).json()
    value = trial_input(rule, "Synthetic local")
    if legacy:
        value.pop("base_edit_token")
    trial = client.post("/api/content-cleanup/rules/trial", json=value)
    assert trial.status_code == 200
    assert trial.json()["base_edit_token"] == rule["edit_token"]
    assert client.patch(f"/api/content-cleanup/rules/{rule['id']}", json={"name": "Synthetic remote"}).status_code == 200
    value.pop("base_edit_token", None)
    response = client.post("/api/content-cleanup/rules/learn", json={**value, "confirmed": True, "preview_token": trial.json()["preview_token"]})
    assert response.status_code == 409
    current = next(item for item in client.get("/api/content-cleanup/rules").json() if item["id"] == rule["id"])
    assert current["name"] == "Synthetic remote"


def test_legacy_trial_without_base_can_save_when_unchanged(client):
    rule = client.post("/api/content-cleanup/rules", json={"name": "Synthetic original", "match_value": "SYNTHETIC_COMPAT_NOISE"}).json()
    value = trial_input(rule, "Synthetic local")
    value.pop("base_edit_token")
    trial = client.post("/api/content-cleanup/rules/trial", json=value)
    saved = client.post("/api/content-cleanup/rules/learn", json={**value, "confirmed": True, "preview_token": trial.json()["preview_token"]})
    assert saved.status_code == 200 and saved.json()["name"] == "Synthetic local"


def test_disabling_after_trial_blocks_edit_without_reenabling(client):
    rule = client.post("/api/content-cleanup/rules", json={"name": "Synthetic original", "match_value": "SYNTHETIC_DISABLED_NOISE"}).json()
    value = trial_input(rule, "Synthetic local")
    trial = client.post("/api/content-cleanup/rules/trial", json=value)
    assert client.patch(f"/api/content-cleanup/rules/{rule['id']}", json={"status": "DISABLED"}).status_code == 200
    assert client.post("/api/content-cleanup/rules/learn", json={**value, "confirmed": True, "preview_token": trial.json()["preview_token"]}).status_code == 409
    current = next(item for item in client.get("/api/content-cleanup/rules").json() if item["id"] == rule["id"])
    assert current["status"] == "DISABLED" and current["name"] == rule["name"]


def test_editing_disabled_rule_preserves_its_switch(client):
    rule = client.post("/api/content-cleanup/rules", json={"name": "Synthetic original", "match_value": "SYNTHETIC_KEEP_DISABLED"}).json()
    disabled = client.patch(f"/api/content-cleanup/rules/{rule['id']}", json={"status": "DISABLED"}).json()
    value = trial_input(disabled, "Synthetic renamed while disabled")
    trial = client.post("/api/content-cleanup/rules/trial", json=value)
    saved = client.post("/api/content-cleanup/rules/learn", json={**value, "confirmed": True, "preview_token": trial.json()["preview_token"]})
    assert saved.status_code == 200
    assert saved.json()["status"] == "DISABLED", "Editing a name must not enable a disabled rule"
