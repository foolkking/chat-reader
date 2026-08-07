import json
import uuid

from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app.core.database import get_db
from app.main import app
from app.models.conversation_event import ConversationEvent
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.services.background_jobs import claim_next_job, process_background_job
from app.services.import_pipeline.canonical_draft import NORMALIZER_VERSION
from test_import_preview_api import client  # noqa: F401


def _commit_source(client: TestClient) -> str:
    preview = client.post(
        "/api/imports/preview",
        files={
            "files": (
                "archive-source.json",
                json.dumps(
                    {
                        "metadata": {"title": "Archive Source", "powered_by": "ChatGPT Exporter"},
                        "messages": [
                            {"role": "Prompt", "say": "archive question"},
                            {"role": "Response", "say": "# Archive heading\n\narchive answer\n\n```ts\nconst ok = true\n```"},
                        ],
                    }
                ).encode(),
                "application/json",
            )
        },
    )
    commit = client.post(f"/api/imports/{preview.json()['import_id']}/commit")
    assert commit.status_code == 200
    return commit.json()["conversation_ids"][0]


def _run_job(job_id: str) -> None:
    override = app.dependency_overrides[get_db]
    override_generator = override()
    fixture_db = next(override_generator)
    testing_session_local = sessionmaker(bind=fixture_db.get_bind(), autoflush=False, autocommit=False)
    fixture_db.close()
    override_generator.close()
    target_id = uuid.UUID(job_id)
    for _ in range(10):
        with testing_session_local() as db:
            claimed = claim_next_job(db)
            assert claimed is not None
            db.commit()
        process_background_job(claimed, testing_session_local)
        if claimed == target_id:
            return
    raise AssertionError(f"Target background job was not claimed: {target_id}")


def test_cr_archive_export_import_round_trip_and_duplicate_policies(client: TestClient) -> None:
    source_id = _commit_source(client)
    queued = client.post(
        f"/api/conversations/{source_id}/exports",
        headers={"Idempotency-Key": "archive-round-trip"},
    )
    assert queued.status_code == 202
    _run_job(queued.json()["job_id"])

    task = client.get(f"/api/tasks/{queued.json()['job_id']}").json()
    assert task["status"] == "committed"
    archive = client.get(task["result"]["download_url"])
    assert archive.status_code == 200
    assert archive.content.startswith(b"PK")

    preview = client.post(
        "/api/imports/preview",
        files={"files": ("archive.cr", archive.content, "application/vnd.chat-reader.archive+zip")},
    )
    assert preview.status_code == 200
    preview_payload = preview.json()
    assert preview_payload["archive_summary"]["message_count"] == 2
    assert preview_payload["compatibility"] == "compatible"

    committed = client.post(f"/api/imports/{preview_payload['import_id']}/commit")
    assert committed.status_code == 200
    imported_id = committed.json()["conversation_ids"][0]
    assert imported_id != source_id

    window = client.get(f"/api/conversations/{imported_id}/message-window?include_blocks=true").json()
    assert [item["role"] for item in window["items"]] == ["user", "assistant"]
    assert any(block["block_type"] == "code" for block in window["items"][1]["render_blocks"])
    toc = client.get(f"/api/conversations/{imported_id}/toc").json()
    assert [item["text"] for item in toc["items"]] == ["Archive heading"]
    search = client.get("/api/search", params={"q": "archive answer", "conversation_id": imported_id}).json()
    assert search["total"] >= 1

    duplicate = client.post(
        "/api/imports/preview",
        files={"files": ("archive.cr", archive.content, "application/vnd.chat-reader.archive+zip")},
    ).json()
    assert duplicate["duplicate_conversation_id"] == imported_id
    cloned = client.post(f"/api/imports/{duplicate['import_id']}/commit")
    assert cloned.status_code == 200
    assert cloned.json()["conversation_ids"][0] != imported_id

    reject_preview = client.post(
        "/api/imports/preview",
        files={"files": ("archive.cr", archive.content, "application/vnd.chat-reader.archive+zip")},
    ).json()
    rejected = client.post(
        f"/api/imports/{reject_preview['import_id']}/commit",
        json={"duplicate_policy": "reject"},
    )
    assert rejected.status_code == 409

    copy_preview = client.post(
        "/api/imports/preview",
        files={"files": ("archive.cr", archive.content, "application/vnd.chat-reader.archive+zip")},
    ).json()
    copied = client.post(
        f"/api/imports/{copy_preview['import_id']}/commit",
        json={"duplicate_policy": "copy"},
    )
    assert copied.status_code == 200
    assert copied.json()["conversation_ids"][0] not in {imported_id, cloned.json()["conversation_ids"][0]}


