import json
import uuid
import zipfile

from app.models.attachment import Attachment, MessageVersionAttachment
from app.models.message import Message
from app.models.background_job import BackgroundJob
from app.models.export_artifact import ExportArtifact
from app.services.exporting.context_package import create_context_package
from app.services.context_protocol.source import PackageSource
from app.services.context_protocol.canonical_v2 import select_adapter
from app.services.context_protocol.fingerprints import fingerprint_messages
from test_system_archive_integrity import archive_db, seed_archive_source  # noqa: F401
from test_continuation_candidates import client, database, root, private_objects  # noqa: F401
from test_context_return import run_job


def test_metadata_only_retains_attachment_identity_without_bytes(archive_db, tmp_path):
    users, conversations, _, asset = seed_archive_source(archive_db)
    asset.scan_status = 'clean'
    attachment = archive_db.query(Attachment).one()
    attachment.status = 'active'
    attachment.deleted_at = None
    message = archive_db.query(Message).filter_by(conversation_id=conversations[0].id).one()
    archive_db.add(MessageVersionAttachment(message_version_id=message.current_version_id, attachment_id=attachment.id))
    archive_db.commit()
    fingerprints = []
    for include in (True, False):
        artifact = create_context_package(archive_db, conversation_id=conversations[0].id, job_id=uuid.uuid4(),
            scope_kind='full_conversation', start_message_id=None, output_directory=tmp_path / 'packages',
            record_artifact=False, include_attachments=include, subject_key=str(users[0].id))
        with zipfile.ZipFile(artifact.storage_uri) as archive:
            manifest = json.loads(archive.read('manifest.json'))
            objects = [path for path in archive.namelist() if path.startswith('assets/')]
            assert len(objects) == (1 if include else 0)
            assert manifest['attachments']['requested'] is include
            assert manifest['attachments']['omitted_object_count'] == (0 if include else 1)
            assert manifest['attachments']['missing_object_count'] == 0
            assert manifest['asset_completeness'] == ('complete' if include else 'partial')
        with PackageSource(artifact.storage_uri) as source:
            adapter = select_adapter(source, 'conversation.canjsonl')
            snapshot = adapter.scan()
            assert snapshot.attachments[str(attachment.id)].object_sha256 == asset.sha256
            fingerprints.append(fingerprint_messages(adapter.iter_messages(), snapshot, 'prefix'))
    assert fingerprints[0] == fingerprints[1]


def test_context_options_reach_worker_and_changed_idempotency_is_rejected(client):
    path = root(client).removesuffix('/continuation')
    headers = {'Idempotency-Key': 'synthetic-context-options'}
    payload = {'format': 'context_package', 'context_attachment_policy': 'metadata_only', 'continuation_policy': 'raw_only'}
    response = client.post(path + '/exports', headers=headers, json=payload)
    assert response.status_code == 202, response.text
    job_id = response.json()['job_id']
    assert client.post(path + '/exports', headers=headers, json=payload).json()['job_id'] == job_id
    changed = client.post(path + '/exports', headers=headers, json={**payload, 'context_attachment_policy': 'include'})
    assert changed.status_code == 409
    run_job(job_id)
    with database() as db:
        job = db.get(BackgroundJob, uuid.UUID(job_id))
        assert job.status == 'committed', job.error_message
        artifact = db.query(ExportArtifact).filter_by(job_id=job.id).one()
        with zipfile.ZipFile(artifact.storage_uri) as archive:
            manifest = json.loads(archive.read('manifest.json'))
            assert manifest['attachments']['policy'] == 'metadata_only'
            assert manifest['extensions']['chat_reader_continuation_export']['status'] == 'omitted_by_request'
