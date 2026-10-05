from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models.user_skill import UserSkill, UserSkillSelection
from app.services.subject_account import lock_subject_account

MAX_SKILL_BYTES = 512 * 1024
DEFAULT_SUBJECT_KEY = "local:default"
SKILL_CATEGORIES = ("EXPORT_CONTEXT", "CONVERSATION_RESCUE", "CONTEXT_MAINTENANCE")
LEGACY_LOCALES = ("zh-CN", "en")


def lock_skill_scope(db: Session, subject_key: str, category: str) -> None:
    lock_subject_account(db, subject_key)
    # Account FOR SHARE only fences account removal; it permits concurrent writes.
    # Serialize the two legacy preference slots, including their initial creation.
    if db.get_bind().dialect.name == "postgresql":
        key = int.from_bytes(hashlib.sha256(f"personal-skills:{subject_key}:{category}".encode()).digest()[:8], "big", signed=True)
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})


@dataclass(frozen=True)
class BuiltinSkill:
    id: str
    category: str
    locale: str
    name: str
    content_url: str
    bundle_url: str | None = None


BUILTIN_SKILLS = (
    BuiltinSkill("builtin:export:zh-CN", "EXPORT_CONTEXT", "zh-CN", "context-acquisition", "/skills/context-acquisition.md", "/skills/context-acquisition.zip"),
    BuiltinSkill("builtin:export:en", "EXPORT_CONTEXT", "en", "context-acquisition", "/skills/context-acquisition.md", "/skills/context-acquisition.zip"),
    BuiltinSkill("builtin:rescue:zh-CN", "CONVERSATION_RESCUE", "zh-CN", "chat-transcript-normalizer-skill", "/skills/chat-transcript-normalizer-skill.md", "/skills/chat-transcript-normalizer-skill.zip"),
    BuiltinSkill("builtin:rescue:en", "CONVERSATION_RESCUE", "en", "chat-transcript-normalizer-skill", "/skills/chat-transcript-normalizer-skill.md", "/skills/chat-transcript-normalizer-skill.zip"),
    BuiltinSkill("builtin:maintenance:zh-CN", "CONTEXT_MAINTENANCE", "zh-CN", "context-continuation-maintainer", "/skills/context-continuation-maintainer.md", "/skills/context-continuation-maintainer.zip"),
    BuiltinSkill("builtin:maintenance:en", "CONTEXT_MAINTENANCE", "en", "context-continuation-maintainer", "/skills/context-continuation-maintainer.md", "/skills/context-continuation-maintainer.zip"),
)


def _subject(subject_key: str | None) -> str:
    return subject_key or DEFAULT_SUBJECT_KEY


def builtin_for(category: str, locale: str) -> BuiltinSkill:
    for item in BUILTIN_SKILLS:
        if item.category == category and item.locale == locale:
            return item
    raise ValueError("Unsupported skill category or locale.")


def selected_id(db: Session, category: str, locale: str, subject_key: str | None = None) -> uuid.UUID | None:
    return selection_state(db, category, locale, subject_key)[0]


def selection_state(db: Session, category: str, locale: str, subject_key: str | None = None):
    """Read old choices without discarding divergent personal preferences.

    New writes mirror the same choice into both existing compatibility slots.
    A single old choice is unambiguous; distinct old choices stay intact until
    the user explicitly chooses one. Locale is then only a legacy read hint.
    """
    rows = db.scalars(select(UserSkillSelection).where(
        UserSkillSelection.subject_key == _subject(subject_key),
        UserSkillSelection.category == category,
    )).all()
    choices = {row.skill_id for row in rows}
    conflict = len(choices) > 1
    chosen = next((row.skill_id for row in rows if row.locale == locale), None) if conflict else next(iter(choices), None)
    return chosen, conflict, choices - {None}


def clear_skill_selection(db: Session, item: UserSkill) -> None:
    # Do not clear another divergent legacy choice when deleting/disabling one.
    for row in db.scalars(select(UserSkillSelection).where(
        UserSkillSelection.subject_key == item.subject_key,
        UserSkillSelection.skill_id == item.id,
    )):
        row.skill_id = None


