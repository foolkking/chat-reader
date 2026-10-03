"""Return publication races against real PostgreSQL transactions and private files."""
import os
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile

import pytest
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings
from app.models.background_job import BackgroundJob
from app.models.context_continuation import ContextMemberObject, ContinuationRevision, ContinuationState
from app.models.conversation import Conversation
from app.models.export_artifact import ExportArtifact
from app.models.user import User
from app.services import continuation_files
from app.services.assets.asset_store import get_asset_store
from app.services.background_jobs import (
    claim_next_job, process_background_job, request_background_job_cancellation, retry_background_job,
)
from app.services.context_return_jobs import receive_context_return
from app.services.continuation_candidates import read_object
from app.services.ownership import OwnershipScope
from test_import_profile_postgres import isolated_schema  # noqa: F401

pytestmark = pytest.mark.skipif(
    os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1", reason="requires disposable PostgreSQL",
)


@pytest.mark.parametrize("interruption", ["cancel", "failure"])
def test_return_interrupted_after_file_write_preserves_saved_pair_and_can_resume(
    isolated_schema, tmp_path, monkeypatch, interruption,
):
    engine, migrate = isolated_schema
    migrate("head")
    monkeypatch.setenv("AUTH_ENABLED", "true")
    monkeypatch.setenv("ASSET_STORAGE_DIR", str(tmp_path / "assets"))
    monkeypatch.setenv("EXPORT_STORAGE_DIR", str(tmp_path / "exports"))
    get_settings.cache_clear()
    package = BytesIO()
    with ZipFile(package, "w") as archive:
        archive.writestr("manifest.json", "{}")
        archive.writestr("conversation.canjsonl", "Synthetic Raw must not be imported")
        archive.writestr("continuation/current.md", "# Returned Current")
    original_update = continuation_files.update_files
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    try:
        with Session(engine) as db:
            owner = User(normalized_email="context-return-race@example.test")
            db.add(owner); db.flush()
            conversation = Conversation(owner_user_id=owner.id, title="Synthetic return race", display_title="Synthetic",
                source_type="synthetic", source_profile="synthetic", parser_version="test")
            db.add(conversation); db.flush()
            owner_id, conversation_id = owner.id, conversation.id
            scope = OwnershipScope(owner_id)
            previous, _ = original_update(db, conversation_id, scope, base_generation=0,
                members={"current": b"# Saved Current", "index": b'{"saved":"Index"}'})
            db.commit()
            previous_id, offline_revision = previous.id, conversation.offline_revision
            original_keys = {row.storage_key for row in db.query(ContextMemberObject)}
            job = receive_context_return(db, BytesIO(package.getvalue()), conversation_id, scope,
                base_generation=1, idempotency_key="interrupted-return")
            db.commit()
            job_id = job.id
            upload_path = Path(db.query(ExportArtifact).filter_by(job_id=job_id).one().storage_uri)
            assert claim_next_job(db, job_type="context_return") == job_id
            db.commit()

        def interrupt_after_actual_write(db, *args, **kwargs):
            saved = original_update(db, *args, **kwargs)
            if interruption == "failure":
                raise OSError("synthetic private path must not enter task errors")
            with Session(engine) as cancelling:
                request_background_job_cancellation(cancelling.get(BackgroundJob, job_id))
                cancelling.commit()
            return saved

        with monkeypatch.context() as patch:
            patch.setattr(continuation_files, "update_files", interrupt_after_actual_write)
            process_background_job(job_id, session_factory=factory)

        with Session(engine) as db:
            job = db.get(BackgroundJob, job_id)
            assert job.status == ("cancelled" if interruption == "cancel" else "failed")
            assert not job.error_message or "private path" not in job.error_message
            assert db.get(ContinuationState, conversation_id).generation == 1
            assert db.get(ContinuationState, conversation_id).adopted_revision_id == previous_id
            assert db.get(Conversation, conversation_id).offline_revision == offline_revision
            assert db.query(ContinuationRevision).count() == 1
            assert {row.storage_key for row in db.query(ContextMemberObject)} == original_keys
            store = get_asset_store()
            assert {file for file in (tmp_path / "assets").rglob("*") if file.is_file()} == {
                store.resolve_key(key) for key in original_keys
            }
            assert db.query(ExportArtifact).filter_by(job_id=job_id).count() == 1
            assert upload_path.read_bytes() == package.getvalue()
            if interruption == "failure":
                retry_background_job(job)
            else:
                job = receive_context_return(db, BytesIO(package.getvalue()), conversation_id, scope,
                    base_generation=1, idempotency_key="explicit-new-return")
            db.commit()
            resumed_id = job.id
            assert claim_next_job(db, job_type="context_return") == resumed_id
            db.commit()

        process_background_job(resumed_id, session_factory=factory)
        with Session(engine) as db:
            assert db.get(BackgroundJob, resumed_id).status == "committed"
            state = db.get(ContinuationState, conversation_id)
            assert state.generation == 2
            assert db.get(Conversation, conversation_id).offline_revision == offline_revision + 1
            assert db.query(ContinuationRevision).count() == 2
            selected = db.get(ContinuationRevision, state.adopted_revision_id)
            assert read_object(db.get(ContextMemberObject, selected.current_sha256)) == b"# Returned Current"
            assert read_object(db.get(ContextMemberObject, selected.index_sha256)) == b'{"saved":"Index"}'
            assert db.query(ExportArtifact).filter_by(job_id=resumed_id).count() == 0
            # Cancelled input keeps its bounded retry/expiry lifecycle; a successful
            # retry of the original failed job consumes its input exactly once.
            assert upload_path.exists() == (interruption == "cancel")
    finally:
        get_settings.cache_clear()
