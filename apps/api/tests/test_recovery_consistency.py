"""Synthetic regression cases for the recovery/consistency audit."""
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app.core.database import get_db
from app.main import app
from app.models.attachment import Attachment
from app.models.conversation import Conversation
from app.models.import_record import ImportRecord
from app.models.user_feature_entry import UserFeatureEntry
from app.models.user_preference import UserPreference
from app.services.background_jobs import queue_attachment_download
from app.services.editing.message_edit_service import MessageEditError
from app.services.exporting.archive_jobs import archive_job_error, archive_task_result, queue_personal_restore, receive_personal_archive
from app.services.exporting.archive_preflight import inspect_personal_archive, open_personal_archive
from app.services.exporting.archive_user_features import personal_collection_capacity
from app.services.exporting.personal_archive import create_personal_archive
from app.services.exporting import personal_restore
from app.services.exporting.system_archive import SystemArchiveError
from app.services.ownership import OwnershipScope
from test_adaptive_import_api import _create, _json_bytes, _save_mapping, _complete_analysis
from test_import_preview_api import client  # noqa: F401
from test_system_archive_integrity import archive_db, seed_archive_source  # noqa: F401


def test_expired_import_preview_keeps_sources_and_rebuilds_saved_mapping(client, tmp_path):
    import uuid
    session = _save_mapping(client, _create(client, [("synthetic.json", _json_bytes(), "application/json")]))
    assert session["can_import"]
    identity = uuid.UUID(session["import_id"])
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        record = db.get(ImportRecord, identity)
        record.draft_expires_at = datetime.now(timezone.utc) - timedelta(days=1)
        original_groups = [(str(group.id), group.artifact_ids) for group in record.input_groups]
        original_families = [(str(f.id), f.mapping_draft, str(f.matched_revision_id)) for f in record.structure_families]
        db.commit()
    finally:
        db.close(); generator.close()
    base = f"/api/adaptive-import/sessions/{identity}"
    detail = client.get(base).json()
    listed = client.get("/api/adaptive-import/sessions").json()["items"][0]
    for payload in (detail, listed):
        assert payload["source_available"] and payload["source_status"] == "available"
        assert payload["draft_status"] == "expired" and not payload["can_import"]
        assert "rebuild_preview" in payload["allowed_actions"]
    stale = client.post(base + "/rebuild-preview", json={"expected_updated_at": "2000-01-01T00:00:00Z"})
    assert stale.status_code == 409
    request = {"expected_updated_at": detail["updated_at"]}
    queued = client.post(base + "/rebuild-preview", json=request)
    assert queued.status_code == 202, queued.text
    assert client.post(base + "/rebuild-preview", json=request).status_code == 409
    rebuilt = _complete_analysis(client, queued.json())
    assert rebuilt["can_import"] and rebuilt["draft_status"] == "ready"
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        record = db.get(ImportRecord, identity)
        assert [(str(group.id), group.artifact_ids) for group in record.input_groups] == original_groups
        assert [(str(f.id), f.mapping_draft, str(f.matched_revision_id)) for f in record.structure_families] == original_families
        assert db.query(Conversation).count() == 0, "Rebuilding is not an import commit"
        from app.services.adaptive_import.service import _source_path
        source = _source_path(record, record.artifacts[0]).resolve()
        assert source.is_relative_to(tmp_path.resolve())
        source.unlink()
    finally:
        db.close(); generator.close()
    missing = client.get(base).json()
    assert missing["source_status"] == "missing"
    assert missing["allowed_actions"] == ["resume"]
    assert not missing["can_import"]


