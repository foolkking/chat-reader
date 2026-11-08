"""Exact heading slug counts without retaining every title in Python memory."""
import sqlite3
import uuid
from contextlib import contextmanager

from app.services.adaptive_import.bounded_io import checkpoint, release_file_cache
from app.services.adaptive_import.memory_budget import current_budget


@contextmanager
def heading_counts():
    budget = current_budget()
    if budget is None or not budget.streaming or budget.scratch_directory is None:
        yield {}
        return
    path = budget.scratch_directory / f".heading-counts-{uuid.uuid4().hex}.sqlite"
    connection = sqlite3.connect(path)
    try:
        connection.execute("PRAGMA cache_size=-512")
        connection.execute("PRAGMA journal_mode=OFF")
        connection.execute("CREATE TABLE counts (key TEXT PRIMARY KEY, value INTEGER NOT NULL)")
        connection.commit()

        class Counter:
            writes = 0

            def get(self, key, default):
                row = connection.execute("SELECT value FROM counts WHERE key=?", (key,)).fetchone()
                return row[0] if row else default

            def __setitem__(self, key, value):
                connection.execute("INSERT INTO counts VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                                   (key, value))
                self.writes += 1
                if self.writes % 16 == 0:
                    connection.commit()
                    with path.open("rb") as source:
                        release_file_cache(source)
                    checkpoint()
        yield Counter()
    finally:
        connection.close()
        path.unlink(missing_ok=True)
