"""Lease-bound responses for offline package downloads."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import anyio
from fastapi import HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import delete, select
from sqlalchemy.orm import sessionmaker

from app.core.observability import structured_event
from app.models.offline_package_lease import OfflinePackageLease

logger = logging.getLogger(__name__)
DOWNLOAD_SECONDS = 90


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime) -> datetime:
    """Normalize timezone-aware and SQLite-naive timestamps to UTC."""
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def acquire_offline_download(db, storage_uri: str, *, now: datetime | None = None) -> uuid.UUID:
    lease_id = uuid.uuid4()
    timestamp = now or _now()
    db.add(
        OfflinePackageLease(
            storage_uri=storage_uri,
            lease_id=lease_id,
            expires_at=timestamp + timedelta(seconds=DOWNLOAD_SECONDS),
        )
    )
    db.flush()
    return lease_id


def renew_offline_download(factory, storage_uri: str, lease_id: uuid.UUID) -> bool:
    with factory() as db:
        lease = db.scalar(
            select(OfflinePackageLease).where(
                OfflinePackageLease.storage_uri == storage_uri,
                OfflinePackageLease.lease_id == lease_id,
            )
        )
        if lease is None or _as_utc(lease.expires_at) <= _now():
            return False
        lease.expires_at = _now() + timedelta(seconds=DOWNLOAD_SECONDS)
        db.commit()
        return True


def release_offline_download(factory, storage_uri: str, lease_id: uuid.UUID) -> None:
    with factory() as db:
        db.execute(
            delete(OfflinePackageLease).where(
                OfflinePackageLease.storage_uri == storage_uri,
                OfflinePackageLease.lease_id == lease_id,
            )
        )
        db.commit()


def has_active_offline_lease(db, storage_uri: str, *, now: datetime | None = None) -> bool:
    timestamp = now or _now()
    return db.scalar(
        select(OfflinePackageLease.lease_id)
        .where(
            OfflinePackageLease.storage_uri == storage_uri,
            OfflinePackageLease.expires_at > timestamp,
        )
        .limit(1)
    ) is not None


def cleanup_offline_artifacts(paths, *, root: Path, session_factory, unlinker=None) -> int:
    """Delete superseded files unless a browser transfer still owns them."""
    root = root.resolve()
    failures = 0
    deletable: list[Path] = []
    for candidate in paths:
        path = Path(candidate).resolve()
        if not path.is_relative_to(root):
            failures += 1
            structured_event(logger, logging.WARNING, "artifact_cleanup_failed", category="offline", reason="outside_root")
            continue
        with session_factory() as db:
            if has_active_offline_lease(db, str(path)):
                structured_event(logger, logging.INFO, "artifact_cleanup_deferred", category="offline", reason="active_download")
                continue
        deletable.append(path)
    if unlinker is not None and deletable:
        return failures + int(unlinker(deletable, root=root, category="offline"))
    for path in deletable:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            failures += 1
            structured_event(logger, logging.WARNING, "artifact_cleanup_failed", category="offline", reason="unlink_failed")
    return failures


class OfflineFileResponse(FileResponse):
    def __init__(self, *args, session_factory: sessionmaker, storage_uri: str, lease_id: uuid.UUID, **kwargs):
        super().__init__(*args, **kwargs)
        self.session_factory = session_factory
        self.storage_uri = storage_uri
        self.lease_id = lease_id

    async def __call__(self, scope, receive, send):
        async def keep_alive():
            while True:
                await anyio.sleep(15)
                if not await anyio.to_thread.run_sync(
                    renew_offline_download,
                    self.session_factory,
                    self.storage_uri,
                    self.lease_id,
                ):
                    raise RuntimeError("Offline download lease expired")

        # Do not hand the path to an ASGI pathsend extension. The lease must
        # cover the actual response lifetime, not merely route construction.
        scope = {
            **scope,
            "extensions": {
                key: value
                for key, value in scope.get("extensions", {}).items()
                if key != "http.response.pathsend"
            },
        }
        try:
            if not await anyio.to_thread.run_sync(
                renew_offline_download,
                self.session_factory,
                self.storage_uri,
                self.lease_id,
            ):
                raise HTTPException(410, "Offline download has expired. Generate it again.")
            async with anyio.create_task_group() as group:
                group.start_soon(keep_alive)
                await super().__call__(scope, receive, send)
                group.cancel_scope.cancel()
        finally:
            with anyio.CancelScope(shield=True):
                try:
                    await anyio.to_thread.run_sync(
                        release_offline_download,
                        self.session_factory,
                        self.storage_uri,
                        self.lease_id,
                    )
                except Exception as exc:
                    structured_event(
                        logger,
                        logging.WARNING,
                        "offline_download_release_failed",
                        error_class=type(exc).__name__,
                    )
