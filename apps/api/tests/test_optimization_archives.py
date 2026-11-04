from pathlib import Path
from uuid import uuid4

from app.models.message import Message
from app.models.reading_content_baseline import ReadingContentBaseline, ReadingContentBaselineMessage
from app.models.user_feature_entry import UserFeatureEntry
from app.models.user_preference import UserPreference
from app.services.exporting.archive_preflight import inspect_personal_archive
from app.services.exporting.personal_archive import create_personal_archive
from app.services.exporting.personal_restore import restore_personal_archive
from test_system_archive_integrity import archive_db, seed_archive_source  # noqa: F401


def test_personal_collection_archive_round_trip_remaps_and_deduplicates(archive_db):
    users, conversations, job, _ = seed_archive_source(archive_db)
    owner, target = users
    source = conversations[0]
    subject = str(owner.id)
    archive_db.add(UserPreference(subject_key=subject))
    archive_db.flush()
    tag_id = uuid4()
    archive_db.add_all([
        UserFeatureEntry(id=tag_id, subject_key=subject, collection="conversation-tag", value={"name": "Synthetic", "conversation_ids": [str(source.id)]}),
        UserFeatureEntry(subject_key=subject, collection="reading-list", value={"conversation_id": str(source.id), "state": "read"}),
        UserFeatureEntry(subject_key=subject, collection="saved-search", value={"name": "Find", "q": "synthetic", "tag_id": str(tag_id)}),
    ])
    baseline = ReadingContentBaseline(subject_key=subject, conversation_id=source.id)
    archive_db.add(baseline)
    archive_db.flush()
    message = archive_db.query(Message).filter_by(conversation_id=source.id).first()
    archive_db.add(ReadingContentBaselineMessage(baseline_id=baseline.id, message_id=message.id))
    archive_db.commit()
    artifact = create_personal_archive(archive_db, job_id=job.id, owner_user_id=owner.id)
    archive_db.commit()
    path = Path(artifact.storage_uri)
    preview = inspect_personal_archive(path)
    assert preview["personal_collections_included"]
    assert preview["counts"]["user_features"] == 3
    result = restore_personal_archive(archive_db, path, owner_user_id=target.id, expected_digest=preview["content_digest"])
    archive_db.commit()
    entries = {row.collection: row for row in archive_db.query(UserFeatureEntry).filter_by(subject_key=str(target.id))}
    new_conversation = result["conversation_ids"][0]
    assert new_conversation != str(source.id)
    assert entries["reading-list"].value["conversation_id"] == new_conversation
    assert entries["conversation-tag"].value["conversation_ids"] == [new_conversation]
    assert entries["saved-search"].value["tag_id"] == str(entries["conversation-tag"].id)
    assert archive_db.query(ReadingContentBaseline).filter_by(subject_key=str(target.id)).count() == 1
    assert restore_personal_archive(archive_db, path, owner_user_id=target.id, expected_digest=preview["content_digest"])["already_restored"]
    assert archive_db.query(UserFeatureEntry).filter_by(subject_key=str(target.id)).count() == 3
