"""Noise-rule version grants, personal settings and explicit publication."""
from __future__ import annotations

import hashlib
import json
import uuid
from datetime import timezone

from sqlalchemy import func, or_, select, text
from sqlalchemy.orm import Session, selectinload

from app.models.content_cleanup import ContentCleanupRule as Rule, ContentCleanupRuleRevision as Revision, ContentCleanupRuleGrant as Grant, ContentCleanupRulePublication as Publication, ContentCleanupRulePreference as Preference, ContentCleanupRuleAlias as Alias
from app.models.import_record import utc_now
from app.services.cleanup_rule_identity import MATCH_FIELDS, configuration_digest_v1, literal_configuration
from app.services.ownership import OwnershipScope


def canonical_rule_id(db: Session, rule_id: uuid.UUID) -> uuid.UUID:
    seen = set()
    while rule_id not in seen:
        seen.add(rule_id)
        alias = db.get(Alias, rule_id)
        if alias is None:
            return rule_id
        rule_id = alias.canonical_rule_id
    raise ValueError("Noise rule alias cycle.")


def related_rule_ids(db: Session, rule_id: uuid.UUID) -> list[uuid.UUID]:
    canonical = canonical_rule_id(db, rule_id)
    return [canonical, *(item[0] for item in db.query(Alias.old_rule_id).filter_by(canonical_rule_id=canonical))]


def available_versions(db: Session, scope: OwnershipScope, *, include_disabled=False, include_hidden=False) -> dict:
    held = select(Grant.revision_id).where(Grant.user_id == scope.owner_user_id, Grant.revision_id == Revision.id).exists()
    public = select(Publication.revision_id).where(Publication.revision_id == Revision.id, Publication.withdrawn_at.is_(None)).exists()
    revisions = db.query(Revision).join(Rule, Rule.id == Revision.rule_id).options(selectinload(Revision.rule)).filter(
        or_(held, public, Rule.kind == "BUILTIN"), Rule.status == "ACTIVE",
        or_(Rule.detector_id.is_(None), Rule.detector_id != "manual-selection-v1")).all()
    preferences = {item.rule_id: item for item in db.query(Preference).filter_by(user_id=scope.owner_user_id)}
    aliases = dict(db.query(Alias.old_rule_id, Alias.canonical_rule_id))
    canonical = {item.id: item for item in db.query(Rule).filter(Rule.id.in_(set(aliases.values())))} if aliases else {}
    grouped = {}
    for revision in revisions:
        rule = canonical.get(aliases.get(revision.rule_id), revision.rule)
        preference = preferences.get(rule.id)
        if preference and ((preference.hidden and not include_hidden) or (not preference.enabled and not include_disabled)):
            continue
        if rule.id not in grouped:
            grouped[rule.id] = (rule, [], preference)
        grouped[rule.id][1].append(revision)
    return grouped


def effective_revision(revisions: list[Revision], preference: Preference | None) -> Revision:
    preferred = preference.current_revision_id if preference else None
    # Revision ordinal is allocated under the canonical rule lock. Date is only
    # a tie-breaker for aliased historical revision sets, never a user clock.
    return max(revisions, key=lambda item: (item.id == preferred, item.revision, item.created_at, str(item.id)))


def current_rule(db: Session, scope: OwnershipScope, rule_id: uuid.UUID, *, include_hidden=False):
    group = available_versions(db, scope, include_disabled=True, include_hidden=include_hidden).get(canonical_rule_id(db, rule_id))
    if group is None:
        raise LookupError("Noise rule not found.")
    rule, revisions, preference = group
    return rule, effective_revision(revisions, preference), preference


def personal_name(db: Session, user_id: uuid.UUID | None, rule: Rule) -> str:
    canonical = canonical_rule_id(db, rule.id)
    if rule.kind == "BUILTIN":
        return rule.name
    preference = db.get(Preference, (user_id, canonical)) if user_id else None
    publication = db.get(Publication, canonical)
    return (preference.display_name if preference else None) or (publication.name if publication else None) or "Learned text rule"


