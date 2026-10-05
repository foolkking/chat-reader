"""Real persisted choices and downloads, including divergent pre-migration data."""
import uuid
from contextlib import contextmanager

from app.core.database import get_db
from app.main import app
from app.models.user_skill import UserSkill, UserSkillSelection
from app.models.administration import SystemSkill
from test_import_preview_api import client  # noqa: F401
from test_auth import auth_client, owner_login  # noqa: F401
from test_skill_bundles import bundle


@contextmanager
def database():
    generator = app.dependency_overrides[get_db]()
    try:
        yield next(generator)
    finally:
        generator.close()


def upload(client, text, locale="en"):
    response = client.post("/api/skills", data={"category": "EXPORT_CONTEXT", "locale": locale, "name": text},
                           files={"file": ("synthetic.zip", bundle(text.encode()), "application/zip")})
    assert response.status_code == 201, response.text
    return response.json()


def resolve(client, locale):
    response = client.get("/api/skills/resolve", params={"category": "EXPORT_CONTEXT", "locale": locale})
    assert response.status_code == 200, response.text
    return response.json()


def test_three_effective_defaults_and_cross_language_personal_preference(client):
    assert len(client.get("/api/skills").json()) == 3
    assert resolve(client, "en")["id"] == resolve(client, "zh-CN")["id"]
    row = upload(client, "synthetic English origin")
    assert client.put("/api/skills/selections", json={"category": "EXPORT_CONTEXT", "skill_id": row["id"]}).status_code == 204
    for locale in ("zh-CN", "en"):
        resolved = resolve(client, locale)
        assert resolved["id"] == row["id"]
        assert client.get(resolved["bundle_url"]).content == client.get(row["bundle_url"]).content
        selected = [r for r in client.get("/api/skills", params={"category": "EXPORT_CONTEXT", "locale": locale}).json() if r["is_selected"]]
        assert [r["id"] for r in selected] == [row["id"]]
    with database() as db:
        choices = db.query(UserSkillSelection).all()
        assert {r.locale for r in choices} == {"zh-CN", "en"}
        assert {str(r.skill_id) for r in choices} == {row["id"]}
    assert client.patch(f"/api/skills/{row['id']}", json={"status": "DISABLED"}).status_code == 200
    assert resolve(client, "en")["source"] == resolve(client, "zh-CN")["source"] == "BUILTIN"
    assert client.patch(f"/api/skills/{row['id']}", json={"status": "ACTIVE"}).status_code == 200
    assert resolve(client, "en")["source"] == "BUILTIN"  # re-enable is not a new preference


def test_different_legacy_preferences_survive_until_explicit_choice(client):
    first, second = upload(client, "legacy one", "zh-CN"), upload(client, "legacy two")
    with database() as db:
        subject = db.get(UserSkill, uuid.UUID(first["id"])).subject_key
        for locale, row in (("zh-CN", first), ("en", second)):
            db.add(UserSkillSelection(subject_key=subject, category="EXPORT_CONTEXT", locale=locale, skill_id=uuid.UUID(row["id"])))
        db.commit()
    assert resolve(client, "zh-CN")["id"] == first["id"]
    assert resolve(client, "en")["id"] == second["id"]
    rows = client.get("/api/skills?category=EXPORT_CONTEXT&locale=en").json()
    assert all(r["legacy_selection_conflict"] for r in rows)
    assert {r["id"] for r in rows if r["is_legacy_preferred"]} == {first["id"], second["id"]}
    # Even an old client making a new explicit choice uses one purpose-wide choice.
    assert client.put("/api/skills/selections", json={"category": "EXPORT_CONTEXT", "locale": "en", "skill_id": first["id"]}).status_code == 204
    assert resolve(client, "en")["id"] == resolve(client, "zh-CN")["id"] == first["id"]
    assert not any(r["legacy_selection_conflict"] for r in client.get("/api/skills").json())
    assert client.get(second["bundle_url"]).status_code == 200


