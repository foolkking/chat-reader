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
    assert file_payload["raw_storage_uri"]

    artifacts_response = client.get(f"/api/imports/{payload['import_id']}/source-artifacts")
    assert artifacts_response.status_code == 200
    artifacts = artifacts_response.json()
    assert len(artifacts) == 1
    assert artifacts[0]["artifact_id"] == file_payload["artifact_id"]
    assert artifacts[0]["raw_storage_uri"] == file_payload["raw_storage_uri"]

    warnings_response = client.get(f"/api/imports/{payload['import_id']}/warnings")
    assert warnings_response.status_code == 200
    assert warnings_response.json() == {"import_id": payload["import_id"], "warnings": []}


def test_preview_saves_raw_file(client: TestClient, tmp_path: Path) -> None:
    response = client.post(
        "/api/imports/preview",
        files={"files": ("../unsafe.json", b'{"messages":[{"content":"hello"}]}', "application/json")},
    )

    assert response.status_code == 200
    payload = response.json()
    stored_files = list((tmp_path / "storage" / "imports").glob(f"{payload['import_id']}/*"))
    assert len(stored_files) == 1
    assert stored_files[0].name == "unsafe.json"


def test_preview_empty_file_returns_400(client: TestClient) -> None:
    response = client.post(
        "/api/imports/preview",
        files={"files": ("empty.json", b"", "application/json")},
    )

    assert response.status_code == 400


def test_preview_unsupported_extension_returns_400(client: TestClient) -> None:
    response = client.post(
        "/api/imports/preview",
        files={"files": ("payload.exe", b"data", "application/octet-stream")},
    )

    assert response.status_code == 400
