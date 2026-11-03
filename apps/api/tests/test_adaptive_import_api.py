import io
import json
import uuid
import zipfile
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from app.core.database import get_db
from app.main import app
from app.models.attachment import Attachment, MessageVersionAttachment
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.import_profile import ImportProfile, ImportProfileRevision
from app.models.import_record import ImportRecord
from app.core.config import get_settings
from app.services.adaptive_import.analysis import analyze_documents, default_mapping
from app.services.adaptive_import.archive_sources import (
    _document_references,
    _rewrite_document_references,
    _validated_members,
    inspect_archive,
)
from app.services.adaptive_import.contracts import AdaptiveImportError, SourceDocument
from app.services.adaptive_import.normalization import normalize_group
from app.services.adaptive_import.profiles import normalize_builtin
from test_import_preview_api import client  # noqa: F401


def _json_bytes(*, content_key: str = "body", body: str = "Hello", extra: dict | None = None) -> bytes:
    first = {"speaker": "human", content_key: body, "id": "m1", "timestamp": "2026-08-22T10:00:00Z"}
    second = {"speaker": "ai", content_key: "World", "id": "m2", "timestamp": "2026-08-22T10:01:00Z"}
    if content_key == "parts":
        first[content_key] = {"text": body}
        second[content_key] = {"text": "World"}
    payload = {"thread": {"title": "Adaptive fixture"}, "turns": [first, second], **(extra or {})}
    return json.dumps(payload).encode()


