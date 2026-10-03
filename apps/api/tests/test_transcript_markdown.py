import pytest
from app.services.import_pipeline.transcript_markdown import parse_transcript
from test_import_preview_api import client  # noqa: F401
from test_adaptive_import_api import _create

HEADER = "# Synthetic transcript\n\n**User:** Anonymous  \n**Created:** Unknown  \n**Updated:** Unknown  \n**Exported:** 9/29/2026 15:29:29  \n**Link:** N/A\n\n"
BODY = "Literal heading:\n## Prompt:\nnot a timestamp\n\n````md\n\n## Prompt:\nUnknown\n\ninside fence\n```\n\n## Response:\nUnknown · model\n\nstill inside fence\n````\n\n[Attachment: synthetic.zip]"

def transcript():
    return HEADER + "## Prompt:\nUnknown\n\n" + BODY + "\n\n## Prompt:\nUnknown\n\nSecond user turn\n\n## Response:\nUnknown · test-model\n\nAnswer\n"


def test_profile_preserves_literal_boundaries_metadata_and_adjacent_roles():
    parsed = parse_transcript(transcript())
    assert [m.role for m in parsed.messages] == ['user', 'user', 'assistant']
    assert parsed.messages[0].body == BODY
    assert parsed.messages[2].body == 'Answer'
    assert parsed.messages[2].model == 'test-model'
    assert parsed.metadata['exported'] == '9/29/2026 15:29:29'


@pytest.mark.parametrize('role,meta', [('Prompt', 'Unknown'), ('Response', '2026/9/29 10:55:47 · test-model')])
def test_single_role_profile(role, meta):
    assert len(parse_transcript(HEADER + f"## {role}:\n{meta}\n\nContent\n").messages) == 1


def test_profile_ignores_boundaries_inside_html_literal():
    body = '<pre>\n\n## Prompt:\nUnknown\n\nLiteral\n</pre>'
    parsed = parse_transcript(HEADER + '## Prompt:\nUnknown\n\n' + body + '\n')
    assert len(parsed.messages) == 1
    assert parsed.messages[0].body == body


def test_malformed_profile_does_not_fall_back_to_heading_guessing():
    with pytest.raises(ValueError):
        parse_transcript(transcript().replace('**Updated:**', '**Other:**'))
    assert parse_transcript('# Notes\n\n## Prompt:\nexample') is None


def test_normalizer_profile_commits_actual_bodies_and_order(client):
    result = _create(client, [('normalized.chat-transcript.md', transcript().encode(), 'text/markdown')])
    assert result['state'] == 'READY', result
    assert result['families'][0]['handling_class'] == 'SUPPORTED'
    saved = client.post(f"/api/imports/{result['import_id']}/commit")
    assert saved.status_code == 200, saved.text
    assert saved.json()['status'] == 'committed'
    from app.core.database import get_db
    from app.main import app
    from app.models.message import Message
    from app.models.message_version import MessageVersion
    session = app.dependency_overrides[get_db]()
    db = next(session)
    try:
        messages = db.query(Message).order_by(Message.order_key).all()
        assert [m.role for m in messages] == ['user', 'user', 'assistant']
        assert [db.get(MessageVersion, m.current_version_id).display_text for m in messages] == [BODY, 'Second user turn', 'Answer']
        assert all(m.created_at is None for m in messages)
        from app.models.source_message_ref import SourceMessageRef
        refs = [db.query(SourceMessageRef).filter_by(message_id=m.id).one() for m in messages]
        assert refs[0].raw_metadata['conversation']['exported'] == '9/29/2026 15:29:29'
        assert refs[2].raw_metadata['model'] == 'test-model'
        assert refs[2].raw_metadata['timestamp_display'] == 'Unknown'

    finally:
        session.close()


def test_legacy_detector_and_parser_use_identical_transcript_boundaries():
    from app.services.import_pipeline.exporter_markdown_parser import parse_exporter_markdown, has_exporter_markdown_structure, ExporterMarkdownPairingError
    from app.services.import_pipeline.source_detector import detect_source_profile
    parsed = parse_exporter_markdown(transcript())
    assert [s.markdown_text for s in parsed.sections] == [BODY, 'Second user turn', 'Answer']
    assert parsed.sections[-1].model == 'test-model'
    assert parsed.exported_at == '9/29/2026 15:29:29'
    assert has_exporter_markdown_structure(HEADER + '## Response:\nUnknown · test-model\n\nAnswer\n')
    malformed = transcript().replace('**Updated:**', '**Other:**')
    assert not has_exporter_markdown_structure(malformed)
    with pytest.raises(ExporterMarkdownPairingError):
        parse_exporter_markdown(malformed)
    assert detect_source_profile('normalized.md', transcript().encode()).source_profile.value == 'chatgpt_exporter_markdown'


