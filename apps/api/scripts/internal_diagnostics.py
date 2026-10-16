from __future__ import annotations

import json
import os
from pathlib import Path
import signal
import sys

from app.core.memory import available_memory_bytes


def serving_container() -> bool:
    """Refuse before ORM/config imports, even if the isolation flag was spoofed."""
    if not sys.platform.startswith("linux"):
        return False
    try:
        argv = Path("/proc/1/cmdline").read_bytes().split(b"\0")
    except OSError:
        return True
    return any(Path(os.fsdecode(arg)).name in {"uvicorn", "gunicorn"} for arg in argv if arg)


def _deadline(_signum, _frame):
    raise TimeoutError("Diagnostic time budget exceeded")


def main() -> int:
    production = os.environ.get("APP_ENV", "").strip().lower() in {"production", "prod"}
    if serving_container():
        print(json.dumps({"status": "unavailable", "reason": "SERVING_CONTAINER_DIAGNOSTICS_FORBIDDEN",
                          "use": "deploy/run_internal_diagnostics.sh"}), file=sys.stderr)
        return 2
    if production:
        available = available_memory_bytes()
        if os.environ.get("CHAT_READER_DIAGNOSTICS_ISOLATED") != "1" or available is None or available < 384 * 1024 * 1024:
            print(json.dumps({"status": "unavailable", "reason": "ISOLATION_AND_MEMORY_HEADROOM_REQUIRED",
                              "use": "deploy/run_internal_diagnostics.sh"}), file=sys.stderr)
            return 75
    if sys.platform.startswith("linux"):
        signal.signal(signal.SIGALRM, _deadline)
        signal.alarm(25)
    try:
        # Never import the ORM/diagnostic graph until cheap safety gates pass.
        from app.core.config import get_settings
        from app.core.database import SessionLocal
        from app.services.diagnostics import collect_diagnostics

        settings = get_settings()
        with SessionLocal() as db:
            payload = collect_diagnostics(db, settings)
            db.rollback()
        print(json.dumps(payload, sort_keys=True))
        return 0
    except Exception:
        # Do not emit DSNs, SQL parameters, filesystem identities or payloads.
        print(json.dumps({"status": "unavailable", "reason": "BOUNDED_DIAGNOSTICS_FAILED"}), file=sys.stderr)
        return 1
    finally:
        if sys.platform.startswith("linux"):
            signal.alarm(0)


if __name__ == "__main__":
    raise SystemExit(main())
