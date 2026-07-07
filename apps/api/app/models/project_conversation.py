import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.import_record import utc_now


class ProjectConversation(Base):
    __tablename__ = "project_conversations"
    __table_args__ = (UniqueConstraint("project_id", "conversation_id", name="uq_project_conversations_project_conversation"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("conversations.id", ondelete="CASCADE"),
        nullable=False,
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    pinned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    added_by: Mapped[str] = mapped_column(Text, nullable=False, default="system")

    project = relationship("Project", back_populates="conversations")
    conversation = relationship("Conversation", back_populates="project_links")


Index("idx_project_conversations_project_id", ProjectConversation.project_id)
Index("idx_project_conversations_conversation_id", ProjectConversation.conversation_id)
Index("idx_project_conversations_is_pinned", ProjectConversation.is_pinned)
Index("idx_project_conversations_pinned_at", ProjectConversation.pinned_at)
Index("idx_project_conversations_added_at", ProjectConversation.added_at)
Index("idx_project_conversations_sort_order", ProjectConversation.sort_order)
