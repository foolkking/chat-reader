"""Private tag management: atomic union, CAS, limits and query-free listing."""
from uuid import UUID, uuid4

from app.core import auth_middleware
from app.models.user_feature_entry import UserFeatureEntry
from test_auth import auth_client  # noqa: F401
from test_my_shares import conversation, register


def tag(client, name, ids):
    response = client.put(f"/api/user-feature-entries/conversation-tag/{uuid4()}", json={
        "expected_revision": 0, "value": {"name": name, "conversation_ids": ids},
    })
    assert response.status_code == 200, response.text
    return response.json()


def merge(client, source, target, **overrides):
    return client.post(f"/api/user-feature-entries/conversation-tag/{source['id']}/merge", json={
        "source_revision": source["revision"], "target_revision": target["revision"],
        "target_id": target["id"], **overrides,
    })


def test_tag_merge_unions_members_redirects_saved_search_and_preserves_conversations(auth_client):
    register(auth_client, "together-tags")
    first = conversation(auth_client, "Synthetic first")
    second = conversation(auth_client, "Synthetic second")
    source = tag(auth_client, "Source", [first["id"]])
    target = tag(auth_client, "Target", [first["id"], second["id"]])
    search_id = str(uuid4())
    saved = auth_client.put(f"/api/user-feature-entries/saved-search/{search_id}", json={
        "expected_revision": 0, "value": {"name": "Tagged search", "q": "Synthetic", "tag_id": source["id"]},
    })
    assert saved.status_code == 200, saved.text
    assert [item["id"] for item in auth_client.get("/api/conversations", params={"tag_id": source["id"]}).json()] == [first["id"]]
    before = auth_client.get(f"/api/conversations/{second['id']}").json()["offline_revision"]
    result = merge(auth_client, source, target)
    assert result.status_code == 200, result.text
    assert result.json()["value"]["name"] == "Target"
    assert set(result.json()["value"]["conversation_ids"]) == {first["id"], second["id"]}
    assert len(auth_client.get("/api/user-feature-entries/conversation-tag").json()) == 1
    search = auth_client.get("/api/user-feature-entries/saved-search").json()[0]
    assert search["revision"] == 2 and search["value"]["tag_id"] == target["id"]
    assert {item["id"] for item in auth_client.get("/api/conversations", params={"tag_id": target["id"]}).json()} == {first["id"], second["id"]}
    assert auth_client.get(f"/api/conversations/{second['id']}").json()["offline_revision"] > before
    assert auth_client.get("/api/conversations", params={"tag_id": source["id"]}).status_code == 404
    assert merge(auth_client, source, target).status_code == 409
    register(auth_client, "together-tags-other")
    assert merge(auth_client, source, result.json()).status_code == 409
    assert auth_client.get("/api/conversations", params={"tag_id": target["id"]}).status_code == 404
    assert auth_client.get("/api/user-feature-entries/conversation-tag").json() == []


def test_tag_merge_conflict_and_oversize_are_atomic(auth_client):
    register(auth_client, "together-tag-limit")
    source = tag(auth_client, "Source", [])
    target = tag(auth_client, "Target", [])
    assert merge(auth_client, source, target, target_revision=2).status_code == 409
    # Synthetic pre-existing memberships exercise the union bound without
    # manufacturing 2,001 message trees. The bound must reject before writes.
    with auth_middleware.SessionLocal() as db:
        db.get(UserFeatureEntry, UUID(source["id"])).value = {"name": "Source", "conversation_ids": [str(uuid4()) for _ in range(1001)]}
        db.get(UserFeatureEntry, UUID(target["id"])).value = {"name": "Target", "conversation_ids": [str(uuid4()) for _ in range(1000)]}
        db.commit()
    before = auth_client.get("/api/user-feature-entries/conversation-tag").json()
    assert merge(auth_client, source, target).status_code == 422
    assert auth_client.get("/api/user-feature-entries/conversation-tag").json() == before
