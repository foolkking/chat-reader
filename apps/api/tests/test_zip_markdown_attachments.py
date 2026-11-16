"""Markdown resources retain attachment identity, not transcript semantics."""
import hashlib
import io
import json
import uuid
import zipfile
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.core.config import get_settings
from app.models.attachment import Attachment, AssetObject, MessageVersionAttachment
from app.models.conversation import Conversation
from app.models.import_record import ImportRecord
from app.models.message_version import MessageVersion
from app.models.render_block import RenderBlock
from app.services.adaptive_import import memory_budget
from app.services.adaptive_import.archive_sources import (
    _artifact_path, archive_catalog, archive_missing_member, verify_archive_sources,
)
from app.services.adaptive_import.contracts import AdaptiveImportError
from app.services.editing.attachment_integrity import audit_conversation_attachment_integrity
from test_adaptive_import_api import _complete_analysis, _create, _zip_bytes
from test_import_analysis_queue import database
from test_import_preview_api import client  # noqa: F401


NOTE = (
    "# Synthetic attached document\n\n"
    "## User\nThis text belongs to a file.\n\n"
    "## Assistant\nIt must not become another conversation.\n"
).encode()


@pytest.fixture(params=[False, True], ids=["legacy-v1", "bounded-v2"])
def zip_client(client, monkeypatch, request):
    monkeypatch.setenv("IMPORT_BOUNDED_ZIP_ENABLED", str(request.param).lower())
    # Protocol fixtures isolate classification; exact-image CI keeps real probes.
    monkeypatch.setattr(memory_budget, "effective_total_memory_bytes", lambda: 640 * 1024**2)
    monkeypatch.setattr(memory_budget, "process_resident_memory_bytes", lambda: 80 * 1024**2)
    get_settings.cache_clear()
    yield client
    get_settings.cache_clear()


def _transcript(body: str, title: str = "Synthetic transcript") -> bytes:
    return f"# {title}\n\n## User\nRead the file.\n\n## Assistant\n{body}\n".encode()


def _ready(client, session):
    for family in session["families"]:
        if family["handling_class"] != "MAPPABLE":
            continue
        response = client.post(
            f"/api/adaptive-import/sessions/{session['import_id']}/families/{family['id']}/mapping",
            json={"profile_name": "Synthetic ZIP Markdown", "mapping_spec": family["mapping_draft"]},
        )
        assert response.status_code in (200, 202), response.text
        session = response.json()
        if response.status_code == 202:
            session = _complete_analysis(client, session)
    assert session["state"] == "READY", session
    return session


def _catalog(client, session):
    response = client.get(
        f"/api/adaptive-import/sessions/{session['import_id']}/archives/"
        f"{session['archives'][0]['artifact_id']}",
    )
    assert response.status_code == 200, response.text
    return response.json()


def _commit(client, session):
    result = client.post(f"/api/imports/{session['import_id']}/commit")
    assert result.status_code == 200, result.text
    assert result.json()["status"] == "committed", result.json()
    return result.json()


def _classify(client, session, changes, *, reference_changes=None):
    catalog = _catalog(client, session)
    response = client.put(
        f"/api/adaptive-import/sessions/{session['import_id']}/archives/"
        f"{session['archives'][0]['artifact_id']}",
        json={
            "expected_version": catalog["classification_version"],
            "changes": changes, "reference_changes": reference_changes or [],
        },
    )
    assert response.status_code in (200, 202), response.text
    return _complete_analysis(client, response.json()) if response.status_code == 202 else response.json()


def _write_synthetic_catalog(record, artifact, catalog):
    root = _artifact_path(record, artifact).parent
    filename = (artifact.parsed_summary or {}).get("catalog_file") or f"archive-{artifact.id}.json"
    path = root / filename
    assert path.parent == root and path.name == filename
    path.write_text(json.dumps(catalog), encoding="utf-8")


def _assert_occurrence_target(db, occurrence):
    block = db.query(RenderBlock).filter_by(
        message_version_id=occurrence.message_version_id, block_index=occurrence.block_index,
    ).one()
    if block.block_type == "attachment":
        assert block.data["attachmentId"] == str(occurrence.attachment_id)
    else:
        assert block.block_type == "paragraph"
        assert f"cr-asset://{occurrence.attachment_id}" in block.data["text"]


