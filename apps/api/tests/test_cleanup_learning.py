"""Synthetic exception scope, real scanner behavior and explicit rule revisions."""
import uuid

from app.models.content_cleanup import ContentCleanupException, ContentCleanupOccurrence, ContentCleanupRule, ContentCleanupRuleRevision
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.services import cleanup_learning
from app.services.content_cleanup import process_scan_chunk
from test_import_preview_api import client  # noqa: F401
from test_cleanup_safety import MARKER, create_review, session


def complete_scan(scan_id):
    with session() as db:
        while not process_scan_chunk(db, uuid.UUID(str(scan_id)))["done"]:
            db.commit()
        db.commit()


def test_exception_is_explicit_scoped_persistent_and_reversible(client):
    source = "Keep " + MARKER + " in this context."
    scan_id, message_ids = create_review(client, [source])
    occurrence = client.get(f"/api/content-cleanup/scans/{scan_id}/occurrences").json()[0]
    prefix = f"/api/content-cleanup/scans/{scan_id}/occurrences/{occurrence['id']}/exception"
    client.patch(f"/api/content-cleanup/scans/{scan_id}/decisions", json={"decisions": [{"occurrence_id": occurrence["id"], "decision": "KEEP"}]})
    assert client.get("/api/content-cleanup/exceptions").json()["total"] == 0
    preview = client.get(prefix)
    assert preview.status_code == 200, preview.text
    assert preview.json()["match_value"] == MARKER
    assert preview.json()["context_before"] == "Keep "
    assert preview.json()["exception_saved"] is False
    assert client.post(prefix, json={"confirmed": True, "preview_token": "0" * 65}).status_code == 409
    saved = client.post(prefix, json={"confirmed": True, "preview_token": preview.json()["preview_token"]})
    assert saved.status_code == 201, saved.text
    duplicate = client.post(prefix, json={"confirmed": True, "preview_token": preview.json()["preview_token"]})
    assert saved.json() == duplicate.json()
    assert client.get("/api/content-cleanup/exceptions").json()["total"] == 1
    assert saved.json()["scan"]["delete_count"] == 0
    assert saved.json()["scan"]["keep_count"] == 1
    checked = client.get(prefix).json()
    assert checked["exception_saved"] is True and checked["decision"] == "KEEP"
    # Read-only recovery reports current state; it cannot undo a later choice.
    client.patch(f"/api/content-cleanup/scans/{scan_id}/decisions", json={"decisions": [{"occurrence_id": occurrence["id"], "decision": "DELETE"}]})
    checked = client.get(prefix).json()
    assert checked["exception_saved"] is True and checked["decision"] == "DELETE"
    assert checked["scan"]["delete_count"] == 1
    with session() as db:
        message = db.get(Message, message_ids[0])
        assert db.get(MessageVersion, message.current_version_id).display_text == source
        assert db.query(MessageVersion).filter_by(message_id=message.id).count() == 1
    rescan_id = client.post(f"/api/content-cleanup/scans/{scan_id}/rescan").json()["id"]
    complete_scan(rescan_id)
    assert client.get(f"/api/content-cleanup/scans/{rescan_id}/occurrences").json() == []
    # Changed context must still surface the same marker for review.
    different, _ = create_review(client, ["Other " + MARKER + " in this context."])
    assert len(client.get(f"/api/content-cleanup/scans/{different}/occurrences").json()) == 1
    assert client.delete(f"/api/content-cleanup/exceptions/{saved.json()['id']}").status_code == 204
    assert client.delete(f"/api/content-cleanup/exceptions/{saved.json()['id']}").status_code == 204
    assert client.get(prefix).json()["exception_saved"] is False
    restored = client.post(f"/api/content-cleanup/scans/{scan_id}/rescan").json()["id"]
    complete_scan(restored)
    assert len(client.get(f"/api/content-cleanup/scans/{restored}/occurrences").json()) == 1


def test_exception_revision_role_and_boundary_are_not_generalized():
    rev = uuid.uuid4()
    source = "a" * 60 + MARKER + "b" * 60
    saved = cleanup_learning._digest(cleanup_learning.exception_scope(rev, "assistant", source, 60, 60 + len(MARKER)))
    assert cleanup_learning.is_ignored({saved}, rev, "assistant", source, 60, 60 + len(MARKER))
    assert not cleanup_learning.is_ignored({saved}, rev, "user", source, 60, 60 + len(MARKER))
    assert not cleanup_learning.is_ignored({saved}, uuid.uuid4(), "assistant", source, 60, 60 + len(MARKER))
    # Same 48 chars at a message edge is a different scope from interior text.
    shortened = source[12:-12]
    assert not cleanup_learning.is_ignored({saved}, rev, "assistant", shortened, 48, 48 + len(MARKER))


