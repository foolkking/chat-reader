"""Restore portable personal configuration without publishing or changing other users."""
from __future__ import annotations

import hashlib
import uuid

from sqlalchemy import func, or_, text
from sqlalchemy.orm import Session

from app.models.content_cleanup import ContentCleanupException, ContentCleanupRule as Rule, ContentCleanupRulePreference as RulePreference, ContentCleanupRuleRevision as RuleRevision
from app.models.import_profile import ImportProfile, ImportProfilePreference, ImportProfileRevision
from app.models.user_skill import UserSkill, UserSkillSelection
from app.services.adaptive_import.profile_access import canonical_profile_id, grant_revision as grant_profile
from app.services.adaptive_import.profile_identity import configuration_digest_v1 as profile_digest
from app.services.cleanup_rule_access import canonical_rule_id, grant_revision as grant_rule, _configuration_lock
from app.services.cleanup_rule_identity import MATCH_FIELDS, configuration_digest_v1 as rule_digest
from app.services.content_cleanup import ensure_builtin_rules, validate_literal_rule
from app.services.exporting.system_archive import SystemArchiveError, _decode_payload
from app.services.ownership import OwnershipScope


def _source_canonical(value, aliases):
    seen = set()
    while value in aliases:
        if value in seen: raise SystemArchiveError("Archive contains a configuration alias cycle.")
        seen.add(value); value = aliases[value]
    return value


def _available_id(db, model, raw):
    value = uuid.UUID(raw)
    return value if db.get(model, value) is None else uuid.uuid4()


def restore_configurations(db: Session, archive, owner_user_id: uuid.UUID):
    """Return old-to-new configuration references; all writes share the restore txn."""
    profile_ids, profile_revisions = _restore_profiles(db, archive, owner_user_id)
    rule_ids, rule_revisions = _restore_rules(db, archive, owner_user_id)
    skill_ids = _restore_skills(db, archive, owner_user_id)
    return {"profiles": profile_ids, "profile_revisions": profile_revisions,
            "rules": rule_ids, "rule_revisions": rule_revisions, "skills": skill_ids}


def _restore_profiles(db, archive, owner):
    profiles = {row["id"]: row for row in archive.rows("profiles")}
    aliases = {row["old_profile_id"]: row["canonical_profile_id"] for row in archive.rows("profile_aliases")}
    targets, revisions, related = {}, {}, {}
    preferences_before = {row.profile_id for row in db.query(ImportProfilePreference).filter_by(user_id=owner)}
    for payload in archive.rows("profile_revisions"):
        source = _source_canonical(payload["profile_id"], aliases)
        profile_data = profiles[source]
        if profile_data["kind"] != "LEARNED" or payload["status"] not in {"VERIFIED", "SUPERSEDED"}:
            raise SystemArchiveError("Archive contains an unsupported import format revision.")
        fields = {key: payload[key] for key in ("source_signature", "match_spec", "mapping_spec", "validation_spec", "matcher_version", "normalizer_version")}
        digest = profile_digest(source_mode=profile_data["source_mode"], **fields)
        if payload.get("configuration_digest") and payload["configuration_digest"] != digest:
            raise SystemArchiveError("Archive import format configuration checksum mismatch.")
        if db.get_bind().dialect.name == "postgresql":
            db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": int(digest[:16], 16) - (1 << 63)})
        candidates = db.query(ImportProfileRevision, ImportProfile.source_mode).join(ImportProfile, ImportProfile.id == ImportProfileRevision.profile_id).filter(
            or_(ImportProfileRevision.configuration_digest == digest, ImportProfileRevision.configuration_digest.is_(None)), ImportProfile.kind == "LEARNED",
            ImportProfileRevision.status.in_(("VERIFIED", "SUPERSEDED")),
        ).order_by(ImportProfileRevision.created_at, ImportProfileRevision.id).yield_per(250)
        revision = next((candidate for candidate, mode in candidates if profile_digest(source_mode=mode,
            **{key: getattr(candidate, key) for key in fields}) == digest), None)
        if revision is not None:
            target = canonical_profile_id(db, revision.profile_id)
        else:
            target = targets.get(source)
            if target is None:
                profile = ImportProfile(id=_available_id(db, ImportProfile, source), owner_user_id=owner,
                    name=profile_data["name"], kind="LEARNED", source_mode=profile_data["source_mode"], status="ACTIVE")
                db.add(profile); db.flush(); target = profile.id
            profile = db.query(ImportProfile).filter_by(id=target).with_for_update().one()
            ordinal = db.query(func.max(ImportProfileRevision.revision)).filter_by(profile_id=target).scalar() or 0
            decoded = _decode_payload(ImportProfileRevision, payload)
            decoded.update(id=_available_id(db, ImportProfileRevision, payload["id"]), profile_id=target,
                revision=ordinal + 1, configuration_digest=digest, created_by_user_id=owner,
                supersedes_revision_id=revisions.get(payload.get("supersedes_revision_id")),
                # Archived claims are usable personally, but do not authorize public promotion.
                verification_summary={"valid": False, "restored_from_archive": True})
            revision = ImportProfileRevision(**decoded)
            db.add(revision); db.flush()
            if profile.owner_user_id == owner and profile.current_revision_id is None:
                profile.current_revision_id = revision.id
        targets.setdefault(source, target)
        related.setdefault(source, set()).add(target)
        revisions[payload["id"]] = revision.id
        grant_profile(db, owner, revision, reason="RESTORED", display_name=profile_data["name"])
    for source in profiles:
        canonical = _source_canonical(source, aliases)
        if canonical in targets: targets[source] = targets[canonical]
    for row in archive.rows("profile_preferences"):
        source = _source_canonical(row["profile_id"], aliases)
        for target in related.get(source, ()):
            if target in preferences_before: continue  # Existing personal choices remain intact.
            preference = db.get(ImportProfilePreference, (owner, target))
            if preference:
                preference.enabled, preference.hidden = row["enabled"], row["hidden"]
                preference.display_name = row.get("display_name")
    db.flush()
    return targets, revisions


