"""Transactional offline invalidation without stale-session lost updates."""
from sqlalchemy import inspect
from sqlalchemy.sql.elements import ColumnElement

from app.models.conversation import Conversation


def bump_offline_revision(conversation: Conversation) -> None:
    """Queue an atomic increment at the caller's existing flush boundary.

    SQLAlchemy expires the expression after flush, so subsequent reads load the
    persisted integer. Keep repeated increments before a flush instead of replacing
    an already queued expression. No new lock ordering or commit boundary is added.
    """
    if not inspect(conversation).persistent:
        previous = conversation.offline_revision
        conversation.offline_revision = (1 if previous is None else previous) + 1
        return
    pending = conversation.__dict__.get("offline_revision")
    base = pending if isinstance(pending, ColumnElement) else Conversation.offline_revision
    conversation.offline_revision = base + 1
