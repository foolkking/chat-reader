"""Private, short-lived canonical exports for fixed-runtime validation."""
from contextlib import contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory
import uuid

from app.core.config import get_settings
from app.models.conversation import Conversation
from app.services.continuation_candidates import ContinuationError
from app.services.exporting.archive_transaction import archive_read_snapshot
from app.services.exporting.context_package import create_context_package


@contextmanager
def temporary_context_snapshot(db, conversation_id, *, subject_key, progress_callback=None, dependency_capture=None):
    """Caller authorizes the target; no artifact/event is persisted by validation.

    PostgreSQL reads use the existing repeatable-read archive snapshot. Temporary
    Raw and attachment copies are removed on success, failure and cancellation.
    """
    root = Path(get_settings().export_storage_dir).resolve() / 'context-validation'
    root.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix='snapshot-', dir=root) as temporary:
        with archive_read_snapshot(db) as snapshot:
            conversation = snapshot.get(Conversation, conversation_id)
            if conversation is None or conversation.deleted_at is not None:
                raise ContinuationError('CONTEXT_NOT_FOUND', 404)
            raw_revision = conversation.offline_revision
            if dependency_capture is not None:
                from app.services.context_dependencies import context_dependency_digest
                dependency_capture['digest'] = context_dependency_digest(snapshot, conversation_id, subject_key)
            artifact = create_context_package(
                snapshot, conversation_id=conversation_id, job_id=uuid.uuid4(),
                scope_kind='full_conversation', start_message_id=None,
                subject_key=subject_key, progress_callback=progress_callback,
                output_directory=Path(temporary), record_artifact=False, include_continuation=False,
            )
        # Close the database snapshot before external file validation starts.
        yield Path(artifact.storage_uri), raw_revision
