import io
import json
import logging
import zipfile

from fastapi.testclient import TestClient

from app.core.config import get_settings
from test_cr_archive import _run_job
from test_import_preview_api import client  # noqa: F401
from test_message_editing_api import commit_edit_sample


def test_builtin_skills_are_listed(client: TestClient) -> None:
    response = client.get("/api/skills")
    assert response.status_code == 200
    payload = response.json()
    assert {item["source"] for item in payload} == {"BUILTIN"}
    assert {item["category"] for item in payload} == {"EXPORT_CONTEXT", "CONVERSATION_RESCUE"}


def test_uploaded_skill_is_saved_without_auto_selection_and_can_resolve(client: TestClient) -> None:
    response = client.post(
        "/api/skills",
        data={"category": "EXPORT_CONTEXT", "locale": "zh-CN", "name": "我的导出 Skill"},
        files={"file": ("custom.md", b"# custom\nkeep this", "text/markdown")},
    )
    assert response.status_code == 201
    skill = response.json()
    assert skill["source"] == "USER"
    assert skill["is_selected"] is False

    resolved = client.get("/api/skills/resolve?category=EXPORT_CONTEXT&locale=zh-CN")
    assert resolved.status_code == 200
    assert resolved.json()["source"] == "BUILTIN"

    selected = client.put("/api/skills/selections", json={"category": "EXPORT_CONTEXT", "locale": "zh-CN", "skill_id": skill["id"]})
    assert selected.status_code == 204
    resolved = client.get("/api/skills/resolve?category=EXPORT_CONTEXT&locale=zh-CN")
    assert resolved.json()["source"] == "USER"
    assert resolved.json()["content"] == "# custom\nkeep this"
    disabled = client.patch(f"/api/skills/{skill['id']}", json={"status": "DISABLED"})
    assert disabled.status_code == 200
    assert client.get("/api/skills/resolve?category=EXPORT_CONTEXT&locale=zh-CN").json()["source"] == "BUILTIN"


def test_duplicate_and_invalid_skill_files_are_rejected(client: TestClient) -> None:
    body = {"category": "CONVERSATION_RESCUE", "locale": "en", "name": "Custom"}
    assert client.post("/api/skills", data=body, files={"file": ("a.md", b"same", "text/markdown")}).status_code == 201
    assert client.post("/api/skills", data=body, files={"file": ("b.md", b"same", "text/markdown")}).status_code == 409
    assert client.post("/api/skills", data=body, files={"file": ("a.txt", b"text", "text/plain")}).status_code == 422


def test_skill_upload_rejects_empty_binary_and_oversized_payloads(client: TestClient) -> None:
    body = {"category": "EXPORT_CONTEXT", "locale": "en", "name": "Boundary checks"}

    empty = client.post("/api/skills", data=body, files={"file": ("empty.md", b"", "text/markdown")})
    assert empty.status_code == 422
    assert "empty" in empty.json()["detail"].lower()

    for payload in (b"# valid\x00payload", b"# valid\x01payload"):
        binary = client.post("/api/skills", data=body, files={"file": ("binary.md", payload, "text/markdown")})
        assert binary.status_code == 422
        assert "plain" in binary.json()["detail"].lower()

    invalid_utf8 = client.post("/api/skills", data=body, files={"file": ("invalid.md", b"# invalid\xff", "text/markdown")})
    assert invalid_utf8.status_code == 422
    assert "utf-8" in invalid_utf8.json()["detail"].lower()

    oversized = client.post("/api/skills", data=body, files={"file": ("large.md", b"x" * (512 * 1024 + 1), "text/markdown")})
    assert oversized.status_code == 413


def test_skill_name_and_content_are_not_written_to_request_logs(client: TestClient, caplog) -> None:
    caplog.set_level(logging.INFO, logger="chat_reader.request")
    private_name = "private-skill-name-should-not-be-logged"
    private_content = "# private-skill-body-should-not-be-logged"

    response = client.post(
        "/api/skills",
        data={"category": "EXPORT_CONTEXT", "locale": "en", "name": private_name},
        files={"file": ("private.md", private_content.encode("utf-8"), "text/markdown")},
    )

    assert response.status_code == 201
    assert private_name not in caplog.text
    assert private_content not in caplog.text


def test_user_skill_does_not_cross_share_or_offline_data_boundaries(
    client: TestClient,
    monkeypatch,
    tmp_path,
) -> None:
    monkeypatch.setenv("OFFLINE_STORAGE_DIR", str(tmp_path / "offline"))
    get_settings.cache_clear()
    private_name = "private-skill-name-share-offline-boundary"
    private_content = "# private-skill-content-share-offline-boundary"
    uploaded = client.post(
        "/api/skills",
        data={"category": "CONVERSATION_RESCUE", "locale": "en", "name": private_name},
        files={"file": ("private.md", private_content.encode("utf-8"), "text/markdown")},
    )
    assert uploaded.status_code == 201

    sample = commit_edit_sample(client)
    conversation_id = sample["conversation_id"]
    share = client.post(f"/api/conversations/{conversation_id}/shares", json={})
    assert share.status_code == 200
    token = share.json()["token"]
    share_responses = [
        client.get(f"/api/shared/{token}"),
        client.get(f"/api/shared/{token}/message-window"),
        client.get(f"/api/shared/{token}/toc"),
    ]
    assert all(response.status_code == 200 for response in share_responses)

    catalog = client.get("/api/offline/catalog")
    assert catalog.status_code == 200
    queued = client.post(
        "/api/offline/packages",
        json={"scope": "conversation", "conversation_id": conversation_id},
        headers={"Idempotency-Key": "skill-boundary-offline-package"},
    )
    assert queued.status_code == 202
    _run_job(queued.json()["job_id"])
    archive = client.get(f"/api/offline/packages/{queued.json()['package_id']}/download")
    assert archive.status_code == 200
    with zipfile.ZipFile(io.BytesIO(archive.content)) as bundle:
        package_payload = json.loads(bundle.read("package.json"))

    serialized_boundaries = "\n".join(
        [catalog.text, *(response.text for response in share_responses), json.dumps(package_payload, ensure_ascii=False)]
    )
    assert private_name not in serialized_boundaries
    assert private_content not in serialized_boundaries
