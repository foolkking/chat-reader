import hashlib
import json
import sys
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'context-acquisition/scripts'))
from _context_package.manifest import load_package_manifest
from _context_package.source import PackageSource, PackageError
from _context_package.canonical_v2 import select_adapter
from _context_package.fingerprints import canonical_json_bytes, sha256_hex


def package(tmp_path, manifest, records=()):
    path = tmp_path / 'sample.context.zip'
    with zipfile.ZipFile(path, 'w') as z:
        z.writestr('manifest.json', json.dumps(manifest))
        z.writestr('conversation.canjsonl', '\n'.join(json.dumps(r) for r in records))
    return path


def test_legacy_manifest_preserves_hashes(tmp_path):
    path = package(tmp_path, {'scope': {'conversation_id': 'demo', 'message_count': 1},
                             'files': [{'path': 'conversation.canjsonl', 'sha256': 'a' * 64}]})
    with PackageSource(path) as source:
        m = load_package_manifest(source)
        assert m.conversation['id'] == 'demo'
        assert m.files['conversation.canjsonl']['sha256'] == 'a' * 64
        assert m.raw['files'] == m.files


def test_conflicting_identity_is_rejected(tmp_path):
    path = package(tmp_path, {'scope': {'conversation_id': 'one'}, 'conversation': {'id': 'two'}})
    with PackageSource(path) as source, pytest.raises(PackageError, match='conflicting'):
        load_package_manifest(source)


def test_canjson_21_body_and_inline_references_without_raw_mutation(tmp_path):
    path = package(tmp_path, {}, [
        {'record_type': 'header', 'schema': 'chat-reader-canjson', 'version': '2.1'},
        {'record_type': 'conversation', 'id': 'demo'},
        {'record_type': 'message', 'seq': 1, 'id': 'm', 'role': 'user',
         'current_version': {'id': 'v', 'version_number': 2, 'display_text': '**hello**'},
         'attachment_refs': [{'attachment_id': 'a', 'display_order': 0}]},
    ])
    before = hashlib.sha256(path.read_bytes()).digest()
    with PackageSource(path) as source:
        adapter = select_adapter(source, 'conversation.canjsonl')
        snapshot = adapter.scan()
        messages = list(adapter.iter_messages())
        assert messages[0].body_text == '**hello**'
        assert messages[0].descriptor.version_number == 2
        assert snapshot.header['conversation']['id'] == 'demo'
        assert snapshot.attachment_refs[0].message_version_id == 'v'
    assert hashlib.sha256(path.read_bytes()).digest() == before


@pytest.mark.parametrize('name', ['../escape', '/absolute', 'C:/escape', 'assets/../escape'])
def test_unsafe_members_rejected(tmp_path, name):
    path = package(tmp_path, {})
    with zipfile.ZipFile(path, 'a') as z:
        z.writestr(name, 'bad')
    with pytest.raises(PackageError):
        PackageSource(path)


def test_duplicate_members_rejected(tmp_path):
    path = package(tmp_path, {})
    with zipfile.ZipFile(path, 'a') as z, pytest.warns(UserWarning):
        z.writestr('conversation.canjsonl', 'different')
    with pytest.raises(PackageError):
        PackageSource(path)


def test_shared_runtime_is_identical():
    for file in (ROOT / 'context-acquisition/scripts/_context_package').glob('*.py'):
        assert file.read_bytes() == (ROOT / 'context-continuation-maintainer/scripts/_context_package' / file.name).read_bytes()


def test_literal_fingerprint_vectors():
    vectors = json.loads((ROOT / 'tests/continuation-conformance-fixtures-v1/fixtures/ex-49/canonicalization-vectors.json').read_text())
    for case in vectors['cases']:
        for side in ('a', 'b'):
            expected = case.get('expected_values', {}).get(side + '_content_digest')
            if expected:
                projection = {k: case[side][k] for k in ('role', 'content')}
                assert sha256_hex(canonical_json_bytes(projection)) == expected, case['id']
