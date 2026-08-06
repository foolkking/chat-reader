import io
import json
import os
import uuid
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy.orm import sessionmaker

from app.core.config import get_settings
from app.core.database import get_db
from app.main import app
from app.models.attachment import Attachment, AssetObject, MessageVersionAttachment
from app.models.import_record import ImportRecord
from app.models.background_job import BackgroundJob
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.render_block import RenderBlock
from app.services.background_jobs import claim_next_job, process_background_job
from test_import_preview_api import client  # noqa: F401
from test_message_editing_api import commit_edit_sample


def _process_task(task_id: str) -> None:
    override = app.dependency_overrides[get_db]
    generator = override()
    db = next(generator)
    try:
        factory = sessionmaker(bind=db.get_bind(), autoflush=False, autocommit=False)
    finally:
        db.close()
        generator.close()
    with factory() as claim_db:
        claimed_id = claim_next_job(claim_db)
        claim_db.commit()
    assert claimed_id == uuid.UUID(task_id)
    process_background_job(claimed_id, session_factory=factory)


def _bundle_bytes(*, filename: str = "evidence.txt", content: bytes = b"attachment body\n") -> bytes:
    message_id = str(uuid.uuid4())
    version_id = str(uuid.uuid4())
    import hashlib

    canonical = [
        {
            "record_type": "manifest",
            "format": "chat-reader-canonical-jsonl",
            "version": 2,
            "conversation": {"id": str(uuid.uuid4()), "title": "Attachment bundle"},
            "selection": {"message_count": 1},
        },
        {
            "record_type": "message",
            "id": message_id,
            "seq": 1,
            "order_key": "000001",
            "role": "assistant",
            "current_version": {
                "id": version_id,
                "number": 1,
                "content_markdown": f"[{filename}](cr-asset://attachment-1)",
            },
        },
        {"record_type": "end", "record_count": 3, "message_count": 1},
    ]
    attachment_records = [
        {
            "record_type": "asset_object",
            "id": "object-1",
            "path": "assets/objects/object-1",
            "sha256": hashlib.sha256(content).hexdigest(),
            "byte_size": len(content),
            "filename": filename,
            "declared_mime_type": "text/plain",
        },
        {
            "record_type": "attachment",
            "id": "attachment-1",
            "asset_object_id": "object-1",
            "original_filename": filename,
            "display_name": filename,
            "declared_mime_type": "text/plain",
        },
        {
            "record_type": "attachment_ref",
            "attachment_id": "attachment-1",
            "message_id": message_id,
            "message_version_id": version_id,
            "relation_type": "file",
            "display_order": 0,
            "display_mode": "card",
        },
    ]
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", json.dumps({
            "format": "chat-reader-attachment-bundle",
            "version": 1,
            "conversation_path": "conversation.canonical.jsonl",
            "attachments_path": "attachments.jsonl",
        }))
        archive.writestr("conversation.canonical.jsonl", "\n".join(json.dumps(item) for item in canonical) + "\n")
        archive.writestr("attachments.jsonl", "\n".join(json.dumps(item) for item in attachment_records) + "\n")
        archive.writestr("assets/objects/object-1", content)
    return output.getvalue()


def _real_fixture_bytes() -> bytes:
    configured = os.environ.get("CHAT_READER_E2E_FIXTURE_DIR")
    if not configured:
        import pytest

        pytest.skip("CHAT_READER_E2E_FIXTURE_DIR is not configured")
    root = Path(configured)
    if not (root / "manifest.json").is_file():
        root = root / "chat-reader-attachment-demo.cr-import"
    if not (root / "manifest.json").is_file():
        import pytest

        pytest.skip("The attachment E2E fixture is unavailable")
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(root.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(root).as_posix())
    return output.getvalue()


def _import_attachment_bundle(client, *, bundle: bytes, filename: str) -> str:
    preview = client.post(
        "/api/imports/bundles/preview",
        files={"file": (filename, bundle, "application/vnd.chat-reader.bundle+zip")},
    )
    assert preview.status_code == 202, preview.text
    accepted = preview.json()
    _process_task(accepted["task_id"])
    commit = client.post(f"/api/imports/{accepted['import_id']}/commit")
    assert commit.status_code == 200, commit.text
    return commit.json()["conversation_ids"][0]