def _zip_bytes(entries: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in entries.items():
            archive.writestr(name, content)
    return buffer.getvalue()


def _create(client: TestClient, files: list[tuple[str, bytes, str]]) -> dict:
    response = client.post(
        "/api/adaptive-import/sessions",
        files=[("files", item) for item in files],
    )
    assert response.status_code == 201, response.text
    return _complete_analysis(client, response.json())


def _complete_analysis(client: TestClient, queued: dict) -> dict:
    """Drive the actual queued worker before assertions about analysis output."""
    from app.services.background_jobs import claim_next_job, process_background_job

    assert queued["state"] == "ANALYZING", queued
    task_id = uuid.UUID(queued["analysis_task_id"])
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        factory = sessionmaker(bind=db.get_bind(), expire_on_commit=False)
        claimed = claim_next_job(db, job_type="adaptive_import_analysis")
        assert claimed == task_id
        db.commit()
    finally:
        db.close()
        generator.close()
    process_background_job(task_id, session_factory=factory)
    task = client.get(f"/api/tasks/{task_id}")
    assert task.status_code == 200
    assert task.json()["status"] == "committed", task.json()
    response = client.get(f"/api/adaptive-import/sessions/{queued['import_id']}")
    assert response.status_code == 200, response.text
    return response.json()


def _save_mapping(client: TestClient, session: dict, name: str = "Learned fixture") -> dict:
    family = session["families"][0]
    preview = client.post(
        f"/api/adaptive-import/sessions/{session['import_id']}/families/{family['id']}/mapping/preview",
        json={"profile_name": name, "mapping_spec": family["mapping_draft"], "sample_group_id": family["group_ids"][-1]},
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["validation"]["verified_on_full_family"] is True
    assert preview.json()["sample_group_id"] == family["group_ids"][-1]
    saved = client.post(
        f"/api/adaptive-import/sessions/{session['import_id']}/families/{family['id']}/mapping",
        json={"profile_name": name, "mapping_spec": family["mapping_draft"]},
    )
    assert saved.status_code == 200, saved.text
    return saved.json()


def _save_family_mapping(client: TestClient, session: dict, family: dict, name: str) -> dict:
    preview = client.post(
        f"/api/adaptive-import/sessions/{session['import_id']}/families/{family['id']}/mapping/preview",
        json={"profile_name": name, "mapping_spec": family["mapping_draft"], "sample_group_id": family["group_ids"][0]},
    )
    assert preview.status_code == 200, preview.text
    saved = client.post(
        f"/api/adaptive-import/sessions/{session['import_id']}/families/{family['id']}/mapping",
        json={"profile_name": name, "mapping_spec": family["mapping_draft"]},
    )
    assert saved.status_code == 200, saved.text
    return saved.json()


def test_unknown_mapping_direct_import_then_same_structure_matches(client: TestClient) -> None:
    first = _create(client, [("first.json", _json_bytes(), "application/json")])
    assert first["state"] == "RESOLVING"
    assert first["families"][0]["resolution_status"] == "UNKNOWN"
    assert first["families"][0]["handling_class"] == "MAPPABLE"

    ready = _save_mapping(client, first)
    assert ready["state"] == "READY"
    assert ready["conversation_count"] == 1
    commit = client.post(f"/api/imports/{ready['import_id']}/commit")
    assert commit.status_code == 200, commit.text
    assert commit.json()["status"] == "committed"
    persisted = client.get(f"/api/adaptive-import/sessions/{ready['import_id']}").json()
    assert persisted["state"] == "COMPLETED"
    regroup = client.put(
        f"/api/adaptive-import/sessions/{ready['import_id']}/groups",
        json={"groups": [{"artifact_ids": first["groups"][0]["artifact_ids"]}]},
    )
    assert regroup.status_code == 409
    assert regroup.json()["detail"]["code"] == "SESSION_STATE_INVALID"

    second = _create(client, [("second.json", _json_bytes(body="A new conversation"), "application/json")])
    assert second["state"] == "READY"
    assert second["families"][0]["resolution_status"] == "EXACT_MATCH"
    assert second["families"][0]["display_name"] == "Learned fixture"


def test_native_json_is_a_builtin_profile(client: TestClient) -> None:
    content = json.dumps(
        {
            "metadata": {"powered_by": "ChatGPT Exporter", "title": "Native fixture"},
            "messages": [{"role": "Prompt", "say": "Hello"}, {"role": "Response", "say": "World"}],
        }
    ).encode()
    session = _create(client, [("native.json", content, "application/json")])

    assert session["state"] == "READY"
    assert session["families"][0]["matched_profile_key"] == "builtin:chat-reader-exporter"


@pytest.mark.parametrize(
    "unsafe_path",
    ["../escape.md", "/absolute.md", "C:/drive.md", "folder\\escape.md"],
)
def test_zip_member_path_validation_rejects_traversal_and_nonportable_paths(unsafe_path: str) -> None:
    archive_bytes = _zip_bytes({unsafe_path: b"not importable"})
    if "\\" in unsafe_path:
        # zipfile.ZipInfo normalizes backslashes when writing; mutate the
        # filename bytes to exercise a real hostile central-directory entry.
        archive_bytes = archive_bytes.replace(b"folder/escape.md", b"folder\\escape.md")
    with zipfile.ZipFile(io.BytesIO(archive_bytes), "r") as archive:
        with pytest.raises(AdaptiveImportError) as caught:
            _validated_members(archive)
    assert caught.value.code == "ZIP_PATH_UNSAFE"


@pytest.mark.parametrize("unsafe_path", [
    "../outside.txt", "/assets/note.txt", "assets\\note.txt", "C:/assets/note.txt",
    "assets/\x00note.txt", "%2fassets/note.txt", "assets/%252e%252e/note.txt",
])
def test_conversation_zip_manifest_unsafe_asset_path_is_blocking(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, unsafe_path: str) -> None:
    monkeypatch.setenv("IMPORT_STORAGE_DIR", str(tmp_path / "imports"))
    get_settings.cache_clear()
    session_id = uuid.uuid4()
    artifact_id = uuid.uuid4()
    session_root = tmp_path / "imports" / str(session_id)
    session_root.mkdir(parents=True)
    archive_path = session_root / "unsafe.zip"
    manifest = json.dumps({
        "version": "1",
        "assets": [{"path": unsafe_path, "kind": "text"}],
        "messages": [],
    }).encode()
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("conversation.md", b"# Safe transcript\n")
        archive.writestr("manifest.json", manifest)
        archive.writestr("assets/note.txt", b"not an implicit path repair target")
    catalog = inspect_archive(
        SimpleNamespace(id=session_id),
        SimpleNamespace(id=artifact_id, safe_filename="unsafe.zip"),
    )
    assert any(item["code"] == "MANIFEST_ASSET_PATH_INVALID" for item in catalog["issues"])


@pytest.mark.parametrize("literal", [
    "`[sample](assets/missing.txt)`",
    "``[sample](assets/missing.txt) with ` backtick``",
    "    [sample](assets/missing.txt)",
    "> ```md\n> [sample](assets/missing.txt)\n> ```",
    "- ~~~~md\n  [sample](assets/missing.txt)\n  ~~~~",
    "```md\n[sample](assets/missing.txt)\n``` not a close\n[more](assets/missing.txt)\n```",
    "<code>[sample](assets/missing.txt)</code>",
    "`[sample](assets/missing.txt)\nwith a continuation`",
    "~~~html\n<code>[sample](assets/missing.txt)</code>\n~~~",
])
def test_zip_reference_scanner_does_not_import_or_rewrite_code_examples(literal: str) -> None:
    document_id, asset_id = str(uuid.uuid4()), str(uuid.uuid4())
    members = {
        document_id: {"member_id": document_id, "path": "conversation.md", "use": "conversation"},
        asset_id: {"member_id": asset_id, "path": "assets/real.txt", "use": "attachment", "owner_document_ids": [document_id]},
    }
    source = literal + "\n\n[actual](assets/real.txt)\n"
    references, missing = _document_references(source, "conversation.md", {"assets/real.txt"})
    assert references == {"assets/real.txt"}
    assert missing == set()
    rewritten = _rewrite_document_references(source, "conversation.md", members)
    assert rewritten == literal + f"\n\n[actual](cr-asset://{asset_id})\n"


@pytest.mark.parametrize("source", [
    "[a `code` label](assets/real.txt)",
    "`unmatched opener\n\n[actual](assets/real.txt)\n\nanother unmatched `",
    "```md\n`unmatched\n```\n\n[actual](assets/real.txt)\n\n`unmatched",
])
def test_zip_code_protection_preserves_real_resources_outside_code_blocks(source: str) -> None:
    references, missing = _document_references(source, "conversation.md", {"assets/real.txt"})
    assert references == {"assets/real.txt"}
    assert missing == set()


def test_zip_resource_scanner_does_not_build_per_character_objects() -> None:
    import tracemalloc

    # Synthetic large paragraph: enforce a broad allocation ceiling rather
    # than a machine-dependent time threshold. Source text is allocated before
    # tracing; the previous character-list masking exceeded this bound.
    source = "Synthetic prose. " * 131_072 + "\n\n[actual](assets/real.txt)\n"
    tracemalloc.start()
    try:
        references, missing = _document_references(source, "conversation.md", {"assets/real.txt"})
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    assert references == {"assets/real.txt"}
    assert missing == set()
    assert peak < len(source) * 8


def test_zip_attachment_assigned_to_another_document_is_inert_here() -> None:
    document_id, other_id, asset_id = map(str, (uuid.uuid4(), uuid.uuid4(), uuid.uuid4()))
    members = {
        document_id: {"member_id": document_id, "path": "a.md", "use": "conversation"},
        other_id: {"member_id": other_id, "path": "b.md", "use": "conversation"},
        asset_id: {"member_id": asset_id, "path": "note.txt", "use": "attachment", "owner_document_ids": [other_id]},
    }
    assert _rewrite_document_references("[note](note.txt)", "a.md", members) == f"[note](cr-archive-member://{asset_id})"


def test_generic_markdown_zip_exposes_catalog_and_rejects_stale_classification(client: TestClient) -> None:
    content = (
        "# ZIP fixture\n\n"
        "## User\nPlease inspect the attached note.\n\n"
        "## Assistant\n![Attached note](assets/note.txt)\n"
    ).encode()
    session = _create(
        client,
        [(
            "markdown-bundle.zip",
            _zip_bytes({
                "conversation.md": content,
                "assets/note.txt": b"note from the archive",
            }),
            "application/zip",
        )],
    )

    assert session["state"] == "RESOLVING"
    assert session["families"][0]["handling_class"] == "MAPPABLE"
    archive_summary = session["archives"][0]
    assert archive_summary["archive_kind"] == "markdown_zip"
    assert archive_summary["document_count"] == 1
    assert archive_summary["attachment_count"] == 1
    artifact_id = archive_summary["artifact_id"]

    preview = client.get(
        f"/api/adaptive-import/sessions/{session['import_id']}/archives/{artifact_id}",
        params={"limit": 20},
    )
    assert preview.status_code == 200, preview.text
    catalog = preview.json()
    assert catalog["classification_version"] == 1
    assert catalog["member_count"] == 2
    note = next(item for item in catalog["members"] if item["path"] == "assets/note.txt")
    assert note["use"] == "attachment"
    assert note["reference_count"] == 1
    assert note["owner_document_ids"]

    excluded = client.put(
        f"/api/adaptive-import/sessions/{session['import_id']}/archives/{artifact_id}",
        json={
            "expected_version": 1,
            "changes": [{
                "member_id": note["member_id"],
                "use": "excluded",
                "owner_document_ids": [],
            }],
        },
    )
    assert excluded.status_code == 200, excluded.text
    assert excluded.json()["archives"][0]["classification_version"] == 2
    assert excluded.json()["archives"][0]["attachment_count"] == 0

    stale = client.put(
        f"/api/adaptive-import/sessions/{session['import_id']}/archives/{artifact_id}",
        json={
            "expected_version": 1,
            "changes": [{
                "member_id": note["member_id"],
                "use": "attachment",
                "owner_document_ids": [next(
                    item["member_id"]
                    for item in catalog["members"]
                    if item["kind"] == "markdown"
                )],
            }],
        },
    )
    assert stale.status_code == 409, stale.text
    assert stale.json()["detail"]["code"] == "ARCHIVE_CLASSIFICATION_STALE"

    ready = _save_mapping(client, excluded.json(), "Excluded ZIP attachment")
    assert ready["state"] == "READY"
    committed = client.post(f"/api/imports/{ready['import_id']}/commit")
    assert committed.status_code == 200, committed.text
    conversation_id = uuid.UUID(committed.json()["conversation_ids"][0])
    attachments = client.get(f"/api/conversations/{conversation_id}/attachments")
    assert attachments.status_code == 200, attachments.text
    assert attachments.json()["items"] == []

    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        message_ids = [
            row[0]
            for row in db.query(Message.id)
            .filter(Message.conversation_id == conversation_id)
            .all()
        ]
        versions = (
            db.query(MessageVersion)
            .filter(MessageVersion.message_id.in_(message_ids))
            .all()
        )
        rendered_markdown = "\n".join(version.display_text for version in versions)
        assert "cr-archive-member://" in rendered_markdown
        assert "assets/note.txt" not in rendered_markdown
    finally:
        db.close()
        generator.close()


def test_conversation_zip_commit_persists_real_attachment_and_occurrence(
    client: TestClient,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ASSET_STORAGE_DIR", str(tmp_path / "assets"))
    get_settings.cache_clear()
    manifest = json.dumps({
        "version": "1",
        "assets": [{"path": "assets/note.txt", "kind": "text"}],
        "messages": [{"id": "user-1"}, {"id": "assistant-1"}],
    }).encode()
    content = (
        "# Exported conversation\n\n"
        "## User\nPlease read the note.\n\n"
        "## Assistant\n[Open note](assets/note.txt)\n"
    ).encode()
    session = _create(
        client,
        [(
            "conversation-export.zip",
            _zip_bytes({
                "conversation.md": content,
                "manifest.json": manifest,
                "assets/note.txt": b"persisted archive attachment",
            }),
            "application/zip",
        )],
    )

    assert session["state"] == "READY"
    assert session["archives"][0]["archive_kind"] == "conversation_export"
    assert session["archives"][0]["attachment_count"] == 1
    committed = client.post(f"/api/imports/{session['import_id']}/commit")
    assert committed.status_code == 200, committed.text
    conversation_id = committed.json()["conversation_ids"][0]

    attachments = client.get(f"/api/conversations/{conversation_id}/attachments")
    assert attachments.status_code == 200, attachments.text
    items = attachments.json()["items"]
    assert len(items) == 1
    attachment = items[0]
    assert attachment["source_type"] == "adaptive_zip"
    assert attachment["status"] == "available"
    assert attachment["asset_object"]["byte_size"] == len(b"persisted archive attachment")
    assert attachment["content_url"]

    content_response = client.get(attachment["content_url"])
    assert content_response.status_code == 200, content_response.text
    assert content_response.content == b"persisted archive attachment"

    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        link_count = (
            db.query(MessageVersionAttachment)
            .filter(MessageVersionAttachment.attachment_id == uuid.UUID(attachment["id"]))
            .count()
        )
        assert link_count == 1
        assert db.query(Attachment).filter(Attachment.id == uuid.UUID(attachment["id"])).count() == 1
    finally:
        db.close()
        generator.close()


def _dedicated_zip(body: str = "[Open note](assets/note.txt)") -> bytes:
    return _zip_bytes({
        "conversation.md": f"# Synthetic export\n\n## User\nInspect\n\n## Assistant\n{body}\n".encode(),
        "manifest.json": json.dumps({
            "version": "1", "assets": [{"path": "assets/note.txt"}],
            "messages": [{"id": "u"}, {"id": "a"}],
        }).encode(),
        "assets/note.txt": b"Synthetic note",
    })


def test_zip_repeated_attachment_occurrences_follow_actual_blocks(client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from app.models.render_block import RenderBlock

    monkeypatch.setenv("ASSET_STORAGE_DIR", str(tmp_path / "assets"))
    get_settings.cache_clear()
    session = _create(client, [("repeated.zip", _dedicated_zip(
        'First [note](assets/note.txt)\n\nSecond <a href="assets/note.txt">note</a>\n\n'
        '`[literal](assets/note.txt)`'
    ), "application/zip")])
    committed = client.post(f"/api/imports/{session['import_id']}/commit")
    assert committed.status_code == 200, committed.text
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        occurrences = db.query(MessageVersionAttachment).all()
        assert len(occurrences) == 2
        assert len({item.block_index for item in occurrences}) == 2
        for occurrence in occurrences:
            block = db.query(RenderBlock).filter_by(
                message_version_id=occurrence.message_version_id, block_index=occurrence.block_index,
            ).one()
            assert f"cr-asset://{occurrence.attachment_id}" in block.data["text"]
        text = "\n".join(row.display_text for row in db.query(MessageVersion).all())
        assert "`[literal](assets/note.txt)`" in text
    finally:
        db.close()
        generator.close()


def test_zip_replacement_advances_classification_and_rejects_old_preview(client: TestClient) -> None:
    session = _create(client, [("before.zip", _dedicated_zip(), "application/zip")])
    archive_id = session["archives"][0]["artifact_id"]
    endpoint = f"/api/adaptive-import/sessions/{session['import_id']}/archives/{archive_id}"
    old = client.get(endpoint).json()
    replaced = client.put(
        f"/api/adaptive-import/sessions/{session['import_id']}/artifacts/{archive_id}",
        files={"file": ("after.zip", _dedicated_zip("Changed [note](assets/note.txt)"), "application/zip")},
    )
    assert replaced.status_code == 200, replaced.text
    assert replaced.json()["archives"][0]["classification_version"] > old["classification_version"]
    member = next(item for item in old["members"] if item["use"] == "attachment")
    stale = client.put(endpoint, json={
        "expected_version": old["classification_version"],
        "changes": [{"member_id": member["member_id"], "use": "excluded"}],
    })
    assert stale.status_code == 409, stale.text
    assert stale.json()["detail"]["code"] == "ARCHIVE_CLASSIFICATION_STALE"


@pytest.mark.parametrize("operation", ["classify", "replace"])
def test_zip_mutation_commit_failure_restores_catalog_draft_and_owned_files(client: TestClient, tmp_path: Path, operation: str) -> None:
    session = _create(client, [("before.zip", _dedicated_zip(), "application/zip")])
    archive_id = session["archives"][0]["artifact_id"]
    root = tmp_path / "storage" / "imports" / session["import_id"]
    before = {path.name: path.read_bytes() for path in root.iterdir() if path.is_file()}
    endpoint = f"/api/adaptive-import/sessions/{session['import_id']}/archives/{archive_id}"
    catalog = client.get(endpoint).json()
    member = next(item for item in catalog["members"] if item["use"] == "attachment")

    def fail_commit(_db):
        raise SQLAlchemyError("Synthetic commit rejection")

    event.listen(Session, "before_commit", fail_commit)
    try:
        if operation == "classify":
            response = client.put(endpoint, json={
                "expected_version": catalog["classification_version"],
                "changes": [{"member_id": member["member_id"], "use": "excluded"}],
            })
        else:
            response = client.put(
                f"/api/adaptive-import/sessions/{session['import_id']}/artifacts/{archive_id}",
                files={"file": ("after.zip", _dedicated_zip("Changed [note](assets/note.txt)"), "application/zip")},
            )
    finally:
        event.remove(Session, "before_commit", fail_commit)
    assert response.status_code == 500, response.text
    assert {path.name: path.read_bytes() for path in root.iterdir() if path.is_file()} == before
    assert client.get(endpoint).json() == catalog
    recovered = client.get(f"/api/adaptive-import/sessions/{session['import_id']}").json()
    assert recovered["state"] == session["state"]
    assert recovered["can_import"] is True


def test_zip_replacement_response_failure_does_not_delete_committed_source(
    client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.models.source_artifact import SourceArtifact

    session = _create(client, [("before.zip", _dedicated_zip(), "application/zip")])
    archive_id = session["archives"][0]["artifact_id"]
    replacement = _dedicated_zip("New committed [note](assets/note.txt)")
    original_refresh = Session.refresh

    def mark_commit(db):
        db.info["synthetic_committed"] = True

    def fail_response_refresh(db, instance, *args, **kwargs):
        if isinstance(instance, ImportRecord) and db.info.pop("synthetic_committed", False):
            raise SQLAlchemyError("Synthetic post-commit response failure")
        return original_refresh(db, instance, *args, **kwargs)

    event.listen(Session, "after_commit", mark_commit)
    try:
        with monkeypatch.context() as patch:
            patch.setattr(Session, "refresh", fail_response_refresh)
            response = client.put(
                f"/api/adaptive-import/sessions/{session['import_id']}/artifacts/{archive_id}",
                files={"file": ("after.zip", replacement, "application/zip")},
            )
    finally:
        event.remove(Session, "after_commit", mark_commit)
    assert response.status_code == 500
    assert response.json()["detail"]["code"] == "SOURCE_REPLACEMENT_RESPONSE_UNCONFIRMED"
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        artifact = db.get(SourceArtifact, uuid.UUID(archive_id))
        path = tmp_path / "storage" / "imports" / session["import_id"] / artifact.safe_filename
        assert path.read_bytes() == replacement
        assert artifact.parsed_summary["classification_version"] > session["archives"][0]["classification_version"]
    finally:
        db.close()
        generator.close()
    recovered = client.get(f"/api/adaptive-import/sessions/{session['import_id']}").json()
    assert recovered["state"] == "READY"
    assert recovered["can_import"] is True


def test_mapping_preview_exposes_bounds_without_truncating_the_import(client: TestClient) -> None:
    source = "### Synthetic sample\n\n" + "正文🙂" * 800
    content = _json_bytes(extra={"turns": [
        {"speaker": "human" if index % 2 == 0 else "ai", "body": source if index == 0 else f"Synthetic {index}"}
        for index in range(13)
    ]})
    session = _create(client, [("bounded.json", content, "application/json")])
    family = session["families"][0]
    response = client.post(
        f"/api/adaptive-import/sessions/{session['import_id']}/families/{family['id']}/mapping/preview",
        json={"profile_name": "Synthetic bounded preview", "mapping_spec": family["mapping_draft"],
              "sample_group_id": family["group_ids"][0]},
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["validation"]["valid"] is True
    assert payload["validation"]["message_count"] == 13
    assert payload["preview"]["message_count"] == 13
    assert len(payload["preview"]["messages"]) == 12
    assert payload["preview"]["messages"][0]["content"] == source[:2000]
    assert payload["preview"]["messages"][0]["content_truncated"] is True
    assert all(item["content_truncated"] is False for item in payload["preview"]["messages"][1:])
    ready = _save_mapping(client, session, "Synthetic bounded preview")
    committed = client.post(f"/api/imports/{ready['import_id']}/commit")
    assert committed.status_code == 200, committed.text
    conversation_id = committed.json()["conversation_ids"][0]
    detail = client.get(f"/api/conversations/{conversation_id}/messages?include_blocks=true")
    assert detail.status_code == 200, detail.text
    # The preview's budget never becomes a canonical-write budget.
    canonical_messages = detail.json()
    assert len(canonical_messages) == 13
    assert canonical_messages[0]["current_version"]["display_text"] == source


def test_family_mapping_is_reused_and_validated_for_every_group(client: TestClient) -> None:
    session = _create(
        client,
        [
            ("one.json", _json_bytes(body="One"), "application/json"),
            ("two.json", _json_bytes(body="Two"), "application/json"),
        ],
    )
    assert session["family_count"] == 1
    assert session["families"][0]["group_count"] == 2
    ready = _save_mapping(client, session, "Batch fixture")
    assert ready["conversation_count"] == 2
    formats = client.get("/api/import-formats").json()
    assert len([item for item in formats if item["kind"] == "LEARNED" and item["name"] == "Batch fixture"]) == 1


def test_invalid_member_blocks_family_profile_verification(client: TestClient) -> None:
    session = _create(
        client,
        [
            ("good.json", _json_bytes(body="Good"), "application/json"),
            ("empty.json", _json_bytes(body=""), "application/json"),
        ],
    )
    family = session["families"][0]
    response = client.post(
        f"/api/adaptive-import/sessions/{session['import_id']}/families/{family['id']}/mapping",
        json={"profile_name": "Must not persist", "mapping_spec": family["mapping_draft"]},
    )

    assert response.status_code == 422
    formats = client.get("/api/import-formats").json()
    assert all(item["name"] != "Must not persist" for item in formats)


def test_invalid_group_does_not_block_mapping_and_can_be_excluded(client: TestClient, tmp_path: Path) -> None:
    session = _create(
        client,
        [
            ("good.json", _json_bytes(body="Keep this conversation"), "application/json"),
            ("broken.json", b'{"thread":', "application/json"),
        ],
    )

    assert session["state"] == "RESOLVING"
    assert {family["resolution_status"] for family in session["families"]} == {"UNKNOWN", "INVALID"}
    assert next(family for family in session["families"] if family["resolution_status"] == "INVALID")["handling_class"] == "NOT_MAPPABLE"
    valid_family = next(family for family in session["families"] if family["resolution_status"] == "UNKNOWN")
    invalid_family = next(family for family in session["families"] if family["resolution_status"] == "INVALID")

    partially_resolved = _save_family_mapping(client, session, valid_family, "Recoverable batch")
    assert partially_resolved["state"] == "RESOLVING"
    assert {family["resolution_status"] for family in partially_resolved["families"]} == {"EXACT_MATCH", "INVALID"}

    excluded = client.delete(
        f"/api/adaptive-import/sessions/{session['import_id']}/groups/{invalid_family['group_ids'][0]}"
    )
    assert excluded.status_code == 200, excluded.text
    payload = excluded.json()
    assert payload["state"] == "READY"
    assert payload["file_count"] == 1
    assert payload["conversation_count"] == 1
    stored_names = {path.name for path in (tmp_path / "storage" / "imports" / session["import_id"]).iterdir()}
    assert "broken.json" not in stored_names
    assert "good.json" in stored_names


def test_invalid_group_can_be_replaced_without_restarting_session(client: TestClient, tmp_path: Path) -> None:
    session = _create(
        client,
        [
            ("good.json", _json_bytes(body="Known structure"), "application/json"),
            ("broken.json", b"not json", "application/json"),
        ],
    )
    valid_family = next(family for family in session["families"] if family["resolution_status"] == "UNKNOWN")
    invalid_family = next(family for family in session["families"] if family["resolution_status"] == "INVALID")
    partially_resolved = _save_family_mapping(client, session, valid_family, "Replacement batch")
    invalid_group = next(group for group in partially_resolved["groups"] if group["id"] in invalid_family["group_ids"])
    artifact_id = invalid_group["files"][0]["artifact_id"]

    replaced = client.put(
        f"/api/adaptive-import/sessions/{session['import_id']}/artifacts/{artifact_id}",
        files={"file": ("replacement.json", _json_bytes(body="Recovered conversation"), "application/json")},
    )
    assert replaced.status_code == 200, replaced.text
    payload = replaced.json()
    assert payload["state"] == "READY"
    assert payload["conversation_count"] == 2
    assert payload["family_count"] == 1
    stored_names = {path.name for path in (tmp_path / "storage" / "imports" / session["import_id"]).iterdir()}
    assert "broken.json" not in stored_names
    assert "replacement.json" in stored_names


def test_last_group_cannot_be_excluded_and_ready_session_can_be_regrouped(client: TestClient) -> None:
    content = json.dumps(
        {
            "metadata": {"powered_by": "ChatGPT Exporter", "title": "Native fixture"},
            "messages": [{"role": "Prompt", "say": "Hello"}, {"role": "Response", "say": "World"}],
        }
    ).encode()
    session = _create(client, [("native.json", content, "application/json")])
    assert session["state"] == "READY"

    excluded = client.delete(
        f"/api/adaptive-import/sessions/{session['import_id']}/groups/{session['groups'][0]['id']}"
    )
    assert excluded.status_code == 409
    assert excluded.json()["detail"]["code"] == "SESSION_WOULD_BE_EMPTY"

    regrouped = client.put(
        f"/api/adaptive-import/sessions/{session['import_id']}/groups",
        json={"groups": [{"artifact_ids": session["groups"][0]["artifact_ids"], "display_name": "Native fixture"}]},
    )
    assert regrouped.status_code == 200, regrouped.text
    assert regrouped.json()["state"] == "READY"

    reanalyzed = client.post(f"/api/adaptive-import/sessions/{session['import_id']}/reanalyze")
    assert reanalyzed.status_code == 200, reanalyzed.text
    assert reanalyzed.json()["state"] == "READY"


def test_legacy_blocked_session_can_be_reanalyzed_in_place(client: TestClient, tmp_path: Path) -> None:
    session = _create(client, [("legacy.json", _json_bytes(), "application/json")])
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}")
    with Session(engine) as db:
        record = db.get(ImportRecord, uuid.UUID(session["import_id"]))
        assert record is not None
        record.session_state = "BLOCKED"
        record.status = "blocked"
        record.phase = "analysis_failed"
        db.commit()
    engine.dispose()

    recovered = client.post(f"/api/adaptive-import/sessions/{session['import_id']}/reanalyze")
    assert recovered.status_code == 200, recovered.text
    assert recovered.json()["state"] == "RESOLVING"
    assert recovered.json()["families"][0]["resolution_status"] == "UNKNOWN"


def test_drift_creates_revision_and_old_revision_remains_matchable(client: TestClient) -> None:
    original = _save_mapping(client, _create(client, [("v1.json", _json_bytes(), "application/json")]), "Versioned fixture")
    profile_id = original["families"][0]["matched_profile_id"]
    changed = _create(client, [("v2.json", _json_bytes(content_key="parts"), "application/json")])
    assert changed["families"][0]["resolution_status"] == "DRIFTED"
    # A profile can match initially but fail full-family normalization.  The
    # overview must not keep the stale SUPPORTED evidence in that case.
    assert changed["families"][0]["handling_class"] == "MAPPABLE"
    assert changed["families"][0]["handling_reason"]["recovery_action"] == "OPEN_MAPPING"
    repaired = _save_mapping(client, changed, "Versioned fixture")
    assert repaired["families"][0]["matched_profile_id"] == profile_id
    revisions = client.get(f"/api/import-formats/{profile_id}/revisions").json()
    assert [item["revision"] for item in revisions] == [2, 1]
    assert revisions[0]["status"] == "VERIFIED"
    assert revisions[1]["status"] == "SUPERSEDED"

    old_again = _create(client, [("old-again.json", _json_bytes(body="Old format"), "application/json")])
    assert old_again["families"][0]["resolution_status"] == "EXACT_MATCH"
    assert old_again["families"][0]["matched_revision_id"] == revisions[1]["id"]


def test_equivalent_settings_remap_reuses_the_existing_revision(client: TestClient) -> None:
    original = _save_mapping(client, _create(client, [("v1.json", _json_bytes(), "application/json")]), "Repairable fixture")
    profile_id = original["families"][0]["matched_profile_id"]
    repair = client.post(
        "/api/adaptive-import/sessions",
        data={"repair_profile_id": profile_id},
        files=[("files", ("representative.json", _json_bytes(body="Representative"), "application/json"))],
    )

    assert repair.status_code == 201, repair.text
    session = _complete_analysis(client, repair.json())
    assert session["families"][0]["resolution_status"] == "DRIFTED"
    assert session["families"][0]["matched_profile_id"] == profile_id
    repaired = _save_mapping(client, session, "Repairable fixture")
    revisions = client.get(f"/api/import-formats/{profile_id}/revisions").json()
    assert repaired["state"] == "READY"
    assert [item["revision"] for item in revisions] == [1]
    matched = _create(client, [("after-remap.json", _json_bytes(body="After remap"), "application/json")])
    assert matched["families"][0]["resolution_status"] == "EXACT_MATCH"
    assert matched["families"][0]["matched_revision_id"] == revisions[0]["id"]


def test_disabled_and_deleted_profiles_do_not_auto_apply(client: TestClient) -> None:
    ready = _save_mapping(client, _create(client, [("learn.json", _json_bytes(), "application/json")]), "Temporary fixture")
    profile_id = ready["families"][0]["matched_profile_id"]
    disabled = client.patch(f"/api/import-formats/{profile_id}", json={"status": "DISABLED"})
    assert disabled.status_code == 200
    unknown = _create(client, [("disabled.json", _json_bytes(body="Disabled"), "application/json")])
    assert unknown["families"][0]["resolution_status"] == "UNKNOWN"
    deleted = client.delete(f"/api/import-formats/{profile_id}")
    assert deleted.status_code == 204
    formats = client.get("/api/import-formats").json()
    assert all(item["id"] != profile_id for item in formats)


def test_different_mappings_for_equal_structure_stay_ambiguous_until_selection(client: TestClient, tmp_path: Path) -> None:
    ready = _save_mapping(client, _create(client, [("learn.json", _json_bytes(), "application/json")]), "First candidate")
    original_profile_id = ready["families"][0]["matched_profile_id"]
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}")
    with Session(engine) as db:
        original = db.get(ImportProfile, uuid.UUID(original_profile_id))
        assert original is not None
        source_revision = original.revisions[0]
        duplicate = ImportProfile(
            name="Second candidate",
            kind="LEARNED",
            source_mode="JSON",
            status="ACTIVE",
            owner_user_id=original.owner_user_id,
        )
        db.add(duplicate)
        db.flush()
        revision = ImportProfileRevision(
            profile_id=duplicate.id,
            revision=1,
            matcher_version=source_revision.matcher_version,
            normalizer_version=source_revision.normalizer_version,
            match_spec=source_revision.match_spec,
            mapping_spec={**source_revision.mapping_spec, "transforms": {"content": ["TRIM"]}},
            validation_spec=source_revision.validation_spec,
            source_signature=source_revision.source_signature,
            signature_digest=source_revision.signature_digest,
            status="VERIFIED",
            verification_summary=source_revision.verification_summary,
            verified_at=source_revision.verified_at,
        )
        db.add(revision)
        db.flush()
        duplicate.current_revision_id = revision.id
        from app.services.adaptive_import.profile_access import grant_revision
        grant_revision(db, original.owner_user_id, revision, reason="LEARNED", display_name="Second candidate")
        selected_revision_id = str(revision.id)
        db.commit()

    ambiguous = _create(client, [("ambiguous.json", _json_bytes(body="Choose explicitly"), "application/json")])
    family = ambiguous["families"][0]
    assert ambiguous["state"] == "RESOLVING"
    assert family["resolution_status"] == "AMBIGUOUS"
    assert len(family["match_evidence"]["candidates"]) == 2

    selected = client.post(
        f"/api/adaptive-import/sessions/{ambiguous['import_id']}/families/{family['id']}/profile",
        json={"revision_id": selected_revision_id},
    )
    assert selected.status_code == 200, selected.text
    assert selected.json()["state"] == "READY"


def test_markdown_noise_and_role_mapping() -> None:
    document = SourceDocument(
        artifact_id="md",
        filename="conversation.md",
        extension=".md",
        content=b"# Export note\n\n## Human\nHello\n\n## AI\nWorld\n",
    )
    analysis = analyze_documents([document])
    mapping = default_mapping(analysis)
    ignored = normalize_group([document], mapping, "Markdown fixture")[0]
    assert [message.role for message in ignored.messages] == ["user", "assistant"]
    assert ignored.messages[0].display_text == "Hello"

    mapping["noise_rules"] = [{"region": "PREAMBLE", "action": "KEEP"}]
    kept = normalize_group([document], mapping, "Markdown fixture")[0]
    assert kept.messages[0].display_text.startswith("# Export note")


def test_native_markdown_is_supported_without_mapping() -> None:
    document = SourceDocument(
        "native",
        "native.md",
        ".md",
        b'---\nformat: "chat-reader-markdown-export"\nversion: 2\n---\n'
        b'<!-- chat-reader-message role="user" -->\nHello\n',
    )
    analysis = analyze_documents([document])
    assert analysis.handling_class == "SUPPORTED"
    assert analysis.signature["builtin"] == "chat-reader-markdown-v2"


def test_native_markdown_session_is_ready_for_direct_import(client: TestClient) -> None:
    session = _create(
        client,
        [
            (
                "native.md",
                b'---\nformat: "chat-reader-markdown-export"\nversion: 2\n---\n'
                b'<!-- chat-reader-message\nrole: "user"\norder_key: "0001"\n-->'
                b'\nHello\n<!-- /chat-reader-message -->\n',
                "text/markdown",
            )
        ],
    )
    assert session["families"][0]["handling_class"] == "SUPPORTED"
    assert session["state"] == "READY"


def test_rescue_instruction_document_is_not_mappable() -> None:
    document = SourceDocument(
        "rescue",
        "rescue.md",
        ".md",
        b"---\nname: chat-reader-conversation-rescue\n---\n"
        b"# Conversation Rescue & Canonicalization Skill\n",
    )
    with pytest.raises(AdaptiveImportError) as caught:
        analyze_documents([document])
    assert caught.value.code == "DOCUMENT_NOT_TRANSCRIPT"
    assert caught.value.action == "open_rescue"


def test_context_package_document_with_role_labels_is_not_mappable(client: TestClient) -> None:
    # Context packages intentionally contain repeated 用户:/Assistant: labels;
    # line references and instruction sections distinguish them from a chat
    # transcript so they must go to Conversation Rescue, not Mapping.
    content = (
        "### Continuation context\n\n"
        "This is a Conversation Context Package.\n\n"
        "## Instruction Boundary\n"
        "The task is not a summary.\n\n"
        "用户:\nPlease continue from the supplied context.\n"
        "Assistant:\nAcknowledged.\n\n"
        "[L1] historical message\n[L2] another message\n[L3] more context\n"
    ).encode()
    document = SourceDocument("context-package", "context.md", ".md", content)
    with pytest.raises(AdaptiveImportError) as caught:
        analyze_documents([document])
    assert caught.value.code == "DOCUMENT_NOT_TRANSCRIPT"
    assert caught.value.action == "open_rescue"

    session = _create(client, [("context.md", content, "text/markdown")])
    family = session["families"][0]
    assert family["resolution_status"] == "INVALID"
    assert family["handling_class"] == "NOT_MAPPABLE"
    assert family["handling_reason"] == {
        "code": "DOCUMENT_NOT_TRANSCRIPT",
        "title": "这不是对话记录",
        "detail": "当前文件是说明文档或转换指令，不是可直接分段的 Conversation。",
        "recovery_action": "OPEN_RESCUE",
    }


def test_rescue_instruction_session_exposes_not_mappable_recovery(client: TestClient) -> None:
    session = _create(
        client,
        [("rescue.md", b"---\nname: chat-reader-conversation-rescue\n---\n# Conversation Rescue & Canonicalization Skill\n", "text/markdown")],
    )
    family = session["families"][0]
    assert session["state"] == "RESOLVING"
    assert family["resolution_status"] == "INVALID"
    assert family["handling_class"] == "NOT_MAPPABLE"
    assert family["handling_reason"]["recovery_action"] == "OPEN_RESCUE"


@pytest.mark.parametrize(
    ("filename", "content"),
    [
        (
            "ordinary-document.md",
            b"# Deployment notes\n\nThis document describes a process.\n\n"
            b"## Preconditions\n\nReview the configuration before continuing.\n",
        ),
        (
            "reference-manual.md",
            b"# Reference manual\n\n## Input format\n\nUse UTF-8 text.\n\n"
            b"## Output format\n\nSave the converted file as Markdown.\n",
        ),
    ],
)
def test_unstructured_markdown_is_preserved_as_one_assistant_message(
    client: TestClient,
    filename: str,
    content: bytes,
) -> None:
    document = SourceDocument("plain", filename, ".md", content)
    analysis = analyze_documents([document])
    assert analysis.handling_class == "SUPPORTED"
    assert analysis.signature["builtin"] == "single-assistant-markdown-v1"
    draft = normalize_builtin("builtin:single-assistant-markdown-v1", [document])[0]
    assert draft.title == ("Deployment notes" if filename == "ordinary-document.md" else "Reference manual")
    assert len(draft.messages) == 1
    assert draft.messages[0].role == "assistant"
    assert draft.messages[0].display_text == content.decode("utf-8")

    session = _create(client, [(filename, content, "text/markdown")])
    assert session["state"] == "READY"
    assert session["families"][0]["matched_profile_key"] == "builtin:single-assistant-markdown-v1"


def test_empty_markdown_is_rejected_before_an_import_session_is_created(client: TestClient) -> None:
    response = client.post(
        "/api/adaptive-import/sessions",
        files=[("files", ("empty.md", b"", "text/markdown"))],
    )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "FILE_EMPTY"


def test_unstructured_markdown_session_is_ready_for_direct_import(client: TestClient) -> None:
    content = b"# Notes\n\nA single assistant response with **Markdown** formatting.\n"
    session = _create(client, [("notes.md", content, "text/markdown")])
    assert session["state"] == "READY"
    family = session["families"][0]
    assert family["matched_profile_key"] == "builtin:single-assistant-markdown-v1"
    assert family["validation_result"]["valid"] is True


def test_adaptive_import_destination_is_persisted_and_honored(client: TestClient) -> None:
    project = client.post("/api/projects", json={"name": "Import destination fixture"})
    assert project.status_code == 201
    project_id = project.json()["id"]
    response = client.post(
        "/api/adaptive-import/sessions",
        data={"target_project_id": project_id},
        files=[("files", ("plain.md", b"One unstructured assistant message.", "text/markdown"))],
    )
    assert response.status_code == 201, response.text
    session = _complete_analysis(client, response.json())
    assert session["target_project_id"] == project_id
    committed = client.post(
        f"/api/imports/{session['import_id']}/commit",
        json={"project_id": project_id},
    )
    assert committed.status_code == 200, committed.text
    conversation_id = committed.json()["conversation_ids"][0]
    rows = client.get(f"/api/projects/{project_id}/conversations")
    assert rows.status_code == 200, rows.text
    assert conversation_id in {item["id"] for item in rows.json()}


def test_adaptive_import_destination_can_be_changed_before_commit(client: TestClient) -> None:
    first = client.post("/api/projects", json={"name": "Initial import destination"})
    second = client.post("/api/projects", json={"name": "Updated import destination"})
    assert first.status_code == second.status_code == 201
    session = _create(client, [("plain.md", b"One unstructured assistant message.", "text/markdown")])
    updated = client.put(
        f"/api/adaptive-import/sessions/{session['import_id']}/destination",
        json={"target_project_id": second.json()["id"]},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["target_project_id"] == second.json()["id"]

    committed = client.post(f"/api/imports/{session['import_id']}/commit", json={})
    assert committed.status_code == 200, committed.text
    conversation_id = committed.json()["conversation_ids"][0]
    rows = client.get(f"/api/projects/{second.json()['id']}/conversations")
    assert rows.status_code == 200, rows.text
    assert conversation_id in {item["id"] for item in rows.json()}


def test_adaptive_import_rejects_unavailable_destination(client: TestClient) -> None:
    response = client.post(
        "/api/adaptive-import/sessions",
        data={"target_project_id": str(uuid.uuid4())},
        files=[("files", ("plain.md", b"One message.", "text/markdown"))],
    )
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "IMPORT_PROJECT_NOT_FOUND"


def test_adaptive_import_destination_update_rejects_unavailable_project(client: TestClient) -> None:
    session = _create(client, [("plain.md", b"One unstructured assistant message.", "text/markdown")])
    response = client.put(
        f"/api/adaptive-import/sessions/{session['import_id']}/destination",
        json={"target_project_id": str(uuid.uuid4())},
    )
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "IMPORT_PROJECT_NOT_FOUND"


def test_markdown_heading_roles_accept_trailing_colons_and_ignore_fenced_boundaries() -> None:
    document = SourceDocument(
        artifact_id="md-colon",
        filename="conversation.md",
        extension=".md",
        content=(
            "# Export\n\n## Prompt:\nQuestion\n\n"
            "```markdown\n## Response:\nnot a boundary\n```\n\n"
            "## Response:\nAnswer\n"
        ).encode(),
    )

    analysis = analyze_documents([document])
    draft = normalize_group([document], default_mapping(analysis), "Markdown colon fixture")[0]

    assert [message.role for message in draft.messages] == ["user", "assistant"]
    assert "not a boundary" in draft.messages[0].display_text
    assert draft.messages[1].display_text == "Answer"


def test_markdown_chinese_line_labels_ignore_colon_ended_body_lines() -> None:
    document = SourceDocument(
        "md-cn-labels",
        "formula.md",
        ".md",
        (
            "### 公式展示测试\n\n"
            "用户:\n请输出公式测试。\n"
            "AI助手:\n可以，下面是完整测试集。\n\n"
            "### 1. 行内公式\n\n"
            "这是行内公式，例如：\\(E=mc^2\\)\n"
        ).encode(),
    )

    analysis = analyze_documents([document])
    draft = normalize_group([document], default_mapping(analysis), "Chinese Markdown fixture")[0]

    assert analysis.semantic["role_suggestions"] == {"AI助手": "assistant", "用户": "user"}
    assert [message.role for message in draft.messages] == ["user", "assistant"]
    assert "这是行内公式" in draft.messages[1].display_text


def test_markdown_model_emphasis_in_heading_is_decoration_not_role() -> None:
    json_document = SourceDocument("json", "pair.json", ".json", _json_bytes())
    markdown_document = SourceDocument(
        "md",
        "pair.md",
        ".md",
        (
            "# Pair\n\n"
            "## You — Aug 22, 2026\nHello\n\n"
            "## ChatGPT *(gpt-5-6-thinking)* — Aug 22, 2026\nWorld\n\n"
            "## 可能的原因\nThis is body content\n"
        ).encode(),
    )

    analysis = analyze_documents([json_document, markdown_document])
    draft = normalize_group([json_document, markdown_document], default_mapping(analysis), "Paired Markdown fixture")[0]

    assert analysis.semantic["markdown"]["role_suggestions"] == {"ChatGPT": "assistant", "You": "user"}
    assert [message.role for message in draft.messages] == ["user", "assistant"]
    assert draft.messages[1].display_text.startswith("World")
    assert "## 可能的原因" in draft.messages[1].display_text


def test_json_markdown_order_id_and_role_timestamp_relations() -> None:
    json_document = SourceDocument("json", "pair.json", ".json", _json_bytes())
    markdown_document = SourceDocument(
        "md",
        "pair.md",
        ".md",
        (
            "## AI | id=m2 | 2026-08-22T10:01:00Z\nMarkdown world\n\n"
            "## Human | id=m1 | 2026-08-22T10:00:00Z\nMarkdown hello\n"
        ).encode(),
    )
    analysis = analyze_documents([json_document, markdown_document])
    mapping = default_mapping(analysis)

    mapping["relation"]["type"] = "ID"
    by_id = normalize_group([json_document, markdown_document], mapping, "Paired fixture")[0]
    assert [message.display_text for message in by_id.messages] == ["Markdown hello", "Markdown world"]

    mapping["relation"]["type"] = "ROLE_TIMESTAMP"
    by_time = normalize_group([json_document, markdown_document], mapping, "Paired fixture")[0]
    assert [message.role for message in by_time.messages] == ["user", "assistant"]

    mapping["relation"]["type"] = "ORDER"
    try:
        normalize_group([json_document, markdown_document], mapping, "Paired fixture")
    except AdaptiveImportError as exc:
        assert exc.code == "RELATION_ROLE_CONFLICT"
    else:
        raise AssertionError("ORDER must reject a differently ordered pair")


def test_unknown_role_is_never_silently_mapped() -> None:
    document = SourceDocument(
        "json",
        "unknown-role.json",
        ".json",
        json.dumps({"turns": [{"speaker": "critic", "body": "Review"}]}).encode(),
    )
    analysis = analyze_documents([document])
    mapping = default_mapping(analysis)
    try:
        normalize_group([document], mapping, "Unknown role fixture")
    except AdaptiveImportError as exc:
        assert exc.code == "ROLE_UNMAPPED"
    else:
        raise AssertionError("Unknown roles must block normalization")


def test_mixed_batch_with_unmatched_files_requires_group_resolution(client: TestClient) -> None:
    markdown = b"## Human\nHello\n\n## AI\nWorld\n"
    session = _create(
        client,
        [
            ("paired.json", _json_bytes(), "application/json"),
            ("paired.md", markdown, "text/markdown"),
            ("unmatched.json", _json_bytes(body="Separate"), "application/json"),
        ],
    )

    assert session["state"] == "NEEDS_GROUPING"
    assert sorted(group["grouping_status"] for group in session["groups"]) == ["AMBIGUOUS", "RESOLVED"]


def test_json_markdown_pair_with_chinese_markdown_family_does_not_block_session(client: TestClient) -> None:
    paired_markdown = (
        "# Pair\n\n"
        "## You — Aug 22, 2026\nHello\n\n"
        "## ChatGPT *(gpt-5-6-thinking)* — Aug 22, 2026\nWorld\n"
    ).encode()
    formula_markdown = (
        "### 公式展示测试\n\n"
        "用户:\n请输出公式测试。\n"
        "AI助手:\n可以，下面是完整测试集。\n\n"
        "### 1. 行内公式\n\n"
        "这是行内公式，例如：\\(E=mc^2\\)\n"
    ).encode()

    session = _create(
        client,
        [
            ("conversation.json", _json_bytes(), "application/json"),
            ("conversation.md", paired_markdown, "text/markdown"),
            ("formula.md", formula_markdown, "text/markdown"),
        ],
    )

    assert session["state"] == "NEEDS_GROUPING"
    artifacts = {
        file["filename"]: file["artifact_id"]
        for group in session["groups"]
        for file in group["files"]
    }
    resolved_response = client.put(
        f"/api/adaptive-import/sessions/{session['import_id']}/groups",
        json={
            "groups": [
                {"artifact_ids": [artifacts["conversation.json"], artifacts["conversation.md"]]},
                {"artifact_ids": [artifacts["formula.md"]]},
            ]
        },
    )
    assert resolved_response.status_code == 200, resolved_response.text
    resolved = resolved_response.json()
    assert resolved["state"] == "RESOLVING"
    assert resolved["family_count"] == 2
    assert all(family["resolution_status"] != "INVALID" for family in resolved["families"])
    assert sorted(group["mode"] for group in resolved["groups"]) == ["JSON_MARKDOWN", "MARKDOWN"]

    current = resolved
    while current["state"] == "RESOLVING":
        family = next(item for item in current["families"] if item["resolution_status"] not in {"EXACT_MATCH", "COMPATIBLE"})
        mapped = client.post(
            f"/api/adaptive-import/sessions/{current['import_id']}/families/{family['id']}/mapping",
            json={"profile_name": f"Three-file {family['source_mode']}", "mapping_spec": family["mapping_draft"]},
        )
        assert mapped.status_code == 200, mapped.text
        current = mapped.json()
    assert current["state"] == "READY"
    assert current["conversation_count"] == 2


def test_cancel_marks_session_and_removes_temporary_source(client: TestClient, tmp_path: Path) -> None:
    session = _create(client, [("cancel.json", _json_bytes(), "application/json")])
    source_root = tmp_path / "storage" / "imports" / session["import_id"]
    assert source_root.is_dir()

    canceled = client.delete(f"/api/adaptive-import/sessions/{session['import_id']}")
    assert canceled.status_code == 204
    restored = client.get(f"/api/adaptive-import/sessions/{session['import_id']}").json()
    assert restored["state"] == "CANCELED"
    assert not source_root.exists()


def test_adaptive_upload_rejects_file_count_before_analysis(client: TestClient) -> None:
    response = client.post(
        "/api/adaptive-import/sessions",
        files=[("files", (f"item-{index}.json", b"{}", "application/json")) for index in range(501)],
    )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "FILE_COUNT_LIMIT"


def test_adaptive_upload_enforces_total_session_limit(
    client: TestClient,
    monkeypatch,
) -> None:
    monkeypatch.setenv("MAX_ADAPTIVE_IMPORT_TOTAL_MB", "1")
    get_settings.cache_clear()
    padding = "x" * 600_000
    payload = json.dumps({"turns": [{"speaker": "human", "body": "Hello"}], "padding": padding}).encode()

    response = client.post(
        "/api/adaptive-import/sessions",
        files=[
            ("files", ("one.json", payload, "application/json")),
            ("files", ("two.json", payload, "application/json")),
        ],
    )

    assert response.status_code == 413
    assert response.json()["detail"]["code"] == "SESSION_TOO_LARGE"
    get_settings.cache_clear()


def test_adaptive_nginx_capacity_is_scoped_to_exact_route() -> None:
    root = Path(__file__).resolve().parents[3]
    nginx = (root / "deploy" / "nginx-chat-reader.conf").read_text(encoding="utf-8")
    adaptive_location = nginx.split("location = /api/adaptive-import/sessions", 1)[1].split("location", 1)[0]

    assert "client_max_body_size 520m;" in adaptive_location
    assert "proxy_request_buffering off;" in adaptive_location
    assert "proxy_pass http://127.0.0.1:8000;" in adaptive_location
    assert nginx.count("client_max_body_size 520m;") == 5
