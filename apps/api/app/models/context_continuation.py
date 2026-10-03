"""Derived Context state; canonical messages and attachments are never copied here."""
import uuid
from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Integer, JSON, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.import_record import utc_now


class ContextMemberObject(Base):
    __tablename__ = "context_member_objects"
    sha256: Mapped[str] = mapped_column(String(64), primary_key=True)
    storage_key: Mapped[str] = mapped_column(String(240), unique=True, nullable=False)
    byte_size: Mapped[int] = mapped_column(Integer, nullable=False)


class ContextBinding(Base):
    __tablename__ = "context_bindings"
    __table_args__ = (UniqueConstraint("conversation_id", "identity_digest", name="uq_context_binding_identity"),)
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    conversation_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("conversations.id", ondelete="CASCADE"), index=True)
    identity_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    identity: Mapped[dict] = mapped_column(JSON, nullable=False)
    locator_mapping: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class ContinuationRevision(Base):
    __tablename__ = "continuation_revisions"
    __table_args__ = (
        UniqueConstraint("conversation_id", "digest", name="uq_continuation_revision_content"),
        UniqueConstraint("conversation_id", "branch_key", "protocol_revision", name="uq_continuation_protocol_revision"),
    )
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    conversation_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("conversations.id", ondelete="CASCADE"), index=True)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("continuation_revisions.id", ondelete="SET NULL"))
    branch_key: Mapped[str] = mapped_column(String(64), nullable=False)
    protocol_revision: Mapped[str] = mapped_column(String(160), nullable=False)
    schema_version: Mapped[str] = mapped_column(String(40), nullable=False)
    declared_trust: Mapped[str] = mapped_column(String(40), nullable=False)
    digest: Mapped[str] = mapped_column(String(64), nullable=False)
    current_sha256: Mapped[str | None] = mapped_column(String(64), ForeignKey("context_member_objects.sha256", ondelete="RESTRICT"), index=True)
    index_sha256: Mapped[str | None] = mapped_column(String(64), ForeignKey("context_member_objects.sha256", ondelete="RESTRICT"), index=True)
    source_metadata: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class ContinuationState(Base):
    __tablename__ = "continuation_states"
    __table_args__ = (CheckConstraint("generation >= 0", name="ck_continuation_generation"),)
    conversation_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("conversations.id", ondelete="CASCADE"), primary_key=True)
    generation: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    adopted_revision_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("continuation_revisions.id", ondelete="SET NULL"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class ContinuationCandidate(Base):
    __tablename__ = "continuation_candidates"
    __table_args__ = (
        UniqueConstraint("conversation_id", "idempotency_key", name="uq_continuation_candidate_request"),
        CheckConstraint("input_revision >= 1 AND base_generation >= 0", name="ck_continuation_candidate_versions"),
    )
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    conversation_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("conversations.id", ondelete="CASCADE"), index=True)
    base_revision_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("continuation_revisions.id", ondelete="SET NULL"))
    base_generation: Mapped[int] = mapped_column(BigInteger, nullable=False)
    input_revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    request_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="DRAFT")
    current_sha256: Mapped[str | None] = mapped_column(String(64), ForeignKey("context_member_objects.sha256", ondelete="RESTRICT"), index=True)
    index_sha256: Mapped[str | None] = mapped_column(String(64), ForeignKey("context_member_objects.sha256", ondelete="RESTRICT"), index=True)
    manifest_sha256: Mapped[str | None] = mapped_column(String(64), ForeignKey("context_member_objects.sha256", ondelete="RESTRICT"), index=True)
    inherited_members: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class ContinuationValidation(Base):
    __tablename__ = "continuation_validations"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    candidate_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("continuation_candidates.id", ondelete="CASCADE"), index=True)
    input_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    raw_revision: Mapped[int] = mapped_column(BigInteger, nullable=False)
    checker_version: Mapped[str] = mapped_column(String(64), nullable=False)
    input_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    runtime_state: Mapped[str] = mapped_column(String(40), nullable=False)
    result: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class ContextExportReceipt(Base):
    __tablename__ = "context_export_receipts"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    conversation_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("conversations.id", ondelete="CASCADE"), index=True)
    raw_revision: Mapped[int] = mapped_column(BigInteger, nullable=False)
    projection: Mapped[dict] = mapped_column(JSON, nullable=False)
    message_versions: Mapped[list] = mapped_column(JSON, nullable=False)
    fingerprints: Mapped[dict] = mapped_column(JSON, nullable=False)
    dependency_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
