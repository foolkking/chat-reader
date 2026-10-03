"""Real writer/reader tests with hand-reconciled synthetic conversation semantics."""
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import zipfile

import pytest

SCRIPTS = Path(__file__).resolve().parents[1] / 'context-continuation-maintainer/scripts'
sys.path.insert(0, str(SCRIPTS))
from _context_package.source import PackageSource
from _context_package.validation import validate_continuation
from _continuation_maintenance.materialize import materialize_continuation, SEMANTIC_GATE_KEYS
from _continuation_maintenance.dual_materialize import materialize_package_update
from _continuation_maintenance.package_update import compare_packages
from _continuation_maintenance.model import MaintenanceError


TEXTS = ['Create a private report. Do not publish.', 'I propose automatic publishing.',
         'Keep it private. Implement a draft only.', 'Draft implemented; tests have not run.',
         'Tests failed. Fix the draft before further work.']


def write_package(path, texts, *, locator='m', legacy=False):
    records = [{'record_type': 'manifest', 'format': 'chat-reader-canonical-jsonl', 'version': 2,
                'conversation': {'id': 'synthetic-lineage'}}]
    records += [{'record_type': 'message', 'seq': i, 'id': f'{locator}{i}', 'role': 'user' if i % 2 else 'assistant',
                 'current_version': {'id': f'{locator}-v{i}', 'number': 1, 'content_markdown': body}}
                for i, body in enumerate(texts, 1)]
    raw = ('\n'.join(json.dumps(row) for row in records) + '\n').encode()
    members = {'conversation.canjsonl': raw, 'assets/synthetic.txt': b'Synthetic attachment bytes'}
    files = {key: {'sha256': hashlib.sha256(value).hexdigest(), 'byte_size': len(value)} for key, value in members.items()}
    manifest = {'format': 'chat-reader-context-package', 'format_version': '1.0',
        'conversation': {'id': 'synthetic-lineage', 'message_count': len(texts)},
        'entrypoint': 'conversation.canjsonl', 'conversation_completeness': 'complete', 'files': files}
    if legacy:
        manifest['scope'] = {'conversation_id': manifest.pop('conversation')['id']}
        manifest['files'] = [{'path': name, **info} for name, info in files.items()]
    with zipfile.ZipFile(path, 'w') as archive:
        archive.writestr('manifest.json', json.dumps(manifest))
        for key, value in members.items():
            archive.writestr(key, value)
    return hashlib.sha256(raw).hexdigest()


def semantic_inputs(directory, raw_hash, *, base=False, end=2, locator='m', mode='ONE_SHOT'):
    candidate = {'schema': 'chat-reader-continuation-candidate', 'schema_version': '1.0.0',
        'conversation_id': 'synthetic-lineage', 'maintenance_mode': mode, 'trust_target': 'verified',
        'base': {'continuation_present': base, 'continuation_revision': 1 if base else None},
        'coverage': {'seq_start': 1, 'seq_end': end},
        'current': {'continuation_brief': 'Create a private report. Automatic publishing was proposed, never adopted.',
            'state_at_boundary': 'Draft implemented; testing is unverified.' if end >= 4 else 'Only planning has occurred.',
            'constraints': [{'id': 'CON-001' if base else 'NEW-CON-001', 'title': 'Keep the report private',
                'fields': {'Scope': 'report', 'Evidence': ['E-001' if base else 'NEW-E-001']}, 'body': 'Do not publish.'}],
            'evidence_registry': [{'id': 'E-001' if base else 'NEW-E-001',
                'fields': {'Type': 'message', 'Sequence': 1, 'Message-ID': f'{locator}1', 'Version-ID': f'{locator}-v1'}}]},
        'index': {'chapters': [], 'segments': [
            {'id': f'SEG-{i:03d}' if base and i <= 2 else f'NEW-SEG-{i:03d}', 'seq_start': i, 'seq_end': i,
             'kind': 'planning', 'title': f'Synthetic step {i}', 'about': 'Synthetic semantic fixture',
             'key_refs': [{'sequence': i, 'purpose': 'historical context'}]}
            for i in range(1, end + 1)]}}
    trace = {'schema': 'chat-reader-maintenance-trace', 'schema_version': '1.0.0',
        'mode': mode, 'conversation_id': 'synthetic-lineage', 'trust_target': 'verified',
        'source_binding': {'conversation_id': 'synthetic-lineage', 'entrypoint_sha256': raw_hash},
        'baseline': {'continuation_revision': 1 if base else None},
        'semantic_reads': [{'seq_start': 3 if base else 1, 'seq_end': end, 'every_sequence': True, 'full_body_required': True}],
        'semantic_gate': dict.fromkeys(SEMANTIC_GATE_KEYS, True),
        'attachments': {'required': [], 'inspected': [], 'unavailable': []},
        'boundary': {'accepted_sequence': end}, 'retention_gc': {'status': 'performed'}}
    if base:
        trace['baseline']['inherited_verified_prefix'] = {'seq_start': 1, 'seq_end': 2}
    cp, tp = directory / 'candidate.json', directory / 'trace.json'
    save(cp, candidate); save(tp, trace)
    return cp, tp, candidate, trace


