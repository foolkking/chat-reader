import os
import uuid

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.services.exporting.cr_archive import _conversation_archive_attachments


@pytest.mark.skipif(
    os.environ.get("POSTGRES_EXPORT_INTEGRATION") != "1" or not os.environ.get("DATABASE_URL"),
    reason="requires the Release B PostgreSQL integration matrix",
)
def test_cr_attachment_lookup_does_not_distinct_json_entities_on_postgresql() -> None:
    """Execute the actual query because SQLite accepts a DISTINCT PostgreSQL rejects."""
    database_url = os.environ["DATABASE_URL"]
    engine = create_engine(database_url)
    try:
        with Session(engine) as db:
            assert _conversation_archive_attachments(db, uuid.uuid4()) == []
    finally:
        engine.dispose()