def personal_edit_token(db: Session, scope: OwnershipScope, rule: Rule, revision: Revision) -> str:
    canonical = canonical_rule_id(db, rule.id)
    preference = db.get(Preference, (scope.owner_user_id, canonical)) if scope.owner_user_id else None
    updated = preference.updated_at if preference else None
    if updated:
        updated = updated.replace(tzinfo=timezone.utc) if updated.tzinfo is None else updated.astimezone(timezone.utc)
    state = {"owner": str(scope.owner_user_id), "rule": str(canonical), "revision": str(revision.id),
        "name": personal_name(db, scope.owner_user_id, rule), "status": rule.status,
        "enabled": preference.enabled if preference else True, "hidden": preference.hidden if preference else False,
        "updated_at": updated.isoformat(timespec="microseconds") if updated else None}
    return hashlib.sha256(json.dumps(state, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def _locked_current_rule(db: Session, scope: OwnershipScope, canonical: uuid.UUID):
    # A session may have read this preference before waiting for the rule lock.
    db.query(Rule).filter_by(id=canonical).populate_existing().with_for_update().first()
    if scope.owner_user_id:
        db.get(Preference, (scope.owner_user_id, canonical), populate_existing=True)
    db.get(Publication, canonical, populate_existing=True)
    return current_rule(db, scope, canonical)


def rule_payload(db: Session, scope: OwnershipScope, rule: Rule, revision: Revision) -> dict:
    canonical = canonical_rule_id(db, rule.id)
    preference = db.get(Preference, (scope.owner_user_id, canonical)) if scope.owner_user_id else None
    publication = db.get(Publication, canonical)
    revision_held = db.get(Grant, (scope.owner_user_id, revision.id)) is not None if scope.owner_user_id else False
    held = db.query(Grant.revision_id).join(Revision, Revision.id == Grant.revision_id).filter(
        Grant.user_id == scope.owner_user_id, Revision.rule_id.in_(related_rule_ids(db, canonical))).first() is not None
    return {"id": canonical, "name": personal_name(db, scope.owner_user_id, rule), "kind": rule.kind,
        "edit_token": personal_edit_token(db, scope, rule, revision),
        "status": "DISABLED" if preference and not preference.enabled else rule.status,
        "scope": rule.scope, "detector_id": rule.detector_id, "revision": revision.revision, "revision_id": revision.id,
        **{key: getattr(revision, key) for key in ("match_value", "case_sensitive", "role_filter", "matcher_mode", "normalization_profile", "boundary_mode")},
        "last_used_at": rule.last_used_at, "held": held, "revision_held": revision_held, "system_provided": bool(publication and publication.withdrawn_at is None),
        "published_revision_id": publication.revision_id if publication and publication.withdrawn_at is None else None}


def _insert(db):
    if db.bind.dialect.name == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    else:
        from sqlalchemy.dialects.sqlite import insert
    return insert


def grant_revision(db: Session, scope: OwnershipScope, revision: Revision, *, reason: str, name: str | None = None) -> None:
    if scope.owner_user_id is None or revision.rule.kind == "BUILTIN":
        return
    canonical = canonical_rule_id(db, revision.rule_id)
    if reason == "LEARNED":
        db.query(Rule).filter_by(id=canonical).populate_existing().with_for_update().one()
    insert = _insert(db)
    db.execute(insert(Grant).values(user_id=scope.owner_user_id, revision_id=revision.id, reason=reason, acquired_at=utc_now()).on_conflict_do_nothing(index_elements=["user_id", "revision_id"]))
    publication = db.get(Publication, canonical)
    db.execute(insert(Preference).values(user_id=scope.owner_user_id, rule_id=canonical, enabled=True, hidden=False,
        display_name=name or (publication.name if publication else None), current_revision_id=revision.id, updated_at=utc_now()).on_conflict_do_nothing(index_elements=["user_id", "rule_id"]))
    if reason == "LEARNED":
        preference = db.get(Preference, (scope.owner_user_id, canonical), populate_existing=True)
        preference.hidden = False
        preference.enabled = True
        preference.current_revision_id = revision.id
        if name:
            preference.display_name = name
        preference.updated_at = utc_now()
    db.flush()


def _configuration_lock(db: Session, digest: str) -> None:
    if db.bind.dialect.name == "postgresql":
        key = int.from_bytes(hashlib.sha256(f"cleanup-rule:{digest}".encode()).digest()[:8], "big", signed=True)
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})