def test_auto_clean_job_creates_new_version_and_preserves_history(client: TestClient) -> None:
    conversation_id = _commit_source(client)
    window = client.get(f"/api/conversations/{conversation_id}/message-window").json()
    assistant = window["items"][1]
    edited = client.patch(
        f"/api/messages/{assistant['id']}",
        json={
            "display_text": "搜索 TypeScript 文档\n- https://example.com/docs\n思考了 7s\n\n# Final\n\nKept answer",
            "base_version_id": assistant["current_version"]["id"],
        },
    )
    assert edited.status_code == 200

    queued = client.post(
        f"/api/conversations/{conversation_id}/auto-clean",
        headers={"Idempotency-Key": "auto-clean-test"},
    )
    assert queued.status_code == 202
    _run_job(queued.json()["job_id"])
    task = client.get(f"/api/tasks/{queued.json()['job_id']}").json()
    assert task["status"] == "committed"
    assert task["result"]["cleaned_messages"] == 1

    refreshed = client.get(f"/api/conversations/{conversation_id}/message-window").json()["items"][1]
    assert refreshed["current_version"]["display_text"].startswith("# Final")
    versions = client.get(f"/api/messages/{assistant['id']}/versions").json()
    assert len(versions["items"]) == 3
    assert versions["items"][0]["edit_type"] == "auto_clean"


def test_derived_rebuild_job_upgrades_legacy_versions_without_migration_rewrite(client: TestClient) -> None:
    conversation_id = _commit_source(client)
    override = app.dependency_overrides[get_db]
    override_generator = override()
    db = next(override_generator)
    try:
        versions = (
            db.query(MessageVersion)
            .join(Message, Message.id == MessageVersion.message_id)
            .filter(Message.conversation_id == uuid.UUID(conversation_id))
            .all()
        )
        for version in versions:
            version.normalizer_version = "legacy-v1"
            version.markdown_parser_version = "legacy-v1"
            version.block_builder_version = "legacy-v1"
            version.search_document_version = "legacy-v1"
            version.content_hash = "legacy-hash"
        db.commit()
    finally:
        db.close()
        override_generator.close()

    queued = client.post(
        f"/api/conversations/{conversation_id}/derived-rebuild",
        headers={"Idempotency-Key": "derived-rebuild-test"},
    )
    assert queued.status_code == 202
    _run_job(queued.json()["job_id"])
    task = client.get(f"/api/tasks/{queued.json()['job_id']}").json()
    assert task["status"] == "committed"
    assert task["result"]["rebuilt_versions"] == 2

    override_generator = override()
    db = next(override_generator)
    try:
        versions = (
            db.query(MessageVersion)
            .join(Message, Message.id == MessageVersion.message_id)
            .filter(Message.conversation_id == uuid.UUID(conversation_id))
            .all()
        )
        assert all(version.normalizer_version == NORMALIZER_VERSION for version in versions)
        assert all(version.content_hash != "legacy-hash" for version in versions)
        event = (
            db.query(ConversationEvent)
            .filter(
                ConversationEvent.conversation_id == uuid.UUID(conversation_id),
                ConversationEvent.event_type == "derived_data_rebuilt",
            )
            .one()
        )
        assert event.payload["rebuilt_versions"] == 2
    finally:
        db.close()
        override_generator.close()
