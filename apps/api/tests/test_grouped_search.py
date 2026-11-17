import pytest

from test_import_preview_api import client  # noqa: F401
from test_search_api import _commit_search_sample


def test_grouping_before_pagination_keeps_identical_conversations(client):
    ids = [_commit_search_sample(client, f"Conversation {index}", [
        {"role": "Prompt", "say": "中文 检索 alpha 100%_path"},
        {"role": "Response", "say": "中文 再次检索 alpha 100%_path"},
    ]) for index in range(3)]
    first = client.get("/api/search/conversations", params={"q": "中文 alpha", "limit": 1}).json()
    assert first["total"] == 3
    assert len(first["items"]) == 1
    assert first["items"][0]["hit_count"] >= 2
    assert first["items"][0]["matches"]
    second = client.get("/api/search/conversations", params={"q": "中文 alpha", "limit": 1, "offset": 1}).json()
    assert first["items"][0]["conversation_id"] != second["items"][0]["conversation_id"]
    found = client.get("/api/search/conversations", params={"q": "中文 alpha"}).json()
    assert {item["conversation_id"] for item in found["items"]} == set(ids)


def test_title_does_not_fabricate_message_matches(client):
    identifier = _commit_search_sample(client, "精确标题", [
        {"role": "Prompt", "say": "Other body"}, {"role": "Response", "say": "Unrelated response"}])
    result = client.get("/api/search/conversations", params={"q": "精确标题"}).json()
    assert result["total"] == 1
    assert result["items"][0]["hit_count"] == 1
    hits = client.get("/api/search/conversations", params={"q": "精确标题", "conversation_id": identifier}).json()
    assert [item["document_type"] for item in hits["items"]] == ["conversation"]


@pytest.mark.parametrize("query,expected", [
    ("中文 alpha", 1), ('"中文 alpha"', 0), ("100%_path", 1),
    ("100%_missing", 0), ("中文 absent", 0), ('"相邻 短语"', 1),
])
def test_literal_terms_and_phrases(client, query, expected):
    _commit_search_sample(client, "Example", [{"role": "Prompt", "say": "中文 内容 alpha 100%_path 相邻 短语"}])
    result = client.get("/api/search/conversations", params={"q": query})
    assert result.status_code == 200, result.text
    assert result.json()["total"] == expected