def save(path, value):
    path.write_text(json.dumps(value), encoding='utf-8')


def fixture_packages(tmp_path, *, changed=None, locator='m', legacy=False):
    old_raw, old = tmp_path / 'old-raw.context.zip', tmp_path / 'old.context.zip'
    raw_hash = write_package(old_raw, TEXTS[:3], legacy=legacy)
    cp, tp, _, _ = semantic_inputs(tmp_path, raw_hash)
    bootstrap = materialize_continuation(str(old_raw), candidate_path=str(cp), maintenance_trace_path=str(tp), output_path=str(old))
    assert bootstrap['validation']['runtime_state'] == 'valid_verified'
    new = tmp_path / 'new.context.zip'
    texts = list(TEXTS)
    if changed:
        texts[changed - 1] = 'Historical correction: produce a local draft only.'
    new_hash = write_package(new, texts, locator=locator, legacy=legacy)
    cp, tp, candidate, trace = semantic_inputs(tmp_path, new_hash, base=True, end=4, locator=locator,
                                               mode='REPAIR' if changed or locator != 'm' else 'ONE_SHOT')
    comparison = compare_packages(old, new)
    trace['package_update'] = {key: comparison[key] for key in ('previous_snapshot_sha256', 'new_snapshot_sha256')}
    trace['package_update']['supplementary_context_reviewed'] = True
    with zipfile.ZipFile(old) as archive:
        for member in ('current', 'index'):
            path = f'continuation/{member}.{"md" if member == "current" else "json"}'
            trace['source_binding'][f'base_{member}_sha256'] = hashlib.sha256(archive.read(path)).hexdigest()
    save(tp, trace)
    return old, new, cp, tp, candidate, trace


@pytest.mark.parametrize('legacy', [False, True])
def test_dual_cli_reuses_only_covered_prefix_and_keeps_new_raw(tmp_path, legacy):
    old, new, cp, tp, _, _ = fixture_packages(tmp_path, legacy=legacy)
    before = [path.read_bytes() for path in (old, new)]
    output = tmp_path / 'revision-2.context.zip'
    run = subprocess.run([sys.executable, str(SCRIPTS / 'materialize_continuation.py'), str(new),
        '--previous-package', str(old), '--candidate', str(cp), '--maintenance-trace', str(tp), '--output', str(output)],
        capture_output=True, text=True)
    assert run.returncode == 0, run.stdout + run.stderr
    receipt = json.loads(run.stdout)
    assert receipt['base_revision'] == 1 and receipt['new_revision'] == 2
    assert receipt['semantic_coverage'] == {'semantic_read_sequences': 2, 'inherited_sequences': 2}
    assert [path.read_bytes() for path in (old, new)] == before
    with zipfile.ZipFile(new) as source, zipfile.ZipFile(output) as result:
        for name in ('conversation.canjsonl', 'assets/synthetic.txt'):
            assert result.read(name) == source.read(name)
        manifest = json.loads(result.read('manifest.json'))
        assert manifest['continuation']['coverage'] == {'seq_start': 1, 'seq_end': 4, 'message_count': 4}
        assert manifest['continuation']['raw_tail_start_seq'] == 5
        assert manifest['files']['assets/synthetic.txt']['sha256'] == hashlib.sha256(b'Synthetic attachment bytes').hexdigest()
        current = result.read('continuation/current.md').decode()
        assert 'never adopted' in current and 'testing is unverified' in current
        assert 'CON-001' in current and 'E-001' in current
    assert validate_continuation(str(output), detail='full')['runtime_state'] == 'valid_verified'
    assert not list(tmp_path.glob('.context-update-*'))


