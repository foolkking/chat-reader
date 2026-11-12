"""Remove only archive-created objects when their owning DB transaction rolls back."""
from contextlib import contextmanager
import logging

from sqlalchemy import event, text
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.orm import Session

from app.services.assets.asset_store import AssetStore


_KEY = "archive_created_asset_objects"
_ATTEMPTED = "asset_commit_attempted"
_RELEASE = "asset_staging_release_after_commit"
_XIDS = "asset_commit_xids"
_PREPARED = "asset_prepared_commit_sessions"
_CONNECTIONS = "asset_prepared_connection_info"
logger = logging.getLogger(__name__)


@contextmanager
def archive_read_snapshot(db: Session):
    """Export one PostgreSQL snapshot while the worker reports in its usual session."""
    bind = db.get_bind()
    if bind.dialect.name != "postgresql":
        yield db
        return
    engine = bind.engine if isinstance(bind, Connection) else bind
    with engine.connect().execution_options(isolation_level="REPEATABLE READ") as connection:
        with Session(bind=connection) as snapshot:
            snapshot.execute(text("SET TRANSACTION READ ONLY"))
            yield snapshot


def track_archive_object(db: Session, store: AssetStore, storage_key: str) -> None:
    transaction = db.get_nested_transaction() or db.get_transaction()
    if transaction is None:
        raise RuntimeError("Archive assets require an active database transaction.")
    db.info.setdefault(_KEY, {}).setdefault(transaction, []).append((store, storage_key))


def release_staging_after_commit(db: Session, store: AssetStore, storage_key: str) -> None:
    """Retain retry input until its owning outer transaction is confirmed."""
    transaction = db.get_nested_transaction() or db.get_transaction()
    if transaction is None:
        raise RuntimeError("Staging release requires a transaction.")
    db.info.setdefault(_RELEASE, {}).setdefault(transaction, []).append((store, storage_key))


def _remove(objects) -> None:
    for store, storage_key in objects:
        try:
            store.delete_key(storage_key)
        except Exception:
            # Cleanup debt must not turn a confirmed write into a failure.
            logger.warning("asset_cleanup_deferred")


@event.listens_for(Session, "before_commit")
def _asset_commit_attempt(db: Session) -> None:
    transaction = db.get_nested_transaction() or db.get_transaction()
    if db.info.get(_KEY) or db.info.get(_RELEASE):
        # A constraint/validation failure during flush is a definite rollback,
        # not a lost COMMIT acknowledgement (notably SQLite has no xid lookup).
        db.flush()
        if db.get_bind().dialect.name == "postgresql":
            db.info.setdefault(_XIDS, {})[transaction] = db.scalar(text("SELECT pg_current_xact_id()::text"))
        if transaction is not None and transaction.parent is None:
            info = db.connection().info
            info.setdefault(_PREPARED, {})[transaction] = db
            db.info.setdefault(_CONNECTIONS, {})[transaction] = info


@event.listens_for(Engine, "commit")
def _asset_database_commit_started(connection) -> None:
    # ORM before_commit listeners can still reject without sending COMMIT.
    # Only the actual connection commit boundary makes the outcome unknown.
    for transaction, db in connection.info.pop(_PREPARED, {}).items():
        db.info.setdefault(_ATTEMPTED, set()).add(transaction)


@event.listens_for(Session, "after_commit")
def _archive_commit(db: Session) -> None:
    transaction = db.get_nested_transaction() or db.get_transaction()
    tracked = db.info.get(_KEY, {})
    objects = tracked.pop(transaction, [])
    if transaction is not None and transaction.parent is not None:
        tracked.setdefault(transaction.parent, []).extend(objects)
    if not tracked:
        db.info.pop(_KEY, None)
    db.info.get(_ATTEMPTED, set()).discard(transaction)
    db.info.get(_XIDS, {}).pop(transaction, None)
    releases = db.info.get(_RELEASE, {})
    staging = releases.pop(transaction, [])
    if transaction is not None and transaction.parent is not None:
        releases.setdefault(transaction.parent, []).extend(staging)
    else:
        _remove(staging)
    if not releases:
        db.info.pop(_RELEASE, None)


@event.listens_for(Session, "after_transaction_end")
def _archive_transaction_ended(db: Session, transaction) -> None:
    # after_commit has already released or transferred successful objects.
    # This also runs for Session.close(), including an abandoned restore.
    tracked = db.info.get(_KEY, {})
    connection_info = db.info.get(_CONNECTIONS, {}).pop(transaction, None)
    if connection_info is not None:
        connection_info.get(_PREPARED, {}).pop(transaction, None)
    objects = tracked.pop(transaction, [])
    if not tracked:
        db.info.pop(_KEY, None)
    attempted = db.info.get(_ATTEMPTED, set())
    unknown = transaction in attempted
    attempted.discard(transaction)
    staging = db.info.get(_RELEASE, {}).pop(transaction, [])
    xid = db.info.get(_XIDS, {}).pop(transaction, None)
    # A lost COMMIT acknowledgement followed by rollback/close is not proof
    # that PostgreSQL rolled back. Protect unknown objects for reconciliation.
    if unknown and xid:
        # Row absence alone is not proof of rollback: COMMIT may still be
        # running. PostgreSQL's transaction outcome is checked on a fresh
        # connection, with the same bounded auxiliary deadlines.
        try:
            bind = db.get_bind()
            engine = bind.engine if isinstance(bind, Connection) else bind
            with engine.begin() as verification:
                verification.execute(text("SET LOCAL lock_timeout = '250ms'"))
                verification.execute(text("SET LOCAL statement_timeout = '1500ms'"))
                outcome = verification.scalar(text("SELECT pg_xact_status(CAST(:xid AS xid8))"), {"xid": xid})
            if outcome == "committed":
                _remove(staging)
            elif outcome == "aborted":
                _remove(objects)
        except Exception:
            logger.warning("asset_commit_outcome_unconfirmed")
    elif not unknown:
        _remove(objects)