@pytest.mark.parametrize("main,resource,target,wrapper", [
    ("conversation.md", "assets/note.md", "assets/note.md", ""),
    ("conversation.md", "files/note.markdown", "files/note.markdown", ""),
    ("conversation.md", "additional/note.MD", "./additional/note.MD", ""),
    ("nested/conversation.md", "nested/assets/note.md", "assets/note.md", "bundle/"),
    ("conversation.md", "FILES/notes space.MARKDOWN", "FILES/notes%20space.MARKDOWN", "bundle/"),
    ("conversation.md", "ConversationTitle_files/note.md", "ConversationTitle_files/note.md", ""),
    ("conversation.md", "附录/reference.markdown", "附录/reference.markdown", "bundle/"),
    ("nested/conversation.md", "nested/support/docs/note.md", "support/docs/note.md", "bundle/"),
])
def test_referenced_markdown_resource_is_one_real_attachment_not_another_conversation(
    zip_client, main, resource, target, wrapper,
):
    source = _zip_bytes({wrapper + main: _transcript(f"[Read note]({target})"), wrapper + resource: NOTE})
    session = _create(zip_client, [("synthetic.zip", source, "application/zip")])
    assert session["archives"][0]["document_count"] == 1
    assert session["archives"][0]["attachment_count"] == 1
    assert len(session["groups"]) == 1
    catalog = _catalog(zip_client, session)
    document = next(item for item in catalog["members"] if item["path"] == main)
    note = next(item for item in catalog["members"] if item["path"] == resource)
    assert note["kind"] == "markdown"  # Manual reclassification stays available.
    assert note["use"] == "attachment"
    assert note["owner_document_ids"] == note["referenced_by"] == [document["member_id"]]
    assert note["reference_count"] == 1

    ready = _ready(zip_client, session)
    with database() as db:
        record = db.get(ImportRecord, uuid.UUID(ready["import_id"]))
        assert record.draft_summary.get("format_version", 1) == (
            2 if get_settings().import_bounded_zip_enabled else 1
        )
        original = next(item for item in record.artifacts if item.source_type == "adaptive_archive")
        assert _artifact_path(record, original).read_bytes() == source
        derived = [item for item in record.artifacts if item.source_type == "adaptive_archive_document"]
        assert len(derived) == 1 and derived[0].filename == main
    result = _commit(zip_client, ready)
    assert len(result["conversation_ids"]) == 1 and result["message_count"] == 2
    conversation_id = result["conversation_ids"][0]
    items = zip_client.get(f"/api/conversations/{conversation_id}/attachments").json()["items"]
    assert len(items) == 1
    attachment = items[0]
    assert attachment["original_filename"] == Path(resource).name
    assert attachment["source_type"] == "adaptive_zip" and attachment["status"] == "available"
    assert attachment["asset_object"]["sha256"] == hashlib.sha256(NOTE).hexdigest()
    assert attachment["asset_object"]["byte_size"] == len(NOTE)
    for url in (attachment["content_url"], attachment["download_url"]):
        response = zip_client.get(url)
        assert response.status_code == 200 and response.content == NOTE
    with database() as db:
        assert not audit_conversation_attachment_integrity(db, uuid.UUID(conversation_id))
        occurrence = db.query(MessageVersionAttachment).filter_by(
            attachment_id=uuid.UUID(attachment["id"]),
        ).one()
        _assert_occurrence_target(db, occurrence)
        assert db.query(Conversation).count() == 1 and db.query(MessageVersion).count() == 2


def test_shared_markdown_resource_has_each_real_owner_and_occurrence(zip_client):
    source = _zip_bytes({
        "one.md": _transcript("[first](assets/note.md)\n\nAgain [same](assets/note.md)", "One"),
        "two.md": _transcript('<a href="assets/./note.md">second</a>', "Two"),
        "assets/note.md": NOTE,
    })
    session = _create(zip_client, [("shared.zip", source, "application/zip")])
    assert session["archives"][0]["document_count"] == 2
    assert session["archives"][0]["attachment_count"] == 1
    catalog = _catalog(zip_client, session)
    note = next(item for item in catalog["members"] if item["path"] == "assets/note.md")
    owners = {item["member_id"] for item in catalog["members"] if item["use"] == "conversation"}
    assert set(note["owner_document_ids"]) == set(note["referenced_by"]) == owners
    result = _commit(zip_client, _ready(zip_client, session))
    assert len(result["conversation_ids"]) == 2
    with database() as db:
        assert db.query(Attachment).count() == 2 and db.query(AssetObject).count() == 1
        assert db.query(MessageVersionAttachment).count() == 3
        for conversation_id in result["conversation_ids"]:
            assert not audit_conversation_attachment_integrity(db, uuid.UUID(conversation_id))
        for occurrence in db.query(MessageVersionAttachment).all():
            _assert_occurrence_target(db, occurrence)


def test_unreferenced_resource_markdown_is_not_decoded_or_silently_attached(zip_client):
    session = _create(zip_client, [("unused.zip", _zip_bytes({
        "conversation.md": _transcript("Only the transcript is imported."),
        "assets/invalid.md": b"\xff\xfeNot a UTF-8 conversation.",
        "files/unused.markdown": NOTE,
        "arbitrary_docs/invalid.md": b"\xff\xfeNot a transcript either.",
    }), "application/zip")])
    assert session["archives"][0]["document_count"] == 1
    assert session["archives"][0]["attachment_count"] == 0
    catalog = _catalog(zip_client, session)
    assert catalog["unreferenced_count"] == 3
    resources = [item for item in catalog["members"] if item["path"] != "conversation.md"]
    assert all(item["kind"] == "markdown" and item["use"] == "excluded" for item in resources)
    assert all(not item["owner_document_ids"] and not item["referenced_by"] for item in resources)
    result = _commit(zip_client, _ready(zip_client, session))
    assert len(result["conversation_ids"]) == 1
    with database() as db:
        assert db.query(Attachment).count() == 0


def test_arbitrary_subdirectories_are_resources_even_with_transcript_names_and_roles(zip_client):
    session = _create(zip_client, [("subdirectories.zip", _zip_bytes({
        "one.md": _transcript("First real conversation.", "One"),
        "two.markdown": _transcript("Second real conversation.", "Two"),
        "other/conversation.md": NOTE,
        "title_files/deeper/transcript.markdown": NOTE,
        "custom/invalid.md": b"\xff\xfeInvalid text, but not selected as a transcript.",
    }), "application/zip")])
    assert session["archives"][0]["document_count"] == 2
    assert session["archives"][0]["attachment_count"] == 0
    assert all(
        item["use"] == ("excluded" if "/" in item["path"] else "conversation")
        for item in _catalog(zip_client, session)["members"]
    )
    result = _commit(zip_client, _ready(zip_client, session))
    assert len(result["conversation_ids"]) == 2 and result["message_count"] == 4
    with database() as db:
        assert db.query(Attachment).count() == 0


