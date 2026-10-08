"""Selection scope is aggregated across pages without modifying source or decisions."""
import uuid

from app.models.message import Message
from test_import_preview_api import client  # noqa: F401
from test_cleanup_safety import MARKER, create_review, session


def test_summary_counts_whole_scope_and_other_groups(client):
    source = (f"Before {MARKER} after.\n\n" * 51) + f"Protected `{MARKER}`."
    scan_id, message_ids = create_review(client, [source, f"Other {MARKER} end."])
    url = f"/api/content-cleanup/scans/{scan_id}"
    with session() as db:
        conversation_ids = [str(db.get(Message, key).conversation_id) for key in message_ids]
        versions = [db.get(Message, key).current_version_id for key in message_ids]
    first_scope = {"conversation_id": conversation_ids[0]}
    assert client.patch(url + "/decisions/filter", json={**first_scope, "decision": "DELETE", "all_matching": True}).status_code == 200
    for offset in (0, 50, 100):
        page = client.get(url + "/review", params={**first_scope, "limit": 50, "offset": offset}).json()
        assert page["total"] == 52
        assert page["selection_summary"] == {"selected": 51, "selected_elsewhere": 0, "protected": 1}
    other = client.get(url + "/review", params={"conversation_id": conversation_ids[1], "selected_only": True}).json()
    assert other["items"] == [] and other["total"] == 0
    assert other["selection_summary"] == {"selected": 0, "selected_elsewhere": 51, "protected": 0}
    assert client.patch(url + "/decisions/filter", json={"conversation_id": conversation_ids[1], "decision": "DELETE", "all_matching": True}).status_code == 200
    assert client.get(url + "/review", params=first_scope).json()["selection_summary"]["selected_elsewhere"] == 1
    selected = client.get(url + "/review", params={"selected_only": True, "limit": 1}).json()
    assert selected["total"] == 52 and len(selected["items"]) == 1
    assert selected["selection_summary"] == {"selected": 52, "selected_elsewhere": 0, "protected": 0}
    missing = client.get(url + "/review", params={"conversation_id": str(uuid.uuid4())}).json()
    assert missing["selection_summary"] == {"selected": 0, "selected_elsewhere": 52, "protected": 0}
    with session() as db:
        assert [db.get(Message, key).current_version_id for key in message_ids] == versions


def test_summary_rule_filter_and_clearing_are_independent(client):
    scan_id, _ = create_review(client, [f"Before {MARKER} after.\n\nBefore Cite turn22search1 after."])
    url = f"/api/content-cleanup/scans/{scan_id}"
    groups = client.get(url + "/groups").json()["items"]
    assert len(groups) == 2
    assert client.patch(url + "/decisions/filter", json={"decision": "DELETE", "all_matching": True}).status_code == 200
    for group in groups:
        result = client.get(url + "/review", params={"rule_id": group["rule_id"]}).json()
        assert result["selection_summary"] == {"selected": 1, "selected_elsewhere": 1, "protected": 0}
    assert client.patch(url + "/decisions/filter", json={"decision": "KEEP", "all_matching": True, "rule_id": groups[0]["rule_id"]}).status_code == 200
    assert client.get(url + "/review", params={"rule_id": groups[0]["rule_id"]}).json()["selection_summary"] == {"selected": 0, "selected_elsewhere": 1, "protected": 0}
    assert client.get(url + "/review", params={"rule_id": groups[1]["rule_id"]}).json()["selection_summary"] == {"selected": 1, "selected_elsewhere": 0, "protected": 0}


def test_empty_scan_summary_is_zero(client):
    scan_id, _ = create_review(client, ["No synthetic markers here."])
    page = client.get(f"/api/content-cleanup/scans/{scan_id}/review").json()
    assert page["total"] == 0 and page["items"] == []
    assert page["selection_summary"] == {"selected": 0, "selected_elsewhere": 0, "protected": 0}
