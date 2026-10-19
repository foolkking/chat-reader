"""Small synthetic regressions for body retention and bounded archive reads."""
import io
import json
import uuid
import weakref
from contextlib import contextmanager
from zipfile import ZipFile

import pytest
from sqlalchemy import event

from app.core.config import get_settings
from app.models.background_job import BackgroundJob
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.search_document import SearchDocument
from app.models.user import User
from app.schemas.export import ExportOptions
from app.services import offline_packages
from app.services.exporting import cr_archive, export_service
from app.services.exporting.prepared_export import prepare_direct_export
from app.services.search import search_indexer
from test_system_archive_integrity import archive_db  # noqa: F401


def seed_export(db, *, count=33, versions=3, text_repeats=128):
    owner = User(normalized_email=f"bounds-{uuid.uuid4()}@example.test")
    db.add(owner)
    db.flush()
    conversation = Conversation(owner_user_id=owner.id, title="Synthetic bounds", display_title="Synthetic bounds",
        source_type="test", source_profile="test", parser_version="test", message_count=0)
    job = BackgroundJob(owner_user_id=owner.id, job_type="export", status="processing")
    db.add_all([conversation, job])
    db.flush()
    for index in range(count):
        message = Message(conversation_id=conversation.id, role="assistant", order_key=f"{index:06}")
        db.add(message)
        db.flush()
        for number in range(1, versions + 1):
            body = f"Synthetic-{index:03}-v{number}: " + "bounded content " * text_repeats
            version = MessageVersion(message_id=message.id, version_number=number,
                plain_text=body, display_text=body, edit_type="test", content_hash=f"{index}-{number}")
            db.add(version)
            db.flush()
            message.current_version_id = version.id
    db.commit()
    return conversation.id, job.id


@contextmanager
def retained_entities(model):
    live = weakref.WeakSet()
    measurements = {"loaded": 0, "peak": 0}

    def loaded(version, _):
        live.add(version)
        measurements["loaded"] += 1
        measurements["peak"] = max(measurements["peak"], len(live))

    event.listen(model, "load", loaded)
    try:
        yield measurements
    finally:
        event.remove(model, "load", loaded)


def retained_versions():
    return retained_entities(MessageVersion)


def test_cr_export_does_not_retain_all_historical_bodies(archive_db):
    conversation_id, job_id = seed_export(archive_db)
    with retained_versions() as measured:
        artifact = cr_archive.create_cr_archive(archive_db, conversation_id=conversation_id, job_id=job_id)
    assert measured["loaded"] == 99
    assert measured["peak"] <= 4, measured
    with ZipFile(artifact.storage_uri) as package:
        manifest = json.loads(package.read("manifest.json"))
        versions = [json.loads(line) for line in package.read("versions.jsonl").splitlines()]
    assert manifest["summary"]["messages"] == 33
    assert manifest["summary"]["versions"] == len(versions) == 99
    assert any("Synthetic-032-v3:" in row["display_text"] for row in versions)


def test_legacy_markdown_download_spools_without_retaining_all_bodies(archive_db):
    conversation_id, _ = seed_export(archive_db)
    with retained_versions() as measured:
        result = prepare_direct_export(archive_db, conversation_id, ExportOptions(format="markdown", message_ids=[]))
    assert measured["loaded"] == 33
    assert measured["peak"] <= 4, measured
    body = b"".join(result.content).decode()
    assert body.startswith("# Synthetic bounds\n")
    assert result.message_count == 33
    assert "Synthetic-000-v3:" in body and "Synthetic-032-v3:" in body
    assert "Synthetic-000-v1:" not in body
    assert body.endswith("\n") and not body.endswith("\n\n")
    assert result.content.stream.closed


def test_offline_body_batches_are_released_before_the_next_batch(archive_db):
    conversation_id, _ = seed_export(archive_db)
    conversation = archive_db.get(Conversation, conversation_id)
    output = io.BytesIO()
    progress = []
    with retained_versions() as measured:
        offline_packages._write_conversation_payload(output, archive_db, conversation,
            subject_key="local:default", progress_callback=lambda *args: progress.append(args))
    assert measured["loaded"] == 33
    assert measured["peak"] <= offline_packages._MESSAGE_BATCH_SIZE, measured
    payload = json.loads(output.getvalue())
    assert payload["message_count"] == len(payload["messages"]) == 33
    assert payload["messages"][-1]["current_version"]["display_text"].startswith("Synthetic-032-v3:")
    messages_progress = [row for row in progress if row[0] == "packaging_messages"]
    assert messages_progress[-1] == ("packaging_messages", 33, 33)


