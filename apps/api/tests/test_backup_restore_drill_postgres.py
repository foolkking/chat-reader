"""An actual pg_dump/pg_restore drill, never a production database restore."""
import hashlib
import os
import shutil
import subprocess
import uuid

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.attachment import AssetObject
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.user_feature_entry import UserFeatureEntry
from app.models.user_preference import UserPreference
from postgres_backup_tools import backup_clients
from test_import_profile_postgres import isolated_schema  # noqa: F401
from test_system_archive_integrity import seed_archive_source

pytestmark = pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1",
    reason="requires explicitly selected disposable PostgreSQL")


def test_stopped_writer_database_and_asset_backup_really_restores(isolated_schema, tmp_path, monkeypatch):
    engine, migrate = isolated_schema
    assert engine.url.host in {"localhost", "127.0.0.1", "::1"}
    assert engine.url.database.startswith("settings_formats_")
    migrate("head")
    with engine.connect() as connection:
        server_major = int(connection.execute(sa.text("SHOW server_version_num")).scalar()) // 10000
    assets = tmp_path / "source-assets"
    monkeypatch.setenv("ASSET_STORAGE_DIR", str(assets))
    monkeypatch.setenv("ASSET_STORAGE_BACKEND", "local")
    get_settings.cache_clear()
    with Session(engine) as db:
        users, conversations, _, asset = seed_archive_source(db)
        subject = str(users[0].id)
        db.add(UserPreference(subject_key=subject))
        db.flush()
        db.add(UserFeatureEntry(subject_key=subject, collection="reading-list",
            value={"conversation_id": str(conversations[0].id), "state": "unread"}))
        db.commit()
        asset_id, checksum, key = asset.id, asset.sha256, asset.storage_key
        current_version = db.query(Message.current_version_id).scalar()
    # No worker/API is attached to either generated database; all writers are
    # closed before the database and asset snapshots are taken.
    backup = tmp_path / "backup"
    backup.mkdir()
    shutil.copytree(assets, backup / "assets")
    restored_assets = tmp_path / "restored-assets"
    dump = backup / "database.dump"
    target_name = "restore_drill_" + uuid.uuid4().hex
    admin = sa.create_engine(engine.url.set(database="postgres"), isolation_level="AUTOCOMMIT")
    target = sa.create_engine(engine.url.set(database=target_name))
    env = {**os.environ, "PGHOST": engine.url.host, "PGPORT": str(engine.url.port or 5432),
        "PGUSER": engine.url.username or "", "PGPASSWORD": engine.url.password or ""}

    clients, flags = backup_clients(engine.url, server_major)

    def run(tool, *args, input=None):
        result = subprocess.run([*clients[tool], *flags, *args], input=input,
                                env=env, capture_output=True, timeout=120)
        assert result.returncode == 0, result.stderr.decode(errors="replace")
        return result.stdout

    created = False
    try:
        dump.write_bytes(run("pg_dump", "--format=custom", "--no-owner", "--no-acl",
                             "--dbname", engine.url.database))
        with admin.connect() as db:
            db.execute(sa.text(f'CREATE DATABASE "{target_name}"'))
            created = True
        run("pg_restore", "--exit-on-error", "--single-transaction", "--no-owner", "--no-acl",
            "--dbname", target_name, input=dump.read_bytes())
        shutil.copytree(backup / "assets", restored_assets)
        with Session(target) as db:
            assert db.execute(sa.text("SELECT version_num FROM alembic_version")).scalar() == "20261105_0059"
            assert db.query(Message).count() == 1
            assert db.query(MessageVersion).count() == 2
            assert db.get(MessageVersion, current_version).display_text == "Synthetic"
            assert db.query(UserFeatureEntry).one().subject_key == subject
            restored = db.get(AssetObject, asset_id)
            assert restored.storage_key == key and restored.sha256 == checksum
            restored_path = (restored_assets / key).resolve()
            assert restored_path.is_relative_to(restored_assets.resolve())
            assert hashlib.sha256(restored_path.read_bytes()).hexdigest() == checksum
        print("Restore drill: migrated database, current/historical versions, account-scoped favorite and asset bytes verified.")
    finally:
        target.dispose()
        if created:
            # Only the random database created in this invocation is removable.
            assert target_name.startswith("restore_drill_") and len(target_name) == 46
            with admin.connect() as db:
                db.execute(sa.text(f'DROP DATABASE "{target_name}" WITH (FORCE)'))
        admin.dispose()
        get_settings.cache_clear()
