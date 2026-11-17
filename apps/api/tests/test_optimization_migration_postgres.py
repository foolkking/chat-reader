import os
import uuid
from datetime import datetime, timezone

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from app.models.background_job import BackgroundJob
from app.models.conversation import Conversation
from app.models.search_document import SearchDocument
from app.services.background_jobs import process_background_job
from app.services.ownership import LEGACY_OWNER_USER_ID
from test_import_profile_postgres import isolated_schema  # noqa: F401

pytestmark = pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1",
    reason="requires disposable PostgreSQL")


def test_migration_repairs_only_index_dates_and_worker_backfills_private_text(isolated_schema):
    engine, migrate = isolated_schema
    migrate("20261030_0058")
    imported = datetime(2026, 1, 2, tzinfo=timezone.utc)
    # Seed the actual old schema, not current ORM columns/listeners added by 0062.
    metadata = sa.MetaData()
    conversations = sa.Table("conversations", metadata, autoload_with=engine)
    documents = sa.Table("search_documents", metadata, autoload_with=engine)
    assert "unclassified_sort_order" not in conversations.c
    conversation_id = uuid.uuid4()
    with engine.begin() as db:
        db.execute(conversations.insert().values(id=conversation_id, owner_user_id=LEGACY_OWNER_USER_ID, title="Synthetic",
            display_title="Synthetic", source_type="test", source_profile="test", parser_version="test",
            created_at=None, imported_at=imported, description_markdown="Synthetic private description"))
        db.execute(documents.insert().values(id=uuid.uuid4(), conversation_id=conversation_id, document_type="conversation",
            plain_text="Synthetic", search_text="Synthetic", created_at=None, metadata={}))
    migrate("head")
    with Session(engine) as db:
        assert db.get(Conversation, conversation_id).created_at is None
        assert db.get(Conversation, conversation_id).imported_at == imported
        assert db.query(SearchDocument).filter_by(document_type="conversation").one().created_at == imported
        job = db.query(BackgroundJob).filter_by(job_type="personal_search_backfill").one()
        job.status = "processing"
        db.commit()
        job_id = job.id
    process_background_job(job_id, sessionmaker(bind=engine))
    with Session(engine) as db:
        job = db.get(BackgroundJob, job_id)
        assert job.status == "committed", job.error_message
        assert db.query(SearchDocument).filter_by(document_type="description").one().plain_text == "Synthetic private description"