def _restore_rules(db, archive, owner):
    rules = {row["id"]: row for row in archive.rows("rules")}
    aliases = {row["old_rule_id"]: row["canonical_rule_id"] for row in archive.rows("rule_aliases")}
    targets, revisions, related = {}, {}, {}
    preferences_before = {row.rule_id for row in db.query(RulePreference).filter_by(user_id=owner)}
    if any(row["kind"] == "BUILTIN" for row in rules.values()): ensure_builtin_rules(db)
    for payload in archive.rows("rule_revisions"):
        source = _source_canonical(payload["rule_id"], aliases)
        rule_data = rules[source]
        if rule_data["kind"] == "BUILTIN":
            rule = db.query(Rule).filter_by(kind="BUILTIN", detector_id=rule_data["detector_id"]).first()
            if rule is None: raise SystemArchiveError("Archive references an unavailable built-in noise detector.")
            revision = db.query(RuleRevision).filter_by(rule_id=rule.id).order_by(RuleRevision.revision.desc()).first()
            if revision is None: raise SystemArchiveError("Built-in noise detector has no usable revision.")
            target = rule.id
        else:
            if rule_data["kind"] != "USER_LITERAL" or rule_data["scope"] != "MESSAGE":
                raise SystemArchiveError("Archive contains an unsupported personal noise rule.")
            config = {key: payload[key] for key in MATCH_FIELDS}
            validate_literal_rule(config["match_value"] or "", config["matcher_mode"])
            digest = rule_digest(config, scope=rule_data["scope"])
            if payload.get("configuration_digest") and payload["configuration_digest"] != digest:
                raise SystemArchiveError("Archive noise rule configuration checksum mismatch.")
            _configuration_lock(db, digest)
            candidates = db.query(RuleRevision, Rule.scope).join(Rule, Rule.id == RuleRevision.rule_id).filter(
                or_(RuleRevision.configuration_digest == digest, RuleRevision.configuration_digest.is_(None)), Rule.kind == "USER_LITERAL",
            ).order_by(RuleRevision.created_at, RuleRevision.id).yield_per(250)
            revision = next((candidate for candidate, scope in candidates if rule_digest(
                {key: getattr(candidate, key) for key in MATCH_FIELDS}, scope=scope) == digest), None)
            if revision is not None:
                target = canonical_rule_id(db, revision.rule_id)
            else:
                target = targets.get(source)
                if target is None:
                    rule = Rule(id=_available_id(db, Rule, source), owner_user_id=owner, name=rule_data["name"], kind="USER_LITERAL", scope="MESSAGE", status="ACTIVE")
                    db.add(rule); db.flush(); target = rule.id
                db.query(Rule).filter_by(id=target).with_for_update().one()
                ordinal = db.query(func.max(RuleRevision.revision)).filter_by(rule_id=target).scalar() or 0
                revision = RuleRevision(id=_available_id(db, RuleRevision, payload["id"]), rule_id=target,
                    revision=ordinal + 1, **config, configuration_digest=digest, created_by_user_id=owner,
                    default_decision="KEEP", supersedes_revision_id=revisions.get(payload.get("supersedes_revision_id")))
                db.add(revision); db.flush()
            grant_rule(db, OwnershipScope(owner), revision, reason="RESTORED", name=rule_data["name"])
        targets.setdefault(source, target); related.setdefault(source, set()).add(target)
        revisions[payload["id"]] = revision.id
    for source in rules:
        canonical = _source_canonical(source, aliases)
        if canonical in targets: targets[source] = targets[canonical]
    for row in archive.rows("rule_preferences"):
        source = _source_canonical(row["rule_id"], aliases)
        for target in related.get(source, ()):
            if target in preferences_before: continue
            preference = db.get(RulePreference, (owner, target))
            if preference is None:
                preference = RulePreference(user_id=owner, rule_id=target); db.add(preference)
            preference.enabled, preference.hidden = row["enabled"], row["hidden"]
            preference.display_name = row.get("display_name")
            chosen = revisions.get(row.get("current_revision_id"))
            if chosen and canonical_rule_id(db, db.get(RuleRevision, chosen).rule_id) == target:
                preference.current_revision_id = chosen
    for row in archive.rows("rule_exceptions"):
        from app.services.cleanup_learning import _digest
        decoded = _decode_payload(ContentCleanupException, row)
        decoded.update(id=uuid.uuid4(), owner_user_id=owner, rule_revision_id=revisions[row["rule_revision_id"]])
        decoded["scope_digest"] = _digest({"rule_revision_id": str(decoded["rule_revision_id"]), **{key: decoded[key] for key in (
            "role", "match_value", "context_before", "context_after", "at_start", "at_end")}})
        if db.query(ContentCleanupException).filter_by(owner_user_id=owner, scope_digest=decoded["scope_digest"]).first() is None:
            db.add(ContentCleanupException(**decoded)); db.flush()
    db.flush()
    return targets, revisions


