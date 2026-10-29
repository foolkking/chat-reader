import asyncio
import anyio
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.models.offline_package_lease import OfflinePackageLease
from app.services.offline_download import (
    OfflineFileResponse,
    acquire_offline_download,
    cleanup_offline_artifacts,
    has_active_offline_lease,
    renew_offline_download,
    release_offline_download,
)


def _factory(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'offline-leases.db'}")

    @event.listens_for(engine, "connect")
    def foreign_keys(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    return engine, sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def test_cleanup_defers_active_download_and_removes_after_release(tmp_path):
    now = datetime.now(timezone.utc)
    engine, factory = _factory(tmp_path)
    try:
        root = tmp_path / "offline"
        root.mkdir()
        path = root / "package.zip"
        path.write_bytes(b"synthetic package")
        with factory() as db:
            lease_id = acquire_offline_download(db, str(path), now=now)
            db.commit()

        assert cleanup_offline_artifacts([path], root=root, session_factory=factory) == 0
        assert path.is_file()

        release_offline_download(factory, str(path), lease_id)
        assert cleanup_offline_artifacts([path], root=root, session_factory=factory) == 0
        assert not path.exists()
    finally:
        engine.dispose()


def test_expired_lease_does_not_protect_artifact(tmp_path):
    now = datetime.now(timezone.utc)
    engine, factory = _factory(tmp_path)
    try:
        root = tmp_path / "offline"
        root.mkdir()
        path = root / "expired.zip"
        path.write_bytes(b"synthetic package")
        with factory() as db:
            lease_id = acquire_offline_download(db, str(path), now=now - timedelta(seconds=91))
            db.commit()
            assert not has_active_offline_lease(db, str(path), now=now)
            assert db.get(OfflinePackageLease, {"storage_uri": str(path), "lease_id": lease_id}) is not None

        assert cleanup_offline_artifacts([path], root=root, session_factory=factory) == 0
        assert not path.exists()
    finally:
        engine.dispose()


def test_renew_normalizes_sqlite_naive_datetime(tmp_path):
    now = datetime.now(timezone.utc)
    engine, factory = _factory(tmp_path)
    try:
        path = Path(tmp_path) / "offline" / "naive.zip"
        path.parent.mkdir()
        with factory() as db:
            lease_id = acquire_offline_download(db, str(path), now=now)
            db.commit()
            row = db.get(OfflinePackageLease, {"storage_uri": str(path), "lease_id": lease_id})
            row.expires_at = (now + timedelta(seconds=60)).replace(tzinfo=None)
            db.commit()

        before = datetime.now(timezone.utc)
        assert renew_offline_download(factory, str(path), lease_id)
        with factory() as db:
            row = db.get(OfflinePackageLease, {"storage_uri": str(path), "lease_id": lease_id})
            assert row is not None
            assert row.expires_at.replace(tzinfo=timezone.utc) > before + timedelta(seconds=89)
    finally:
        engine.dispose()


def test_asgi_transfer_keeps_superseded_artifact_until_response_finishes(tmp_path):
    engine, factory = _factory(tmp_path)
    try:
        root = tmp_path / "offline"
        root.mkdir()
        path = root / "synthetic-package.crpkg"
        payload = b"synthetic offline package\n" * 8192
        path.write_bytes(payload)
        with factory() as db:
            lease_id = acquire_offline_download(db, str(path))
            db.commit()

        response = OfflineFileResponse(
            path,
            session_factory=factory,
            storage_uri=str(path),
            lease_id=lease_id,
            media_type="application/octet-stream",
            filename=path.name,
        )
        body_chunks: list[bytes] = []
        cleanup_deferred = False

        async def receive():
            await anyio.sleep_forever()

        async def send(message):
            nonlocal cleanup_deferred
            if message["type"] == "http.response.start":
                # A replacement/retention pass must not remove a file while
                # FileResponse has sent headers but has not opened it yet.
                assert cleanup_offline_artifacts([path], root=root, session_factory=factory) == 0
                assert path.is_file()
                cleanup_deferred = True
            if message["type"] == "http.response.body":
                body_chunks.append(message.get("body", b""))

        asyncio.run(response(
            {
                "type": "http",
                "method": "GET",
                "headers": [],
                "extensions": {"http.response.pathsend": {}},
            },
            receive,
            send,
        ))

        assert cleanup_deferred
        assert b"".join(body_chunks) == payload
        with factory() as db:
            assert not has_active_offline_lease(db, str(path))
        assert cleanup_offline_artifacts([path], root=root, session_factory=factory) == 0
        assert not path.exists()
    finally:
        engine.dispose()


@pytest.mark.parametrize("failure", ["headers", "body"])
def test_asgi_response_releases_download_lease_on_transfer_failure(tmp_path, failure):
    engine, factory = _factory(tmp_path)
    try:
        root = tmp_path / "offline"
        root.mkdir()
        path = root / "synthetic-failure.crpkg"
        path.write_bytes(b"synthetic offline package")
        with factory() as db:
            lease_id = acquire_offline_download(db, str(path))
            db.commit()

        response = OfflineFileResponse(
            path,
            session_factory=factory,
            storage_uri=str(path),
            lease_id=lease_id,
            media_type="application/octet-stream",
            filename=path.name,
        )
        sent = []

        async def receive():
            await anyio.sleep_forever()

        async def send(message):
            if (
                failure == "headers" and message["type"] == "http.response.start"
                or failure == "body" and message["type"] == "http.response.body"
            ):
                raise ConnectionError("synthetic client disconnect")
            sent.append(message)

        with pytest.raises(ExceptionGroup):
            asyncio.run(response({"type": "http", "method": "GET", "headers": []}, receive, send))

        with factory() as db:
            assert not has_active_offline_lease(db, str(path))
        assert path.is_file()
        assert cleanup_offline_artifacts([path], root=root, session_factory=factory) == 0
        assert not path.exists()
    finally:
        engine.dispose()
