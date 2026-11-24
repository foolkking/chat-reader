"""Create/remove exactly 32 synthetic pending grants in the scope-only lab."""
import hashlib
import os
import sys
import base64
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.models.auth import AuthPrincipal
from app.models.reader_extension import ExtensionDevice
from app.models.user import User

EXPECTED_ORIGIN = "http://127.0.0.1:18483"
EXPECTED_CLIENT = "gihbiofiiflkckcmomddkkjkoifkddfi"
TEST_ACCOUNT = "browser-beta@example.test"
COUNT = 32


def guard():
    if os.environ.get("SYNTHETIC_ORIGIN") != EXPECTED_ORIGIN:
        raise SystemExit("Refusing to use a non-scope synthetic origin.")
    if get_settings().reader_extension_ids != [EXPECTED_CLIENT]:
        raise SystemExit("Refusing to use an unexpected extension registration.")


def fixture_hashes():
    return [
        hashlib.sha256(f"reader-device-limit-fixture:{n}".encode()).hexdigest()
        for n in range(COUNT)
    ]


def main(action):
    guard()
    if action not in {"seed", "clear"}:
        raise SystemExit("Expected seed or clear.")
    with SessionLocal.begin() as db:
        user = db.scalar(select(User).where(User.normalized_email == TEST_ACCOUNT))
        if user is None:
            raise SystemExit("Dedicated synthetic account is missing.")
        principal = db.scalar(select(AuthPrincipal).where(AuthPrincipal.user_id == user.id))
        if principal is None or principal.credential_version != user.credential_version:
            raise SystemExit("Dedicated synthetic account is not active.")

        if action == "seed":
            existing = db.scalars(select(ExtensionDevice).where(ExtensionDevice.user_id == user.id)).all()
            if existing:
                raise SystemExit("Refusing to seed while prior device grants remain.")
            now = datetime.now(timezone.utc)
            hashes = fixture_hashes()
            for n, code_hash in enumerate(hashes):
                challenge = base64.urlsafe_b64encode(
                    hashlib.sha256(f"reader-device-limit-challenge:{n}".encode()).digest()
                ).decode().rstrip("=")
                db.add(ExtensionDevice(
                    user_id=user.id,
                    client=EXPECTED_CLIENT,
                    credential_version=principal.credential_version,
                    challenge=challenge,
                    code_hash=code_hash,
                    access_hash=None,
                    refresh_hash=None,
                    access_until=now + timedelta(minutes=2),
                    expires_at=now + timedelta(minutes=2),
                    created_at=now,
                ))
            db.flush()
            count = db.scalar(select(func.count()).select_from(ExtensionDevice).where(
                ExtensionDevice.user_id == user.id,
                ExtensionDevice.client == EXPECTED_CLIENT,
                ExtensionDevice.code_hash.in_(hashes),
            ))
            if count != COUNT:
                raise SystemExit("Synthetic grant setup did not complete.")
            print('{"action":"seed","rows":32}')
            return

        hashes = fixture_hashes()
        rows = db.scalars(select(ExtensionDevice).where(
            ExtensionDevice.user_id == user.id,
            ExtensionDevice.client == EXPECTED_CLIENT,
            ExtensionDevice.code_hash.in_(hashes),
            ExtensionDevice.access_hash.is_(None),
            ExtensionDevice.refresh_hash.is_(None),
        )).all()
        if len(rows) != COUNT:
            raise SystemExit("Refusing to remove an unexpected fixture row set.")
        for row in rows:
            db.delete(row)
        db.flush()
        print('{"action":"clear","rows":32}')


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Expected seed or clear.")
    main(sys.argv[1])
