"""One execution slot, independent from long-lived canonical task row locks."""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class TaskExecutionControl(Base):
    __tablename__ = "task_execution_controls"
    slot: Mapped[str] = mapped_column(String(32), primary_key=True, default="primary")
    token: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), nullable=False, unique=True)
    task_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    task_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    attempt: Mapped[int] = mapped_column(Integer, nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    progress_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    stop_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    stop_reason: Mapped[str | None] = mapped_column(String(48))
    source_disposition: Mapped[str | None] = mapped_column(String(16))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
