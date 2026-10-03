from pathlib import Path
import uuid

import pytest
from sqlalchemy.orm import sessionmaker

from app.core.config import get_settings
from app.models.background_job import BackgroundJob
from app.models.context_continuation import ContinuationCandidate, ContinuationValidation
from app.models.conversation_event import ConversationEvent
from app.models.export_artifact import ExportArtifact
from app.services.background_jobs import process_background_job
from app.services.context_snapshot import temporary_context_snapshot
from test_continuation_candidates import client, private_objects, database, root, seed_legacy_candidate  # noqa: F401


def valid_pair(conversation_id, trust='provisional', revision=1):
    import json
    from app.services.context_protocol.source import PackageSource
    from app.services.context_protocol.canonical_v2 import select_adapter
    from app.services.context_protocol.fingerprints import fingerprint_messages
    with database() as db, temporary_context_snapshot(db, conversation_id, subject_key='local:default') as (path, _):
        with PackageSource(path) as source:
            adapter = select_adapter(source, 'conversation.canjsonl')
            snapshot = adapter.scan()
            messages = list(adapter.iter_messages())
            prefix = fingerprint_messages(messages, snapshot, 'prefix')
            segment = fingerprint_messages(messages, snapshot, 'segment')
    count = len(messages)
    coverage = {'seq_start': 1, 'seq_end': count, 'message_count': count, 'source_fingerprint': prefix}
    current = ('---\nschema: chat-reader-continuation\nschema_version: 1.0.0\n'
               f'conversation_id: {conversation_id}\ncontinuation_revision: {revision}\ntrust: {trust}\n'
               f'coverage:\n  seq_start: 1\n  seq_end: {count}\n  message_count: {count}\n  source_fingerprint:\n'
               + ''.join(f'    {key}: "{value}"\n' for key, value in prefix.items())
               + 'index: continuation/index.json\n---\n# Synthetic current\nA question and its initial answer.\n').encode()
    index = {'schema': 'chat-reader-continuation-index', 'schema_version': '1.0.0', 'conversation_id': str(conversation_id),
             'continuation_revision': revision, 'coverage': coverage,
             'chapters': [{'id': 'CH-001', 'seq_start': 1, 'seq_end': count, 'segment_ids': ['SEG-001']}],
             'segments': [{'id': 'SEG-001', 'seq_start': 1, 'seq_end': count, 'message_count': count,
                           'kind': 'exploration', 'title': 'Synthetic question', 'about': 'Initial question and answer',
                           'fingerprint': segment, 'key_refs': [], 'attachment_refs': []}]}
    return {'current': current, 'index': json.dumps(index).encode()}


@pytest.mark.parametrize('trust', ['verified', 'provisional'])
def test_valid_pair_matches_real_export_without_claiming_semantic_review(client, trust):
    from app.services.continuation_validation import validate_candidate_members
    from app.services.ownership import LEGACY_OWNERSHIP_SCOPE
    path = root(client)
    conversation_id = uuid.UUID(path.split('/')[3])
    pair = valid_pair(conversation_id, trust)
    candidate = seed_legacy_candidate(path, **pair)
    with database() as db:
        result = validate_candidate_members(db, conversation_id, uuid.UUID(str(candidate['id'])),
                                            LEGACY_OWNERSHIP_SCOPE, subject_key='local:default')
        db.commit()
        assert result.runtime_state == 'valid_' + trust, result.result
        assert result.result['eligible_for_adoption'] is True
        assert result.result['semantic_review'] == 'not_performed'
        assert result.result['declared_trust'] == trust


def test_temporary_snapshot_has_no_persisted_export_and_cleans_on_failure(client):
    path = root(client)
    conversation_id = uuid.UUID(path.split('/')[3])
    with database() as db:
        count = db.query(ConversationEvent).count()
        with pytest.raises(RuntimeError, match='synthetic'):
            with temporary_context_snapshot(db, conversation_id, subject_key='local:default') as (package, revision):
                assert package.is_file() and revision >= 1
                assert db.query(ExportArtifact).count() == 0
                assert db.query(ConversationEvent).count() == count
                directory = package.parent.parent
                raise RuntimeError('synthetic validation interruption')
        assert not directory.exists()
        db.commit()
        assert db.query(ExportArtifact).count() == 0
        assert db.query(ConversationEvent).count() == count


def test_old_queued_validation_fails_without_new_receipt_or_file_changes(client):
    from app.services.continuation_validation import queue_candidate_validation
    from app.services.ownership import LEGACY_OWNERSHIP_SCOPE
    path = root(client)
    cid = uuid.UUID(path.split('/')[3])
    candidate = seed_legacy_candidate(path, current=b'# original', index=b'{}')
    candidate_id = uuid.UUID(str(candidate['id']))
    with database() as db:
        job = queue_candidate_validation(db, cid, candidate_id, LEGACY_OWNERSHIP_SCOPE, input_revision=1, idempotency_key='historical-job')
        job.status = 'processing'
        db.commit()
        job_id = job.id
        factory = sessionmaker(bind=db.get_bind(), expire_on_commit=False)
    process_background_job(job_id, session_factory=factory)
    with database() as db:
        assert db.get(BackgroundJob, job_id).status == 'failed'
        assert db.get(BackgroundJob, job_id).error_message == 'CONTEXT_VALIDATION_RETIRED'
        assert db.query(ContinuationValidation).count() == 0
        assert db.get(ContinuationCandidate, candidate_id).input_revision == 1
    denied = client.post(f'/api/tasks/{job_id}/retry')
    assert denied.status_code == 410
    with database() as db:
        assert db.get(BackgroundJob, job_id).status == 'failed'
