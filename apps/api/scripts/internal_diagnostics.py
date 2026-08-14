from __future__ import annotations

import json

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.services.diagnostics import collect_diagnostics


def main() -> None:
    settings = get_settings()
    with SessionLocal() as db:
        payload = collect_diagnostics(db, settings)
        db.rollback()
    print(json.dumps(payload, sort_keys=True))


if __name__ == "__main__":
    main()
