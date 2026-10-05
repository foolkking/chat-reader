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
    "maximum_merge_message_count",
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


def limit_bounds() -> dict[str, int]:
    settings = get_settings()
    return {"import_size_mb": min(settings.max_import_file_size_mb, effective_import_total_mb()),
            "merge_message_count": 100_000}


def effective_import_total_mb() -> int:
    settings = get_settings()
    return min(settings.max_adaptive_import_total_mb, settings.import_gateway_file_limit_mb)


def effective_limits(db: Session, user_id: uuid.UUID | None = None) -> dict[str, int]:
    from app.models.support_request import UserLimitOverride
    policy = get_feature_policy(db)
    override = db.get(UserLimitOverride, user_id) if user_id else None
    bounds = limit_bounds()
    return {
        "import_size_mb": min(bounds["import_size_mb"], max(policy.maximum_import_size_mb, (override.import_size_mb or 0) if override else 0)),
        "merge_message_count": min(bounds["merge_message_count"], max(policy.maximum_merge_message_count, (override.merge_message_count or 0) if override else 0)),
    }


def effective_import_size_mb(db: Session, user_id: uuid.UUID | None = None) -> int:
    return effective_limits(db, user_id)["import_size_mb"]