def test_historical_edit_cannot_reuse_later_unchanged_segment(tmp_path):
    old, new, cp, tp, _, trace = fixture_packages(tmp_path, changed=1)
    trace['package_update']['repair_from_seq'] = 1
    trace['baseline'].pop('inherited_verified_prefix')
    trace['baseline']['inherited_verified_ranges'] = [{'seq_start': 2, 'seq_end': 2}]
    trace['semantic_reads'] = [{'seq_start': 1, 'seq_end': 1, 'every_sequence': True, 'full_body_required': True},
                              {'seq_start': 3, 'seq_end': 4, 'every_sequence': True, 'full_body_required': True}]
    save(tp, trace)
    output = tmp_path / 'blocked.context.zip'
    with pytest.raises(MaintenanceError, match='Unchanged wording'):
        materialize_package_update(str(old), str(new), candidate_path=str(cp), maintenance_trace_path=str(tp), output_path=str(output))
    assert not output.exists()


def test_history_repair_rereads_affected_suffix(tmp_path):
    old, new, cp, tp, _, trace = fixture_packages(tmp_path, changed=2)
    trace['package_update']['repair_from_seq'] = 2
    trace['baseline'].pop('inherited_verified_prefix')
    trace['baseline']['inherited_verified_ranges'] = [{'seq_start': 1, 'seq_end': 1}]
    trace['semantic_reads'] = [{'seq_start': 2, 'seq_end': 4, 'every_sequence': True, 'full_body_required': True}]
    save(tp, trace)
    output = tmp_path / 'repaired.context.zip'
    receipt = materialize_package_update(str(old), str(new), candidate_path=str(cp), maintenance_trace_path=str(tp), output_path=str(output))
    assert receipt['semantic_coverage'] == {'semantic_read_sequences': 3, 'inherited_sequences': 1}
    assert validate_continuation(str(output), detail='full')['runtime_state'] == 'valid_verified'


@pytest.mark.parametrize('stale_evidence', [False, True])
def test_locator_only_repair_keeps_semantics_and_rebinds_evidence(tmp_path, stale_evidence):
    old, new, cp, tp, _, previous_trace = fixture_packages(tmp_path, locator='remapped')
    raw_hash = previous_trace['source_binding']['entrypoint_sha256']
    _, _, candidate, trace = semantic_inputs(tmp_path, raw_hash, base=True, end=2, locator='m' if stale_evidence else 'remapped', mode='REPAIR')
    trace['package_update'] = previous_trace['package_update']
    trace['source_binding'] = previous_trace['source_binding']
    trace['semantic_reads'] = []
    trace['repair_kind'] = 'pure_locator'
    trace['retention_gc']['status'] = 'not_required_pure_locator_repair'
    save(tp, trace)
    output = tmp_path / 'locator.context.zip'
    if stale_evidence:
        with pytest.raises(MaintenanceError, match='deterministic validation failed'):
            materialize_package_update(str(old), str(new), candidate_path=str(cp), maintenance_trace_path=str(tp), output_path=str(output))
        assert not output.exists()
        return
    receipt = materialize_package_update(str(old), str(new), candidate_path=str(cp), maintenance_trace_path=str(tp), output_path=str(output))
    assert receipt['semantic_coverage'] == {'semantic_read_sequences': 0, 'inherited_sequences': 2}
    with zipfile.ZipFile(output) as archive:
        current = archive.read('continuation/current.md').decode()
        assert candidate['current']['continuation_brief'] in current
        assert 'Message-ID: remapped1' in current and 'Version-ID: remapped-v1' in current
        index = json.loads(archive.read('continuation/index.json'))
        assert index['segments'][0]['key_refs'][0]['message_id'] == 'remapped1'
        assert index['coverage']['seq_end'] == 2
    assert validate_continuation(str(output), detail='full')['runtime_state'] == 'valid_verified'


