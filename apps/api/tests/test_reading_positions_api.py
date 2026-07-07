from fastapi.testclient import TestClient

from test_import_preview_api import client  # noqa: F401
from test_projects_api import _commit_conversation


def _first_message_id(client: TestClient, conversation_id: str) -> str:
    return client.get(f"/api/conversations/{conversation_id}/messages").json()[0]["id"]


def test_reading_position_get_create_update(client: TestClient) -> None:
    conversation_id = _commit_conversation(client, "Reading Position")
    message_id = _first_message_id(client, conversation_id)

    initial = client.get(f"/api/conversations/{conversation_id}/reading-position")
    assert initial.status_code == 200
    assert initial.json()["position"] is None

    created = client.put(
        f"/api/conversations/{conversation_id}/reading-position",
        json={
            "message_id": message_id,
            "block_index": 0,
            "scroll_offset": 1200,
            "anchor_data": {"order_key": "000001"},
        },
    )
    assert created.status_code == 200
    assert created.json()["message_id"] == message_id
    assert created.json()["scroll_offset"] == 1200

    updated = client.put(
        f"/api/conversations/{conversation_id}/reading-position",
        json={
            "message_id": message_id,
            "block_index": 0,
            "scroll_offset": 2400,
            "anchor_data": {"order_key": "000001"},
        },
    )
    assert updated.status_code == 200
    assert updated.json()["id"] == created.json()["id"]
    assert updated.json()["scroll_offset"] == 2400


def test_reading_position_rejects_wrong_message_and_negative_values(client: TestClient) -> None:
    first_conversation_id = _commit_conversation(client, "First Reading")
    second_conversation_id = _commit_conversation(client, "Second Reading")
    wrong_message_id = _first_message_id(client, second_conversation_id)

    wrong_message = client.put(
        f"/api/conversations/{first_conversation_id}/reading-position",
        json={"message_id": wrong_message_id, "scroll_offset": 0},
    )
    assert wrong_message.status_code == 400

    negative_block = client.put(
        f"/api/conversations/{first_conversation_id}/reading-position",
        json={"block_index": -1, "scroll_offset": 0},
    )
    assert negative_block.status_code == 400

    negative_offset = client.put(
        f"/api/conversations/{first_conversation_id}/reading-position",
        json={"scroll_offset": -1},
    )
    assert negative_offset.status_code == 400
