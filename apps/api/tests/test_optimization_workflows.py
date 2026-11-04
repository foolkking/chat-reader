from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text

from app.core import auth_middleware
from app.models.background_job import BackgroundJob
from app.models.conversation import Conversation
from app.models.share import Share
from app.models.user_feature_entry import UserFeatureEntry
from app.models.import_record import ImportRecord
from app.services.conversations import conversation_deletion
from app.services.ownership import OwnershipScope
from test_auth import auth_client  # noqa: F401
from test_my_shares import conversation, register


def test_unfinished_imports_survive_short_task_window_and_are_owner_paged(auth_client):
    register(auth_client, "pending-import-owner")
    owner_id = UUID(auth_client.get("/api/auth/session").json()["user_id"])
    with auth_middleware.SessionLocal() as db:
        old = datetime.now(timezone.utc) - timedelta(days=2)
        for index in range(4):
            db.add(ImportRecord(owner_user_id=owner_id, source_profile="synthetic",
                source_fingerprint=f"pending-{index}", detected_title="Synthetic saved input",
                status="previewed", session_state="READY", updated_at=old))
        db.add(ImportRecord(owner_user_id=owner_id, source_profile="synthetic",
            source_fingerprint="done", status="committed", session_state="COMPLETED"))
        db.commit()
    first = auth_client.get("/api/adaptive-import/sessions", params={"limit": 2}).json()
    second = auth_client.get("/api/adaptive-import/sessions", params={"limit": 2, "offset": 2}).json()
    assert first["has_more"] and not second["has_more"]
    assert len({item["import_id"] for page in (first, second) for item in page["items"]}) == 4
    assert all(not item["source_available"] for item in first["items"])
    register(auth_client, "pending-import-other")
    assert auth_client.get("/api/adaptive-import/sessions").json()["items"] == []


def test_share_creation_result_can_be_recovered_without_another_link(auth_client):
    register(auth_client, "intent-owner")
    source = conversation(auth_client, "Synthetic creation intent")
    path = f"/api/conversations/{source['id']}/shares"
    key = str(uuid4())
    first = auth_client.post(path, json={"include_notebook": True}, headers={"Idempotency-Key": key})
    assert first.status_code == 200, first.text
    assert auth_client.post(path, json={"include_notebook": True}, headers={"Idempotency-Key": key}).json() == first.json()
    assert auth_client.get(f"/api/conversations/{source['id']}/share-creations/{key}").json() == first.json()
    assert auth_client.post(path, json={"title": "Different"}, headers={"Idempotency-Key": key}).status_code == 409
    assert auth_client.post(path, json={}, headers={"Idempotency-Key": str(uuid4())}).json()["id"] != first.json()["id"]
    register(auth_client, "intent-other")
    assert auth_client.get(f"/api/conversations/{source['id']}/share-creations/{key}").status_code == 404


def test_tombstone_denies_all_share_reads_and_leaves_durable_retry(auth_client, monkeypatch):
    register(auth_client, "delete-retry")
    source = conversation(auth_client, "Synthetic deletion")
    created = auth_client.post(f"/api/conversations/{source['id']}/shares", json={"include_notebook": True, "include_annotations": True}).json()
    tag_id = str(uuid4())
    assert auth_client.put(f"/api/user-feature-entries/conversation-tag/{tag_id}", json={
        "expected_revision": 0, "value": {"name": "Synthetic tag", "conversation_ids": [source["id"]]},
    }).status_code == 200
    original = conversation_deletion.detach_conversation_context
    def fail(*args):
        raise RuntimeError("Synthetic crash after tombstone")
    monkeypatch.setattr(conversation_deletion, "detach_conversation_context", fail)
    with auth_middleware.SessionLocal() as db:
        db.execute(text("PRAGMA foreign_keys=ON"))
        row = db.get(Conversation, UUID(source["id"]))
        scope = OwnershipScope(row.owner_user_id)
        with pytest.raises(RuntimeError):
            conversation_deletion.delete_conversation_record(db, row.id, scope)
        db.rollback()
        assert db.get(Conversation, row.id).deleted_at is not None
        assert db.query(BackgroundJob).filter_by(job_type="conversation_delete_cleanup", status="queued").count() == 1
    public = f"/api/shared/{created['token']}"
    for suffix in ("", "/reader-turn", "/message-window", "/dialogue-index", "/toc", "/annotations", "/notebook"):
        assert auth_client.get(public + suffix).status_code in {404, 410}
    monkeypatch.setattr(conversation_deletion, "detach_conversation_context", original)
    with auth_middleware.SessionLocal() as db:
        db.execute(text("PRAGMA foreign_keys=ON"))
        conversation_deletion.delete_conversation_record(db, UUID(source["id"]), scope)
        assert db.get(Conversation, UUID(source["id"])) is None
        assert db.get(UserFeatureEntry, UUID(tag_id)).value["conversation_ids"] == []
        assert db.query(Share).count() == 0


def test_private_notes_description_tags_and_duplicate_locations(auth_client):
    register(auth_client, "search-complete")
    first = conversation(auth_client, "Synthetic title alpha")
    second = conversation(auth_client, "Synthetic second")
    notebook = f"/api/conversations/{first['id']}/notebook"
    current = auth_client.get(notebook).json()
    assert auth_client.put(notebook, json={"base_revision": current["revision"], "blocks": [{"id": str(uuid4()), "type": "markdown", "markdown": "private-notebook-needle"}]}).status_code == 200
    assert auth_client.patch(f"/api/conversations/{first['id']}", json={"description_markdown": "private-description-needle"}).status_code == 200
    for query, kind in (("private-notebook-needle", "notebook"), ("private-description-needle", "description")):
        result = auth_client.get("/api/search", params={"q": query, "document_type": kind}).json()
        assert [row["conversation_id"] for row in result["items"]] == [first["id"]]
    tag_id = str(uuid4())
    auth_client.put(f"/api/user-feature-entries/conversation-tag/{tag_id}", json={"expected_revision": 0, "value": {"name": "Scoped", "conversation_ids": [second["id"]]}})
    folded = auth_client.get("/api/search", params={"q": "Synthetic private answer", "document_type": "message"}).json()
    assert len(folded["items"]) == 1 and folded["items"][0]["occurrence_count"] == 2
    source = folded["items"][0]["document_id"]
    expanded = auth_client.get("/api/search", params={"q": "Synthetic private answer", "duplicate_of": source, "limit": 1}).json()
    assert expanded["total"] == 2 and expanded["has_more"]
    filtered = auth_client.get("/api/search", params={"q": "Synthetic private answer", "tag_id": tag_id}).json()
    assert {row["conversation_id"] for row in filtered["items"]} == {second["id"]}
    dated = auth_client.get("/api/search", params={"q": "Synthetic title alpha", "document_type": "conversation", "date_from": (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()}).json()
    assert dated["items"]
    register(auth_client, "search-complete-other")
    assert auth_client.get("/api/search", params={"q": "private-notebook-needle"}).json()["items"] == []
    assert auth_client.get("/api/search", params={"q": "Synthetic", "duplicate_of": source}).status_code == 404
