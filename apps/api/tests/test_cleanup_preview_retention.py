"""Candidate pages project metadata and fetch only the current source once."""
from sqlalchemy import event

from app.models.message_version import MessageVersion
from app.services import content_cleanup as cleanup
from test_import_preview_api import client  # noqa: F401
from test_cleanup_safety import MARKER, create_review, session


def test_candidate_page_does_not_join_or_reparse_full_source_per_occurrence(client, monkeypatch):
    scan_id, _ = create_review(client, [(f"Retained {MARKER} after.\n" * 110)])
    counts = {"hash": 0, "protected": 0}
    for name, key in (("source_fingerprint", "hash"), ("protected_ranges", "protected")):
        original = getattr(cleanup, name)

        def measured(*args, _original=original, _key=key, **kwargs):
            counts[_key] += 1
            return _original(*args, **kwargs)

        monkeypatch.setattr(cleanup, name, measured)
    source_projections = []

    def reading(state):
        if state.is_select:
            descriptions = state.statement.column_descriptions
            if any(item["entity"] is MessageVersion for item in descriptions):
                source_projections.append([item["name"] for item in descriptions])

    with session() as db:
        event.listen(db, "do_orm_execute", reading)
        try:
            items = cleanup.preview_occurrences(db, scan_id, limit=100)
        finally:
            event.remove(db, "do_orm_execute", reading)

    assert len(items) == 100
    assert all(item["match_text"] == MARKER and not item["stale"] for item in items)
    assert all(not item["protection_confirmed"] for item in items)
    assert counts == {"hash": 1, "protected": 0}
    assert source_projections == [["display_text"]], "A page fetched redundant full version bodies/blocks."