@pytest.mark.parametrize("literal", [
    "`[example](assets/note.md)`",
    "```markdown\n[example](assets/note.md)\n```",
    '<pre><a href="assets/note.md">example</a></pre>',
])
def test_code_example_does_not_make_markdown_resource_a_conversation_or_attachment(zip_client, literal):
    session = _create(zip_client, [("literal.zip", _zip_bytes({
        "conversation.md": _transcript(literal), "assets/note.md": NOTE,
    }), "application/zip")])
    assert session["archives"][0]["document_count"] == 1
    assert session["archives"][0]["attachment_count"] == 0
    note = next(item for item in _catalog(zip_client, session)["members"] if item["path"] == "assets/note.md")
    assert note["use"] == "excluded" and note["reference_count"] == 0
    result = _commit(zip_client, _ready(zip_client, session))
    assert len(result["conversation_ids"]) == 1
    with database() as db:
        assert db.query(Attachment).count() == 0
        assert literal in "\n".join(item.display_text for item in db.query(MessageVersion).all())


@pytest.mark.parametrize("declared,referenced", [(True, True), (True, False), (False, True)])
def test_dedicated_export_retains_manifest_and_referenced_markdown_attachment_semantics(
    zip_client, declared, referenced,
):
    # Even a wrapper called "files" is still an explicit dedicated export.
    session = _create(zip_client, [("export.zip", _zip_bytes({
        "files/conversation.md": _transcript("[note](supplement.md)" if referenced else "No inline file."),
        "files/manifest.json": json.dumps({
            "version": "1", "messages": [{}, {}],
            "assets": [{"path": "supplement.md"}] if declared else [],
        }).encode(),
        "files/supplement.md": NOTE,
    }), "application/zip")])
    assert session["state"] == "READY"
    assert session["archives"][0]["archive_kind"] == "conversation_export"
    assert session["archives"][0]["document_count"] == session["archives"][0]["attachment_count"] == 1
    result = _commit(zip_client, session)
    assert len(result["conversation_ids"]) == 1
    with database() as db:
        attachment = db.query(Attachment).one()
        assert db.query(MessageVersionAttachment).filter_by(attachment_id=attachment.id).count() == int(referenced)
        assert attachment.asset_object.sha256 == hashlib.sha256(NOTE).hexdigest()


@pytest.mark.parametrize("use", ["conversation", "excluded"])
def test_manual_markdown_classification_remains_authoritative_and_version_fenced(zip_client, use):
    session = _create(zip_client, [("review.zip", _zip_bytes({
        "conversation.md": _transcript("[note](assets/note.md)"), "assets/note.md": NOTE,
    }), "application/zip")])
    catalog = _catalog(zip_client, session)
    note = next(item for item in catalog["members"] if item["path"] == "assets/note.md")
    assert note["use"] == "attachment"
    endpoint = (
        f"/api/adaptive-import/sessions/{session['import_id']}/archives/"
        f"{session['archives'][0]['artifact_id']}"
    )
    payload = {"expected_version": catalog["classification_version"], "changes": [{
        "member_id": note["member_id"], "use": use, "owner_document_ids": [],
    }]}
    response = zip_client.put(endpoint, json=payload)
    assert response.status_code in (200, 202), response.text
    updated = response.json()
    if response.status_code == 202:
        updated = _complete_analysis(zip_client, updated)
    assert updated["archives"][0]["document_count"] == (2 if use == "conversation" else 1)
    assert updated["archives"][0]["attachment_count"] == 0
    stale = zip_client.put(endpoint, json=payload)
    assert stale.status_code == 409, stale.text
    assert stale.json()["detail"]["code"] == "ARCHIVE_CLASSIFICATION_STALE"
    result = _commit(zip_client, _ready(zip_client, updated))
    assert len(result["conversation_ids"]) == (2 if use == "conversation" else 1)
    with database() as db:
        assert db.query(Attachment).count() == 0
        assert "cr-archive-member://" in "\n".join(item.display_text for item in db.query(MessageVersion).all())


