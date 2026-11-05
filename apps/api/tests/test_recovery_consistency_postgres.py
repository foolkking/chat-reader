import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.attachment import Attachment
from app.models.background_job import BackgroundJob
from app.models.user_feature_entry import UserFeatureEntry
from app.models.user_preference import UserPreference
from app.services.background_jobs import queue_attachment_download
from app.services.editing.message_edit_service import MessageEditError
from app.services.exporting.archive_user_features import personal_collection_capacity, require_collection_capacity
from app.services.exporting.system_archive import SystemArchiveError
from app.services.ownership import OwnershipScope
from app.services.user_feature_entries import write_entry
from test_import_profile_postgres import isolated_schema  # noqa: F401
from test_system_archive_integrity import seed_archive_source

pytestmark = pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1", reason="requires disposable PostgreSQL")


def test_postgres_download_intent_is_serialized_and_payload_bound(isolated_schema, tmp_path, monkeypatch):
    monkeypatch.setenv("ASSET_STORAGE_DIR", str(tmp_path / "assets"))
    get_settings.cache_clear()
    engine, migrate = isolated_schema
    migrate("head")
    with Session(engine) as db:
        users, conversations, _, asset = seed_archive_source(db)
        asset.scan_status = "clean"
        first = db.query(Attachment).filter_by(conversation_id=conversations[0].id).one()
        first.status, first.deleted_at, first.scan_status = "available", None, "clean"
        second = Attachment(conversation_id=conversations[0].id, asset_object_id=asset.id,
            original_filename="second.txt", display_name="Synthetic", status="available", scan_status="clean")
        db.add(second); db.commit()
        owner, source, first_id, second_id = users[0].id, conversations[0].id, first.id, second.id
    barrier = Barrier(2)
    def enqueue(index, *, different=False):
        with Session(engine) as db:
            barrier.wait(timeout=15)
            try:
                job = queue_attachment_download(db, conversation_id=source,
                    attachment_ids=[second_id if different and index else first_id],
                    idempotency_key="different" if different else "same", ownership_scope=OwnershipScope(owner))
                identity = job.id; db.commit(); return identity
            except MessageEditError as exc:
                db.rollback(); return exc.status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        same = list(pool.map(enqueue, range(2)))
    assert same[0] == same[1]
    with ThreadPoolExecutor(max_workers=2) as pool:
        different = list(pool.map(lambda index: enqueue(index, different=True), range(2)))
    assert sum(value == 409 for value in different) == 1
    with Session(engine) as db:
        assert db.query(BackgroundJob).filter_by(job_type="attachment_batch_download").count() == 2
    get_settings.cache_clear()


def test_postgres_capacity_rechecks_against_concurrent_collection_write(isolated_schema):
    from app.models.user import User
    engine, migrate = isolated_schema; migrate("head")
    with Session(engine) as db:
        owner = User(normalized_email="synthetic-capacity@example.test")
        db.add(owner); db.flush(); identity = owner.id
        db.add(UserPreference(subject_key=str(identity))); db.flush()
        db.add_all([UserFeatureEntry(subject_key=str(identity), collection="saved-search",
            value={"name": f"Existing {i}", "q": "synthetic"}) for i in range(19)])
        db.commit()
    barrier = Barrier(2)
    def restore_feature(index):
        with Session(engine) as db:
            barrier.wait(timeout=15)
            try:
                require_collection_capacity(personal_collection_capacity(db, identity, {"saved-search": 1}, f"synthetic-{index}", lock=True))
                write_entry(db, str(identity), "saved-search", uuid.uuid4(), 0,
                    {"name": f"Restored {index}", "q": "synthetic"}, OwnershipScope(identity))
                db.commit(); return "saved"
            except SystemArchiveError as exc:
                db.rollback(); return exc.status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(restore_feature, range(2)))
    assert results.count("saved") == 1 and results.count(409) == 1
    with Session(engine) as db:
        assert db.query(UserFeatureEntry).filter_by(subject_key=str(identity), collection="saved-search").count() == 20
