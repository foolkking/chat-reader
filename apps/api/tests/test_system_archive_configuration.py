"""Configuration is durable across a fresh-instance system restore."""
import json
import uuid
import zipfile
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import Base
from app.models.access import InstanceAccessSetting
from app.models.administration import InstanceFeaturePolicy, SystemSkill
from app.models.auth import AuthPrincipal
from app.models.content_cleanup import ContentCleanupRule, ContentCleanupRuleGrant, ContentCleanupRulePublication, ContentCleanupRulePreference, ContentCleanupRuleRevision
from app.models.import_profile import ImportProfile, ImportProfileGrant, ImportProfilePublication, ImportProfileRevision
from app.models.user import User
from app.models.user_preference import UserPreference
from app.models.user_skill import UserSkill, UserSkillSelection
from app.services.auth import hash_password
from app.services.content_cleanup import ensure_builtin_rules
from app.services.exporting.system_archive import SystemArchiveError, create_system_archive, restore_system_archive
from app.services.exporting.system_archive_preflight import inspect_system_archive
from app.services.system_skills import create_system_skill, ensure_bundled_system_skills
from test_personal_archive import seed_personal_data
from test_personal_restore import repack
from test_system_archive_integrity import archive_db  # noqa: F401


def configuration_source(db):
    users, _, job = seed_personal_data(db)
    users[1].role = "ADMIN"
    # The personal-scope fixture deliberately corrupts an unheld revision. A
    # system backup validates every revision, including unheld historical ones.
    revisions = db.query(ImportProfileRevision).order_by(ImportProfileRevision.revision).all()
    revisions[1].mapping_spec = revisions[0].mapping_spec
    profile = db.get(ImportProfile, revisions[0].profile_id)
    db.add(ImportProfilePublication(profile_id=profile.id, revision_id=revisions[0].id, name="Synthetic published format", published_by_user_id=users[1].id))
    rule_revision = db.query(ContentCleanupRuleRevision).join(ContentCleanupRule).filter(ContentCleanupRule.kind == "USER_LITERAL").order_by(ContentCleanupRuleRevision.revision).first()
    db.add(ContentCleanupRulePublication(rule_id=rule_revision.rule_id, revision_id=rule_revision.id,
        name="Synthetic withdrawn rule", published_by_user_id=users[1].id, withdrawn_at=users[1].created_at))
    db.add(InstanceFeaturePolicy(id=1, allow_share_links=False, maximum_import_size_mb=64,
        maximum_merge_message_count=128, updated_by_user_id=users[1].id))
    db.add(InstanceAccessSetting(id=1, registration_mode="INVITE_ONLY", require_admin_approval=True,
        password_reset_enabled=False, updated_by_user_id=users[1].id))
    ensure_bundled_system_skills(db)
    create_system_skill(db, actor_user_id=users[1].id, category="EXPORT_CONTEXT", locale="en",
        name="Synthetic system Skill", content="Synthetic system guidance", default_enabled=True)
    db.commit()
    artifact = create_system_archive(db, job_id=job.id, include_archived=True)
    db.commit()
    return Path(artifact.storage_uri), users


def bootstrap_target(db):
    root = db.query(User).filter_by(role="ADMIN").first()
    if root is None:
        root = User(role="ADMIN", normalized_email="target-admin@example.test")
        db.add(root); db.flush()
    principal = db.get(AuthPrincipal, "owner")
    if principal is None:
        principal = AuthPrincipal(id="owner", user_id=root.id, password_hash=hash_password("Synthetic destination password"))
        db.add(principal)
    preference = db.get(UserPreference, str(root.id))
    if preference is None:
        preference = UserPreference(subject_key=str(root.id))
        db.add(preference)
    preference.theme_mode, preference.field_revisions = "dark", {"theme_mode": 7}
    ensure_builtin_rules(db)
    ensure_bundled_system_skills(db)
    db.commit()
    return root.id, principal.password_hash


@pytest.fixture
def configuration_target(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'configuration-target.db'}")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        yield db
    engine.dispose()


