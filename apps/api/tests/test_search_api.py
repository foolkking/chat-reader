import json
import uuid

from fastapi.testclient import TestClient

from app.core.database import get_db
from app.main import app
from app.models.search_document import SearchDocument
from app.services.search.search_service import _document_matches, _find_text_matches
from test_import_preview_api import client  # noqa: F401


def test_search_match_ranges_map_casefold_and_whitespace_to_original_code_points() -> None:
    text = "😀 Straße\talpha  Straße"
    matches = _find_text_matches(text, "STRASSE alpha", 4)

    assert len(matches) == 1
    match = matches[0]
    assert text[match.match_start:match.match_end] == match.quote == "Straße\talpha"
    assert match.match_start == len("😀 ")
    assert match.match_end == match.match_start + len("Straße\talpha")


def test_search_match_construction_stops_at_per_result_limit() -> None:
    matches = _find_text_matches("needle " * 200, "needle", 0, max_matches=100)

    assert len(matches) == 100


def test_heading_and_code_matches_are_restricted_to_their_indexed_block() -> None:
    version_id = uuid.uuid4()
    block_ids = [uuid.uuid4(), uuid.uuid4()]
    blocks = {version_id: [(0, "needle in another block", block_ids[0]), (1, "needle in the indexed block", block_ids[1])]}
    for document_type in ("heading", "code"):
        document = SearchDocument(
            conversation_id=uuid.uuid4(), document_type=document_type, message_version_id=version_id,
            plain_text="needle", search_text="needle", metadata_={"block_index": 1},
        )
        matches = _document_matches(document, "needle", None, blocks)
        assert len(matches) == 1
        assert matches[0].block_index == 1
        assert matches[0].render_block_id == block_ids[1]


def test_match_limit_lookahead_is_shared_across_canonical_blocks() -> None:
    version_id = uuid.uuid4()
    document = SearchDocument(
        conversation_id=uuid.uuid4(), document_type="message", message_version_id=version_id,
        plain_text="needle", search_text="needle", metadata_={},
    )
    blocks = {version_id: [(0, "needle " * 60, uuid.uuid4()), (1, "needle " * 60, uuid.uuid4())]}
    matches = _document_matches(document, "needle", None, blocks)
    assert len(matches) == 101
    assert sum(match.block_index == 0 for match in matches) == 60
    assert sum(match.block_index == 1 for match in matches) == 41


