"""Only server-owned Context temporary uploads enter the existing reaper."""
from datetime import timedelta

import pytest

from app.models.background_job import BackgroundJob
from app.models.export_artifact import ExportArtifact
from app.services.export_retention import CONTEXT_UPLOAD_FORMAT, reclaim_exports
from test_export_retention import BODY, NOW, exports  # noqa: F401


def context_upload(exports, *, status="failed", expired=True, release=False):
    factory, root, make, _ = exports
    identity, path, job_id = make(scope="archive_upload", status=status, job_type="context_return",
        expires=NOW + timedelta(hours=-1 if expired else 1))
    with factory() as db:
        artifact = db.get(ExportArtifact, identity)
        artifact.format = CONTEXT_UPLOAD_FORMAT
        if release:
            artifact.release_requested_at = NOW
        db.get(BackgroundJob, job_id).result = {"next_action": "view_files", "generation": 2}
        db.commit()
    return identity, path, job_id


@pytest.mark.parametrize("status", ["queued", "failed", "committed", "cancelled", "canceled", "processing", "cancelling", "unknown"])
@pytest.mark.parametrize("expired", [False, True])
def test_private_context_upload_retention_and_busy_states(exports, status, expired):
    factory, root, _, _ = exports
    identity, path, job_id = context_upload(exports, status=status, expired=expired)
    expected = expired and status in {"queued", "failed", "committed", "cancelled", "canceled"}
    assert reclaim_exports(factory, root, now=NOW)["reclaimed"] == int(expected)
    assert path.exists() is not expected
    with factory() as db:
        assert (db.get(ExportArtifact, identity) is None) is expected
        job = db.get(BackgroundJob, job_id)
        assert job.status == status
        assert job.result == {"next_action": "view_files", "generation": 2}


@pytest.mark.parametrize("mismatch", ["format", "scope", "job_type", "outside", "replaced", "shared"])
def test_reaper_cannot_expand_private_upload_scope_or_follow_changed_sources(exports, tmp_path, mismatch):
    factory, root, make, _ = exports
    identity, path, job_id = context_upload(exports)
    with factory() as db:
        row = db.get(ExportArtifact, identity)
        if mismatch == "format":
            row.format = "other-private-archive"
        elif mismatch == "scope":
            row.scope_type = "other-private-scope"
        elif mismatch == "job_type":
            db.get(BackgroundJob, job_id).job_type = "other-job"
        elif mismatch == "outside":
            outside = tmp_path / "preserved.zip"; outside.write_bytes(BODY)
            row.storage_uri = str(outside)
        elif mismatch == "replaced":
            path.write_bytes(b"Changed source")
        elif mismatch == "shared":
            other, _, _ = make()
            db.get(ExportArtifact, other).storage_uri = str(path)
        db.commit()
    outcome = reclaim_exports(factory, root, now=NOW)
    assert outcome["reclaimed"] == 0 and path.exists()
    with factory() as db:
        row = db.get(ExportArtifact, identity)
        assert row is not None
        assert row.failure_code == {"outside": "unsafe_path", "replaced": "file_changed", "shared": "shared_reference"}.get(mismatch)
    if mismatch == "outside":
        assert outside.read_bytes() == BODY


def test_context_cleanup_resumes_after_interruption_and_keeps_existing_twenty_item_budget(exports):
    factory, root, _, _ = exports
    identity, path, _ = context_upload(exports, status="committed", expired=False, release=True)
    def permitted():
        with factory() as db:
            row = db.get(ExportArtifact, identity)
            return row is not None and row.lifecycle_state != "reclaiming"
    assert reclaim_exports(factory, root, now=NOW, should_continue=permitted)["deferred"] == 1
    assert path.exists()
    with factory() as db:
        assert db.get(ExportArtifact, identity).lifecycle_state == "reclaiming"
    for _ in range(22):
        context_upload(exports)
    first = reclaim_exports(factory, root, now=NOW)
    assert first["reclaimed"] == 20
    assert reclaim_exports(factory, root, now=NOW)["reclaimed"] == 3
    assert reclaim_exports(factory, root, now=NOW)["reclaimed"] == 0


def test_success_disposal_authorization_is_not_visible_before_commit_and_can_roll_back(exports):
    factory, root, _, _ = exports
    identity, path, _ = context_upload(exports, status="committed", expired=False)
    with factory() as publisher:
        publisher.get(ExportArtifact, identity).release_requested_at = NOW
        assert reclaim_exports(factory, root, now=NOW)["reclaimed"] == 0
        publisher.rollback()
    assert path.exists()
    with factory() as db:
        assert db.get(ExportArtifact, identity).release_requested_at is None


def test_runtime_counts_only_actual_context_cleanup_and_does_not_expose_private_paths(exports):
    from app.services.admin_runtime import _export_cleanup
    factory, _, _, _ = exports
    context_upload(exports)
    context_upload(exports, expired=False)
    context_upload(exports, status="processing")
    identity, _, _ = context_upload(exports, status="committed", expired=False, release=True)
    with factory() as db:
        db.get(ExportArtifact, identity).lifecycle_state = "retry"
        db.commit()
        result = _export_cleanup(db, NOW)
        assert result == {"pending_count": 2, "pending_bytes": len(BODY) * 2, "failed_count": 1}
        assert not db.dirty and not db.deleted


@pytest.mark.parametrize("state", ["released", "reclaiming", "retry", "reclaimed", "missing"])
def test_return_cannot_reopen_a_disposal_receipt_or_missing_upload(exports, state):
    from app.services.context_return_jobs import process_context_return
    from app.services.continuation_candidates import ContinuationError
    factory, _, _, _ = exports
    identity, path, job_id = context_upload(exports, expired=False)
    with factory() as db:
        row = db.get(ExportArtifact, identity)
        if state == "missing":
            db.delete(row)
        elif state == "released":
            row.release_requested_at = NOW
        else:
            row.lifecycle_state = state
        db.commit()
    with factory() as db:
        with pytest.raises(ContinuationError, match="CONTEXT_RETURN_EXPIRED"):
            process_context_return(db, db.get(BackgroundJob, job_id), None,
                lambda *args: pytest.fail("Released input must not start file application."))
    assert path.read_bytes() == BODY