def _restore_skills(db, archive, owner):
    subject, targets, preserve_current = str(owner), {}, set()
    for row in archive.rows("skills"):
        digest = hashlib.sha256(row["content"].encode()).hexdigest()
        identity = UserSkill.bundle_digest == row["bundle_digest"] if row.get("bundle_digest") else (UserSkill.bundle_digest.is_(None) & (UserSkill.content_digest == digest))
        existing = db.query(UserSkill).filter_by(subject_key=subject, category=row["category"], locale=row["locale"]).filter(identity).first()
        if existing is None:
            decoded = _decode_payload(UserSkill, row)
            decoded.update(id=uuid.uuid4(), subject_key=subject, content_digest=digest)
            existing = UserSkill(**decoded); db.add(existing); db.flush()
        else:
            preserve_current.add(existing.id)
        targets[row["id"]] = existing.id
    from app.services.exporting.archive_skill_bundles import restore_bundle_history
    restore_bundle_history(db, archive, targets, preserve_current=preserve_current)
    for row in archive.rows("skill_selections"):
        key = subject, row["category"], row["locale"]
        if db.get(UserSkillSelection, key) is not None: continue
        target = targets.get(row.get("skill_id"))
        db.add(UserSkillSelection(subject_key=subject, category=row["category"], locale=row["locale"], skill_id=target))
    db.flush()
    return targets
