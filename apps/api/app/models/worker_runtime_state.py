import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.import_record import utc_now


class WorkerRuntimeState(Base):
    __tablename__ = "worker_runtime_states"
    __table_args__ = (
        CheckConstraint("state IN ('idle', 'busy')", name="ck_worker_runtime_states_state"),
        CheckConstraint(
            "task_kind IS NULL OR task_kind IN ('import', 'job')",
            name="ck_worker_runtime_states_task_kind",
        ),
        CheckConstraint(
            "(state = 'idle' AND task_kind IS NULL) OR "
            "(state = 'busy' AND task_kind IS NOT NULL)",
            name="ck_worker_runtime_states_state_task_kind",
        ),
    )

    worker_key: Mapped[str] = mapped_column(String, primary_key=True)
    instance_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    state: Mapped[str] = mapped_column(String, nullable=False, default="idle")
    task_kind: Mapped[str | None] = mapped_column(String, nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    heartbeat_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
