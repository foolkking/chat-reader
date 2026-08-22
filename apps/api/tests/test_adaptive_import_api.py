import json
import uuid
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.models.import_profile import ImportProfile, ImportProfileRevision
from app.core.config import get_settings
from app.services.adaptive_import.analysis import analyze_documents, default_mapping
from app.services.adaptive_import.contracts import AdaptiveImportError, SourceDocument
from app.services.adaptive_import.normalization import normalize_group
from test_import_preview_api import client  # noqa: F401


def _json_bytes(*, content_key: str = "body", body: str = "Hello", extra: dict | None = None) -> bytes:
    first = {"speaker": "human", content_key: body, "id": "m1", "timestamp": "2026-08-22T10:00:00Z"}
    second = {"speaker": "ai", content_key: "World", "id": "m2", "timestamp": "2026-08-22T10:01:00Z"}
    if content_key == "parts":
        first[content_key] = {"text": body}
        second[content_key] = {"text": "World"}
    payload = {"thread": {"title": "Adaptive fixture"}, "turns": [first, second], **(extra or {})}
    return json.dumps(payload).encode()


def _create(client: TestClient, files: list[tuple[str, bytes, str]]) -> dict:
    response = client.post(
        "/api/adaptive-import/sessions",
        files=[("files", item) for item in files],
    )
    assert response.status_code == 201, response.text
    return response.json()


