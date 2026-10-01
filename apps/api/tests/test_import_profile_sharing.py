import json
import uuid

import pytest
from sqlalchemy import event

from app.core import auth_middleware
from app.core.config import get_settings
from app.models.import_profile import ImportProfile, ImportProfileGrant, ImportProfilePublication, ImportProfileRevision
from app.models.import_record import ImportRecord
from app.services.canonical.persistence import commit_import_preview
from app.services.user_deletion import execute_user_account_delete, queue_user_account_delete
from app.services.auth import ROOT_ADMIN_USER_ID
from test_admin_system import _normal_user_session
from test_auth import auth_client, owner_login  # noqa: F401


@pytest.fixture
def client(auth_client, tmp_path, monkeypatch):
    for key, folder in (("IMPORT_STORAGE_DIR", "imports"), ("EXPORT_STORAGE_DIR", "exports"), ("ASSET_STORAGE_DIR", "assets"), ("OFFLINE_STORAGE_DIR", "offline")):
        monkeypatch.setenv(key, str(tmp_path / folder))
    get_settings.cache_clear()
    # These tests must exercise real ownership cascades, even in SQLite.
    engine = auth_middleware.SessionLocal.kw["bind"]
    def foreign_keys(connection, *args):
        connection.execute("PRAGMA foreign_keys=ON")
    event.listen(engine, "checkout", foreign_keys)
    yield auth_client
    event.remove(engine, "checkout", foreign_keys)
    get_settings.cache_clear()


def use(client, token):
    client.cookies.clear()
    client.cookies.set("chat_reader_session", token)


def source(*, changed=False):
    return json.dumps({"title": "Synthetic sample only", "turns": [
        {"speaker": "user", "body": "private sample body is not a configuration", **({"extra": "structural change"} if changed else {})},
        {"speaker": "assistant", "body": "synthetic answer"},
    ]}).encode()


def analyze(client, *, changed=False, repair_id=None):
    result = client.post("/api/adaptive-import/sessions", data={"repair_profile_id": repair_id} if repair_id else {},
        files=[("files", ("private-source-filename.json", source(changed=changed), "application/json"))])
    assert result.status_code == 201, result.text
    return result.json()


def learn(client, *, changed=False, repair_id=None, name="Private learning label", transform=None):
    session = analyze(client, changed=changed, repair_id=repair_id)
    family = session["families"][0]
    mapping = family["mapping_draft"]
    if transform:
        mapping["transforms"] = {"content": [transform]}
    result = client.post(f"/api/adaptive-import/sessions/{session['import_id']}/families/{family['id']}/mapping",
        json={"profile_name": name, "mapping_spec": mapping})
    assert result.status_code == 200, result.text
    return result.json()["families"][0]


def publish(client, family):
    assert owner_login(client).status_code == 200
    result = client.put(f"/api/admin/import-formats/{family['matched_profile_id']}/publication",
        json={"revision_id": family["matched_revision_id"], "name": "Shared synthetic format"})
    assert result.status_code == 200, result.text


def learned_rows(client):
    return [row for row in client.get("/api/import-formats").json() if row["kind"] == "LEARNED"]


def commit(session_id):
    with auth_middleware.SessionLocal() as db:
        result = commit_import_preview(uuid.UUID(session_id), db)
        assert result.status == "committed"
        assert db.get(ImportRecord, uuid.UUID(session_id)).status == "committed"


def test_learning_publication_use_withdrawal_and_author_deletion_preserve_holders(client):
    author, author_token = _normal_user_session(client)
    reader, reader_token = _normal_user_session(client)
    _, outsider_token = _normal_user_session(client)
    use(client, author_token)
    family = learn(client)
    profile_id = family["matched_profile_id"]
    use(client, reader_token)
    assert learned_rows(client) == []
    assert client.get(f"/api/import-formats/{profile_id}/revisions").status_code == 404
    assert client.put(f"/api/admin/import-formats/{profile_id}/publication", json={"revision_id": family["matched_revision_id"], "name": "Forbidden"}).status_code == 404
    publish(client, family)
    publish(client, family)  # Repeated promotion never duplicates identity.
    candidates = client.get("/api/admin/import-formats")
    for private in ("private sample body", "private-source-filename", "Private learning label", "Synthetic sample only"):
        assert private not in candidates.text
    use(client, reader_token)
    assert len(learned_rows(client)) == 1
    assert learned_rows(client)[0]["system_provided"] and not learned_rows(client)[0]["held"]
    session = analyze(client)
    assert session["state"] == "READY"
    commit(session["import_id"])
    assert learned_rows(client)[0]["held"]
    owner_login(client)
    assert client.delete(f"/api/admin/import-formats/{profile_id}/publication").status_code == 204
    use(client, reader_token)
    assert len(learned_rows(client)) == 1
    assert not learned_rows(client)[0]["system_provided"]
    assert analyze(client)["state"] == "READY"
    use(client, outsider_token)
    assert learned_rows(client) == []
    assert analyze(client)["state"] == "RESOLVING"
    # Execute the actual account deletion service with FK enforcement.
    with auth_middleware.SessionLocal() as db:
        job, deletion = queue_user_account_delete(db, actor_user_id=ROOT_ADMIN_USER_ID, target_user_id=author, idempotency_key="format-author-delete")
        db.commit()
        execute_user_account_delete(db, job=job, target_user_id=author, deletion_request_id=deletion.id)
        db.commit()
        assert db.get(ImportProfile, uuid.UUID(profile_id)).owner_user_id is None
        assert db.get(ImportProfileGrant, (reader, uuid.UUID(family["matched_revision_id"]))) is not None
    use(client, reader_token)
    assert len(learned_rows(client)) == 1
    assert analyze(client)["state"] == "READY"


