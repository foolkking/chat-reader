"""Revision-scoped format entitlements, personal preferences and publication."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.models.import_profile import (
    ImportProfile, ImportProfileAlias, ImportProfileGrant, ImportProfilePreference,
    ImportProfilePublication, ImportProfileRevision, ImportStructureFamily,
)
from app.services.adaptive_import.profile_identity import normalize_mapping_v1, verification_summary_v1


def canonical_profile_id(db: Session, profile_id: uuid.UUID) -> uuid.UUID:
    seen = set()
    while profile_id not in seen:
        seen.add(profile_id)
        alias = db.get(ImportProfileAlias, profile_id)
        if alias is None:
            return profile_id
        profile_id = alias.canonical_profile_id
    raise ValueError("Import profile alias cycle.")


def related_profile_ids(db: Session, profile_id: uuid.UUID) -> list[uuid.UUID]:
    canonical = canonical_profile_id(db, profile_id)
    return [canonical, *(row[0] for row in db.query(ImportProfileAlias.old_profile_id).filter(
        ImportProfileAlias.canonical_profile_id == canonical))]


def available_revisions(db: Session, user_id: uuid.UUID | None, *, include_disabled: bool = False, admitted_revision_ids: tuple[uuid.UUID, ...] = ()) -> list[tuple[ImportProfile, ImportProfileRevision]]:
    held = select(ImportProfileGrant.revision_id).where(
        ImportProfileGrant.user_id == user_id, ImportProfileGrant.revision_id == ImportProfileRevision.id,
    ).exists()
    public = select(ImportProfilePublication.revision_id).where(
        ImportProfilePublication.revision_id == ImportProfileRevision.id,
        ImportProfilePublication.withdrawn_at.is_(None),
    ).exists()
    revisions = db.query(ImportProfileRevision).join(ImportProfile, ImportProfile.id == ImportProfileRevision.profile_id).options(
        selectinload(ImportProfileRevision.profile)
    ).filter(ImportProfileRevision.status.in_(("VERIFIED", "SUPERSEDED")), or_(held, public, ImportProfile.kind == "BUILTIN", ImportProfileRevision.id.in_(admitted_revision_ids))).all()
    preferences = {row.profile_id: row for row in db.query(ImportProfilePreference).filter_by(user_id=user_id)}
    aliases = dict(db.query(ImportProfileAlias.old_profile_id, ImportProfileAlias.canonical_profile_id).all())
    canonical = {p.id: p for p in db.query(ImportProfile).filter(ImportProfile.id.in_(set(aliases.values())))} if aliases else {}
    result = []
    for revision in revisions:
        profile = canonical.get(aliases.get(revision.profile_id), revision.profile)
        preference = preferences.get(profile.id)
        if profile.status != "ACTIVE" or (preference and (preference.hidden or (not include_disabled and not preference.enabled))):
            continue
        result.append((profile, revision))
    return result


def may_use_revision(db: Session, user_id: uuid.UUID | None, revision_id: uuid.UUID) -> bool:
    return any(revision.id == revision_id for _, revision in available_revisions(db, user_id))


def visible_profile(db: Session, user_id: uuid.UUID | None, profile_id: uuid.UUID) -> ImportProfile | None:
    canonical = canonical_profile_id(db, profile_id)
    return next((profile for profile, _ in available_revisions(db, user_id, include_disabled=True) if profile.id == canonical), None)


def grant_revision(db: Session, user_id: uuid.UUID | None, revision: ImportProfileRevision, *, reason: str, display_name: str | None = None) -> None:
    if user_id is None:
        return
    # A user can import the same public revision in more than one worker job.
    # Upserts preserve the first acquisition and do not race on retry.
    values = {"user_id": user_id, "revision_id": revision.id, "reason": reason, "acquired_at": datetime.now(timezone.utc)}
    if db.bind.dialect.name == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    else:
        from sqlalchemy.dialects.sqlite import insert
    db.execute(insert(ImportProfileGrant).values(**values).on_conflict_do_nothing(index_elements=["user_id", "revision_id"]))
    canonical = canonical_profile_id(db, revision.profile_id)
    preference = db.get(ImportProfilePreference, (user_id, canonical))
    if preference is None:
        publication = db.get(ImportProfilePublication, canonical)
        db.execute(insert(ImportProfilePreference).values(user_id=user_id, profile_id=canonical,
            display_name=display_name or (publication.name if publication else None), enabled=True, hidden=False,
        ).on_conflict_do_nothing(index_elements=["user_id", "profile_id"]))
    elif reason == "LEARNED":
        preference.hidden = False
        preference.enabled = True
        if display_name:
            preference.display_name = display_name
    db.flush()


def grant_successful_import(db: Session, record) -> None:
    for family in db.query(ImportStructureFamily).filter(ImportStructureFamily.import_id == record.id):
        if family.matched_revision_id is not None:
            revision = db.get(ImportProfileRevision, family.matched_revision_id)
            if revision is not None:
                # The server already pinned this version during analysis. A
                # withdrawal while its job runs must not revoke that admission.
                grant_revision(db, record.owner_user_id, revision, reason="USED")


def personal_name(db: Session, user_id: uuid.UUID | None, profile: ImportProfile) -> str:
    preference = db.get(ImportProfilePreference, (user_id, profile.id)) if user_id else None
    publication = db.get(ImportProfilePublication, profile.id)
    return (preference.display_name if preference and preference.display_name else None) or (
        publication.name if publication else f"{profile.source_mode} format"
    )


def personal_profile_payload(db: Session, user_id: uuid.UUID | None, profile: ImportProfile, revisions: list[ImportProfileRevision]) -> dict:
    preference = db.get(ImportProfilePreference, (user_id, profile.id)) if user_id else None
    publication = db.get(ImportProfilePublication, profile.id)
    grants = {row[0] for row in db.query(ImportProfileGrant.revision_id).filter(
        ImportProfileGrant.user_id == user_id, ImportProfileGrant.revision_id.in_([r.id for r in revisions]))}
    unique = {}
    for revision in revisions:
        key = revision.configuration_digest or str(revision.id)
        previous = unique.get(key)
        if previous is None or revision.revision > previous.revision:
            unique[key] = revision
    current = max(unique.values(), key=lambda r: (r.id == profile.current_revision_id, r.created_at, r.revision))
    public = publication is not None and publication.withdrawn_at is None
    return {
        "id": str(profile.id), "key": None, "name": personal_name(db, user_id, profile), "kind": profile.kind,
        "source_mode": profile.source_mode, "status": "ACTIVE" if not preference or preference.enabled else "DISABLED",
        "current_revision": current.revision, "current_revision_id": str(current.id), "revision_count": len(unique),
        "held": bool(grants), "system_provided": public,
        "published_revision_id": str(publication.revision_id) if public else None,
        "verification_summary": verification_summary_v1(current.verification_summary),
        "last_used_at": profile.last_used_at, "updated_at": profile.updated_at,
    }


def revision_payload(revision: ImportProfileRevision, *, current: bool = False) -> dict:
    return {"id": str(revision.id), "revision": revision.revision, "status": revision.status,
            "mapping_spec": normalize_mapping_v1(revision.mapping_spec), "validation_spec": {
                key: revision.validation_spec[key] for key in ("minimum_messages", "content_non_empty", "role_coverage") if key in revision.validation_spec},
            "verification_summary": verification_summary_v1(revision.verification_summary),
            "created_at": revision.created_at, "verified_at": revision.verified_at, "current": current}


def publish_revision(db: Session, *, profile_id: uuid.UUID, revision_id: uuid.UUID, actor_id: uuid.UUID, name: str) -> ImportProfilePublication:
    canonical = canonical_profile_id(db, profile_id)
    profile = db.query(ImportProfile).filter_by(id=canonical).with_for_update().one_or_none()
    revision = db.get(ImportProfileRevision, revision_id)
    if (profile is None or revision is None or profile.kind != "LEARNED"
            or canonical_profile_id(db, revision.profile_id) != canonical or revision.status not in {"VERIFIED", "SUPERSEDED"}
            or revision.verified_at is None or revision.verification_summary.get("valid") is not True
            or not revision.verification_summary.get("group_count")):
        raise ValueError("Only a complete-family verified revision may be published.")
    row = db.get(ImportProfilePublication, canonical)
    if row is None:
        row = ImportProfilePublication(profile_id=canonical, revision_id=revision_id, name=name)
        db.add(row)
    row.revision_id = revision_id
    row.name = name
    row.published_by_user_id = actor_id
    row.published_at = datetime.now(timezone.utc)
    row.withdrawn_at = None
    db.flush()
    return row
