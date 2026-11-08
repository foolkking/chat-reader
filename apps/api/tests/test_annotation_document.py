"""Readable export is a deterministic projection, not a round-trip format."""
import json
import re
from pathlib import Path
import pytest

from app.services.exporting.annotation_document import document_entry, document_header
from test_import_preview_api import client  # noqa: F401
from test_offline_annotations_api import _message_context


FIXTURE = Path(__file__).parents[3] / "scripts" / "ux" / "fixtures" / "annotation-document-v1.json"


@pytest.mark.parametrize("zh", [False, True])
def test_v2_shared_golden_document_is_byte_compatible_with_offline(zh):
    from app.services.exporting.annotation_document import readable_header, readable_entry, location_label
    fixture = json.loads(FIXTURE.with_name("annotation-document-v2.json").read_text(encoding="utf-8"))
    result = readable_header(fixture["title"], fixture["exported_at"], 1, scope="selected", zh=zh)
    result += readable_entry(fixture["record"], 1, zh=zh, source_base=fixture["source_base"])
    assert result == "\n".join(fixture["expected_zh" if zh else "expected_en"]).encode("utf-8")
    for example in fixture["location_cases"]:
        assert location_label(example["record"], zh) == example["zh" if zh else "en"]


def test_python_annotation_document_serializer_obeys_shared_fixture():
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    result = (document_header(fixture["title"], fixture["exported_at"], 1)
              + document_entry(fixture["record"], 1)).decode("utf-8")
    assert "chat-reader-annotation-export version=1" in result
    assert "````text\nA `quoted` line\nwith ``` fences.\n````" in result
    assert "Synthetic **comment**." in result
    assert "批注数：1" in result


@pytest.mark.parametrize("zh", [False, True])
def test_nontext_bookmark_export_distinguishes_offsets_without_inventing_text(zh):
    from app.services.exporting.annotation_document import readable_entry, location_label
    def record(offset):
        return {"annotation_type": "bookmark", "anchor_status": "valid", "start_block_index": 2, "start_offset": None,
                "metadata": {"bookmark_kind": "reading_point", "reading_anchor": {"block_offset": offset},
                             "reading_label": "Synthetic diagram"}}
    first, second = location_label(record(20), zh), location_label(record(650), zh)
    assert first != second and "20 CSS px" in first and "650 CSS px" in second
    assert "Synthetic diagram" in second
    result = readable_entry(record(650), 1, zh=zh).decode("utf-8")
    assert "文字位置 0" not in result and "Character 0" not in result
    assert location_label({"annotation_type": "bookmark"}, zh) == ("整条消息书签" if zh else "Message bookmark")


def test_online_endpoint_exports_saved_annotations_without_page_filters(client):
    conversation_id, message, version = _message_context(client)
    annotation = client.post(f"/api/conversations/{conversation_id}/annotations", json={
        "message_id": message["id"], "message_version_id": version["id"],
        "annotation_type": "comment", "start_block_index": 0, "start_offset": 0,
        "end_block_index": 0, "end_offset": 5, "quote": "hello",
        "comment_markdown": "Saved **comment**.",
    })
    assert annotation.status_code == 201, annotation.text
    response = client.get(f"/api/conversations/{conversation_id}/exports/annotations")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/markdown")
    assert re.search(r'filename\*=UTF-8\'\'[^;]*--annotations\.md', response.headers["content-disposition"])
    assert "hello" in response.text and "Saved **comment**." in response.text
    assert "all_non_deleted_annotations" in response.text
    deleted = client.delete(f"/api/annotations/{annotation.json()['id']}", params={"base_revision": 1})
    assert deleted.status_code == 204
    empty = client.get(f"/api/conversations/{conversation_id}/exports/annotations")
    assert empty.status_code == 200
    assert "没有未删除的已保存批注" in empty.text


def test_v2_export_uses_saved_scope_and_literal_context_in_both_locales(client):
    quotes = [f"Literal <script> and ``` source {index}" for index in range(2)]
    prefix, suffix = "Earlier sentence. ", " Later sentence."
    content = "\n".join(prefix + quote + suffix for quote in quotes)
    created = client.post("/api/conversations", json={
        "title": "Synthetic literal annotation export",
        "messages": [
            {"role": "user", "content_markdown": f"````text\n{content}\n````"},
            {"role": "assistant", "content_markdown": "Synthetic answer."},
        ],
    })
    assert created.status_code == 201, created.text
    conversation_id = created.json()["conversation"]["id"]
    detail = client.get(f"/api/messages/{created.json()['messages'][0]['id']}")
    assert detail.status_code == 200, detail.text
    message = detail.json()
    version = message["current_version"]
    endpoint = f"/api/conversations/{conversation_id}"
    ids = []
    for index, quote in enumerate(quotes):
        block = next(row for row in message["render_blocks"] if quote in (row["plain_text"] or ""))
        start = block["plain_text"].index(quote)
        response = client.post(endpoint + "/annotations", json={
            "message_id": message["id"], "message_version_id": version["id"],
            "annotation_type": "comment", "quote": quote,
            "start_block_index": block["block_index"], "end_block_index": block["block_index"],
            "start_offset": start, "end_offset": start + len(quote),
            "prefix": prefix, "suffix": suffix,
            "comment_markdown": f"Saved **comment {index}**.",
        })
        assert response.status_code == 201, response.text
        ids.append(response.json()["id"])
    result = client.post(endpoint + "/exports/annotations", json={
        "scope": "selected", "annotation_ids": [ids[1]], "locale": "en",
    })
    assert result.status_code == 200, result.text
    assert "version=2" in result.text and "Scope: selected · 1" in result.text
    assert "Saved **comment 1**." in result.text and "Saved **comment 0**." not in result.text
    assert "Context when saved" in result.text
    assert "````text\nEarlier sentence. Literal <script> and ``` source 1 Later sentence.\n````" in result.text
    all_rows = client.post(endpoint + "/exports/annotations", json={"scope": "all", "locale": "zh-CN"})
    assert all_rows.status_code == 200 and "全部已保存 · 2" in all_rows.text
    empty = client.post(endpoint + "/exports/annotations", json={"scope": "filtered", "annotation_ids": [], "locale": "en"})
    assert empty.status_code == 200 and "Scope: filtered · 0" in empty.text
    assert client.post(endpoint + "/exports/annotations", json={"scope": "selected"}).status_code == 422
    assert client.post(endpoint + "/exports/annotations", json={"scope": "all", "annotation_ids": ids}).status_code == 422
    assert "version=1" in client.get(endpoint + "/exports/annotations").text
