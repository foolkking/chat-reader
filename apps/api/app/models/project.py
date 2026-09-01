import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.import_record import utc_now


class Project(Base):
    __tablename__ = "projects"
    __table_args__ = (
        UniqueConstraint("owner_user_id", "name", name="uq_projects_owner_name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    color: Mapped[str | None] = mapped_column(Text, nullable=True)
    icon: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
        onupdate=utc_now,
    )
    last_read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    conversations = relationship("ProjectConversation", back_populates="project", cascade="all, delete-orphan")
    recent_items = relationship("RecentItem", back_populates="project")


Index("idx_projects_is_default", Project.is_default)
Index("idx_projects_is_archived", Project.is_archived)
Index("idx_projects_sort_order", Project.sort_order)
Index("idx_projects_created_at", Project.created_at)
Index("idx_projects_last_read_at", Project.last_read_at)
Index("idx_projects_owner_archive_order", Project.owner_user_id, Project.is_archived, Project.sort_order)
Index("idx_projects_owner_last_read", Project.owner_user_id, Project.last_read_at)
Index(
    "uq_projects_owner_default",
    Project.owner_user_id,
    unique=True,
    postgresql_where=Project.is_default.is_(True),
    sqlite_where=Project.is_default.is_(True),
)