def assert_restored_configuration(db, source_users, root_id, original_hash):
    owner = db.query(User).filter_by(normalized_email=source_users[0].normalized_email).one()
    assert owner.id != source_users[0].id
    assert db.get(AuthPrincipal, "owner").password_hash == original_hash
    assert db.get(UserPreference, str(owner.id)).theme_mode == "dark"
    root_preference = db.get(UserPreference, str(root_id))
    assert root_preference.theme_mode == "light" and root_preference.field_revisions["theme_mode"] == 8
    assert {row.user_id for row in db.query(ImportProfileGrant)} == {owner.id, root_id}
    assert db.query(ImportProfileRevision).count() == 2
    assert db.query(ImportProfilePublication).one().published_by_user_id == root_id
    assert db.query(ImportProfile).one().owner_user_id == root_id
    assert db.query(ContentCleanupRuleGrant).one().user_id == owner.id
    assert db.query(ContentCleanupRulePublication).one().withdrawn_at is not None
    assert all(row.user_id == owner.id and not row.enabled for row in db.query(ContentCleanupRulePreference))
    assert {row.subject_key for row in db.query(UserSkill)} == {str(owner.id), str(root_id)}
    assert all(db.get(UserSkill, row.skill_id).subject_key == row.subject_key for row in db.query(UserSkillSelection))
    system_default = db.query(SystemSkill).filter_by(category="EXPORT_CONTEXT", locale="en", default_enabled=True).one()
    assert system_default.content == "Synthetic system guidance" and system_default.created_by_user_id == root_id
    assert db.get(InstanceFeaturePolicy, 1).maximum_import_size_mb == 64
    assert not db.get(InstanceFeaturePolicy, 1).allow_share_links
    assert db.get(InstanceAccessSetting, 1).registration_mode == "INVITE_ONLY"
    assert db.get(InstanceAccessSetting, 1).require_admin_approval
    assert not db.get(InstanceAccessSetting, 1).password_reset_enabled
    assert db.get(User, source_users[0].id) is None


def test_system_configuration_round_trip(archive_db, configuration_target, tmp_path, monkeypatch):
    path, users = configuration_source(archive_db)
    preview = inspect_system_archive(path)
    assert preview["configuration_included"] and preview["counts"]["profile_grants"] == 2
    root, original_hash = bootstrap_target(configuration_target)
    monkeypatch.setattr(get_settings(), "asset_storage_dir", str(tmp_path / "target-assets"))
    result = restore_system_archive(configuration_target, path, target_root_id=root)
    configuration_target.commit()
    assert result["system_skills"] > 0
    assert_restored_configuration(configuration_target, users, root, original_hash)


@pytest.mark.parametrize("fault", ["grant_owner", "publication", "skill_checksum", "skill_owner", "policy", "credentials", "alias_cycle"])
def test_configuration_preflight_rejects_corruption_without_writes(archive_db, configuration_target, tmp_path, fault):
    path, _ = configuration_source(archive_db)
    root, _ = bootstrap_target(configuration_target)
    def damage(files, manifest):
        table = {"grant_owner": "profile_grants", "publication": "profile_publications", "skill_checksum": "system_skills",
                 "policy": "feature_policy", "credentials": "users", "alias_cycle": "profile_aliases", "skill_owner": "skill_selections"}[fault]
        key = f"data/{table}.jsonl"
        rows = [json.loads(line) for line in files[key].splitlines()]
        if fault == "grant_owner": rows[0]["user_id"] = str(uuid.uuid4())
        if fault == "publication": rows[0]["revision_id"] = str(uuid.uuid4())
        if fault == "skill_checksum":
            row = next(row for row in rows if row["content"])
            row["content"] = "Same-size tampering"
        if fault == "policy": rows[0]["maximum_import_size_mb"] = -1
        if fault == "skill_owner": rows[0]["skill_id"] = rows[1]["skill_id"]
        if fault == "credentials": rows[0]["password_hash"] = "synthetic-credential-must-be-rejected"
        if fault == "alias_cycle":
            profile = json.loads(files["data/profiles.jsonl"].splitlines()[0])["id"]
            rows = [{"old_profile_id": profile, "canonical_profile_id": profile}]
        files[key] = b"".join((json.dumps(row) + "\n").encode() for row in rows)
    invalid = repack(path, tmp_path / "invalid-configuration.cr", damage)
    with pytest.raises(SystemArchiveError):
        restore_system_archive(configuration_target, invalid, target_root_id=root)
    configuration_target.rollback()
    assert configuration_target.query(User).count() == 1
    assert configuration_target.query(ImportProfile).count() == 0
    assert configuration_target.query(UserSkill).count() == 0


