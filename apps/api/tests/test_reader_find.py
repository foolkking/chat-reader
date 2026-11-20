import tracemalloc
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from fastapi.testclient import TestClient

from app.services.search.search_service import _find_text_matches
from test_import_preview_api import client  # noqa: F401


def _make(client, title, first, second):
    response = client.post("/api/conversations", json={"title": title, "messages": [
        {"role": "user", "content_markdown": first}, {"role": "assistant", "content_markdown": second},
    ]})
    assert response.status_code == 201
    return response.json()


def test_reader_find_is_literal_scoped_ordered_and_archived(client: TestClient) -> None:
    made = _make(client, "OnlyInTheTitle", "快速向下滑动 needle one\n\nneedle alone",
                 "快速向下滑动 needle one, needle one")
    _make(client, "Unrelated", "快速向下滑动 needle one", "needle one")
    cid = made["conversation"]["id"]
    assert client.patch(f"/api/conversations/{cid}", json={"status": "archived"}).status_code == 200
    params = {"reader_find": True, "conversation_id": cid, "document_type": "message", "status_scope": "all"}

    def find(q, **more):
        response = client.get("/api/search", params={**params, "q": q, **more})
        assert response.status_code == 200
        return response.json()

    for i in (0, 1):
        page = find("向下滑", limit=1, offset=i)
        assert page["total"] == 2 and page["has_more"] == (i == 0)
        item, = page["items"]
        assert item["message_id"] == made["messages"][i]["id"] and item["conversation_status"] == "archived"
        match, = item["matches"]
        assert match["quote"] == "向下滑" and match["render_block_id"]
    literal = find("needle   ONE")["items"]
    assert [[m["quote"] for m in item["matches"]] for item in literal] == [["needle one"], ["needle one", "needle one"]]
    assert find("assistant")["total"] == find("OnlyInTheTitle")["total"] == find("one needle")["total"] == 0
    assert find("needle", status_scope="active")["total"] == 0
    assert [v["message_id"] for v in find("向下滑", role="assistant")["items"]] == [made["messages"][1]["id"]]
    assert client.get("/api/search", params={"q": "needle", "reader_find": True}).status_code == 400


def test_reader_find_keeps_literal_punctuation_and_canonical_ranges(client: TestClient) -> None:
    text = "😀 synthetic 37% foo_bar / a.b+"
    made = _make(client, "Punctuation", text, "😀 synthetic 37x fooXbar / axb")
    params = {"reader_find": True, "conversation_id": made["conversation"]["id"], "document_type": "message"}
    for query, quote in [("37%", "37%"), ("foo_bar", "foo_bar"), (" /   a.b+ ", "/ a.b+")]:
        response = client.get("/api/search", params={**params, "q": query})
        assert response.status_code == 200
        item, = response.json()["items"]
        assert item["message_id"] == made["messages"][0]["id"]
        match, = item["matches"]
        assert text[match["match_start"]:match["match_end"]] == match["quote"] == quote
    assert client.get("/api/search", params={**params, "q": "synthetic", "terms_mode": True}).status_code == 400


def test_literal_find_maps_sparse_and_expanding_ranges_without_a_position_table_per_character() -> None:
    sample = "😀" * 90 + "İ ß SS Straße\t \nalpha  a.b+ 向下滑动 " + "𐐀" * 90
    for query in ("s", "ss", "STRASSE alpha", "\u0307", "a.b+", "向下滑", "𐐨"):
        # Compare complete locations, quotes and both 80-code-point contexts
        # to the established matcher only for genuine literal hits.
        expected = _find_text_matches(sample, query, 2)
        assert expected and _find_text_matches(sample, query, 2, literal_only=True) == expected
    assert not _find_text_matches(sample, "alpha missing", 2, literal_only=True)
    assert [m.match_start for m in _find_text_matches("ß" * 200, "s", 2, max_matches=3, literal_only=True)] == [0, 1, 2]

    large = "synthetic_code statement; " * 10_000 + "😀 final NeedLe     phrase"
    tracemalloc.start()
    try:
        hit, = _find_text_matches(large, "needle phrase", 1, literal_only=True)
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    assert large[hit.match_start:hit.match_end] == hit.quote == "NeedLe     phrase"
    assert peak < 16 * 1024 * 1024


