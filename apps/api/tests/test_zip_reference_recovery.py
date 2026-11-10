"""Body references are not ZIP members or authority to read outside a ZIP."""
import json
import uuid

import pytest

from app.core.database import get_db
from app.main import app
from app.models.message_version import MessageVersion
from app.services.adaptive_import.archive_sources import (
    _document_references,
    _reference_candidate,
    _rewrite_document_references,
)
from app.services.adaptive_import.contracts import AdaptiveImportError
from test_adaptive_import_api import _complete_analysis, _create, _zip_bytes
from test_import_preview_api import client  # noqa: F401
from test_zip_missing_resources import zip_client  # noqa: F401


@pytest.mark.parametrize("target", [
    "../outside.txt", "../../outside.png", "%2e%2e/outside.txt",
    "%2foutside.png", "assets/%00bad.png", "assets/%253abad.png",
    "folder\\outside.png", "/outside.png", "C:/outside.txt",
    "file:///outside.txt", "%25252foutside.png",
])
def test_unresolvable_body_reference_is_inert_not_a_fake_missing_member(target):
    document_id = str(uuid.uuid4())
    members = {document_id: {
        "member_id": document_id, "path": "conversation.md", "use": "conversation",
    }}
    text = f"# Synthetic\n\n[label]({target})\n\n`[example]({target})`\n"
    problems = []
    found, missing = _document_references(
        text, "conversation.md", set(), on_blocked=lambda line, reason, _: problems.append((line, reason)),
    )
    assert not found and not missing
    assert len(problems) == 1 and problems[0][0] == 3
    rewritten = _rewrite_document_references(text, "conversation.md", members)
    assert "[label](cr-archive-member://" in rewritten
    assert f"`[example]({target})`" in rewritten
    assert rewritten == _rewrite_document_references(text, "conversation.md", members)
    # Strict resolution still rejects the target. Only body consumers recover.
    with pytest.raises(AdaptiveImportError):
        _reference_candidate("conversation.md", target)


def test_safe_parent_reference_external_url_and_heading_keep_their_semantics():
    source = "[local](../assets/note.txt)\n[external](https://example.invalid/x)\n[heading](#here)"
    assert _document_references(source, "nested/one.md", {"assets/note.txt"}) == ({"assets/note.txt"}, set())


def test_body_escape_can_be_reviewed_and_committed_without_reading_outside_zip(zip_client):
    source = _zip_bytes({
        "conversation.md": (
            "# Synthetic reference recovery\n\n## User\nRead this.\n\n## Assistant\n"
            "[Outside](../outside.txt)\n\n![Outside image](%2foutside.png)\n\n"
            "[Present](assets/note.txt)\n\n[Missing](assets/missing.txt)\n"
        ).encode(),
        "manifest.json": json.dumps({
            "version": "1", "messages": [], "assets": [{"path": "assets/note.txt"}],
        }).encode(),
        "assets/note.txt": b"Synthetic present resource.",
    })
    session = _create(zip_client, [("references.zip", source, "application/zip")])
    assert session["state"] == "READY"
    archive = session["archives"][0]
    assert archive["blocked_reference_count"] == 2
    assert archive["missing_attachment_count"] == 1
    catalog = zip_client.get(
        f"/api/adaptive-import/sessions/{session['import_id']}/archives/{archive['artifact_id']}",
    ).json()
    issue = next(row for row in catalog["issues"] if row["code"] == "ZIP_REFERENCE_BLOCKED")
    assert issue["severity"] == "warning"
    assert [example["line"] for example in issue["examples"]] == [7, 9]
    assert [example["reason"] for example in issue["examples"]] == ["outside_archive", "absolute"]
    assert all(example["document_index"] == 1 for example in issue["examples"])
    assert all("outside" not in row["path"] for row in catalog["members"])
    assert zip_client.get("/api/conversations").json() == []
    result = zip_client.post(f"/api/imports/{session['import_id']}/commit")
    assert result.status_code == 200 and result.json()["status"] == "committed", result.text
    assert any(warning.startswith("ZIP blocked references: 2.") for warning in result.json()["warnings"])
    items = zip_client.get(
        f"/api/conversations/{result.json()['conversation_ids'][0]}/attachments",
    ).json()["items"]
    assert {item["original_filename"] for item in items} == {"note.txt", "missing.txt"}
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        text = "\n".join(row.display_text for row in db.query(MessageVersion).all())
        assert "../outside.txt" not in text and "%2foutside.png" not in text
        assert text.count("cr-archive-member://") == 2
    finally:
        db.close()
        generator.close()