@pytest.mark.parametrize("occupied", ["profile", "skill"])
def test_system_restore_preserves_existing_custom_configuration(archive_db, configuration_target, occupied):
    path, _ = configuration_source(archive_db)
    root, _ = bootstrap_target(configuration_target)
    if occupied == "profile":
        configuration_target.add(ImportProfile(name="Keep this format", source_mode="JSON", owner_user_id=root))
    else:
        create_system_skill(configuration_target, actor_user_id=root, category="EXPORT_CONTEXT", locale="en",
                            name="Keep this Skill", content="Existing synthetic guidance", default_enabled=True)
    configuration_target.commit()
    with pytest.raises(SystemArchiveError, match="without"):
        restore_system_archive(configuration_target, path, target_root_id=root)
    configuration_target.rollback()
    assert configuration_target.query(User).count() == 1
    if occupied == "profile":
        assert configuration_target.query(ImportProfile).one().name == "Keep this format"
    else:
        assert configuration_target.query(SystemSkill).filter_by(source_kind="ADMIN_CREATED").one().content == "Existing synthetic guidance"


def test_system_restore_requires_mail_configuration_before_enabling_verification(archive_db, configuration_target, tmp_path, monkeypatch):
    path, _ = configuration_source(archive_db)
    root, _ = bootstrap_target(configuration_target)
    def enable_mail(files, _manifest):
        row = json.loads(files["data/access_policy.jsonl"].splitlines()[0])
        row["email_verification_enabled"] = True
        files["data/access_policy.jsonl"] = (json.dumps(row) + "\n").encode()
    enabled = repack(path, tmp_path / "requires-mail.cr", enable_mail)
    monkeypatch.setattr(get_settings(), "smtp_host", None)
    monkeypatch.setattr(get_settings(), "smtp_from_address", None)
    assert inspect_system_archive(enabled)["configuration_included"]
    with pytest.raises(SystemArchiveError, match="Configure email"):
        restore_system_archive(configuration_target, enabled, target_root_id=root)
    configuration_target.rollback()
    assert configuration_target.query(User).count() == 1
    assert configuration_target.query(InstanceAccessSetting).count() == 0


def test_older_v5_without_configuration_remains_readable(archive_db, configuration_target, tmp_path):
    path, _ = configuration_source(archive_db)
    from app.services.exporting.system_archive_configuration import CONFIGURATION_MODELS
    legacy = tmp_path / "identity-only-v5.cr"
    with zipfile.ZipFile(path) as source, zipfile.ZipFile(legacy, "w") as target:
        manifest = json.loads(source.read("manifest.json"))
        manifest.pop("configuration_version")
        manifest.pop("skill_bundle_version", None)
        manifest.pop("support_requests_version", None)
        removed = {f"data/{name}.jsonl" for name in CONFIGURATION_MODELS}
        manifest["canonical_entries"] = [row for row in manifest["canonical_entries"] if row["path"] not in removed]
        for name in source.namelist():
            if name != "manifest.json" and name not in removed:
                target.writestr(name, source.read(name))
        target.writestr("manifest.json", json.dumps(manifest))
    assert not inspect_system_archive(legacy)["configuration_included"]
    root, _ = bootstrap_target(configuration_target)
    result = restore_system_archive(configuration_target, legacy, target_root_id=root)
    configuration_target.commit()
    assert result["conversations"] == 2 and "skills" not in result
    assert configuration_target.query(UserSkill).count() == 0
