"""Instance feature gates layered over deployment safety limits."""

from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.administration import InstanceFeaturePolicy


POLICY_FIELDS = (
    "allow_share_links",
    "allow_public_share",
    "allow_share_password",
    "allow_user_skills",
    "allow_skill_import",
    "allow_user_import",
    "maximum_import_size_mb",
)


def get_feature_policy(db: Session) -> InstanceFeaturePolicy:
    row = db.get(InstanceFeaturePolicy, 1)
    if row is None:
        row = InstanceFeaturePolicy(
            id=1,
            maximum_import_size_mb=get_settings().max_import_file_size_mb,
        )
        db.add(row)
        db.flush()
    return row


def update_feature_policy(
    db: Session,
    *,
    actor_user_id: uuid.UUID,
    values: dict,
) -> tuple[InstanceFeaturePolicy, dict[str, dict[str, object]]]:
    row = get_feature_policy(db)
    changes: dict[str, dict[str, object]] = {}
    for field in POLICY_FIELDS:
        if field not in values or values[field] is None:
            continue
        previous = getattr(row, field)
        current = values[field]
        if previous != current:
            setattr(row, field, current)
            changes[field] = {"from": previous, "to": current}
    row.updated_by_user_id = actor_user_id
    db.flush()
    return row, changes


def effective_import_size_mb(db: Session) -> int:
    policy_limit = get_feature_policy(db).maximum_import_size_mb
    return min(policy_limit, get_settings().max_import_file_size_mb)
