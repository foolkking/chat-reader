"""Collection projections are bounded, private and independent of reader bodies."""
import uuid

import pytest
from sqlalchemy import event

from app.models.annotation import ConversationAnnotation
from app.models.project import Project
from app.models.project_conversation import ProjectConversation
from app.models.user import User
from app.services.ownership import LEGACY_OWNERSHIP_SCOPE, LEGACY_SUBJECT_KEY
from app.services.reading_list import reading_list_summary
from test_attachment_storage_integrity import _conversation, _database
from test_import_preview_api import client  # noqa: F401


def test_reading_list_projection_pages_counts_and_hides_foreign_metadata(client):
    db, generator = _database()
    try:
        foreign_owner = uuid.uuid4()
        db.add(User(id=foreign_owner, role="USER", status="ACTIVE"))
        conversations = [_conversation() for _ in range(22)]
        for index, conversation in enumerate(conversations):
            conversation.title = conversation.display_title = f"Synthetic collection {index:02}"
        conversations[-1].owner_user_id = foreign_owner
        conversations[-1].display_title = "PRIVATE FOREIGN TITLE"
        db.add_all(conversations)
        db.commit()
        for index, conversation in enumerate(conversations):
            response = client.put(f"/api/user-feature-entries/reading-list/{uuid.uuid4()}", json={
                "expected_revision": 0,
                "value": {"conversation_id": str(conversation.id), "state": "read" if index == 0 else "unread"},
            })
            assert response.status_code == 200, response.text
        response = client.get("/api/reading-list")
        assert response.status_code == 200, response.text
        assert response.headers["cache-control"] == "no-store"
        body = response.json()
        assert body["counts"] == {"unread": 21, "read": 1, "all": 22}
        assert body["total"] == 21 and len(body["items"]) == 20 and body["has_more"]
        assert "PRIVATE FOREIGN TITLE" not in response.text
        unavailable = next(row for row in body["items"] if not row["available"])
        assert unavailable["title"] is None and unavailable["projects"] == []
        assert not unavailable["resume_available"]
        second = client.get("/api/reading-list?offset=20").json()
        assert len(second["items"]) == 1 and not second["has_more"]
        assert {row["entry"]["id"] for row in body["items"]}.isdisjoint(
            row["entry"]["id"] for row in second["items"])
        filtered = client.get("/api/reading-list?q=collection%2000&state=all").json()
        assert filtered["counts"] == {"unread": 0, "read": 1, "all": 1}
        assert filtered["items"][0]["entry"]["value"]["state"] == "read"
        # GET never changes explicit manual state or revisions.
        before = client.get("/api/user-feature-entries/reading-list").json()
        client.get("/api/reading-list?state=all&sort=last_read")
        assert client.get("/api/user-feature-entries/reading-list").json() == before
        statements = []
        def capture(_conn, _cursor, statement, _params, _context, _many):
            statements.append(statement)
        event.listen(db.bind, "before_cursor_execute", capture)
        try:
            reading_list_summary(db, subject_key=LEGACY_SUBJECT_KEY, ownership_scope=LEGACY_OWNERSHIP_SCOPE,
                state="all", q="", project_id=None, sort="added_desc", limit=20, offset=0)
        finally:
            event.remove(db.bind, "before_cursor_execute", capture)
        assert len(statements) <= 4
        assert not any("message_versions" in sql or "content_markdown" in sql for sql in statements)
    finally:
        db.close()
        generator.close()


def test_annotation_summary_filters_unicode_previews_and_ownership(client):
    db, generator = _database()
    try:
        conversation = _conversation()
        db.add(conversation)
        db.flush()
        project = Project(name="Synthetic summary project")
        db.add(project)
        db.flush()
        db.add(ProjectConversation(project_id=project.id, conversation_id=conversation.id))
        rows = []
        for index, kind in enumerate(("highlight", "underline", "strikethrough", "comment", "bookmark")):
            row = ConversationAnnotation(conversation_id=conversation.id, subject_key=LEGACY_SUBJECT_KEY,
                annotation_type=kind, anchor_status="orphaned" if index == 0 else "needs_review" if index == 1 else "valid",
                quote="摘录🙂" * 100, comment_markdown="评论🙂" * 200 + " literal%_needle")
            rows.append(row)
        db.add_all(rows)
        db.add(ConversationAnnotation(conversation_id=conversation.id, subject_key="other-account",
            quote="PRIVATE SUBJECT", comment_markdown="private"))
        db.add(ConversationAnnotation(conversation_id=conversation.id, subject_key=LEGACY_SUBJECT_KEY,
            quote="DELETED", comment_markdown="", is_deleted=True))
        db.commit()
        endpoint = "/api/annotations/inbox/summary"
        response = client.get(endpoint)
        assert response.status_code == 200, response.text
        assert response.headers["cache-control"] == "no-store"
        payload = response.json()
        assert payload["total"] == 5
        assert "PRIVATE SUBJECT" not in response.text and "DELETED" not in response.text
        for row in payload["items"]:
            assert len(row["quote_preview"]) == 240
            assert len(row["comment_preview"]) == 400
            assert row["quote_truncated"] and row["comment_truncated"]
            assert "quote" not in row and "comment_markdown" not in row
        assert client.get(endpoint + "?anchor_status=attention").json()["total"] == 2
        assert client.get(endpoint + "?q=literal%25_needle").json()["total"] == 5
        assert client.get(endpoint + "?q=absent%25_needle").json()["total"] == 0
        for kind in ("highlight", "underline", "strikethrough", "comment", "bookmark"):
            assert client.get(endpoint, params={"annotation_type": kind, "project_id": str(project.id)}).json()["total"] == 1
        assert client.get(endpoint, params={"project_id": str(uuid.uuid4())}).json()["total"] == 0
        first = client.get(endpoint + "?limit=2&sort=created").json()
        second = client.get(endpoint + "?limit=2&offset=2&sort=created").json()
        assert first["has_more"] and second["has_more"]
        assert {row["id"] for row in first["items"]}.isdisjoint(row["id"] for row in second["items"])
        # Compatibility endpoint still returns full text for the existing editor.
        old = client.get("/api/annotations/inbox").json()
        assert len(old["items"][0]["comment_markdown"]) > 400
        conversation.deleted_at = rows[0].created_at
        db.commit()
        assert client.get(endpoint).json()["total"] == 0
    finally:
        db.close()
        generator.close()


@pytest.mark.parametrize("path", [
    "/api/reading-list?state=invalid", "/api/reading-list?limit=101",
    "/api/annotations/inbox/summary?annotation_type=invalid",
    "/api/annotations/inbox/summary?offset=-1",
])
def test_summary_rejects_invalid_contract(client, path):
    assert client.get(path).status_code == 422
