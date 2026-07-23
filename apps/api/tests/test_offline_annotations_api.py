import json
import io
import uuid
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient

from app.core.config import get_settings
from test_cr_archive import _run_job
from test_import_preview_api import client  # noqa: F401
from test_message_editing_api import commit_edit_sample


def _message_context(client: TestClient) -> tuple[str, dict, dict]:
    sample = commit_edit_sample(client)
    conversation_id = sample["conversation_id"]
    message = client.get(f"/api/conversations/{conversation_id}/messages").json()[0]
    window = client.get(f"/api/conversations/{conversation_id}/message-window").json()
    current = next(item for item in window["items"] if item["id"] == message["id"])
    return conversation_id, message, current["current_version"]


def test_annotations_revision_conflict_sync_idempotency_and_notebook(client: TestClient) -> None:
    conversation_id, message, version = _message_context(client)
    create = client.post(
        f"/api/conversations/{conversation_id}/annotations",
        json={
            "message_id": message["id"],
            "message_version_id": version["id"],
            "annotation_type": "highlight",
            "color": "yellow",
            "start_block_index": 0,
            "start_offset": 0,
            "end_block_index": 0,
            "end_offset": 5,
            "quote": "hello",
        },
    )
    assert create.status_code == 201
    annotation = create.json()
    assert annotation["revision"] == 1

    updated = client.patch(
        f"/api/annotations/{annotation['id']}",
        json={"base_revision": 1, "comment_markdown": "first"},
    )
    assert updated.status_code == 200
    assert updated.json()["revision"] == 2
    conflict = client.patch(
        f"/api/annotations/{annotation['id']}",
        json={"base_revision": 1, "comment_markdown": "stale"},
    )
    assert conflict.status_code == 409

    operation_id = str(uuid.uuid4())
    sync_payload = {
        "operations": [
            {
                "operation_id": operation_id,
                "entity_type": "annotation",
                "entity_id": str(uuid.uuid4()),
                "action": "upsert",
                "conversation_id": conversation_id,
                "base_revision": 0,
                "payload": {
                    "message_id": message["id"],
                    "message_version_id": version["id"],
                    "annotation_type": "highlight",
                    "color": "blue",
                    "start_block_index": 0,
                    "start_offset": 1,
                    "end_block_index": 0,
                    "end_offset": 4,
                    "quote": "ell",
                },
            }
        ]
    }
    applied = client.post("/api/annotations/sync", json=sync_payload)
    assert applied.status_code == 200
    assert applied.json()["results"][0]["status"] == "applied"
    duplicate = client.post("/api/annotations/sync", json=sync_payload)
    assert duplicate.status_code == 200
    assert duplicate.json()["results"][0]["status"] == "duplicate"

    notebook = client.get(f"/api/conversations/{conversation_id}/notebook")
    assert notebook.status_code == 200
    notebook_payload = notebook.json()
    notebook_update = client.put(
        f"/api/conversations/{conversation_id}/notebook",
        json={
            "id": notebook_payload["id"],
            "title": "精选笔记",
            "base_revision": notebook_payload["revision"],
            "blocks": [
                {"id": str(uuid.uuid4()), "type": "annotation_reference", "annotation_id": annotation["id"]},
                {"id": str(uuid.uuid4()), "type": "markdown", "markdown": "说明"},
            ],
        },
    )
    assert notebook_update.status_code == 200
    assert notebook_update.json()["revision"] == 2

    notebook_conflict = client.put(
        f"/api/conversations/{conversation_id}/notebook",
        json={"base_revision": 1, "blocks": []},
    )
    assert notebook_conflict.status_code == 409
    sync_conflict = client.post(
        "/api/annotations/sync",
        json={
            "operations": [
                {
                    "operation_id": str(uuid.uuid4()),
                    "entity_type": "notebook",
                    "entity_id": notebook_payload["id"],
                    "action": "upsert",
                    "conversation_id": conversation_id,
                    "base_revision": 1,
                    "payload": {"title": "离线副本", "blocks": []},
                }
            ]
        },
    )
    assert sync_conflict.status_code == 200
    assert sync_conflict.json()["results"][0]["status"] == "conflict"
    conflicts = client.get(f"/api/conversations/{conversation_id}/notebook/conflicts")
    assert conflicts.status_code == 200
    assert conflicts.json()[0]["is_conflict"] is True

    description = client.patch(
        f"/api/conversations/{conversation_id}",
        json={"description_markdown": "**私有摘要**"},
    )
    assert description.status_code == 200
    assert description.json()["description_markdown"] == "**私有摘要**"

    private_share = client.post(f"/api/conversations/{conversation_id}/shares", json={}).json()
    private_bootstrap = client.get(f"/api/shared/{private_share['token']}").json()
    assert private_bootstrap["description_markdown"] is None
    assert private_bootstrap["capabilities"]["annotations"] is False
    assert client.get(f"/api/shared/{private_share['token']}/annotations").json() == []
    assert client.get(f"/api/shared/{private_share['token']}/notebook").json() is None

    opted_share = client.post(
        f"/api/conversations/{conversation_id}/shares",
        json={"include_description": True, "include_annotations": True, "include_notebook": True},
    ).json()
    opted_bootstrap = client.get(f"/api/shared/{opted_share['token']}").json()
    assert opted_bootstrap["description_markdown"] == "**私有摘要**"
    assert len(client.get(f"/api/shared/{opted_share['token']}/annotations").json()) >= 1
    assert client.get(f"/api/shared/{opted_share['token']}/notebook").json()["title"] == "精选笔记"

    default_export = client.get(f"/api/conversations/{conversation_id}/export?format=canonical_json").json()
    assert "description_markdown" not in default_export["conversation"]
    opted_export = client.get(
        f"/api/conversations/{conversation_id}/export?format=canonical_json&include_description=true&include_annotations=true&include_notebook=true"
    ).json()
    assert opted_export["conversation"]["description_markdown"] == "**私有摘要**"
    assert len(opted_export["annotations"]) >= 1
    assert opted_export["notebook"]["title"] == "精选笔记"


