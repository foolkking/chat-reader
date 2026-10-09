from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.services.editing.message_edit_service import MAX_EDIT_TEXT_LENGTH, MessageEditError, _validate_text
from test_import_preview_api import client  # noqa: F401


BODIES = [
    "    Synthetic code",
    "\tSynthetic tab\n",
    "\n\nSynthetic paragraph\n\n",
    "```text\n  Synthetic line\n    ",
    "  合成内容🙂  \n",
]


@pytest.mark.parametrize("body", BODIES)
def test_validator_preserves_exact_markdown(body: str) -> None:
    assert _validate_text(body) == body


@pytest.mark.parametrize("body", ["", " \n\t", "\u3000\n"])
def test_validator_still_rejects_blank_source(body: str) -> None:
    with pytest.raises(MessageEditError, match="cannot be empty"):
        _validate_text(body)


def test_validator_counts_original_source_including_whitespace() -> None:
    assert _validate_text("🙂" * MAX_EDIT_TEXT_LENGTH) == "🙂" * MAX_EDIT_TEXT_LENGTH
    with pytest.raises(MessageEditError, match="too large"):
        _validate_text(" " + "x" * MAX_EDIT_TEXT_LENGTH)


def test_validator_reports_transient_upload_at_original_line() -> None:
    with pytest.raises(MessageEditError) as error:
        _validate_text("\n\n[Uploading](cr-upload://synthetic-upload)\n")
    assert error.value.detail["code"] == "transient_upload_reference"
    assert error.value.detail["line_number"] == 3


def create_manual(client: TestClient, first: str = "Synthetic original", second: str = "Synthetic answer") -> dict:
    result = client.post("/api/conversations", json={
        "title": "Synthetic Markdown fidelity",
        "messages": [{"role": "user", "content_markdown": first}, {"role": "assistant", "content_markdown": second}],
    })
    assert result.status_code == 201, result.text
    return result.json()


def assert_source(client: TestClient, message_id: str, expected: str) -> dict:
    response = client.get(f"/api/messages/{message_id}")
    assert response.status_code == 200
    detail = response.json()
    assert detail["current_version"]["display_text"] == expected
    assert detail["current_version"]["plain_text"] == expected
    assert detail["char_count"] == len(expected)
    return detail


def test_create_and_insert_round_trip_exact_source(client: TestClient) -> None:
    first, second = BODIES[0], BODIES[3]
    created = create_manual(client, first, second)
    for message, body in zip(created["messages"], [first, second], strict=True):
        assert_source(client, message["id"], body)
    inserted = client.post(f"/api/conversations/{created['conversation']['id']}/messages/insert", json={
        "anchor_message_id": created["messages"][1]["id"], "position": "after", "mode": "pair",
        "expected_offline_revision": created["conversation"]["offline_revision"],
        "messages": [{"role": "user", "content_markdown": BODIES[1]}, {"role": "assistant", "content_markdown": BODIES[4]}],
    })
    assert inserted.status_code == 201, inserted.text
    for message, body in zip(inserted.json()["messages"], [BODIES[1], BODIES[4]], strict=True):
        assert_source(client, message["id"], body)


def test_edit_whitespace_and_replace_current_preserve_history_and_version_guard(client: TestClient) -> None:
    created = create_manual(client)
    message = created["messages"][0]
    original = assert_source(client, message["id"], "Synthetic original")["current_version"]
    edited_body = "    Synthetic original\n"
    edited = client.patch(f"/api/messages/{message['id']}", json={
        "content_markdown": edited_body, "base_version_id": original["id"],
    })
    assert edited.status_code == 200, edited.text
    assert edited.json()["version_number"] == 2
    current = assert_source(client, message["id"], edited_body)["current_version"]
    replacement = "\n    Synthetic original  \n"
    replaced = client.patch(f"/api/messages/{message['id']}", json={
        "content_markdown": replacement, "base_version_id": current["id"], "save_mode": "replace_current",
    })
    assert replaced.status_code == 200, replaced.text
    assert replaced.json()["current_version_id"] == current["id"]
    assert replaced.json()["version_number"] == 2
    assert_source(client, message["id"], replacement)
    unchanged = client.patch(f"/api/messages/{message['id']}", json={"content_markdown": replacement})
    assert unchanged.status_code == 400
    stale = client.patch(f"/api/messages/{message['id']}", json={
        "content_markdown": "Synthetic stale edit", "base_version_id": original["id"],
    })
    assert stale.status_code == 409
    history = client.get(f"/api/messages/{message['id']}/versions")
    assert history.status_code == 200
    assert next(item for item in history.json()["items"] if item["id"] == original["id"])["display_text"] == "Synthetic original"
