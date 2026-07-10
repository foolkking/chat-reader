import json

from fastapi.testclient import TestClient

from test_import_preview_api import client  # noqa: F401


def _commit_search_sample(client: TestClient, title: str = "Search Sample") -> str:
    preview = client.post(
        "/api/imports/preview",
        files={
            "files": (
                "search.json",
                json.dumps(
                    {
                        "metadata": {"title": title, "powered_by": "ChatGPT Exporter"},
                        "messages": [
                            {"role": "Prompt", "say": "Find the keyword alpha"},
                            {"role": "Response", "say": "# Alpha Section\n\nalpha result body"},
                        ],
                    }
                ).encode(),
                "application/json",
            )
        },
    )
    return client.post(f"/api/imports/{preview.json()['import_id']}/commit").json()["conversation_ids"][0]


def test_search_returns_results_and_plain_text_snippet(client: TestClient) -> None:
    conversation_id = _commit_search_sample(client)

    response = client.get("/api/search?q=alpha")
    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] >= 1
    assert payload["items"][0]["conversation_id"] == conversation_id
    assert "alpha" in payload["items"][0]["snippet"].lower()
    assert "<" not in payload["items"][0]["snippet"]


def test_search_filters_validation_and_pagination(client: TestClient) -> None:
    conversation_id = _commit_search_sample(client, "Filter Sample")
    project_id = client.post("/api/projects", json={"name": "Search Project"}).json()["id"]
    assert client.post(f"/api/projects/{project_id}/conversations/{conversation_id}").status_code == 200

    by_conversation = client.get(f"/api/search?q=alpha&conversation_id={conversation_id}&document_type=message")
    assert by_conversation.status_code == 200
    assert all(item["conversation_id"] == conversation_id for item in by_conversation.json()["items"])
    assert all(item["document_type"] == "message" for item in by_conversation.json()["items"])

    by_project = client.get(f"/api/search?q=alpha&project_id={project_id}&limit=1&offset=0")
    assert by_project.status_code == 200
    assert by_project.json()["limit"] == 1
    assert by_project.json()["total"] >= 1

    empty = client.get("/api/search?q=")
    assert empty.status_code == 400


def test_search_matches_chinese_code_url_and_quoted_substrings(client: TestClient) -> None:
    preview = client.post(
        "/api/imports/preview",
        files={
            "files": (
                "substring.json",
                json.dumps(
                    {
                        "metadata": {"title": "Substring Sample", "powered_by": "ChatGPT Exporter"},
                        "messages": [
                            {
                                "role": "Prompt",
                                "say": "请解释 json.loads 和 package.json 的区别，以及 https://example.com/a?b=c",
                            },
                            {
                                "role": "Response",
                                "say": "中文连续文本可以通过子串搜索命中。这里还有精确短语 unique quoted phrase。",
                            },
                        ],
                    },
                    ensure_ascii=False,
                ).encode(),
                "application/json",
            )
        },
    )
    conversation_id = client.post(f"/api/imports/{preview.json()['import_id']}/commit").json()["conversation_ids"][0]

    for query in ["连续文本", "json.loads", "package.json", "https://example.com/a?b=c", "unique quoted phrase"]:
        response = client.get("/api/search", params={"q": query})
        assert response.status_code == 200
        assert any(item["conversation_id"] == conversation_id for item in response.json()["items"])


def test_reindex_rebuilds_search_and_toc(client: TestClient) -> None:
    conversation_id = _commit_search_sample(client, "Reindex Sample")

    response = client.post("/api/search/reindex", json={"conversation_id": conversation_id})
    assert response.status_code == 200
    payload = response.json()
    assert payload["conversation_count"] == 1
    assert payload["indexed_count"] >= 2
    assert payload["heading_count"] == 1