def test_real_attachment_fixture_import_contract(client, tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("ASSET_STORAGE_DIR", str(tmp_path / "storage" / "assets"))
    monkeypatch.setenv("OFFLINE_STORAGE_DIR", str(tmp_path / "storage" / "offline"))
    monkeypatch.setenv("ATTACHMENT_SCANNER", "disabled")
    monkeypatch.setenv("ALLOW_UNSCANNED_ATTACHMENTS", "true")
    get_settings.cache_clear()
    response = client.post(
        "/api/imports/bundles/preview",
        files={"file": ("attachment-demo.crbundle", _real_fixture_bytes(), "application/vnd.chat-reader.bundle+zip")},
    )
    assert response.status_code == 202, response.text
    accepted = response.json()
    _process_task(accepted["task_id"])
    task = client.get(accepted["status_url"])
    assert task.status_code == 200
    assert task.json()["status"] == "committed", task.text
    preview = client.get(accepted["preview_url"])
    assert preview.status_code == 200, preview.text
    summary = preview.json()["archive_summary"]
    assert summary["attachment_count"] == 20
    assert summary["object_count"] == 18

    commit = client.post(f"/api/imports/{accepted['import_id']}/commit")
    assert commit.status_code == 200, commit.text
    conversation_id = uuid.UUID(commit.json()["conversation_ids"][0])
    override = app.dependency_overrides[get_db]
    generator = override()
    db = next(generator)
    try:
        attachments = db.query(Attachment).filter(Attachment.conversation_id == conversation_id).all()
        attachment_by_id = {item.id: item for item in attachments}
        attachment_ids = [item.id for item in attachments]
        links = db.query(MessageVersionAttachment).filter(
            MessageVersionAttachment.attachment_id.in_(attachment_ids)
        ).all()
        assert len(attachments) == 20
        assert len(links) == 21
        assert db.query(AssetObject).count() == 18
        assert sum(item.resolution_status == "missing" for item in attachments) == 1
        assert sum(item.scan_status == "scanner_disabled" for item in attachments) == 19
        assert sum(item.scan_status == "not_available" for item in attachments) == 1
        assert sum(link.placement == "inline" for link in links) == 20
        assert sum(link.placement == "after_message" for link in links) == 1
        linked_ids = {link.attachment_id for link in links}
        assert sum(item.id not in linked_ids for item in attachments) == 1
        object_groups: dict[uuid.UUID, int] = {}
        for attachment in attachments:
            if attachment.asset_object_id:
                object_groups[attachment.asset_object_id] = object_groups.get(attachment.asset_object_id, 0) + 1
        assert sorted(object_groups.values(), reverse=True)[0] == 2
        message_by_version_id = {
            message.current_version_id: message
            for message in db.query(Message).filter(Message.conversation_id == conversation_id).all()
        }
        linked_message_ids_by_attachment: dict[uuid.UUID, set[uuid.UUID]] = {}
        for link in links:
            linked_message_ids_by_attachment.setdefault(link.attachment_id, set()).add(
                message_by_version_id[link.message_version_id].id
            )
        scoped_attachment_id, scoped_message_ids = next(
            (attachment_id, message_ids)
            for attachment_id, message_ids in linked_message_ids_by_attachment.items()
            if len(message_ids) == 1 and attachment_by_id[attachment_id].scan_status == "scanner_disabled"
        )
        linked_message = db.get(Message, next(iter(scoped_message_ids)))
        assert linked_message is not None
        other_message = db.query(Message).filter(
            Message.conversation_id == conversation_id,
            Message.id != linked_message.id,
        ).first()
        assert other_message is not None
        linked_message_id = linked_message.id
        other_message_id = other_message.id
    finally:
        db.close()
        generator.close()

    context_job = client.post(
        f"/api/conversations/{conversation_id}/exports",
        json={"format": "canjson_bundle"},
        headers={"Idempotency-Key": "real-fixture-context-export"},
    )
    assert context_job.status_code == 202, context_job.text
    _process_task(context_job.json()["job_id"])
    context_task = client.get(f"/api/tasks/{context_job.json()['job_id']}").json()
    context_response = client.get(context_task["result"]["download_url"])
    with zipfile.ZipFile(io.BytesIO(context_response.content)) as package:
        manifest = json.loads(package.read("manifest.json"))
        assert manifest["format"] == "chat-reader-context-package"
        assert manifest["attachments"]["record_count"] == 20
        assert manifest["attachments"]["reference_count"] == 21
        assert manifest["attachments"]["resolved_attachment_count"] == 19
        assert manifest["attachments"]["physical_object_count"] == 18
        assert manifest["attachments"]["available_object_count"] == 18
        assert manifest["attachments"]["missing_object_count"] == 1
        assert manifest["conversation_completeness"] == "complete"
        assert manifest["asset_completeness"] == "partial"
        assert len([name for name in package.namelist() if name.startswith("assets/objects/")]) == 18

    markdown_job = client.post(
        f"/api/conversations/{conversation_id}/exports",
        json={"format": "markdown_bundle"},
        headers={"Idempotency-Key": "real-fixture-markdown-export"},
    )
    assert markdown_job.status_code == 202, markdown_job.text
    _process_task(markdown_job.json()["job_id"])
    markdown_task = client.get(f"/api/tasks/{markdown_job.json()['job_id']}").json()
    markdown_response = client.get(markdown_task["result"]["download_url"])
    with zipfile.ZipFile(io.BytesIO(markdown_response.content)) as package:
        names = package.namelist()
        assert "conversation.md" in names
        assert "manifest.json" not in names
        assert len([name for name in names if name.startswith("attachments/")]) == 19
        assert b"cr-asset://" not in package.read("conversation.md")

    canjson = client.get(f"/api/conversations/{conversation_id}/exports/canjson")
    assert canjson.status_code == 200, canjson.text
    canjson_records = [json.loads(line) for line in canjson.content.splitlines()]
    metadata_attachments = [item for item in canjson_records if item.get("record_type") == "attachment"]
    metadata_refs = [item for item in canjson_records if item.get("record_type") == "attachment_ref"]
    assert len(metadata_attachments) == 20
    assert len(metadata_refs) == 21
    assert sum(item["resolution_status"] == "not_included" for item in metadata_attachments) == 19
    assert all("storage_key" not in item and "content_url" not in item for item in metadata_attachments)

    markdown = client.get(f"/api/conversations/{conversation_id}/exports/markdown")
    assert markdown.status_code == 200, markdown.text
    assert "cr-asset://" not in markdown.text
    assert "file not included in this export" in markdown.text

    excluded_share = client.post(
        f"/api/conversations/{conversation_id}/shares",
        json={"scope": "selected_messages", "selected_message_ids": [str(other_message_id)]},
    )
    assert excluded_share.status_code == 200, excluded_share.text
    denied = client.get(
        f"/api/shared/{excluded_share.json()['token']}/attachments/{scoped_attachment_id}"
    )
    assert denied.status_code == 404

    included_share = client.post(
        f"/api/conversations/{conversation_id}/shares",
        json={"scope": "selected_messages", "selected_message_ids": [str(linked_message_id)]},
    )
    assert included_share.status_code == 200, included_share.text
    allowed = client.get(
        f"/api/shared/{included_share.json()['token']}/attachments/{scoped_attachment_id}"
    )
    assert allowed.status_code == 200, allowed.text
    assert allowed.json()["scan_status"] == "scanner_disabled"

    offline_job = client.post(
        "/api/offline/packages",
        json={"scope": "conversation", "conversation_id": str(conversation_id), "asset_mode": "all"},
        headers={"Idempotency-Key": "real-fixture-offline-v3"},
    )
    assert offline_job.status_code == 202, offline_job.text
    _process_task(offline_job.json()["job_id"])
    offline_task = client.get(f"/api/tasks/{offline_job.json()['job_id']}").json()
    assert offline_task["status"] == "committed", offline_task
    offline_response = client.get(offline_task["result"]["download_url"])
    assert offline_response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(offline_response.content)) as package:
        payload = json.loads(package.read("package.json"))
        assert payload["version"] == 3
        assert payload["asset_mode"] == "all"
        offline_attachments = payload["conversations"][0]["attachments"]
        assert len(offline_attachments) == 20
        assert sum(len(item["occurrences"]) for item in offline_attachments) == 21
        assert sum(item["resolution_status"] == "missing" for item in offline_attachments) == 1
        assert sum(item["scan_status"] == "scanner_disabled" for item in offline_attachments) == 19
        assert len([name for name in package.namelist() if name.startswith("assets/objects/")]) == 18


