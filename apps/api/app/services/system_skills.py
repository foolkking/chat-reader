"""Bundled Skill registry plus root-admin owned override records."""

from __future__ import annotations

import hashlib
import uuid

from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.models.administration import SystemSkill
from app.services.skills import BUILTIN_SKILLS, MAX_SKILL_BYTES, BuiltinSkill


def ensure_bundled_system_skills(db: Session) -> list[SystemSkill]:
    existing = {row.bundled_key: row for row in db.query(SystemSkill).filter(SystemSkill.bundled_key.isnot(None)).all()}
    output: list[SystemSkill] = []
    for builtin in BUILTIN_SKILLS:
        row = existing.get(builtin.id)
        if row is None:
            row = SystemSkill(
                skill_key=builtin.id,
                category=builtin.category,
                locale=builtin.locale,
                name=builtin.name,
                source_kind="BUNDLED",
                bundled_key=builtin.id,
                status="ACTIVE",
                default_enabled=True,
            )
            # Concurrent first visits can seed the same built-in. Isolate the
            # unique-key race without rolling back the caller's other changes.
            try:
                with db.begin_nested():
                    db.add(row)
                    db.flush()
            except IntegrityError:
                row = db.query(SystemSkill).filter(SystemSkill.bundled_key == builtin.id).one()
        if row.content is None and row.bundle_revision == 0:
            row.name = builtin.name
        output.append(row)
    return output


def list_system_skills(db: Session) -> list[SystemSkill]:
    ensure_bundled_system_skills(db)
    return db.query(SystemSkill).order_by(SystemSkill.category, SystemSkill.locale, SystemSkill.created_at, SystemSkill.id).all()


def lock_system_category(db: Session, category: str) -> None:
    db.query(SystemSkill).filter(SystemSkill.category == category).order_by(
        SystemSkill.id).with_for_update().populate_existing().all()


def default_candidates(db: Session, category: str) -> list[SystemSkill]:
    """Collapse equivalent legacy aliases without copying or deleting history.

    Divergent old defaults remain available for an explicit administrator choice.
    Comparing the full Bundle digest matters: matching instructions alone can
    hide different scripts or references.
    """
    from app.models.skill_bundle import SkillBundleRevision
    rows = db.query(SystemSkill).filter(
        SystemSkill.category == category, SystemSkill.status == "ACTIVE",
    ).order_by(SystemSkill.locale.desc(), SystemSkill.created_at, SystemSkill.id).all()
    defaults = [row for row in rows if row.default_enabled]
    candidates = defaults or [row for row in rows if row.source_kind == "BUNDLED"] or rows[:1]
    unique = {}
    for row in candidates:
        if row.bundle_revision:
            digest = db.query(SkillBundleRevision.digest).filter_by(
                system_skill_id=row.id, revision=row.bundle_revision).scalar()
            key = ("bundle", digest) if digest else ("unavailable", row.id)
        elif row.content is not None:
            key = ("markdown", row.content_digest)
        else:
            key = ("builtin", row.category)
        unique.setdefault(key, row)
    return list(unique.values())


def effective_system_skills(db: Session):
    from app.services.skills import SKILL_CATEGORIES
    ensure_bundled_system_skills(db)
    result = []
    for category in SKILL_CATEGORIES:
        candidates = default_candidates(db, category)
        result.extend((row, len(candidates) > 1) for row in candidates)
    return result


def create_system_skill(
    db: Session,
    *,
    actor_user_id: uuid.UUID,
    category: str,
    locale: str,
    name: str,
    content: str,
    default_enabled: bool,
) -> SystemSkill:
    _validate_identity(category, locale)
    # Seed before choosing a default; later lazy reads must not introduce a
    # competing built-in default after an administrator has selected one.
    ensure_bundled_system_skills(db)
    lock_system_category(db, category)
    clean_name, clean_content, digest, byte_size = _content_values(name, content)
    key = f"admin:{category.casefold()}:{locale.casefold()}:{uuid.uuid4()}"
    row = SystemSkill(
        skill_key=key,
        category=category,
        locale=locale,
        name=clean_name,
        source_kind="ADMIN_CREATED",
        content=clean_content,
        content_digest=digest,
        byte_size=byte_size,
        status="ACTIVE",
        default_enabled=default_enabled,
        created_by_user_id=actor_user_id,
        updated_by_user_id=actor_user_id,
    )
    db.add(row)
    db.flush()
    if default_enabled:
        _make_only_default(db, row)
    return row


