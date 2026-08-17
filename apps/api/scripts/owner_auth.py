from __future__ import annotations

import argparse
import getpass

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.models.auth import AuthPrincipal
from app.services.auth import provision_owner


def main() -> None:
    parser = argparse.ArgumentParser(description="Provision or reset the single Chat Reader owner password.")
    parser.add_argument("command", choices=["provision", "reset"])
    args = parser.parse_args()
    settings = get_settings()
    password = getpass.getpass("New owner password: ")
    confirmation = getpass.getpass("Confirm owner password: ")
    if password != confirmation:
        parser.error("passwords do not match")
    with SessionLocal() as db:
        existing = db.get(AuthPrincipal, "owner")
        if args.command == "provision" and existing is not None:
            parser.error("owner credential already exists; use reset")
        if args.command == "reset" and existing is None:
            parser.error("owner credential does not exist; use provision")
        principal = provision_owner(db, password, settings)
    print(f"Owner credential provisioned at version {principal.credential_version}; all prior sessions are invalid.")


if __name__ == "__main__":
    main()