@pytest.mark.parametrize('fault', ['snapshot', 'member', 'supplementary', 'boundary', 'candidate'])
def test_binding_or_semantic_failures_do_not_publish_and_allow_retry(tmp_path, fault):
    old, new, cp, tp, candidate, trace = fixture_packages(tmp_path, changed=2 if fault == 'boundary' else None)
    before = [old.read_bytes(), new.read_bytes()]
    damaged = copy.deepcopy(trace)
    if fault == 'snapshot': damaged['package_update']['new_snapshot_sha256'] = '0' * 64
    if fault == 'member': damaged['source_binding']['base_current_sha256'] = '0' * 64
    if fault == 'supplementary': damaged['package_update']['supplementary_context_reviewed'] = False
    if fault == 'candidate': candidate['index']['segments'] = []; save(cp, candidate)
    save(tp, damaged)
    output = tmp_path / 'retry.context.zip'
    with pytest.raises(MaintenanceError):
        materialize_package_update(str(old), str(new), candidate_path=str(cp), maintenance_trace_path=str(tp), output_path=str(output))
    assert not output.exists()
    assert [old.read_bytes(), new.read_bytes()] == before
    assert not list(tmp_path.glob('.context-update-*'))
    # A failure leaves caller-owned inputs intact. A corrected external trace can retry.
    if fault not in ('boundary', 'candidate'):
        save(tp, trace)
        assert materialize_package_update(str(old), str(new), candidate_path=str(cp), maintenance_trace_path=str(tp), output_path=str(output))['status'] == 'published'


@pytest.mark.parametrize('target', ['old', 'new', 'trace'])
def test_concurrent_input_change_never_publishes(tmp_path, monkeypatch, target):
    import _continuation_maintenance.materialize as writer
    old, new, cp, tp, _, trace = fixture_packages(tmp_path)
    check = writer._raw_immutability
    def change_after_copy(*args):
        result = check(*args)
        if target == 'trace':
            trace['semantic_gate']['scope_resolved'] = False
            save(tp, trace)
        else:
            with zipfile.ZipFile(old if target == 'old' else new, 'a') as archive:
                archive.writestr('supplementary-change.txt', b'Synthetic concurrent change')
        return result
    monkeypatch.setattr(writer, '_raw_immutability', change_after_copy)
    output = tmp_path / 'concurrent.context.zip'
    with pytest.raises(MaintenanceError) as error:
        materialize_package_update(str(old), str(new), candidate_path=str(cp), maintenance_trace_path=str(tp), output_path=str(output))
    assert error.value.code == 'concurrency_conflict'
    assert not output.exists()


def test_output_created_during_publish_is_not_overwritten(tmp_path, monkeypatch):
    import _continuation_maintenance.dual_materialize as dual
    old, new, cp, tp, _, _ = fixture_packages(tmp_path)
    output = tmp_path / 'raced.context.zip'
    real_link = dual.os.link
    def race(source, destination, *args, **kwargs):
        if Path(destination) == output:
            output.write_bytes(b'Synthetic concurrently created file')
        return real_link(source, destination, *args, **kwargs)
    monkeypatch.setattr(dual.os, 'link', race)
    with pytest.raises(MaintenanceError) as error:
        materialize_package_update(str(old), str(new), candidate_path=str(cp), maintenance_trace_path=str(tp), output_path=str(output))
    assert error.value.code == 'output_exists'
    assert output.read_bytes() == b'Synthetic concurrently created file'
    assert not list(tmp_path.glob('.context-update-*'))


