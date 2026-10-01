import uuid

from test_admin_system import _normal_user_session
from test_auth import auth_client, owner_login  # noqa: F401


def seed(client):
    response = client.post("/api/conversations", json={"title": "Synthetic reading sync", "messages": [{"role": "user", "content_markdown": "First synthetic paragraph.\n\nSecond synthetic paragraph."}, {"role": "assistant", "content_markdown": "Synthetic answer."}]})
    assert response.status_code == 201
    conversation = response.json()["conversation"]["id"]
    message = client.get(f"/api/conversations/{conversation}/messages").json()[0]["id"]
    return conversation, message


def operation(message, base=0, offset=10):
    return {"operation_id": str(uuid.uuid4()), "base_revision": base, "position": {
        "message_id": message, "block_index": 0, "scroll_offset": offset,
        "anchor_data": {"position_mode": "block-relative-v2", "character_offset": offset}}}


def test_reading_replay_conflict_and_explicit_resolution(auth_client):
    assert owner_login(auth_client).status_code == 200
    conversation, message = seed(auth_client)
    path = f"/api/conversations/{conversation}/reading-position"
    first = operation(message)
    response = auth_client.post(path + "/sync", json=first)
    assert response.status_code == 200
    assert response.json()["position"]["revision"] == 1
    assert auth_client.post(path + "/sync", json=first).json() == response.json()
    stale = operation(message, offset=20)
    conflict = auth_client.post(path + "/sync", json=stale).json()
    assert conflict["status"] == "conflict"
    assert conflict["position"]["scroll_offset"] == 10
    assert auth_client.get(path).json()["position"]["scroll_offset"] == 10
    resolved = operation(message, base=1, offset=20)
    assert auth_client.post(path + "/sync", json=resolved).json()["position"]["revision"] == 2
    # A lost old response stays a receipt, never reapplies a historical value.
    assert auth_client.post(path + "/sync", json=first).json() == response.json()
    assert auth_client.get(path).json()["position"]["scroll_offset"] == 20
    first["position"]["scroll_offset"] = 30
    assert auth_client.post(path + "/sync", json=first).status_code == 409


def test_legacy_put_advances_revision_and_same_value_converges(auth_client):
    assert owner_login(auth_client).status_code == 200
    conversation, message = seed(auth_client)
    path = f"/api/conversations/{conversation}/reading-position"
    request = operation(message)
    assert auth_client.post(path + "/sync", json=request).status_code == 200
    changed = operation(message, offset=30)
    assert auth_client.put(path, json=changed["position"]).json()["revision"] == 2
    assert auth_client.put(path, json=changed["position"]).json()["revision"] == 2
    same = auth_client.post(path + "/sync", json=changed).json()
    assert same["status"] == "applied" and same["position"]["revision"] == 2
    assert auth_client.post(path + "/sync", json=operation(message, base=1, offset=40)).json()["status"] == "conflict"


def test_reading_receipts_and_positions_are_owner_scoped(auth_client):
    _, token = _normal_user_session(auth_client)
    assert owner_login(auth_client).status_code == 200
    conversation, message = seed(auth_client)
    request = operation(message)
    path = f"/api/conversations/{conversation}/reading-position"
    assert auth_client.post(path + "/sync", json=request).status_code == 200
    auth_client.cookies.clear(); auth_client.cookies.set("chat_reader_session", token)
    assert auth_client.get(path).status_code == 404
    assert auth_client.post(path + "/sync", json=request).status_code == 404
    other, other_message = seed(auth_client)
    request["position"]["message_id"] = other_message
    assert auth_client.post(f"/api/conversations/{other}/reading-position/sync", json=request).status_code == 200


def test_reading_sync_rejects_invalid_anchor_and_reused_conversation_request(auth_client):
    assert owner_login(auth_client).status_code == 200
    conversation, message = seed(auth_client)
    other, other_message = seed(auth_client)
    path = f"/api/conversations/{conversation}/reading-position/sync"
    assert auth_client.post(path, json=operation(other_message)).status_code == 400
    request = operation(message)
    request["position"]["anchor_data"] = {"oversized": "x" * 65_537}
    assert auth_client.post(path, json=request).status_code == 422
    request = operation(message)
    assert auth_client.post(path, json=request).status_code == 200
    request["position"]["message_id"] = other_message
    assert auth_client.post(f"/api/conversations/{other}/reading-position/sync", json=request).status_code == 409
