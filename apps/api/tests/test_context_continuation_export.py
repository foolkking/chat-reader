import hashlib
import json
from pathlib import Path
import uuid
import zipfile
import pytest

from app.models.conversation import Conversation
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.services.exporting.context_package import create_context_package
from app.services.context_protocol.validation import validate_continuation
from app.services.ownership import LEGACY_SUBJECT_KEY
from test_continuation_candidates import client, private_objects, database, root  # noqa: F401
from test_continuation_adoption import seed_legacy_adopted


def adopted(client):
    path = root(client)
    return seed_legacy_adopted(client, path)[0]


def export(cid, tmp_path, *, start=None, **options):
    with database() as db:
        artifact = create_context_package(db, conversation_id=cid, job_id=uuid.uuid4(),
            scope_kind='reading_scope' if start else 'full_conversation', start_message_id=start,
            subject_key=LEGACY_SUBJECT_KEY, output_directory=tmp_path, record_artifact=False, **options)
        path = Path(artifact.storage_uri)
    with zipfile.ZipFile(path) as archive:
        manifest = json.loads(archive.read('manifest.json'))
        members = set(archive.namelist())
        for name, expected in manifest['files'].items():
            assert hashlib.sha256(archive.read(name)).hexdigest() == expected['sha256']
    return path, manifest, members


def append_message(cid):
    with database() as db:
        message = Message(conversation_id=cid, role='user', order_key='zzzzzz', turn_index=3)
        db.add(message)
        db.flush()
        version = MessageVersion(message_id=message.id, version_number=1, plain_text='Synthetic new tail',
                                 display_text='Synthetic new tail', edit_type='test', content_hash=hashlib.sha256(b'Synthetic new tail').hexdigest())
        db.add(version)
        db.flush()
        message.current_version_id = version.id
        conversation = db.get(Conversation, cid)
        conversation.offline_revision += 1
        conversation.message_count += 1
        db.commit()


def test_export_carries_valid_pair_with_original_coverage(client, tmp_path):
    cid = adopted(client)
    path, manifest, members = export(cid, tmp_path)
    assert manifest['extensions']['chat_reader_continuation_export']['status'] == 'included_without_validation'
    assert manifest['continuation']['coverage']['message_count'] == 2
    assert 'continuation/current.md' in members and 'continuation/index.json' in members
    result = validate_continuation(str(path))
    assert result['runtime_state'] == 'valid_provisional', result['findings']


def test_new_tail_preserves_source_claims_without_extending_coverage(client, tmp_path):
    cid = adopted(client)
    append_message(cid)
    path, manifest, members = export(cid, tmp_path)
    assert manifest['continuation']['coverage']['seq_end'] == 2
    assert manifest['continuation']['coverage']['message_count'] == 2
    assert 'raw_tail_start_seq' not in manifest['continuation']
    assert manifest['extensions']['chat_reader_continuation_export']['status'] == 'included_without_validation'
    assert manifest['conversation']['message_count'] == 3


def test_changed_prefix_keeps_saved_files_without_claiming_freshness(client, tmp_path):
    cid = adopted(client)
    with database() as db:
        message = db.query(Message).filter_by(conversation_id=cid).order_by(Message.order_key).first()
        db.get(MessageVersion, message.current_version_id).display_text = 'Changed history'
        db.get(Conversation, cid).offline_revision += 1
        db.commit()
    _, manifest, members = export(cid, tmp_path)
    assert 'continuation/current.md' in members
    assert manifest['continuation']['coverage']['message_count'] == 2
    assert manifest['extensions']['chat_reader_continuation_export']['status'] == 'included_without_validation'


def test_partial_scope_never_contains_outside_prefix_state(client, tmp_path):
    cid = adopted(client)
    with database() as db:
        second = db.query(Message).filter_by(conversation_id=cid).order_by(Message.order_key).all()[1].id
    _, manifest, members = export(cid, tmp_path, start=second)
    assert 'continuation' not in manifest
    assert 'continuation/current.md' not in members
    assert manifest['extensions']['chat_reader_continuation_export']['status'] == 'excluded_from_partial_export'


def test_supplementary_change_does_not_semantically_validate_saved_files(client, tmp_path):
    cid = adopted(client)
    with database() as db:
        db.get(Conversation, cid).description_markdown = 'New supplementary description'
        db.commit()
    _, manifest, members = export(cid, tmp_path)
    assert 'continuation/current.md' in members
    assert manifest['extensions']['chat_reader_continuation_export']['status'] == 'included_without_validation'


def test_locator_change_does_not_rewrite_saved_files(client, tmp_path):
    cid = adopted(client)
    with database() as db:
        message = db.query(Message).filter_by(conversation_id=cid).order_by(Message.order_key).first()
        previous = db.get(MessageVersion, message.current_version_id)
        replacement = MessageVersion(message_id=message.id, version_number=2, plain_text=previous.plain_text,
                                     display_text=previous.display_text, edit_type='test', content_hash=previous.content_hash)
        db.add(replacement)
        db.flush()
        message.current_version_id = replacement.id
        db.get(Conversation, cid).offline_revision += 1
        db.commit()
    _, manifest, members = export(cid, tmp_path)
    assert 'continuation/current.md' in members
    assert manifest['extensions']['chat_reader_continuation_export']['status'] == 'included_without_validation'


def test_export_change_before_publication_leaves_no_final_or_staging_package(client, tmp_path):
    from app.services.exporting.context_package import ContextPackageError
    cid = adopted(client)
    with database() as db:
        changed = False
        def change_source(phase, progress, processed, total):
            nonlocal changed
            if phase == 'serializing' and not changed:
                changed = True
                db.query(Conversation).filter_by(id=cid).update({Conversation.offline_revision: Conversation.offline_revision + 1}, synchronize_session=False)
                db.flush()
        with pytest.raises(ContextPackageError, match='source changed'):
            create_context_package(db, conversation_id=cid, job_id=uuid.uuid4(), scope_kind='full_conversation',
                start_message_id=None, subject_key=LEGACY_SUBJECT_KEY, output_directory=tmp_path / "attempt",
                record_artifact=False, progress_callback=change_source)
        db.rollback()
    assert not [file for file in (tmp_path / 'attempt').rglob('*') if file.is_file()]


def test_broken_optional_pair_does_not_break_raw_export(client, tmp_path):
    from app.models.context_continuation import ContinuationRevision, ContextMemberObject
    from app.services.assets.asset_store import get_asset_store
    cid = adopted(client)
    with database() as db:
        revision = db.query(ContinuationRevision).filter_by(conversation_id=cid).one()
        obj = db.get(ContextMemberObject, revision.current_sha256)
        get_asset_store().resolve_key(obj.storage_key).write_bytes(b'corrupt synthetic Current')
    _, manifest, members = export(cid, tmp_path)
    assert 'conversation.canjsonl' in members
    assert 'continuation' not in manifest
    assert manifest['extensions']['chat_reader_continuation_export']['status'] == 'unavailable'


def test_explicit_raw_only_does_not_delete_adopted_state(client, tmp_path):
    from app.models.context_continuation import ContinuationState
    cid = adopted(client)
    _, manifest, members = export(cid, tmp_path, include_continuation=False)
    assert 'continuation' not in manifest
    assert 'continuation/current.md' not in members
    assert manifest['extensions']['chat_reader_continuation_export']['status'] == 'omitted_by_request'
    with database() as db:
        assert db.get(ContinuationState, cid).adopted_revision_id is not None
