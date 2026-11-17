import uuid

from app.core.database import get_db
from app.main import app
from app.models.import_record import ImportRecord
from test_adaptive_import_api import _create, _json_bytes, _save_mapping
from test_import_preview_api import client  # noqa: F401
from test_adaptive_import_api import _zip_bytes
from pathlib import Path
from app.core.config import get_settings


def preview(client, session, **params):
    return client.get(
        f"/api/adaptive-import/sessions/{session['import_id']}/groups/{session['groups'][0]['id']}/source-preview",
        params={"expected_updated_at": session["updated_at"], **params},
    )


def test_reusing_format_never_reuses_source_name_or_body(client):
    first = _create(client, [("A.json", _json_bytes(body="unique source A"), "application/json")])
    first = _save_mapping(client, first, "A old filename")
    sessions = [("A", first)]
    for name in ("B", "C"):
        current = _create(client, [(f"{name}.json", _json_bytes(body=f"unique source {name}"), "application/json")])
        sessions.append((name, current))
        assert current["families"][0]["display_name"] == "A old filename"
        result = preview(client, current)
        assert result.status_code == 200, result.text
        result = result.json()
        assert result["sources"][0]["filename"] == f"{name}.json"
        assert result["preview"]["messages"][0]["content"] == f"unique source {name}"
        assert result["import_id"] == current["import_id"]
        assert all("_source_preview" not in group["profile_resolution"] for group in current["groups"])
    names = [item["title"] for item in client.get("/api/adaptive-import/sessions").json()["items"]]
    assert set(names) == {"A.json", "B.json", "C.json"}
    # Preview labels alone cannot prove isolation. Exercise the real canonical
    # commit and read its persisted message versions for every reused format.
    conversation_ids = []
    for name, session in sessions:
        committed = client.post(f"/api/imports/{session['import_id']}/commit")
        assert committed.status_code == 200, committed.text
        assert committed.json()["status"] == "committed"
        identifiers = committed.json()["conversation_ids"]
        assert len(identifiers) == 1
        conversation_ids.extend(identifiers)
        detail = client.get(f"/api/conversations/{identifiers[0]}/messages?include_blocks=true")
        assert detail.status_code == 200, detail.text
        assert [row["current_version"]["display_text"] for row in detail.json()] == [
            f"unique source {name}", "World",
        ]
    assert len(set(conversation_ids)) == 3
    assert client.get("/api/adaptive-import/sessions").json()["items"] == []


def test_preview_rejects_wrong_session_version_and_binding(client):
    current = _save_mapping(client, _create(client, [("same.json", _json_bytes(), "application/json")]))
    assert preview(client, current, expected_updated_at="2001-01-01T00:00:00Z").status_code == 409
    assert client.get(
        f"/api/adaptive-import/sessions/{uuid.uuid4()}/groups/{current['groups'][0]['id']}/source-preview",
        params={"expected_updated_at": current["updated_at"]},
    ).status_code == 404
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    record = db.get(ImportRecord, uuid.UUID(current["import_id"]))
    group = record.input_groups[0]
    saved = group.profile_resolution["_source_preview"]
    group.profile_resolution = {**group.profile_resolution, "_source_preview": {
        **saved, "binding": {**saved["binding"], "source_fingerprint": "foreign"},
    }}
    db.commit()
    db.close()
    generator.close()
    assert preview(client, current).status_code == 409
    response = client.post(f"/api/imports/{current['import_id']}/commit")
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "PREVIEW_SOURCE_MISMATCH"


def test_discard_finishes_without_deleting_saved_format(client):
    current = _save_mapping(client, _create(client, [("discard.json", _json_bytes(), "application/json")]))
    assert "discard" in current["allowed_actions"]
    assert client.delete(f"/api/adaptive-import/sessions/{current['import_id']}").status_code == 204
    result = client.get(f"/api/adaptive-import/sessions/{current['import_id']}").json()
    assert result["state"] == "CANCELED"
    assert result["source_cleanup"]["state"] == "completed"
    assert "discard" not in result["allowed_actions"]
    reused = _create(client, [("retained-format.json", _json_bytes(body="different"), "application/json")])
    assert reused["state"] == "READY"


