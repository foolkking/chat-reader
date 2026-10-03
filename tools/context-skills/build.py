"""Build installable bundles without running any bundled scripts."""
from pathlib import Path
import argparse
import zipfile

ROOT = Path(__file__).resolve().parent
NAMES = ('context-acquisition', 'context-continuation-maintainer', 'chat-transcript-normalizer-skill')


def build(output: Path, *, check: bool = False) -> None:
    shared = ROOT / NAMES[0] / 'scripts/_context_package'
    other = ROOT / NAMES[1] / 'scripts/_context_package'
    left = {p.relative_to(shared).as_posix(): p.read_bytes() for p in shared.rglob('*.py')}
    right = {p.relative_to(other).as_posix(): p.read_bytes() for p in other.rglob('*.py')}
    application = ROOT.parents[1] / "apps/api/app/services/context_protocol"
    installed = {p.relative_to(application).as_posix(): p.read_bytes() for p in application.rglob("*.py")}
    if left != installed:
        raise ValueError("Application protocol runtime differs from the distributed Skills.")
    if left != right:
        raise ValueError('Shared runtime differs; refusing to distribute incompatible bundles.')
    if not check:
        output.mkdir(parents=True, exist_ok=True)
    for name in NAMES:
        supplied = (ROOT / 'default-bundles' / (name + '.zip')).read_bytes()
        with zipfile.ZipFile(ROOT / 'default-bundles' / (name + '.zip')) as archive:
            members = {path: archive.read(path) for path in archive.namelist()}
            entrypoints = [path for path in members if path.endswith('/SKILL.md')]
            if len(entrypoints) != 1:
                raise ValueError('Default Bundle requires one SKILL.md.')
            preview = members[entrypoints[0]]
        if check:
            # Compare logical members, not zlib output, which can vary by runtime.
            with zipfile.ZipFile(output / (name + '.zip')) as archive:
                names = archive.namelist()
                if len(names) != len(set(names)) or set(names) != set(members):
                    raise ValueError(f'{name}: distributed Bundle member inventory differs from source.')
                for path, content in members.items():
                    if archive.read(path) != content:
                        raise ValueError(f'{name}: distributed member differs from source: {path}')
            if (output / (name + '.zip')).read_bytes() != supplied:
                raise ValueError(f'{name}: default Bundle must match supplied ZIP bytes.')
            if (output / (name + '.md')).read_bytes() != preview:
                raise ValueError(f'{name}: distributed preview differs from SKILL.md.')
            continue
        (output / (name + '.md')).write_bytes(preview)
        (output / (name + '.zip')).write_bytes(supplied)


def build_review(output: Path) -> None:
    """Package reviewed sources separately; never replace the supplied defaults."""
    output = output.resolve()
    public = (ROOT.parents[1] / 'apps/web/public/skills').resolve()
    pinned = (ROOT / 'default-bundles').resolve()
    if output.is_relative_to(public) or output.is_relative_to(pinned):
        raise ValueError('Review Bundles must not overwrite public or pinned defaults.')
    build(public, check=True)
    output.mkdir(parents=True, exist_ok=True)
    for name in NAMES[:2]:
        source = ROOT / name
        with zipfile.ZipFile(output / (name + '.review.zip'), 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(source.rglob('*')):
                if not path.is_file() or '__pycache__' in path.parts or path.suffix in {'.pyc', '.pyo'}:
                    continue
                info = zipfile.ZipInfo(f'{name}/{path.relative_to(source).as_posix()}', date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                archive.writestr(info, path.read_bytes())


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--check', action='store_true', help='Verify existing artifacts without changing them.')
    parser.add_argument('--review', action='store_true', help='Package reviewed sources separately as .review.zip; never updates app defaults.')
    args = parser.parse_args()
    if args.review and args.check:
        parser.error('--review and --check are separate operations')
    if args.review:
        build_review(args.output)
    else:
        build(args.output, check=args.check)
