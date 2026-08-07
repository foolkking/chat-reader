import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.core.database import Base
from app.models.import_record import utc_now


class AssetObject(Base):
    __tablename__ = "asset_objects"
    __table_args__ = (
        UniqueConstraint("sha256", "byte_size", name="uq_asset_objects_hash_size"),
        UniqueConstraint("storage_backend", "storage_key", name="uq_asset_objects_storage_key"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    byte_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    detected_mime_type: Mapped[str] = mapped_column(String, nullable=False)
    detected_extension: Mapped[str | None] = mapped_column(String, nullable=True)
    storage_backend: Mapped[str] = mapped_column(String, nullable=False, default="local")
    storage_key: Mapped[str] = mapped_column(Text, nullable=False)
    scan_status: Mapped[str] = mapped_column(String, nullable=False, default="pending")
    status: Mapped[str] = mapped_column(String, nullable=False, default="staging")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    attachments = relationship("Attachment", back_populates="asset_object")


class Attachment(Base):
    __tablename__ = "attachments"
    __table_args__ = (
        UniqueConstraint(
            "conversation_id",
            "source_type",
            "source_attachment_id",
            "import_id",
            name="uq_attachments_conversation_source_identity",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False
    )
    asset_object_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("asset_objects.id", ondelete="SET NULL"), nullable=True
    )
    import_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("imports.id", ondelete="SET NULL"), nullable=True
    )
    original_filename: Mapped[str] = mapped_column(Text, nullable=False)
    display_name: Mapped[str] = mapped_column(Text, nullable=False)
    declared_mime_type: Mapped[str | None] = mapped_column(String, nullable=True)
    detected_mime_type: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False, default="available")
    scan_status: Mapped[str] = mapped_column(String, nullable=False, default="unscanned")
    source_type: Mapped[str] = mapped_column(String, nullable=False, default="bundle")
    source_attachment_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_: Mapped[dict] = mapped_column("metadata", JSON, nullable=False, default=dict)
    resolution_status: Mapped[str] = mapped_column(String, nullable=False, default="resolved")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    asset_object = relationship("AssetObject", back_populates="attachments")
    version_links = relationship("MessageVersionAttachment", back_populates="attachment", cascade="all, delete-orphan")


class MessageVersionAttachment(Base):
    __tablename__ = "message_version_attachments"
    __table_args__ = (
        UniqueConstraint("message_version_id", "occurrence_key", name="uq_message_version_attachment_occurrence"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    message_version_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("message_versions.id", ondelete="CASCADE"), nullable=False
    )
    attachment_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("attachments.id", ondelete="CASCADE"), nullable=False
    )
    occurrence_key: Mapped[str] = mapped_column(String, nullable=False, default=lambda: uuid.uuid4().hex)
    placement: Mapped[str] = mapped_column(String, nullable=False, default="inline")
    relation_type: Mapped[str] = mapped_column(String, nullable=False, default="file")
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    block_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    display_mode: Mapped[str] = mapped_column(String, nullable=False, default="card")
    alt_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    caption: Mapped[str | None] = mapped_column(Text, nullable=True)

    message_version = relationship("MessageVersion", back_populates="attachment_links")
    attachment = relationship("Attachment", back_populates="version_links")


class AttachmentUploadSession(Base):
    __tablename__ = "attachment_upload_sessions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False
    )
    target_message_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("messages.id", ondelete="SET NULL"), nullable=True
    )
    base_message_version_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("message_versions.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[str] = mapped_column(String, nullable=False, default="open")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)

    items = relationship("AttachmentUploadItem", back_populates="session", cascade="all, delete-orphan")


class AttachmentUploadItem(Base):
    __tablename__ = "attachment_upload_items"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("attachment_upload_sessions.id", ondelete="CASCADE"), nullable=False
    )
    client_filename: Mapped[str] = mapped_column(Text, nullable=False)
    declared_mime_type: Mapped[str | None] = mapped_column(String, nullable=True)
    detected_mime_type: Mapped[str | None] = mapped_column(String, nullable=True)
    byte_size: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    temporary_storage_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    validation_status: Mapped[str] = mapped_column(String, nullable=False, default="pending")
    scan_status: Mapped[str] = mapped_column(String, nullable=False, default="pending")
    error_code: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)

    session = relationship("AttachmentUploadSession", back_populates="items")


class AssetDerivative(Base):
    __tablename__ = "asset_derivatives"
    __table_args__ = (
        UniqueConstraint(
            "source_asset_object_id",
            "derivative_type",
            "generator_version",
            name="uq_asset_derivatives_generator",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source_asset_object_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("asset_objects.id", ondelete="CASCADE"), nullable=False
    )
    derivative_asset_object_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("asset_objects.id", ondelete="CASCADE"), nullable=False
    )
    derivative_type: Mapped[str] = mapped_column(String, nullable=False)
    generator: Mapped[str] = mapped_column(String, nullable=False)
    generator_version: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="ready")
    metadata_: Mapped[dict] = mapped_column("metadata", JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)


class AssetObjectLease(Base):
    __tablename__ = "asset_object_leases"
    __table_args__ = (
        UniqueConstraint("asset_object_id", "holder_type", "holder_id", name="uq_asset_object_leases_holder"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    asset_object_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("asset_objects.id", ondelete="CASCADE"), nullable=False
    )
    holder_type: Mapped[str] = mapped_column(String, nullable=False)
    holder_id: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)


Index("idx_asset_objects_status_scan", AssetObject.status, AssetObject.scan_status)
Index("idx_asset_objects_created_at", AssetObject.created_at)
Index("idx_attachments_asset_object_id", Attachment.asset_object_id)
Index("idx_attachments_conversation_status", Attachment.conversation_id, Attachment.status, Attachment.created_at)
Index("idx_attachments_conversation_id_id", Attachment.conversation_id, Attachment.id)
Index("idx_attachments_import_id", Attachment.import_id)
Index("idx_attachments_source_attachment_id", Attachment.source_attachment_id)
Index("idx_message_version_attachments_version", MessageVersionAttachment.message_version_id, MessageVersionAttachment.display_order)
Index("idx_message_version_attachments_attachment", MessageVersionAttachment.attachment_id)
Index("idx_attachment_upload_sessions_conversation", AttachmentUploadSession.conversation_id, AttachmentUploadSession.created_at)
Index("idx_attachment_upload_sessions_expiry", AttachmentUploadSession.status, AttachmentUploadSession.expires_at)
Index("idx_attachment_upload_items_session", AttachmentUploadItem.session_id, AttachmentUploadItem.created_at)
Index("idx_asset_derivatives_source_type", AssetDerivative.source_asset_object_id, AssetDerivative.derivative_type)
Index("idx_asset_object_leases_expiry", AssetObjectLease.expires_at)
