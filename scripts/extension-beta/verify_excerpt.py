"""Inspect only the requested synthetic staged ZIP in the exact loopback acceptance lab."""
import hashlib
import json
import os
import sys
import uuid
import zipfile

from app.core.database import SessionLocal
from app.models import _register_all_models
from app.models.import_record import ImportRecord
from app.services.adaptive_import.archive_sources import ARCHIVE_SOURCE_TYPE, _artifact_path, archive_catalog
from app.services.adaptive_import.reader_package import messages, package_header, verify_assets

assert os.environ["APP_ENV"] == "test" and os.environ["PUBLIC_WEB_BASE_URL"] == os.environ["SYNTHETIC_ORIGIN"] in {"http://127.0.0.1:18383", "http://127.0.0.1:18483"}
_register_all_models()
with SessionLocal() as db:
    assert db.get_bind().url.database == "extension_beta"
    record = db.get(ImportRecord, uuid.UUID(sys.argv[1]))
    assert record.analysis_summary["append_only"].get("device")
    originals = [a for a in record.artifacts if a.source_type == ARCHIVE_SOURCE_TYPE]
    derived = [a for a in record.artifacts if a.source_type != ARCHIVE_SOURCE_TYPE]
    assert len(originals) == 1 and len(derived) == 1
    assert derived[0].parsed_summary["archive_artifact_id"] == str(originals[0].id)
    with zipfile.ZipFile(_artifact_path(record, originals[0])) as z:
        meta = package_header(z)
        assert meta["source_id"].startswith("synthetic-") and meta["lineage"] == "list"
        verify_assets(z, meta)
        rows = list(messages(z, meta))
        assert [r["id"] for r, _, _ in rows] == ["fixture-1", "fixture-2"]
        assert all(r["role"] == "assistant" and "question" not in r and not r["source_path"] for r, _, _ in rows)
        assert len(meta["assets"]) == 1 and meta["assets"][0]["kind"] == "image"
        assert set(z.namelist()) == {"manifest.json", "reader/source.jsonl", "conversation.md", meta["assets"][0]["path"]}
        # The received document keeps its relative asset path; the server-owned
        # derived copy replaces only that link with the archive's exact local member ID.
        document = z.read("conversation.md")
        img = meta["assets"][0]["path"]
        catalog = archive_catalog(record, originals[0].id)
        member = next(m for m in catalog["members"] if m["path"] == img)
        assert document.count(("]("+img+")").encode()) == 1
        rewritten = document.replace(("]("+img+")").encode(), ("](cr-asset://"+member["member_id"]+")").encode())
        assert _artifact_path(record, derived[0]).read_bytes() == rewritten
        assert derived[0].sha256 == hashlib.sha256(rewritten).hexdigest()
        raw = z.read(meta["assets"][0]["path"])
        assert raw.startswith(b"\x89PNG\r\n\x1a\n")
        assert b"synthetic-report" not in z.read("reader/source.jsonl") and b"A tidal observation" not in z.read("conversation.md")
print(json.dumps({"orderedRows": 2, "images": 1, "imageSha256": hashlib.sha256(raw).hexdigest(), "omittedFilePresent": False}))