def list_skills(db: Session, category: str | None = None, locale: str | None = None, subject_key: str | None = None) -> list[dict]:
    from app.services.feature_policies import get_feature_policy
    from app.services.system_skills import list_system_skills, system_default_for

    subject = _subject(subject_key)
    hint = locale or "zh-CN"
    selected = {cat: selection_state(db, cat, hint, subject) for cat in SKILL_CATEGORIES}
    selected_active = {cat: False for cat in SKILL_CATEGORIES}
    rows: list[dict] = []
    list_system_skills(db)
    system_items = []
    for cat in SKILL_CATEGORIES:
        if category is not None and category != cat:
            continue
        try:
            system_items.append(system_default_for(db, cat, hint)[0])
        except ValueError:
            pass
    effective_ids = set()
    for item in system_items:
        builtin = builtin_for(item.category, item.locale) if item.source_kind == "BUNDLED" else None
        public_id = item.bundled_key if item.source_kind == "BUNDLED" else f"system:{item.id}"
        effective_ids.add(public_id)
        rows.append({
            "id": item.bundled_key if item.source_kind == "BUNDLED" else f"system:{item.id}",
            "source": "BUILTIN" if item.source_kind == "BUNDLED" else "SYSTEM",
            "category": item.category,
            "locale": item.locale,
            "name": item.name,
            "status": item.status,
            "is_selected": public_id in effective_ids,
            "updated_at": item.updated_at,
            "byte_size": item.byte_size,
            "content_url": (
                builtin.content_url
                if builtin and item.content is None
                else f"/api/skills/system/{item.id}/content"
                if item.content is not None and item.status == "ACTIVE"
                else None
            ),
            "is_customized": item.source_kind == "BUNDLED" and item.content is not None,
            "default_enabled": item.default_enabled,
            "bundle_revision": item.bundle_revision,
            "bundle_url": f"/api/skills/system/{item.id}/bundle?revision={item.bundle_revision}" if item.bundle_revision or item.content is not None else builtin.bundle_url if builtin and item.content is None else None,
            "legacy_selection_conflict": selected[item.category][1],
        })
    if not get_feature_policy(db).allow_user_skills:
        return rows
    query = select(UserSkill).where(UserSkill.subject_key == subject)
    if category is not None: query = query.where(UserSkill.category == category)
    for item in db.scalars(query.order_by(UserSkill.updated_at.desc())).all():
        chosen, conflict, old_choices = selected[item.category]
        active_selected = chosen == item.id and item.status == "ACTIVE"
        selected_active[item.category] = selected_active[item.category] or active_selected
        rows.append({"id": str(item.id), "source": "USER", "category": item.category, "locale": item.locale, "name": item.name, "status": item.status, "is_selected": active_selected, "updated_at": item.updated_at, "byte_size": item.byte_size, "content_url": f"/api/skills/{item.id}/content", "is_customized": False, "default_enabled": False, "bundle_revision": item.bundle_revision, "bundle_url": f"/api/skills/{item.id}/bundle?revision={item.bundle_revision}", "legacy_selection_conflict": conflict, "is_legacy_preferred": conflict and item.id in old_choices})
    for row in rows:
        if row["source"] in {"BUILTIN", "SYSTEM"}:
            row["is_selected"] = row["id"] in effective_ids and not selected_active[row["category"]]
    return rows


