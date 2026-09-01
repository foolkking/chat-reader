"""Server-side ownership scoping for private account resources.

The nullable branch exists only for the legacy-owner migration window. New
multi-account principals never inherit unowned rows, and request payloads are
never consulted when selecting an owner.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any, TypeVar

from fastapi import Request
from sqlalchemy import false, or_
from sqlalchemy.orm import Query, Session


OwnedModel = TypeVar("OwnedModel")


@dataclass(frozen=True)
class OwnershipScope:
    owner_user_id: uuid.UUID | None
    include_legacy_unowned: bool = False

    @classmethod
    def legacy(cls) -> "OwnershipScope":
        return cls(owner_user_id=None, include_legacy_unowned=True)

    def predicate(self, model: Any):
        owner_column = model.owner_user_id
        if self.owner_user_id is None:
            return owner_column.is_(None) if self.include_legacy_unowned else false()
        if self.include_legacy_unowned:
            return or_(owner_column == self.owner_user_id, owner_column.is_(None))
        return owner_column == self.owner_user_id


LEGACY_OWNERSHIP_SCOPE = OwnershipScope.legacy()
LEGACY_SUBJECT_KEY = "local:default"


def ownership_scope_from_request(request: Request) -> OwnershipScope:
    """Derive private-data scope exclusively from server-authenticated state."""
    auth = getattr(request.state, "auth", None)
    if auth is None:
        # AUTH_ENABLED=false retains the pre-account single-owner development
        # behavior. Production rejects that configuration.
        return LEGACY_OWNERSHIP_SCOPE
    user_id = getattr(auth, "user_id", None)
    principal_id = getattr(auth, "principal_id", None)
    return OwnershipScope(
        owner_user_id=user_id,
        include_legacy_unowned=principal_id == "owner",
    )


def subject_key_from_request(request: Request) -> str:
    """Return the account-local subject used by preferences and Reader state.

    Authenticated accounts, including the migrated administrator, are
    namespaced by their server-issued user UUID. ``local:default`` remains
    only for unauthenticated development compatibility; client-provided
    identity is never consulted.
    """
    auth = getattr(request.state, "auth", None)
    if auth is None:
        return LEGACY_SUBJECT_KEY
    user_id = getattr(auth, "user_id", None)
    return str(user_id) if user_id is not None else LEGACY_SUBJECT_KEY


def owned_query(db: Session, model: type[OwnedModel], scope: OwnershipScope) -> Query:
    return db.query(model).filter(scope.predicate(model))


def get_owned(
    db: Session,
    model: type[OwnedModel],
    resource_id: object,
    scope: OwnershipScope,
) -> OwnedModel | None:
    return owned_query(db, model, scope).filter(model.id == resource_id).one_or_none()


def assign_owner(resource: Any, scope: OwnershipScope) -> None:
    """Assign a create-time owner without accepting any client owner field."""
    resource.owner_user_id = scope.owner_user_id
