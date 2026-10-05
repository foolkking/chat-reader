"""Portable system configuration; credentials and operational history stay excluded."""
from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timezone

from sqlalchemy import inspect

from app.models.access import InstanceAccessSetting
from app.models.administration import InstanceFeaturePolicy, SystemSkill
from app.models.content_cleanup import ContentCleanupRulePublication
from app.models.import_profile import ImportProfilePublication
from app.core.config import get_settings
from app.services.exporting.personal_archive import PERSONAL_TABLE_MODELS
from app.services.exporting.system_archive import TABLE_MODELS, SystemArchiveError, _restore_rows, _restore_self_referencing_rows
from app.services.exporting.archive_accounts import ArchiveOwnershipError, remap_account_payload


CONFIGURATION_VERSION = 1
CONFIGURATION_MODELS = {name: model for name, model in PERSONAL_TABLE_MODELS.items() if name not in TABLE_MODELS}
CONFIGURATION_MODELS.update({
    "profile_publications": ImportProfilePublication,
    "rule_publications": ContentCleanupRulePublication,
    "system_skills": SystemSkill,
    "feature_policy": InstanceFeaturePolicy,
    "access_policy": InstanceAccessSetting,
})
ACCOUNT_FIELDS = {"owner_user_id", "user_id", "created_by_user_id", "updated_by_user_id", "published_by_user_id"}


def configuration_queries(db):
    rows = {name: db.query(model).order_by(*inspect(model).primary_key) for name, model in CONFIGURATION_MODELS.items()}
    from app.models.skill_bundle import SkillFileObject, SkillBundleMember
    rows["skill_file_objects"] = db.query(SkillFileObject).filter(
        SkillFileObject.sha256.in_(db.query(SkillBundleMember.object_sha256))
    ).order_by(SkillFileObject.sha256)
    # Snapshot effective non-secret policy defaults even before the first admin
    # settings visit, without writing to the read-only export transaction.
    for name, model in (("feature_policy", InstanceFeaturePolicy), ("access_policy", InstanceAccessSetting)):
        if db.get(model, 1) is None:
            values = {prop.key: prop.columns[0].default.arg for prop in inspect(model).column_attrs
                      if prop.columns[0].default is not None and prop.columns[0].default.is_scalar}
            values["updated_at"] = datetime.now(timezone.utc)
            if name == "feature_policy":
                values["maximum_import_size_mb"] = get_settings().max_import_file_size_mb
            else:
                values["registration_mode"] = get_settings().auth_registration_mode
            rows[name] = _SnapshotPolicy(model(**values))
    return rows


class _SnapshotPolicy:
    def __init__(self, row):
        self.row = row

    def yield_per(self, _batch_size):
        return iter((self.row,))


def validate_system_configuration(archive):
    """Validate settings before any identity, data or configuration write."""
    from app.services.skills import MAX_SKILL_BYTES
    from app.services.system_skills import builtin_by_key
    from app.services.exporting.archive_preflight import PersonalArchive

    PersonalArchive._validate_configurations(archive)
    defaults, skill_keys, bundled_keys = set(), set(), set()
    for row in archive.rows("system_skills"):
        key = (row["category"], row["locale"])
        if (key[0] not in {"EXPORT_CONTEXT", "CONVERSATION_RESCUE", "CONTEXT_MAINTENANCE"} or key[1] not in {"zh-CN", "en"}
                or row["status"] not in {"ACTIVE", "DISABLED"} or row["source_kind"] not in {"BUNDLED", "ADMIN_CREATED"}):
            raise SystemArchiveError("Archive contains an unsupported system Skill.")
        if row["skill_key"] in skill_keys:
            raise SystemArchiveError("Archive contains duplicate system Skill keys.")
        skill_keys.add(row["skill_key"])
        if row["source_kind"] == "BUNDLED":
            builtin = builtin_by_key(row.get("bundled_key"))
            if (builtin.category, builtin.locale) != key or row["bundled_key"] in bundled_keys:
                raise SystemArchiveError("Archive contains an invalid bundled Skill reference.")
            bundled_keys.add(row["bundled_key"])
        elif row.get("bundled_key") is not None or row.get("content") is None:
            raise SystemArchiveError("Archive contains an invalid system Skill.")
        if row.get("content") is not None:
            body = row["content"].encode()
            if not body.strip() or len(body) > MAX_SKILL_BYTES or len(body) != row.get("byte_size") or hashlib.sha256(body).hexdigest() != row.get("content_digest"):
                raise SystemArchiveError("Archive system Skill failed checksum or size validation.")
        elif row.get("byte_size") is not None or row.get("content_digest") is not None:
            raise SystemArchiveError("Archive contains invalid system Skill metadata.")
        if row["default_enabled"]:
            if key in defaults or row["status"] != "ACTIVE":
                raise SystemArchiveError("Archive contains conflicting system Skill defaults.")
            defaults.add(key)
    for name in ("feature_policy", "access_policy"):
        if archive.counts[name] > 1 or any(row["id"] != 1 for row in archive.rows(name)):
            raise SystemArchiveError("Archive contains conflicting instance policies.")
    for row in archive.rows("feature_policy"):
        if not 1 <= row["maximum_import_size_mb"] <= 10_240 or not 2 <= row["maximum_merge_message_count"] <= 100_000:
            raise SystemArchiveError("Archive contains invalid feature limits.")
    for row in archive.rows("access_policy"):
        if row["registration_mode"] not in {"CLOSED", "INVITE_ONLY", "OPEN"}:
            raise SystemArchiveError("Archive contains an invalid registration policy.")
    for prefix in ("profile", "rule"):
        revisions = {row["id"]: row for row in archive.rows(f"{prefix}_revisions")}
        for row in archive.rows(f"{prefix}_publications"):
            if revisions[row["revision_id"]][f"{prefix}_id"] != row[f"{prefix}_id"]:
                raise SystemArchiveError("Archive publication references another configuration.")
        aliases = {row[f"old_{prefix}_id"]: row[f"canonical_{prefix}_id"] for row in archive.rows(f"{prefix}_aliases")}
        def canonical(value):
            while value in aliases:
                value = aliases[value]
            return value
        selected_rows = archive.rows("profiles") if prefix == "profile" else archive.rows("rule_preferences")
        for row in selected_rows:
            if row.get("current_revision_id"):
                selected_owner = revisions[row["current_revision_id"]][f"{prefix}_id"]
                parent = row["id"] if prefix == "profile" else row["rule_id"]
                if canonical(selected_owner) != canonical(parent):
                    raise SystemArchiveError("Archive selection references another configuration.")
    skills = {row["id"]: row for row in archive.rows("skills")}
    for row in archive.rows("skill_selections"):
        if row.get("skill_id"):
            skill = skills[row["skill_id"]]
            if any(skill[key] != row[key] for key in ("subject_key", "category")):
                raise SystemArchiveError("Archive Skill selection crosses account or category boundaries.")


