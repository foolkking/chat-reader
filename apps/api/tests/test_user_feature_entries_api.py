import uuid

from fastapi.testclient import TestClient

from test_import_preview_api import client  # noqa: F401


ENTRY_ID = "5f6030c8-7782-4f77-9c52-6f5b26487a18"


def test_saved_search_entries_are_validated_revisioned_and_private(client: TestClient) -> None:
    value = {
        "name": "  Project notes  ",
        "q": "  follow up  ",
        "document_type": "message",
        "role": "assistant",
        "project_id": None,
        "status_scope": "active",
        "date_from": "2026-10-01",
        "date_to": "2026-10-30",
    }
    created = client.put(
        f"/api/user-feature-entries/saved-search/{ENTRY_ID}",
        json={"expected_revision": 0, "value": value},
    )
    assert created.status_code == 200
    row = created.json()
    assert row["revision"] == 1
    assert row["value"]["name"] == "Project notes"
    assert row["value"]["q"] == "follow up"
    assert "subject_key" not in row

    listed = client.get("/api/user-feature-entries/saved-search")
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()] == [ENTRY_ID]

    updated = client.put(
        f"/api/user-feature-entries/saved-search/{ENTRY_ID}",
        json={"expected_revision": 1, "value": {**row["value"], "name": "Project notes v2"}},
    )
    assert updated.status_code == 200
    assert updated.json()["revision"] == 2
    assert updated.json()["value"]["name"] == "Project notes v2"

    stale = client.put(
        f"/api/user-feature-entries/saved-search/{ENTRY_ID}",
        json={"expected_revision": 1, "value": value},
    )
    assert stale.status_code == 409
    assert client.delete(f"/api/user-feature-entries/saved-search/{ENTRY_ID}?expected_revision=1").status_code == 409
    assert client.delete(f"/api/user-feature-entries/saved-search/{ENTRY_ID}?expected_revision=2").status_code == 204
    assert client.get("/api/user-feature-entries/saved-search").json() == []


def test_saved_search_and_export_preset_schemas_reject_invalid_or_private_defaults(client: TestClient) -> None:
    invalid_search = client.put(
        f"/api/user-feature-entries/saved-search/{ENTRY_ID}",
        json={
            "expected_revision": 0,
            "value": {
                "name": "Invalid date range",
                "q": "notes",
                "date_from": "2026-10-31",
                "date_to": "2026-10-01",
            },
        },
    )
    assert invalid_search.status_code == 422

    preset = client.put(
        f"/api/user-feature-entries/export-preset/{ENTRY_ID}",
        json={
            "expected_revision": 0,
            "value": {"name": "For AI", "format": "context"},
        },
    )
    assert preset.status_code == 200
    assert preset.json()["value"]["include_annotations"] is False
    assert preset.json()["value"]["include_notebook"] is False
    assert client.get("/api/user-feature-entries/unknown").status_code == 404
    assert client.put(
        f"/api/user-feature-entries/export-preset/{ENTRY_ID}",
        json={"expected_revision": 0, "value": {"name": "Bad", "format": "xml"}},
    ).status_code == 422


def test_reading_list_rejects_duplicate_conversation_without_overwriting_state(client: TestClient) -> None:
    value = {"conversation_id": str(uuid.uuid4()), "state": "unread"}
    original = client.put(
        f"/api/user-feature-entries/reading-list/{ENTRY_ID}",
        json={"expected_revision": 0, "value": value},
    )
    assert original.status_code == 200
    before = client.get("/api/user-feature-entries/reading-list").json()
    duplicate = client.put(
        f"/api/user-feature-entries/reading-list/{uuid.uuid4()}",
        json={"expected_revision": 0, "value": {**value, "state": "read"}},
    )
    assert duplicate.status_code == 409
    assert client.get("/api/user-feature-entries/reading-list").json() == before


def test_saved_entry_identity_cannot_cross_owner_or_collection(client: TestClient, monkeypatch) -> None:
    from app.api.routes import user_feature_entries as routes

    monkeypatch.setattr(routes, "subject_key_from_request", lambda request: "synthetic-owner-a")
    original = client.put(
        f"/api/user-feature-entries/saved-search/{ENTRY_ID}",
        json={"expected_revision": 0, "value": {"name": "Private search", "q": "synthetic"}},
    )
    assert original.status_code == 200
    before = client.get("/api/user-feature-entries/saved-search").json()
    monkeypatch.setattr(routes, "subject_key_from_request", lambda request: "synthetic-owner-b")
    assert client.get("/api/user-feature-entries/saved-search").json() == []
    assert client.put(
        f"/api/user-feature-entries/saved-search/{ENTRY_ID}",
        json={"expected_revision": 0, "value": {"name": "Other search", "q": "other"}},
    ).status_code == 409
    assert client.delete(f"/api/user-feature-entries/saved-search/{ENTRY_ID}?expected_revision=1").status_code == 404
    monkeypatch.setattr(routes, "subject_key_from_request", lambda request: "synthetic-owner-a")
    assert client.get("/api/user-feature-entries/saved-search").json() == before
    assert client.put(
        f"/api/user-feature-entries/export-preset/{ENTRY_ID}",
        json={"expected_revision": 0, "value": {"name": "Other collection", "format": "context"}},
    ).status_code == 409


def test_collection_limit_is_enforced_server_side_but_existing_entries_can_change(client: TestClient) -> None:
    for index in range(20):
        response = client.put(
            f"/api/user-feature-entries/saved-search/{uuid.UUID(int=index + 1)}",
            json={"expected_revision": 0, "value": {"name": f"Synthetic {index}", "q": "synthetic"}},
        )
        assert response.status_code == 200
    assert client.put(
        f"/api/user-feature-entries/saved-search/{ENTRY_ID}",
        json={"expected_revision": 0, "value": {"name": "Over limit", "q": "synthetic"}},
    ).status_code == 409
    assert client.put(
        f"/api/user-feature-entries/saved-search/{uuid.UUID(int=1)}",
        json={"expected_revision": 1, "value": {"name": "Renamed", "q": "synthetic"}},
    ).status_code == 200
    assert len(client.get("/api/user-feature-entries/saved-search").json()) == 20
