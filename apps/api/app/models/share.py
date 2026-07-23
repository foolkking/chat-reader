import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.core.database import Base
from app.models.import_record import utc_now


class Share(Base):
    __tablename__ = "shares"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("conversations.id", ondelete="CASCADE"),
        nullable=False,
    )
    token_hash: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    token_prefix: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    scope: Mapped[str] = mapped_column(Text, nullable=False, default="conversation")
    selected_message_ids: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    include_toc: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    include_metadata: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    include_description: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    include_annotations: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    include_notebook: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    allow_export: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    theme: Mapped[str] = mapped_column(Text, nullable=False, default="light")
    locale: Mapped[str] = mapped_column(Text, nullable=False, default="zh-CN")
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    access_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_accessed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    created_by: Mapped[str] = mapped_column(Text, nullable=False, default="local")
    metadata_: Mapped[dict] = mapped_column("metadata", JSON, nullable=False, default=dict)

    conversation = relationship("Conversation")


Index("idx_shares_conversation_id", Share.conversation_id)
Index("idx_shares_token_hash", Share.token_hash)
Index("idx_shares_token_prefix", Share.token_prefix)
Index("idx_shares_expires_at", Share.expires_at)
Index("idx_shares_revoked_at", Share.revoked_at)
Index("idx_shares_created_at", Share.created_at)
Index("idx_shares_last_accessed_at", Share.last_accessed_at)
