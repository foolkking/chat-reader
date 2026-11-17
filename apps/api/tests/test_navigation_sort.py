import uuid
from datetime import datetime, timedelta, timezone

from app.core.database import get_db
from app.main import app
from app.models.conversation import Conversation
from app.services.ownership import LEGACY_OWNER_USER_ID
from test_import_preview_api import client  # noqa: F401


def seed(count):
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    ids = []
    for index in range(count):
        row = Conversation(id=uuid.uuid4(), owner_user_id=LEGACY_OWNER_USER_ID, title=f"Row {index}",
            display_title=f"Row {index}", source_type="test", source_profile="test", parser_version="test",
            imported_at=now + timedelta(seconds=index), sort_time=now + timedelta(seconds=count - index),
            manual_sort_order=0, unclassified_sort_order=0)
        db.add(row)
        ids.append(str(row.id))
    db.commit()
    db.close()
    generator.close()
    return ids


def test_defaults_and_project_override_conflicts(client):
    preferences = client.get("/api/preferences").json()
    assert preferences["navigation_sort"]["all"]["mode"] == "content_updated"
    assert preferences["navigation_sort"]["project_default"]["mode"] == "imported"
    project = client.post("/api/projects", json={"name": "Independent"}).json()
    changed = client.patch(f"/api/projects/{project['id']}", json={
        "conversation_sort": {"mode": "title", "direction": "asc"}, "expected_sort_revision": project["sort_revision"]})
    assert changed.status_code == 200, changed.text
    conflict = client.patch(f"/api/projects/{project['id']}", json={
        "conversation_sort": None, "expected_sort_revision": project["sort_revision"]})
    assert conflict.status_code == 409
    assert client.get("/api/preferences").json()["navigation_sort"] == preferences["navigation_sort"]


def test_complete_scope_manual_initialization_and_stale_anchor_rejection(client):
    ids = seed(503)
    before = client.get("/api/conversation-order").json()
    ready = client.put("/api/conversation-order", json={"scope": "all", "expected_version": before["version"],
        "initialize_from": {"mode": "imported", "direction": "desc"}})
    assert ready.status_code == 200, ready.text
    ordered = client.get("/api/conversations", params={"sort": "custom", "direction": "asc", "limit": 600}).json()
    assert [item["id"] for item in ordered] == ids[::-1]
    moved = client.put("/api/conversation-order", json={"scope": "all", "expected_version": ready.json()["version"],
        "conversation_id": ids[0], "before_id": ids[-1]})
    assert moved.status_code == 200, moved.text
    assert client.put("/api/conversation-order", json={"scope": "all", "expected_version": ready.json()["version"],
        "conversation_id": ids[1], "before_id": ids[-1]}).status_code == 409
    automatic = client.get("/api/conversations", params={"sort": "imported", "limit": 1}).json()
    assert automatic[0]["id"] == ids[-1]
    manual = client.get("/api/conversations", params={"sort": "custom", "direction": "asc", "limit": 1}).json()
    assert manual[0]["id"] == ids[0]


def test_pins_respect_selected_sort_and_content_time_is_metadata_independent(client):
    ids = seed(2)
    for identifier in ids:
        assert client.patch(f"/api/conversations/{identifier}/pin", json={"is_pinned": True}).status_code == 200
    rows = client.get("/api/conversations", params={"sort": "content_updated", "direction": "desc"}).json()
    assert [row["id"] for row in rows] == ids


def test_batch_appends_unique_ranks_and_project_manual_direction(client):
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    rows = [Conversation(owner_user_id=LEGACY_OWNER_USER_ID, title=f"New {i}", display_title=f"New {i}",
                        source_type="test", source_profile="test", parser_version="test") for i in range(4)]
    db.add_all(rows)
    db.commit()
    assert [row.manual_sort_order for row in rows] == [1024, 2048, 3072, 4096]
    ids = [str(row.id) for row in rows]
    db.close()
    generator.close()
    project = client.post("/api/projects", json={"name": "Descending manual"}).json()
    for identifier in ids:
        assert client.post(f"/api/projects/{project['id']}/conversations/{identifier}").status_code == 200
    endpoint = f"/api/projects/{project['id']}/conversations"
    assert [row["id"] for row in client.get(endpoint, params={"sort": "custom", "direction": "desc"}).json()] == ids[::-1]
    assert client.patch(f"/api/projects/{project['id']}", json={"is_archived": True}).status_code == 200
    assert client.get("/api/conversations", params={"scope": "unclassified"}).json() == []
    # Even legacy/reversed manual views append new and moved items at the visible tail.
    assert client.patch(f"/api/projects/{project['id']}", json={"is_archived": False}).status_code == 200
    preferences = client.get("/api/preferences").json()
    navigation = preferences["navigation_sort"]
    for scope in ("all", "unclassified", "project_default"):
        navigation[scope] = {"mode": "custom", "direction": "desc"}
    assert client.patch("/api/preferences", json={"navigation_sort": navigation}).status_code == 200
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    newcomers = [Conversation(owner_user_id=LEGACY_OWNER_USER_ID, title=f"Tail {i}", display_title=f"Tail {i}",
        source_type="test", source_profile="test", parser_version="test") for i in range(2)]
    db.add_all(newcomers); db.commit()
    new_ids = [str(row.id) for row in newcomers]
    db.close(); generator.close()
    assert [row["id"] for row in client.get("/api/conversations", params={"sort": "custom", "direction": "desc"}).json()][-2:] == new_ids
    for identifier in new_ids:
        assert client.post(f"/api/projects/{project['id']}/conversations/{identifier}").status_code == 200
    assert [row["id"] for row in client.get(endpoint, params={"sort": "custom", "direction": "desc"}).json()][-2:] == new_ids
    for identifier in new_ids:
        assert client.delete(f"/api/projects/{project['id']}/conversations/{identifier}").status_code == 204
    unclassified = client.get("/api/conversations", params={"scope": "unclassified", "sort": "custom", "direction": "desc"}).json()
    assert [row["id"] for row in unclassified][-2:] == new_ids


def test_project_anchor_version_rejects_second_tab_and_keeps_name_sort_stable(client):
    projects = [client.post("/api/projects", json={"name": name}).json() for name in ("Gamma", "Alpha", "Beta")]
    version = client.get("/api/projects", params={"sort": "custom"}).json()[0]["order_version"]
    request = {"before_project_id": projects[0]["id"], "expected_order_version": version}
    assert client.put(f"/api/projects/{projects[2]['id']}/placement", json=request).status_code == 200
    assert client.put(f"/api/projects/{projects[1]['id']}/placement", json=request).status_code == 409
    rows = client.get("/api/projects", params={"sort": "title", "direction": "asc"}).json()
    assert [row["name"] for row in rows if not row["is_default"]] == ["Alpha", "Beta", "Gamma"]
