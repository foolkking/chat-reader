"""Health checks use real normalization and persist only scoped results."""
import copy
import json
import uuid

from app.core import auth_middleware
from app.models.conversation import Conversation
from app.models.import_profile import ImportProfileGrant, ImportProfileRevision
from app.models.import_record import ImportRecord
from app.services.adaptive_import.service import _source_path
from test_admin_system import _normal_user_session
from test_auth import auth_client  # noqa: F401
from test_import_profile_sharing import client, use  # noqa: F401


def batch(client, bodies, *, repair=None):
    response = client.post("/api/adaptive-import/sessions", data={"repair_profile_id": repair} if repair else {}, files=[
        ("files", (f"synthetic-{i}.json", json.dumps({"turns": [
            {"speaker": "user", "body": body, "alternate": f"Synthetic alternate {i}"},
            {"speaker": "assistant", "body": "Synthetic answer", "alternate": "Synthetic alternate answer"}
        ]}).encode(), "application/json")) for i, body in enumerate(bodies)])
    assert response.status_code == 201, response.text
    return response.json()


def learn(client, session, *, alternate=False):
    family = session["families"][0]
    mapping = copy.deepcopy(family["mapping_draft"])
    mapping["messages"]["content"] = "$.alternate" if alternate else "$.body"
    response = client.post(f"/api/adaptive-import/sessions/{session['import_id']}/families/{family['id']}/mapping",
        json={"profile_name": "Synthetic health format", "mapping_spec": mapping})
    assert response.status_code == 200, response.text
    return response.json()


def health_url(session):
    return f"/api/adaptive-import/sessions/{session['import_id']}/families/{session['families'][0]['id']}/health"


def test_health_checks_every_group_and_preserves_learning_and_content(client):
    account, token = _normal_user_session(client)
    use(client, token)
    saved = learn(client, batch(client, ["Synthetic valid"]))
    # All three members share a Family; the second and third must both fail,
    # while the first must not inherit their diagnostics.
    current = batch(client, ["Synthetic valid", "", ""])
    family = current["families"][0]
    assert len(current["families"]) == 1 and family["resolution_status"] == "DRIFTED"
    assert len(family["validation_result"]["groups"]) == 3
    assert len([g for g in current["groups"] if g["diagnostics"]]) == 2
    checked = client.post(health_url(current))
    assert checked.status_code == 200, checked.text
    result = checked.json()
    assert not result["valid"] and result["verified_on_full_family"]
    assert result["revision_id"] == saved["families"][0]["matched_revision_id"]
    assert len(result["groups"]) == 3
    assert sorted(g["valid"] for g in result["groups"]) == [False, False, True]
    assert {i["code"] for g in result["groups"] for i in g["issues"]} == {"EMPTY_CONTENT"}
    reloaded = client.get(f"/api/adaptive-import/sessions/{current['import_id']}").json()
    assert reloaded["families"][0]["match_evidence"]["health_check"] == result
    with auth_middleware.SessionLocal() as db:
        assert db.query(ImportProfileRevision).count() == 1
        assert db.query(ImportProfileGrant).filter_by(user_id=account).count() == 1
        assert db.query(Conversation).filter_by(owner_user_id=account).count() == 0
    _, other = _normal_user_session(client)
    use(client, other)
    assert client.post(health_url(current)).status_code == 404


def test_repair_prefills_exact_saved_mapping_and_missing_source_can_retry(client):
    _, token = _normal_user_session(client)
    use(client, token)
    saved = learn(client, batch(client, ["Synthetic valid"]), alternate=True)
    repair = batch(client, [""], repair=saved["families"][0]["matched_profile_id"])
    assert repair["families"][0]["mapping_draft"]["messages"]["content"] == "$.alternate"
    checked = client.post(health_url(repair))
    assert checked.status_code == 200 and checked.json()["valid"]
    with auth_middleware.SessionLocal() as db:
        record = db.get(ImportRecord, uuid.UUID(repair["import_id"]))
        path = _source_path(record, record.artifacts[0])
        original = path.read_bytes()
    path.unlink()  # Owned synthetic fixture only.
    try:
        failed = client.post(health_url(repair))
        assert failed.status_code == 200 and not failed.json()["valid"]
        assert failed.json()["groups"][0]["issues"][0]["code"] == "SOURCE_MISSING"
        assert str(path) not in failed.text
    finally:
        path.write_bytes(original)
    assert client.post(health_url(repair)).json()["valid"]


def test_preview_failed_selected_group_never_substitutes_another_source(client):
    _, token = _normal_user_session(client)
    use(client, token)
    current = batch(client, ["Synthetic valid", "Synthetic next"])
    family = current["families"][0]
    # An unmapped role makes normalization itself fail in the selected group.
    with auth_middleware.SessionLocal() as db:
        record = db.get(ImportRecord, uuid.UUID(current["import_id"]))
        group = record.input_groups[1]
        artifact = next(a for a in record.artifacts if str(a.id) in group.artifact_ids)
        path = _source_path(record, artifact)
        payload = json.loads(path.read_bytes())
        payload["turns"][0]["speaker"] = "synthetic_unmapped_role"
        path.write_text(json.dumps(payload), encoding="utf-8")
        selected = str(group.id)
    response = client.post(f"/api/adaptive-import/sessions/{current['import_id']}/families/{family['id']}/mapping/preview",
        json={"mapping_spec": family["mapping_draft"], "sample_group_id": selected})
    assert response.status_code == 200
    assert response.json()["preview"] is None
    assert len(response.json()["validation"]["groups"]) == 2
    assert not response.json()["validation"]["valid"]
