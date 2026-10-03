"""Immutable Skill revisions and content-addressed, non-executable members."""
import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.import_record import utc_now


class SkillFileObject(Base):
    __tablename__ = "skill_file_objects"
    sha256: Mapped[str] = mapped_column(String(64), primary_key=True)
    storage_key: Mapped[str] = mapped_column(String(240), unique=True, nullable=False)
    byte_size: Mapped[int] = mapped_column(Integer, nullable=False)


class SkillBundleRevision(Base):
    __tablename__ = "skill_bundle_revisions"
    __table_args__ = (
        CheckConstraint("(user_skill_id IS NULL) <> (system_skill_id IS NULL)", name="ck_skill_revision_one_owner"),
        UniqueConstraint("user_skill_id", "revision", name="uq_user_skill_revision"),
        UniqueConstraint("system_skill_id", "revision", name="uq_system_skill_revision"),
    )
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_skill_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("user_skills.id", ondelete="CASCADE"))
    system_skill_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("system_skills.id", ondelete="CASCADE"))
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    digest: Mapped[str] = mapped_column(String(64), nullable=False)
    root_name: Mapped[str] = mapped_column(String(100), nullable=False)
    source_kind: Mapped[str] = mapped_column(String(24), nullable=False)
    byte_size: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class SkillBundleMember(Base):
    __tablename__ = "skill_bundle_members"
    revision_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("skill_bundle_revisions.id", ondelete="CASCADE"), primary_key=True)
    path: Mapped[str] = mapped_column(String(240), primary_key=True)
    object_sha256: Mapped[str] = mapped_column(String(64), ForeignKey("skill_file_objects.sha256", ondelete="RESTRICT"), nullable=False, index=True)
