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
    start_lane: int = 0,
) -> None:
    deadline = monotonic() + 2.0

    def permitted() -> bool:
        return should_continue() and monotonic() < deadline

    def cleanup_exports():
        from app.services.export_retention import reclaim_exports
        if permitted():
            reclaim_exports(session_factory, export_root, limit=20, should_continue=permitted)

    def cleanup_shares():
        from app.services.sharing.share_service import reclaim_expired_frozen_snapshots
        if permitted():
            reclaim_expired_frozen_snapshots(session_factory, limit=20, should_continue=permitted)

    def cleanup_uploads():
        from app.services.assets.upload_service import cleanup_finished_uploads
        if permitted():
            cleanup_finished_uploads(session_factory, limit=20, should_continue=permitted)

    def cleanup_assets():
        from app.services.assets.lifecycle import cleanup_deleted_assets
        if permitted():
            with session_factory() as db:
                cleanup_deleted_assets(db, limit=20, should_continue=permitted)

    operations = (
        ("export", cleanup_exports),
        ("expired_share", cleanup_shares),
        ("upload_staging", cleanup_uploads),
        ("deleted_assets", cleanup_assets),
    )
    ordered = operations if exports_first else tuple(reversed(operations))
    start = start_lane % len(ordered)
    for category, operation in ordered[start:] + ordered[:start]:
        if not permitted():
            return
        try:
            operation()
        except Exception as exc:
            # No raw paths, exception messages or business IDs. One family's
            # failure does not suppress the other family within this budget.
            structured_event(logger, logging.WARNING, "worker_maintenance_failed",
                             category=category, error_class=type(exc).__name__)
