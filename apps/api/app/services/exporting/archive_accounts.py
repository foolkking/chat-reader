"""System archive identities contain no authentication material."""
from __future__ import annotations

import secrets
import uuid
from datetime import datetime

from sqlalchemy.orm import Session

from app.models.auth import AuthPrincipal
from app.models.user import User
from app.services.auth import hash_password, normalize_email


IDENTITY_FIELDS = {
    "id", "normalized_email", "display_name", "role", "status", "approval_status",
    "email_verified_at", "email_verification_required", "created_at", "updated_at",
}


class ArchiveOwnershipError(ValueError):
    pass


def restore_account_mapping(
    db: Session, *, identities, referenced_owners: set[str],
    target_root_id: uuid.UUID | None, owner_mapping: dict[str, str] | None,
    legacy: bool, allow_legacy_identity: bool = False,
) -> dict[str, uuid.UUID | None]:
    mappings = dict(owner_mapping or {})
    if legacy:
        result = {}
        for source in referenced_owners:
            if source not in mappings:
                if allow_legacy_identity:
                    # Only the existing AUTH_ENABLED=false compatibility fixture.
                    candidate = None if source == "unowned" else uuid.UUID(source)
                    if candidate is None or db.get(User, candidate) is not None:
                        result[source] = candidate
                        continue
                raise ArchiveOwnershipError("This legacy archive requires an explicit mapping for every source account.")
            target = db.get(User, uuid.UUID(mappings[source]))
            if target is None:
                raise ArchiveOwnershipError("An ownership mapping target is unavailable.")
            result[source] = target.id
        if set(mappings) - referenced_owners:
            raise ArchiveOwnershipError("The ownership mapping contains an unknown source account.")
        return result

    root = db.get(User, target_root_id) if target_root_id else None
    rows = list(identities)
    ids = [str(uuid.UUID(row["id"])) for row in rows]
    if len(ids) != len(set(ids)) or sum(row.get("role") == "ADMIN" for row in rows) > 1:
        raise ArchiveOwnershipError("The archive contains ambiguous account identities.")
    source_root = next((row["id"] for row in rows if row.get("role") == "ADMIN"), None)
    if source_root and (root is None or root.role != "ADMIN"):
        raise ArchiveOwnershipError("Select the target Root Admin before restoring this archive.")
    if referenced_owners - set(ids) - {"unowned"}:
        raise ArchiveOwnershipError("The archive is missing a referenced account identity.")
    if set(mappings) - set(ids) - {"unowned"}:
        raise ArchiveOwnershipError("The ownership mapping contains an unknown source account.")
    result: dict[str, uuid.UUID | None] = {}
    for row in rows:
        source = row["id"]
        if row.get("role") == "ADMIN":
            if source in mappings and mappings[source] != str(root.id):
                raise ArchiveOwnershipError("An archived Root Admin must map to the target Root Admin.")
            result[source] = root.id
            continue
        if source in mappings:
            target = db.get(User, uuid.UUID(mappings[source]))
            if target is None:
                raise ArchiveOwnershipError("An ownership mapping target is unavailable.")
            result[source] = target.id
            continue
        if row.get("role") != "USER" or row.get("status") not in {"ACTIVE", "PENDING", "DISABLED"} or row.get("approval_status", "APPROVED") not in {"APPROVED", "PENDING", "REJECTED"}:
            raise ArchiveOwnershipError("The archive contains an invalid account state.")
        if (
            not isinstance(row.get("normalized_email"), str)
            or not isinstance(row.get("email_verification_required", False), bool)
            or row.get("display_name") is not None and not isinstance(row["display_name"], str)
            or row.get("email_verified_at") is not None and not isinstance(row["email_verified_at"], str)
        ):
            raise ArchiveOwnershipError("The archive contains invalid account metadata.")
        email = normalize_email(row["normalized_email"])
        if db.query(User.id).filter(User.normalized_email == email).first() is not None:
            raise ArchiveOwnershipError("An archived email already exists. Explicitly map this account before restoring.")
        user = User(
            normalized_email=email, display_name=(row.get("display_name") or "")[:200] or None,
            role="USER", status=row["status"], approval_status=row.get("approval_status", "APPROVED"),
            email_verification_required=bool(row.get("email_verification_required")),
            email_verified_at=(datetime.fromisoformat(row["email_verified_at"].replace("Z", "+00:00")) if row.get("email_verified_at") else None),
        )
        db.add(user); db.flush()
        # No source password hash, reset grant or session is ever imported.
        # A fresh unknown password forces the normal one-use reset flow.
        db.add(AuthPrincipal(id=f"user:{user.id}", user_id=user.id,
                             password_hash=hash_password(secrets.token_urlsafe(48)), credential_version=1))
        db.flush()
        result[source] = user.id
    if "unowned" in referenced_owners:
        if "unowned" in mappings:
            target = db.get(User, uuid.UUID(mappings["unowned"]))
            if target is None:
                raise ArchiveOwnershipError("An ownership mapping target is unavailable.")
            result["unowned"] = target.id
        elif source_root:
            result["unowned"] = root.id
        elif allow_legacy_identity:
            result["unowned"] = None
        else:
            raise ArchiveOwnershipError("Unowned legacy content requires an explicit ownership mapping.")
    return result


def remap_account_payload(payload, mapping):
    result = dict(payload)
    if "owner_user_id" in result:
        result["owner_user_id"] = mapping[result["owner_user_id"] or "unowned"]
    if "subject_key" in result:
        source = result["subject_key"]
        key = "unowned" if source in {"local:default", "owner"} else source
        if key not in mapping:
            raise ArchiveOwnershipError("The archive is missing a reader-state ownership mapping.")
        result["subject_key"] = str(mapping[key]) if mapping[key] else "local:default"
    return result