def _save_mapping(client: TestClient, session: dict, name: str = "Learned fixture") -> dict:
    family = session["families"][0]
    preview = client.post(
        f"/api/adaptive-import/sessions/{session['import_id']}/families/{family['id']}/mapping/preview",
        json={"profile_name": name, "mapping_spec": family["mapping_draft"], "sample_group_id": family["group_ids"][-1]},
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["validation"]["verified_on_full_family"] is True
    assert preview.json()["sample_group_id"] == family["group_ids"][-1]
    saved = client.post(
        f"/api/adaptive-import/sessions/{session['import_id']}/families/{family['id']}/mapping",
        json={"profile_name": name, "mapping_spec": family["mapping_draft"]},
    )
    assert saved.status_code == 200, saved.text
    return saved.json()


def test_unknown_mapping_direct_import_then_same_structure_matches(client: TestClient) -> None:
    first = _create(client, [("first.json", _json_bytes(), "application/json")])
    assert first["state"] == "RESOLVING"
    assert first["families"][0]["resolution_status"] == "UNKNOWN"

    ready = _save_mapping(client, first)
    assert ready["state"] == "READY"
    assert ready["conversation_count"] == 1
    commit = client.post(f"/api/imports/{ready['import_id']}/commit")
    assert commit.status_code == 200, commit.text
    assert commit.json()["status"] == "committed"
    persisted = client.get(f"/api/adaptive-import/sessions/{ready['import_id']}").json()
    assert persisted["state"] == "COMPLETED"
    regroup = client.put(
        f"/api/adaptive-import/sessions/{ready['import_id']}/groups",
        json={"groups": [{"artifact_ids": first["groups"][0]["artifact_ids"]}]},
    )
    assert regroup.status_code == 409
    assert regroup.json()["detail"]["code"] == "SESSION_STATE_INVALID"

    second = _create(client, [("second.json", _json_bytes(body="A new conversation"), "application/json")])
    assert second["state"] == "READY"
    assert second["families"][0]["resolution_status"] == "EXACT_MATCH"
    assert second["families"][0]["display_name"] == "Learned fixture"


def test_native_json_is_a_builtin_profile(client: TestClient) -> None:
    content = json.dumps(
        {
            "metadata": {"powered_by": "ChatGPT Exporter", "title": "Native fixture"},
            "messages": [{"role": "Prompt", "say": "Hello"}, {"role": "Response", "say": "World"}],
        }
    ).encode()
    session = _create(client, [("native.json", content, "application/json")])

    assert session["state"] == "READY"
    assert session["families"][0]["matched_profile_key"] == "builtin:chat-reader-exporter"


def test_family_mapping_is_reused_and_validated_for_every_group(client: TestClient) -> None:
    session = _create(
        client,
        [
            ("one.json", _json_bytes(body="One"), "application/json"),
            ("two.json", _json_bytes(body="Two"), "application/json"),
        ],
    )
    assert session["family_count"] == 1
    assert session["families"][0]["group_count"] == 2
    ready = _save_mapping(client, session, "Batch fixture")
    assert ready["conversation_count"] == 2
    formats = client.get("/api/import-formats").json()
    assert len([item for item in formats if item["kind"] == "LEARNED" and item["name"] == "Batch fixture"]) == 1


def test_invalid_member_blocks_family_profile_verification(client: TestClient) -> None:
    session = _create(
        client,
        [
            ("good.json", _json_bytes(body="Good"), "application/json"),
            ("empty.json", _json_bytes(body=""), "application/json"),
        ],
    )
    family = session["families"][0]
    response = client.post(
        f"/api/adaptive-import/sessions/{session['import_id']}/families/{family['id']}/mapping",
        json={"profile_name": "Must not persist", "mapping_spec": family["mapping_draft"]},
    )

    assert response.status_code == 422
    formats = client.get("/api/import-formats").json()
    assert all(item["name"] != "Must not persist" for item in formats)


def test_drift_creates_revision_and_old_revision_remains_matchable(client: TestClient) -> None:
    original = _save_mapping(client, _create(client, [("v1.json", _json_bytes(), "application/json")]), "Versioned fixture")
    profile_id = original["families"][0]["matched_profile_id"]
    changed = _create(client, [("v2.json", _json_bytes(content_key="parts"), "application/json")])
    assert changed["families"][0]["resolution_status"] == "DRIFTED"
    repaired = _save_mapping(client, changed, "Versioned fixture")
    assert repaired["families"][0]["matched_profile_id"] == profile_id
    revisions = client.get(f"/api/import-formats/{profile_id}/revisions").json()
    assert [item["revision"] for item in revisions] == [2, 1]
    assert revisions[0]["status"] == "VERIFIED"
    assert revisions[1]["status"] == "SUPERSEDED"

    old_again = _create(client, [("old-again.json", _json_bytes(body="Old format"), "application/json")])
    assert old_again["families"][0]["resolution_status"] == "EXACT_MATCH"
    assert old_again["families"][0]["matched_revision_id"] == revisions[1]["id"]


def test_settings_remap_explicitly_creates_a_new_revision(client: TestClient) -> None:
    original = _save_mapping(client, _create(client, [("v1.json", _json_bytes(), "application/json")]), "Repairable fixture")
    profile_id = original["families"][0]["matched_profile_id"]
    repair = client.post(
        "/api/adaptive-import/sessions",
        data={"repair_profile_id": profile_id},
        files=[("files", ("representative.json", _json_bytes(body="Representative"), "application/json"))],
    )

    assert repair.status_code == 201, repair.text
    session = repair.json()
    assert session["families"][0]["resolution_status"] == "DRIFTED"
    assert session["families"][0]["matched_profile_id"] == profile_id
    repaired = _save_mapping(client, session, "Repairable fixture")
    revisions = client.get(f"/api/import-formats/{profile_id}/revisions").json()
    assert repaired["state"] == "READY"
    assert [item["revision"] for item in revisions] == [2, 1]
    matched = _create(client, [("after-remap.json", _json_bytes(body="After remap"), "application/json")])
    assert matched["families"][0]["resolution_status"] == "EXACT_MATCH"
    assert matched["families"][0]["matched_revision_id"] == revisions[0]["id"]


def test_disabled_and_deleted_profiles_do_not_auto_apply(client: TestClient) -> None:
    ready = _save_mapping(client, _create(client, [("learn.json", _json_bytes(), "application/json")]), "Temporary fixture")
    profile_id = ready["families"][0]["matched_profile_id"]
    disabled = client.patch(f"/api/import-formats/{profile_id}", json={"status": "DISABLED"})
    assert disabled.status_code == 200
    unknown = _create(client, [("disabled.json", _json_bytes(body="Disabled"), "application/json")])
    assert unknown["families"][0]["resolution_status"] == "UNKNOWN"
    deleted = client.delete(f"/api/import-formats/{profile_id}")
    assert deleted.status_code == 204
    formats = client.get("/api/import-formats").json()
    assert all(item["id"] != profile_id for item in formats)


def test_equal_profile_matches_stay_ambiguous_until_explicit_selection(client: TestClient, tmp_path: Path) -> None:
    ready = _save_mapping(client, _create(client, [("learn.json", _json_bytes(), "application/json")]), "First candidate")
    original_profile_id = ready["families"][0]["matched_profile_id"]
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}")
    with Session(engine) as db:
        original = db.get(ImportProfile, uuid.UUID(original_profile_id))
        assert original is not None
        source_revision = original.revisions[0]
        duplicate = ImportProfile(name="Second candidate", kind="LEARNED", source_mode="JSON", status="ACTIVE")
        db.add(duplicate)
        db.flush()
        revision = ImportProfileRevision(
            profile_id=duplicate.id,
            revision=1,
            matcher_version=source_revision.matcher_version,
            normalizer_version=source_revision.normalizer_version,
            match_spec=source_revision.match_spec,
            mapping_spec=source_revision.mapping_spec,
            validation_spec=source_revision.validation_spec,
            source_signature=source_revision.source_signature,
            signature_digest=source_revision.signature_digest,
            status="VERIFIED",
            verification_summary=source_revision.verification_summary,
            verified_at=source_revision.verified_at,
        )
        db.add(revision)
        db.flush()
        duplicate.current_revision_id = revision.id
        selected_revision_id = str(revision.id)
        db.commit()

    ambiguous = _create(client, [("ambiguous.json", _json_bytes(body="Choose explicitly"), "application/json")])
    family = ambiguous["families"][0]
    assert ambiguous["state"] == "RESOLVING"
    assert family["resolution_status"] == "AMBIGUOUS"
    assert len(family["match_evidence"]["candidates"]) == 2

    selected = client.post(
        f"/api/adaptive-import/sessions/{ambiguous['import_id']}/families/{family['id']}/profile",
        json={"revision_id": selected_revision_id},
    )
    assert selected.status_code == 200, selected.text
    assert selected.json()["state"] == "READY"


