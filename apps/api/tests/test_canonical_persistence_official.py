import json

import pytest

from fastapi.testclient import TestClient

from test_import_preview_api import client  # noqa: F401
from test_official_samples import official_single_conversation


@pytest.mark.parametrize(
    "payload",
    [official_single_conversation(), [official_single_conversation(), official_single_conversation()]],
)
def test_official_payloads_are_not_persisted(client: TestClient, payload: object) -> None:
    preview = client.post(
        "/api/imports/preview",
        files={"files": ("conversations.json", json.dumps(payload).encode(), "application/json")},
    )
    assert preview.status_code == 422
    assert preview.json()["detail"]["code"] == "unsupported_source_profile"
