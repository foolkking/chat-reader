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
from _context_package.inspection import inspect_package


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


def test_annotation_projection_is_verified_and_legacy_packages_remain_readable(tmp_path):
    annotation_doc = b"# annotations\n"
    records = [
        {"record_type": "manifest", "format": "chat-reader-canonical-jsonl", "version": 2,
         "conversation": {"id": "demo"}, "selection": {"message_count": 1},
         "content": {"format": "markdown", "versions": "current_only"}},
        {"record_type": "message", "id": "m", "seq": 1, "order_key": "a", "role": "assistant",
         "current_version": {"id": "v", "version_number": 1, "content_markdown": "body"}},
        {"record_type": "annotation", "id": "a", "message_id": "m", "message_seq": 1,
         "message_role": "assistant", "version_id": "v", "annotation_type": "comment",
         "anchor_status": "valid", "quoted_text": "body", "comment_markdown": "note"},
        {"record_type": "end", "record_count": 4, "message_count": 1},
    ]
    raw = "".join(json.dumps(record) + "\n" for record in records).encode()
    manifest = {
        "format": "chat-reader-context-package", "format_version": "1.1",
        "entrypoint": "conversation.canjsonl", "conversation": {"id": "demo", "message_count": 1},
        "included_content": {"annotations": True, "annotation_document": True},
        "files": {
            "conversation.canjsonl": {"sha256": hashlib.sha256(raw).hexdigest(), "byte_size": len(raw)},
            "annotations.md": {"sha256": hashlib.sha256(annotation_doc).hexdigest(), "byte_size": len(annotation_doc)},
        },
        "extensions": {"chat_reader_annotation_export": {
            "version": 1, "status": "included", "path": "annotations.md",
            "media_type": "text/markdown", "count": 1,
        }},
    }
    path = tmp_path / "v11.context.zip"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("manifest.json", json.dumps(manifest))
        archive.writestr("conversation.canjsonl", raw)
        archive.writestr("annotations.md", annotation_doc)
    report = inspect_package(str(path), verify_hashes="all")
    assert report["status"] == "ok"
    assert report["annotation_document"]["status"] == "verified"

    legacy_dir = tmp_path / "legacy"
    legacy_dir.mkdir()
    legacy = package(legacy_dir, {
        "format": "chat-reader-context-package", "format_version": "1.0",
        "entrypoint": "conversation.canjsonl", "conversation": {"id": "demo", "message_count": 1},
        "files": {},
    }, records)
    legacy_report = inspect_package(str(legacy))
    assert legacy_report["annotation_document"]["status"] == "not_declared"