def test_discard_rejects_stale_version_without_removing_sources(client):
    current = _save_mapping(client, _create(client, [("same.json", _json_bytes(), "application/json")]))
    endpoint = f"/api/adaptive-import/sessions/{current['import_id']}"
    refused = client.delete(endpoint, params={"expected_updated_at": "2001-01-01T00:00:00Z"})
    assert refused.status_code == 409
    assert client.get(endpoint).json()["source_available"] is True
    assert preview(client, current).status_code == 200
    assert client.delete(endpoint, params={"expected_updated_at": current["updated_at"]}).status_code == 204
    assert client.get(endpoint).json()["source_cleanup"]["state"] == "completed"


def test_zip_preview_binds_archive_member_and_never_reuses_same_named_batch(client):
    identities = []
    conversation_ids = []
    for marker in ("A", "B", "C"):
        body = f"# Source {marker}\n\n## User\n\nOnly source {marker}\n\n## Assistant\n\nReply {marker}\n".encode()
        current = _create(client, [("same.zip", _zip_bytes({"conversation.md": body, "files/notes.md": b"attachment only"}), "application/zip")])
        if marker == "A":
            assert current["state"] == "RESOLVING"
            current = _save_mapping(client, current, "Old source A format")
        assert current["state"] == "READY"
        result = preview(client, current)
        assert result.status_code == 200, result.text
        value = result.json()
        assert value["sources"][0]["archive"]["artifact_id"]
        assert value["sources"][0]["archive"]["member_id"]
        assert value["sources"][0]["archive"]["path"] == "conversation.md"
        assert marker in str(value["preview"])
        assert "attachment only" not in str(value["preview"])
        identities.append(value["sources"][0]["archive"]["sha256"])
        committed = client.post(f"/api/imports/{current['import_id']}/commit")
        assert committed.status_code == 200, committed.text
        assert committed.json()["status"] == "committed"
        identifiers = committed.json()["conversation_ids"]
        assert len(identifiers) == 1
        conversation_ids.extend(identifiers)
        detail = client.get(f"/api/conversations/{identifiers[0]}/messages?include_blocks=true")
        assert detail.status_code == 200, detail.text
        assert [row["current_version"]["display_text"].strip() for row in detail.json()] == [
            f"Only source {marker}", f"Reply {marker}",
        ]
    assert len(set(identities)) == 3
    assert len(set(conversation_ids)) == 3


def test_missing_or_tampered_preview_offers_explicit_repair_not_reparse(client):
    current = _save_mapping(client, _create(client, [("repair.json", _json_bytes(), "application/json")]))
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    record = db.get(ImportRecord, uuid.UUID(current["import_id"]))
    filename = record.input_groups[0].profile_resolution["_source_preview"]["filename"]
    path = Path(get_settings().import_storage_dir) / current["import_id"] / "source-previews" / filename
    path.write_text('{"tampered":true}', encoding="utf-8")
    assert preview(client, current).status_code == 409
    assert path.read_text(encoding="utf-8") == '{"tampered":true}'
    state = client.get(f"/api/adaptive-import/sessions/{current['import_id']}").json()
    assert "rebuild_preview" in state["allowed_actions"]
    db.close()
    generator.close()


def test_failed_cleanup_remains_in_batch_manager_and_never_reports_completed(client, monkeypatch):
    current = _save_mapping(client, _create(client, [("failed-cleanup.json", _json_bytes(), "application/json")]))
    import app.services.adaptive_import.service as service
    def fail(*args, **kwargs):
        raise OSError("Synthetic cleanup failure")
    monkeypatch.setattr(service, "remove_session_files", fail)
    assert client.delete(f"/api/adaptive-import/sessions/{current['import_id']}").status_code == 204
    state = client.get(f"/api/adaptive-import/sessions/{current['import_id']}").json()
    assert state["state"] == "CANCELED" and state["source_cleanup"]["state"] == "failed"
    rows = client.get("/api/adaptive-import/sessions").json()["items"]
    assert len(rows) == 1 and rows[0]["import_id"] == current["import_id"]
    assert "discard" not in rows[0]["allowed_actions"]