def test_bundle_preview_commit_and_range_content(client, tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("ASSET_STORAGE_DIR", str(tmp_path / "storage" / "assets"))
    monkeypatch.setenv("ASSET_SCAN_REQUIRED", "false")
    get_settings.cache_clear()
    response = client.post(
        "/api/imports/bundles/preview",
        files={"file": ("sample.crbundle", _bundle_bytes(), "application/vnd.chat-reader.bundle+zip")},
    )
    assert response.status_code == 202, response.text
    accepted = response.json()

    _process_task(accepted["task_id"])

    task = client.get(accepted["status_url"])
    assert task.status_code == 200
    assert task.json()["status"] == "committed"
    preview = client.get(accepted["preview_url"])
    assert preview.status_code == 200, preview.text
    assert preview.json()["can_commit"] is True

    commit = client.post(f"/api/imports/{accepted['import_id']}/commit")
    assert commit.status_code == 200, commit.text
    conversation_id = commit.json()["conversation_ids"][0]

    override = app.dependency_overrides[get_db]
    generator = override()
    db = next(generator)
    try:
        attachment = db.query(Attachment).one()
        link = db.query(MessageVersionAttachment).one()
        message = db.query(Message).filter(Message.conversation_id == uuid.UUID(conversation_id)).one()
        block = db.query(RenderBlock).filter(RenderBlock.message_version_id == link.message_version_id).one()
        assert str(block.data["attachmentId"]) == str(attachment.id)
        assert message.current_version_id == link.message_version_id
        attachment_id = str(attachment.id)
    finally:
        db.close()
        generator.close()

    metadata = client.get(f"/api/attachments/{attachment_id}")
    assert metadata.status_code == 200
    assert metadata.json()["display_name"] == "evidence.txt"
    partial = client.get(f"/api/attachments/{attachment_id}/content", headers={"Range": "bytes=0-9"})
    assert partial.status_code == 206
    assert partial.content == b"attachment"
    assert partial.headers["content-range"].startswith("bytes 0-9/")

    derivative_job = client.post(
        f"/api/attachments/{attachment_id}/derivatives/text_extract",
        headers={"Idempotency-Key": "attachment-text-extract"},
    )
    assert derivative_job.status_code == 202, derivative_job.text
    _process_task(derivative_job.json()["job_id"])
    derivative_task = client.get(f"/api/tasks/{derivative_job.json()['job_id']}").json()
    assert derivative_task["status"] == "committed"
    derivative_content = client.get(f"/api/attachments/{attachment_id}/derivatives/text_extract/content")
    assert derivative_content.status_code == 200
    assert derivative_content.content == b"attachment body\n"
    search_result = client.get(
        "/api/search",
        params={"q": "attachment body", "conversation_id": conversation_id, "document_type": "attachment"},
    )
    assert search_result.status_code == 200, search_result.text
    assert search_result.json()["total"] == 1

    share = client.post(
        f"/api/conversations/{conversation_id}/shares",
        json={"scope": "selected_messages", "selected_message_ids": [str(message.id)]},
    )
    assert share.status_code == 200, share.text
    share_token = share.json()["token"]
    shared_metadata = client.get(f"/api/shared/{share_token}/attachments/{attachment_id}")
    assert shared_metadata.status_code == 200, shared_metadata.text
    assert shared_metadata.json()["content_url"].startswith(f"/api/shared/{share_token}/attachments/")
    shared_content = client.get(
        f"/api/shared/{share_token}/attachments/{attachment_id}/content",
        headers={"Range": "bytes=-5"},
    )
    assert shared_content.status_code == 206
    assert shared_content.content == b"body\n"

    queued = client.post(
        f"/api/conversations/{conversation_id}/exports",
        json={"format": "context_package", "context_scope": "full_conversation"},
        headers={"Idempotency-Key": "attachment-context-package"},
    )
    assert queued.status_code == 202, queued.text
    _process_task(queued.json()["job_id"])
    task_payload = client.get(f"/api/tasks/{queued.json()['job_id']}").json()
    assert task_payload["status"] == "committed"
    exported = client.get(task_payload["result"]["download_url"])
    assert exported.status_code == 200
    assert task_payload["result"]["filename"].endswith(".context.zip")
    with zipfile.ZipFile(io.BytesIO(exported.content)) as package:
        names = set(package.namelist())
        assert {"manifest.json", "conversation.canjsonl"}.issubset(names)
        manifest = json.loads(package.read("manifest.json"))
        assert manifest["format"] == "chat-reader-context-package"
        assert manifest["scope"]["current_versions_only"] is True
        assert manifest["assets"]["available_objects"] == 1
        assert not names.intersection({"state.json", "headings.jsonl", "blocks.jsonl", "versions.jsonl"})
        records = [json.loads(line) for line in package.read("conversation.canjsonl").splitlines()]
        attachment_record = next(item for item in records if item["record_type"] == "attachment")
        assert attachment_record["object"]["path"] in names
        assert attachment_record["object"]["path"].startswith(
            f"assets/objects/{attachment_record['object']['sha256'][:2]}/"
        )
        message_record = next(item for item in records if item["record_type"] == "message")
        assert message_record["attachment_refs"][0]["attachment_id"] == attachment_record["id"]

    for bundle_format, entrypoint in (("markdown_bundle", "conversation.md"), ("canjson_bundle", "conversation.canjsonl")):
        bundle_job = client.post(
            f"/api/conversations/{conversation_id}/exports",
            json={"format": bundle_format},
            headers={"Idempotency-Key": f"{bundle_format}-attachment-test"},
        )
        assert bundle_job.status_code == 202, bundle_job.text
        _process_task(bundle_job.json()["job_id"])
        bundle_task = client.get(f"/api/tasks/{bundle_job.json()['job_id']}").json()
        assert bundle_task["status"] == "committed"
        bundle_response = client.get(bundle_task["result"]["download_url"])
        assert bundle_response.status_code == 200
        with zipfile.ZipFile(io.BytesIO(bundle_response.content)) as bundle:
            assert entrypoint in bundle.namelist()
            if bundle_format == "markdown_bundle":
                assert "manifest.json" not in bundle.namelist()
                assert "attachments/evidence.txt" in bundle.namelist()
                assert b"attachments/evidence.txt" in bundle.read(entrypoint)
                assert b"cr-asset://" not in bundle.read(entrypoint)
            else:
                bundle_manifest = json.loads(bundle.read("manifest.json"))
                assert bundle_manifest["format"] == "chat-reader-context-package"
                assert bundle_manifest["attachments"]["available_object_count"] == 1
                assert bundle_manifest["attachments"]["completeness"] == "complete"
                bundle_records = [json.loads(line) for line in bundle.read(entrypoint).splitlines()]
                bundle_attachment = next(item for item in bundle_records if item["record_type"] == "attachment")
                assert bundle_attachment["object"]["path"].startswith("assets/objects/")

    archive_job = client.post(
        f"/api/conversations/{conversation_id}/exports",
        headers={"Idempotency-Key": "attachment-cr-round-trip"},
    )
    assert archive_job.status_code == 202, archive_job.text
    _process_task(archive_job.json()["job_id"])
    archive_task = client.get(f"/api/tasks/{archive_job.json()['job_id']}").json()
    assert archive_task["status"] == "committed"
    archive = client.get(archive_task["result"]["download_url"])
    assert archive.status_code == 200
    with zipfile.ZipFile(io.BytesIO(archive.content)) as package:
        manifest = json.loads(package.read("manifest.json"))
        assert manifest["version"] == 3
        assert manifest["optional_entries"]["attachments"] is True
        assert {"attachments.jsonl", "attachment_refs.jsonl"}.issubset(package.namelist())

    archive_preview = client.post(
        "/api/imports/preview",
        files={"files": ("attachment-round-trip.cr", archive.content, "application/vnd.chat-reader.archive+zip")},
    )
    assert archive_preview.status_code == 200, archive_preview.text
    archive_commit = client.post(f"/api/imports/{archive_preview.json()['import_id']}/commit")
    assert archive_commit.status_code == 200, archive_commit.text
    cloned_conversation_id = uuid.UUID(archive_commit.json()["conversation_ids"][0])

    generator = override()
    db = next(generator)
    try:
        cloned_attachment = (
            db.query(Attachment)
            .join(MessageVersionAttachment, MessageVersionAttachment.attachment_id == Attachment.id)
            .join(Message, Message.current_version_id == MessageVersionAttachment.message_version_id)
            .filter(Message.conversation_id == cloned_conversation_id)
            .one()
        )
        cloned_attachment_id = str(cloned_attachment.id)
    finally:
        db.close()
        generator.close()
    cloned_content = client.get(f"/api/attachments/{cloned_attachment_id}/content")
    assert cloned_content.status_code == 200
    assert cloned_content.content == b"attachment body\n"


def test_conversation_split_clones_attachment_identity_and_occurrences(client, tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("ASSET_STORAGE_DIR", str(tmp_path / "storage" / "assets"))
    monkeypatch.setenv("ATTACHMENT_SCANNER", "disabled")
    monkeypatch.setenv("ALLOW_UNSCANNED_ATTACHMENTS", "true")
    get_settings.cache_clear()
    preview = client.post(
        "/api/imports/bundles/preview",
        files={"file": ("split.crbundle", _bundle_bytes(), "application/vnd.chat-reader.bundle+zip")},
    ).json()
    _process_task(preview["task_id"])
    commit = client.post(f"/api/imports/{preview['import_id']}/commit")
    assert commit.status_code == 200, commit.text
    source_conversation_id = uuid.UUID(commit.json()["conversation_ids"][0])

    override = app.dependency_overrides[get_db]
    generator = override()
    db = next(generator)
    try:
        source_attachment = db.query(Attachment).filter(
            Attachment.conversation_id == source_conversation_id
        ).one()
        source_message = db.query(Message).filter(Message.conversation_id == source_conversation_id).one()
        source_link = db.query(MessageVersionAttachment).filter(
            MessageVersionAttachment.message_version_id == source_message.current_version_id
        ).one()
        db.add(MessageVersionAttachment(
            id=uuid.uuid4(),
            message_version_id=source_message.current_version_id,
            attachment_id=source_attachment.id,
            occurrence_key="after-message-copy",
            placement="after_message",
            relation_type="file",
            display_order=2,
            block_index=None,
            display_mode="card",
            alt_text="After message",
            caption="Preserve this occurrence",
        ))
        source_attachment_id = source_attachment.id
        source_asset_id = source_attachment.asset_object_id
        source_message_id = source_message.id
        source_placement = source_link.placement
        source_text = db.get(MessageVersion, source_message.current_version_id).display_text
        db.commit()
    finally:
        db.close()
        generator.close()

    split = client.post(
        f"/api/conversations/{source_conversation_id}/split",
        json={"start_message_id": str(source_message_id), "end_message_id": str(source_message_id), "title": "Attachment split"},
    )
    assert split.status_code == 200, split.text
    target_conversation_id = uuid.UUID(split.json()["conversation_id"])

    generator = override()
    db = next(generator)
    try:
        target_attachment = db.query(Attachment).filter(
            Attachment.conversation_id == target_conversation_id
        ).one()
        target_message = db.query(Message).filter(Message.conversation_id == target_conversation_id).one()
        target_links = db.query(MessageVersionAttachment).filter(
            MessageVersionAttachment.message_version_id == target_message.current_version_id
        ).order_by(MessageVersionAttachment.display_order).all()
        assert target_attachment.id != source_attachment_id
        assert target_attachment.asset_object_id == source_asset_id
        target_version = db.get(MessageVersion, target_message.current_version_id)
        assert {link.placement for link in target_links} == {source_placement, "after_message"}
        assert any(link.occurrence_key == "after-message-copy" for link in target_links)
        assert f"cr-asset://{source_attachment_id}" in source_text
        assert f"cr-asset://{target_attachment.id}" in target_version.display_text
        assert f"cr-asset://{source_attachment_id}" not in target_version.display_text
        assert db.query(Attachment).filter(Attachment.conversation_id == source_conversation_id).count() == 1
    finally:
        db.close()
        generator.close()


def test_conversation_merge_clones_attachment_identity_and_occurrences(client, tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("ASSET_STORAGE_DIR", str(tmp_path / "storage" / "assets"))
    monkeypatch.setenv("ATTACHMENT_SCANNER", "disabled")
    monkeypatch.setenv("ALLOW_UNSCANNED_ATTACHMENTS", "true")
    get_settings.cache_clear()

    bundle = _bundle_bytes(filename="shared-evidence.txt", content=b"shared object\n")
    first_id = _import_attachment_bundle(client, bundle=bundle, filename="first.crbundle")
    second_id = _import_attachment_bundle(client, bundle=bundle, filename="second.crbundle")
    queued = client.post(
        "/api/conversations/merge",
        json={"conversation_ids": [first_id, second_id], "title": "Attachment merge"},
    )
    assert queued.status_code == 202, queued.text
    _process_task(queued.json()["job_id"])
    task = client.get(f"/api/tasks/{queued.json()['job_id']}").json()
    assert task["status"] == "committed", task
    merged_id = uuid.UUID(task["result"]["conversation_id"])

    override = app.dependency_overrides[get_db]
    generator = override()
    db = next(generator)
    try:
        source_ids = {uuid.UUID(first_id), uuid.UUID(second_id)}
        source_attachments = db.query(Attachment).filter(Attachment.conversation_id.in_(source_ids)).all()
        merged_attachments = db.query(Attachment).filter(Attachment.conversation_id == merged_id).all()
        source_attachment_ids = {item.id for item in source_attachments}
        merged_attachment_ids = {item.id for item in merged_attachments}
        merged_links = db.query(MessageVersionAttachment).filter(
            MessageVersionAttachment.attachment_id.in_(merged_attachment_ids)
        ).all()
        merged_versions = (
            db.query(MessageVersion)
            .join(Message, Message.id == MessageVersion.message_id)
            .filter(Message.conversation_id == merged_id)
            .all()
        )

        assert len(source_attachments) == 2
        assert len(merged_attachments) == 2
        assert merged_attachment_ids.isdisjoint(source_attachment_ids)
        assert {item.asset_object_id for item in merged_attachments} == {
            item.asset_object_id for item in source_attachments
        }
        assert len(merged_links) == 2
        assert all(link.attachment_id in merged_attachment_ids for link in merged_links)
        source_links = db.query(MessageVersionAttachment).filter(
            MessageVersionAttachment.attachment_id.in_(source_attachment_ids)
        ).all()
        assert sorted(link.occurrence_key for link in merged_links) == sorted(
            link.occurrence_key for link in source_links
        )
        assert all(
            not any(str(source_id) in version.display_text for source_id in source_attachment_ids)
            for version in merged_versions
        )
        assert all(
            any(str(target.id) in version.display_text for target in merged_attachments)
            for version in merged_versions
        )
        assert len(source_links) == 2
    finally:
        db.close()
        generator.close()


def test_exports_do_not_run_content_secret_scanning_when_scanner_is_disabled(client, tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("ASSET_STORAGE_DIR", str(tmp_path / "storage" / "assets"))
    monkeypatch.setenv("ASSET_SCAN_REQUIRED", "false")
    get_settings.cache_clear()
    preview = client.post(
        "/api/imports/bundles/preview",
        files={
            "file": (
                "sensitive.crbundle",
                _bundle_bytes(filename=".env", content=b"API_KEY=abcdefghijklmnopqrstuvwxyz123456\n"),
                "application/vnd.chat-reader.bundle+zip",
            )
        },
    ).json()
    _process_task(preview["task_id"])
    commit = client.post(f"/api/imports/{preview['import_id']}/commit")
    assert commit.status_code == 200, commit.text
    conversation_id = commit.json()["conversation_ids"][0]

    queued = client.post(
        f"/api/conversations/{conversation_id}/exports",
        json={"format": "context_package", "context_scope": "full_conversation"},
        headers={"Idempotency-Key": "sensitive-context-package"},
    ).json()
    _process_task(queued["job_id"])
    task_payload = client.get(f"/api/tasks/{queued['job_id']}").json()
    exported = client.get(task_payload["result"]["download_url"])
    with zipfile.ZipFile(io.BytesIO(exported.content)) as package:
        manifest = json.loads(package.read("manifest.json"))
        assert manifest["assets"]["excluded_sensitive_objects"] == 0
        assert any(name.startswith("assets/objects/") for name in package.namelist())
        records = [json.loads(line) for line in package.read("conversation.canjsonl").splitlines()]
        attachment_record = next(item for item in records if item["record_type"] == "attachment")
        assert attachment_record["resolution_status"] == "resolved"
        assert attachment_record["object"] is not None
        message_record = next(item for item in records if item["record_type"] == "message")
        assert message_record["attachment_refs"][0]["attachment_id"] == attachment_record["id"]

    bundle_job = client.post(
        f"/api/conversations/{conversation_id}/exports",
        json={"format": "canjson_bundle"},
        headers={"Idempotency-Key": "sensitive-canjson-bundle"},
    ).json()
    _process_task(bundle_job["job_id"])
    bundle_task = client.get(f"/api/tasks/{bundle_job['job_id']}").json()
    bundle_response = client.get(bundle_task["result"]["download_url"])
    with zipfile.ZipFile(io.BytesIO(bundle_response.content)) as bundle:
        manifest = json.loads(bundle.read("manifest.json"))
        assert manifest["attachments"]["excluded_object_count"] == 0
        assert any(name.startswith("assets/objects/") for name in bundle.namelist())


def test_canjson_bundle_honors_secondary_content_options(client) -> None:
    sample = commit_edit_sample(client)
    conversation_id = sample["conversation_id"]
    message = client.get(f"/api/conversations/{conversation_id}/messages").json()[0]
    description = client.patch(
        f"/api/conversations/{conversation_id}",
        json={"description_markdown": "Secondary export description"},
    )
    assert description.status_code == 200
    annotation = client.post(
        f"/api/conversations/{conversation_id}/annotations",
        json={
            "message_id": message["id"],
            "message_version_id": message["current_version"]["id"],
            "annotation_type": "highlight",
            "color": "yellow",
            "start_block_index": 0,
            "start_offset": 0,
            "end_block_index": 0,
            "end_offset": 5,
            "quote": "Original",
            "comment_markdown": "Secondary export annotation",
        },
    )
    assert annotation.status_code == 201, annotation.text
    notebook = client.get(f"/api/conversations/{conversation_id}/notebook").json()
    notebook_update = client.put(
        f"/api/conversations/{conversation_id}/notebook",
        json={
            "id": notebook["id"],
            "title": "Secondary export notebook",
            "base_revision": notebook["revision"],
            "blocks": [{"id": str(uuid.uuid4()), "type": "markdown", "markdown": "Notebook body"}],
        },
    )
    assert notebook_update.status_code == 200, notebook_update.text

    queued = client.post(
        f"/api/conversations/{conversation_id}/exports",
        json={
            "format": "canjson_bundle",
            "include_description": True,
            "annotation_scope": "all",
            "notebook_scope": "current",
            "include_source_refs": False,
        },
        headers={"Idempotency-Key": "secondary-content-canjson-bundle"},
    )
    assert queued.status_code == 202, queued.text
    _process_task(queued.json()["job_id"])
    task = client.get(f"/api/tasks/{queued.json()['job_id']}").json()
    assert task["status"] == "committed", task
    exported = client.get(task["result"]["download_url"])
    with zipfile.ZipFile(io.BytesIO(exported.content)) as bundle:
        manifest = json.loads(bundle.read("manifest.json"))
        assert manifest["included_content"] == {
            "conversation_description": True,
            "annotations": True,
            "notebook": True,
            "source_refs": False,
        }
        records = [json.loads(line) for line in bundle.read("conversation.canjsonl").splitlines()]
        assert records[0]["conversation"]["description_markdown"] == "Secondary export description"
        assert any(item["record_type"] == "annotation" for item in records)
        assert any(item["record_type"] == "notebook" for item in records)


def test_context_package_reading_scope_starts_at_selected_message_and_keeps_sequence(client) -> None:
    preview = client.post(
        "/api/imports/preview",
        files={
            "files": (
                "reading-scope.json",
                json.dumps({
                    "metadata": {"title": "Reading scope", "powered_by": "ChatGPT Exporter"},
                    "messages": [
                        {"role": "Prompt", "say": "first"},
                        {"role": "Response", "say": "second"},
                        {"role": "Prompt", "say": "third"},
                    ],
                }).encode(),
                "application/json",
            )
        },
    ).json()
    conversation_id = client.post(f"/api/imports/{preview['import_id']}/commit").json()["conversation_ids"][0]
    messages = client.get(f"/api/conversations/{conversation_id}/messages").json()
    queued = client.post(
        f"/api/conversations/{conversation_id}/exports",
        json={
            "format": "context_package",
            "context_scope": "reading_scope",
            "start_message_id": messages[1]["id"],
        },
        headers={"Idempotency-Key": "reading-scope-context-package"},
    )
    assert queued.status_code == 202, queued.text
    _process_task(queued.json()["job_id"])
    task_payload = client.get(f"/api/tasks/{queued.json()['job_id']}").json()
    exported = client.get(task_payload["result"]["download_url"])
    with zipfile.ZipFile(io.BytesIO(exported.content)) as package:
        manifest = json.loads(package.read("manifest.json"))
        assert manifest["scope"] == {
            "kind": "reading_scope",
            "conversation_id": conversation_id,
            "conversation_revision": manifest["scope"]["conversation_revision"],
            "current_versions_only": True,
            "first_message_seq": 2,
            "last_message_seq": 3,
            "message_count": 2,
            "is_complete_conversation": False,
        }
        records = [json.loads(line) for line in package.read("conversation.canjsonl").splitlines()]
        assert [item["seq"] for item in records if item["record_type"] == "message"] == [2, 3]


def test_bundle_rejects_zip_slip(client) -> None:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("../manifest.json", "{}")
    response = client.post(
        "/api/imports/bundles/preview",
        files={"file": ("unsafe.crbundle", output.getvalue(), "application/zip")},
    )
    assert response.status_code == 202
    _process_task(response.json()["task_id"])
    task = client.get(response.json()["status_url"])
    assert task.status_code == 200
    assert task.json()["status"] == "failed"
    assert "unsafe ZIP path" in task.json()["error_message"]


def test_expired_bundle_preview_releases_staged_assets(client, tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("ASSET_STORAGE_DIR", str(tmp_path / "storage" / "assets"))
    monkeypatch.setenv("ASSET_SCAN_REQUIRED", "false")
    get_settings.cache_clear()
    accepted = client.post(
        "/api/imports/bundles/preview",
        files={"file": ("expired.crbundle", _bundle_bytes(), "application/vnd.chat-reader.bundle+zip")},
    ).json()
    _process_task(accepted["task_id"])

    override = app.dependency_overrides[get_db]
    generator = override()
    db = next(generator)
    try:
        record = db.get(ImportRecord, uuid.UUID(accepted["import_id"]))
        assert record is not None
        record.draft_expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        asset = db.query(AssetObject).one()
        asset_id = asset.id
        object_path = Path(get_settings().asset_storage_dir) / asset.storage_key
        assert object_path.is_file()
        db.commit()
    finally:
        db.close()
        generator.close()

    deleted = client.delete(f"/api/imports/{accepted['import_id']}")
    assert deleted.status_code == 204, deleted.text
    generator = override()
    db = next(generator)
    try:
        asset = db.get(AssetObject, asset_id)
        assert asset is not None
        assert asset.status == "deleted"
        assert db.query(Attachment).count() == 0
    finally:
        db.close()
        generator.close()
    assert not object_path.exists()