def test_attachment_download_key_is_bound_to_normalized_selection(archive_db):
    users, conversations, _, asset = seed_archive_source(archive_db)
    source = conversations[0]
    asset.scan_status = "clean"
    first = archive_db.query(Attachment).filter_by(conversation_id=source.id).one()
    first.status, first.deleted_at, first.scan_status = "available", None, "clean"
    second = Attachment(conversation_id=source.id, asset_object_id=asset.id,
        original_filename="synthetic-second.txt", display_name="Synthetic second", status="available", scan_status="clean")
    archive_db.add(second); archive_db.commit()
    options = {"conversation_id": source.id, "idempotency_key": "synthetic-intent", "ownership_scope": OwnershipScope(users[0].id)}
    job = queue_attachment_download(archive_db, attachment_ids=[first.id, second.id], **options)
    archive_db.commit()
    assert queue_attachment_download(archive_db, attachment_ids=[second.id, first.id], **options).id == job.id
    for state in ("queued", "committed", "failed"):
        job.status = state; archive_db.commit()
        with pytest.raises(MessageEditError) as error:
            queue_attachment_download(archive_db, attachment_ids=[first.id], **options)
        assert error.value.status_code == 409
        assert queue_attachment_download(archive_db, attachment_ids=[first.id, second.id], **options).id == job.id


def test_archive_capacity_is_actionable_and_precedes_asset_work(archive_db, monkeypatch):
    users, _, job, _ = seed_archive_source(archive_db)
    owner, target = users
    archive_db.add_all([UserPreference(subject_key=str(user.id)) for user in users])
    archive_db.flush()
    archive_db.add(UserFeatureEntry(subject_key=str(owner.id), collection="saved-search", value={"name": "Synthetic", "q": "source"}))
    for i in range(20):
        archive_db.add(UserFeatureEntry(subject_key=str(target.id), collection="saved-search", value={"name": f"Existing {i}", "q": f"query-{i}"}))
    archive_db.commit()
    artifact = create_personal_archive(archive_db, job_id=job.id, owner_user_id=owner.id)
    archive_db.commit()
    path = Path(artifact.storage_uri)
    preview = inspect_personal_archive(path)
    assert preview["personal_collection_counts"] == {"saved-search": 1}
    with path.open("rb") as source:
        preview_job = receive_personal_archive(archive_db, source, owner=target.id, key="synthetic-capacity-preview")
    preview_job.status, preview_job.result = "committed", preview
    archive_db.commit()
    assert archive_task_result(archive_db, preview_job)["can_restore"] is False
    with pytest.raises(SystemArchiveError, match="PERSONAL_COLLECTION_CAPACITY"):
        queue_personal_restore(archive_db, owner=target.id, preview_id=preview_job.id, expected_digest=preview["content_digest"])
    capacity = personal_collection_capacity(archive_db, target.id, preview["personal_collection_counts"], preview["content_digest"])
    assert capacity == {"can_restore": False, "collection_capacity": [{"collection": "saved-search", "current": 20, "incoming": 1, "limit": 20}]}
    before = archive_db.query(Conversation).count()
    monkeypatch.setattr(personal_restore, "_restore_assets", lambda *_: pytest.fail("Capacity must be checked before asset work"))
    with pytest.raises(SystemArchiveError, match="PERSONAL_COLLECTION_CAPACITY") as failure:
        personal_restore.restore_personal_archive(archive_db, path, owner_user_id=target.id, expected_digest=preview["content_digest"])
    assert failure.value.status_code == 409
    assert "malformed" not in archive_job_error(failure.value)
    archive_db.rollback()
    assert archive_db.query(Conversation).count() == before
    archive_db.delete(archive_db.query(UserFeatureEntry).filter_by(subject_key=str(target.id)).first())
    archive_db.commit()
    assert personal_collection_capacity(archive_db, target.id, preview["personal_collection_counts"], preview["content_digest"])["can_restore"]
    assert archive_task_result(archive_db, preview_job)["can_restore"] is True
    queued = queue_personal_restore(archive_db, owner=target.id, preview_id=preview_job.id, expected_digest=preview["content_digest"])
    assert queued.status == "queued"
    archive_db.commit()
    with pytest.raises(ValueError, match="synthetic business failure"):
        with open_personal_archive(path):
            raise ValueError("synthetic business failure")


def test_restored_archive_receipt_does_not_require_collection_capacity_again(archive_db):
    import uuid
    from app.models.archive_restore import ArchiveRestoreReceipt
    users, _, _, _ = seed_archive_source(archive_db)
    owner = users[0]
    digest = "1" * 64
    archive_db.add(ArchiveRestoreReceipt(owner_user_id=owner.id, content_digest=digest, restore_id=uuid.uuid4(), result={}))
    archive_db.commit()
    capacity = personal_collection_capacity(archive_db, owner.id, {"saved-search": 100}, digest)
    assert capacity["can_restore"]
    assert capacity["collection_capacity"][0]["incoming"] == 0