def learn_literal(db: Session, scope: OwnershipScope, *, name: str, match_value: str, **options) -> tuple[Rule, Revision]:
    from app.services.content_cleanup import validate_literal_rule
    config = literal_configuration(match_value, **options)
    validate_literal_rule(config["match_value"], config["matcher_mode"])
    if not name.strip():
        raise ValueError("A rule name is required.")
    digest = configuration_digest_v1(config)
    _configuration_lock(db, digest)
    revision = db.query(Revision).join(Rule, Rule.id == Revision.rule_id).filter(
        Revision.configuration_digest == digest, Rule.kind == "USER_LITERAL").order_by(Revision.created_at, Revision.id).first()
    if revision is None:
        rule = Rule(owner_user_id=scope.owner_user_id, name=name.strip(), kind="USER_LITERAL", status="ACTIVE", scope="MESSAGE")
        db.add(rule)
        db.flush()
        revision = Revision(rule_id=rule.id, revision=1, **config, configuration_digest=digest,
            created_by_user_id=scope.owner_user_id, default_decision="KEEP")
        db.add(revision)
        db.flush()
    else:
        rule = db.get(Rule, canonical_rule_id(db, revision.rule_id))
    grant_revision(db, scope, revision, reason="LEARNED", name=name.strip())
    return rule, revision


def update_personal_rule(db: Session, scope: OwnershipScope, rule_id: uuid.UUID, changes: dict) -> tuple[Rule, Revision]:
    from app.services.content_cleanup import validate_literal_rule
    canonical = canonical_rule_id(db, rule_id)
    rule, revision, preference = _locked_current_rule(db, scope, canonical)
    if rule.kind == "BUILTIN" and set(changes) - {"status", "base_edit_token"}:
        raise PermissionError("Built-in rules can only be enabled or disabled for your account.")
    if changes.get("base_edit_token") is not None and changes["base_edit_token"] != personal_edit_token(db, scope, rule, revision):
        raise ValueError("Rule changed on another device. Reload the saved version; your draft can be kept.")
    if changes.get("base_revision_id") and changes["base_revision_id"] != revision.id:
        raise ValueError("Rule changed on another device. Reload the saved version; your draft can be kept.")
    if changes.get("base_revision") is not None and changes["base_revision"] != revision.revision:
        raise ValueError("Rule changed on another device. Reload the saved version; your draft can be kept.")
    if preference is None:
        preference = Preference(user_id=scope.owner_user_id, rule_id=canonical, enabled=True, hidden=False)
        db.add(preference)
        db.flush()
    if changes.get("name") is not None:
        if not changes["name"].strip():
            raise ValueError("A rule name is required.")
        preference.display_name = changes["name"].strip()
    if changes.get("status"):
        preference.enabled = changes["status"] == "ACTIVE"
    config_fields = {"match_value", "case_sensitive", "role_filter", "matcher_mode", "boundary_mode"}
    if set(changes) & config_fields:
        config = literal_configuration(**{key: changes[key] if key in changes and (changes[key] is not None or key == "role_filter") else getattr(revision, key) for key in config_fields})
        validate_literal_rule(config["match_value"], config["matcher_mode"])
        digest = configuration_digest_v1(config)
        # Reuse an equivalent version within this identity; preserve independent
        # identity lineages when two previously different rules converge.
        related = related_rule_ids(db, canonical)
        equivalent = db.query(Revision).filter(Revision.rule_id.in_(related), Revision.configuration_digest == digest).order_by(Revision.revision.desc()).first()
        base = revision
        if equivalent is None:
            ordinal = db.query(func.max(Revision.revision)).filter(Revision.rule_id.in_(related)).scalar() or 0
            revision = Revision(rule_id=canonical, revision=ordinal + 1, **config, configuration_digest=digest,
                created_by_user_id=scope.owner_user_id, default_decision="KEEP", supersedes_revision_id=base.id)
            db.add(revision)
            db.flush()
        else:
            revision = equivalent
        enabled = preference.enabled
        grant_revision(db, scope, base, reason="BASE")
        grant_revision(db, scope, revision, reason="LEARNED", name=preference.display_name)
        # Editing an existing rule is independent of its switch. Explicit status
        # changes were already applied above; fresh/repeated learning still enables.
        preference.enabled = enabled
    if changes.get("current_revision_id"):
        group = available_versions(db, scope, include_disabled=True).get(canonical)
        selected = next((item for item in group[1] if item.id == changes["current_revision_id"]), None) if group else None
        if selected is None:
            raise LookupError("Noise rule version not found.")
        preference.current_revision_id = selected.id
        revision = selected
    db.flush()
    return rule, revision


