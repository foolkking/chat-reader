from __future__ import annotations

import uuid

from app.core.database import get_db
from app.main import app
import pytest

from app.models.attachment import AssetObject, Attachment, MessageVersionAttachment
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.render_block import RenderBlock
from app.services.editing.attachment_integrity import audit_conversation_attachment_integrity
from app.services.editing.attachment_reference_repair import (
    AttachmentReferenceRepairError,
    apply_unique_attachment_reference_repair,
    plan_unique_attachment_reference_repair,
)
from test_import_preview_api import client  # noqa: F401


def test_attachment_integrity_audits_current_and_historical_versions(client) -> None:
    override = app.dependency_overrides[get_db]
    generator = override()
    db = next(generator)
    try:
        conversation_id = uuid.uuid4()
        message_id = uuid.uuid4()
        attachment_id = uuid.uuid4()
        historical_version_id = uuid.uuid4()
        current_version_id = uuid.uuid4()
        conversation = Conversation(
            id=conversation_id,
            title="Integrity fixture",
            display_title="Integrity fixture",
            source_type="test",
            source_profile="test",
            parser_version="test-v1",
        )
        message = Message(
            id=message_id,
            conversation=conversation,
            role="assistant",
            order_key="0001",
        )
        attachment = Attachment(
            id=attachment_id,
            conversation_id=conversation_id,
            original_filename="fixture.txt",
            display_name="fixture.txt",
            source_type="test",
        )
        missing_attachment_id = uuid.uuid4()
        historical = MessageVersion(
            id=historical_version_id,
            message=message,
            version_number=1,
            plain_text="Historical reference",
            display_text=f"[Missing](cr-asset://{missing_attachment_id})",
            blocks=[],
            edit_type="import",
            content_hash="historical",
        )
        current = MessageVersion(
            id=current_version_id,
            message=message,
            version_number=2,
            plain_text="Current reference",
            display_text=f"[Current](cr-asset://{attachment_id})",
            blocks=[],
            edit_type="edit",
            content_hash="current",
        )
        db.add_all([conversation, message, attachment, historical, current])
        db.flush()
        message.current_version_id = current.id
        db.add(
            RenderBlock(
                message_version_id=current.id,
                block_index=0,
                block_type="paragraph",
                plain_text=current.display_text,
                data={"text": current.display_text},
            )
        )
        stale_link = MessageVersionAttachment(
            message_version_id=historical.id,
            attachment_id=attachment.id,
            occurrence_key="historical-occurrence",
            block_index=99,
        )
        db.add(stale_link)
        db.commit()

        issues = audit_conversation_attachment_integrity(db, conversation.id)
        by_code = {code: [issue for issue in issues if issue.code == code] for code in {
            "TEXT_REFERENCE_WITHOUT_ATTACHMENT",
            "ATTACHMENT_WITHOUT_CURRENT_OCCURRENCE",
            "OCCURRENCE_WITHOUT_BLOCK",
            "OCCURRENCE_ON_STALE_VERSION",
        }}

        assert by_code["TEXT_REFERENCE_WITHOUT_ATTACHMENT"][0].message_version_id == historical.id
        assert by_code["TEXT_REFERENCE_WITHOUT_ATTACHMENT"][0].attachment_id == missing_attachment_id
        assert by_code["ATTACHMENT_WITHOUT_CURRENT_OCCURRENCE"][0].message_version_id == current.id
        assert by_code["ATTACHMENT_WITHOUT_CURRENT_OCCURRENCE"][0].attachment_id == attachment.id
        assert by_code["OCCURRENCE_WITHOUT_BLOCK"][0].occurrence_id == stale_link.id
        assert by_code["OCCURRENCE_ON_STALE_VERSION"][0].occurrence_id == stale_link.id
        assert all(issue.conversation_id == conversation.id for issue in issues)
    finally:
        db.close()
        generator.close()