def create_skill(db: Session, *, category: str, locale: str, name: str, content: str, subject_key: str | None = None, bundle_digest: str | None = None) -> UserSkill:
    if category not in ("EXPORT_CONTEXT", "CONVERSATION_RESCUE", "CONTEXT_MAINTENANCE") or locale not in ("zh-CN", "en"):
        raise ValueError("Unsupported skill category or locale.")
    clean_name = name.strip()
    if not clean_name: raise ValueError("Skill name is required.")
    if not content.strip(): raise ValueError("Skill file must not be empty.")
    size = len(content.encode("utf-8"))
    if size > MAX_SKILL_BYTES: raise ValueError("Skill file exceeds 512 KiB.")
    digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
    subject = _subject(subject_key)
    lock_skill_scope(db, subject, category)
    identity = UserSkill.bundle_digest == bundle_digest if bundle_digest else (UserSkill.bundle_digest.is_(None) & (UserSkill.content_digest == digest))
    existing = db.scalar(select(UserSkill).where(UserSkill.subject_key == subject, UserSkill.category == category, identity))
    if existing is not None: raise KeyError(str(existing.id))
    item = UserSkill(subject_key=subject, category=category, locale=locale, name=clean_name, content=content, byte_size=size, content_digest=digest, bundle_digest=bundle_digest)
    db.add(item); db.flush()
    return item


def get_user_skill(db: Session, skill_id: uuid.UUID, subject_key: str | None = None) -> UserSkill | None:
    lock_subject_account(db, _subject(subject_key))
    return db.scalar(select(UserSkill).where(UserSkill.id == skill_id, UserSkill.subject_key == _subject(subject_key)).execution_options(populate_existing=True))


def update_selection(db: Session, *, category: str, locale: str | None = None, skill_id: uuid.UUID | None, subject_key: str | None = None) -> None:
    subject = _subject(subject_key)
    lock_skill_scope(db, subject, category)
    if skill_id is not None:
        item = get_user_skill(db, skill_id, subject)
        if item is None or item.category != category or item.status != "ACTIVE":
            raise ValueError("Skill is unavailable for selection.")
    if category not in SKILL_CATEGORIES or locale not in (*LEGACY_LOCALES, None):
        raise ValueError("Unsupported skill category or locale.")
    for compatible_locale in LEGACY_LOCALES:
        row = db.get(UserSkillSelection, (subject, category, compatible_locale), populate_existing=True)
        if row is None:
            row = UserSkillSelection(subject_key=subject, category=category, locale=compatible_locale, skill_id=skill_id)
            db.add(row)
        else:
            row.skill_id = skill_id
    db.flush()


def resolve_skill(db: Session, *, category: str, locale: str, subject_key: str | None = None) -> dict:
    from app.services.feature_policies import get_feature_policy
    from app.services.system_skills import system_default_for

    lock_subject_account(db, _subject(subject_key))
    chosen = selected_id(db, category, locale, subject_key)
    item = get_user_skill(db, chosen, subject_key) if chosen and get_feature_policy(db).allow_user_skills else None
    if item is None or item.status != "ACTIVE":
        system_item, builtin = system_default_for(db, category, locale)
        return {
            "id": system_item.bundled_key if system_item.source_kind == "BUNDLED" else f"system:{system_item.id}",
            "source": "BUILTIN" if system_item.source_kind == "BUNDLED" else "SYSTEM",
            "category": category,
            "locale": locale,
            "name": system_item.name,
            "status": system_item.status,
            "is_selected": True,
            "updated_at": system_item.updated_at,
            "byte_size": system_item.byte_size,
            "content_url": (
                builtin.content_url
                if builtin and system_item.content is None
                else f"/api/skills/system/{system_item.id}/content"
            ),
            "content": system_item.content,
            "is_customized": system_item.source_kind == "BUNDLED" and system_item.content is not None,
            "default_enabled": system_item.default_enabled,
            "bundle_revision": system_item.bundle_revision,
            "bundle_url": f"/api/skills/system/{system_item.id}/bundle?revision={system_item.bundle_revision}" if system_item.bundle_revision or system_item.content is not None else builtin.bundle_url if builtin and system_item.content is None else None,
        }
    item.last_used_at = datetime.now(timezone.utc)
    return {"id": str(item.id), "source": "USER", "category": item.category, "locale": item.locale, "name": item.name, "status": item.status, "is_selected": True, "updated_at": item.updated_at, "byte_size": item.byte_size, "content_url": f"/api/skills/{item.id}/content", "content": item.content, "is_customized": False, "default_enabled": False, "bundle_revision": item.bundle_revision, "bundle_url": f"/api/skills/{item.id}/bundle?revision={item.bundle_revision}"}
