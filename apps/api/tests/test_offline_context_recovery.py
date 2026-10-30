"""Synthetic 47-conversation / six-Context-pair incident shape, never user data."""
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import uuid
import zipfile

from app.core.config import get_settings
from app.models.context_continuation import ContextMemberObject
from app.services.assets.asset_store import get_asset_store
from app.services.assets.attachment_storage_integrity import audit_local_attachment_storage
from app.services.continuation_files import update_files
from app.services.ownership import LEGACY_OWNERSHIP_SCOPE
from test_attachment_storage_integrity import _conversation, _database
from test_cr_archive import _run_job
from test_import_preview_api import client  # noqa: F401


def test_repaired_six_context_pairs_build_a_complete_47_conversation_package(client, tmp_path, monkeypatch):
    monkeypatch.setenv("ASSET_STORAGE_DIR", str(tmp_path / "assets"))
    monkeypatch.setenv("OFFLINE_STORAGE_DIR", str(tmp_path / "offline"))
    get_settings.cache_clear()
    db, generator = _database()
    try:
        conversations = [_conversation() for _ in range(47)]
        db.add_all(conversations)
        db.commit()
        for index, conversation in enumerate(conversations[:6]):
            update_files(db, conversation.id, LEGACY_OWNERSHIP_SCOPE, base_generation=0, members={
                "current": f"# Synthetic recovered Current {index}".encode(),
                "index": json.dumps({"chapters": [], "synthetic": index}).encode(),
            })
            db.commit()
        objects = list(db.query(ContextMemberObject))
        assert len(objects) == 12
        preserved = tmp_path / "preserved"
        independent = tmp_path / "independent"
        preserved.mkdir()
        independent.mkdir()
        for obj in objects:
            source = get_asset_store().resolve_key(obj.storage_key)
            shutil.copyfile(source, preserved / obj.sha256)
            shutil.copyfile(source, independent / obj.sha256)
            source.unlink()
        report = audit_local_attachment_storage(db, Path(get_settings().asset_storage_dir), verify_sha256=True)
        assert report.issue_counts == {"MISSING_CONTEXT_FILE": 12}
        # Simulate the no-overwrite recovery protocol; every source is checked.
        for obj in objects:
            source = preserved / obj.sha256
            data = source.read_bytes()
            assert len(data) == obj.byte_size and hashlib.sha256(data).hexdigest() == obj.sha256
            assert (independent / obj.sha256).read_bytes() == data
            destination = get_asset_store().resolve_key(obj.storage_key, must_exist=False)
            destination.parent.mkdir(parents=True, exist_ok=True)
            os.link(source, destination)
        assert audit_local_attachment_storage(db, Path(get_settings().asset_storage_dir), verify_sha256=True).clean
        revisions = {str(row.id): row.offline_revision for row in conversations}
        queued = client.post("/api/offline/packages", headers={"Idempotency-Key": str(uuid.uuid4())},
            json={"scope": "all", "include_assets": "none"})
        assert queued.status_code == 202, queued.text
        _run_job(queued.json()["job_id"])
        downloaded = client.get(f'/api/offline/packages/{queued.json()["package_id"]}/download')
        assert downloaded.status_code == 200, downloaded.text
        with zipfile.ZipFile(io.BytesIO(downloaded.content)) as archive:
            payload = json.loads(archive.read("package.json"))
        assert payload["version"] == 3 and len(payload["conversations"]) == 47
        adopted = [row["continuation"] for row in payload["conversations"] if row.get("continuation")]
        assert len(adopted) == 6
        for state in adopted:
            assert set(state["members"]) == {"current", "index"}
            for member in state["members"].values():
                data = member["text"].encode()
                assert hashlib.sha256(data).hexdigest() == member["sha256"]
                assert len(data) == member["byte_size"]
        db.expire_all()
        assert {str(row.id): row.offline_revision for row in conversations} == revisions
        assert len(list(preserved.iterdir())) == len(list(independent.iterdir())) == 12
    finally:
        db.close()
        generator.close()
