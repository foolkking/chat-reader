"""Exercise the reviewed, hash-pinned default readers against actual exports.

Only the listed deterministic reader modules run in this test process. Application
code must never import scripts from uploaded or system Skill Bundles.
"""
import hashlib
import importlib
import importlib.util
import json
from pathlib import Path
import sys
import uuid
import zipfile

import pytest

from app.models.annotation import ConversationAnnotation, ConversationNotebook
from app.models.attachment import Attachment, MessageVersionAttachment
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.services.exporting.context_package import create_context_package
from app.services.import_pipeline.canjson_parser import parse_canjson_v2
from test_system_archive_integrity import archive_db, seed_archive_source  # noqa: F401


DEFAULTS = {
    'context-acquisition': '0ce84c02163d1d9b33d23103b8a13a23c664becda095e913f4af4a260d19cb2a',
    'context-continuation-maintainer': '9f77a4bb3a0d5158ef6956ca6b3694c80a6bf09cc2329053c0fe5372221429e4',
}
REVIEWED_MODULES = ('__init__.py', 'model.py', 'source.py', 'safety.py', 'canonical_v2.py', 'manifest.py', 'fingerprints.py')


@pytest.fixture(params=DEFAULTS)
def shipped_reader(request, tmp_path):
    root = Path(__file__).resolve().parents[3]
    name = request.param
    bundle = root / 'tools/context-skills/default-bundles' / f'{name}.zip'
    assert hashlib.sha256(bundle.read_bytes()).hexdigest() == DEFAULTS[name]
    assert (root / 'apps/web/public/skills' / f'{name}.zip').read_bytes() == bundle.read_bytes()
    directory = tmp_path / name
    directory.mkdir()
    with zipfile.ZipFile(bundle) as archive:
        for module in REVIEWED_MODULES:
            (directory / module).write_bytes(archive.read(f'{name}/scripts/_context_package/{module}'))
    package_name = 'reviewed_' + name.replace('-', '_')
    spec = importlib.util.spec_from_file_location(package_name, directory / '__init__.py', submodule_search_locations=[str(directory)])
    package = importlib.util.module_from_spec(spec)
    sys.modules[package_name] = package
    try:
        spec.loader.exec_module(package)
        yield {name: importlib.import_module(f'{package_name}.{name}') for name in ('source', 'canonical_v2', 'manifest', 'fingerprints')}
    finally:
        for name in list(sys.modules):
            if name == package_name or name.startswith(package_name + '.'):
                del sys.modules[name]


