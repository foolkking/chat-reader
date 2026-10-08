"""Competing personal names use a fresh locked preference, not a cached revision."""
import os
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from sqlalchemy.orm import Session

from app.models.user import User
from app.models.content_cleanup import ContentCleanupRuleRevision
from app.services.cleanup_rule_access import current_rule, learn_literal, personal_edit_token, rule_payload, update_personal_rule
from app.services.ownership import OwnershipScope
from test_import_profile_postgres import isolated_schema  # noqa: F401

pytestmark = pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1", reason="requires disposable PostgreSQL")


def test_concurrent_name_only_edits_refresh_preloaded_preference(isolated_schema):
    engine, migrate = isolated_schema
    migrate("head")
    with Session(engine) as db:
        user = User(normalized_email="synthetic-edit@example.test")
        db.add(user); db.flush()
        scope = OwnershipScope(user.id)
        rule, revision = learn_literal(db, scope, name="Synthetic original", match_value="SYNTHETIC_PG_NAME")
        rule_id, revision_id = rule.id, revision.id
        db.commit()
    barrier = Barrier(2)
    def edit(name):
        with Session(engine) as db:
            # Keep these ORM objects alive while the other writer commits.
            old_rule, old_revision, old_preference = current_rule(db, scope, rule_id)
            token = personal_edit_token(db, scope, old_rule, old_revision)
            assert old_preference.display_name == "Synthetic original"
            barrier.wait(timeout=10)
            try:
                update_personal_rule(db, scope, rule_id, {"name": name, "base_revision_id": revision_id, "base_edit_token": token})
                db.commit()
                return "saved"
            except ValueError as error:
                assert str(error).startswith("Rule changed")
                db.rollback()
                return "conflict"
    with ThreadPoolExecutor(max_workers=2) as executor:
        assert sorted(executor.map(edit, ["Synthetic window A", "Synthetic window B"])) == ["conflict", "saved"]
    with Session(engine) as db:
        rule, revision, preference = current_rule(db, scope, rule_id)
        assert preference.display_name in {"Synthetic window A", "Synthetic window B"}
        assert revision.id == revision_id
        assert db.query(ContentCleanupRuleRevision).filter_by(rule_id=rule_id).count() == 1


def test_shared_identity_keeps_personal_bases_independent(isolated_schema):
    engine, migrate = isolated_schema
    migrate("head")
    with Session(engine) as db:
        users = [User(normalized_email=f"synthetic-edit-{n}@example.test") for n in range(2)]
        db.add_all(users); db.flush()
        scopes = [OwnershipScope(user.id) for user in users]
        records = [learn_literal(db, scope, name=f"Synthetic personal {n}", match_value="SYNTHETIC_SHARED_NAME") for n, scope in enumerate(scopes)]
        assert records[0][0].id == records[1][0].id
        rule_id = records[0][0].id
        db.commit()
        tokens = [personal_edit_token(db, scope, *current_rule(db, scope, rule_id)[:2]) for scope in scopes]
        assert tokens[0] != tokens[1]
    with Session(engine) as db:
        update_personal_rule(db, scopes[0], rule_id, {"name": "Synthetic A renamed", "base_edit_token": tokens[0]})
        db.commit()
    with Session(engine) as db:
        rule, revision = update_personal_rule(db, scopes[1], rule_id, {"name": "Synthetic B renamed", "base_edit_token": tokens[1]})
        assert rule_payload(db, scopes[1], rule, revision)["name"] == "Synthetic B renamed"
        db.commit()
    with Session(engine) as db:
        assert current_rule(db, scopes[0], rule_id)[2].display_name == "Synthetic A renamed"
