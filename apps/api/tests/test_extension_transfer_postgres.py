"""Disposable PostgreSQL: request identity, device serialization and chunk acknowledgement."""
import hashlib
import io
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from threading import Barrier

import pytest
from fastapi import HTTPException, UploadFile
from sqlalchemy.orm import sessionmaker

from app.core.config import get_settings
from app.models.background_job import BackgroundJob
from app.models.import_record import ImportRecord
from app.models.reader_extension import ExtensionDevice
from app.models.user import User
from app.services import extension_transfer as tx
from app.services.ownership import OwnershipScope
from test_import_profile_postgres import isolated_schema  # noqa: F401

pytestmark = pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1",
                               reason="explicit disposable PostgreSQL required")


@pytest.fixture
def transfers(isolated_schema, monkeypatch, tmp_path):
    engine, migrate = isolated_schema
    migrate("head")
    monkeypatch.setenv("IMPORT_STORAGE_DIR", str(tmp_path / "imports"))
    monkeypatch.setenv("READER_EXTENSION_CAPTURE", "true")
    get_settings.cache_clear()
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    with factory() as db:
        users = [User(normalized_email=f"capture-{n}@example.test") for n in range(2)]
        db.add_all(users)
        db.flush()
        devices = [ExtensionDevice(user_id=u.id, client="a" * 32, credential_version=1,
                   created_at=datetime.now(timezone.utc), access_until=datetime.now(timezone.utc) + timedelta(hours=1),
                   expires_at=datetime.now(timezone.utc) + timedelta(days=1)) for u in users]
        db.add_all(devices)
        db.commit()
        identities = [(OwnershipScope(u.id), d.id) for u, d in zip(users, devices)]
    yield factory, identities
    get_settings.cache_clear()


def test_two_starts_and_chunk_replays_have_one_durable_owner(transfers):
    factory, identities = transfers
    scope, device = identities[0]
    data = b"synthetic controlled upload"
    sha = hashlib.sha256(data).hexdigest()
    barrier = Barrier(2)

    def begin(key):
        with factory() as db:
            barrier.wait(timeout=10)
            try:
                return key, tx.begin(db, scope, device, key, len(data), sha, None, False)
            except HTTPException as error:
                return key, error.status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        attempts = list(pool.map(begin, [uuid.uuid4(), uuid.uuid4()]))
    assert sorted(isinstance(result, dict) for _, result in attempts) == [False, True]
    assert next(result for _, result in attempts if isinstance(result, int)) == 409
    key = next(key for key, result in attempts if isinstance(result, dict))
    with factory() as db:
        assert db.query(ImportRecord).filter_by(phase="receiving").count() == 1
        assert tx.begin(db, scope, device, key, len(data), sha, None, False)["offset"] == 0
        with pytest.raises(HTTPException) as error:
            tx._record(db, *identities[1], key)
        assert error.value.status_code == 404
    barrier = Barrier(2)

    def chunk(_):
        with factory() as db:
            barrier.wait(timeout=10)
            try:
                upload = UploadFile(io.BytesIO(data), size=len(data), filename="chunk")
                return tx.chunk(db, scope, device, key, 0, sha, upload)
            except HTTPException as error:
                return error.status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        attempts = list(pool.map(chunk, range(2)))
    assert sum(isinstance(result, dict) for result in attempts) == 1
    assert 409 in attempts
    with factory() as db:
        record = tx._record(db, scope, device, key)
        assert record.total_bytes == len(data)
        assert tx._part(record).read_bytes() == data
        assert db.query(BackgroundJob).filter_by(job_type="adaptive_import_analysis").count() == 0
        done = tx.finish(db, scope, device, key)
        assert done["offset"] == len(data) and done["id"]
    with factory() as db:
        assert tx.finish(db, scope, device, key)["id"] == done["id"]
        assert db.query(BackgroundJob).filter_by(job_type="adaptive_import_analysis").count() == 1
        assert len(db.get(ImportRecord, done["id"]).artifacts) == 1


def test_unfinished_expiry_never_removes_an_accepted_import(transfers):
    factory, identities = transfers
    scope, device = identities[0]
    data, key = b"synthetic source", uuid.uuid4()
    sha = hashlib.sha256(data).hexdigest()
    with factory() as db:
        tx.begin(db, scope, device, key, len(data), sha, None, False)
        tx.chunk(db, scope, device, key, 0, sha, UploadFile(io.BytesIO(data), size=len(data)))
        record = tx._record(db, scope, device, key)
        path = tx._part(record)
        record.updated_at = datetime.now(timezone.utc) - timedelta(days=2)
        db.commit()
        next_key = uuid.uuid4()
        tx.begin(db, scope, device, next_key, len(data), sha, None, False)
        assert not path.exists()
        assert db.get(ImportRecord, record.id).session_state == "CANCELED"
        tx.chunk(db, scope, device, next_key, 0, sha, UploadFile(io.BytesIO(data), size=len(data)))
        accepted = tx.finish(db, scope, device, next_key)
        received = db.get(ImportRecord, accepted["id"])
        path = tx._part(received)
        received.updated_at = datetime.now(timezone.utc) - timedelta(days=2)
        db.commit()
        tx.begin(db, scope, device, uuid.uuid4(), len(data), sha, None, False)
        assert path.read_bytes() == data
        assert db.get(ImportRecord, accepted["id"]).session_state == "ANALYZING"