def test_unique_attachment_reference_repair_is_versioned_and_fail_closed(client) -> None:
    override = app.dependency_overrides[get_db]
    generator = override()
    db = next(generator)
    try:
        conversation_id = uuid.uuid4()
        message_id = uuid.uuid4()
        stale_attachment_id = uuid.uuid4()
        target_attachment_id = uuid.uuid4()
        version_id = uuid.uuid4()
        asset_id = uuid.uuid4()
        conversation = Conversation(
            id=conversation_id,
            title="Repair fixture",
            display_title="Repair fixture",
            source_type="merged",
            source_profile="merged",
            parser_version="test-v1",
        )
        message = Message(
            id=message_id,
            conversation=conversation,
            role="assistant",
            order_key="0001",
            current_version_id=version_id,
        )
        original_text = f"[Recovered file](cr-asset://{stale_attachment_id})"
        version = MessageVersion(
            id=version_id,
            message=message,
            version_number=1,
            plain_text=original_text,
            display_text=original_text,
            blocks=[],
            edit_type="merged",
            content_hash="before-repair",
        )
        asset = AssetObject(
            id=asset_id,
            sha256="a" * 64,
            byte_size=8,
            detected_mime_type="text/plain",
            storage_backend="local",
            storage_key="test/repair-fixture.txt",
            scan_status="clean",
            status="available",
        )
        attachment = Attachment(
            id=target_attachment_id,
            conversation_id=conversation_id,
            asset_object_id=asset_id,
            original_filename="repair-fixture.txt",
            display_name="repair-fixture.txt",
            source_type="conversation_merge",
            source_attachment_id=str(stale_attachment_id),
            status="available",
            scan_status="clean",
            resolution_status="resolved",
        )
        db.add_all([conversation, message, version, asset, attachment])
        db.commit()

        plan = plan_unique_attachment_reference_repair(db, conversation_id)
        assert plan.applicable is True
        assert plan.repairable_message_count == 1
        assert plan.repairable_reference_count == 1
        with pytest.raises(AttachmentReferenceRepairError, match="token"):
            apply_unique_attachment_reference_repair(
                db,
                conversation_id,
                confirmation_token="stale-token",
            )
        assert db.get(Message, message_id).current_version_id == version_id

        repaired = apply_unique_attachment_reference_repair(
            db,
            conversation_id,
            confirmation_token=plan.confirmation_token,
        )
        db.commit()
        assert repaired == 1
        db.refresh(message)
        repaired_version = db.get(MessageVersion, message.current_version_id)
        assert repaired_version is not None
        assert repaired_version.id != version_id
        assert repaired_version.based_on_version_id == version_id
        assert repaired_version.edit_type == "attachment_reference_repair"
        assert str(stale_attachment_id) not in repaired_version.display_text
        assert str(target_attachment_id) in repaired_version.display_text
        assert db.get(MessageVersion, version_id).display_text == original_text
        occurrence = (
            db.query(MessageVersionAttachment)
            .filter(MessageVersionAttachment.message_version_id == repaired_version.id)
            .one()
        )
        assert occurrence.attachment_id == target_attachment_id
        assert all(
            issue.message_version_id != repaired_version.id
            for issue in audit_conversation_attachment_integrity(db, conversation_id)
            if issue.code in {"TEXT_REFERENCE_WITHOUT_ATTACHMENT", "ATTACHMENT_WITHOUT_CURRENT_OCCURRENCE"}
        )

        db.add(Attachment(
            id=uuid.uuid4(),
            conversation_id=conversation_id,
            asset_object_id=asset_id,
            original_filename="ambiguous.txt",
            display_name="ambiguous.txt",
            source_type="conversation_split",
            source_attachment_id=str(stale_attachment_id),
            status="available",
            scan_status="clean",
            resolution_status="resolved",
        ))
        message.current_version_id = version_id
        db.commit()
        ambiguous = plan_unique_attachment_reference_repair(db, conversation_id)
        assert ambiguous.applicable is False
        assert ambiguous.ambiguous_reference_ids == (stale_attachment_id,)
        with pytest.raises(AttachmentReferenceRepairError, match="not uniquely resolvable"):
            apply_unique_attachment_reference_repair(
                db,
                conversation_id,
                confirmation_token=ambiguous.confirmation_token,
            )
        assert db.get(Message, message_id).current_version_id == version_id
    finally:
        db.rollback()
        db.close()
        generator.close()