def test_markdown_noise_and_role_mapping() -> None:
    document = SourceDocument(
        artifact_id="md",
        filename="conversation.md",
        extension=".md",
        content=b"# Export note\n\n## Human\nHello\n\n## AI\nWorld\n",
    )
    analysis = analyze_documents([document])
    mapping = default_mapping(analysis)
    ignored = normalize_group([document], mapping, "Markdown fixture")[0]
    assert [message.role for message in ignored.messages] == ["user", "assistant"]
    assert ignored.messages[0].display_text == "Hello"

    mapping["noise_rules"] = [{"region": "PREAMBLE", "action": "KEEP"}]
    kept = normalize_group([document], mapping, "Markdown fixture")[0]
    assert kept.messages[0].display_text.startswith("# Export note")


def test_markdown_heading_roles_accept_trailing_colons_and_ignore_fenced_boundaries() -> None:
    document = SourceDocument(
        artifact_id="md-colon",
        filename="conversation.md",
        extension=".md",
        content=(
            "# Export\n\n## Prompt:\nQuestion\n\n"
            "```markdown\n## Response:\nnot a boundary\n```\n\n"
            "## Response:\nAnswer\n"
        ).encode(),
    )

    analysis = analyze_documents([document])
    draft = normalize_group([document], default_mapping(analysis), "Markdown colon fixture")[0]

    assert [message.role for message in draft.messages] == ["user", "assistant"]
    assert "not a boundary" in draft.messages[0].display_text
    assert draft.messages[1].display_text == "Answer"


def test_markdown_chinese_line_labels_ignore_colon_ended_body_lines() -> None:
    document = SourceDocument(
        "md-cn-labels",
        "formula.md",
        ".md",
        (
            "### 公式展示测试\n\n"
            "用户:\n请输出公式测试。\n"
            "AI助手:\n可以，下面是完整测试集。\n\n"
            "### 1. 行内公式\n\n"
            "这是行内公式，例如：\\(E=mc^2\\)\n"
        ).encode(),
    )

    analysis = analyze_documents([document])
    draft = normalize_group([document], default_mapping(analysis), "Chinese Markdown fixture")[0]

    assert analysis.semantic["role_suggestions"] == {"AI助手": "assistant", "用户": "user"}
    assert [message.role for message in draft.messages] == ["user", "assistant"]
    assert "这是行内公式" in draft.messages[1].display_text


