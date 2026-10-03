"""Golden preservation check; semantic judgments were authored and reviewed by an agent.

This exercises writer/reader interoperability. It cannot grade an arbitrary model
or prove an unseen model performed semantic acquisition.
"""
import hashlib
import json
from pathlib import Path
import sys
import zipfile

SCRIPTS = Path(__file__).resolve().parents[1] / "context-continuation-maintainer/scripts"
sys.path.insert(0, str(SCRIPTS))

from _context_package.extraction import extract_context
from _context_package.validation import validate_continuation
from _continuation_maintenance.materialize import materialize_continuation

FIXTURE = Path(__file__).parent / "fixtures/semantic-walkthrough-v1.json"


def materialize_walkthrough(directory):
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    identity = "synthetic-semantic-walkthrough"
    records = [{"record_type": "manifest", "format": "chat-reader-canonical-jsonl",
                "version": 2, "conversation": {"id": identity}}]
    records.extend({"record_type": "message", "seq": sequence, "id": f"m{sequence}",
                    "role": row["role"], "current_version": {
                        "id": f"v{sequence}", "number": 1, "content_markdown": row["text"]}}
                   for sequence, row in enumerate(fixture["messages"], 1))
    raw = ("\n".join(json.dumps(row) for row in records) + "\n").encode()
    digest = hashlib.sha256(raw).hexdigest()
    manifest = {"format": "chat-reader-context-package", "format_version": 1,
                "conversation": {"id": identity}, "entrypoint": "conversation.canjsonl",
                "files": {"conversation.canjsonl": {"sha256": digest, "byte_size": len(raw)}}}
    source = directory / "raw.context.zip"
    with zipfile.ZipFile(source, "w") as archive:
        archive.writestr("manifest.json", json.dumps(manifest))
        archive.writestr("conversation.canjsonl", raw)
    end = fixture["covered_through"]
    current = fixture["current"]
    current["evidence_registry"] = [
        {"id": f"NEW-E-{sequence:03d}", "fields": {"Type": "message", "Sequence": sequence,
         "Message-ID": f"m{sequence}", "Version-ID": f"v{sequence}"}}
        for sequence in range(1, end + 1)
    ]
    candidate = {"schema": "chat-reader-continuation-candidate", "schema_version": "1.0.0",
                 "conversation_id": identity, "maintenance_mode": "ONE_SHOT", "trust_target": "verified",
                 "base": {"continuation_present": False, "continuation_revision": None},
                 "coverage": {"seq_start": 1, "seq_end": end}, "current": current,
                 "index": {"chapters": [], "segments": [
                     {"id": f"NEW-SEG-{number:03d}",
                      **{key: segment[key] for key in ("seq_start", "seq_end", "kind", "title")},
                      "about": segment["title"],
                      "key_refs": [{"sequence": sequence, "purpose": "review original statement"}
                                   for sequence in segment["key_sequences"]]}
                     for number, segment in enumerate(fixture["index_segments"], 1)]}}
    # These attestations belong only to the documented, manually reviewed fixture.
    # Do not derive or generalize them from successful hashing/parsing.
    trace = {"schema": "chat-reader-maintenance-trace", "schema_version": "1.0.0", "mode": "ONE_SHOT",
             "conversation_id": identity, "trust_target": "verified",
             "source_binding": {"conversation_id": identity, "entrypoint_sha256": digest},
             "baseline": {"continuation_revision": None},
             "semantic_reads": [{"seq_start": 1, "seq_end": end, "every_sequence": True,
                                 "full_body_required": True}],
             "semantic_gate": {"adoption_resolved": True, "supersession_resolved": True,
                               "scope_resolved": True, "state_levels_resolved": True,
                               "material_conflicts_preserved": True,
                               "context_critical_dependencies_resolved": True},
             "attachments": {"required": [], "inspected": [], "unavailable": []},
             "boundary": {"accepted_sequence": end}, "retention_gc": {"status": "performed"}}
    candidate_path, trace_path = directory / "candidate.json", directory / "trace.json"
    candidate_path.write_text(json.dumps(candidate), encoding="utf-8")
    trace_path.write_text(json.dumps(trace), encoding="utf-8")
    output = directory / "reviewed.context.zip"
    receipt = materialize_continuation(str(source), candidate_path=str(candidate_path),
        maintenance_trace_path=str(trace_path), output_path=str(output))
    return fixture, source, output, receipt


def test_semantic_fixture_survives_writer_reader_and_preserves_unacquired_tail(tmp_path):
    fixture, source, output, receipt = materialize_walkthrough(tmp_path)
    assert receipt["validation"]["runtime_state"] == "valid_verified"
    report = validate_continuation(str(output), detail="full")
    assert report["runtime_state"] == "valid_verified"
    report_path = tmp_path / "validation.json"
    report_path.write_text(json.dumps(report), encoding="utf-8")
    with zipfile.ZipFile(source) as before, zipfile.ZipFile(output) as after:
        assert after.read("conversation.canjsonl") == before.read("conversation.canjsonl")
        current = after.read("continuation/current.md").decode()
        index = json.loads(after.read("continuation/index.json"))
        manifest = json.loads(after.read("manifest.json"))
    for section, objects in fixture["current"].items():
        if section == "evidence_registry":
            continue
        if isinstance(objects, str):
            assert objects in current
        else:
            for obj in objects:
                assert obj["title"] in current and obj["body"] in current
    assert "NEW-" not in current
    assert manifest["continuation"]["raw_tail_start_seq"] == 13
    assert index["coverage"]["seq_end"] == 12
    assert [reference["sequence"] for segment in index["segments"] for reference in segment["key_refs"]] == list(range(1, 13))
    for segment in index["segments"]:
        for reference in segment["key_refs"]:
            assert reference["message_id"] == f"m{reference['sequence']}"
    extracted_dir = tmp_path / "extracted"
    extract_context(str(output), validation_report=str(report_path), tail=True, output_dir=str(extracted_dir))
    # Actual reader extraction must deliver both tail messages, including the
    # rejected-looking proposal. Interpretation is recorded separately.
    encoded = "\n".join(path.read_text(encoding="utf-8") for path in sorted((extracted_dir / "messages").glob("*.jsonl")))
    assert fixture["messages"][12]["text"] in encoded
    assert fixture["messages"][13]["text"] in encoded
    assert "New browser run failed" not in current