def update_system_skill(
    db: Session,
    row: SystemSkill,
    *,
    actor_user_id: uuid.UUID,
    name: str | None = None,
    content: str | None = None,
    status: str | None = None,
    default_enabled: bool | None = None,
    base_revision: int | None = None,
) -> SystemSkill:
    lock_system_category(db, row.category)
    if content is not None and row.bundle_revision and base_revision != row.bundle_revision:
        raise RuntimeError('Skill changed; reload before replacing its content.')
    if name is not None:
        clean_name = name.strip()
        if not clean_name:
            raise ValueError("Skill name is required.")
        row.name = clean_name
    if content is not None:
        from app.services.skill_bundles import legacy_bundle, save_revision
        _, clean_content, _, _ = _content_values(row.name, content)
        save_revision(db, row, legacy_bundle(clean_content), base_revision=row.bundle_revision)
    if status is not None:
        if status not in {"ACTIVE", "DISABLED"}:
            raise ValueError("Unsupported Skill status.")
        if status == "DISABLED":
            alternatives = db.query(SystemSkill).filter(
                SystemSkill.category == row.category,
                SystemSkill.status == "ACTIVE", SystemSkill.id != row.id,
            ).with_for_update().all()
            if not alternatives:
                raise ValueError("Keep at least one active system Skill for this purpose.")
        row.status = status
        if status == "DISABLED":
            row.default_enabled = False
    if default_enabled is not None:
        if default_enabled and row.status != "ACTIVE":
            raise ValueError("A disabled Skill cannot be the system default.")
        row.default_enabled = default_enabled
        if default_enabled:
            _make_only_default(db, row)
    row.updated_by_user_id = actor_user_id
    db.flush()
    return row


def restore_bundled_system_skill(db: Session, row: SystemSkill, *, actor_user_id: uuid.UUID) -> SystemSkill:
    lock_system_category(db, row.category)
    if row.source_kind != "BUNDLED" or row.bundled_key is None:
        raise ValueError("Only bundled Skills can be restored.")
    builtin = builtin_by_key(row.bundled_key)
    row.name = builtin.name
    row.content = None
    row.bundle_revision = 0
    row.content_digest = None
    row.byte_size = None
    row.status = "ACTIVE"
    row.default_enabled = True
    _make_only_default(db, row)
    row.updated_by_user_id = actor_user_id
    db.flush()
    return row


def system_default_for(db: Session, category: str, locale: str) -> tuple[SystemSkill, BuiltinSkill | None]:
    _validate_identity(category, locale)
    ensure_bundled_system_skills(db)
    rows = default_candidates(db, category)
    # Locale only distinguishes unresolved, non-equivalent historical choices.
    row = next((item for item in rows if item.locale == locale), rows[0] if rows else None) if len(rows) > 1 else next(iter(rows), None)
    if row is None:
        raise ValueError("No active system Skill is available.")
    return row, builtin_by_key(row.bundled_key) if row.bundled_key else None


def builtin_by_key(key: str) -> BuiltinSkill:
    for item in BUILTIN_SKILLS:
        if item.id == key:
            return item
    raise ValueError("Bundled Skill registry entry is unavailable.")


def _make_only_default(db: Session, selected: SystemSkill) -> None:
    for row in db.query(SystemSkill).filter(
        SystemSkill.category == selected.category,
        SystemSkill.id != selected.id,
    ):
        row.default_enabled = False


def _validate_identity(category: str, locale: str) -> None:
    if category not in {"EXPORT_CONTEXT", "CONVERSATION_RESCUE", "CONTEXT_MAINTENANCE"} or locale not in {"zh-CN", "en"}:
        raise ValueError("Unsupported Skill category or locale.")


def _content_values(name: str, content: str) -> tuple[str, str, str, int]:
    clean_name = name.strip()
    if not clean_name:
        raise ValueError("Skill name is required.")
    if not content.strip():
        raise ValueError("Skill content must not be empty.")
    encoded = content.encode("utf-8")
    if len(encoded) > MAX_SKILL_BYTES:
        raise ValueError("Skill content exceeds 512 KiB.")
    return clean_name, content, hashlib.sha256(encoded).hexdigest(), len(encoded)
