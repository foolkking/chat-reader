"""The reported failure occurs independently of attachment selection."""
import hashlib
import uuid

import pytest

from app.core.config import get_settings
from app.models.background_job import BackgroundJob
from app.models.context_continuation import ContextMemberObject, ContinuationRevision, ContinuationState
from app.models.offline_package_artifact import OfflinePackageArtifact
from app.services.assets.asset_store import get_asset_store
from app.services.background_jobs import queue_offline_package
from app.services.ownership import OwnershipScope
from test_attachment_bundle import bundle_state, state  # noqa: F401
from test_conversation_batch_export import run


@pytest.mark.parametrize("asset_mode", ["none", "all"])
@pytest.mark.parametrize("damage", ["missing", "corrupt"])
def test_context_preflight_reports_owned_source_before_body_packaging(bundle_state, tmp_path, monkeypatch, asset_mode, damage):
    info = bundle_state
    monkeypatch.setenv("OFFLINE_STORAGE_DIR", str(tmp_path / "offline"))
    get_settings.cache_clear()
    cid = info["sources"][0]
    content = b"# Synthetic Current"
    digest = hashlib.sha256(content).hexdigest()
    key = "context/objects/preflight"
    physical = get_asset_store().resolve_key(key)
    physical.parent.mkdir(parents=True, exist_ok=True)
    physical.write_bytes(content)
    with info["factory"]() as db:
        db.add(ContextMemberObject(sha256=digest, byte_size=len(content), storage_key=key))
        db.flush()
        revision = ContinuationRevision(conversation_id=cid, branch_key="direct-files",
            protocol_revision="1", schema_version="unspecified", declared_trust="unverified",
            digest=digest, current_sha256=digest, source_metadata={})
        db.add(revision)
        db.flush()
        db.add(ContinuationState(conversation_id=cid, generation=1, adopted_revision_id=revision.id))
        db.commit()
    if damage == "missing":
        physical.unlink()
    else:
        physical.write_bytes(b"X" * len(content))
    with info["factory"]() as db:
        job = queue_offline_package(db, scope="conversation", conversation_id=cid,
            project_id=None, known_revisions={}, include_assets=asset_mode,
            idempotency_key=str(uuid.uuid4()), subject_key=str(info["owners"][0]),
            ownership_scope=OwnershipScope(info["owners"][0]))
        db.commit()
        jid = job.id
    run(info["factory"], jid)
    with info["factory"]() as db:
        job = db.get(BackgroundJob, jid)
        assert job.status == "failed"
        assert job.processed_items == 0
        expected = "OFFLINE_CONTEXT_UNAVAILABLE" if damage == "missing" else "OFFLINE_CONTEXT_INTEGRITY"
        assert job.error_message == expected
        assert job.result["offline_failure"] == {
            "code": expected, "phase": "checking_dependencies", "affected_count": 1,
            "affected": [{"conversation_id": str(cid), "code": expected}],
        }
        assert db.query(OfflinePackageArtifact).filter_by(job_id=jid).count() == 0
        assert key not in str(job.result)
