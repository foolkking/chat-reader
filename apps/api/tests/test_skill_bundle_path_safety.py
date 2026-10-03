"""A downloadable Bundle must have one unambiguous installable file tree."""
import io
import zipfile

import pytest

from app.services.skill_bundles import parse_bundle, encode_bundle


def make_bundle(paths):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("demo/SKILL.md", "---\nname: demo\ndescription: Synthetic path fixture.\n---\nUse the reference.")
        for path in paths:
            archive.writestr(path, b"synthetic reference")
    return output.getvalue()


@pytest.mark.parametrize("paths", [
    ["demo/references/caf\u00e9.md", "demo/references/cafe\u0301.md"],
    ["demo/references", "demo/references/example.md"],
    ["demo/references/example.md", "demo/REFERENCES"],
    ["demo/r\u00e9f", "demo/re\u0301f/example.md"],
])
def test_ambiguous_bundle_member_tree_is_rejected(paths):
    with pytest.raises(ValueError):
        parse_bundle(make_bundle(paths), "demo.zip")


def test_unique_unicode_members_keep_original_spelling_and_bytes():
    paths = ["demo/references/cafe\u0301.md", "demo/references/\u8bf4\u660e.md"]
    bundle = parse_bundle(make_bundle(paths), "demo.zip")
    with zipfile.ZipFile(io.BytesIO(encode_bundle(bundle))) as archive:
        for path in paths:
            assert archive.read(path) == b"synthetic reference"


def test_explicit_directories_may_follow_their_children():
    bundle = parse_bundle(make_bundle(["demo/references/example.md", "demo/references/", "demo/"]), "demo.zip")
    assert bundle.members["references/example.md"] == b"synthetic reference"