def test_equivalent_independent_learning_reuses_identity_without_exposing_private_source(client):
    _, author_token = _normal_user_session(client)
    _, second_token = _normal_user_session(client)
    use(client, author_token)
    first = learn(client)
    use(client, second_token)
    second = learn(client, name="My independent name")
    assert first["matched_profile_id"] == second["matched_profile_id"]
    assert first["matched_revision_id"] == second["matched_revision_id"]
    assert second["display_name"] == "My independent name"
    assert len(learned_rows(client)) == 1
    assert learned_rows(client)[0]["name"] == "My independent name"
    with auth_middleware.SessionLocal() as db:
        assert db.query(ImportProfile).count() == 1
        assert db.query(ImportProfileRevision).count() == 1
        assert db.query(ImportProfileGrant).count() == 2
    use(client, author_token)
    assert learned_rows(client)[0]["name"] == "Private learning label"


def test_personal_repair_does_not_change_public_version_and_private_toggle_is_isolated(client):
    _, author_token = _normal_user_session(client)
    _, reader_token = _normal_user_session(client)
    use(client, author_token)
    first = learn(client)
    publish(client, first)
    use(client, author_token)
    repaired = learn(client, changed=True, repair_id=first["matched_profile_id"])
    assert repaired["matched_profile_id"] == first["matched_profile_id"]
    assert repaired["matched_revision_id"] != first["matched_revision_id"]
    assert len(client.get(f"/api/import-formats/{first['matched_profile_id']}/revisions").json()) == 2
    assert client.patch(f"/api/import-formats/{first['matched_profile_id']}", json={"status": "DISABLED"}).status_code == 200
    use(client, reader_token)
    revisions = client.get(f"/api/import-formats/{first['matched_profile_id']}/revisions").json()
    assert revisions[0]["current"] is True
    assert [r["id"] for r in revisions] == [first["matched_revision_id"]]
    assert learned_rows(client)[0]["status"] == "ACTIVE"
    assert analyze(client)["families"][0]["matched_revision_id"] == first["matched_revision_id"]
    with auth_middleware.SessionLocal() as db:
        assert str(db.get(ImportProfilePublication, uuid.UUID(first["matched_profile_id"])).revision_id) == first["matched_revision_id"]


def test_withdrawal_does_not_interrupt_already_pinned_import(client):
    _, author_token = _normal_user_session(client)
    reader, reader_token = _normal_user_session(client)
    use(client, author_token)
    family = learn(client)
    publish(client, family)
    use(client, reader_token)
    session = analyze(client)
    owner_login(client)
    assert client.delete(f"/api/admin/import-formats/{family['matched_profile_id']}/publication").status_code == 204
    use(client, reader_token)
    reanalyzed = client.post(f"/api/adaptive-import/sessions/{session['import_id']}/reanalyze")
    assert reanalyzed.status_code == 200, reanalyzed.text
    assert reanalyzed.json()["state"] == "READY"
    assert reanalyzed.json()["families"][0]["matched_revision_id"] == family["matched_revision_id"]
    commit(session["import_id"])
    with auth_middleware.SessionLocal() as db:
        assert db.get(ImportProfileGrant, (reader, uuid.UUID(family["matched_revision_id"]))) is not None
    use(client, reader_token)
    assert analyze(client)["state"] == "READY"


def test_equal_structure_different_transform_does_not_merge(client):
    _, first_token = _normal_user_session(client)
    _, second_token = _normal_user_session(client)
    use(client, first_token)
    first = learn(client)
    use(client, second_token)
    second = learn(client, transform="TRIM")
    assert first["matched_profile_id"] != second["matched_profile_id"]
    publish(client, first)
    publish(client, second)
    use(client, first_token)
    session = analyze(client)
    assert session["state"] == "RESOLVING"
    assert session["families"][0]["resolution_status"] == "AMBIGUOUS"
