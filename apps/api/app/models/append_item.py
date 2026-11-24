"""Receipts for *individual* source items, never a continuous sync cursor."""
import uuid

from sqlalchemy import ForeignKey, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class AppendItem(Base):
    __tablename__ = "conversation_append_items"
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), primary_key=True)
    source_key: Mapped[str] = mapped_column(String(64), primary_key=True)
    item_key: Mapped[str] = mapped_column(String(64), primary_key=True)
    signature: Mapped[str] = mapped_column(String(64), primary_key=True)
    # Keep a receipt even if the user later removes the message.
    message_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(), ForeignKey("messages.id", ondelete="SET NULL"))