def test_annotation_anchor_relocates_and_marks_stale_after_message_edits(client: TestClient) -> None:
    conversation_id, message, version = _message_context(client)
    created = client.post(
        f"/api/conversations/{conversation_id}/annotations",
        json={
            "message_id": message["id"],
            "message_version_id": version["id"],
            "annotation_type": "highlight",
            "color": "green",
            "start_block_index": 0,
            "start_offset": 0,
            "end_block_index": 0,
            "end_offset": 8,
            "quote": "Original",
            "suffix": " user",
        },
    ).json()

    relocated = client.patch(
        f"/api/messages/{message['id']}",
        json={"display_text": "Prefix Original user question"},
    )
    assert relocated.status_code == 200
    annotation = client.get(f"/api/conversations/{conversation_id}/annotations").json()[0]
    assert annotation["anchor_status"] == "relocated"
    assert annotation["message_version_id"] == relocated.json()["current_version_id"]
    assert annotation["start_offset"] == 7

    removed = client.patch(
        f"/api/messages/{message['id']}",
        json={"display_text": "The quoted text was removed"},
    )
    assert removed.status_code == 200
    annotation = client.get(f"/api/conversations/{conversation_id}/annotations").json()[0]
    assert annotation["anchor_status"] == "stale"
    assert annotation["message_version_id"] != removed.json()["current_version_id"]


