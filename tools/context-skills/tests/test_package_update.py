import hashlib
import json
from pathlib import Path
import subprocess
import sys
import zipfile

import pytest

SCRIPTS = Path(__file__).resolve().parents[1] / 'context-continuation-maintainer/scripts'


def package(path, texts, *, locator='m', identity='synthetic', tamper=False):
    records = [{'record_type': 'manifest', 'format': 'chat-reader-canonical-jsonl', 'version': 2,
                'conversation': {'id': identity}}]
    records += [{'record_type': 'message', 'id': f'{locator}{i}', 'seq': i, 'role': 'user',
                 'current_version': {'id': f'v{i}', 'content_markdown': text, 'number': 1}}
                for i, text in enumerate(texts, 1)]
    raw = ('\n'.join(json.dumps(row) for row in records) + '\n').encode()
    manifest = {'conversation': {'id': identity}, 'entrypoint': 'conversation.canjsonl',
                'files': {'conversation.canjsonl': {'sha256': '0' * 64 if tamper else hashlib.sha256(raw).hexdigest()}}}
    with zipfile.ZipFile(path, 'w') as archive:
        archive.writestr('manifest.json', json.dumps(manifest))
        archive.writestr('conversation.canjsonl', raw)


@pytest.mark.parametrize('texts,locator,state,prefix', [
    (['a', 'b', 'c'], 'm', 'append_only', 2),
    (['a', 'changed'], 'm', 'history_changed', 1),
    (['a', 'b'], 'new', 'locator_changed', 2),
    (['a'], 'm', 'history_changed', 1),
])
def test_compare_cli_preserves_both_sources(tmp_path, texts, locator, state, prefix):
    old, new = tmp_path / 'old.context.zip', tmp_path / 'new.context.zip'
    package(old, ['a', 'b']); package(new, texts, locator=locator)
    before = [path.read_bytes() for path in (old, new)]
    result = subprocess.run([sys.executable, str(SCRIPTS / 'compare_context_packages.py'), str(old), str(new)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    report = json.loads(result.stdout)
    assert report['state'] == state
    assert report['unchanged_prefix_message_count'] == prefix
    assert report['semantic_reuse_verified'] is False
    assert [path.read_bytes() for path in (old, new)] == before


@pytest.mark.parametrize('kwargs', [{'identity': 'other'}, {'tamper': True}])
def test_invalid_inputs_block_comparison(tmp_path, kwargs):
    old, new = tmp_path / 'old.zip', tmp_path / 'new.zip'
    package(old, ['a']); package(new, ['a'], **kwargs)
    result = subprocess.run([sys.executable, str(SCRIPTS / 'compare_context_packages.py'), str(old), str(new)], capture_output=True, text=True)
    assert result.returncode == 3
    assert json.loads(result.stdout)['status'] in {'lineage_unconfirmed', 'package_integrity_failure'}
