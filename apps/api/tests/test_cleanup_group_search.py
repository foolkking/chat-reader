"""Group discovery searches the complete scan without changing selection scope."""
import json
import uuid
from app.services.content_cleanup import process_scan_chunk
from app.models.message import Message
from app.models.conversation import Conversation
from test_import_preview_api import client  # noqa: F401
from test_cleanup_safety import MARKER, create_review, session


def test_group_search_is_literal_bounded_and_does_not_change_decisions(client):
    scan_id, messages = create_review(client, [f"Before {MARKER} after."] * 4)
    titles = ["Alpha", "Zulu 100%_done", "Zulu 100xxdone", "检索标题"]
    with session() as db:
        for message_id, title in zip(messages, titles):
            db.get(Conversation, db.get(Message, message_id).conversation_id).display_title = title
        db.commit()
    url = f"/api/content-cleanup/scans/{scan_id}"
    baseline = client.get(url).json()
    first = client.get(url + "/groups", params={"limit": 1}).json()
    assert first["total"] == 4 and first["items"][0]["conversation_title"] == "Alpha"
    matched = client.get(url + "/groups", params={"q": "  zUlU 100%_  ", "limit": 1}).json()
    assert matched["total"] == 1
    assert matched["items"][0]["conversation_title"] == "Zulu 100%_done"
    assert matched["items"][0]["selected"] == 0
    assert client.get(url + "/groups", params={"q": "检索"}).json()["total"] == 1
    assert client.get(url + "/groups", params={"q": "missing"}).json()["items"] == []
    assert client.get(url + "/groups", params={"q": ""}).json()["total"] == 4
    assert client.get(url + "/groups", params={"q": "zulu", "limit": 1, "offset": 1}).json()["total"] == 2
    assert client.get(url + "/groups", params={"q": "x" * 201}).status_code == 422
    assert client.get(url).json() == baseline
    assert client.get(url + "/review").json()["total"] == 4


def test_import_review_discovery_only_returns_its_existing_scan(client):
    imports = []
    for title in ("Synthetic first import", "Synthetic second import"):
        payload = {"metadata": {"title": title, "powered_by": "ChatGPT Exporter"}, "messages": [
            {"role": "Prompt", "say": "Question", "time": "2026-10-07 10:00:00"},
            {"role": "Response", "say": f"Before {MARKER} after.", "time": "2026-10-07 10:01:00"},
        ]}
        preview = client.post("/api/imports/preview", files={"files": ("synthetic.json", json.dumps(payload).encode(), "application/json")})
        assert preview.status_code == 200
        import_id = preview.json()["import_id"]
        assert client.get("/api/content-cleanup/scans/pending", params={"import_id": import_id}).json() == []
        assert client.post(f"/api/imports/{import_id}/commit").status_code == 200
        imports.append(import_id)
    all_scans = client.get("/api/content-cleanup/scans/pending").json()
    first = client.get("/api/content-cleanup/scans/pending", params={"import_id": imports[0]}).json()
    second = client.get("/api/content-cleanup/scans/pending", params={"import_id": imports[1]}).json()
    assert len(all_scans) == 2 and len(first) == len(second) == 1
    assert first[0]["id"] != second[0]["id"]
    assert first[0]["source"] == second[0]["source"] == "IMPORT"
    assert client.get("/api/content-cleanup/scans/pending", params={"import_id": imports[0]}).json() == first
    assert client.get("/api/content-cleanup/scans/pending").json() == all_scans
    assert client.get("/api/content-cleanup/scans/pending", params={"import_id": "00000000-0000-0000-0000-000000000099"}).status_code == 404
    replacement = client.post(f"/api/content-cleanup/scans/{first[0]['id']}/rescan")
    assert replacement.status_code == 202
    latest = client.get("/api/content-cleanup/scans/pending", params={"import_id": imports[0]}).json()
    assert len(latest) == 1 and latest[0]["id"] == replacement.json()["id"]
    assert latest[0]["source"] == "IMPORT"
    with session() as db:
        while not process_scan_chunk(db, uuid.UUID(latest[0]["id"]))["done"]:
            db.commit()
        db.commit()
    assert client.delete(f"/api/content-cleanup/scans/{latest[0]['id']}").status_code == 204
    assert client.get("/api/content-cleanup/scans/pending", params={"import_id": imports[0]}).json() == []
    assert client.get(f"/api/content-cleanup/scans/{first[0]['id']}").status_code == 200
