import json

from fastapi.testclient import TestClient

from test_import_preview_api import client  # noqa: F401

PRIVATE_PATTERNS = [
    "E:\\",
    "C:\\",
    "/mnt/",
    "DATABASE_URL",
    "postgresql://",
    "postgresql+psycopg://",
    "token_hash",
]


def assert_no_private_leaks(text: str, extra_patterns: list[str] | None = None) -> None:
    for pattern in PRIVATE_PATTERNS + (extra_patterns or []):
        assert pattern not in text


def _commit_leak_sample(client: TestClient) -> dict:
    preview = client.post(
        "/api/imports/preview",
        files={
            "files": (
                "leak.json",
                json.dumps(
                    {
                        "metadata": {"title": "Leak Sample", "powered_by": "ChatGPT Exporter"},
                        "messages": [
                            {"role": "Prompt", "say": "Leak check question"},
                            {"role": "Response", "say": "# Leak Heading\n\nLeak check answer"},
                        ],
                    }
                ).encode(),
                "application/json",
            )
        },
    )
    assert preview.status_code == 200
    assert_no_private_leaks(preview.text)
    commit = client.post(f"/api/imports/{preview.json()['import_id']}/commit")
    assert commit.status_code == 200
    assert_no_private_leaks(commit.text, ["raw_storage_uri", "storage/imports"])
    conversation_id = commit.json()["conversation_ids"][0]
    messages = client.get(f"/api/conversations/{conversation_id}/message-window?include_blocks=true").json()["items"]
    return {"conversation_id": conversation_id, "messages": messages}


def test_canonical_read_search_edit_share_export_do_not_leak_private_values(client: TestClient) -> None:
    sample = _commit_leak_sample(client)
    conversation_id = sample["conversation_id"]
    message_id = sample["messages"][1]["id"]

    endpoints = [
        client.get("/api/conversations"),
        client.get(f"/api/conversations/{conversation_id}"),
        client.get(f"/api/conversations/{conversation_id}/messages?include_blocks=true"),
        client.get(f"/api/messages/{message_id}"),
        client.get(f"/api/messages/{message_id}/blocks"),
        client.get("/api/search?q=Leak"),
        client.get(f"/api/conversations/{conversation_id}/toc"),
    ]
    for response in endpoints:
        assert response.status_code == 200
        assert_no_private_leaks(response.text, ["raw_storage_uri", "storage/imports"])

    edit = client.patch(f"/api/messages/{message_id}", json={"display_text": "Edited leak-safe text"})
    assert edit.status_code == 200
    versions = client.get(f"/api/messages/{message_id}/versions")
    assert versions.status_code == 200
    assert_no_private_leaks(edit.text + versions.text, ["raw_storage_uri", "storage/imports"])

    share = client.post(f"/api/conversations/{conversation_id}/shares", json={}).json()
    shares = client.get(f"/api/conversations/{conversation_id}/shares")
    public = client.get(f"/api/shared/{share['token']}")
    assert shares.status_code == 200
    assert public.status_code == 200
    assert "token" not in shares.json()[0]
    assert_no_private_leaks(shares.text + public.text, ["raw_storage_uri", "storage/imports"])

    markdown = client.get(f"/api/conversations/{conversation_id}/export?format=markdown")
    canonical = client.get(f"/api/conversations/{conversation_id}/export?format=canonical_json")
    assert markdown.status_code == 200
    assert canonical.status_code == 200
    assert_no_private_leaks(markdown.text + canonical.text, ["raw_storage_uri", "storage/imports"])


def test_error_responses_do_not_leak_private_values(client: TestClient) -> None:
    responses = [
        client.get("/api/conversations/00000000-0000-0000-0000-000000000000"),
        client.get("/api/shared/not-a-token"),
        client.get("/api/search?q="),
        client.get("/api/conversations/00000000-0000-0000-0000-000000000000/export?format=invalid"),
    ]
    for response in responses:
        assert response.status_code >= 400
        assert_no_private_leaks(response.text, ["raw_storage_uri", "storage/imports"])