def test_markdown_model_emphasis_in_heading_is_decoration_not_role() -> None:
    json_document = SourceDocument("json", "pair.json", ".json", _json_bytes())
    markdown_document = SourceDocument(
        "md",
        "pair.md",
        ".md",
        (
            "# Pair\n\n"
            "## You — Aug 22, 2026\nHello\n\n"
            "## ChatGPT *(gpt-5-6-thinking)* — Aug 22, 2026\nWorld\n\n"
            "## 可能的原因\nThis is body content\n"
        ).encode(),
    )

    analysis = analyze_documents([json_document, markdown_document])
    draft = normalize_group([json_document, markdown_document], default_mapping(analysis), "Paired Markdown fixture")[0]

    assert analysis.semantic["markdown"]["role_suggestions"] == {"ChatGPT": "assistant", "You": "user"}
    assert [message.role for message in draft.messages] == ["user", "assistant"]
    assert draft.messages[1].display_text.startswith("World")
    assert "## 可能的原因" in draft.messages[1].display_text


def test_json_markdown_order_id_and_role_timestamp_relations() -> None:
    json_document = SourceDocument("json", "pair.json", ".json", _json_bytes())
    markdown_document = SourceDocument(
        "md",
        "pair.md",
        ".md",
        (
            "## AI | id=m2 | 2026-08-22T10:01:00Z\nMarkdown world\n\n"
            "## Human | id=m1 | 2026-08-22T10:00:00Z\nMarkdown hello\n"
        ).encode(),
    )
    analysis = analyze_documents([json_document, markdown_document])
    mapping = default_mapping(analysis)

    mapping["relation"]["type"] = "ID"
    by_id = normalize_group([json_document, markdown_document], mapping, "Paired fixture")[0]
    assert [message.display_text for message in by_id.messages] == ["Markdown hello", "Markdown world"]

    mapping["relation"]["type"] = "ROLE_TIMESTAMP"
    by_time = normalize_group([json_document, markdown_document], mapping, "Paired fixture")[0]
    assert [message.role for message in by_time.messages] == ["user", "assistant"]

    mapping["relation"]["type"] = "ORDER"
    try:
        normalize_group([json_document, markdown_document], mapping, "Paired fixture")
    except AdaptiveImportError as exc:
        assert exc.code == "RELATION_ROLE_CONFLICT"
    else:
        raise AssertionError("ORDER must reject a differently ordered pair")


def test_unknown_role_is_never_silently_mapped() -> None:
    document = SourceDocument(
        "json",
        "unknown-role.json",
        ".json",
        json.dumps({"turns": [{"speaker": "critic", "body": "Review"}]}).encode(),
    )
    analysis = analyze_documents([document])
    mapping = default_mapping(analysis)
    try:
        normalize_group([document], mapping, "Unknown role fixture")
    except AdaptiveImportError as exc:
        assert exc.code == "ROLE_UNMAPPED"
    else:
        raise AssertionError("Unknown roles must block normalization")


def test_mixed_batch_with_unmatched_files_requires_group_resolution(client: TestClient) -> None:
    markdown = b"## Human\nHello\n\n## AI\nWorld\n"
    session = _create(
        client,
        [
            ("paired.json", _json_bytes(), "application/json"),
            ("paired.md", markdown, "text/markdown"),
            ("unmatched.json", _json_bytes(body="Separate"), "application/json"),
        ],
    )

    assert session["state"] == "NEEDS_GROUPING"
    assert sorted(group["grouping_status"] for group in session["groups"]) == ["AMBIGUOUS", "RESOLVED"]


