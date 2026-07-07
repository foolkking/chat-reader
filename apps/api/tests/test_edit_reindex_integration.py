from fastapi.testclient import TestClient

from test_import_preview_api import client  # noqa: F401
from test_message_editing_api import assistant_message, commit_edit_sample


def test_edit_rebuilds_search_documents(client: TestClient) -> None:
    sample = commit_edit_sample(client)
    message = assistant_message(sample)

    old_search = client.get("/api/search?q=oldphraseonly")
    assert old_search.status_code == 200
    assert old_search.json()["total"] == 0

    response = client.patch(
        f"/api/messages/{message['id']}",
        json={"display_text": "Edited current searchable zetaonly"},
    )
    assert response.status_code == 200

    new_search = client.get("/api/search?q=zetaonly")
    assert new_search.status_code == 200
    assert new_search.json()["total"] >= 1
    assert any(item["message_id"] == message["id"] for item in new_search.json()["items"])

    old_current_search = client.get("/api/search?q=Original assistant unique old phrase")
    assert old_current_search.status_code == 200
    assert all(item["message_id"] != message["id"] for item in old_current_search.json()["items"])


def test_edit_rebuilds_toc_headings(client: TestClient) -> None:
    sample = commit_edit_sample(client)
    message = assistant_message(sample)
    conversation_id = sample["conversation_id"]

    initial_toc = client.get(f"/api/conversations/{conversation_id}/toc")
    assert initial_toc.status_code == 200
    assert initial_toc.json()["items"] == []

    heading_edit = client.patch(
        f"/api/messages/{message['id']}",
        json={"display_text": "# Edited TOC Heading\n\nBody"},
    )
    assert heading_edit.status_code == 200

    toc = client.get(f"/api/conversations/{conversation_id}/toc")
    assert toc.status_code == 200
    assert [item["text"] for item in toc.json()["items"]] == ["Edited TOC Heading"]
    assert toc.json()["items"][0]["message_id"] == message["id"]

    remove_heading = client.patch(
        f"/api/messages/{message['id']}",
        json={"display_text": "Body without heading"},
    )
    assert remove_heading.status_code == 200

    updated_toc = client.get(f"/api/conversations/{conversation_id}/toc")
    assert updated_toc.status_code == 200
    assert updated_toc.json()["items"] == []