@pytest.mark.parametrize('format', ['canjson', 'context'])
def test_normalizer_source_metadata_survives_export_and_reimport(client, tmp_path, format):
    import json
    import uuid
    import zipfile
    from app.core.database import get_db
    from app.main import app
    from app.models.message import Message
    from app.models.source_message_ref import SourceMessageRef
    from app.services.exporting.context_package import create_context_package

    result = _create(client, [('normalized.chat-transcript.md', transcript().encode(), 'text/markdown')])
    saved = client.post(f"/api/imports/{result['import_id']}/commit")
    assert saved.status_code == 200, saved.text
    cid = saved.json()['conversation_ids'][0]
    session = app.dependency_overrides[get_db]()
    db = next(session)
    try:
        message = db.query(Message).filter_by(conversation_id=uuid.UUID(cid), role='assistant').one()
        source = db.query(SourceMessageRef).filter_by(message_id=message.id).one()
        source.raw_metadata = {**source.raw_metadata, 'unexpected_provider_payload': 'synthetic-private-sentinel'}
        db.commit()
        if format == 'context':
            artifact = create_context_package(db, conversation_id=uuid.UUID(cid), job_id=uuid.uuid4(),
                scope_kind='full_conversation', start_message_id=None, output_directory=tmp_path / 'context', record_artifact=False)
            with zipfile.ZipFile(artifact.storage_uri) as archive:
                raw = archive.read('conversation.canjsonl')
        else:
            response = client.get(f'/api/conversations/{cid}/exports/canjson?include_source_refs=true')
            assert response.status_code == 200, response.text
            raw = response.content
    finally:
        session.close()
    assert b'synthetic-private-sentinel' not in raw
    refs = [json.loads(line) for line in raw.splitlines() if json.loads(line)['record_type'] == 'source_ref']
    source = next(r for r in refs if r['source_metadata'].get('model') == 'test-model')
    assert source['source_metadata']['timestamp_display'] == 'Unknown'
    assert any(ref['source_metadata'].get('conversation', {}).get('exported') == '9/29/2026 15:29:29' for ref in refs)
    # Raw may be imported as canonical JSONL; the Context ZIP itself is not an import entry.
    preview = client.post('/api/imports/preview', files={'files': ('roundtrip.canonical.jsonl', raw, 'application/x-ndjson')})
    assert preview.status_code == 200, preview.text
    committed = client.post(f"/api/imports/{preview.json()['import_id']}/commit")
    assert committed.status_code == 200, committed.text
    clone = uuid.UUID(committed.json()['conversation_ids'][0])
    assert clone != uuid.UUID(cid)
    session = app.dependency_overrides[get_db]()
    db = next(session)
    try:
        message = db.query(Message).filter_by(conversation_id=clone, role='assistant').one()
        sources = db.query(SourceMessageRef).filter_by(message_id=message.id).all()
        assert any(ref.raw_metadata.get('model') == 'test-model' and ref.raw_metadata.get('timestamp_display') == 'Unknown' for ref in sources)
    finally:
        session.close()


def test_legacy_preview_keeps_json_companion_contract(client):
    response = client.post('/api/imports/preview', files={'files': ('normalized.md', transcript().encode(), 'text/markdown')})
    assert response.status_code == 422
    assert response.json()['detail']['code'] == 'json_required'


def test_normalizer_source_metadata_reaches_v3_offline_package(client, tmp_path, monkeypatch):
    import io
    import json
    import zipfile
    from app.core.config import get_settings
    from test_cr_archive import _run_job
    monkeypatch.setenv('OFFLINE_STORAGE_DIR', str(tmp_path / 'offline'))
    get_settings.cache_clear()
    created = _create(client, [('normalized.chat-transcript.md', transcript().encode(), 'text/markdown')])
    committed = client.post(f"/api/imports/{created['import_id']}/commit")
    assert committed.status_code == 200, committed.text
    cid = committed.json()['conversation_ids'][0]
    queued = client.post('/api/offline/packages', json={'scope': 'conversation', 'conversation_id': cid, 'include_assets': 'none'},
        headers={'Idempotency-Key': 'normalizer-offline-roundtrip'})
    assert queued.status_code == 202, queued.text
    _run_job(queued.json()['job_id'])
    response = client.get(f"/api/offline/packages/{queued.json()['package_id']}/download")
    assert response.status_code == 200, response.text
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        package = json.loads(archive.read('package.json'))
    assert package['version'] == 3
    messages = package['conversations'][0]['messages']
    assert [m['current_version']['display_text'] for m in messages] == [BODY, 'Second user turn', 'Answer']
    assert messages[0]['source_refs'][0]['source_metadata']['conversation']['exported'] == '9/29/2026 15:29:29'
    assert messages[-1]['source_refs'][0]['source_metadata']['model'] == 'test-model'
    assert all(ref['message_id'] == m['id'] for m in messages for ref in m['source_refs'])
