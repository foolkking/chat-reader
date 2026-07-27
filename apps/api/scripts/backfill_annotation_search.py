"""Run the annotation SearchDocument backfill without changing database schema.

Usage: python -m scripts.backfill_annotation_search
"""

import json
import sys

from app.core.database import SessionLocal
from app.services.search.annotation_indexer import backfill_annotation_documents


def main() -> int:
    db = SessionLocal()
    try:
        result = backfill_annotation_documents(db)
        db.commit()
        print(json.dumps(result.__dict__, sort_keys=True))
        return 1 if result.errors else 0
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
