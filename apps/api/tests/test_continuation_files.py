import uuid
from app.models.context_continuation import ContinuationRevision, ContinuationCandidate, ContinuationValidation
from app.models.message_version import MessageVersion
from test_continuation_candidates import client, private_objects, database, root  # noqa: F401


def test_direct_updates_keep_three_and_inherit_without_validation(client):
    path = root(client)
    with database() as db:
        raw = [(str(v.id), v.display_text) for v in db.query(MessageVersion).all()]
    def save(generation, **members):
        return client.put(path + '/files', data={'base_generation': generation}, files={name: (name, data) for name, data in members.items()})
    first = save(0, current=b'# First')
    assert first.status_code == 200, first.text
    assert first.json()['generation'] == 1
    assert save(0, current=b'# First').json() == first.json()
    second = save(1, index=b'{"note":"No schema required"}')
    assert second.status_code == 200, second.text
    assert client.get(path + '/revisions/' + second.json()['revision_id'] + '/members/current').content == b'# First'
    assert save(2, current=b'# Third').status_code == 200
    assert save(3, current=b'# Fourth').status_code == 200
    revisions = client.get(path + '/revisions').json()
    assert len(revisions) == 3
    assert first.json()['revision_id'] not in {row['id'] for row in revisions}
    assert all(row['members'] == {'current': True, 'index': True} for row in revisions)
    assert client.get(path + '/revisions/' + revisions[0]['id'] + '/members/index').content == b'{"note":"No schema required"}'
    assert save(1, current=b'# Conflict').status_code == 409
    with database() as db:
        assert db.query(ContinuationRevision).count() == 3
        assert db.query(ContinuationCandidate).count() == 0
        assert db.query(ContinuationValidation).count() == 0
        assert [(str(v.id), v.display_text) for v in db.query(MessageVersion).all()] == raw


def test_direct_export_does_not_require_protocol_or_claim_validation(client, tmp_path):
    from app.services.exporting.context_continuation import carry_continuation
    path = root(client)
    response = client.put(path + '/files', data={'base_generation': 0}, files={'current': ('current.md', b'# Only current')})
    assert response.status_code == 200
    with database() as db:
        members, metadata, status = carry_continuation(db, uuid.UUID(path.split('/')[3]), tmp_path / 'not-read', subject_key='local:default')
        assert members == {'continuation/current.md': b'# Only current'}
        assert metadata == {'current': 'continuation/current.md'}
        assert status == 'included_without_validation'
        assert carry_continuation(db, uuid.UUID(path.split('/')[3]), tmp_path / 'not-read', subject_key='local:default', full_scope=False) == ({}, None, 'excluded_from_partial_export')
    from test_context_continuation_export import export
    import zipfile
    package, manifest, names = export(uuid.UUID(path.split('/')[3]), tmp_path / 'export')
    assert manifest['extensions']['chat_reader_continuation_export']['status'] == 'included_without_validation'
    assert 'continuation/index.json' not in names
    with zipfile.ZipFile(package) as archive:
        assert archive.read('continuation/current.md') == b'# Only current'


def test_direct_corrupt_member_preserves_raw_export(client, tmp_path):
    from app.models.context_continuation import ContextMemberObject
    from app.services.assets.asset_store import get_asset_store
    from test_context_continuation_export import export
    path = root(client)
    cid = uuid.UUID(path.split('/')[3])
    saved = client.put(path + '/files', data={'base_generation': 0}, files={
        'current': ('current.md', b'# Current'), 'index': ('index.json', b'{}')})
    assert saved.status_code == 200
    with database() as db:
        row = db.query(ContinuationRevision).filter_by(conversation_id=cid).one()
        obj = db.get(ContextMemberObject, row.index_sha256)
        get_asset_store().resolve_key(obj.storage_key).write_bytes(b'corrupt')
    _, manifest, members = export(cid, tmp_path)
    assert 'conversation.canjsonl' in members
    assert not any(name.startswith('continuation/') for name in members)
    assert manifest['extensions']['chat_reader_continuation_export']['status'] == 'unavailable'


def test_partial_snapshot_absent_member_is_not_storage_failure(client):
    path = root(client)
    saved = client.put(path + '/files', data={'base_generation': 0}, files={'current': ('current.md', b'# Current only')})
    assert saved.status_code == 200
    member_path = path + '/revisions/' + saved.json()['revision_id'] + '/members/'
    assert client.get(member_path + 'current').content == b'# Current only'
    missing = client.get(member_path + 'index')
    assert missing.status_code == 404
    assert 'CONTEXT_MEMBER_NOT_FOUND' in missing.text
