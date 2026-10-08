"""Bound validation by message/rule, while checking actual preview and saved source."""
import time
import pytest

from app.models.message import Message
from app.models.message_version import MessageVersion
from app.services import content_cleanup as cleanup
from test_import_preview_api import client  # noqa: F401
from test_cleanup_safety import MARKER, create_review, session


@pytest.mark.parametrize("count", [32, 128])
def test_revalidation_work_is_per_message_rule(client, monkeypatch, record_property, count):
    source = (f"Synthetic retained text {MARKER} after.\n\n" * count) + f"Protected `{MARKER}` stays."
    scan_id, messages = create_review(client, [source])
    url = f"/api/content-cleanup/scans/{scan_id}"
    counts = {"detect": 0, "protected": 0, "hash": 0}
    for name, counter in (("detect_occurrences", "detect"), ("protected_ranges", "protected"), ("source_fingerprint", "hash")):
        original = getattr(cleanup, name)
        def measured(*args, _original=original, _counter=counter, **kwargs):
            counts[_counter] += 1
            return _original(*args, **kwargs)
        monkeypatch.setattr(cleanup, name, measured)
    stats = {}
    def measure(name, operation):
        counts.update(dict.fromkeys(counts, 0))
        started = time.perf_counter()
        result = operation()
        stats[name] = {**counts, "milliseconds": round((time.perf_counter() - started) * 1000, 3)}
        for field, value in stats[name].items():
            record_property(f"{name}_{field}", value)
        return result
    saved = measure("select", lambda: client.patch(url + "/decisions/filter", json={"decision": "DELETE", "all_matching": True}))
    assert saved.status_code == 200 and saved.json()["scan"]["delete_count"] == count
    preview_response = measure("preview", lambda: client.get(url + "/preview"))
    assert preview_response.status_code == 200
    preview = preview_response.json()
    assert preview["summary"]["fragments"] == count
    expected = source.replace(f"Synthetic retained text {MARKER}", "Synthetic retained text ")
    assert preview["items"][0]["after"] == expected
    with session() as db:
        assert db.query(MessageVersion).filter_by(message_id=messages[0]).count() == 1
    result = measure("apply", lambda: client.post(url + "/apply", json={"preview_token": preview["preview_token"]}))
    assert result.status_code == 200 and result.json() == {"applied": count, "conflicts": 0}
    with session() as db:
        message = db.get(Message, messages[0])
        assert db.get(MessageVersion, message.current_version_id).display_text == expected
        assert db.query(MessageVersion).filter_by(message_id=messages[0]).count() == 2
    assert stats["preview"]["detect"] == 1, stats
    assert stats["apply"]["detect"] == 1, stats
    assert stats["select"]["protected"] <= 2, stats
    assert stats["preview"]["hash"] <= 4, stats


def test_validation_keeps_multiple_sources_and_revisions_independent(client, monkeypatch):
    sources = [f"First {MARKER} and cite turn22search1 end.\nProtected `{MARKER}`.",
               f"A different prefix and {MARKER} then cite turn22search1 retained."]
    scan_id, messages = create_review(client, sources)
    url = f"/api/content-cleanup/scans/{scan_id}"
    assert client.patch(url + "/decisions/filter", json={"decision": "DELETE", "all_matching": True}).status_code == 200
    calls = []
    detector = cleanup.detect_occurrences
    def measured(role, source, rule, revision):
        calls.append((source, revision.id))
        return detector(role, source, rule, revision)
    monkeypatch.setattr(cleanup, "detect_occurrences", measured)
    preview = client.get(url + "/preview").json()
    assert preview["summary"] == {"conversations": 2, "messages": 2, "fragments": 4}
    assert len(calls) == len(set(calls)) == 4
    expected = [source.replace(f"First {MARKER}", "First ").replace(f"and {MARKER}", "and ").replace("cite turn22search1", "") for source in sources]
    assert {item["after"] for item in preview["items"]} == set(expected)
    calls.clear()
    assert client.post(url + "/apply", json={"preview_token": preview["preview_token"]}).json() == {"applied": 4, "conflicts": 0}
    assert len(calls) == len(set(calls)) == 4
    with session() as db:
        for message_id, text in zip(messages, expected):
            assert db.get(MessageVersion, db.get(Message, message_id).current_version_id).display_text == text
            assert db.query(MessageVersion).filter_by(message_id=message_id).count() == 2
