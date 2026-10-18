"""Synthetic user consent cannot widen, survive source changes, or bypass preview."""
import uuid

from app.models.content_cleanup import ContentCleanupOccurrence
from app.models.message_version import MessageVersion
from test_import_preview_api import client  # noqa: F401
from test_cleanup_safety import create_review, session

FOOTER = "\n\n---\nPowered by [ChatGPT Exporter](https://www.chatgptexporter.com)"


def review(client, count=1):
    scan, _ = create_review(client, ["Useful answer." + FOOTER] * count)
    prefix = f"/api/content-cleanup/scans/{scan}"
    rows = client.get(prefix + "/occurrences", params={"limit": 100}).json()
    assert len(rows) == count and all(row["decision"] == "PROTECTED" for row in rows)
    return prefix, rows


def test_single_protected_footer_requires_consent_then_preview_and_apply(client):
    prefix, rows = review(client)
    row = rows[0]
    payload = {"decisions": [{"occurrence_id": row["id"], "decision": "DELETE"}]}
    assert client.patch(prefix + "/decisions", json=payload).status_code == 422
    preview = client.post(prefix + "/protection-preview", json={"occurrence_ids": [row["id"]]}).json()
    assert preview["protected"] == preview["total"] == 1, preview
    assert client.patch(prefix + "/decisions", json={**payload, "protection_token": preview["preview_token"]}).status_code == 200
    saved = client.get(prefix + f"/occurrences/{row['id']}").json()
    assert saved["protection_confirmed"] and saved["decision"] == "DELETE"
    assert saved["rule_revision_id"] and saved["rule_settings"]["matcher_version"]
    ranges = [{"start_offset": row["start_offset"], "end_offset": row["end_offset"]}]
    assert client.put(prefix + f"/occurrences/{row['id']}/removal-ranges",
        json={"base_edit_token": saved["edit_token"], "ranges": ranges}).status_code == 200
    diff = client.get(prefix + "/preview").json()
    assert diff["summary"]["protected_confirmed"] == 1
    assert diff["items"][0]["after"] == "Useful answer."
    result = client.post(prefix + "/apply", json={"preview_token": diff["preview_token"]})
    assert result.status_code == 200 and result.json() == {"applied": 1, "conflicts": 0}


def test_group_confirmation_covers_other_pages_but_not_other_filter_or_scan(client):
    prefix, rows = review(client, 3)
    scope = {"rule_id": rows[0]["rule_id"]}
    preview = client.post(prefix + "/protection-preview", json={**scope, "limit": 1}).json()
    assert preview["total"] == preview["protected"] == 3 and len(preview["items"]) == 1
    payload = {"decision": "DELETE", "all_matching": True, **scope}
    assert client.patch(prefix + "/decisions/filter", json=payload).json()["matched"] == 0
    response = client.patch(prefix + "/decisions/filter", json={**payload, "protection_token": preview["preview_token"]})
    assert response.status_code == 200 and response.json()["scan"]["delete_count"] == 3, response.text
    # A now-stale set preview cannot be reused after its saved choices changed.
    assert client.patch(prefix + "/decisions/filter", json={**payload, "protection_token": preview["preview_token"]}).status_code == 422
    assert client.post(prefix + "/protection-preview", json={}).status_code == 409


def test_protection_token_and_saved_consent_fail_closed_after_same_version_source_replacement(client):
    prefix, rows = review(client)
    row = rows[0]
    preview = client.post(prefix + "/protection-preview", json={"occurrence_ids": [row["id"]]}).json()
    with session() as db:
        candidate = db.get(ContentCleanupOccurrence, uuid.UUID(row["id"]))
        version = db.get(MessageVersion, candidate.message_version_id)
        version.display_text = "Changed answer." + FOOTER
        db.commit()
    result = client.patch(prefix + "/decisions", json={"decisions": [{"occurrence_id": row["id"], "decision": "DELETE"}],
        "protection_token": preview["preview_token"]})
    assert result.status_code == 422
    assert not client.get(prefix + f"/occurrences/{row['id']}").json()["protection_confirmed"]
