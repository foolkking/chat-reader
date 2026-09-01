from __future__ import annotations

import argparse
import getpass
import hashlib
import hmac
import os

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.models.auth import AuthPrincipal
from app.models.user import User
from app.services.auth import normalize_email, provision_owner


def main() -> None:
    parser = argparse.ArgumentParser(description="Provision or reset the single Chat Reader administrator credential.")
    parser.add_argument("command", choices=["provision", "reset", "ensure-configured"])
    parser.add_argument("--email", help="Administrator sign-in email (required for a new provision).")
    parser.add_argument("--display-name", default=None, help="Optional administrator display name.")
    args = parser.parse_args()
    settings = get_settings()
    if args.command == "ensure-configured":
        ensure_configured_admin(settings)
        return
    if args.command == "provision" and not args.email:
        parser.error("--email is required when provisioning the administrator.")
    normalized_email = None
    if args.email:
        try:
            normalized_email = normalize_email(args.email)
        except ValueError as exc:
            parser.error(str(exc))
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
        if args.email:
            user = db.get(User, principal.user_id) if principal.user_id else None
            if user is None:
                parser.error("administrator user record is unavailable")
            user.normalized_email = normalized_email
            if args.display_name and args.display_name.strip():
                user.display_name = args.display_name.strip()[:200]
            db.commit()
    print(f"Administrator credential provisioned at version {principal.credential_version}; all prior sessions are invalid.")


def ensure_configured_admin(settings) -> None:
    email = os.environ.get("ADMIN_EMAIL", "").strip()
    password = os.environ.get("ADMIN_PASSWORD", "")
    if not email and not password:
        print("Administrator deployment variables are not configured; leaving the account unchanged.")
        return
    if not email or not password:
        raise SystemExit("ADMIN_EMAIL and ADMIN_PASSWORD must be provided together.")
    try:
        normalized_email = normalize_email(email)
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc
    digest_payload = f"chat-reader-admin-config-v1\0{normalized_email}\0{password}".encode("utf-8")
    config_digest = hmac.new(
        settings.auth_secret_value().encode("utf-8"), digest_payload, hashlib.sha256
    ).hexdigest()
    with SessionLocal() as db:
        existing = db.get(AuthPrincipal, "owner")
        user = db.get(User, existing.user_id) if existing and existing.user_id else None
        if existing is not None and existing.deployment_config_digest == config_digest and user is not None:
            print("Administrator deployment configuration is unchanged.")
            return
        conflicting_user = db.query(User).filter(User.normalized_email == normalized_email)
        if user is not None:
            conflicting_user = conflicting_user.filter(User.id != user.id)
        if conflicting_user.first() is not None:
            raise SystemExit("ADMIN_EMAIL is already assigned to another account.")
        principal = provision_owner(db, password, settings, allow_weak_initial=True)
        user = db.get(User, principal.user_id) if principal.user_id else None
        if user is None:
            raise SystemExit("Administrator user record is unavailable.")
        user.normalized_email = normalized_email
        user.display_name = user.display_name or "Administrator"
        user.role = "ADMIN"
        user.status = "ACTIVE"
        principal.deployment_config_digest = config_digest
        db.commit()
    print("Administrator deployment configuration applied; prior sessions are invalid.")


if __name__ == "__main__":
    main()