@pytest.mark.parametrize("explicitly_excluded", [False, True])
def test_explicit_nested_transcript_selection_inspects_its_resources_without_overriding_exclusions(
    zip_client, explicitly_excluded,
):
    session = _create(zip_client, [("explicit.zip", _zip_bytes({
        "one.md": _transcript("First independent transcript.", "One"),
        "nested/two.md": _transcript("[note](support/note.md)", "Two"),
        "nested/support/note.md": NOTE,
    }), "application/zip")])
    assert session["archives"][0]["document_count"] == 1
    catalog = _catalog(zip_client, session)
    endpoint = (
        f"/api/adaptive-import/sessions/{session['import_id']}/archives/"
        f"{session['archives'][0]['artifact_id']}"
    )
    nested = next(item for item in catalog["members"] if item["path"] == "nested/two.md")
    note = next(item for item in catalog["members"] if item["path"] == "nested/support/note.md")
    assert nested["use"] == note["use"] == "excluded"
    if explicitly_excluded:
        response = zip_client.put(endpoint, json={
            "expected_version": catalog["classification_version"],
            "changes": [{"member_id": note["member_id"], "use": "excluded"}],
        })
        assert response.status_code in (200, 202), response.text
        session = response.json()
        if response.status_code == 202:
            session = _complete_analysis(zip_client, session)
        catalog = _catalog(zip_client, session)
    response = zip_client.put(endpoint, json={
        "expected_version": catalog["classification_version"],
        "changes": [{"member_id": nested["member_id"], "use": "conversation"}],
    })
    assert response.status_code in (200, 202), response.text
    session = response.json()
    if response.status_code == 202:
        session = _complete_analysis(zip_client, session)
    assert session["archives"][0]["document_count"] == 2
    assert session["archives"][0]["attachment_count"] == (0 if explicitly_excluded else 1)
    catalog = _catalog(zip_client, session)
    note = next(item for item in catalog["members"] if item["path"] == "nested/support/note.md")
    assert note["referenced_by"] == [nested["member_id"]] and note["reference_count"] == 1
    assert note["owner_document_ids"] == ([] if explicitly_excluded else [nested["member_id"]])
    result = _commit(zip_client, _ready(zip_client, session))
    assert len(result["conversation_ids"]) == 2
    with database() as db:
        assert db.query(Attachment).count() == db.query(MessageVersionAttachment).count() == (
            0 if explicitly_excluded else 1
        )
        for occurrence in db.query(MessageVersionAttachment).all():
            _assert_occurrence_target(db, occurrence)


@pytest.mark.parametrize("paths", [
    ("docs/one.md", "docs/two.markdown"),
    ("assets-old/one.md", "myfiles/two.md"),
    ("assets/one.md", "files/two.md"),
    ("bundle/assets/one.md", "bundle/files/two.md"),
])
def test_independent_markdown_and_resource_named_only_bundles_keep_existing_review(zip_client, paths):
    # No body candidate outside resource folders: directory names alone are
    # not authority to discard all previously importable Markdown documents.
    session = _create(zip_client, [("documents.zip", _zip_bytes({
        paths[0]: _transcript("First independent transcript.", "One"),
        paths[1]: _transcript("Second independent transcript.", "Two"),
    }), "application/zip")])
    assert session["archives"][0]["document_count"] == 2
    assert session["archives"][0]["attachment_count"] == 0
    result = _commit(zip_client, _ready(zip_client, session))
    assert len(result["conversation_ids"]) == 2


def test_link_to_another_ordinary_markdown_conversation_is_not_guessed_as_an_attachment(zip_client):
    session = _create(zip_client, [("cross-links.zip", _zip_bytes({
        "one.md": _transcript("[Other transcript](two.md)", "One"),
        "two.md": _transcript("Second transcript.", "Two"),
    }), "application/zip")])
    assert session["archives"][0]["document_count"] == 2
    assert session["archives"][0]["attachment_count"] == 0
    result = _commit(zip_client, _ready(zip_client, session))
    assert len(result["conversation_ids"]) == 2
    with database() as db:
        assert db.query(Attachment).count() == 0
        assert "cr-archive-member://" in "\n".join(item.display_text for item in db.query(MessageVersion).all())


@pytest.mark.parametrize("entries,expected", [
    ({"conversation.md": _transcript("[note](assets/note.md)"), "assets/note.md": NOTE}, True),
    ({"bundle/conversation.md": _transcript("[note](files/note.markdown)"),
      "bundle/files/note.markdown": NOTE}, True),
    ({"conversation.md": _transcript("[note](arbitrary/note.md)"), "arbitrary/note.md": NOTE}, True),
    ({"one.md": _transcript("One"), "two.md": _transcript("Two")}, False),
    ({"assets/one.md": _transcript("One"), "files/two.md": _transcript("Two")}, False),
    ({"conversation.md": _transcript("One"), "assets/large.md": b"x" * (memory_budget.MAX_TEXT_BYTES + 1)}, True),
])
def test_small_zip_qualification_uses_the_same_selected_documents(entries, expected):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as archive:
        for name, content in entries.items():
            archive.writestr(name, content)
    stream = io.BytesIO(output.getvalue())
    stream.seek(7)
    assert memory_budget._qualifies(stream) is expected
    assert stream.tell() == 7


def test_generic_markdown_attachment_retains_real_legacy_small_zip_admission(client, monkeypatch):
    monkeypatch.setattr(memory_budget, "process_resident_memory_bytes", lambda: 80 * 1024**2)
    monkeypatch.setattr("app.services.uploads.available_memory_bytes", lambda: 192 * 1024**2)
    session = _create(client, [("small.zip", _zip_bytes({
        "conversation.md": _transcript("[note](assets/note.md)"), "assets/note.md": NOTE,
    }), "application/zip")])
    ready = _ready(client, session)
    receipt = ready["analysis_summary"]["small_zip_profile"]
    assert receipt["conversation_count"] == 1
    assert receipt["message_count"] == 2
    assert receipt["attachment_count"] == receipt["reference_count"] == 1
    result = _commit(client, ready)
    assert len(result["conversation_ids"]) == 1 and result["message_count"] == 2