def _commit_search_sample(
    client: TestClient,
    title: str = "Search Sample",
    messages: list[dict[str, str]] | None = None,
) -> str:
    preview = client.post(
        "/api/imports/preview",
        files={
            "files": (
                "search.json",
                json.dumps(
                    {
                        "metadata": {"title": title, "powered_by": "ChatGPT Exporter"},
                        "messages": messages if messages is not None else [
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


def test_search_like_wildcards_are_matched_literally(client: TestClient) -> None:
    bodies = [
        "literal token_under_score",
        "decoy tokenXunderXscore",
        "literal 37%",
        "decoy 37x",
        "literal left\\right",
        "decoy leftXright",
    ]
    created = client.post(
        "/api/conversations",
        json={
            "title": "Literal Search Wildcards",
            "messages": [
                {"role": "user", "content_markdown": "\n\n".join(bodies[::2])},
                {"role": "assistant", "content_markdown": "\n\n".join(bodies[1::2])},
            ],
        },
    )
    assert created.status_code == 201
    conversation_id = created.json()["conversation"]["id"]
    for query in ("token_under_score", "37%", r"left\right"):
        response = client.get(
            "/api/search",
            params={
                "q": query,
                "conversation_id": conversation_id,
                "document_type": "message",
            },
        )
        assert response.status_code == 200
        items = response.json()["items"]
        assert len(items) == 1
        assert items[0]["message_id"] == created.json()["messages"][0]["id"]
        assert query in items[0]["snippet"]


def test_search_attachment_result_exposes_its_file_target_fields(client: TestClient) -> None:
    conversation_id = _commit_search_sample(client, "Attachment Search")
    attachment_id = uuid.uuid4()
    display_name = "search-target-report.pdf"
    db = next(app.dependency_overrides[get_db]())
    try:
        db.add(SearchDocument(
            id=uuid.uuid4(),
            conversation_id=uuid.UUID(conversation_id),
            document_type="attachment",
            title=display_name,
            plain_text="report body with attachment-contract-needle",
            search_text="report body with attachment-contract-needle",
            metadata_={"attachment_id": str(attachment_id), "display_name": display_name},
        ))
        db.commit()
    finally:
        db.close()

    response = client.get(
        "/api/search",
        params={"q": "attachment-contract-needle", "document_type": "attachment"},
    )
    assert response.status_code == 200
    item = next(result for result in response.json()["items"] if result["conversation_id"] == conversation_id)
    assert item["message_id"] is None
    assert item["attachment_id"] == str(attachment_id)
    assert item["attachment_display_name"] == display_name
    assert item["matches"] == []


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


def test_scoped_search_pages_preserve_equal_rank_document_identity(client: TestClient) -> None:
    conversation_id = _commit_search_sample(
        client, "Synthetic paged search",
        messages=[{"role": "Response", "say": f"pageprobe synthetic item {index}"} for index in range(121)],
    )
    pages = []
    for offset in (0, 50, 100):
        response = client.get("/api/search", params={
            "q": "pageprobe", "conversation_id": conversation_id, "document_type": "message",
            "limit": 50, "offset": offset,
        })
        assert response.status_code == 200
        pages.append(response.json())
    assert [len(page["items"]) for page in pages] == [50, 50, 21]
    assert [page["has_more"] for page in pages] == [True, True, False]
    assert all(page["total"] == 121 for page in pages)
    assert len({item["document_id"] for page in pages for item in page["items"]}) == 121
    again = client.get("/api/search", params={
        "q": "pageprobe", "conversation_id": conversation_id, "document_type": "message", "limit": 50,
    })
    assert [item["document_id"] for item in again.json()["items"]] == [item["document_id"] for item in pages[0]["items"]]


def test_search_match_truncation_uses_lookahead_not_the_exact_limit(client: TestClient) -> None:
    for count in (100, 101):
        conversation_id = _commit_search_sample(
            client, f"Synthetic bounded matches {count}",
            messages=[{"role": "Response", "say": "matchprobe " * count}],
        )
        response = client.get("/api/search", params={
            "q": "matchprobe", "conversation_id": conversation_id, "document_type": "message",
        })
        assert response.status_code == 200
        page = response.json()
        assert page["has_more"] is False
        assert len(page["items"]) == 1
        assert len(page["items"][0]["matches"]) == 100
        assert page["items"][0]["matches_truncated"] is (count > 100)


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


def test_current_conversation_keeps_identical_answers_as_distinct_message_targets(client: TestClient) -> None:
    messages = [
        item
        for index in range(3)
        for item in (
            {"role": "Prompt", "say": f"Synthetic question {index}"},
            {"role": "Response", "say": "needle once; needle twice."},
        )
    ]
    conversation_id = _commit_search_sample(client, "Synthetic repeated answers", messages)
    params = {"q": "needle", "document_type": "message", "role": "assistant", "conversation_id": conversation_id}
    response = client.get("/api/search", params=params)
    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 3
    items = payload["items"]
    message_ids = [item["message_id"] for item in items]
    assert len(set(message_ids)) == 3
    assert all(item["conversation_id"] == conversation_id and item["occurrence_count"] == 1 for item in items)
    assert all(len(item["matches"]) == 2 for item in items)
    assert [item["order_key"] for item in items] == sorted(item["order_key"] for item in items)
    paged_ids = []
    for offset in range(3):
        page = client.get("/api/search", params={**params, "limit": 1, "offset": offset})
        assert page.status_code == 200
        assert page.json()["total"] == 3
        paged_ids.extend(item["message_id"] for item in page.json()["items"])
    assert paged_ids == message_ids

    # The same corpus still folds globally and counts conversations, not messages.
    other_id = _commit_search_sample(client, "Synthetic other conversation", messages)
    global_result = client.get("/api/search", params={"q": "needle", "document_type": "message", "role": "assistant"})
    assert global_result.status_code == 200
    assert global_result.json()["total"] == 1
    representative = global_result.json()["items"][0]
    assert representative["occurrence_count"] == 2
    assert representative["conversation_id"] in {conversation_id, other_id}


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
