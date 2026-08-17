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
    assert payload["items"][0]["message_version_id"]
    assert payload["items"][0]["matches"]
    assert all(match["match_start"] < match["match_end"] for match in payload["items"][0]["matches"])


def test_manual_conversation_is_immediately_searchable_with_distinct_occurrences(client: TestClient) -> None:
    created = client.post(
        "/api/conversations",
        json={
            "title": "Immediate Search",
            "messages": [
                {"role": "user", "content_markdown": "needle once; needle twice."},
                {"role": "assistant", "content_markdown": "needle answer."},
            ],
        },
    )
    assert created.status_code == 201
    conversation_id = created.json()["conversation"]["id"]

    response = client.get(
        "/api/search",
        params={"q": "needle", "conversation_id": conversation_id, "document_type": "message"},
    )
    assert response.status_code == 200
    items = response.json()["items"]
    assert {item["role"] for item in items} == {"user", "assistant"}
    user_item = next(item for item in items if item["role"] == "user")
    assert len(user_item["matches"]) == 2
    assert len({(match["block_index"], match["match_start"], match["match_end"]) for match in user_item["matches"]}) == 2


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


def test_message_search_returns_distinct_occurrences_with_stable_block_offsets(client: TestClient) -> None:
    conversation_id = _commit_search_sample(client, "Repeated Search")
    response = client.get(
        "/api/search",
        params={"q": "alpha", "conversation_id": conversation_id, "document_type": "message", "role": "assistant"},
    )
    assert response.status_code == 200
    item = response.json()["items"][0]
    assert item["message_id"] is not None
    assert item["message_version_id"] is not None
    assert len(item["matches"]) >= 2
    positions = {(match["block_index"], match["match_start"], match["match_end"]) for match in item["matches"]}
    assert len(positions) == len(item["matches"])
    assert all(match["quote"].casefold() == "alpha" for match in item["matches"])


def test_conversation_scoped_search_does_not_turn_title_matches_into_body_hits(client: TestClient) -> None:
    conversation_id = _commit_search_sample(client, "TitleOnlyNeedle")
    response = client.get(
        "/api/search",
        params={"q": "TitleOnlyNeedle", "conversation_id": conversation_id, "document_type": "message"},
    )
    assert response.status_code == 200
    assert response.json()["items"] == []


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


def test_search_role_filter_and_duplicate_message_occurrences(client: TestClient) -> None:
    first_id = _commit_search_sample(client, "Duplicate One")
    second_id = _commit_search_sample(client, "Duplicate Two")
    response = client.get("/api/search", params={"q": "alpha result body", "document_type": "message", "role": "assistant"})
    assert response.status_code == 200
    assert response.json()["total"] == 1
    item = response.json()["items"][0]
    assert item["role"] == "assistant"
    assert item["occurrence_count"] == 2
    assert item["conversation_id"] in {first_id, second_id}

    invalid = client.get("/api/search", params={"q": "alpha", "role": "invalid"})
    assert invalid.status_code == 400


def test_search_code_blocks_block_location_and_archive_scope(client: TestClient) -> None:
    preview = client.post(
        "/api/imports/preview",
        files={
            "files": (
                "code-search.json",
                json.dumps(
                    {
                        "metadata": {"title": "Code Search", "powered_by": "ChatGPT Exporter"},
                        "messages": [
                            {"role": "Prompt", "say": "show code"},
                            {"role": "Response", "say": "```ts\nconst uniqueCodeNeedle = 42;\n```"},
                        ],
                    }
                ).encode(),
                "application/json",
            )
        },
    )
    conversation_id = client.post(f"/api/imports/{preview.json()['import_id']}/commit").json()["conversation_ids"][0]
    code = client.get("/api/search", params={"q": "uniqueCodeNeedle", "document_type": "code"})
    assert code.status_code == 200
    item = next(item for item in code.json()["items"] if item["conversation_id"] == conversation_id)
    assert item["document_type"] == "code"
    assert item["message_id"] is not None
    assert item["block_index"] is not None

    assert client.patch(f"/api/conversations/{conversation_id}", json={"status": "archived"}).status_code == 200
    active = client.get("/api/search", params={"q": "uniqueCodeNeedle", "status_scope": "active"})
    archived = client.get("/api/search", params={"q": "uniqueCodeNeedle", "status_scope": "archived"})
    assert all(item["conversation_id"] != conversation_id for item in active.json()["items"])
    assert any(item["conversation_id"] == conversation_id for item in archived.json()["items"])