def test_private_search_backfill_yields_with_durable_cursor(archive_db):
    import uuid
    from sqlalchemy.orm import Session, sessionmaker
    from app.models.background_job import BackgroundJob
    from app.models.search_document import SearchDocument
    from app.services.background_jobs import claim_next_job, process_background_job
    archive_db.add_all([Conversation(id=uuid.UUID(int=i + 1), title="Synthetic", display_title="Synthetic",
        description_markdown="Synthetic private description", parser_version="synthetic",
        source_type="synthetic", source_profile="synthetic") for i in range(105)])
    job = BackgroundJob(job_type="personal_search_backfill", status="processing", payload={}, result={})
    archive_db.add(job); archive_db.commit()
    identity = job.id
    engine = archive_db.get_bind()
    process_background_job(identity, sessionmaker(bind=engine))
    with Session(engine) as db:
        job = db.get(BackgroundJob, identity)
        assert job.status == "queued"
        count = job.payload["indexed_conversations"]
        assert 1 <= count <= 100
        assert job.processed_items == count
        assert job.payload["after_conversation_id"] == str(uuid.UUID(int=count))
        assert db.query(SearchDocument).count() == count
    for _ in range(105):
        with Session(engine) as db:
            if db.get(BackgroundJob, identity).status == "committed": break
            assert claim_next_job(db, job_type="personal_search_backfill") == identity
            db.commit()
        process_background_job(identity, sessionmaker(bind=engine))
    with Session(engine) as db:
        job = db.get(BackgroundJob, identity)
        assert job.status == "committed", job.error_message
        assert job.result["indexed_conversations"] == 105
        assert job.processed_items == job.total_items == 105
        assert db.query(SearchDocument).count() == 105


def test_private_search_backfill_failure_resumes_after_last_committed_item(archive_db, monkeypatch):
    import uuid
    from sqlalchemy.orm import Session, sessionmaker
    from app.models.background_job import BackgroundJob
    from app.models.search_document import SearchDocument
    from app.services.background_jobs import claim_next_job, process_background_job, retry_background_job
    from app.services.search import personal_content_indexer
    archive_db.add_all([Conversation(id=uuid.UUID(int=i + 1), title="Synthetic", display_title="Synthetic",
        description_markdown="Synthetic", parser_version="synthetic", source_type="synthetic", source_profile="synthetic")
        for i in range(5)])
    job = BackgroundJob(job_type="personal_search_backfill", status="processing", payload={}, result={})
    archive_db.add(job); archive_db.commit(); identity = job.id
    engine = archive_db.get_bind()
    original, attempted = personal_content_indexer.sync_personal_content, []
    def fail_third(db, conversation):
        attempted.append(conversation.id)
        original(db, conversation)
        if len(attempted) == 3:
            raise RuntimeError("Synthetic failure before cursor commit")
    monkeypatch.setattr(personal_content_indexer, "sync_personal_content", fail_third)
    process_background_job(identity, sessionmaker(bind=engine))
    with Session(engine) as db:
        job = db.get(BackgroundJob, identity)
        assert job.status == "failed"
        assert job.payload["indexed_conversations"] == 2
        assert db.query(SearchDocument).count() == 2
        retry_background_job(job); db.commit()
        assert claim_next_job(db, job_type="personal_search_backfill") == identity
        db.commit()
    resumed = []
    def trace_resume(db, conversation):
        resumed.append(conversation.id); original(db, conversation)
    monkeypatch.setattr(personal_content_indexer, "sync_personal_content", trace_resume)
    process_background_job(identity, sessionmaker(bind=engine))
    assert resumed == [uuid.UUID(int=value) for value in (3, 4, 5)]
    with Session(engine) as db:
        assert db.get(BackgroundJob, identity).status == "committed"
        assert db.query(SearchDocument).count() == 5
