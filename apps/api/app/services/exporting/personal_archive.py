"""Account-scoped .cr data snapshots; separate from system/legacy conversation archives."""
from __future__ import annotations

import uuid

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models.content_cleanup import (
    ContentCleanupException, ContentCleanupRule, ContentCleanupRuleAlias,
    ContentCleanupRuleGrant, ContentCleanupRulePreference, ContentCleanupRuleRevision,
)
from app.models.import_profile import (
    ImportProfile, ImportProfileAlias, ImportProfileGrant, ImportProfilePreference, ImportProfileRevision,
)
from app.models.skill_bundle import SkillBundleRevision, SkillBundleMember, SkillFileObject
from app.models.user import User
from app.models.user_preference import UserPreference
from app.models.user_skill import UserSkill, UserSkillSelection
from app.models.support_request import SupportRequest, SupportMessage
from app.services.adaptive_import.profile_access import canonical_profile_id, personal_name
from app.services.adaptive_import.profile_identity import verification_summary_v1
from app.services.cleanup_rule_access import personal_name as personal_rule_name
from app.services.exporting.system_archive import TABLE_MODELS, SystemArchiveError, _canonical_queries, _create_data_archive
from app.services.exporting.archive_transaction import archive_read_snapshot
from app.services.ownership import OwnershipScope


PERSONAL_ARCHIVE_FORMAT = "chat-reader-personal-archive"
PERSONAL_ARCHIVE_VERSION = 1
PERSONAL_TABLE_MODELS = {
    **TABLE_MODELS,
    "preferences": UserPreference,
    "profiles": ImportProfile,
    "profile_revisions": ImportProfileRevision,
    "profile_grants": ImportProfileGrant,
    "profile_preferences": ImportProfilePreference,
    "profile_aliases": ImportProfileAlias,
    "rules": ContentCleanupRule,
    "rule_revisions": ContentCleanupRuleRevision,
    "rule_grants": ContentCleanupRuleGrant,
    "rule_preferences": ContentCleanupRulePreference,
    "rule_aliases": ContentCleanupRuleAlias,
    "rule_exceptions": ContentCleanupException,
    "skills": UserSkill,
    "skill_selections": UserSkillSelection,
    "skill_bundle_revisions": SkillBundleRevision,
    "skill_bundle_members": SkillBundleMember,
    "skill_file_objects": SkillFileObject,
    "support_requests": SupportRequest,
    "support_messages": SupportMessage,
}


def _personal_queries(db: Session, owner_user_id: uuid.UUID, *, include_archived: bool):
    subject = str(owner_user_id)
    rows = _canonical_queries(
        db, include_archived=include_archived, ownership_scope=OwnershipScope(owner_user_id),
        subject_keys=[subject],
    )
    profile_grants = db.query(ImportProfileGrant).filter(ImportProfileGrant.user_id == owner_user_id)
    profile_revisions = db.query(ImportProfileRevision).filter(ImportProfileRevision.id.in_(profile_grants.with_entities(ImportProfileGrant.revision_id)))
    revision_profiles = profile_revisions.with_entities(ImportProfileRevision.profile_id)
    profile_aliases = db.query(ImportProfileAlias).filter(ImportProfileAlias.old_profile_id.in_(revision_profiles))
    profiles = db.query(ImportProfile).filter(or_(
        ImportProfile.id.in_(revision_profiles),
        ImportProfile.id.in_(profile_aliases.with_entities(ImportProfileAlias.canonical_profile_id)),
    ))
    exceptions = db.query(ContentCleanupException).filter(ContentCleanupException.owner_user_id == owner_user_id)
    rule_grants = db.query(ContentCleanupRuleGrant).filter(ContentCleanupRuleGrant.user_id == owner_user_id)
    rule_preferences = db.query(ContentCleanupRulePreference).filter(ContentCleanupRulePreference.user_id == owner_user_id)
    builtin_preference = select(ContentCleanupRule.id).where(
        ContentCleanupRule.id == ContentCleanupRuleRevision.rule_id,
        ContentCleanupRule.kind == "BUILTIN",
        ContentCleanupRule.id.in_(rule_preferences.with_entities(ContentCleanupRulePreference.rule_id)),
    ).exists()
    rule_revisions = db.query(ContentCleanupRuleRevision).filter(or_(
        ContentCleanupRuleRevision.id.in_(rule_grants.with_entities(ContentCleanupRuleGrant.revision_id)),
        ContentCleanupRuleRevision.id.in_(exceptions.with_entities(ContentCleanupException.rule_revision_id)),
        builtin_preference,
    ))
    revision_rules = rule_revisions.with_entities(ContentCleanupRuleRevision.rule_id)
    rule_aliases = db.query(ContentCleanupRuleAlias).filter(ContentCleanupRuleAlias.old_rule_id.in_(revision_rules))
    rules = db.query(ContentCleanupRule).filter(or_(
        ContentCleanupRule.id.in_(revision_rules),
        ContentCleanupRule.id.in_(rule_aliases.with_entities(ContentCleanupRuleAlias.canonical_rule_id)),
    ))
    rows.update({
        "support_requests": db.query(SupportRequest).filter(SupportRequest.owner_user_id == owner_user_id).order_by(SupportRequest.id),
        "support_messages": db.query(SupportMessage).join(SupportRequest, SupportRequest.id == SupportMessage.request_id).filter(
            SupportRequest.owner_user_id == owner_user_id).order_by(SupportMessage.id),
        "preferences": db.query(UserPreference).filter(UserPreference.subject_key == subject),
        "profiles": profiles.order_by(ImportProfile.id),
        "profile_revisions": profile_revisions.order_by(ImportProfileRevision.profile_id, ImportProfileRevision.revision),
        "profile_grants": profile_grants.order_by(ImportProfileGrant.revision_id),
        "profile_preferences": db.query(ImportProfilePreference).filter(
            ImportProfilePreference.user_id == owner_user_id,
            ImportProfilePreference.profile_id.in_(profiles.with_entities(ImportProfile.id)),
        ).order_by(ImportProfilePreference.profile_id),
        "profile_aliases": profile_aliases.order_by(ImportProfileAlias.old_profile_id),
        "rules": rules.order_by(ContentCleanupRule.id),
        "rule_revisions": rule_revisions.order_by(ContentCleanupRuleRevision.rule_id, ContentCleanupRuleRevision.revision),
        "rule_grants": rule_grants.order_by(ContentCleanupRuleGrant.revision_id),
        "rule_preferences": rule_preferences.filter(ContentCleanupRulePreference.rule_id.in_(rules.with_entities(ContentCleanupRule.id))).order_by(ContentCleanupRulePreference.rule_id),
        "rule_aliases": rule_aliases.order_by(ContentCleanupRuleAlias.old_rule_id),
        "rule_exceptions": exceptions.order_by(ContentCleanupException.id),
        "skills": db.query(UserSkill).filter(UserSkill.subject_key == subject).order_by(UserSkill.id),
        "skill_selections": db.query(UserSkillSelection).filter(UserSkillSelection.subject_key == subject).order_by(UserSkillSelection.category, UserSkillSelection.locale),
    })
    revisions = db.query(SkillBundleRevision).filter(SkillBundleRevision.user_skill_id.in_(rows["skills"].with_entities(UserSkill.id)))
    members = db.query(SkillBundleMember).filter(SkillBundleMember.revision_id.in_(revisions.with_entities(SkillBundleRevision.id)))
    rows.update(skill_bundle_revisions=revisions.order_by(SkillBundleRevision.id),
                skill_bundle_members=members.order_by(SkillBundleMember.revision_id, SkillBundleMember.path),
                skill_file_objects=db.query(SkillFileObject).filter(SkillFileObject.sha256.in_(members.with_entities(SkillBundleMember.object_sha256))).order_by(SkillFileObject.sha256))
    from app.services.exporting.archive_context import context_queries
    rows.update(context_queries(db, rows['conversations']))
    return rows


