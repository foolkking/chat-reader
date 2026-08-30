from fastapi.testclient import TestClient

from test_import_preview_api import client  # noqa: F401


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
