from fastapi.testclient import TestClient

from test_import_preview_api import client  # noqa: F401
from test_search_api import _commit_search_sample


def test_search_reindex_is_idempotent_and_excludes_raw_uri(client: TestClient) -> None:
    conversation_id = _commit_search_sample(client, "Indexer Sample")

    first = client.post("/api/search/reindex", json={"conversation_id": conversation_id})
    second = client.post("/api/search/reindex", json={"conversation_id": conversation_id})
    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["indexed_count"] == second.json()["indexed_count"]

    raw_search = client.get("/api/search?q=raw_storage_uri")
    assert raw_search.status_code == 200
    assert raw_search.json()["total"] == 0
