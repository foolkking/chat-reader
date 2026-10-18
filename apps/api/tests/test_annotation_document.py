"""Readable export is a deterministic projection, not a round-trip format."""
import json
import re
from pathlib import Path

from app.services.exporting.annotation_document import document_entry, document_header
from test_import_preview_api import client  # noqa: F401
from test_offline_annotations_api import _message_context


FIXTURE = Path(__file__).parents[3] / "scripts" / "ux" / "fixtures" / "annotation-document-v1.json"


def test_python_annotation_document_serializer_obeys_shared_fixture():
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    result = (document_header(fixture["title"], fixture["exported_at"], 1)
              + document_entry(fixture["record"], 1)).decode("utf-8")
    assert "chat-reader-annotation-export version=1" in result
    assert "````text\nA `quoted` line\nwith ``` fences.\n````" in result
    assert "Synthetic **comment**." in result
    assert "批注数：1" in result


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