def create_personal_archive(db: Session, *, job_id: uuid.UUID, owner_user_id: uuid.UUID,
                            include_archived: bool = True, progress_callback=None):
    with archive_read_snapshot(db) as snapshot:
        return _create_personal_archive(db, snapshot=snapshot, job_id=job_id, owner_user_id=owner_user_id,
                                        include_archived=include_archived, progress_callback=progress_callback)


def _create_personal_archive(db: Session, *, snapshot: Session, job_id: uuid.UUID,
                             owner_user_id: uuid.UUID, include_archived: bool, progress_callback):
    from app.services.exporting.archive_preflight import inspect_personal_archive
    owner = snapshot.get(User, owner_user_id)
    if owner is None or not owner.can_login:
        raise SystemArchiveError("The backup account is unavailable.", 403)
    rows = _personal_queries(snapshot, owner_user_id, include_archived=include_archived)
    # Only revision metadata is retained in memory; bodies stream from JSONL queries.
    profile_revision_ids = {str(row[0]) for row in rows["profile_revisions"].with_entities(ImportProfileRevision.id)}
    rule_revision_ids = {str(row[0]) for row in rows["rule_revisions"].with_entities(ContentCleanupRuleRevision.id)}
    skill_ids = {str(row[0]) for row in rows["skills"].with_entities(UserSkill.id)}

    def payload_transform(name, payload):
        from app.services.exporting.archive_support import portable_support_payload
        payload = portable_support_payload(name, payload)
        if name == "support_messages" and payload.get("author_user_id") != str(owner_user_id):
            payload["author_user_id"] = None
        # A held public configuration does not disclose its original author's account.
        for key in ("owner_user_id", "created_by_user_id"):
            if key in payload and payload[key] != str(owner_user_id):
                payload[key] = None
        if name == "profiles":
            profile = snapshot.get(ImportProfile, canonical_profile_id(snapshot, uuid.UUID(payload["id"])))
            payload["name"] = personal_name(snapshot, owner_user_id, profile)
            if payload.get("current_revision_id") not in profile_revision_ids:
                payload["current_revision_id"] = None
        if name == "profile_revisions":
            payload["verification_summary"] = verification_summary_v1(payload.get("verification_summary") or {})
            if payload.get("supersedes_revision_id") not in profile_revision_ids:
                payload["supersedes_revision_id"] = None
        if name == "rules":
            payload["name"] = personal_rule_name(snapshot, owner_user_id, snapshot.get(ContentCleanupRule, uuid.UUID(payload["id"])))
        if name == "rule_revisions" and payload.get("supersedes_revision_id") not in rule_revision_ids:
            payload["supersedes_revision_id"] = None
        if name == "rule_preferences" and payload.get("current_revision_id") not in rule_revision_ids:
            payload["current_revision_id"] = None
        if name == "skill_selections" and payload.get("skill_id") not in skill_ids:
            payload["skill_id"] = None
        return payload

    return _create_data_archive(
        db, rows=rows, job_id=job_id, include_archived=include_archived,
        archive_format=PERSONAL_ARCHIVE_FORMAT, archive_version=PERSONAL_ARCHIVE_VERSION,
        scope_type="personal", restore_mode="additive", progress_callback=progress_callback,
        payload_transform=payload_transform, manifest_metadata={"skill_bundle_version": 1, "context_files_version": 1, "support_requests_version": 1},
        archive_validator=inspect_personal_archive,
    )
