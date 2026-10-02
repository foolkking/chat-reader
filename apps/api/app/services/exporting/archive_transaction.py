"""Remove only archive-created objects when their owning DB transaction rolls back."""
from contextlib import contextmanager

from sqlalchemy import event, text
from sqlalchemy.engine import Connection
from sqlalchemy.orm import Session

from app.services.assets.asset_store import AssetStore


_KEY = "archive_created_asset_objects"


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


@event.listens_for(Session, "after_commit")
def _archive_commit(db: Session) -> None:
    transaction = db.get_nested_transaction() or db.get_transaction()
    tracked = db.info.get(_KEY, {})
    objects = tracked.pop(transaction, [])
    if transaction is not None and transaction.parent is not None:
        tracked.setdefault(transaction.parent, []).extend(objects)
    if not tracked:
        db.info.pop(_KEY, None)


@event.listens_for(Session, "after_transaction_end")
def _archive_transaction_ended(db: Session, transaction) -> None:
    # after_commit has already released or transferred successful objects.
    # This also runs for Session.close(), including an abandoned restore.
    tracked = db.info.get(_KEY, {})
    objects = tracked.pop(transaction, [])
    if not tracked:
        db.info.pop(_KEY, None)
    for store, storage_key in objects:
        store.delete_key(storage_key)
