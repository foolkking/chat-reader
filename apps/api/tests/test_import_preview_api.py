from collections.abc import Generator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings
from app.core.database import Base, get_db
from app.main import app


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Generator[TestClient, None, None]:
    monkeypatch.setenv("IMPORT_STORAGE_DIR", str(tmp_path / "storage" / "imports"))
    monkeypatch.setenv("EXPORT_STORAGE_DIR", str(tmp_path / "storage" / "exports"))
    monkeypatch.setenv("IMPORT_COMMIT_INLINE", "true")
    get_settings.cache_clear()

    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}")
    testing_session_local = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    Base.metadata.create_all(bind=engine)

    def override_get_db() -> Generator[Session, None, None]:
        db = testing_session_local()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db

    with TestClient(app) as test_client:
        yield test_client

    app.dependency_overrides.clear()
    get_settings.cache_clear()


def test_preview_exporter_json_and_read_artifacts(client: TestClient) -> None:
    response = client.post(
        "/api/imports/preview",
        files={
            "files": (
                "export.json",
                b'{"metadata":{"powered_by":"ChatGPT Exporter"},"messages":[]}',
                "application/json",
            )
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["import_id"]
    assert payload["status"] == "previewed"
    assert len(payload["files"]) == 1

    file_payload = payload["files"][0]
    assert file_payload["artifact_id"]
    assert file_payload["source_profile"] == "chatgpt_exporter_json"
    assert file_payload["sha256"]
    assert "raw_storage_uri" not in file_payload

    artifacts_response = client.get(f"/api/imports/{payload['import_id']}/source-artifacts")
    assert artifacts_response.status_code == 200
    artifacts = artifacts_response.json()
    assert len(artifacts) == 1
    assert artifacts[0]["artifact_id"] == file_payload["artifact_id"]
    assert "raw_storage_uri" not in artifacts[0]

    warnings_response = client.get(f"/api/imports/{payload['import_id']}/warnings")
    assert warnings_response.status_code == 200
    assert warnings_response.json() == {"import_id": payload["import_id"], "warnings": []}


def test_preview_saves_raw_file(client: TestClient, tmp_path: Path) -> None:
    response = client.post(
        "/api/imports/preview",
        files={
            "files": (
                "../unsafe.json",
                b'{"metadata":{},"messages":[{"role":"Prompt","say":"hello"}]}',
                "application/json",
            )
        },
    )

    assert response.status_code == 200
    payload = response.json()
    stored_files = list((tmp_path / "storage" / "imports").glob(f"{payload['import_id']}/*"))
    assert {path.name for path in stored_files} == {"unsafe.json", "canonical-draft.jsonl"}
    assert all(path.parent.name == payload["import_id"] for path in stored_files)


def test_preview_empty_file_returns_400(client: TestClient) -> None:
    response = client.post(
        "/api/imports/preview",
        files={"files": ("empty.json", b"", "application/json")},
    )

    assert response.status_code == 400


def test_preview_accepts_a_file_at_the_configured_limit(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MAX_IMPORT_FILE_SIZE_MB", "1")
    get_settings.cache_clear()
    prefix = b'{"metadata":{"powered_by":"ChatGPT Exporter","padding":"'
    suffix = b'"},"messages":[]}'
    content = prefix + (b"x" * (1024 * 1024 - len(prefix) - len(suffix))) + suffix

    response = client.post(
        "/api/imports/preview",
        files={"files": ("export.json", content, "application/json")},
    )

    assert len(content) == 1024 * 1024
    assert response.status_code == 200, response.text


def test_preview_rejects_a_file_over_the_configured_limit(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MAX_IMPORT_FILE_SIZE_MB", "1")
    get_settings.cache_clear()

    response = client.post(
        "/api/imports/preview",
        files={"files": ("export.json", b"x" * (1024 * 1024 + 1), "application/json")},
    )

    assert response.status_code == 413


@pytest.mark.parametrize(
    ("filename", "content", "mime_type"),
    [
        ("payload.exe", b"data", "application/octet-stream"),
        ("export.csv", b"role,content\nuser,hello\n", "text/csv"),
        ("notes.txt", b"plain transcript", "text/plain"),
    ],
)
def test_preview_removed_or_unsupported_profiles_return_422(
    client: TestClient,
    filename: str,
    content: bytes,
    mime_type: str,
) -> None:
    response = client.post(
        "/api/imports/preview",
        files={"files": (filename, content, mime_type)},
    )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "unsupported_source_profile"


def test_removed_crbundle_product_route_is_not_exposed(client: TestClient) -> None:
    response = client.post(
        "/api/imports/bundles/preview",
        files={"file": ("removed.crbundle", b"not-a-product-input", "application/octet-stream")},
    )

    assert response.status_code == 404
