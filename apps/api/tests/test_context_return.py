import json
import uuid
import zipfile

import pytest

from app.models.context_continuation import ContextMemberObject, ContinuationCandidate
from app.models.message_version import MessageVersion
from app.services.context_protocol.current_doc import parse_current_document
from app.services.context_return import extract_returned_continuation, create_return_candidate
from app.services.context_snapshot import temporary_context_snapshot
from app.services.continuation_candidates import ContinuationError
from app.services.ownership import LEGACY_OWNERSHIP_SCOPE, LEGACY_SUBJECT_KEY
from test_continuation_candidates import client, private_objects, database, root  # noqa: F401
from test_continuation_validation import valid_pair


def returned_package(canonical, destination, pair, *, transform=None):
    with zipfile.ZipFile(canonical) as source:
        members = {name: source.read(name) for name in source.namelist()}
    manifest = json.loads(members['manifest.json'])
    if 'current' in pair:
        fields = parse_current_document(pair['current'].decode()).frontmatter
        manifest['continuation'] = {key: fields[key] for key in ('schema_version', 'continuation_revision', 'trust', 'coverage')}
        manifest['continuation'].update(current='continuation/current.md', index='continuation/index.json')
    manifest['unneeded_private_sample'] = 'synthetic information that must not be persisted'
    members['manifest.json'] = json.dumps(manifest).encode()
    for name, filename in (('current', 'current.md'), ('index', 'index.json')):
        if name in pair:
            members['continuation/' + filename] = pair[name]
    if transform:
        transform(members)
    with zipfile.ZipFile(destination, 'w') as target:
        for name, value in members.items():
            target.writestr(name, value)
    return destination


def test_return_extracts_pair_without_copying_raw_or_extra_metadata(client, tmp_path):
    path = root(client)
    cid = uuid.UUID(path.split('/')[3])
    pair = valid_pair(cid)
    with database() as db:
        before = [(str(row.id), row.display_text) for row in db.query(MessageVersion).all()]
        with temporary_context_snapshot(db, cid, subject_key=LEGACY_SUBJECT_KEY) as (canonical, _):
            returned = returned_package(canonical, tmp_path / 'returned.context.zip', pair)
        candidate, comparison = create_return_candidate(db, cid, LEGACY_OWNERSHIP_SCOPE, returned,
            subject_key=LEGACY_SUBJECT_KEY, base_generation=0, idempotency_key='returned')
        db.commit()
        assert comparison['relation'] == 'matching'
        assert candidate.status == 'READY_FOR_VALIDATION'
        assert db.query(ContextMemberObject).count() == 3
        assert db.query(ContinuationCandidate).count() == 1
        assert [(str(row.id), row.display_text) for row in db.query(MessageVersion).all()] == before
        from app.services.continuation_candidates import read_object
        saved = json.loads(read_object(db.get(ContextMemberObject, candidate.manifest_sha256)))
        assert set(saved) == {'conversation', 'continuation'}
        assert 'synthetic information' not in json.dumps(saved)
        assert 'files' not in saved


def test_partial_return_remains_draft(client, tmp_path):
    cid = uuid.UUID(root(client).split('/')[3])
    pair = valid_pair(cid)
    with database() as db, temporary_context_snapshot(db, cid, subject_key=LEGACY_SUBJECT_KEY) as (canonical, _):
        returned = returned_package(canonical, tmp_path / 'partial.context.zip', {'current': pair['current']})
        extracted = extract_returned_continuation(returned, canonical, cid)
        assert set(extracted.members) == {'current', 'manifest'}


def test_return_identity_cannot_be_bypassed_by_choosing_target(client, tmp_path):
    cid = uuid.UUID(root(client).split('/')[3])
    pair = valid_pair(cid)
    with database() as db, temporary_context_snapshot(db, cid, subject_key=LEGACY_SUBJECT_KEY) as (canonical, _):
        returned = returned_package(canonical, tmp_path / 'foreign.context.zip', pair)
        with pytest.raises(ContinuationError, match='IDENTITY_UNRESOLVED'):
            extract_returned_continuation(returned, canonical, uuid.uuid4())


def test_tampered_raw_is_rejected_before_member_storage(client, tmp_path):
    cid = uuid.UUID(root(client).split('/')[3])
    pair = valid_pair(cid)
    def corrupt(members):
        members['conversation.canjsonl'] += b'\n{}'
    with database() as db, temporary_context_snapshot(db, cid, subject_key=LEGACY_SUBJECT_KEY) as (canonical, _):
        returned = returned_package(canonical, tmp_path / 'corrupt.context.zip', pair, transform=corrupt)
        with pytest.raises(ContinuationError, match='RETURN_INVALID'):
            extract_returned_continuation(returned, canonical, cid)


def test_unlisted_attachment_bytes_must_match_raw_declaration(client, tmp_path):
    cid = uuid.UUID(root(client).split('/')[3])
    pair = valid_pair(cid)
    def corrupt(members):
        record = {'record_type': 'attachment', 'id': 'synthetic-attachment',
                  'object': {'path': 'assets/item', 'sha256': '0' * 64, 'byte_size': 3}}
        members['conversation.canjsonl'] += b'\n' + json.dumps(record).encode()
        members['assets/item'] = b'bad'
        manifest = json.loads(members['manifest.json'])
        manifest['files'] = {}
        members['manifest.json'] = json.dumps(manifest).encode()
    with database() as db, temporary_context_snapshot(db, cid, subject_key=LEGACY_SUBJECT_KEY) as (canonical, _):
        returned = returned_package(canonical, tmp_path / 'asset.context.zip', pair, transform=corrupt)
        with pytest.raises(ContinuationError, match='ATTACHMENT_MISMATCH'):
            extract_returned_continuation(returned, canonical, cid)


