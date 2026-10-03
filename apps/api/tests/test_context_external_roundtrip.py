"""Exercise real app export/return jobs around external OLD + NEW materialization.

Reviewed repository writer scripts execute only in subprocesses of this test.
The API never executes returned package or uploaded Skill scripts.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import uuid
import zipfile

from app.models.attachment import Attachment, AssetObject
from app.models.context_continuation import ContinuationCandidate, ContinuationValidation
from app.models.message_version import MessageVersion
from test_continuation_candidates import client, private_objects, database  # noqa: F401
from test_context_return import run_job

TOOL_ROOT = Path(__file__).resolve().parents[3] / 'tools/context-skills'
sys.path.insert(0, str(TOOL_ROOT / 'tests'))
from test_dual_materialization import semantic_inputs, TEXTS, save


def export_job(client, cid, path, *, include_continuation):
    queued = client.post(f'/api/conversations/{cid}/exports', headers={'Idempotency-Key': str(uuid.uuid4())},
        json={'format': 'context_package', 'context_attachment_policy': 'include',
              'continuation_policy': 'auto' if include_continuation else 'raw_only'})
    assert queued.status_code == 202, queued.text
    run_job(queued.json()['job_id'])
    task = client.get('/api/tasks/' + queued.json()['job_id']).json()
    assert task['status'] == 'committed', task
    response = client.get(task['result']['download_url'])
    assert response.status_code == 200
    path.write_bytes(response.content)
    return path


def return_job(client, cid, package, generation):
    with database() as db:
        before = [(str(v.id), v.display_text) for v in db.query(MessageVersion).order_by(MessageVersion.id)]
        counts = [db.query(model).count() for model in (Attachment, AssetObject)]
    queued = client.post(f'/api/conversations/{cid}/continuation/returns',
        data={'base_generation': generation, 'idempotency_key': str(uuid.uuid4())},
        files={'file': ('synthetic.context.zip', package.read_bytes())})
    assert queued.status_code == 202, queued.text
    run_job(queued.json()['task_id'])
    task = client.get('/api/tasks/' + queued.json()['task_id']).json()
    assert task['status'] == 'committed', task
    with database() as db:
        assert [(str(v.id), v.display_text) for v in db.query(MessageVersion).order_by(MessageVersion.id)] == before
        assert [db.query(model).count() for model in (Attachment, AssetObject)] == counts
        assert db.query(ContinuationCandidate).count() == db.query(ContinuationValidation).count() == 0
    return task['result']


def external_write(package, directory, output, *, previous=None):
    scripts = TOOL_ROOT / 'context-continuation-maintainer/scripts'
    with zipfile.ZipFile(package) as archive:
        raw = archive.read('conversation.canjsonl')
        records = [json.loads(line) for line in raw.splitlines()]
    cid = records[0]['conversation']['id']
    first = next(record for record in records if record['record_type'] == 'message')
    cp, tp, candidate, trace = semantic_inputs(directory, hashlib.sha256(raw).hexdigest(), base=previous is not None, end=4 if previous else 2)
    candidate['conversation_id'] = trace['conversation_id'] = trace['source_binding']['conversation_id'] = cid
    candidate['current']['evidence_registry'][0]['fields'].update({'Message-ID': first['id'], 'Version-ID': first['current_version']['id']})
    args = [sys.executable, str(scripts / 'materialize_continuation.py'), str(package),
            '--candidate', str(cp), '--maintenance-trace', str(tp), '--output', str(output)]
    if previous:
        compared = subprocess.run([sys.executable, str(scripts / 'compare_context_packages.py'), str(previous), str(package)], capture_output=True, text=True)
        assert compared.returncode == 0, compared.stdout + compared.stderr
        comparison = json.loads(compared.stdout)
        trace['package_update'] = {key: comparison[key] for key in ('previous_snapshot_sha256', 'new_snapshot_sha256')}
        trace['package_update']['supplementary_context_reviewed'] = True
        with zipfile.ZipFile(previous) as archive:
            for key, name in [('current', 'continuation/current.md'), ('index', 'continuation/index.json')]:
                trace['source_binding'][f'base_{key}_sha256'] = hashlib.sha256(archive.read(name)).hexdigest()
        args += ['--previous-package', str(previous)]
    save(cp, candidate); save(tp, trace)
    run = subprocess.run(args, capture_output=True, text=True)
    assert run.returncode == 0, run.stdout + run.stderr
    with zipfile.ZipFile(package) as source, zipfile.ZipFile(output) as target:
        for name in source.namelist():
            if name == 'conversation.canjsonl' or name.startswith('assets/'):
                assert target.read(name) == source.read(name)
    return output


def test_export_maintain_append_return_and_reexport_preserves_actual_data(client, tmp_path):
    created = client.post('/api/conversations', json={'title': 'Synthetic external roundtrip', 'messages': [
        {'role': 'user', 'content_markdown': TEXTS[0]}, {'role': 'assistant', 'content_markdown': TEXTS[1]}]})
    assert created.status_code == 201, created.text
    data = created.json()
    cid = data['conversation']['id']
    session = client.post(f'/api/conversations/{cid}/attachment-upload-sessions', json={})
    assert session.status_code == 201
    upload = client.post(f"/api/attachment-upload-sessions/{session.json()['id']}/items",
        files={'file': ('synthetic.txt', b'Synthetic real attachment', 'text/plain')})
    assert upload.status_code == 201
    assert client.post(f'/api/conversations/{cid}/attachments', json={'upload_item_ids': [upload.json()['id']]}).status_code == 201
    raw_a = export_job(client, cid, tmp_path / 'A.context.zip', include_continuation=False)
    maintained_a = external_write(raw_a, tmp_path, tmp_path / 'A-maintained.context.zip')
    assert return_job(client, cid, maintained_a, 0)['generation'] == 1
    appended = client.post(f'/api/conversations/{cid}/messages/insert', json={
        'anchor_message_id': data['messages'][-1]['id'], 'position': 'after', 'mode': 'pair', 'messages': [
            {'role': 'user', 'content_markdown': TEXTS[2]}, {'role': 'assistant', 'content_markdown': TEXTS[3]}]})
    assert appended.status_code == 201, appended.text
    # Explicit Raw-only export intentionally leaves the previous Pair in OLD.
    raw_b = export_job(client, cid, tmp_path / 'B.context.zip', include_continuation=False)
    maintained_b = external_write(raw_b, tmp_path, tmp_path / 'B-maintained.context.zip', previous=maintained_a)
    assert return_job(client, cid, maintained_b, 1)['generation'] == 2
    reexported = export_job(client, cid, tmp_path / 'C.context.zip', include_continuation=True)
    with zipfile.ZipFile(reexported) as result, zipfile.ZipFile(maintained_b) as external:
        for name in ('continuation/current.md', 'continuation/index.json'):
            assert result.read(name) == external.read(name)
        assets = [name for name in external.namelist() if name.startswith('assets/')]
        assert assets
        for name in assets:
            assert result.read(name) == external.read(name) == b'Synthetic real attachment'
        records = [json.loads(line) for line in result.read('conversation.canjsonl').splitlines()]
        assert [record['current_version']['content_markdown'] for record in records if record['record_type'] == 'message'] == TEXTS[:4]
        manifest = json.loads(result.read('manifest.json'))
        assert manifest['extensions']['chat_reader_continuation_export']['status'] == 'included_without_validation'
    assert len(client.get(f'/api/conversations/{cid}/continuation/revisions').json()) == 2