def test_reader_find_continues_past_100_without_skipping_next_message(client: TestClient) -> None:
    made = _make(client, "Paged positions", " ".join(f"潮汐{i}" for i in range(205)), "末尾潮汐")
    params = {"reader_find": True, "conversation_id": made["conversation"]["id"], "document_type": "message",
              "q": "潮汐", "limit": 1}
    found = []
    for _ in range(5):
        result = client.get("/api/search", params=params)
        assert result.status_code == 200
        page = result.json()
        found.extend((item["message_id"], m["match_start"]) for item in page["items"] for m in item["matches"])
        if not page["has_more"]:
            break
        params.update(offset=page["next_offset"] if page["next_offset"] is not None else page["offset"] + page["limit"],
                      match_offset=page["next_match_offset"] or 0)
        if page["next_document_id"]:
            params["match_document_id"] = page["next_document_id"]
        else:
            params.pop("match_document_id", None)
    assert len(found) == len(set(found)) == 206
    assert found[-1][0] == made["messages"][1]["id"]


def test_share_find_scopes_frozen_live_and_long_match_pagination(client: TestClient) -> None:
    made = _make(client, "Shared synthetic", " ".join(f"潮汐{i}" for i in range(105)), "private-hidden-needle")
    _make(client, "Unrelated secret", "private-hidden-needle", "潮汐")
    cid = made["conversation"]["id"]
    shared_id, hidden_id = [m["id"] for m in made["messages"]]
    tokens = {}
    for mode in ("live", "frozen"):
        share = client.post(f"/api/conversations/{cid}/shares", json={
            "scope": "selected_messages", "selected_message_ids": [shared_id], "content_mode": mode,
        })
        assert share.status_code == 200
        token = share.json()["token"]
        tokens[mode] = token
        endpoint = f"/api/shared/{token}/find"
        first = client.post(endpoint, json={"q": "潮汐"})
        assert first.status_code == 200 and first.headers["cache-control"] == "no-store"
        page = first.json()
        assert len(page["items"]) == 1 and len(page["items"][0]["matches"]) == 100
        assert page["next_match_offset"] == 100
        more = client.post(endpoint, json={"q": "潮汐", "offset": page["next_offset"],
            "match_offset": 100, "match_document_id": page["next_document_id"]})
        assert more.status_code == 200
        assert len(more.json()["items"][0]["matches"]) == 5
        assert not more.json()["has_more"]
        assert client.post(endpoint, json={"q": "private-hidden-needle"}).json()["items"] == []
        assert client.post(endpoint, json={"q": "潮汐", "document_type": "annotation"}).status_code == 422
        assert client.post(endpoint, json={"q": "潮汐", "conversation_id": cid}).status_code == 422
        assert all(i["message_id"] != hidden_id for i in page["items"])
    assert client.patch(f"/api/messages/{shared_id}", json={"display_text": "replacement-needle"}).status_code == 200
    assert client.post(f"/api/shared/{tokens['frozen']}/find", json={"q": "replacement-needle"}).json()["items"] == []
    assert client.post(f"/api/shared/{tokens['live']}/find", json={"q": "replacement-needle"}).json()["items"]
    assert client.post(f"/api/shared/{tokens['frozen']}/find", json={"q": "潮汐"}).json()["items"]
    assert client.post(f"/api/shared/{tokens['live']}/find", json={"q": "潮汐"}).json()["items"] == []


def test_share_find_rechecks_password_expiry_and_revocation_on_every_page(client: TestClient, tmp_path, monkeypatch) -> None:
    from app.core.config import get_settings
    from app.models.share import Share
    monkeypatch.setenv("AUTH_SESSION_SECRET", "synthetic-find-test-key-01234567890123456789")
    get_settings.cache_clear()
    made = _make(client, "Authorized find", "needle first", "needle next")
    share = client.post(f"/api/conversations/{made['conversation']['id']}/shares",
                        json={"share_password": "synthetic-find-password"}).json()
    endpoint = f"/api/shared/{share['token']}/find"
    assert client.post(endpoint, json={"q": "needle", "limit": 1}).status_code == 401
    assert client.post(f"/api/shared/{share['token']}/unlock", json={"password": "synthetic-find-password"}).status_code == 200
    first = client.post(endpoint, json={"q": "needle", "limit": 1}).json()
    assert first["has_more"]
    next_page = {"q": "needle", "limit": 1, "offset": first["next_offset"]}
    assert len(client.post(endpoint, json=next_page).json()["items"]) == 1
    assert client.patch(f"/api/shares/{share['id']}", json={"share_password": "changed-synthetic-password"}).status_code == 200
    assert client.post(endpoint, json=next_page).status_code == 401
    assert client.post(f"/api/shared/{share['token']}/unlock", json={"password": "changed-synthetic-password"}).status_code == 200
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}")
    with Session(engine) as session:
        row = session.get(Share, UUID(share["id"]))
        row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        session.commit()
    assert client.post(endpoint, json=next_page).status_code == 410
    with Session(engine) as session:
        row = session.get(Share, UUID(share["id"]))
        row.expires_at = None
        session.commit()
    engine.dispose()
    assert client.post(f"/api/shares/{share['id']}/revoke").status_code == 200
    assert client.post(endpoint, json=next_page).status_code == 410
