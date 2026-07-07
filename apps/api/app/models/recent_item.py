import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.core.database import Base
from app.models.import_record import utc_now


class RecentItem(Base):
    __tablename__ = "recent_items"
    __table_args__ = (UniqueConstraint("conversation_id", name="uq_recent_items_conversation"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("conversations.id", ondelete="CASCADE"),
        nullable=False,
    )
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("projects.id", ondelete="SET NULL"),
        nullable=True,
    )
    last_message_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("messages.id", ondelete="SET NULL"),
        nullable=True,
    )
    last_opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    open_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    context: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    conversation = relationship("Conversation", back_populates="recent_item")
    project = relationship("Project", back_populates="recent_items")
    last_message = relationship("Message")


Index("idx_recent_items_conversation_id", RecentItem.conversation_id)
Index("idx_recent_items_project_id", RecentItem.project_id)
Index("idx_recent_items_last_opened_at", RecentItem.last_opened_at)
Index("idx_recent_items_open_count", RecentItem.open_count)
