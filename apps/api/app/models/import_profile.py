import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.core.database import Base
from app.models.import_record import utc_now


class ImportProfile(Base):
    __tablename__ = "import_profiles"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False, default="LEARNED")
    source_mode: Mapped[str] = mapped_column(String(24), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="ACTIVE")
    current_revision_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey(
            "import_profile_revisions.id",
            name="fk_import_profiles_current_revision",
            ondelete="SET NULL",
            use_alter=True,
        ),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    revisions = relationship(
        "ImportProfileRevision",
        back_populates="profile",
        cascade="all, delete-orphan",
        foreign_keys="ImportProfileRevision.profile_id",
    )


class ImportProfileRevision(Base):
    __tablename__ = "import_profile_revisions"
    __table_args__ = (UniqueConstraint("profile_id", "revision", name="uq_import_profile_revision"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    profile_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("import_profiles.id", ondelete="CASCADE"), nullable=False
    )
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    matcher_version: Mapped[str] = mapped_column(String(40), nullable=False)
    normalizer_version: Mapped[str] = mapped_column(String(40), nullable=False)
    match_spec: Mapped[dict] = mapped_column(JSON, nullable=False)
    mapping_spec: Mapped[dict] = mapped_column(JSON, nullable=False)
    validation_spec: Mapped[dict] = mapped_column(JSON, nullable=False)
    source_signature: Mapped[dict] = mapped_column(JSON, nullable=False)
    signature_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    configuration_digest: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="VERIFIED")
    supersedes_revision_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("import_profile_revisions.id", ondelete="SET NULL"), nullable=True
    )
    verification_summary: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    profile = relationship("ImportProfile", back_populates="revisions", foreign_keys=[profile_id])


class ImportProfileGrant(Base):
    __tablename__ = "import_profile_grants"

    user_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    revision_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("import_profile_revisions.id", ondelete="CASCADE"), primary_key=True)
    reason: Mapped[str] = mapped_column(String(16), nullable=False)
    acquired_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)


class ImportProfilePublication(Base):
    __tablename__ = "import_profile_publications"

    profile_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("import_profiles.id", ondelete="CASCADE"), primary_key=True)
    revision_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("import_profile_revisions.id", ondelete="RESTRICT"), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    published_by_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    withdrawn_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ImportProfilePreference(Base):
    __tablename__ = "import_profile_preferences"

    user_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    profile_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("import_profiles.id", ondelete="CASCADE"), primary_key=True)
    display_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    hidden: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class ImportProfileAlias(Base):
    __tablename__ = "import_profile_aliases"

    old_profile_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("import_profiles.id", ondelete="CASCADE"), primary_key=True)
    canonical_profile_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("import_profiles.id", ondelete="RESTRICT"), nullable=False, index=True)


class ImportInputGroup(Base):
    __tablename__ = "import_input_groups"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    import_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("imports.id", ondelete="CASCADE"), nullable=False
    )
    mode: Mapped[str] = mapped_column(String(24), nullable=False)
    artifact_ids: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    display_name: Mapped[str] = mapped_column(String(300), nullable=False)
    grouping_status: Mapped[str] = mapped_column(String(24), nullable=False, default="RESOLVED")
    family_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("import_structure_families.id", ondelete="SET NULL"), nullable=True
    )
    profile_resolution: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    diagnostics: Mapped[list[dict]] = mapped_column(JSON, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)

    import_record = relationship("ImportRecord", back_populates="input_groups")
    family = relationship("ImportStructureFamily", back_populates="groups", foreign_keys=[family_id])


class ImportStructureFamily(Base):
    __tablename__ = "import_structure_families"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    import_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("imports.id", ondelete="CASCADE"), nullable=False
    )
    source_mode: Mapped[str] = mapped_column(String(24), nullable=False)
    signature: Mapped[dict] = mapped_column(JSON, nullable=False)
    signature_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    resolution_status: Mapped[str] = mapped_column(String(24), nullable=False)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    matched_profile_key: Mapped[str | None] = mapped_column(String(200), nullable=True)
    matched_profile_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("import_profiles.id", ondelete="SET NULL"), nullable=True
    )
    matched_revision_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("import_profile_revisions.id", ondelete="SET NULL"), nullable=True
    )
    mapping_draft: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    validation_result: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    match_evidence: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now)

    import_record = relationship("ImportRecord", back_populates="structure_families")
    groups = relationship("ImportInputGroup", back_populates="family", foreign_keys=[ImportInputGroup.family_id])


Index("idx_import_profiles_status_mode", ImportProfile.status, ImportProfile.source_mode)
Index("idx_import_profiles_owner_status_mode", ImportProfile.owner_user_id, ImportProfile.status, ImportProfile.source_mode)
Index("idx_import_profile_revisions_digest", ImportProfileRevision.signature_digest)
Index("idx_import_input_groups_import", ImportInputGroup.import_id)
Index("idx_import_structure_families_import", ImportStructureFamily.import_id)
Index("idx_import_structure_families_digest", ImportStructureFamily.signature_digest)
