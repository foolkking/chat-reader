"""Transaction-local attachment identities without a selected-message-sized Python map."""
import sqlite3
import tempfile
import uuid
from contextlib import contextmanager
from pathlib import Path

from app.services.adaptive_import.bounded_io import checkpoint, release_file_cache


@contextmanager
def attachment_ids(directory):
    # Only an owned file in the already verified import directory; never a
    # persistent schema, canonical state or proof of an append succeeding.
    with tempfile.NamedTemporaryFile(dir=directory, prefix=".append-assets-", suffix=".sqlite", delete=False) as file:
        path = Path(file.name)
    connection = sqlite3.connect(path)
    try:
        connection.execute("PRAGMA cache_size=-512")
        connection.execute("PRAGMA journal_mode=OFF")
        connection.execute("CREATE TABLE ids (source TEXT PRIMARY KEY, target TEXT NOT NULL)")
        connection.commit()

        class Mapping:
            def get(self, key):
                row = connection.execute("SELECT target FROM ids WHERE source=?", (key,)).fetchone()
                return uuid.UUID(row[0]) if row else None

            def __contains__(self, key):
                return self.get(key) is not None

            def __getitem__(self, key):
                result = self.get(key)
                if result is None:
                    raise KeyError(key)
                return result

            def update(self, values):
                if not values:
                    return
                connection.executemany("INSERT INTO ids VALUES (?, ?)", [(key, str(value)) for key, value in values.items()])
                connection.commit()
                with path.open("rb") as source:
                    release_file_cache(source)
                checkpoint()

        yield Mapping()
    finally:
        connection.close()
        path.unlink(missing_ok=True)
