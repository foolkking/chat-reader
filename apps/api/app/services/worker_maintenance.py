"""Small, cooperative housekeeping inside the existing single-job worker."""
from collections.abc import Callable
import logging
from pathlib import Path
import time

from sqlalchemy import text

from app.core.observability import structured_event

logger = logging.getLogger(__name__)


def bound_worker_transaction(db) -> None:
    """Transaction-local only: never leak deadlines into a pooled connection."""
    if db.get_bind().dialect.name == "postgresql":
        db.execute(text("SET LOCAL statement_timeout = '1500ms'"))
        db.execute(text("SET LOCAL lock_timeout = '250ms'"))


def run_worker_maintenance(
    session_factory,
    export_root: Path,
    *,
    should_continue: Callable[[], bool],
    monotonic: Callable[[], float] = time.monotonic,
    exports_first: bool = True,
) -> None:
    from app.services.export_retention import reclaim_exports
    from app.services.sharing.share_service import reclaim_expired_frozen_snapshots

    deadline = monotonic() + 2.0

    def permitted() -> bool:
        return should_continue() and monotonic() < deadline

    operations = (
        ("export", lambda: reclaim_exports(session_factory, export_root, limit=20, should_continue=permitted)),
        ("expired_share", lambda: reclaim_expired_frozen_snapshots(session_factory, limit=20, should_continue=permitted)),
    )
    for category, operation in operations if exports_first else reversed(operations):
        if not permitted():
            return
        try:
            operation()
        except Exception as exc:
            # No raw paths, exception messages or business IDs. One family's
            # failure does not suppress the other family within this budget.
            structured_event(logger, logging.WARNING, "worker_maintenance_failed",
                             category=category, error_class=type(exc).__name__)
