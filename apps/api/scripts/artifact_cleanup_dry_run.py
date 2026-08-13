from __future__ import annotations

import json

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.services.artifact_lifecycle import classify_artifact_files


def main() -> None:
    settings = get_settings()
    with SessionLocal() as db:
        result = classify_artifact_files(
            db,
            roots={"offline": settings.offline_storage_dir, "export": settings.export_storage_dir},
        )
        db.rollback()
    print(json.dumps({"dry_run": True, "categories": result}, sort_keys=True))


if __name__ == "__main__":
    main()