@pytest.mark.parametrize('include_attachments', [True, False])
@pytest.mark.parametrize('partial', [True, False])
def test_shipped_readers_recover_exported_bodies_locators_and_attachments(archive_db, tmp_path, shipped_reader, include_attachments, partial):
    users, conversations, _, asset = seed_archive_source(archive_db)
    conversation = conversations[0]
    owner = str(users[0].id)
    first = archive_db.query(Message).filter_by(conversation_id=conversation.id).one()
    old_version = archive_db.query(MessageVersion).filter_by(message_id=first.id, version_number=1).one()
    current = archive_db.get(MessageVersion, first.current_version_id)
    current.display_text = '已保存的正文\r\n```py\nprint("synthetic")\n```'
    asset.scan_status = 'clean'
    attachment = archive_db.query(Attachment).one()
    attachment.status, attachment.deleted_at = 'active', None
    archive_db.add(MessageVersionAttachment(message_version_id=current.id, attachment_id=attachment.id))
    second = Message(conversation_id=conversation.id, role='user', order_key='b', turn_index=2)
    archive_db.add(second)
    archive_db.flush()
    tail = MessageVersion(message_id=second.id, version_number=1, display_text='Synthetic tail', plain_text='Synthetic tail', content_hash='synthetic', edit_type='test')
    archive_db.add(tail)
    archive_db.flush()
    second.current_version_id = tail.id
    annotation = ConversationAnnotation(conversation_id=conversation.id, subject_key=owner, message_id=first.id,
        message_version_id=old_version.id, quote='Synthetic', comment_markdown='Synthetic annotation')
    foreign = ConversationAnnotation(conversation_id=conversation.id, subject_key=str(users[1].id), message_id=first.id,
        message_version_id=old_version.id, comment_markdown='Foreign private annotation')
    archive_db.add_all([annotation, foreign])
    archive_db.flush()
    archive_db.add(ConversationNotebook(conversation_id=conversation.id, subject_key=owner, blocks=[
        {'type': 'markdown', 'markdown': 'Synthetic notes'},
        {'type': 'annotation_reference', 'annotation_id': str(annotation.id)},
        {'type': 'annotation_reference', 'annotation_id': str(foreign.id)},
    ]))
    archive_db.commit()

    artifact = create_context_package(archive_db, conversation_id=conversation.id, job_id=uuid.uuid4(),
        scope_kind='reading_scope' if partial else 'full_conversation', start_message_id=second.id if partial else None,
        subject_key=owner, output_directory=tmp_path / 'exports', record_artifact=False, include_attachments=include_attachments)
    expected = [(second, tail)] if partial else [(first, current), (second, tail)]
    with shipped_reader['source'].PackageSource(artifact.storage_uri) as source:
        manifest = shipped_reader['manifest'].load_package_manifest(source)
        assert manifest.conversation['id'] == str(conversation.id)
        assert manifest.conversation['message_count'] == len(expected)
        for name, info in manifest.files.items():
            assert source.sha256(name) == info['sha256']
            assert source.byte_size(name) == info['byte_size']
        adapter = shipped_reader['canonical_v2'].select_adapter(source, manifest.entrypoint)
        snapshot = adapter.scan()
        messages = list(adapter.iter_messages())
        assert not snapshot.parse_errors
        assert [m.body_text for m in messages] == [v.display_text for _, v in expected]
        assert [m.descriptor.version_number for m in messages] == [v.version_number for _, v in expected]
        assert [m.descriptor.message_id for m in messages] == [str(m.id) for m, _ in expected]
        assert [m.descriptor.sequence for m in messages] == ([2] if partial else [1, 2])
        assert len(snapshot.attachment_refs) == (0 if partial else 1)
        if partial:
            assert not snapshot.attachments
            assert not any(name.startswith('assets/') for name in source.list_members())
        if not partial:
            ref = snapshot.attachment_refs[0]
            assert ref.message_id == str(first.id) and ref.message_version_id == str(current.id)
            attached = snapshot.attachments[ref.attachment_id]
            assert attached.object_sha256 == asset.sha256
            if include_attachments:
                assert source.read_bytes(attached.object_path) == b'synthetic attachment'
        expected_fingerprint = shipped_reader['fingerprints'].fingerprint_messages(messages, snapshot, 'prefix')
        raw = source.read_bytes(manifest.entrypoint)
        assert b'Foreign private annotation' not in raw
        records = [json.loads(line) for line in raw.splitlines()]
        assert records[-1]['record_count'] == len(records)
        # Canonical parser checks the whole reference graph, beyond reader body extraction.
        parsed = parse_canjson_v2(raw)
        assert [m.display_text for m in parsed.conversation.messages] == [v.display_text.replace('\r\n', '\n').replace('\r', '\n') for _, v in expected]
        annotations = [r for r in records if r['record_type'] == 'annotation']
        assert len(annotations) == (0 if partial else 1)
        if not partial:
            assert annotations[0]['version_id'] == str(old_version.id)
            assert any(r['record_type'] == 'message_version' and r['id'] == str(old_version.id) for r in records)

    from app.services.context_protocol.source import PackageSource
    from app.services.context_protocol.canonical_v2 import select_adapter
    from app.services.context_protocol.fingerprints import fingerprint_messages
    with PackageSource(artifact.storage_uri) as source:
        adapter = select_adapter(source, 'conversation.canjsonl')
        assert fingerprint_messages(adapter.iter_messages(), adapter.scan(), 'prefix') == expected_fingerprint
