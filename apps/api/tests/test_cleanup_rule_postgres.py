"""Real-FK rule acquisition, source deletion and alias migration evidence."""
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models.content_cleanup import ContentCleanupRule, ContentCleanupRuleRevision, ContentCleanupRuleGrant, ContentCleanupRuleAlias, ContentCleanupRulePublication, ContentCleanupException
from app.models.import_record import utc_now
from app.models.user import User
from app.services.cleanup_learning import _digest, exception_scope
from app.services.cleanup_rule_access import available_versions, current_rule, learn_literal, publish_rule
from app.services.cleanup_rule_identity import literal_configuration
from app.services.ownership import OwnershipScope
from app.services.auth import ROOT_ADMIN_USER_ID
from app.services.user_deletion import queue_user_account_delete, execute_user_account_delete
from test_import_profile_postgres import isolated_schema  # noqa: F401

pytestmark = pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1", reason="requires explicitly selected disposable PostgreSQL")


def test_equivalent_learning_serializes_and_author_deletion_preserves_others(isolated_schema):
    engine, migrate = isolated_schema
    migrate("head")
    with Session(engine) as db:
        users = [User(normalized_email=f"rule-user-{i}@example.test") for i in range(2)]
        users.append(db.get(User, ROOT_ADMIN_USER_ID))
        db.add_all(users)
        db.commit()
        ids = [user.id for user in users]
    barrier = Barrier(2)

    def learn(index):
        with Session(engine) as db:
            barrier.wait(timeout=10)
            rule, revision = learn_literal(db, OwnershipScope(ids[index]), name=f"Personal {index}", match_value="SYNTHETIC_NOISE")
            db.commit()
            return rule.id, revision.id

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(learn, [0, 1]))
    assert results[0] == results[1]
    rule_id, revision_id = results[0]
    with Session(engine) as db:
        assert db.query(ContentCleanupRuleGrant).count() == 2
        assert db.query(ContentCleanupRuleRevision).filter_by(rule_id=rule_id).count() == 1
        author_id = db.get(ContentCleanupRule, rule_id).owner_user_id
        survivor_id = next(user_id for user_id in ids[:2] if user_id != author_id)
        publish_rule(db, rule_id, revision_id, ids[2], "Public rule")
        db.commit()
        job, request = queue_user_account_delete(db, actor_user_id=ids[2], target_user_id=author_id, idempotency_key="synthetic-rule-author-delete")
        db.commit()
        result, removable = execute_user_account_delete(db, job=job, target_user_id=author_id, deletion_request_id=request.id)
        assert result["deleted_conversations"] == 0 and removable == []
        assert request.status == "COMPLETED"
        db.commit()
    with Session(engine) as db:
        assert db.get(ContentCleanupRule, rule_id).owner_user_id is None
        assert db.get(ContentCleanupRuleRevision, revision_id).created_by_user_id is None
        assert db.get(ContentCleanupRulePublication, rule_id).revision_id == revision_id
        assert current_rule(db, OwnershipScope(survivor_id), rule_id)[1].id == revision_id
        db.get(ContentCleanupRulePublication, rule_id).withdrawn_at = utc_now()
        db.commit()
    with Session(engine) as db:
        assert current_rule(db, OwnershipScope(survivor_id), rule_id)[1].id == revision_id
        assert available_versions(db, OwnershipScope(ids[2])) == {}


def test_migration_aliases_keep_old_revisions_exceptions_and_distinct_scopes(isolated_schema):
    engine, migrate = isolated_schema
    migrate("20260930_0037")
    rule_ids, revision_ids, user_ids = [uuid.uuid4() for _ in range(3)], [uuid.uuid4() for _ in range(3)], []
    with Session(engine) as db:
        for index in range(3):
            user = User(normalized_email=f"legacy-rule-{index}@example.test")
            db.add(user)
            db.flush()
            user_ids.append(user.id)
            now = utc_now()
            db.execute(text("""INSERT INTO content_cleanup_rules (id,owner_user_id,name,kind,status,scope,created_at,updated_at)
                VALUES (:id,:owner,:name,'USER_LITERAL',:status,'MESSAGE',:now,:now)"""),
                {"id": rule_ids[index], "owner": user.id, "name": f"Legacy {index}", "status": "DISABLED" if index == 1 else "ACTIVE", "now": now})
            config = literal_configuration("SYNTHETIC_NOISE", role_filter="assistant" if index == 2 else None)
            db.execute(text("""INSERT INTO content_cleanup_rule_revisions
                (id,rule_id,revision,matcher_version,match_value,matcher_mode,normalization_profile,max_edit_distance,boundary_mode,case_sensitive,role_filter,default_decision,created_at)
                VALUES (:id,:rule_id,1,:matcher_version,:match_value,:matcher_mode,:normalization_profile,:max_edit_distance,:boundary_mode,:case_sensitive,:role_filter,'KEEP',:now)"""),
                {"id": revision_ids[index], "rule_id": rule_ids[index], "now": now, **config})
        config = exception_scope(revision_ids[1], "assistant", "Before SYNTHETIC_NOISE after", 7, 22)
        exception = ContentCleanupException(owner_user_id=user_ids[1], scope_digest=_digest(config), **{**config, "rule_revision_id": revision_ids[1]})
        db.add(exception)
        db.commit()
        exception_id = exception.id
    migrate("head")
    with Session(engine) as db:
        alias = db.get(ContentCleanupRuleAlias, rule_ids[1])
        assert alias.canonical_rule_id == rule_ids[0]
        assert db.get(ContentCleanupRuleAlias, rule_ids[2]) is None
        assert db.query(ContentCleanupRuleGrant).count() == 3
        assert db.query(ContentCleanupRulePublication).count() == 0
        rule, version, preference = current_rule(db, OwnershipScope(user_ids[1]), rule_ids[1])
        assert rule.id == rule_ids[0] and version.id == revision_ids[1]
        assert preference.display_name == "Legacy 1" and not preference.enabled
        assert db.get(ContentCleanupException, exception_id).rule_revision_id == revision_ids[1]
        assert db.get(ContentCleanupRuleRevision, revision_ids[1]).rule_id == rule_ids[1]
    migrate("20260930_0037", "downgrade")
    migrate("head")
    with Session(engine) as db:
        assert current_rule(db, OwnershipScope(user_ids[1]), rule_ids[1])[2].enabled is False