def test_old_available_catalog_without_optional_source_or_classification_fields_still_commits(zip_client):
    session = _ready(zip_client, _create(zip_client, [("old.zip", _zip_bytes({
        "conversation.md": _transcript("[note](support/note.md)"), "support/note.md": NOTE,
    }), "application/zip")]))
    with database() as db:
        record = db.get(ImportRecord, uuid.UUID(session["import_id"]))
        artifact = next(item for item in record.artifacts if item.source_type == "adaptive_archive")
        catalog = archive_catalog(record, artifact.id)
        catalog.pop("source_sha256")
        for member in catalog["members"]:
            member.pop("classification_explicit")
            member.pop("references_inspected")
        _write_synthetic_catalog(record, artifact, catalog)
    result = _commit(zip_client, session)
    assert len(result["conversation_ids"]) == 1 and result["message_count"] == 2
    with database() as db:
        assert db.query(Attachment).one().asset_object.sha256 == hashlib.sha256(NOTE).hexdigest()


def test_enabling_body_in_old_dedicated_catalog_binds_new_missing_resources_to_verified_source(zip_client):
    source = _zip_bytes({
        "conversation.md": _transcript("Original dedicated transcript."),
        "manifest.json": json.dumps({"version": "1", "messages": [{}, {}], "assets": []}).encode(),
        "support/two.md": _transcript("[missing](../missing.txt)", "Explicit second transcript"),
    })
    session = _create(zip_client, [("old-dedicated.zip", source, "application/zip")])
    assert session["archives"][0]["archive_kind"] == "conversation_export"
    with database() as db:
        record = db.get(ImportRecord, uuid.UUID(session["import_id"]))
        artifact = next(item for item in record.artifacts if item.source_type == "adaptive_archive")
        catalog = archive_catalog(record, artifact.id)
        catalog.pop("source_sha256")
        for member in catalog["members"]:
            member.pop("classification_explicit")
            member.pop("references_inspected")
        _write_synthetic_catalog(record, artifact, catalog)
    catalog = _catalog(zip_client, session)
    nested = next(item for item in catalog["members"] if item["path"] == "support/two.md")
    assert nested["use"] == "excluded" and catalog["missing_attachment_count"] == 0
    session = _classify(zip_client, session, [{"member_id": nested["member_id"], "use": "conversation"}])
    catalog = _catalog(zip_client, session)
    assert catalog["source_sha256"] == hashlib.sha256(source).hexdigest()
    missing = next(item for item in catalog["members"] if item["path"] == "missing.txt")
    assert missing["availability"] == "missing" and missing["owner_document_ids"] == [nested["member_id"]]
    result = _commit(zip_client, _ready(zip_client, session))
    assert len(result["conversation_ids"]) == 2 and result["message_count"] == 4
    with database() as db:
        attachment = db.query(Attachment).one()
        assert attachment.status == "missing" and attachment.asset_object is None
        occurrence = db.query(MessageVersionAttachment).filter_by(attachment_id=attachment.id).one()
        _assert_occurrence_target(db, occurrence)


def test_available_source_cache_cannot_authorize_missing_member_without_catalog_binding(zip_client, monkeypatch):
    session = _create(zip_client, [("cache.zip", _zip_bytes({
        "conversation.md": _transcript("[note](support/note.md)\n\n[missing](support/missing.txt)"),
        "support/note.md": NOTE,
    }), "application/zip")])
    with database() as db:
        record = db.get(ImportRecord, uuid.UUID(session["import_id"]))
        artifact = next(item for item in record.artifacts if item.source_type == "adaptive_archive")
        catalog = archive_catalog(record, artifact.id)
        by_path = {item["path"]: item for item in catalog["members"]}
        verified = set()

        def attachment(path):
            member = by_path[path]
            return {"metadata": {
                "archive_artifact_id": str(artifact.id), "archive_member_id": member["member_id"],
                "archive_classification_version": catalog["classification_version"],
            }}

        assert archive_missing_member(record, attachment("support/note.md"), verified) is False
        assert verified
        catalog.pop("source_sha256")
        _write_synthetic_catalog(record, artifact, catalog)
        monkeypatch.setattr(
            "app.services.adaptive_import.bounded_io.file_hash",
            lambda *_: pytest.fail("Cached source should not be rehashed per attachment."),
        )
        with pytest.raises(AdaptiveImportError) as error:
            archive_missing_member(record, attachment("support/missing.txt"), verified)
        assert error.value.code == "ZIP_INVALID"


def test_new_nested_body_scans_missing_and_blocked_references_and_allows_explicit_alias(zip_client):
    session = _create(zip_client, [("new-body.zip", _zip_bytes({
        "one.md": _transcript("First independent transcript.", "One"),
        "nested/two.md": _transcript(
            "[missing](../media/missing.txt)\n\n[unsafe](../../outside.md)\n\n"
            "Again [unsafe](../../outside.md)", "Two",
        ),
        "support/replacement.md": NOTE,
    }), "application/zip")])
    catalog = _catalog(zip_client, session)
    nested = next(item for item in catalog["members"] if item["path"] == "nested/two.md")
    assert nested["use"] == "excluded" and not catalog["unresolved_references"]
    session = _classify(zip_client, session, [{"member_id": nested["member_id"], "use": "conversation"}])
    catalog = _catalog(zip_client, session)
    missing = next(item for item in catalog["members"] if item["path"] == "media/missing.txt")
    assert missing["availability"] == "missing" and missing["owner_document_ids"] == [nested["member_id"]]
    assert catalog["blocked_reference_count"] == 2 and len(catalog["unresolved_references"]) == 1
    reference = catalog["unresolved_references"][0]
    selected_ids = [item["member_id"] for item in catalog["members"] if item["use"] == "conversation"]
    assert reference["document_member_id"] == nested["member_id"]
    assert reference["document_index"] == selected_ids.index(nested["member_id"]) + 1
    assert reference["reference_count"] == 2 and len(reference["lines"]) == 2
    target = next(item for item in catalog["members"] if item["path"] == "support/replacement.md")
    assert target["use"] == "excluded"
    session = _classify(zip_client, session, [], reference_changes=[{
        "reference_id": reference["reference_id"], "target_member_id": target["member_id"],
    }])
    assert session["archives"][0]["blocked_reference_count"] == 0
    result = _commit(zip_client, _ready(zip_client, session))
    assert len(result["conversation_ids"]) == 2
    with database() as db:
        attachments = db.query(Attachment).all()
        assert len(attachments) == 2
        assert {item.status for item in attachments} == {"available", "missing"}
        assert db.query(AssetObject).one().sha256 == hashlib.sha256(NOTE).hexdigest()
        assert db.query(MessageVersionAttachment).count() == 3
        for conversation_id in result["conversation_ids"]:
            assert not audit_conversation_attachment_integrity(db, uuid.UUID(conversation_id))


