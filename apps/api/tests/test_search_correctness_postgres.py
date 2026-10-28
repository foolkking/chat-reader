"""Literal-query correctness on the real PostgreSQL candidate branch."""
import os
import uuid

import pytest
from sqlalchemy.orm import Session

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