def test_exception_rejects_source_changed_since_preview(client):
    scan_id, message_ids = create_review(client, ["Keep " + MARKER + " here."])
    occurrence = client.get(f"/api/content-cleanup/scans/{scan_id}/occurrences").json()[0]
    prefix = f"/api/content-cleanup/scans/{scan_id}/occurrences/{occurrence['id']}/exception"
    preview = client.get(prefix).json()
    with session() as db:
        db.get(Message, message_ids[0]).is_deleted = True
        db.commit()
    assert client.post(prefix, json={"confirmed": True, "preview_token": preview["preview_token"]}).status_code == 409
    with session() as db:
        assert db.query(ContentCleanupException).count() == 0


def test_legacy_protected_rows_do_not_break_cross_page_selection(client):
    scan_id, _ = create_review(client, ["Keep " + MARKER + " and `" + MARKER + "`."])
    with session() as db:
        for occurrence in db.query(ContentCleanupOccurrence).filter_by(scan_id=scan_id):
            occurrence.decision = "KEEP"
        db.commit()
    result = client.patch(f"/api/content-cleanup/scans/{scan_id}/decisions/filter", json={"decision": "DELETE", "all_matching": True})
    assert result.status_code == 200, result.text
    assert result.json()["matched"] == 1
    assert result.json()["skipped_protected"] == 1
    with session() as db:
        assert db.query(ContentCleanupOccurrence).filter_by(scan_id=scan_id, decision="PROTECTED").count() == 1


def test_rule_trial_never_writes_and_requires_bound_confirmation(client, monkeypatch):
    create_review(client, ["Synthetic NOISE and `NOISE`."])
    config = {"name": "Synthetic literal", "match_value": "NOISE", "role_filter": "assistant"}
    with session() as db:
        count = db.query(ContentCleanupRule).count()
    trial = client.post("/api/content-cleanup/rules/trial", json=config)
    assert trial.status_code == 200, trial.text
    assert trial.json()["matches"] == 2 and trial.json()["protected_matches"] == 1
    with session() as db:
        assert db.query(ContentCleanupRule).count() == count
    confirmed = {**config, "confirmed": True, "preview_token": trial.json()["preview_token"]}
    assert client.post("/api/content-cleanup/rules/learn", json={**confirmed, "match_value": "OTHER"}).status_code == 409
    assert client.post("/api/content-cleanup/rules/learn", json={**confirmed, "confirmed": False}).status_code == 422
    created = client.post("/api/content-cleanup/rules/learn", json=confirmed)
    assert created.status_code == 200, created.text
    assert created.json()["matcher_mode"] == "EXACT"
    with session() as db:
        assert db.query(ContentCleanupRule).count() == count + 1
    original_time = cleanup_learning.time.time()
    monkeypatch.setattr(cleanup_learning.time, "time", lambda: original_time + 700)
    assert client.post("/api/content-cleanup/rules/learn", json=confirmed).status_code == 409


def test_rule_edit_keeps_old_revision_clears_role_and_checks_base(client):
    config = {"name": "Synthetic edit", "match_value": "NOISE", "role_filter": "assistant"}
    created = client.post("/api/content-cleanup/rules", json=config).json()
    edit = {**config, "match_value": "OTHER", "role_filter": None, "rule_id": created["id"], "base_revision": 1}
    token = client.post("/api/content-cleanup/rules/trial", json=edit).json()["preview_token"]
    saved = client.post("/api/content-cleanup/rules/learn", json={**edit, "preview_token": token, "confirmed": True})
    assert saved.status_code == 200, saved.text
    assert saved.json()["revision"] == 2 and saved.json()["role_filter"] is None
    stale = client.post("/api/content-cleanup/rules/learn", json={**edit, "preview_token": token, "confirmed": True})
    assert stale.status_code == 409
    history = client.get(f"/api/content-cleanup/rules/{created['id']}/revisions").json()
    assert [(r["match_value"], r["role_filter"]) for r in history] == [("OTHER", None), ("NOISE", "assistant")]
    with session() as db:
        assert db.query(ContentCleanupRuleRevision).filter_by(rule_id=uuid.UUID(created["id"])).count() == 2


def test_trial_limits_are_reported_and_skip_oversized_messages(client):
    create_review(client, ["NOISE " + "x" * 20000])
    trial = client.post("/api/content-cleanup/rules/trial", json={"name": "Synthetic bounded trial", "match_value": "NOISE"})
    assert trial.status_code == 200
    assert trial.json()["limited"] and trial.json()["skipped_messages"] == 1
    assert trial.json()["matches"] == 0