def test_cr_v2_optional_private_entries_round_trip(client: TestClient) -> None:
    conversation_id, message, _ = _message_context(client)
    client.patch(f"/api/conversations/{conversation_id}", json={"description_markdown": "private description"})
    annotation = client.post(
        f"/api/conversations/{conversation_id}/annotations",
        json={"message_id": message["id"], "annotation_type": "bookmark", "color": "pink", "comment_markdown": "private note"},
    ).json()
    notebook = client.get(f"/api/conversations/{conversation_id}/notebook").json()
    client.put(
        f"/api/conversations/{conversation_id}/notebook",
        json={
            "id": notebook["id"],
            "base_revision": notebook["revision"],
            "blocks": [{"id": str(uuid.uuid4()), "type": "annotation_reference", "annotation_id": annotation["id"]}],
        },
    )
    queued = client.post(
        f"/api/conversations/{conversation_id}/exports?include_description=true&include_annotations=true&include_notebook=true",
        headers={"Idempotency-Key": "cr-v2-private"},
    )
    assert queued.status_code == 202
    _run_job(queued.json()["job_id"])
    task = client.get(f"/api/tasks/{queued.json()['job_id']}").json()
    archive = client.get(task["result"]["download_url"])
    assert archive.status_code == 200
    with zipfile.ZipFile(io.BytesIO(archive.content)) as bundle:
        manifest = json.loads(bundle.read("manifest.json"))
        assert manifest["version"] == 2
        assert {"annotations.jsonl", "notebook.json"}.issubset(bundle.namelist())
        assert json.loads(bundle.read("conversation.json"))["description_markdown"] == "private description"

    preview = client.post(
        "/api/imports/preview",
        files={"files": ("private.cr", archive.content, "application/vnd.chat-reader.archive+zip")},
    )
    assert preview.status_code == 200
    committed = client.post(f"/api/imports/{preview.json()['import_id']}/commit")
    assert committed.status_code == 200
    imported_id = committed.json()["conversation_ids"][0]
    assert client.get(f"/api/conversations/{imported_id}").json()["description_markdown"] == "private description"
    assert client.get(f"/api/conversations/{imported_id}/annotations").json()[0]["comment_markdown"] == "private note"
    assert len(client.get(f"/api/conversations/{imported_id}/notebook").json()["blocks"]) == 1


def test_offline_catalog_and_package_are_downloadable(client: TestClient, monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("OFFLINE_STORAGE_DIR", str(tmp_path / "offline"))
    get_settings.cache_clear()
    conversation_id, _, _ = _message_context(client)

    catalog = client.get("/api/offline/catalog")
    assert catalog.status_code == 200
    catalog_payload = catalog.json()
    item = next(item for item in catalog_payload["conversations"] if item["id"] == conversation_id)
    assert item["estimated_bytes"] > 0
    assert catalog_payload["revision"]

    queued = client.post(
        "/api/offline/packages",
        json={"scope": "conversation", "conversation_id": conversation_id},
        headers={"Idempotency-Key": "offline-test-package"},
    )
    assert queued.status_code == 202
    _run_job(queued.json()["job_id"])

    task = client.get(f"/api/tasks/{queued.json()['job_id']}")
    assert task.status_code == 200
    assert task.json()["status"] == "committed"
    package_id = queued.json()["package_id"]
    metadata = client.get(f"/api/offline/packages/{package_id}")
    assert metadata.status_code == 200
    assert metadata.json()["conversation_count"] == 1

    archive = client.get(f"/api/offline/packages/{package_id}/download")
    assert archive.status_code == 200
    assert archive.content.startswith(b"PK")
    assert Path(metadata.json()["filename"]).name == metadata.json()["filename"]
    with zipfile.ZipFile(io.BytesIO(archive.content)) as bundle:
        payload = json.loads(bundle.read("package.json"))
    assert payload["format"] == "chat-reader-offline-package"
    assert payload["version"] == 1
    assert len(payload["conversations"]) == 1
    packaged_conversation = payload["conversations"][0]
    assert packaged_conversation["id"] == conversation_id
    assert packaged_conversation["messages"]
    assert packaged_conversation["messages"][0]["current_version"]
    assert packaged_conversation["messages"][0]["render_blocks"]