def test_explicit_alias_uses_only_verified_zip_member_and_preserves_revision(zip_client):
    source = _zip_bytes({
        "conversation.md": b"# Synthetic\n\n## User\nQuestion\n\n## Assistant\n[One](../note.txt)\n[Again](../note.txt)\n",
        "manifest.json": json.dumps({"version": "1", "messages": [], "assets": []}).encode(),
        "assets/note.txt": b"Verified attachment, not a guessed same-name match.",
    })
    session = _create(zip_client, [("alias.zip", source, "application/zip")])
    archive = session["archives"][0]
    assert archive["blocked_reference_count"] == 2
    url = f"/api/adaptive-import/sessions/{session['import_id']}/archives/{archive['artifact_id']}"
    catalog = zip_client.get(url).json()
    assert len(catalog["unresolved_references"]) == 1
    reference = catalog["unresolved_references"][0]
    assert reference["target_member_id"] is None  # No basename guessing.
    assert reference["lines"] == [7, 8] and reference["reference_count"] == 2
    target = next(item for item in catalog["members"] if item["path"] == "assets/note.txt")
    assert target["use"] == "excluded"
    payload = {"expected_version": catalog["classification_version"], "reference_changes": [{
        "reference_id": reference["reference_id"], "target_member_id": target["member_id"],
    }]}
    result = zip_client.put(url, json=payload)
    assert result.status_code in (200, 202), result.text
    ready = _complete_analysis(zip_client, result.json()) if result.status_code == 202 else result.json()
    assert ready["state"] == "READY"
    assert ready["archives"][0]["blocked_reference_count"] == 0
    assert zip_client.get("/api/conversations").json() == []
    latest = zip_client.get(url).json()
    assert latest["classification_version"] == catalog["classification_version"] + 1
    assert zip_client.put(url, json=payload).status_code == 409
    committed = zip_client.post(f"/api/imports/{session['import_id']}/commit")
    assert committed.status_code == 200, committed.text
    items = zip_client.get(
        f"/api/conversations/{committed.json()['conversation_ids'][0]}/attachments",
    ).json()["items"]
    assert len(items) == 1
    assert zip_client.get(items[0]["content_url"]).content == b"Verified attachment, not a guessed same-name match."


def test_alias_rejects_unowned_identity_and_replaced_source(zip_client):
    from app.models.import_record import ImportRecord
    from app.services.adaptive_import.archive_sources import _artifact_path, update_archive_classification
    source = _zip_bytes({
        "conversation.md": b"# Synthetic\n\n## User\nQuestion\n\n## Assistant\n[file](../note.txt)\n",
        "manifest.json": json.dumps({"version": "1", "messages": [], "assets": []}).encode(),
        "assets/note.txt": b"Safe",
    })
    session = _create(zip_client, [("alias.zip", source, "application/zip")])
    url = f"/api/adaptive-import/sessions/{session['import_id']}/archives/{session['archives'][0]['artifact_id']}"
    catalog = zip_client.get(url).json()
    reference = catalog["unresolved_references"][0]
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        record = db.get(ImportRecord, uuid.UUID(session["import_id"]))
        artifact = next(item for item in record.artifacts if item.source_type == "adaptive_archive")
        for ref, target in [
            (reference["reference_id"], str(uuid.uuid4())),
            (str(uuid.uuid4()), next(item["member_id"] for item in catalog["members"] if item["path"] == "assets/note.txt")),
            (reference["reference_id"], reference["document_member_id"]),
        ]:
            with pytest.raises(AdaptiveImportError):
                update_archive_classification(db, record, artifact, expected_version=catalog["classification_version"],
                                              changes=[], reference_changes=[{"reference_id": ref, "target_member_id": target}])
        with _artifact_path(record, artifact).open("ab") as handle:
            handle.write(b"changed source")
        with pytest.raises(AdaptiveImportError, match="source changed"):
            update_archive_classification(db, record, artifact, expected_version=catalog["classification_version"],
                                          changes=[], reference_changes=[{"reference_id": reference["reference_id"], "target_member_id": None}])
        assert zip_client.get("/api/conversations").json() == []
    finally:
        db.close()
        generator.close()


def test_path_diagnostics_preserve_only_safe_reason_and_ordinal():
    from app.schemas.task import ImportFailureRead
    from app.services.task_errors import import_failure_from_exception, public_import_failure
    error = AdaptiveImportError("ZIP_PATH_UNSAFE", "not public exception text", layer="archive", details={
        "reason": "parent_segment", "entry_index": 2, "path": "not-public", "credentials": "not-public",
    })
    result = import_failure_from_exception(error, stage="analysis")
    assert result == {
        "code": "ZIP_PATH_UNSAFE", "stage": "archive", "retryable": False,
        "details": {"reason": "parent_segment", "entry_index": 2},
    }
    assert ImportFailureRead(**result).model_dump() == result
    assert public_import_failure(result) == result
    assert "details" not in public_import_failure({**result, "details": {"reason": "secret", "entry_index": "secret"}})