def test_json_markdown_pair_with_chinese_markdown_family_does_not_block_session(client: TestClient) -> None:
    paired_markdown = (
        "# Pair\n\n"
        "## You — Aug 22, 2026\nHello\n\n"
        "## ChatGPT *(gpt-5-6-thinking)* — Aug 22, 2026\nWorld\n"
    ).encode()
    formula_markdown = (
        "### 公式展示测试\n\n"
        "用户:\n请输出公式测试。\n"
        "AI助手:\n可以，下面是完整测试集。\n\n"
        "### 1. 行内公式\n\n"
        "这是行内公式，例如：\\(E=mc^2\\)\n"
    ).encode()

    session = _create(
        client,
        [
            ("conversation.json", _json_bytes(), "application/json"),
            ("conversation.md", paired_markdown, "text/markdown"),
            ("formula.md", formula_markdown, "text/markdown"),
        ],
    )

    assert session["state"] == "NEEDS_GROUPING"
    artifacts = {
        file["filename"]: file["artifact_id"]
        for group in session["groups"]
        for file in group["files"]
    }
    resolved_response = client.put(
        f"/api/adaptive-import/sessions/{session['import_id']}/groups",
        json={
            "groups": [
                {"artifact_ids": [artifacts["conversation.json"], artifacts["conversation.md"]]},
                {"artifact_ids": [artifacts["formula.md"]]},
            ]
        },
    )
    assert resolved_response.status_code == 200, resolved_response.text
    resolved = resolved_response.json()
    assert resolved["state"] == "RESOLVING"
    assert resolved["family_count"] == 2
    assert all(family["resolution_status"] != "INVALID" for family in resolved["families"])
    assert sorted(group["mode"] for group in resolved["groups"]) == ["JSON_MARKDOWN", "MARKDOWN"]

    current = resolved
    while current["state"] == "RESOLVING":
        family = next(item for item in current["families"] if item["resolution_status"] not in {"EXACT_MATCH", "COMPATIBLE"})
        mapped = client.post(
            f"/api/adaptive-import/sessions/{current['import_id']}/families/{family['id']}/mapping",
            json={"profile_name": f"Three-file {family['source_mode']}", "mapping_spec": family["mapping_draft"]},
        )
        assert mapped.status_code == 200, mapped.text
        current = mapped.json()
    assert current["state"] == "READY"
    assert current["conversation_count"] == 2


def test_cancel_marks_session_and_removes_temporary_source(client: TestClient, tmp_path: Path) -> None:
    session = _create(client, [("cancel.json", _json_bytes(), "application/json")])
    source_root = tmp_path / "storage" / "imports" / session["import_id"]
    assert source_root.is_dir()

    canceled = client.delete(f"/api/adaptive-import/sessions/{session['import_id']}")
    assert canceled.status_code == 204
    restored = client.get(f"/api/adaptive-import/sessions/{session['import_id']}").json()
    assert restored["state"] == "CANCELED"
    assert not source_root.exists()


def test_adaptive_upload_rejects_file_count_before_analysis(client: TestClient) -> None:
    response = client.post(
        "/api/adaptive-import/sessions",
        files=[("files", (f"item-{index}.json", b"{}", "application/json")) for index in range(501)],
    )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "FILE_COUNT_LIMIT"


def test_adaptive_upload_enforces_total_session_limit(
    client: TestClient,
    monkeypatch,
) -> None:
    monkeypatch.setenv("MAX_ADAPTIVE_IMPORT_TOTAL_MB", "1")
    get_settings.cache_clear()
    padding = "x" * 600_000
    payload = json.dumps({"turns": [{"speaker": "human", "body": "Hello"}], "padding": padding}).encode()

    response = client.post(
        "/api/adaptive-import/sessions",
        files=[
            ("files", ("one.json", payload, "application/json")),
            ("files", ("two.json", payload, "application/json")),
        ],
    )

    assert response.status_code == 413
    assert response.json()["detail"]["code"] == "SESSION_TOO_LARGE"
    get_settings.cache_clear()


def test_adaptive_nginx_capacity_is_scoped_to_exact_route() -> None:
    root = Path(__file__).resolve().parents[3]
    nginx = (root / "deploy" / "nginx-chat-reader.conf").read_text(encoding="utf-8")
    adaptive_location = nginx.split("location = /api/adaptive-import/sessions", 1)[1].split("location", 1)[0]

    assert "client_max_body_size 520m;" in adaptive_location
    assert nginx.count("client_max_body_size 520m;") == 1
    assert "client_max_body_size 60m;" in nginx
