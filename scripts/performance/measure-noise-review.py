"""Synthetic SQLite candidate-page allocation probe; never use a live database."""
from __future__ import annotations

import argparse
import gc
import hashlib
import json
from pathlib import Path
import platform
import sys
import tempfile
import time
import tracemalloc

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "apps/api"), str(ROOT / "apps/api/tests")]

from pytest import MonkeyPatch  # noqa: E402
from app.models.content_cleanup import ContentCleanupOccurrence as Occurrence  # noqa: E402
from app.models.message_version import MessageVersion  # noqa: E402
from app.services import content_cleanup as cleanup  # noqa: E402
from test_import_preview_api import client as client_fixture  # noqa: E402
from test_cleanup_safety import MARKER, create_review, session  # noqa: E402


def joined_control(db, scan_id):
    # Conservative control for the old page-fetch shape: even this reduced
    # two-entity join fetches whole text/plain/blocks once per occurrence row.
    rows = db.query(Occurrence, MessageVersion).join(
        MessageVersion, MessageVersion.id == Occurrence.message_version_id,
    ).filter(Occurrence.scan_id == scan_id).order_by(
        Occurrence.conversation_id, Occurrence.message_id, Occurrence.start_offset,
    ).limit(100).all()
    return [version.display_text[row.start_offset:row.end_offset] for row, version in rows]


def measure(operation):
    gc.collect()
    tracemalloc.start()
    started = time.perf_counter()
    try:
        with session() as db:
            result = operation(db)
        elapsed = time.perf_counter() - started
        _current, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    digest = hashlib.sha256("\n".join(result).encode()).hexdigest()
    return {
        "milliseconds": round(elapsed * 1000, 3),
        "peak_traced_bytes": peak, "matches": len(result), "match_digest": digest,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    # Caller sets TEMP/TMP to the task workspace. The shared test fixture owns a
    # fresh SQLite database and overrides get_db; no configured database is used.
    temporary_root = Path(tempfile.gettempdir()).resolve()
    with tempfile.TemporaryDirectory(prefix="noise-review-", dir=temporary_root) as directory:
        root = Path(directory).resolve()
        if root.parent != temporary_root or root.is_symlink():
            raise RuntimeError("Temporary cleanup target is outside the task directory.")
        with MonkeyPatch.context() as patch:
            for name in ("ASSET_STORAGE_DIR", "OFFLINE_STORAGE_DIR"):
                patch.setenv(name, str(root / name.lower()))
            patch.setenv("AUTH_ENABLED", "false")
            patch.setenv("APP_ENV", "development")
            source = ("Retained " + "body " * 100 + MARKER + " after.\n") * 110
            fixture = client_fixture.__wrapped__(root, patch)
            client = next(fixture)
            with session() as db:
                engine = db.get_bind()
            try:
                scan_id, _ = create_review(client, [source])
                control = measure(lambda db: joined_control(db, scan_id))
                current = measure(lambda db: [
                    item["match_text"] for item in cleanup.preview_occurrences(db, scan_id, limit=100)
                ])
            finally:
                try:
                    try:
                        next(fixture)
                    except StopIteration:
                        pass
                finally:
                    engine.dispose()  # Release SQLite file handles before Windows cleanup.
    if (control["matches"], control["match_digest"]) != (current["matches"], current["match_digest"]):
        raise RuntimeError("Candidate-page matches changed.")
    report = json.dumps({
        "version": 1, "platform": platform.system(), "python": platform.python_version(),
        "measurement": "Synthetic SQLite function-only tracemalloc/wall time; not RSS, PostgreSQL, cgroup or OOM acceptance.",
        "source_characters": len(source), "page_matches": 100,
        "control": "Reduced old-style joined full-version page, not an exact old-endpoint benchmark.",
        "joined_source_page": control, "metadata_page_current_source": current,
        "source_sha256": {
            name: hashlib.sha256((ROOT / "apps/api/app/services" / name).read_bytes()).hexdigest()
            for name in ("content_cleanup.py", "cleanup_protection.py", "cleanup_review.py")
        },
        "data": "Synthetic only; fresh isolated SQLite, no production or user files.",
    }, indent=2) + "\n"
    if args.output:
        args.output.write_text(report, encoding="utf-8")
    else:
        print(report, end="")


if __name__ == "__main__":
    main()