def test_single_legacy_choice_is_used_across_languages_and_duplicates_are_rejected(client):
    row = upload(client, "single legacy")
    with database() as db:
        subject = db.get(UserSkill, uuid.UUID(row["id"])).subject_key
        db.add(UserSkillSelection(subject_key=subject, category="EXPORT_CONTEXT", locale="en", skill_id=uuid.UUID(row["id"])))
        db.commit()
    assert resolve(client, "zh-CN")["id"] == row["id"]
    duplicate = client.post("/api/skills", data={"category": "EXPORT_CONTEXT", "locale": "zh-CN", "name": "duplicate"},
                            files={"file": ("same.zip", bundle(b"single legacy"), "application/zip")})
    assert duplicate.status_code == 409
    assert client.put("/api/skills/selections", json={"category": "CONTEXT_MAINTENANCE", "skill_id": row["id"]}).status_code == 422
    with database() as db:
        item = db.get(UserSkill, uuid.UUID(row["id"]))
        item.subject_key = str(uuid.uuid4())
        db.commit()
    assert client.put("/api/skills/selections", json={"category": "EXPORT_CONTEXT", "skill_id": row["id"]}).status_code == 422
    assert client.get(row["bundle_url"]).status_code == 404


def test_system_replacement_unifies_languages_without_touching_personal_choices(auth_client):
    assert owner_login(auth_client).status_code == 200
    personal = upload(auth_client, "private preference")
    assert auth_client.put("/api/skills/selections", json={"category": "EXPORT_CONTEXT", "skill_id": personal["id"]}).status_code == 204
    rows = auth_client.get("/api/admin/system-skills?effective=true").json()
    assert len(rows) == 3
    row = next(r for r in rows if r["category"] == "EXPORT_CONTEXT")
    changed = auth_client.post(f"/api/admin/system-skills/{row['id']}/revisions", data={"base_revision": row["bundle_revision"]},
                               files={"file": ("new.zip", bundle(b"system replacement"), "application/zip")})
    assert changed.status_code == 200, changed.text
    assert resolve(auth_client, "en")["id"] == resolve(auth_client, "zh-CN")["id"] == personal["id"]
    assert auth_client.put("/api/skills/selections", json={"category": "EXPORT_CONTEXT", "skill_id": None}).status_code == 204
    for locale in ("en", "zh-CN"):
        current = resolve(auth_client, locale)
        assert current["bundle_url"] == changed.json()["bundle_url"]
        assert auth_client.get(current["bundle_url"]).status_code == 200
    assert len(auth_client.get("/api/admin/system-skills?effective=true").json()) == 3
    assert auth_client.post(f"/api/admin/system-skills/{row['id']}/restore").status_code == 200
    assert resolve(auth_client, "en")["bundle_url"] == resolve(auth_client, "zh-CN")["bundle_url"] == "/skills/context-acquisition.zip"
    assert auth_client.get(personal["bundle_url"]).status_code == 200


def test_legacy_system_bundles_with_same_instructions_but_different_scripts_need_choice(auth_client):
    assert owner_login(auth_client).status_code == 200
    old = [r for r in auth_client.get("/api/admin/system-skills").json() if r["category"] == "EXPORT_CONTEXT"]
    for row in old:
        response = auth_client.post(f"/api/admin/system-skills/{row['id']}/revisions", data={"base_revision": 0},
                                    files={"file": ("old.zip", bundle(row["locale"].encode()), "application/zip")})
        assert response.status_code == 200
    with database() as db:
        db.query(SystemSkill).filter_by(category="EXPORT_CONTEXT").update({"default_enabled": True})
        db.commit()
    choices = [r for r in auth_client.get("/api/admin/system-skills?effective=true").json() if r["category"] == "EXPORT_CONTEXT"]
    assert len(choices) == 2 and all(r["legacy_default_conflict"] for r in choices)
    assert resolve(auth_client, "en")["bundle_url"] != resolve(auth_client, "zh-CN")["bundle_url"]
    assert auth_client.patch(f"/api/admin/system-skills/{choices[0]['id']}", json={"default_enabled": True}).status_code == 200
    assert resolve(auth_client, "en")["bundle_url"] == resolve(auth_client, "zh-CN")["bundle_url"] == choices[0]["bundle_url"]