def hide_personal_rule(db: Session, scope: OwnershipScope, rule_id: uuid.UUID) -> None:
    try:
        rule, _revision, preference = _locked_current_rule(db, scope, canonical_rule_id(db, rule_id))
    except LookupError:
        return
    if rule.kind == "BUILTIN":
        raise ValueError("Built-in noise rules cannot be deleted.")
    if preference is None:
        preference = Preference(user_id=scope.owner_user_id, rule_id=rule.id, enabled=False, hidden=True)
        db.add(preference)
    else:
        preference.enabled = False
        preference.hidden = True
    db.flush()


class PublicationConflict(ValueError):
    """A publication changed since the administrator read it."""


def publication_token(rule_id: uuid.UUID, publication: Publication | None) -> str:
    def timestamp(value):
        if value is None:
            return None
        value = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
        return value.isoformat(timespec="microseconds")
    state = {"rule_id": str(rule_id), "publication": None if publication is None else {
        "revision_id": str(publication.revision_id), "name": publication.name,
        "published_at": timestamp(publication.published_at), "withdrawn_at": timestamp(publication.withdrawn_at)}}
    return hashlib.sha256(json.dumps(state, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def _locked_publication(db: Session, rule_id: uuid.UUID, base: str | None):
    canonical = canonical_rule_id(db, rule_id)
    rule = db.query(Rule).filter_by(id=canonical).populate_existing().with_for_update().first()
    if rule is None or rule.kind != "USER_LITERAL":
        raise LookupError("Noise rule not found.")
    # A Session may have loaded this row before waiting for the rule lock.
    publication = db.query(Publication).filter_by(rule_id=canonical).populate_existing().first()
    if base is not None and base != publication_token(canonical, publication):
        raise PublicationConflict("Publication changed. Read the current publication before retrying.")
    return rule, publication


def withdraw_rule(db: Session, rule_id: uuid.UUID, base_publication_token: str | None = None) -> bool:
    _rule, publication = _locked_publication(db, rule_id, base_publication_token)
    changed = publication is not None and publication.withdrawn_at is None
    if changed:
        publication.withdrawn_at = utc_now()
        db.flush()
    return changed


def publish_rule(db: Session, rule_id: uuid.UUID, revision_id: uuid.UUID, actor_id: uuid.UUID, name: str, base_publication_token: str | None = None) -> Publication:
    from app.services.content_cleanup import validate_literal_rule
    rule, publication = _locked_publication(db, rule_id, base_publication_token)
    canonical = rule.id
    revision = db.get(Revision, revision_id)
    if rule is None or rule.kind != "USER_LITERAL" or revision is None or canonical_rule_id(db, revision.rule_id) != canonical:
        raise LookupError("Noise rule version not found.")
    if not name.strip():
        raise ValueError("Publication name is required.")
    validate_literal_rule(revision.match_value or "", revision.matcher_mode)
    if revision.configuration_digest != configuration_digest_v1({key: getattr(revision, key) for key in MATCH_FIELDS}, scope=rule.scope):
        raise ValueError("Rule configuration has not passed validation.")
    if publication is None:
        publication = Publication(rule_id=canonical, revision_id=revision_id, name=name.strip())
        db.add(publication)
    publication.revision_id = revision_id
    publication.name = name.strip()
    publication.published_by_user_id = actor_id
    publication.published_at = utc_now()
    publication.withdrawn_at = None
    db.flush()
    return publication
