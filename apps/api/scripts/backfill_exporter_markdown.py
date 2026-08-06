"""Repair legacy JSON+Markdown imports without changing database schema.

Usage:
  python -m scripts.backfill_exporter_markdown
  python -m scripts.backfill_exporter_markdown --apply
  python -m scripts.backfill_exporter_markdown --apply --import-id <uuid>
"""

import argparse
import json
import sys
from dataclasses import asdict
from uuid import UUID

from app.core.database import SessionLocal
from app.services.import_pipeline.markdown_repair import repair_exporter_markdown_imports


def main() -> int:
    parser = argparse.ArgumentParser(description="Repair validated Markdown display bodies for legacy paired imports.")
    parser.add_argument("--apply", action="store_true", help="Write repair versions. Defaults to a read-only dry run.")
    parser.add_argument("--import-id", type=UUID, help="Limit the operation to one import record.")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        result = repair_exporter_markdown_imports(db, import_id=args.import_id, dry_run=not args.apply)
        if args.apply:
            db.commit()
        else:
            db.rollback()
        print(json.dumps({"dry_run": not args.apply, **asdict(result)}, sort_keys=True))
        return 1 if result.failed_imports else 0
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