def test_offline_search_bodies_use_the_same_small_read_bound(archive_db):
    conversation_id, _ = seed_export(archive_db)
    search_indexer.rebuild_search_documents_for_conversation(archive_db, conversation_id)
    archive_db.commit()
    conversation = archive_db.get(Conversation, conversation_id)
    output = io.BytesIO()
    with retained_entities(SearchDocument) as measured:
        offline_packages._write_conversation_payload(output, archive_db, conversation,
            subject_key="local:default")
    assert measured["loaded"] == 34
    # DB-API buffering and the current serializer cursor can overlap adjacent
    # fetch windows; both stay bounded by the driver's two-window envelope.
    assert measured["peak"] <= offline_packages._MESSAGE_BATCH_SIZE * 2, measured
    payload = json.loads(output.getvalue())
    assert len(payload["search_documents"]) == 34
    assert any("Synthetic-032-v3:" in row["plain_text"] for row in payload["search_documents"])


@pytest.mark.parametrize("tail", [
    ["", "body", ""], ["", "body  ", "", "\t", "last\n\t", ""],
    ["", "body\n\n  ", "", "## Notes", "", "  quoted content \t", ""],
])
def test_streaming_legacy_whitespace_matches_the_original_join(archive_db, monkeypatch, tail):
    conversation_id, _ = seed_export(archive_db, count=0)
    lines = ["# Synthetic", *tail]
    monkeypatch.setattr(export_service, "_legacy_markdown_lines", lambda *_: iter(lines))
    chunks = export_service._legacy_markdown_chunks(archive_db.get_bind(), conversation_id,
        ExportOptions(format="markdown", message_ids=[]), "synthetic-time", 0)
    assert b"".join(chunks).decode() == "\n".join(lines).strip() + "\n"


@pytest.mark.parametrize("entry,reader", [
    ("manifest.json", cr_archive._read_json_entry),
    ("versions.jsonl", lambda package, name: list(cr_archive._read_jsonl(package, name))),
])
def test_cr_readers_never_request_an_unbounded_json_record(monkeypatch, entry, reader):
    monkeypatch.setenv("CANJSON_MAX_LINE_BYTES", "128")
    get_settings.cache_clear()
    requests = []

    class Source(io.BytesIO):
        def read(self, size=-1):
            requests.append(size)
            assert 0 < size <= 129
            return super().read(size)

        def readline(self, size=-1):
            requests.append(size)
            assert 0 < size <= 129
            return super().readline(size)

    class Package:
        def open(self, *_):
            return Source(b'{"body":"' + b"x" * 256 + b'"}\n')

    try:
        with pytest.raises(cr_archive.CrArchiveError, match="size limit|oversized"):
            reader(Package(), entry)
        assert requests == [129]
    finally:
        get_settings.cache_clear()


@pytest.mark.parametrize("limit,entry", [
    ("BUNDLE_MAX_COMPRESSED_BYTES", "versions.jsonl"),
    ("BUNDLE_MAX_EXPANDED_BYTES", "versions.jsonl"),
    ("BUNDLE_MAX_OBJECT_BYTES", "assets/objects/synthetic"),
])
def test_cr_zip_rejects_oversized_input_before_parsing(tmp_path, monkeypatch, limit, entry):
    path = tmp_path / "synthetic.cr"
    with ZipFile(path, "w") as package:
        package.writestr(entry, b"x" * 256)
    monkeypatch.setenv(limit, "128")
    get_settings.cache_clear()
    try:
        with pytest.raises(cr_archive.CrArchiveError, match="size limit"):
            cr_archive._open_validated_zip(path)
    finally:
        get_settings.cache_clear()