def run_job(task_id):
    from sqlalchemy.orm import sessionmaker
    from app.models.background_job import BackgroundJob
    from app.services.background_jobs import process_background_job
    with database() as db:
        db.get(BackgroundJob, uuid.UUID(task_id)).status = 'processing'
        db.commit()
        factory = sessionmaker(bind=db.get_bind(), expire_on_commit=False)
    process_background_job(uuid.UUID(task_id), session_factory=factory)


def test_direct_status_resumes_only_this_conversations_pending_return(client, tmp_path):
    path = root(client)
    another = root(client)
    bundle = tmp_path / 'resume.context.zip'
    with zipfile.ZipFile(bundle, 'w') as archive:
        archive.writestr('manifest.json', '{}')
        archive.writestr('conversation.canjsonl', 'Synthetic Raw is not imported')
        archive.writestr('continuation/current.md', '# Resume update')
    queued = client.post(path + '/returns', data={'base_generation': 0, 'idempotency_key': 'resume'},
        files={'file': ('resume.context.zip', bundle.read_bytes())})
    assert queued.status_code == 202
    task_id = queued.json()['task_id']
    assert client.get(path).json()['pending_return_task_id'] == task_id
    assert client.get(another).json()['pending_return_task_id'] is None
    run_job(task_id)
    assert client.get(path).json()['pending_return_task_id'] is None
    assert client.get(path).json()['generation'] == 1


def test_return_worker_removes_original_zip_after_persisting_only_members(client, tmp_path):
    from pathlib import Path
    from app.models.background_job import BackgroundJob
    from app.models.export_artifact import ExportArtifact
    path = root(client)
    cid = uuid.UUID(path.split('/')[3])
    pair = valid_pair(cid)
    with database() as db, temporary_context_snapshot(db, cid, subject_key=LEGACY_SUBJECT_KEY) as (canonical, _):
        returned = returned_package(canonical, tmp_path / 'returned.context.zip', pair)
    data = returned.read_bytes()
    form = {'base_generation': 0, 'idempotency_key': 'worker-return'}
    response = client.post(path + '/returns', data=form, files={'file': ('return.context.zip', data)})
    assert response.status_code == 202, response.text
    task_id = response.json()['task_id']
    assert client.post(path + '/returns', data=form, files={'file': ('again.zip', data)}).json()['task_id'] == task_id
    with database() as db:
        upload = db.query(ExportArtifact).filter_by(job_id=uuid.UUID(task_id)).one()
        private_path = Path(upload.storage_uri)
        artifact_id = upload.id
    assert client.get(f'/api/exports/{artifact_id}/download').status_code == 404
    run_job(task_id)
    with database() as db:
        job = db.get(BackgroundJob, uuid.UUID(task_id))
        assert job.status == 'committed', job.error_message
        assert job.result['next_action'] == 'view_files'
        assert job.result['generation'] == 1
        assert db.query(ContinuationCandidate).count() == 0
        assert db.query(ContextMemberObject).count() == 2
        assert db.get(ExportArtifact, artifact_id) is None
    assert not private_path.exists()


def test_failed_return_has_bounded_retry_lifetime(client):
    from pathlib import Path
    from datetime import datetime, timedelta, timezone
    from app.models.background_job import BackgroundJob
    from app.models.export_artifact import ExportArtifact
    from app.services.context_return_jobs import expire_context_returns
    from app.services.artifact_lifecycle import cleanup_committed_artifacts
    from app.core.config import get_settings
    path = root(client)
    response = client.post(path + '/returns', data={'base_generation': 0, 'idempotency_key': 'bad-return'},
                           files={'file': ('malformed.zip', b'not a zip')})
    assert response.status_code == 202
    task_id = response.json()['task_id']
    run_job(task_id)
    with database() as db:
        assert db.get(BackgroundJob, uuid.UUID(task_id)).status == 'failed'
        upload = db.query(ExportArtifact).filter_by(job_id=uuid.UUID(task_id)).one()
        private_path = Path(upload.storage_uri)
        assert private_path.exists()
        assert expire_context_returns(db) == []
        upload.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()
        paths = expire_context_returns(db)
        db.commit()
        assert paths == [private_path]
        cleanup_committed_artifacts(paths, root=Path(get_settings().export_storage_dir), category='export')
        assert not private_path.exists()
        assert db.query(ContinuationCandidate).count() == 0


def test_direct_return_accepts_plain_members_without_semantic_checks(client, tmp_path):
    from app.services.context_return import extract_direct_files
    from app.models.context_continuation import ContinuationRevision, ContinuationValidation
    import zipfile
    package = tmp_path / 'plain.context.zip'
    with zipfile.ZipFile(package, 'w') as archive:
        archive.writestr('manifest.json', '{}')
        archive.writestr('conversation.canjsonl', 'Raw is not imported or interpreted')
        archive.writestr('continuation/current.md', '# Human notes')
        archive.writestr('scripts/do-not-run.py', 'raise RuntimeError("must never run")')
    assert extract_direct_files(package) == {'current': b'# Human notes'}
    path = root(client)
    response = client.post(path + '/returns', data={'base_generation': 0, 'idempotency_key': 'direct'},
        files={'file': ('plain.context.zip', package.read_bytes())})
    assert response.status_code == 202
    run_job(response.json()['task_id'])
    with database() as db:
        assert db.query(ContinuationCandidate).count() == 0
        assert db.query(ContinuationValidation).count() == 0
        assert db.query(ContinuationRevision).one().source_metadata['mode'] == 'direct_files'
