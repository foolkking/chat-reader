from __future__ import annotations

import argparse
import json

from app.core.database import SessionLocal
from app.services.assets.lifecycle import garbage_collect_assets


def main() -> None:
    parser = argparse.ArgumentParser(description="Find or delete unreferenced attachment objects.")
    parser.add_argument("--retention-days", type=int, default=30)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    with SessionLocal() as db:
        result = garbage_collect_assets(db, retention_days=args.retention_days, execute=args.execute)
        if not args.execute:
            db.rollback()
    print(json.dumps(result.__dict__, sort_keys=True))


if __name__ == "__main__":
    main()
