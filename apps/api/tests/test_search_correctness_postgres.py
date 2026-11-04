"""Literal-query correctness on the real PostgreSQL candidate branch."""
import os
import uuid
import time
import tracemalloc

import pytest
from sqlalchemy.orm import Session
from sqlalchemy import event

from app.models.conversation import Conversation
from app.models.search_document import SearchDocument
from app.services.ownership import LEGACY_OWNER_USER_ID
from app.services.search.search_service import search
from test_import_profile_postgres import isolated_schema  # noqa: F401

pytestmark = pytest.mark.skipif(
    os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1",
    reason="requires explicitly selected disposable PostgreSQL",
)


def test_literal_wildcards_do_not_expand_through_postgres_fts_or_like(isolated_schema) -> None:
    engine, migrate = isolated_schema
    migrate("head")
    with Session(engine) as db:
        conversation = Conversation(
            owner_user_id=LEGACY_OWNER_USER_ID,
            title="Synthetic literal-query corpus",
            display_title="Synthetic literal-query corpus",
            source_type="manual",
            source_profile="manual",
            parser_version="synthetic-search-correctness",
        )
        db.add(conversation)
        db.flush()
        literals = [
            ("token_under_score", "tokenXunderXscore"),
            ("37%", "37x"),
            (r"left\right", "leftXright"),
        ]
        expected_ids = {}
        for literal, decoy in literals:
            for text in (literal, decoy):
                document_id = uuid.uuid4()
                db.add(SearchDocument(
                    id=document_id,
                    conversation_id=conversation.id,
                    document_type="message",
                    plain_text=text,
                    search_text=text,
                    metadata_={},
                ))
                if text == literal:
                    expected_ids[literal] = document_id
        db.commit()

        for query, document_id in expected_ids.items():
            page = search(
                db, query, conversation_id=conversation.id, document_type="message", limit=20, offset=0,
            )
            assert page.total == 1
            assert [item.document_id for item in page.items] == [document_id]


def test_search_page_materializes_only_page_bodies(isolated_schema):
    engine, migrate = isolated_schema
    migrate("head")
    with Session(engine) as db:
        conversation = Conversation(owner_user_id=LEGACY_OWNER_USER_ID, title="Synthetic",
            display_title="Synthetic", source_type="manual", source_profile="manual", parser_version="test")
        db.add(conversation)
        db.flush()
        db.bulk_insert_mappings(SearchDocument, [{
            "id": uuid.uuid4(), "conversation_id": conversation.id, "document_type": "message",
            "plain_text": "boundedneedle " + "synthetic " * 2048,
            "search_text": "boundedneedle", "metadata_": {},
        } for _ in range(1000)])
        db.commit()
    loaded = []
    def observe(_session, row):
        if isinstance(row, SearchDocument):
            loaded.append(row.id)
    with Session(engine) as db:
        event.listen(db, "loaded_as_persistent", observe)
        tracemalloc.start()
        started = time.perf_counter()
        try:
            result = search(db, "boundedneedle", limit=20, offset=20)
            _, peak = tracemalloc.get_traced_memory()
        finally:
            tracemalloc.stop()
        assert result.total == 1000 and result.has_more
        assert len(result.items) == 20 and len(loaded) == 20
        print(f"Synthetic search: candidates=1000 loaded_bodies={len(loaded)} "
              f"elapsed_ms={(time.perf_counter() - started)*1000:.1f} python_peak_bytes={peak}")
