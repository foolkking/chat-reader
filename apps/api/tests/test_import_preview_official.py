import json

import pytest
from fastapi.testclient import TestClient

from test_import_preview_api import client  # noqa: F401
from test_official_samples import official_single_conversation


@pytest.mark.parametrize(
    "payload",
    [official_single_conversation(), [official_single_conversation(), official_single_conversation()]],
)
def test_preview_official_json_is_rejected(client: TestClient, payload: object) -> None:
    response = client.post(
        "/api/imports/preview",
        files={"files": ("conversations.json", json.dumps(payload).encode(), "application/json")},
    )

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["code"] == "unsupported_source_profile"
    assert any("no longer supported" in warning for warning in detail["warnings"])


def test_exporter_preview_still_works(client: TestClient) -> None:
    response = client.post(
        "/api/imports/preview",
        files={
            "files": (
                "export.json",
                b'{"metadata":{"powered_by":"ChatGPT Exporter"},"messages":[{"role":"Prompt","say":"hi"}]}',
                "application/json",
            )
        },
    )

    assert response.status_code == 200
    assert response.json()["conversation_preview"]["source_profile"] == "chatgpt_exporter_json"