def test_new_nested_body_cannot_overwrite_explicit_attachment_owner(zip_client):
    session = _create(zip_client, [("owners.zip", _zip_bytes({
        "one.md": _transcript("First independent transcript.", "One"),
        "nested/two.md": _transcript("[note](support/note.md)", "Two"),
        "nested/support/note.md": NOTE,
    }), "application/zip")])
    by_path = {item["path"]: item for item in _catalog(zip_client, session)["members"]}
    one, nested, note = (by_path[path] for path in ("one.md", "nested/two.md", "nested/support/note.md"))
    session = _classify(zip_client, session, [
        {"member_id": note["member_id"], "use": "attachment", "owner_document_ids": [one["member_id"]]},
        {"member_id": nested["member_id"], "use": "conversation"},
    ])
    note = next(item for item in _catalog(zip_client, session)["members"] if item["path"] == note["path"])
    assert note["owner_document_ids"] == [one["member_id"]] and note["referenced_by"] == [nested["member_id"]]
    result = _commit(zip_client, _ready(zip_client, session))
    assert len(result["conversation_ids"]) == 2
    with database() as db:
        assert db.query(Attachment).count() == 1 and db.query(MessageVersionAttachment).count() == 0
        assert "cr-archive-member://" in "\n".join(item.display_text for item in db.query(MessageVersion).all())


def test_reselecting_inspected_body_does_not_duplicate_references_or_lose_explicit_exclusion(zip_client):
    session = _create(zip_client, [("cycle.zip", _zip_bytes({
        "one.md": _transcript("First independent transcript.", "One"),
        "nested/two.md": _transcript("[note](support/note.md)\n\n[unsafe](../../outside.md)", "Two"),
        "nested/support/note.md": NOTE,
    }), "application/zip")])
    by_path = {item["path"]: item for item in _catalog(zip_client, session)["members"]}
    nested, note = by_path["nested/two.md"], by_path["nested/support/note.md"]
    session = _classify(zip_client, session, [{"member_id": nested["member_id"], "use": "conversation"}])
    for _ in range(2):
        session = _classify(zip_client, session, [
            {"member_id": nested["member_id"], "use": "excluded"},
            {"member_id": note["member_id"], "use": "excluded"},
        ])
        session = _classify(zip_client, session, [{"member_id": nested["member_id"], "use": "conversation"}])
        catalog = _catalog(zip_client, session)
        current_note = next(item for item in catalog["members"] if item["member_id"] == note["member_id"])
        assert current_note["use"] == "excluded" and current_note["reference_count"] == 1
        assert current_note["referenced_by"] == [nested["member_id"]]
        assert catalog["blocked_reference_count"] == 1
        assert catalog["unresolved_references"][0]["reference_count"] == 1
    result = _commit(zip_client, _ready(zip_client, session))
    assert len(result["conversation_ids"]) == 2
    with database() as db:
        assert db.query(Attachment).count() == 0


@pytest.mark.parametrize("entrypoint", ["http", "worker"])
def test_enabling_nested_body_requires_standard_legacy_admission_and_preserves_current_plan(client, monkeypatch, entrypoint):
    from app.services.adaptive_import.operations import operation_admission
    from app.services.uploads import UploadLimitError

    session = _create(client, [("admission.zip", _zip_bytes({
        "one.md": _transcript("First independent transcript.", "One"),
        "nested/two.md": _transcript("Second independent transcript.", "Two"),
    }), "application/zip")])
    catalog = _catalog(client, session)
    archive_id = session["archives"][0]["artifact_id"]
    nested = next(item for item in catalog["members"] if item["path"] == "nested/two.md")
    arguments = {
        "artifact_id": archive_id, "expected_version": catalog["classification_version"],
        "changes": [{"member_id": nested["member_id"], "use": "conversation"}],
    }
    monkeypatch.setattr(memory_budget, "process_resident_memory_bytes", lambda: 80 * 1024**2)
    monkeypatch.setattr("app.services.uploads.available_memory_bytes", lambda: 192 * 1024**2)
    if entrypoint == "http":
        with monkeypatch.context() as patch:
            patch.setattr(
                "app.api.routes.adaptive_imports.reclassify_archive",
                lambda *_args, **_kwargs: pytest.fail("New body entered parsing before normal admission."),
            )
            response = client.put(
                f"/api/adaptive-import/sessions/{session['import_id']}/archives/{archive_id}",
                json={key: value for key, value in arguments.items() if key != "artifact_id"},
            )
        assert response.status_code == 429, response.text
        assert response.json()["detail"]["code"] == "UPLOAD_MEMORY_PRESSURE"
    else:
        with database() as db:
            record = db.get(ImportRecord, uuid.UUID(session["import_id"]))
            with pytest.raises(UploadLimitError) as error:
                with operation_admission(db, record, {"operation": "classification", "arguments": arguments}):
                    pytest.fail("Worker borrowed the old one-body proof.")
            assert error.value.code == "UPLOAD_MEMORY_PRESSURE"
    assert _catalog(client, session) == catalog
    assert client.get("/api/conversations").json() == []
    monkeypatch.setattr("app.services.uploads.available_memory_bytes", lambda: 1024 * 1024**2)
    session = _classify(client, session, arguments["changes"])
    assert session["archives"][0]["document_count"] == 2
    monkeypatch.setattr("app.services.uploads.available_memory_bytes", lambda: 192 * 1024**2)
    with database() as db:
        record = db.get(ImportRecord, uuid.UUID(session["import_id"]))
        with pytest.raises(UploadLimitError) as error:
            with memory_budget.sequential_analysis_admission(db, record):
                pytest.fail("Current two-body selection borrowed the initial one-body proof.")
        assert error.value.code == "UPLOAD_MEMORY_PRESSURE"