def require_configuration_restore_target(db):
    """Only bootstrap settings may be replaced in an otherwise empty instance."""
    permitted = {"preferences", "rules", "rule_revisions", "system_skills", "feature_policy", "access_policy"}
    for name, model in CONFIGURATION_MODELS.items():
        if name not in permitted and db.query(model).first() is not None:
            raise SystemArchiveError("System restore requires an instance without personal or learned configuration.", 409)
    rule = CONFIGURATION_MODELS["rules"]
    if db.query(rule).filter(rule.kind != "BUILTIN").first() is not None:
        raise SystemArchiveError("System restore requires an instance without personal or learned configuration.", 409)
    if db.query(SystemSkill).filter((SystemSkill.source_kind != "BUNDLED") | SystemSkill.content.isnot(None)).first() is not None:
        raise SystemArchiveError("System restore requires an instance without customized system Skills.", 409)


def require_configuration_restore_environment(archive):
    settings = get_settings()
    if any(row["email_verification_enabled"] for row in archive.rows("access_policy")) and not (settings.smtp_host and settings.smtp_from_address):
        raise SystemArchiveError("Configure email delivery before restoring a policy that requires email verification.", 409)


def restore_system_configuration(db, archive, mapping):
    # Mapping two distinct accounts onto one would silently discard preferences
    # or merge access grants. Canonical-only legacy mappings retain their behavior.
    values = [target for source, target in mapping.items() if source != "unowned"]
    if len(values) != len(set(values)):
        raise ArchiveOwnershipError("Configuration restore requires a distinct target for each archived account.")

    def owned(name):
        for row in archive.rows(name):
            # Null configuration owners denote system/shared origin, not unowned data.
            payload = dict(row)
            for field in ACCOUNT_FIELDS:
                if payload.get(field) is not None:
                    payload[field] = mapping[payload[field]]
            if "subject_key" in payload:
                payload["subject_key"] = remap_account_payload({"subject_key": payload["subject_key"]}, mapping)["subject_key"]
            yield payload

    for name, model in CONFIGURATION_MODELS.items():
        primary_key = [inspect(model).get_property_by_column(column).key for column in inspect(model).primary_key]
        seen = set()
        for row in owned(name):
            key = tuple(row[field] for field in primary_key)
            if key in seen:
                raise ArchiveOwnershipError("Configuration ownership mapping combines conflicting account settings.")
            seen.add(key)

    # Bootstrap rows have no user-held references after the target check above.
    for name in ("rule_revisions", "rules", "system_skills", "feature_policy", "access_policy"):
        model = CONFIGURATION_MODELS[name]
        if name == "rule_revisions":
            db.query(model).update({model.supersedes_revision_id: None}, synchronize_session=False)
        db.query(model).delete(synchronize_session=False)
    db.flush()
    _restore_rows(db, CONFIGURATION_MODELS["profiles"], owned("profiles"), overrides={"current_revision_id": None})
    _restore_rows(db, CONFIGURATION_MODELS["rules"], owned("rules"))
    for name in ("profile_revisions", "rule_revisions"):
        _restore_self_referencing_rows(db, CONFIGURATION_MODELS[name], owned(name), "supersedes_revision_id")
    for row in archive.rows("profiles"):
        model = CONFIGURATION_MODELS["profiles"]
        db.get(model, uuid.UUID(row["id"])).current_revision_id = uuid.UUID(row["current_revision_id"]) if row.get("current_revision_id") else None
    db.flush()
    for name in ("profile_grants", "profile_preferences", "profile_aliases", "profile_publications",
                 "rule_grants", "rule_preferences", "rule_aliases", "rule_exceptions", "rule_publications",
                 "skills", "skill_selections", "system_skills", "feature_policy", "access_policy"):
        _restore_rows(db, CONFIGURATION_MODELS[name], owned(name))
    from app.services.exporting.archive_skill_bundles import restore_bundle_history
    restore_bundle_history(db, archive, {row["id"]: uuid.UUID(row["id"]) for row in archive.rows("skills")},
                           system_targets={row["id"]: uuid.UUID(row["id"]) for row in archive.rows("system_skills")})
    # Preserve live field revisions for the target Root and explicitly mapped users.
    from app.schemas.preferences import UserPreferenceUpdate
    from app.services.preferences import update_preferences
    for row in owned("preferences"):
        update_preferences(db, UserPreferenceUpdate.model_validate(
            {key: row[key] for key in UserPreferenceUpdate.model_fields if key in row}), row["subject_key"], allow_inactive=True)
    db.flush()
