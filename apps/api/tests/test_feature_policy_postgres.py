"""Fresh-row comparisons and initial singleton races in disposable PostgreSQL."""
import os
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from sqlalchemy.orm import Session

from app.models.administration import InstanceFeaturePolicy
from app.models.user import User
from app.services.feature_policies import FeaturePolicyConflict, feature_policy_revision, get_feature_policy, update_feature_policy
from test_import_profile_postgres import isolated_schema  # noqa: F401

pytestmark = pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1", reason="requires explicitly selected disposable PostgreSQL")


@pytest.mark.parametrize("revision_checked", [True, False])
def test_cached_concurrent_writers_refresh_after_lock(isolated_schema, revision_checked):
    engine, migrate = isolated_schema
    migrate("head")
    with Session(engine) as db:
        user = User(normalized_email="policy-concurrency@example.test")
        db.add(user); db.flush()
        actor = user.id
        revision = feature_policy_revision(get_feature_policy(db))
        db.commit()
    barrier = Barrier(2)
    patches = [{"allow_share_links": False}, {"export_retention_minutes": 8}]

    def write(index):
        with Session(engine) as db:
            cached = db.get(InstanceFeaturePolicy, 1)
            assert cached.allow_share_links is True and cached.export_retention_minutes == 3
            barrier.wait(timeout=10)
            try:
                row, changes = update_feature_policy(db, actor_user_id=actor, values=patches[index], base_revision=revision if revision_checked else None)
                result = ("saved", index, feature_policy_revision(row), changes)
                db.commit()
                return result
            except FeaturePolicyConflict:
                db.rollback()
                return ("conflict", index, None, None)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(write, range(2)))
    assert sorted(item[0] for item in results) == (["conflict", "saved"] if revision_checked else ["saved", "saved"])
    with Session(engine) as db:
        row = db.get(InstanceFeaturePolicy, 1)
        for state, index, revision, changes in results:
            key, value = next(iter(patches[index].items()))
            if state == "saved":
                assert getattr(row, key) == value
                assert changes[key]["to"] == value
                if revision_checked:
                    assert feature_policy_revision(row) == revision
            else:
                assert getattr(row, key) != value


def test_first_policy_read_and_write_share_single_creation_lock(isolated_schema):
    engine, migrate = isolated_schema
    migrate("head")
    with Session(engine) as db:
        user = User(normalized_email="policy-initial@example.test")
        db.add(user); db.flush(); actor = user.id
        db.query(InstanceFeaturePolicy).delete(); db.commit()
    barrier = Barrier(3)

    def access(index):
        with Session(engine) as db:
            assert db.get(InstanceFeaturePolicy, 1) is None
            barrier.wait(timeout=10)
            if index == 0:
                get_feature_policy(db)
            else:
                patch = {"allow_share_links": False} if index == 1 else {"export_retention_minutes": 8}
                update_feature_policy(db, actor_user_id=actor, values=patch)
            db.commit()

    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(access, range(3)))
    with Session(engine) as db:
        row = db.query(InstanceFeaturePolicy).one()
        assert row.allow_share_links is False and row.export_retention_minutes == 8
