"""Additive selection encoding, with no data access or validator relaxation."""
import uuid
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.api.routes.append_imports import Selection, metadata
from app.services.adaptive_import import append_choices as choices
from app.services.adaptive_import.contracts import AdaptiveImportError


def request(**values):
    return Selection(target=uuid.uuid4(), edition="a" * 64, volume=0, **values)


@pytest.mark.parametrize("count", [249, 250])
def test_old_indexes_encoding_is_unchanged(count):
    body = request(indexes=list(reversed(range(count))))
    assert body.coordinates() == {"indexes": list(reversed(range(count)))}
    assert choices.selection_ranges(body.indexes) == [[0, count]]


def test_old_251_is_still_invalid_but_a_billion_contiguous_rows_use_one_range():
    with pytest.raises(ValidationError):
        request(indexes=list(range(251)))
    assert request(ranges=[[0, 10**9]], selected_count=10**9).coordinates() == {
        "ranges": [(0, 10**9)], "selected_count": 10**9}


@pytest.mark.parametrize("encoding", [
    {}, {"indexes": [0], "ranges": [[0, 1]], "selected_count": 1},
    {"ranges": [] , "selected_count": 0}, {"ranges": [[0, 1]]},
    {"ranges": [[0, 1]], "selected_count": 2}, {"indexes": [0], "selected_count": 1},
    {"ranges": [[1, 1]], "selected_count": 0}, {"ranges": [[2, 1]], "selected_count": 1},
    {"ranges": [[-1, 2]], "selected_count": 3}, {"ranges": [[1, 3], [2, 4]], "selected_count": 4},
    {"ranges": [[2, 3], [0, 1]], "selected_count": 2}, {"ranges": [[0, True]], "selected_count": 1},
    {"ranges": [[0, 1.1]], "selected_count": 1}, {"ranges": [[0, 1]], "selected_count": True},
    {"ranges": [[0, choices.MAX_ORDINAL + 1]], "selected_count": choices.MAX_ORDINAL + 1},
])
def test_invalid_or_ambiguous_ranges_fail_before_review(encoding):
    with pytest.raises(ValidationError):
        request(**encoding)


def test_range_budget_is_distinct_from_message_count_and_adjacent_ranges_merge():
    values = [[i * 2, i * 2 + 1] for i in range(4096)]
    assert len(request(ranges=values, selected_count=4096).ranges) == 4096
    with pytest.raises(ValidationError):
        request(ranges=values + [[8192, 8193]], selected_count=4097)
    assert request(ranges=[[0, 250], [250, 1001]], selected_count=1001).ranges == [(0, 1001)]


def test_pages_are_read_once_in_source_order_and_only_when_selected(monkeypatch):
    pages = []
    def read(record, source, page):
        pages.append(page)
        return [{"index": i} for i in range(page * 40, min(page * 40 + 40, source["count"]))]
    monkeypatch.setattr(choices, "read_page", read)
    rows = choices.selected(None, {"count": 1001}, ranges=[[0, 2], [39, 42], [999, 1001]], selected_count=7)
    assert [r["index"] for r in rows] == [0, 1, 39, 40, 41, 999, 1000]
    assert pages == [0, 1, 24, 25]
    with pytest.raises(AdaptiveImportError):
        list(choices.selected(None, {"count": 1000}, ranges=[[999, 1001]], selected_count=2))


@pytest.mark.parametrize("coordinates", [{"indexes": [1, 4]}, {"ranges": [[0, 1001]], "selected_count": 1001}])
def test_failed_task_projection_preserves_only_coordinates_not_old_consent(coordinates):
    chosen = {"edition": "a" * 64, "target": str(uuid.uuid4()), "volume": 0, **coordinates}
    record = SimpleNamespace(id=uuid.uuid4(), draft_sha256="a" * 64, session_state="FAILED", status="failed",
        phase="failed", progress=5, error_message=None, draft_summary={}, analysis_summary={
            "append_only": {"target": chosen["target"]},
            "append_decision": {**chosen, "receipt": "b" * 64, "allow_share": True, "allow_partial": True}})
    assert metadata(record)["submitted_selection"] == chosen
    assert metadata(record)["selection_capabilities"] == {"ranges": True, "max_ranges": 4096, "legacy_max_indexes": 250}


def test_range_confirmation_is_replayable_but_never_published_as_a_legacy_indexes_decision(monkeypatch):
    from fastapi import Response
    from app.api.routes import append_imports as route
    from app.services import selective_append as service

    cid = uuid.uuid4()
    body = route.Confirm(target=cid, edition="a" * 64, volume=0, ranges=[[0, 1001]],
                         selected_count=1001, receipt="b" * 64)
    record = SimpleNamespace(id=uuid.uuid4(), draft_sha256=body.edition, session_state="READY",
        status="previewed", phase="preview", progress=0, error_message=None, draft_summary={},
        analysis_summary={"append_only": {"target": str(cid)}, "keep": "unchanged"})
    monkeypatch.setattr(route, "source", lambda *a, **kw: record)
    monkeypatch.setattr(route, "reviewed", lambda *a, **kw: {"receipt": body.receipt, "add": 0})
    monkeypatch.setattr(route, "queue_import", lambda r, db: setattr(r, "status", "queued"))
    db = SimpleNamespace(commit=lambda: None)
    status = route.confirm(record.id, body, None, Response(), db)
    # v0.1.10 projects decision["indexes"] and its worker consumes the same key.
    # Leaving it absent (not an empty/truncated selection) makes both fail closed.
    assert "append_decision" not in record.analysis_summary
    assert record.analysis_summary["keep"] == "unchanged"
    assert service.submitted_decision(record.analysis_summary) == body.model_dump(mode="json", exclude_none=True)
    assert status["submitted_selection"]["ranges"] == [[0, 1001]]
    again = route.confirm(record.id, body, None, Response(), db)
    assert again["submitted_selection"] == status["submitted_selection"]


def test_an_explicit_indexes_confirmation_after_downgrade_supersedes_the_older_range_receipt():
    from app.services import selective_append as service

    large = {"ranges": [[0, 1001]], "selected_count": 1001, "receipt": "a" * 64}
    small = {"indexes": [7], "receipt": "b" * 64}
    saved = service.with_submitted_decision({"append_only": {"target": "synthetic"}}, large)
    # Earlier servers only write the legacy key and preserve unknown fields.
    after_old_confirm = {**saved, "append_decision": small}
    assert service.submitted_decision(after_old_confirm) == small
    assert service.with_submitted_decision(after_old_confirm, small) == {
        "append_only": saved["append_only"], "append_decision": small}
    assert service.with_submitted_decision(after_old_confirm, large) == saved
