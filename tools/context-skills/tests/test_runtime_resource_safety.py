"""Synthetic hostile inputs; no uploaded code or real conversations are executed."""
import sys
import zipfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'context-acquisition/scripts'))
from _context_package import source as source_module
from _context_package.source import PackageSource, PackageError
from _context_package.inspection import _missing_ranges
from _context_package.validation import _find_cycles
from _context_package.safety import load_protocol_json
from _context_package.inspection import inspect_package


def make_zip(tmp_path, members):
    path = tmp_path / 'synthetic.context.zip'
    with zipfile.ZipFile(path, 'w') as archive:
        for name, data in members.items():
            archive.writestr(name, data)
    return path


def test_sparse_sequence_does_not_expand_numeric_span():
    assert _missing_ranges([10**18, 1, 2, 2]) == [[3, 10**18 - 1]]


def test_deep_reference_chain_and_cycle():
    edges = [(str(i), str(i + 1)) for i in range(10000)]
    assert _find_cycles(edges) == []
    cycles = _find_cycles(edges + [('10000', '9998')])
    assert cycles == [['9998', '9999', '10000', '9998']]


def test_cycle_diagnostics_are_bounded():
    cycles = _find_cycles([(str(i), str(i)) for i in range(1000)])
    assert len(cycles) == 100


@pytest.mark.parametrize('members', [
    {'manifest.json': '{}', 'assets': 'file', 'assets/item': 'conflict'},
    {'manifest.json': '{}', 'ASSETS': 'file', 'assets/item': 'conflict'},
    {'manifest.json': '{}', 'assets/caf\u00e9': 'one', 'assets/cafe\u0301': 'two'},
    {'manifest.json': '{}', 'r\u00e9f': 'file', 're\u0301f/item': 'conflict'},
    {'one/manifest.json': '{}', 'two/raw': 'outside'},
    {'one/manifest.json': '{}', 'two/manifest.json': '{}'},
])
def test_ambiguous_layout_rejected(tmp_path, members):
    with pytest.raises(PackageError):
        PackageSource(make_zip(tmp_path, members))


def test_normalized_windows_zip_paths_are_readable(tmp_path):
    path = make_zip(tmp_path, {'root\\manifest.json': '{}', 'root\\assets\\item': 'data'})
    with PackageSource(path) as package:
        assert package.exists('assets/item')
        assert package.read_bytes('assets/item') == b'data'
        assert package.byte_size('assets/item') == 4
        assert package.list_members() == ['assets/item', 'manifest.json']


def test_buffered_read_limit_and_streaming_remain_separate(tmp_path):
    path = make_zip(tmp_path, {'manifest.json': '{}', 'assets/item': '12345'})
    with PackageSource(path) as package:
        with pytest.raises(PackageError, match='resource limit'):
            package.read_bytes('assets/item', max_bytes=4)
        assert package.read_bytes('assets/item', max_bytes=5) == b'12345'
        with package.open_binary('assets/item') as stream:
            assert stream.read(2) == b'12'


def test_jsonl_line_limit_before_unbounded_allocation(tmp_path, monkeypatch):
    monkeypatch.setattr(source_module, 'MAX_JSONL_RECORD_BYTES', 16)
    path = make_zip(tmp_path, {'manifest.json': '{}', 'raw': '{}\n' + 'x' * 17})
    with PackageSource(path) as package:
        lines = package.iter_record_lines('raw')
        assert next(lines) == b'{}\n'
        with pytest.raises(PackageError, match='JSONL record resource limit'):
            next(lines)


@pytest.mark.parametrize('text', [
    '{"trust":"provisional","trust":"verified"}',
    '{"value":NaN}', '{"value":Infinity}', '{"value":1e999}',
    '[' * 65 + '0' + ']' * 65,
])
def test_ambiguous_or_deep_json_rejected(text):
    with pytest.raises(ValueError):
        load_protocol_json(text)


def test_json_brackets_in_strings_do_not_count_as_nesting():
    import json
    obj = {'example': '[{' * 100 + '"\\'}
    assert load_protocol_json(json.dumps(obj)) == obj


def test_oversized_first_record_returns_invalid_report(tmp_path, monkeypatch):
    monkeypatch.setattr(source_module, 'MAX_JSONL_RECORD_BYTES', 16)
    path = make_zip(tmp_path, {'manifest.json': '{}', 'conversation.canjsonl': 'x' * 17})
    report = inspect_package(str(path))
    assert report['status'] == 'invalid'
    assert any(item['code'] == 'stream_scan_failed' for item in report['anomalies'])


def test_directory_root_ambiguity_matches_zip(tmp_path):
    (tmp_path / 'manifest.json').write_text('{}', encoding='utf-8')
    nested = tmp_path / 'nested'
    nested.mkdir()
    (nested / 'manifest.json').write_text('{}', encoding='utf-8')
    with pytest.raises(PackageError):
        PackageSource(tmp_path)


def test_directory_regular_input_and_bounded_read(tmp_path):
    (tmp_path / 'manifest.json').write_text('{}', encoding='utf-8')
    (tmp_path / 'raw').write_bytes(b'12345')
    with PackageSource(tmp_path) as package:
        assert package.read_bytes('raw', max_bytes=5) == b'12345'
        with pytest.raises(PackageError):
            package.read_bytes('raw', max_bytes=4)


def test_directory_link_is_rejected(tmp_path):
    (tmp_path / 'manifest.json').write_text('{}', encoding='utf-8')
    (tmp_path / 'raw').write_bytes(b'synthetic')
    try:
        (tmp_path / 'linked').symlink_to(tmp_path / 'raw')
    except OSError:
        pytest.skip('Local host cannot create symlinks; run on Linux CI.')
    with pytest.raises(PackageError, match='linked'):
        PackageSource(tmp_path)


def test_raw_hash_mismatch_blocks_continuation_validation(tmp_path):
    import json
    from _context_package.validation import validate_continuation
    manifest = {'format': 'chat-reader-context-package', 'format_version': '1.0.0',
                'files': {'conversation.canjsonl': {'sha256': '0' * 64}}}
    path = make_zip(tmp_path, {
        'manifest.json': json.dumps(manifest),
        'conversation.canjsonl': json.dumps({'sequence': 1, 'role': 'user', 'content': 'synthetic'}),
    })
    result = validate_continuation(str(path))
    assert result['runtime_state'] == 'invalid'
    assert result['usable_for_restore'] is False
    assert result['validation_layers']['V0_package']['status'] == 'fail'
    assert any(f['code'] == 'declared_file_hash_mismatch' for f in result['findings'])