@pytest.mark.parametrize("failure", ["crc", "scanner", "source_changed"])
def test_late_markdown_attachment_failure_cannot_publish_another_transcript_from_the_same_zip(zip_client, monkeypatch, failure):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr("one.md", _transcript("First transcript without attachments.", "One"))
        archive.writestr("two.md", _transcript("[note](support/note.md)", "Two"))
        archive.writestr("support/note.md", NOTE)
    source = output.getvalue()
    if failure == "crc":
        damaged = bytearray(source)
        with zipfile.ZipFile(io.BytesIO(source)) as archive:
            info = archive.getinfo("support/note.md")
            start = info.header_offset + 30 + len(info.filename.encode()) + len(info.extra)
        damaged[start] ^= 1
        source = bytes(damaged)
    session = _ready(zip_client, _create(zip_client, [("atomic.zip", source, "application/zip")]))
    assert session["archives"][0]["document_count"] == 2
    if failure == "scanner":
        monkeypatch.setattr(
            "app.services.canonical.persistence.scan_attachment",
            lambda _: SimpleNamespace(status="rejected", allowed_by_policy=False),
        )
    with database() as db:
        record = db.get(ImportRecord, uuid.UUID(session["import_id"]))
        artifact = next(item for item in record.artifacts if item.source_type == "adaptive_archive")
        path = _artifact_path(record, artifact)
    if failure == "source_changed":
        with path.open("ab") as handle:
            handle.write(b"Synthetic replacement.")
    retained = path.read_bytes()
    result = zip_client.post(f"/api/imports/{session['import_id']}/commit")
    assert result.status_code >= 400 or result.json()["status"] != "committed", result.text
    with database() as db:
        assert db.query(Conversation).count() == db.query(Attachment).count() == 0
    assert path.read_bytes() == retained


def test_changed_zip_without_attachments_cannot_commit_its_stale_transcript(zip_client):
    session = _ready(zip_client, _create(zip_client, [("no-files.zip", _zip_bytes({
        "conversation.md": _transcript("A transcript without an attachment."),
    }), "application/zip")]))
    with database() as db:
        record = db.get(ImportRecord, uuid.UUID(session["import_id"]))
        artifact = next(item for item in record.artifacts if item.source_type == "adaptive_archive")
        path = _artifact_path(record, artifact)
    with path.open("ab") as handle:
        handle.write(b"Synthetic replacement.")
    retained = path.read_bytes()
    result = zip_client.post(f"/api/imports/{session['import_id']}/commit")
    assert result.status_code >= 400 or result.json()["status"] != "committed", result.text
    with database() as db:
        assert db.query(Conversation).count() == db.query(Attachment).count() == 0
    assert path.read_bytes() == retained


def test_referenced_non_utf8_markdown_is_preserved_as_attachment_bytes_not_decoded_as_a_transcript(zip_client):
    content = b"\xff\xfeSynthetic bytes, not a UTF-8 transcript."
    session = _create(zip_client, [("binary-markdown.zip", _zip_bytes({
        "conversation.md": _transcript("[file](custom/note.md)"), "custom/note.md": content,
    }), "application/zip")])
    assert session["archives"][0]["document_count"] == session["archives"][0]["attachment_count"] == 1
    result = _commit(zip_client, _ready(zip_client, session))
    items = zip_client.get(f"/api/conversations/{result['conversation_ids'][0]}/attachments").json()["items"]
    assert len(items) == 1 and items[0]["asset_object"]["sha256"] == hashlib.sha256(content).hexdigest()
    assert zip_client.get(items[0]["download_url"]).content == content


