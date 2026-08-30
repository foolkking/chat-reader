from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.user_skill import UserSkill, UserSkillSelection

MAX_SKILL_BYTES = 512 * 1024
DEFAULT_SUBJECT_KEY = "local:default"


@dataclass(frozen=True)
class BuiltinSkill:
    id: str
    category: str
    locale: str
    name: str
    content_url: str


BUILTIN_SKILLS = (
    BuiltinSkill("builtin:export:zh-CN", "EXPORT_CONTEXT", "zh-CN", "Chat Reader 导出 Skill（系统默认）", "/skills/chat-reader-conversation-context-acquisition-skill.v1.md"),
    BuiltinSkill("builtin:export:en", "EXPORT_CONTEXT", "en", "Chat Reader Export Skill (System default)", "/skills/chat-reader-conversation-context-acquisition-skill.v1-en.md"),
    BuiltinSkill("builtin:rescue:zh-CN", "CONVERSATION_RESCUE", "zh-CN", "Conversation Rescue（系统默认）", "/import-rescue/Chat_Reader_Conversation_Rescue_Skill_zh.md"),
    BuiltinSkill("builtin:rescue:en", "CONVERSATION_RESCUE", "en", "Conversation Rescue (System default)", "/import-rescue/Chat_Reader_Conversation_Rescue_Skill_en.md"),
)


def _subject(subject_key: str | None) -> str:
    return subject_key or DEFAULT_SUBJECT_KEY


def builtin_for(category: str, locale: str) -> BuiltinSkill:
    for item in BUILTIN_SKILLS:
        if item.category == category and item.locale == locale:
            return item
    raise ValueError("Unsupported skill category or locale.")


def selected_id(db: Session, category: str, locale: str, subject_key: str | None = None) -> uuid.UUID | None:
    row = db.get(UserSkillSelection, (_subject(subject_key), category, locale))
    return row.skill_id if row else None


def list_skills(db: Session, category: str | None = None, locale: str | None = None, subject_key: str | None = None) -> list[dict]:
    subject = _subject(subject_key)
    selected = {(category, locale): selected_id(db, category, locale, subject) for category in ("EXPORT_CONTEXT", "CONVERSATION_RESCUE") for locale in ("zh-CN", "en")}
    selected_active = {(cat, loc): False for cat in ("EXPORT_CONTEXT", "CONVERSATION_RESCUE") for loc in ("zh-CN", "en")}
    builtins = [item for item in BUILTIN_SKILLS if (category is None or item.category == category) and (locale is None or item.locale == locale)]
    rows: list[dict] = []
    for item in builtins:
        rows.append({"id": item.id, "source": "BUILTIN", "category": item.category, "locale": item.locale, "name": item.name, "status": "ACTIVE", "is_selected": selected[(item.category, item.locale)] is None, "updated_at": None, "byte_size": None, "content_url": item.content_url})
    query = select(UserSkill).where(UserSkill.subject_key == subject)
    if category is not None: query = query.where(UserSkill.category == category)
    if locale is not None: query = query.where(UserSkill.locale == locale)
    for item in db.scalars(query.order_by(UserSkill.updated_at.desc())).all():
        active_selected = selected[(item.category, item.locale)] == item.id and item.status == "ACTIVE"
        selected_active[(item.category, item.locale)] = selected_active[(item.category, item.locale)] or active_selected
        rows.append({"id": str(item.id), "source": "USER", "category": item.category, "locale": item.locale, "name": item.name, "status": item.status, "is_selected": active_selected, "updated_at": item.updated_at, "byte_size": item.byte_size, "content_url": f"/api/skills/{item.id}/content"})
    for row in rows:
        if row["source"] == "BUILTIN":
            row["is_selected"] = not selected_active[(row["category"], row["locale"])]
    return rows


def create_skill(db: Session, *, category: str, locale: str, name: str, content: str, subject_key: str | None = None) -> UserSkill:
    if category not in ("EXPORT_CONTEXT", "CONVERSATION_RESCUE") or locale not in ("zh-CN", "en"):
        raise ValueError("Unsupported skill category or locale.")
    clean_name = name.strip()
    if not clean_name: raise ValueError("Skill name is required.")
    if not content.strip(): raise ValueError("Skill file must not be empty.")
    size = len(content.encode("utf-8"))
    if size > MAX_SKILL_BYTES: raise ValueError("Skill file exceeds 512 KiB.")
    digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
    subject = _subject(subject_key)
    existing = db.scalar(select(UserSkill).where(UserSkill.subject_key == subject, UserSkill.category == category, UserSkill.locale == locale, UserSkill.content_digest == digest))
    if existing is not None: raise KeyError(str(existing.id))
    item = UserSkill(subject_key=subject, category=category, locale=locale, name=clean_name, content=content, byte_size=size, content_digest=digest)
    db.add(item); db.flush()
    return item


def get_user_skill(db: Session, skill_id: uuid.UUID, subject_key: str | None = None) -> UserSkill | None:
    return db.scalar(select(UserSkill).where(UserSkill.id == skill_id, UserSkill.subject_key == _subject(subject_key)))


def update_selection(db: Session, *, category: str, locale: str, skill_id: uuid.UUID | None, subject_key: str | None = None) -> None:
    subject = _subject(subject_key)
    if skill_id is not None:
        item = get_user_skill(db, skill_id, subject)
        if item is None or item.category != category or item.locale != locale or item.status != "ACTIVE":
            raise ValueError("Skill is unavailable for selection.")
    row = db.get(UserSkillSelection, (subject, category, locale))
    if row is None:
        row = UserSkillSelection(subject_key=subject, category=category, locale=locale, skill_id=skill_id)
        db.add(row)
    else:
        row.skill_id = skill_id
    db.flush()


def resolve_skill(db: Session, *, category: str, locale: str, subject_key: str | None = None) -> dict:
    builtin = builtin_for(category, locale)
    chosen = selected_id(db, category, locale, subject_key)
    item = get_user_skill(db, chosen, subject_key) if chosen else None
    if item is None or item.status != "ACTIVE":
        return {"id": builtin.id, "source": "BUILTIN", "category": category, "locale": locale, "name": builtin.name, "status": "ACTIVE", "is_selected": True, "updated_at": None, "byte_size": None, "content_url": builtin.content_url, "content": None}
    item.last_used_at = datetime.now(timezone.utc)
    return {"id": str(item.id), "source": "USER", "category": item.category, "locale": item.locale, "name": item.name, "status": item.status, "is_selected": True, "updated_at": item.updated_at, "byte_size": item.byte_size, "content_url": f"/api/skills/{item.id}/content", "content": item.content}
