import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.core.database import Base
from app.models.import_record import utc_now


class ContentCleanupRule(Base):
    __tablename__ = "content_cleanup_rules"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    kind: Mapped[str] = mapped_column(String(24), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="ACTIVE")
    scope: Mapped[str] = mapped_column(String(24), nullable=False, default="MESSAGE")
    detector_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    revisions = relationship("ContentCleanupRuleRevision", back_populates="rule", cascade="all, delete-orphan")


Index("idx_content_cleanup_rules_status", ContentCleanupRule.status)


class ContentCleanupRuleRevision(Base):
    __tablename__ = "content_cleanup_rule_revisions"
    __table_args__ = (UniqueConstraint("rule_id", "revision", name="uq_content_cleanup_rule_revision"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    rule_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("content_cleanup_rules.id", ondelete="CASCADE"), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    matcher_version: Mapped[str] = mapped_column(String(40), nullable=False, default="noise-v1")
    match_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    case_sensitive: Mapped[bool] = mapped_column(default=True, nullable=False)
    role_filter: Mapped[str | None] = mapped_column(String(24), nullable=True)
    default_decision: Mapped[str] = mapped_column(String(12), nullable=False, default="DELETE")
    supersedes_revision_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("content_cleanup_rule_revisions.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)

    rule = relationship("ContentCleanupRule", back_populates="revisions")


Index("idx_content_cleanup_rule_revisions_rule", ContentCleanupRuleRevision.rule_id)
Index("idx_content_cleanup_rule_revisions_match", ContentCleanupRuleRevision.rule_id, ContentCleanupRuleRevision.match_value)


class ContentCleanupScan(Base):
    __tablename__ = "content_cleanup_scans"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source: Mapped[str] = mapped_column(String(24), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="QUEUED")
    scope_type: Mapped[str] = mapped_column(String(32), nullable=False)
    background_job_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("background_jobs.id", ondelete="SET NULL"), nullable=True)
    progress: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    processed_messages: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_messages: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cursor_message_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    selection_message_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("messages.id", ondelete="CASCADE"), nullable=True
    )
    selection_start_offset: Mapped[int | None] = mapped_column(Integer, nullable=True)
    selection_end_offset: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    dismissed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    targets = relationship("ContentCleanupScanTarget", back_populates="scan", cascade="all, delete-orphan")
    occurrences = relationship("ContentCleanupOccurrence", back_populates="scan", cascade="all, delete-orphan")


Index("idx_content_cleanup_scans_status", ContentCleanupScan.status)
Index("idx_content_cleanup_scans_job", ContentCleanupScan.background_job_id)


class ContentCleanupScanTarget(Base):
    __tablename__ = "content_cleanup_scan_targets"
    __table_args__ = (UniqueConstraint("scan_id", "conversation_id", name="uq_content_cleanup_scan_target"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    scan_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("content_cleanup_scans.id", ondelete="CASCADE"), nullable=False)
    conversation_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False)
    base_conversation_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="PENDING")

    scan = relationship("ContentCleanupScan", back_populates="targets")


Index("idx_content_cleanup_scan_targets_scan_conversation", ContentCleanupScanTarget.scan_id, ContentCleanupScanTarget.conversation_id)
Index("idx_content_cleanup_scan_targets_conversation_scan", ContentCleanupScanTarget.conversation_id, ContentCleanupScanTarget.scan_id)


class ContentCleanupOccurrence(Base):
    __tablename__ = "content_cleanup_occurrences"
    __table_args__ = (
        UniqueConstraint("scan_id", "rule_revision_id", "message_version_id", "start_offset", "end_offset", name="uq_content_cleanup_occurrence"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    scan_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("content_cleanup_scans.id", ondelete="CASCADE"), nullable=False)
    rule_revision_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("content_cleanup_rule_revisions.id", ondelete="RESTRICT"), nullable=False)
    conversation_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False)
    message_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("messages.id", ondelete="CASCADE"), nullable=False)
    message_version_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("message_versions.id", ondelete="CASCADE"), nullable=False)
    start_offset: Mapped[int] = mapped_column(Integer, nullable=False)
    end_offset: Mapped[int] = mapped_column(Integer, nullable=False)
    line_start: Mapped[int] = mapped_column(Integer, nullable=False)
    column_start: Mapped[int] = mapped_column(Integer, nullable=False)
    line_end: Mapped[int] = mapped_column(Integer, nullable=False)
    column_end: Mapped[int] = mapped_column(Integer, nullable=False)
    block_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    kind: Mapped[str] = mapped_column(String(40), nullable=False)
    confidence: Mapped[str] = mapped_column(String(16), nullable=False, default="HIGH")
    reason_code: Mapped[str] = mapped_column(String(80), nullable=False)
    decision: Mapped[str] = mapped_column(String(16), nullable=False, default="DELETE")

    scan = relationship("ContentCleanupScan", back_populates="occurrences")


Index("idx_content_cleanup_occurrences_scan_decision", ContentCleanupOccurrence.scan_id, ContentCleanupOccurrence.decision)
Index("idx_content_cleanup_occurrences_version_offset", ContentCleanupOccurrence.message_version_id, ContentCleanupOccurrence.start_offset)
Index("idx_content_cleanup_occurrences_rule_version", ContentCleanupOccurrence.rule_revision_id, ContentCleanupOccurrence.message_version_id)
Index("idx_content_cleanup_occurrences_conversation_message", ContentCleanupOccurrence.conversation_id, ContentCleanupOccurrence.message_id)
