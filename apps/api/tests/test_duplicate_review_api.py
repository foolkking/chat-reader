from fastapi.testclient import TestClient

from test_import_preview_api import client  # noqa: F401


def _create_conversation(client: TestClient, title: str, answer: str = "Synthetic answer") -> str:
    response = client.post(
        "/api/conversations",
        json={
            "title": title,
            "messages": [
                {"role": "user", "content_markdown": "Synthetic question"},
                {"role": "assistant", "content_markdown": answer},
            ],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["conversation"]["id"]


def test_duplicate_review_returns_exact_hash_groups_without_mutation(client: TestClient) -> None:
    first_id = _create_conversation(client, "Duplicate one")
    second_id = _create_conversation(client, "Duplicate two")
    distinct_id = _create_conversation(client, "Distinct", answer="A different answer")

    response = client.get("/api/conversations/duplicates")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["total_groups"] == 1
    assert payload["total_conversations"] == 2
    assert payload["has_more"] is False
    assert len(payload["groups"]) == 1
    group = payload["groups"][0]
    assert group["count"] == 2
    assert {item["id"] for item in group["conversations"]} == {first_id, second_id}
    assert distinct_id not in {item["id"] for item in group["conversations"]}

    assert client.get(f"/api/conversations/{first_id}").json()["status"] == "active"
    assert client.get(f"/api/conversations/{second_id}").json()["status"] == "active"


def test_duplicate_review_paginates_groups_and_filters_status(client: TestClient) -> None:
    _create_conversation(client, "Active duplicate one")
    archived_id = _create_conversation(client, "Archived duplicate two")
    assert client.post(f"/api/conversations/{archived_id}/archive").status_code == 200

    active_only = client.get("/api/conversations/duplicates", params={"status_scope": "active"})
    assert active_only.status_code == 200
    assert active_only.json()["total_groups"] == 0

    all_statuses = client.get("/api/conversations/duplicates", params={"status_scope": "all"})
    assert all_statuses.status_code == 200
    assert all_statuses.json()["total_groups"] == 1
    assert all_statuses.json()["groups"][0]["count"] == 2