def test_asset_packing_streams_instead_of_buffering_members(tmp_path, monkeypatch):
    from _continuation_maintenance.materialize import _zip_directory
    root = tmp_path / 'tree'
    root.mkdir()
    asset = root / 'synthetic-large.bin'
    with asset.open('wb') as out:
        for _ in range(2048): out.write(b'x' * 4096)
    original = Path.read_bytes
    def bounded_read(path):
        if path == asset:
            raise AssertionError('Asset must not be buffered into one bytes object')
        return original(path)
    monkeypatch.setattr(Path, 'read_bytes', bounded_read)
    packed = tmp_path / 'streamed.zip'
    _zip_directory(root, packed)
    with zipfile.ZipFile(packed) as archive:
        assert archive.getinfo(asset.name).file_size == 8 * 1024 * 1024
        with archive.open(asset.name) as content:
            digest = hashlib.file_digest(content, 'sha256').hexdigest()
    with asset.open('rb') as content:
        assert hashlib.file_digest(content, 'sha256').hexdigest() == digest


def test_fingerprint_indexes_attachment_occurrences_without_changing_values(tmp_path):
    from _context_package.canonical_v2 import select_adapter
    from _context_package.fingerprints import fingerprint_messages, compose_digest, DOMAINS, message_content_digest, message_locator_digest
    from _context_package.model import AttachmentRefDescriptor
    path = tmp_path / 'many.context.zip'
    write_package(path, ['Synthetic message'] * 120)
    with PackageSource(path) as source:
        adapter = select_adapter(source, 'conversation.canjsonl')
        snapshot = adapter.scan()
        messages = list(adapter.iter_messages())
    snapshot.attachment_refs = [AttachmentRefDescriptor(attachment_id=f'asset-{i}', message_id=f'm{i}', message_version_id=f'm-v{i}') for i in range(1, 121)]
    expected = {dimension: compose_digest(DOMAINS[f'prefix_{dimension}'], [digest(message, snapshot) for message in messages])
                for dimension, digest in [('content', message_content_digest), ('locators', message_locator_digest)]}
    class BoundedPasses(list):
        passes = 0
        def __iter__(self):
            self.passes += 1
            assert self.passes <= 2, 'Global occurrences must not be rescanned for each message'
            return super().__iter__()
    snapshot.attachment_refs = BoundedPasses(snapshot.attachment_refs)
    actual = fingerprint_messages(messages, snapshot, 'prefix')
    assert {key: actual[key] for key in expected} == expected


def test_fragment_tail_and_exclusive_publication(tmp_path):
    from _continuation_maintenance.fragments import write_maintenance_fragment
    package = tmp_path / 'fragment-raw.context.zip'
    write_package(package, ['Synthetic staged evidence'] * 1500)
    candidate = {'schema': 'chat-reader-maintenance-fragment-candidate', 'schema_version': '1.0.0',
        'fragment_id': 'FRAG-001', 'conversation_id': 'synthetic-lineage', 'base': {'continuation_revision': None},
        'input_range': {'seq_start': 1, 'seq_end': 1500}, 'sealed_range': {'seq_start': 1, 'seq_end': 1000},
        'candidate_segments': [], 'current_changes': [], 'unsealed_tail': {'seq_start': 1001, 'seq_end': 1500, 'reason': 'Not yet sealed'}}
    cp, output = tmp_path / 'fragment-input.json', tmp_path / 'fragment.json'
    save(cp, candidate)
    report = write_maintenance_fragment(str(package), candidate_path=str(cp), output_path=str(output))
    assert report['fragment_written'] is True
    saved = output.read_bytes()
    parsed = json.loads(saved)
    assert parsed['source_binding']['sealed_range']['message_count'] == 1000
    assert parsed['unsealed_tail']['seq_start'] == 1001
    with pytest.raises(MaintenanceError) as error:
        write_maintenance_fragment(str(package), candidate_path=str(cp), output_path=str(output))
    assert error.value.code == 'output_exists'
    assert output.read_bytes() == saved


def test_writer_json_rejects_duplicate_control_fields(tmp_path):
    from _continuation_maintenance.model import load_json
    path = tmp_path / 'ambiguous.json'
    path.write_text('{"trust_target":"provisional","trust_target":"verified"}', encoding='utf-8')
    with pytest.raises(MaintenanceError, match='duplicate'):
        load_json(path)
