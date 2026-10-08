"""Publication bases are checked after a fresh PostgreSQL canonical-rule lock."""
import os
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from sqlalchemy.orm import Session

from app.models.content_cleanup import ContentCleanupRulePublication as Publication
from app.models.user import User
from app.services.cleanup_rule_access import learn_literal, publication_token, publish_rule, withdraw_rule, PublicationConflict
from app.services.ownership import OwnershipScope
from test_import_profile_postgres import isolated_schema  # noqa: F401

pytestmark = pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1", reason="requires disposable PostgreSQL")


@pytest.mark.parametrize("second,initial", [("publish", True), ("withdraw", True), ("publish", False)])
def test_competing_publications_refresh_preloaded_rows(isolated_schema, second, initial):
    engine, migrate = isolated_schema
    migrate("head")
    with Session(engine) as db:
        user = User(normalized_email="synthetic-publisher@example.test")
        db.add(user); db.flush()
        rule, revision = learn_literal(db, OwnershipScope(user.id), name="Synthetic private", match_value="SYNTHETIC_PG_PUBLICATION")
        rule_id, revision_id, actor = rule.id, revision.id, user.id
        if initial:
            publish_rule(db, rule_id, revision_id, actor, "Synthetic original")
        db.commit()
    barrier = Barrier(2)
    def change(operation):
        with Session(engine) as db:
            cached = db.get(Publication, rule_id)
            token = publication_token(rule_id, cached)
            barrier.wait(timeout=10)
            try:
                if operation == "withdraw":
                    withdraw_rule(db, rule_id, token)
                else:
                    publish_rule(db, rule_id, revision_id, actor, "Synthetic " + operation, token)
                db.commit()
                return "saved", operation
            except PublicationConflict:
                db.rollback()
                return "conflict", operation
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(change, ["first", second]))
    assert sorted(result[0] for result in results) == ["conflict", "saved"]
    winner = next(operation for status, operation in results if status == "saved")
    with Session(engine) as db:
        publication = db.get(Publication, rule_id)
        assert publication.revision_id == revision_id
        if winner == "withdraw":
            assert publication.withdrawn_at is not None and publication.name == "Synthetic original"
        else:
            assert publication.withdrawn_at is None and publication.name == "Synthetic " + winner
