"""Local, aggregate-only triage for a deliberately small, operator-selected test export.

This is not an importer. No network, database, extraction, media reads, or output
of filenames, titles, IDs, URLs or message content. Never scan a user's directory.
"""
import argparse
import json
import re
import stat
import zipfile
import zlib
from pathlib import Path, PurePosixPath, PureWindowsPath

MIB = 1024 * 1024
CATALOG = re.compile(r"conversations(?:[-_]\d+)?\.json", re.I)


class SampleError(ValueError):
    pass


def inspect(path: Path):
    if path.is_symlink() or not path.is_file() or path.suffix.lower() != ".zip" or path.stat().st_size > 16 * MIB:
        raise SampleError("use_small_dedicated_test_zip")
    counts = dict(catalogs=0, conversations=0, usable_current_nodes=0, branching_trees=0,
                  source_identity_missing=0, duplicate_source_identities=0, explicit_project_field=0,
                  project_field_unknown=0, custom_gpt_without_project_field=0, project_catalog_candidates=0,
                  declared_attachment_entries=0, image_pointer_entries=0, other_files_unread=0)
    ids, groups, paths = set(), set(), set()
    with zipfile.ZipFile(path) as archive:
        members = archive.infolist()
        if len(members) > 256:
            raise SampleError("member_limit")
        total = 0
        for m in members:
            p = PurePosixPath(m.filename)
            if (m.flag_bits & 1 or "\\" in m.filename or p.is_absolute() or ".." in p.parts
                    or PureWindowsPath(m.filename).drive or stat.S_ISLNK(m.external_attr >> 16)
                    or p.as_posix().casefold() in paths):
                raise SampleError("unsafe_or_ambiguous_member")
            paths.add(p.as_posix().casefold())
            if m.is_dir():
                continue
            if not CATALOG.fullmatch(p.name):
                counts["other_files_unread"] += 1
                counts["project_catalog_candidates"] += int(p.name.lower() == "projects.json")
                continue
            if m.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                raise SampleError("unsupported_catalog_compression")
            total += m.file_size
            if m.file_size > 4 * MIB or total > 8 * MIB:
                raise SampleError("use_smaller_catalog")
            with archive.open(m) as stream:
                data = stream.read(m.file_size + 1)
            if len(data) != m.file_size:
                raise SampleError("catalog_size_disagrees")
            rows = json.loads(data.decode("utf-8-sig"))
            if isinstance(rows, dict):
                rows = [rows]
            if not isinstance(rows, list) or len(rows) + counts["conversations"] > 16:
                raise SampleError("expected_small_conversation_catalog")
            counts["catalogs"] += 1
            for row in rows:
                if not isinstance(row, dict) or not isinstance(tree := row.get("mapping"), dict):
                    raise SampleError("unrecognized_conversation_shape")
                counts["conversations"] += 1
                ident = row.get("conversation_id") or row.get("id")
                if isinstance(ident, str) and ident:
                    counts["duplicate_source_identities"] += int(ident in ids)
                    ids.add(ident)
                else:
                    counts["source_identity_missing"] += 1
                group = row.get("project_id")
                if isinstance(group, str) and group:
                    groups.add(group)
                    counts["explicit_project_field"] += 1
                else:
                    counts["project_field_unknown"] += 1
                    counts["custom_gpt_without_project_field"] += int(bool(row.get("gizmo_id")))
                current = row.get("current_node")
                counts["usable_current_nodes"] += int(isinstance(current, str) and isinstance(tree.get(current), dict))
                branching = False
                for node in tree.values():
                    if not isinstance(node, dict):
                        continue
                    children = node.get("children")
                    branching |= isinstance(children, list) and len(children) > 1
                    message = node.get("message")
                    if not isinstance(message, dict):
                        continue
                    meta, content = message.get("metadata"), message.get("content")
                    entries = meta.get("attachments") if isinstance(meta, dict) else None
                    if isinstance(entries, list):
                        counts["declared_attachment_entries"] += len(entries)
                    parts = content.get("parts") if isinstance(content, dict) else None
                    if isinstance(parts, list):
                        counts["image_pointer_entries"] += sum(isinstance(v, dict) and
                            v.get("content_type") == "image_asset_pointer" for v in parts)
                counts["branching_trees"] += int(branching)
    if not counts["catalogs"]:
        raise SampleError("no_recognized_conversation_catalog")
    return {"scope": "local structural counts only; not an import or proof of project membership",
            **counts, "distinct_candidate_project_fields": len(groups), "media_bytes_examined": 0,
            "manual_project_branch_and_file_verification_required": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dedicated-test-export", required=True, type=Path)
    args = parser.parse_args()
    try:
        out = inspect(args.dedicated_test_export)
    except SampleError as exc:
        print(json.dumps({"error": str(exc)}))
        return 2
    except (OSError, ValueError, RuntimeError, EOFError, zipfile.BadZipFile, zipfile.LargeZipFile, zlib.error):
        print('{"error":"unreadable_or_unsupported_sample"}')
        return 2
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