def test_cr_import_rejects_duplicate_object_ids_without_restaging_them(tmp_path, monkeypatch):
    from types import SimpleNamespace

    source_id, existing_id = uuid.uuid4(), uuid.uuid4()
    row = {"record_type": "asset_object", "id": str(source_id), "byte_size": 1}
    staged_count = []

    def stage(*_, **__):
        staged_count.append(True)
        path = tmp_path / "synthetic-staging"
        path.write_bytes(b"x")
        return SimpleNamespace(path=path, byte_size=1, sha256="synthetic")

    monkeypatch.setattr(cr_archive, "get_asset_store", lambda: SimpleNamespace(stage=stage))
    monkeypatch.setattr(cr_archive, "scan_attachment",
        lambda _: SimpleNamespace(allowed_by_policy=True, status="clean"))
    query = SimpleNamespace(filter=lambda *_: SimpleNamespace(
        one_or_none=lambda: SimpleNamespace(id=existing_id)))
    db = SimpleNamespace(query=lambda *_: query, flush=lambda: None)
    data = io.BytesIO()
    with ZipFile(data, "w") as package:
        package.writestr("attachments.jsonl", (json.dumps(row) + "\n") * 2)
        package.writestr(f"assets/objects/{source_id}", b"x")
    with ZipFile(data) as package:
        with pytest.raises(cr_archive.CrArchiveError, match="duplicate asset object IDs"):
            cr_archive._import_attachments(db, package, {"version": cr_archive.ARCHIVE_VERSION},
                SimpleNamespace(id=uuid.uuid4()), uuid.uuid4())
    assert staged_count == [True], "A duplicate must not repeat staging/scanning."


@pytest.mark.parametrize("entry,function,row", [
    ("versions.jsonl", "_import_versions", {"id": str(uuid.uuid4()), "message_id": str(uuid.uuid4()),
        "version_number": 1, "content_hash": "test", "plain_text": "x" * 800, "display_text": "x" * 800}),
    ("blocks.jsonl", "_import_blocks", {"id": str(uuid.uuid4()), "message_version_id": str(uuid.uuid4()),
        "block_index": 0, "block_type": "paragraph", "plain_text": "x" * 800}),
    ("headings.jsonl", "_import_headings", {"id": str(uuid.uuid4()), "message_id": str(uuid.uuid4()),
        "message_version_id": str(uuid.uuid4()), "block_index": 0, "heading_index": 0,
        "level": 1, "text": "x" * 800, "slug": "test", "order_key": "a"}),
    ("search_documents.jsonl", "_import_search_documents", {"document_type": "message", "plain_text": "x" * 800}),
    ("source_refs.jsonl", "_import_source_refs", {"message_id": str(uuid.uuid4()), "raw_metadata": {"test": "x" * 800}}),
    ("events.jsonl", "_import_events", {"event_type": "test", "payload": {"test": "x" * 800}}),
])
def test_archive_bulk_import_flushes_by_bytes_not_just_record_count(monkeypatch, entry, function, row):
    monkeypatch.setattr(cr_archive, "_BODY_BATCH_BYTES", 1024)
    batches = []
    monkeypatch.setattr(cr_archive, "insert_rows", lambda db, model, rows: batches.append(len(rows)))
    data = io.BytesIO()
    with ZipFile(data, "w") as package:
        package.writestr(entry, ((json.dumps(row) + "\n") * 9).encode())
    with ZipFile(data) as package:
        arguments = [None, package, uuid.uuid4()]
        if function in {"_import_versions", "_import_blocks"}:
            arguments.extend([0, 9, None])
        getattr(cr_archive, function)(*arguments)
    assert sum(batches) == 9
    assert max(batches) <= 2, batches


def test_failed_cr_export_removes_its_private_staging_file(archive_db, monkeypatch, tmp_path):
    conversation_id, job_id = seed_export(archive_db, count=1)
    monkeypatch.setenv("CANJSON_MAX_LINE_BYTES", "128")
    get_settings.cache_clear()
    try:
        with pytest.raises(cr_archive.CrArchiveError, match="JSON size limit"):
            cr_archive.create_cr_archive(archive_db, conversation_id=conversation_id, job_id=job_id)
        assert not [path for path in (tmp_path / "exports").rglob("*") if path.is_file()]
    finally:
        get_settings.cache_clear()


def test_search_index_flushes_long_bodies_before_500_documents(archive_db, monkeypatch):
    conversation_id, _ = seed_export(archive_db)
    monkeypatch.setattr(search_indexer, "_MAX_DOCUMENT_TEXT_CHARS", 8 * 1024)
    batches = []
    original = search_indexer.insert_rows

    def capture(db, model, rows):
        if model is SearchDocument:
            batches.append(len(rows))
        return original(db, model, rows)

    monkeypatch.setattr(search_indexer, "insert_rows", capture)
    result = search_indexer.rebuild_search_documents_for_conversation(archive_db, conversation_id)
    saved = archive_db.query(SearchDocument).filter_by(conversation_id=conversation_id).all()
    assert result.indexed_count == len(saved) == 34
    assert sum(batches) == 34 and max(batches) <= 4, batches
    assert any("Synthetic-032-v3:" in row.plain_text for row in saved)
