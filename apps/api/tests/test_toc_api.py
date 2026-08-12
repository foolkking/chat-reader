import json
import uuid

from fastapi.testclient import TestClient

from app.core.database import get_db
from app.main import app
from app.models.heading import Heading
from background_job_test_utils import process_queued_jobs
from test_import_preview_api import client  # noqa: F401


def test_toc_returns_headings_with_unique_slugs(client: TestClient) -> None:
    preview = client.post(
        "/api/imports/preview",
        files={
            "files": (
                "toc.json",
                json.dumps(
                    {
                        "metadata": {"title": "TOC Sample", "powered_by": "ChatGPT Exporter"},
                        "messages": [
                            {"role": "Prompt", "say": "outline"},
                            {"role": "Response", "say": "# Repeat\n\n## Repeat\n\nbody"},
                        ],
                    }
                ).encode(),
                "application/json",
            )
        },
    )
    conversation_id = client.post(f"/api/imports/{preview.json()['import_id']}/commit").json()["conversation_ids"][0]

    response = client.get(f"/api/conversations/{conversation_id}/toc")
    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == 2
    assert [item["heading_index"] for item in items] == [0, 1]
    assert items[0]["slug"] != items[1]["slug"]
    assert items[0]["message_id"]
    assert items[0]["block_index"] == 0

    message_id = items[0]["message_id"]
    filtered = client.get(
        f"/api/conversations/{conversation_id}/toc",
        params={"message_id": message_id, "offset": 1, "limit": 1},
    )
    assert filtered.status_code == 200
    assert filtered.json()["total"] == 2
    assert filtered.json()["offset"] == 1
    assert filtered.json()["has_more"] is False
    assert len(filtered.json()["items"]) == 1


def test_toc_unknown_conversation_returns_404(client: TestClient) -> None:
    response = client.get("/api/conversations/00000000-0000-0000-0000-000000000000/toc")
    assert response.status_code == 404


def _commit_toc_sample(client: TestClient, title: str, heading: str) -> str:
    preview = client.post(
        "/api/imports/preview",
        files={
            "files": (
                f"{title}.json",
                json.dumps(
                    {
                        "metadata": {"title": title, "powered_by": "ChatGPT Exporter"},
                        "messages": [
                            {"role": "Prompt", "say": "outline"},
                            {"role": "Response", "say": f"# {heading}\n\nbody"},
                        ],
                    }
                ).encode(),
                "application/json",
            )
        },
    )
    return client.post(f"/api/imports/{preview.json()['import_id']}/commit").json()["conversation_ids"][0]


def _delete_headings(conversation_ids: list[str]) -> None:
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        db.query(Heading).filter(Heading.conversation_id.in_([uuid.UUID(value) for value in conversation_ids])).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()
        generator.close()


def test_manual_toc_refresh_supports_independent_targets_and_section_scope(client: TestClient) -> None:
    first_id = _commit_toc_sample(client, "TOC Refresh One", "First Heading")
    second_id = _commit_toc_sample(client, "TOC Refresh Two", "Second Heading")
    first_revision = client.get(f"/api/conversations/{first_id}").json()["offline_revision"]
    _delete_headings([first_id, second_id])

    dialogue_only = client.post(
        f"/api/conversations/{first_id}/toc/refresh",
        json={
            "refresh_dialogue_index": True,
            "refresh_section_toc": False,
            "section_scope": "current_conversation",
        },
        headers={"Idempotency-Key": "toc-dialogue-only"},
    )
    assert dialogue_only.status_code == 202
    process_queued_jobs(until_job_id=dialogue_only.json()["job_id"])
    dialogue_task = client.get(f"/api/tasks/{dialogue_only.json()['job_id']}").json()
    assert dialogue_task["status"] == "committed"
    assert dialogue_task["result"]["dialogue_message_count"] == 2
    assert dialogue_task["result"]["heading_count"] == 0
    assert client.get(f"/api/conversations/{first_id}/toc").json()["total"] == 0

    current_sections = client.post(
        f"/api/conversations/{first_id}/toc/refresh",
        json={
            "refresh_dialogue_index": False,
            "refresh_section_toc": True,
            "section_scope": "current_conversation",
        },
        headers={"Idempotency-Key": "toc-current-sections"},
    )
    assert current_sections.status_code == 202
    process_queued_jobs(until_job_id=current_sections.json()["job_id"])
    assert client.get(f"/api/conversations/{first_id}/toc").json()["total"] == 1
    assert client.get(f"/api/conversations/{second_id}/toc").json()["total"] == 0

    all_sections = client.post(
        f"/api/conversations/{first_id}/toc/refresh",
        json={
            "refresh_dialogue_index": True,
            "refresh_section_toc": True,
            "section_scope": "all_conversations",
        },
        headers={"Idempotency-Key": "toc-all-sections"},
    )
    assert all_sections.status_code == 202
    repeated = client.post(
        f"/api/conversations/{first_id}/toc/refresh",
        json={
            "refresh_dialogue_index": True,
            "refresh_section_toc": True,
            "section_scope": "all_conversations",
        },
        headers={"Idempotency-Key": "toc-all-sections"},
    )
    assert repeated.json()["job_id"] == all_sections.json()["job_id"]
    process_queued_jobs(until_job_id=all_sections.json()["job_id"])
    all_task = client.get(f"/api/tasks/{all_sections.json()['job_id']}").json()
    assert all_task["status"] == "committed"
    assert all_task["result"]["section_scope"] == "all_conversations"
    assert all_task["result"]["section_conversation_count"] >= 2
    assert client.get(f"/api/conversations/{second_id}/toc").json()["total"] == 1
    assert client.get(f"/api/conversations/{first_id}").json()["offline_revision"] == first_revision

    invalid = client.post(
        f"/api/conversations/{first_id}/toc/refresh",
        json={"refresh_dialogue_index": False, "refresh_section_toc": False},
    )
    assert invalid.status_code == 422