def test_source_verification_cache_is_shared_across_documents_and_attachment_checks(zip_client, monkeypatch):
    from app.services.adaptive_import.bounded_io import file_hash

    session = _create(zip_client, [("verified.zip", _zip_bytes({
        "one.md": _transcript("[note](custom/note.md)", "One"),
        "two.md": _transcript("[note](custom/note.md)", "Two"),
        "custom/note.md": NOTE,
    }), "application/zip")])
    with database() as db:
        record = db.get(ImportRecord, uuid.UUID(session["import_id"]))
        artifact = next(item for item in record.artifacts if item.source_type == "adaptive_archive")
        source = _artifact_path(record, artifact)
        reads = []

        def counted_hash(path):
            if path == source:
                reads.append(path)
            return file_hash(path)

        monkeypatch.setattr("app.services.adaptive_import.bounded_io.file_hash", counted_hash)
        verified = set()
        verify_archive_sources(record, verified)
        verify_archive_sources(record, verified)
        catalog = archive_catalog(record, artifact.id)
        note = next(item for item in catalog["members"] if item["path"] == "custom/note.md")
        assert len(note["owner_document_ids"]) == 2
        for _ in note["owner_document_ids"]:
            assert archive_missing_member(record, {"metadata": {
                "archive_artifact_id": str(artifact.id), "archive_member_id": note["member_id"],
                "archive_classification_version": catalog["classification_version"],
            }}, verified) is False
        assert reads == [source]


def test_blocked_reference_ordinal_tracks_current_selected_document_layer_after_demotion(zip_client):
    session = _create(zip_client, [("ordinals.zip", _zip_bytes({
        "one.md": _transcript("[unsafe](../outside.md)", "One"),
        "nested/two.md": _transcript("Second independent transcript.", "Two"),
    }), "application/zip")])
    catalog = _catalog(zip_client, session)
    nested = next(item for item in catalog["members"] if item["path"] == "nested/two.md")
    session = _classify(zip_client, session, [{"member_id": nested["member_id"], "use": "conversation"}])
    catalog = _catalog(zip_client, session)
    assert catalog["unresolved_references"][0]["document_index"] == 2
    session = _classify(zip_client, session, [{"member_id": nested["member_id"], "use": "excluded"}])
    catalog = _catalog(zip_client, session)
    assert catalog["document_count"] == 1
    assert catalog["unresolved_references"][0]["document_index"] == 1
    issue = next(item for item in catalog["issues"] if item["code"] == "ZIP_REFERENCE_BLOCKED")
    assert all(example["document_index"] == 1 for example in issue["examples"])


@pytest.mark.parametrize("headroom", [None, 192 * 1024**2])
def test_stale_classification_returns_refresh_conflict_before_memory_admission(zip_client, monkeypatch, headroom):
    session = _create(zip_client, [("stale.zip", _zip_bytes({
        "conversation.md": _transcript("[note](custom/note.md)"), "custom/note.md": NOTE,
    }), "application/zip")])
    catalog = _catalog(zip_client, session)
    note = next(item for item in catalog["members"] if item["path"] == "custom/note.md")
    changes = [{"member_id": note["member_id"], "use": "excluded"}]
    session = _classify(zip_client, session, changes)
    current = _catalog(zip_client, session)
    monkeypatch.setattr("app.services.uploads.available_memory_bytes", lambda: headroom)
    response = zip_client.put(
        f"/api/adaptive-import/sessions/{session['import_id']}/archives/"
        f"{session['archives'][0]['artifact_id']}",
        json={"expected_version": catalog["classification_version"], "changes": changes},
    )
    assert response.status_code == 409, response.text
    assert response.json()["detail"]["code"] == "ARCHIVE_CLASSIFICATION_STALE"
    assert _catalog(zip_client, session) == current
    assert zip_client.get("/api/conversations").json() == []


def test_non_zip_commit_does_not_enter_archive_source_verification(client, monkeypatch):
    from test_import_analysis_queue import source

    calls = []
    monkeypatch.setattr(
        "app.services.canonical.persistence.verify_archive_sources",
        lambda record, _verified: calls.append(record.id),
    )
    session = _ready(client, _create(client, [("non-zip.json", source(), "application/json")]))
    result = _commit(client, session)
    assert len(result["conversation_ids"]) == 1
    assert calls == []


@pytest.mark.parametrize("failure", ["crc", "scanner", "source_changed"])
def test_markdown_attachment_identity_does_not_bypass_integrity_or_atomic_commit(zip_client, monkeypatch, failure):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr("conversation.md", _transcript("[note](assets/note.md)"))
        archive.writestr("assets/note.md", NOTE)
    source = output.getvalue()
    if failure == "crc":
        damaged = bytearray(source)
        with zipfile.ZipFile(io.BytesIO(source)) as archive:
            info = archive.getinfo("assets/note.md")
            start = info.header_offset + 30 + len(info.filename.encode()) + len(info.extra)
        damaged[start] ^= 1
        source = bytes(damaged)
    session = _create(zip_client, [("integrity.zip", source, "application/zip")])
    assert session["archives"][0]["document_count"] == 1
    ready = _ready(zip_client, session)
    if failure == "scanner":
        monkeypatch.setattr(
            "app.services.canonical.persistence.scan_attachment",
            lambda _: SimpleNamespace(status="rejected", allowed_by_policy=False),
        )
    with database() as db:
        record = db.get(ImportRecord, uuid.UUID(ready["import_id"]))
        original = next(item for item in record.artifacts if item.source_type == "adaptive_archive")
        path = _artifact_path(record, original)
        assert path.read_bytes() == source
        if failure == "source_changed":
            with path.open("ab") as handle:
                handle.write(b"Synthetic replacement.")
        retained = path.read_bytes()
    result = zip_client.post(f"/api/imports/{ready['import_id']}/commit")
    assert result.status_code >= 400 or result.json()["status"] != "committed", result.text
    with database() as db:
        assert db.query(Conversation).count() == db.query(Attachment).count() == 0
    assert path.read_bytes() == retained
