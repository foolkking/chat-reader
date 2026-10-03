import importlib.util
import zipfile
from pathlib import Path

import pytest


spec = importlib.util.spec_from_file_location('context_bundle_build', Path(__file__).resolve().parents[1] / 'build.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def test_build_is_reproducible_and_check_is_read_only(tmp_path):
    builder.build(tmp_path)
    original = {p.name: p.read_bytes() for p in tmp_path.iterdir()}
    builder.build(tmp_path)
    assert original == {p.name: p.read_bytes() for p in tmp_path.iterdir()}
    builder.build(tmp_path, check=True)
    assert original == {p.name: p.read_bytes() for p in tmp_path.iterdir()}


@pytest.mark.parametrize('change', ['content', 'extra', 'preview'])
def test_check_rejects_stale_or_unexpected_distributed_content(tmp_path, change):
    builder.build(tmp_path)
    name = builder.NAMES[0]
    if change == 'preview':
        (tmp_path / (name + '.md')).write_text('stale preview', encoding='utf-8')
    else:
        target = tmp_path / (name + '.zip')
        with zipfile.ZipFile(target) as archive:
            members = {path: archive.read(path) for path in archive.namelist()}
        members[name + ('/SKILL.md' if change == 'content' else '/unexpected.txt')] = b'unreviewed content'
        with zipfile.ZipFile(target, 'w') as archive:
            for path, content in members.items():
                archive.writestr(path, content)
    before = {p.name: p.read_bytes() for p in tmp_path.iterdir()}
    with pytest.raises(ValueError):
        builder.build(tmp_path, check=True)
    assert before == {p.name: p.read_bytes() for p in tmp_path.iterdir()}


def test_review_bundles_include_writer_without_touching_defaults(tmp_path):
    public = builder.ROOT.parents[1] / 'apps/web/public/skills'
    before = {name: (public / f'{name}.zip').read_bytes() for name in builder.NAMES}
    builder.build_review(tmp_path)
    assert set(path.name for path in tmp_path.iterdir()) == {f'{name}.review.zip' for name in builder.NAMES[:2]}
    for name in builder.NAMES[:2]:
        with zipfile.ZipFile(tmp_path / f'{name}.review.zip') as archive:
            assert f'{name}/SKILL.md' in archive.namelist()
            assert not any('__pycache__' in path for path in archive.namelist())
            if name.endswith('maintainer'):
                assert f'{name}/scripts/_continuation_maintenance/dual_materialize.py' in archive.namelist()
    assert {name: (public / f'{name}.zip').read_bytes() for name in builder.NAMES} == before
    with pytest.raises(ValueError):
        builder.build_review(public)
