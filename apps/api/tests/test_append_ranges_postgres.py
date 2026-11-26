"""Real PG range commits, pagination, bounded lookups and late atomic rollback."""
import os
import uuid
from contextlib import contextmanager

import pytest
from sqlalchemy import event

from app.models.append_item import AppendItem
from app.models.attachment import Attachment
from app.models.conversation import Conversation
from app.models.conversation_event import ConversationEvent
from app.models.import_record import ImportRecord
from app.services.adaptive_import import append_choices as choices
from test_import_profile_postgres import isolated_schema  # noqa: F401
from test_selective_append_postgres import pg_client, editable_tail, replacement  # noqa: F401
from test_selective_append import contents, endpoint, review, run, stage, target

pytestmark = pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1",
                               reason="explicit disposable PostgreSQL required")


def rows(count):
    return [("user" if i % 2 == 0 else "assistant",
             f"Synthetic ranged row {i}" + (" [report](assets/report.csv)" if i in (0, count - 1) else ""))
            for i in range(count)]


@pytest.mark.parametrize("count", [251, 1001])
def test_ranges_page_counts_atomic_commit_duplicate_replay_and_bounded_sql(pg_client, count):
    client, factory = pg_client
    cid = target(client)
    iid, fields = stage(client, cid, rows(count))
    source = client.get(f"/api/append-imports/{iid}").json()
    assert source["selection_capabilities"]["ranges"] is True
    assert source["sources"][0]["count"] == count
    final_page = client.get(endpoint(iid, "choices"), params={"edition": fields["edition"], "volume": 0,
                                                            "page": (count - 1) // 40}).json()
    assert final_page["items"][-1]["index"] == count - 1
    chosen = {**fields, "ranges": [[0, count]], "selected_count": count}
    bound_parameters = []
    engine = factory.kw["bind"]

    def query(_conn, _cursor, statement, parameters, _context, _many):
        if " IN (" in statement and ("conversation_append_items" in statement or "source_message_refs" in statement):
            # Count expanded source keys, not static scope/JSON-key parameters.
            # PG binds the two projected JSON property names as well.
            bound_parameters.append(sum(name.startswith(("item_key_", "source_message_id_"))
                                        for name in parameters))

    event.listen(engine, "before_cursor_execute", query)
    try:
        consent = review(client, iid, chosen)
        assert (consent["add"], consent["skip"]) == (count, 0)
        approved = {**chosen, "receipt": consent["receipt"]}
        assert client.post(endpoint(iid, "confirm"), json=approved).status_code == 202
        assert client.get(f"/api/append-imports/{iid}").json()["submitted_selection"] == chosen
        run(iid)
        assert client.post(endpoint(iid, "confirm"), json=approved).status_code == 200
        actual = contents(cid)
        assert len(actual) == count + 2
        assert [r[3].split(" [report]")[0] for r in actual[2:]] == [f"Synthetic ranged row {i}" for i in range(count)]
        assert len({r.order_key for r in actual}) == count + 2
        iid2, fields2 = stage(client, cid, rows(count))
        second = {**fields2, "ranges": [[0, count]], "selected_count": count}
        duplicate = review(client, iid2, second)
        assert (duplicate["add"], duplicate["skip"]) == (0, count)
        assert client.post(endpoint(iid2, "confirm"), json={**second, "receipt": duplicate["receipt"]}).status_code == 202
        run(iid2)
        assert len(contents(cid)) == count + 2
    finally:
        event.remove(engine, "before_cursor_execute", query)
    assert bound_parameters and max(bound_parameters) == choices.PAGE
    with factory() as db:
        assert db.query(AppendItem).count() == count
        assert db.query(Attachment).count() == 1  # First/last source rows share one attachment.
        assert db.get(Conversation, uuid.UUID(cid)).message_count == count + 2


def test_sparse_ranges_keep_order_and_stale_confirm_and_queue_retain_exact_selection(pg_client):
    client, _ = pg_client
    cid = target(client)
    before = "Synthetic baseline tail"
    mid, version = editable_tail(client, cid, before)
    iid, fields = stage(client, cid, rows(1001))
    chosen = {**fields, "ranges": [[0, 150], [200, 400], [1000, 1001]], "selected_count": 351}
    old = review(client, iid, chosen)
    after = before + " first edit"
    assert client.patch(f"/api/messages/{mid}", json=replacement(after, version, before)).status_code == 200
    conflict = client.post(endpoint(iid, "confirm"), json={**chosen, "receipt": old["receipt"]})
    assert conflict.status_code == 409 and conflict.json()["detail"]["code"] == "APPEND_REVIEW_CHANGED"
    fresh = conflict.json()["detail"]["review"]
    assert client.post(endpoint(iid, "confirm"), json={**chosen, "receipt": fresh["receipt"]}).status_code == 202
    assert client.patch(f"/api/messages/{mid}", json=replacement(after + " queued edit", version, after)).status_code == 200
    run(iid)
    failed = client.get(f"/api/append-imports/{iid}").json()
    assert failed["status"] == "failed" and failed["submitted_selection"] == chosen
    assert len(contents(cid)) == 2
    again = review(client, iid, chosen)
    assert client.post(endpoint(iid, "confirm"), json={**chosen, "receipt": again["receipt"]}).status_code == 202
    run(iid)
    expected = [*range(150), *range(200, 400), 1000]
    assert [r[3].split(" [report]")[0] for r in contents(cid)[2:]] == [f"Synthetic ranged row {i}" for i in expected]


def test_late_failure_rolls_back_all_canonical_rows_receipts_assets_and_indexes(pg_client, monkeypatch):
    from app.services.canonical import stream_persistence
    client, factory = pg_client
    cid = target(client)
    original = contents(cid)
    iid, fields = stage(client, cid, rows(251))
    chosen = {**fields, "ranges": [[0, 251]], "selected_count": 251}
    consent = review(client, iid, chosen)
    approved = {**chosen, "receipt": consent["receipt"]}
    assert client.post(endpoint(iid, "confirm"), json=approved).status_code == 202
    calls = 0
    real = stream_persistence._persist_one

    def fail_final(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 251:
            raise ValueError("Synthetic late failure; not public")
        return real(*args, **kwargs)

    with monkeypatch.context() as injection:
        injection.setattr(stream_persistence, "_persist_one", fail_final)
        run(iid)
    assert calls == 251
    assert contents(cid) == original
    with factory() as db:
        assert db.query(AppendItem).count() == db.query(Attachment).count() == 0
        assert db.query(ConversationEvent).filter_by(event_type="messages_appended").count() == 0
        assert db.get(Conversation, uuid.UUID(cid)).message_count == 2
        assert db.get(ImportRecord, uuid.UUID(iid)).status == "failed"
    failed = client.get(f"/api/append-imports/{iid}").json()
    assert failed["submitted_selection"] == chosen and "Synthetic late" not in str(failed)
    with factory() as db:
        assert not list(choices.directory(db.get(ImportRecord, uuid.UUID(iid))).glob(".append-assets-*"))
    fresh = review(client, iid, chosen)
    assert client.post(endpoint(iid, "confirm"), json={**chosen, "receipt": fresh["receipt"]}).status_code == 202
    run(iid)
    assert len(contents(cid)) == 253


def test_range_validation_large_body_and_fixed_edition_do_not_mutate_source(pg_client):
    client, _ = pg_client
    cid = target(client)
    iid, fields = stage(client, cid, rows(251))
    valid = {**fields, "ranges": [[0, 251]], "selected_count": 251}
    receipt = review(client, iid, valid)["receipt"]
    for operation in ("review", "confirm"):
        for change, status in [
            ({"ranges": [[0, 252]], "selected_count": 252}, 409),
            ({"ranges": [[0, 251]], "selected_count": 250}, 422),
            ({"edition": "f" * 64}, 409),
            ({"indexes": [0]}, 422),
            ({"ranges": [[0, 200], [150, 251]], "selected_count": 301}, 422),
        ]:
            response = client.post(endpoint(iid, operation), json={**valid, **change, **({"receipt": receipt} if operation == "confirm" else {})})
            assert response.status_code == status
        too_big = client.post(endpoint(iid, operation), content=b" " * (choices.MAX_SELECTION_BYTES + 1),
                              headers={"Content-Type": "application/json"})
        assert too_big.status_code == 413
    assert client.get(f"/api/append-imports/{iid}").json()["status"] == "previewed"
    assert len(contents(cid)) == 2


def test_admission_final_checkpoint_precedes_canonical_commit(pg_client, monkeypatch):
    from app.services.adaptive_import import memory_budget
    from app.models.search_document import SearchDocument
    from app.models.heading import Heading
    client, factory = pg_client
    cid = target(client)
    original = contents(cid)
    iid, fields = stage(client, cid, rows(251))
    chosen = {**fields, "ranges": [[0, 251]], "selected_count": 251}
    receipt = review(client, iid, chosen)["receipt"]
    assert client.post(endpoint(iid, "confirm"), json={**chosen, "receipt": receipt}).status_code == 202
    with factory() as db:
        indexes = db.query(SearchDocument).count(), db.query(Heading).count()
        revision = db.get(Conversation, uuid.UUID(cid)).offline_revision
    real = memory_budget.import_analysis_admission
    reached = []

    @contextmanager
    def last_checkpoint(*args, **kwargs):
        outer = memory_budget.current_budget() is None
        with real(*args, **kwargs):
            yield
            if outer:
                reached.append(True)
                raise RuntimeError("Synthetic final resource checkpoint")

    with monkeypatch.context() as guard:
        guard.setattr(memory_budget, "import_analysis_admission", last_checkpoint)
        run(iid)
    assert reached
    failed = client.get(f"/api/append-imports/{iid}").json()
    assert failed["status"] == "failed", "No canonical success may precede the final resource checkpoint."
    assert failed["submitted_selection"] == chosen and contents(cid) == original
    with factory() as db:
        assert (db.query(SearchDocument).count(), db.query(Heading).count()) == indexes
        assert db.get(Conversation, uuid.UUID(cid)).offline_revision == revision
        assert db.query(AppendItem).count() == db.query(Attachment).count() == 0
    fresh = review(client, iid, chosen)
    assert client.post(endpoint(iid, "confirm"), json={**chosen, "receipt": fresh["receipt"]}).status_code == 202
    run(iid)
    assert len(contents(cid)) == 253
