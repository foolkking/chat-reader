"""Real FK, advisory-lock and legacy migration tests in disposable databases."""
import json
import os
import subprocess
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from threading import Barrier

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.models.import_profile import ImportProfile, ImportProfileAlias, ImportProfileGrant, ImportProfilePublication, ImportProfileRevision
from app.models.user import User
from app.services.adaptive_import.analysis import analyze_json, default_mapping
from app.services.adaptive_import.profile_access import available_revisions, grant_revision, publish_revision
from app.services.adaptive_import.profiles import create_verified_revision

pytestmark = pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1", reason="requires explicitly selected disposable PostgreSQL")


@pytest.fixture
def isolated_schema():
    source = sa.create_engine(os.environ["DATABASE_URL"], isolation_level="AUTOCOMMIT")
    assert source.dialect.name == "postgresql"
    schema = "settings_formats_" + uuid.uuid4().hex
    with source.connect() as db:
        db.execute(sa.text(f'CREATE DATABASE "{schema}"'))
    url = source.url.set(database=schema)
    engine = sa.create_engine(url)

    def migrate(target, operation="upgrade"):
        result = subprocess.run([sys.executable, "-m", "alembic", operation, target],
            cwd=Path(__file__).resolve().parents[1], env={**os.environ, "DATABASE_URL": url.render_as_string(hide_password=False)},
            capture_output=True, text=True, timeout=120)
        assert result.returncode == 0, result.stderr
    try:
        yield engine, migrate
    finally:
        engine.dispose()
        with source.connect() as db:
            db.execute(sa.text(f'DROP DATABASE "{schema}" WITH (FORCE)'))
        source.dispose()


def analysis_fixture():
    return analyze_json(json.dumps({"turns": [{"speaker": "user", "body": "Synthetic input"}, {"speaker": "assistant", "body": "Synthetic answer"}]}).encode())


def test_concurrent_equivalent_learning_and_shared_author_deletion(isolated_schema):
    engine, migrate = isolated_schema
    migrate("head")
    with Session(engine) as db:
        users = [User(normalized_email=f"format-{uuid.uuid4()}@example.test") for _ in range(3)]
        db.add_all(users)
        db.commit()
        user_ids = [item.id for item in users]
    analysis = analysis_fixture()
    barrier = Barrier(2)

    def learn(user_id):
        with Session(engine) as db:
            barrier.wait(timeout=10)
            profile, revision = create_verified_revision(db, analysis=analysis, mapping_spec=default_mapping(analysis),
                validation_spec={}, verification_summary={"valid": True, "group_count": 1}, name="Synthetic format", owner_user_id=user_id)
            db.commit()
            return profile.id, revision.id
    with ThreadPoolExecutor(max_workers=2) as executor:
        identities = list(executor.map(learn, user_ids[:2]))
    assert identities[0] == identities[1]
    profile_id, revision_id = identities[0]
    with Session(engine) as db:
        assert db.query(ImportProfile).count() == 1
        assert db.query(ImportProfileRevision).count() == 1
        assert db.query(ImportProfileGrant).count() == 2
        publish_revision(db, profile_id=profile_id, revision_id=revision_id, actor_id=user_ids[2], name="Shared")
        grant_revision(db, user_ids[2], db.get(ImportProfileRevision, revision_id), reason="USED")
        author = db.get(ImportProfile, profile_id).owner_user_id
        db.delete(db.get(User, author))
        db.commit()
    with Session(engine) as db:
        assert db.get(ImportProfile, profile_id).owner_user_id is None
        assert db.get(ImportProfileRevision, revision_id).created_by_user_id is None
        publication = db.get(ImportProfilePublication, profile_id)
        publication.withdrawn_at = datetime.now(timezone.utc)
        db.commit()
    with Session(engine) as db:
        assert [revision.id for _, revision in available_revisions(db, user_ids[2])] == [revision_id]


def test_migration_retains_old_ids_grants_and_distinct_mappings(isolated_schema):
    engine, migrate = isolated_schema
    migrate("20260930_0034")
    analysis = analysis_fixture()
    metadata = sa.MetaData()
    profiles = sa.Table("import_profiles", metadata, autoload_with=engine)
    revisions = sa.Table("import_profile_revisions", metadata, autoload_with=engine)
    now = datetime.now(timezone.utc)
    profile_ids, revision_ids, user_ids = [], [], []
    with Session(engine) as db:
        for index in range(3):
            user = User(normalized_email=f"legacy-{uuid.uuid4()}@example.test")
            db.add(user)
            db.flush()
            user_ids.append(user.id)
            profile_id, revision_id = uuid.uuid4(), uuid.uuid4()
            profile_ids.append(profile_id)
            revision_ids.append(revision_id)
            db.execute(profiles.insert().values(id=profile_id, owner_user_id=user.id, name=f"Legacy {index}", kind="LEARNED",
                source_mode="JSON", status="DISABLED" if index == 1 else "ACTIVE", created_at=now, updated_at=now))
            mapping = default_mapping(analysis)
            if index == 2:
                mapping["transforms"] = {"content": ["TRIM"]}
            db.execute(revisions.insert().values(id=revision_id, profile_id=profile_id, revision=1, matcher_version="adaptive-matcher-v1",
                normalizer_version="adaptive-normalizer-v1", match_spec={}, mapping_spec=mapping, validation_spec={},
                source_signature=analysis.signature, signature_digest=analysis.signature_digest, status="VERIFIED",
                verification_summary={"valid": True, "group_count": 1}, created_at=now, verified_at=now))
            db.execute(profiles.update().where(profiles.c.id == profile_id).values(current_revision_id=revision_id))
        db.commit()
    migrate("head")
    with Session(engine) as db:
        assert db.query(ImportProfile).count() == 3  # Historical identities remain addressable.
        alias = db.query(ImportProfileAlias).one()
        assert {alias.old_profile_id, alias.canonical_profile_id} == set(profile_ids[:2])
        assert profile_ids[2] not in {alias.old_profile_id, alias.canonical_profile_id}
        for user_id, revision_id in zip(user_ids, revision_ids):
            assert db.get(ImportProfileGrant, (user_id, revision_id)) is not None
        assert not available_revisions(db, user_ids[1])  # Preserve personal disabled state.
        visible = available_revisions(db, user_ids[1], include_disabled=True)
        assert len(visible) == 1 and visible[0][1].id == revision_ids[1]
        assert db.query(ImportProfilePublication).count() == 0
        assert db.get(ImportProfileRevision, revision_ids[1]).profile_id == profile_ids[1]
        db.delete(db.get(User, db.get(ImportProfile, alias.canonical_profile_id).owner_user_id))
        db.commit()
    with Session(engine) as db:
        assert len(available_revisions(db, user_ids[2])) == 1
