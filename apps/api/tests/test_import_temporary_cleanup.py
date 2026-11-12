"""Secondary unlink failures cannot replace the primary import failure."""
import hashlib
import io
import json
from pathlib import Path
from types import SimpleNamespace
import uuid

import pytest

from app.services.import_pipeline import draft_store
from app.services.import_pipeline.exporter_aligner import align_exporter_sources
from app.services.import_pipeline.exporter_json_parser import parse_exporter_json
from app.services.storage import local_storage
from app.services.uploads import UploadLimitError


def deny_owned_temporary_unlink(monkeypatch, root, prefix):
    original = Path.unlink
    denied = []

    def unlink(path, *args, **kwargs):
        if path.name.startswith(prefix) and path.resolve().is_relative_to(root.resolve()):
            denied.append(path)
            raise PermissionError("Synthetic cleanup /srv/private-staging/part")
        return original(path, *args, **kwargs)

    monkeypatch.setattr(Path, "unlink", unlink)
    return denied


@pytest.mark.parametrize("cleanup_denied", [False, True])
def test_stream_upload_keeps_size_rejection_when_temporary_cleanup_fails(
    tmp_path, monkeypatch, caplog, cleanup_denied,
):
    monkeypatch.setattr(local_storage, "get_settings", lambda: SimpleNamespace(import_storage_dir=tmp_path))
    identity = uuid.uuid4()
    directory = tmp_path / str(identity)
    directory.mkdir()
    original = directory / "source.json"
    original.write_bytes(b"Existing synthetic source")
    denied = deny_owned_temporary_unlink(monkeypatch, tmp_path, ".upload-") if cleanup_denied else []

    with pytest.raises(ValueError, match="configured per-file limit"):
        local_storage.save_import_file_stream(identity, "source.json", io.BytesIO(b"123456"), max_bytes=4, chunk_size=3)
    assert original.read_bytes() == b"Existing synthetic source"
    assert not (directory / "source_1.json").exists(), "Failed bytes must not become a published source."
    assert len(list(directory.glob(".upload-*.part"))) == int(cleanup_denied)
    if cleanup_denied:
        assert len(denied) == 1
        assert "import_source_temporary_cleanup_failed" in caplog.text
        assert "PermissionError" in caplog.text and "private-staging" not in caplog.text
    # A later explicit write has its own destination, without touching residue.
    stored, digest = local_storage.save_import_file_stream(identity, "source.json", io.BytesIO(b"ok"), max_bytes=4)
    assert stored.safe_filename == "source_1.json"
    assert (directory / stored.safe_filename).read_bytes() == b"ok"
    assert digest == hashlib.sha256(b"ok").hexdigest()


@pytest.mark.parametrize("cleanup_denied", [False, True])
def test_draft_rejection_preserves_previous_publication_and_primary_error(
    tmp_path, monkeypatch, caplog, cleanup_denied,
):
    monkeypatch.setattr(draft_store, "get_settings", lambda: SimpleNamespace(
        import_storage_dir=tmp_path, import_draft_ttl_hours=24, max_import_file_size_mb=1,
    ))
    raw = json.dumps({"metadata": {"powered_by": "ChatGPT Exporter"},
                      "messages": [{"role": "Prompt", "say": "Synthetic retained draft."}]}).encode()
    conversation = align_exporter_sources(parse_exporter_json(raw), None).conversation
    identity = uuid.uuid4()
    uri, digest, _, _ = draft_store.write_import_draft(identity, [conversation])
    previous = (tmp_path / uri).read_bytes()
    denied = deny_owned_temporary_unlink(monkeypatch, tmp_path, ".canonical-draft.") if cleanup_denied else []
    primary = UploadLimitError("SESSION_TOO_LARGE", "Choose fewer source messages.", status_code=413)

    def failed():
        yield conversation
        raise primary

    with pytest.raises(UploadLimitError) as captured:
        draft_store.write_import_draft(identity, failed())
    assert captured.value is primary and primary.status_code == 413
    assert (tmp_path / uri).read_bytes() == previous
    assert hashlib.sha256(previous).hexdigest() == digest
    assert len(list((tmp_path / str(identity)).glob("*.tmp"))) == int(cleanup_denied)
    if cleanup_denied:
        assert len(denied) == 1
        assert "import_draft_temporary_cleanup_failed" in caplog.text
        assert "PermissionError" in caplog.text and "private-staging" not in caplog.text
