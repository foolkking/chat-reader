"""Synthetic-only CI characterization; query counts contain no user data."""
import json
import time

import pytest
from sqlalchemy import event

from app.services.offline_packages import build_catalog
from test_attachment_storage_integrity import _conversation, _database
from test_import_preview_api import client  # noqa: F401


@pytest.mark.parametrize("size", [47, 470])
def test_offline_catalog_characterization(client, size):
    db, generator = _database()
    statements = []
    def count_statement(*_):
        statements.append(1)
    engine = db.get_bind()
    try:
        db.add_all([_conversation() for _ in range(size)])
        db.commit()
        db.expunge_all()
        event.listen(engine, "before_cursor_execute", count_statement)
        started = time.perf_counter()
        catalog = build_catalog(db)
        elapsed = time.perf_counter() - started
        assert len(catalog.conversations) == size
        print(json.dumps({"fixture": "synthetic-offline-catalog-v1", "conversations": size,
                          "sql_count": len(statements), "elapsed_ms": round(elapsed * 1000, 2)}))
    finally:
        event.remove(engine, "before_cursor_execute", count_statement)
        db.close()
        generator.close()
