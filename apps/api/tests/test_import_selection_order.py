"""Selection order must survive ORM reloads, grouping and format-family reuse."""
import json
from types import SimpleNamespace

from app.models.import_record import ImportRecord
from app.services.adaptive_import import service
from app.services.import_pipeline.draft_store import read_import_draft
from test_adaptive_import_api import _complete_analysis
from test_import_analysis_queue import database
from test_import_preview_api import client  # noqa: F401


def source(title):
    return json.dumps({
        "metadata": {"powered_by": "ChatGPT Exporter", "title": title},
        "messages": [{"role": "Prompt", "say": f"Synthetic {title}"}],
    }).encode()


def test_selected_order_survives_reload_analysis_and_draft(client, monkeypatch):
    names = ["03.json", "01.json", "02.json"]
    response = client.post("/api/adaptive-import/sessions", files=[
        ("files", (name, source(name), "application/json")) for name in names
    ])
    assert response.status_code == 201, response.text
    observed = []
    original = service.analyze_documents

    def analyze(documents):
        observed.append([document.filename for document in documents])
        return original(documents)

    monkeypatch.setattr(service, "analyze_documents", analyze)
    result = _complete_analysis(client, response.json())
    assert result["state"] == "READY", result
    assert observed[:3] == [[name] for name in names]
    assert [group["display_name"] for group in result["groups"]] == names
    assert result["order_basis"] == "selection"
    with database() as db:
        import uuid
        record = db.get(ImportRecord, uuid.UUID(result["import_id"]))
        assert [draft.title for draft in read_import_draft(record)] == names
    reread = client.get(f"/api/adaptive-import/sessions/{result['import_id']}").json()
    assert [group["display_name"] for group in reread["groups"]] == names
    assert client.get("/api/conversations").json() == []


def test_paired_files_use_first_selected_member_not_alphabetical_stem(client):
    response = client.post("/api/adaptive-import/sessions", files=[
        ("files", (name, source(name) if name.endswith(".json") else b"# Synthetic\n\nText",
                   "application/json" if name.endswith(".json") else "text/markdown"))
        for name in ["03.json", "01.md", "03.md", "01.json", "02.json", "02.md"]
    ])
    assert response.status_code == 201, response.text
    result = _complete_analysis(client, response.json())
    assert [[file["filename"] for file in group["files"]] for group in result["groups"]] == [
        ["03.json", "03.md"], ["01.md", "01.json"], ["02.json", "02.md"],
    ]


def test_full_validation_keeps_selection_order_across_interleaved_families(client, monkeypatch):
    names = ["first.json", "second.json", "third.json"]
    inputs = [json.loads(source(name)) for name in names]
    inputs[1]["messages"][0]["id"] = "synthetic-different-structure"
    response = client.post("/api/adaptive-import/sessions", files=[
        ("files", (name, json.dumps(value).encode(), "application/json"))
        for name, value in zip(names, inputs)
    ])
    assert response.status_code == 201, response.text
    normalized = []
    original = service.normalize_builtin

    def normalize(key, documents):
        normalized.append([document.filename for document in documents])
        return original(key, documents)

    monkeypatch.setattr(service, "normalize_builtin", normalize)
    result = _complete_analysis(client, response.json())
    assert result["state"] == "READY", result
    assert result["family_count"] == 2
    assert normalized == [[name] for name in names] * 2
    assert all(family["validation_result"]["verified_on_full_family"] for family in result["families"])
    assert sum(family["validation_result"]["message_count"] for family in result["families"]) == 3


def test_draft_generation_does_not_reorder_groups_by_family(monkeypatch):
    groups = [SimpleNamespace(id=str(i), artifact_ids=[str(i)], display_name=f"{i}.md",
                              family_id="A" if i != 2 else "B") for i in range(1, 4)]
    families = [
        SimpleNamespace(id="A", display_name="A", matched_profile_key="A", matched_revision_id=None,
                        mapping_draft={}, groups=[groups[0], groups[2]]),
        SimpleNamespace(id="B", display_name="B", matched_profile_key="B", matched_revision_id=None,
                        mapping_draft={}, groups=[groups[1]]),
    ]
    artifacts = [SimpleNamespace(id=str(i), filename=f"{i}.md", parsed_summary={},
                                 source_type="adaptive_source") for i in range(1, 4)]
    record = SimpleNamespace(input_groups=groups, structure_families=families, artifacts=artifacts,
                             analysis_summary={"source_order": ["1", "2", "3"]})
    emitted = []
    monkeypatch.setattr(service, "_group_documents", lambda record, group: group.display_name)
    monkeypatch.setattr(service, "normalize_builtin",
                        lambda key, documents: [SimpleNamespace(title=documents, messages=[])])
    monkeypatch.setattr(service, "_enrich_archive_drafts", lambda record, group, drafts: drafts)
    monkeypatch.setattr(service, "validate_drafts", lambda drafts: {"valid": True})
    monkeypatch.setattr(service, "attach_import_draft",
                        lambda record, drafts: emitted.extend(draft.title for draft in drafts))
    service._prepare_plan(SimpleNamespace(), record)
    assert emitted == ["1.md", "2.md", "3.md"]
