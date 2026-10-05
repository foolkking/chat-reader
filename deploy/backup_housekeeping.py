#!/usr/bin/env python3
"""Verified two-snapshot retention and byte-identical archive reuse (Python 3.6+).

No business volume is accessed. Existing backup format and restore commands stay
unchanged: shared component files are ordinary hardlinks, not opaque references.
"""
import argparse
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tarfile

COMPONENTS = ("postgres.dump", "imports.tar.gz", "exports.tar.gz", "offline.tar.gz", "assets.tar.gz")
MEMBERS = frozenset(COMPONENTS + ("MANIFEST", "SHA256SUMS", "postgres.toc"))
NAME = re.compile(r"^chat-reader-(\d{8}T\d{6}Z)$")


def identity(path):
    value = path.lstat()
    if not stat.S_ISREG(value.st_mode):
        raise ValueError("non_regular_member")
    return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns)


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def checked_root(path):
    path = Path(path).absolute()
    if path.is_symlink() or not path.is_dir() or path.resolve() != path:
        raise ValueError("unsafe_backup_root")
    return path


def verify(directory, root, pg_command, staging=False):
    if directory.parent != root or directory.is_symlink() or directory.resolve() != directory:
        raise ValueError("unsafe_backup_directory")
    if not staging and not NAME.match(directory.name):
        raise ValueError("unknown_backup_name")
    if staging and not directory.name.startswith(".chat-reader-backup."):
        raise ValueError("unknown_staging_directory")
    if set(path.name for path in directory.iterdir()) != MEMBERS:
        raise ValueError("unexpected_backup_members")
    identities = {name: identity(directory / name) for name in MEMBERS}
    if identities["MANIFEST"][2] > 16384 or identities["SHA256SUMS"][2] > 16384:
        raise ValueError("oversized_backup_metadata")
    manifest = (directory / "MANIFEST").read_text(encoding="utf-8")
    header = dict(line.split("=", 1) for line in manifest.splitlines() if "=" in line)
    if header.get("schema_version") != "1" or header.get("components") != "postgres,imports,exports,offline,assets":
        raise ValueError("unsupported_backup_manifest")
    from datetime import datetime
    stamp = header.get("created_at", "")
    datetime.strptime(stamp, "%Y%m%dT%H%M%SZ")
    if not staging and directory.name != "chat-reader-" + stamp:
        raise ValueError("backup_timestamp_mismatch")
    checksums = {}
    for line in (directory / "SHA256SUMS").read_text(encoding="utf-8").splitlines():
        match = re.fullmatch(r"([a-f0-9]{64})  (postgres\.dump|(?:imports|exports|offline|assets)\.tar\.gz)", line)
        if not match or match.group(2) in checksums:
            raise ValueError("invalid_backup_checksums")
        checksums[match.group(2)] = match.group(1)
    if set(checksums) != set(COMPONENTS) or not identities["postgres.toc"][2]:
        raise ValueError("incomplete_backup")
    for name, expected in checksums.items():
        if digest(directory / name) != expected:
            raise ValueError("backup_checksum_mismatch")
        if name.endswith(".tar.gz"):
            with tarfile.open(str(directory / name), "r|gz") as archive:
                for _ in archive:
                    pass
    with (directory / "postgres.dump").open("rb") as stream:
        result = subprocess.run(pg_command, stdin=stream, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode or not result.stdout:
        raise ValueError("invalid_postgres_dump")
    if identities != {name: identity(directory / name) for name in MEMBERS}:
        raise ValueError("backup_changed_during_verification")
    return {"directory": directory, "stamp": stamp, "identities": identities, "checksums": checksums}


def inventory(root, pg_command):
    entries = list(root.iterdir())
    if len(entries) > 1000:
        raise ValueError("backup_scan_limit")
    valid, held = [], 0
    for path in entries:
        if not NAME.match(path.name) or not path.is_dir() or path.is_symlink():
            held += 1
            continue
        try:
            valid.append(verify(path, root, pg_command))
        except (OSError, ValueError, tarfile.TarError, UnicodeError):
            held += 1
    return sorted(valid, key=lambda entry: entry["stamp"], reverse=True), held


def unchanged(entry):
    directory = entry["directory"]
    if directory.is_symlink() or directory.resolve() != directory or set(path.name for path in directory.iterdir()) != MEMBERS:
        raise ValueError("backup_changed_before_operation")
    if entry["identities"] != {name: identity(directory / name) for name in MEMBERS}:
        raise ValueError("backup_changed_before_operation")


@contextmanager
def exclusive(root):
    lock = root / ".backup-operation.lock"
    # Shared with backup.sh. A crash leaves a visible lock for operator review;
    # never guess that another writer has finished or remove its lock.
    lock.mkdir()
    try:
        yield
    finally:
        lock.rmdir()


def retain(root, pg_command, apply=False):
    root = checked_root(root)
    if apply:
        with exclusive(root):
            return _retain(root, pg_command, apply=True)
    return _retain(root, pg_command)


def _retain(root, pg_command, apply=False):
    valid, held = inventory(root, pg_command)
    result = {"mode": "apply" if apply else "read_only", "verified": len(valid), "held": held,
              "retained": min(len(valid), 2), "candidates": max(len(valid) - 2, 0), "removed": 0, "unlinked_bytes": 0}
    if apply and len(valid) < 2:
        raise ValueError("two_verified_recovery_points_required")
    if not apply:
        return result
    # Both recovery points are verified before touching any older directory.
    for entry in valid[2:]:
        for kept in valid[:2]:
            unchanged(kept)
        unchanged(entry)
        for name in sorted(MEMBERS):
            path = entry["directory"] / name
            if identity(path) != entry["identities"][name]:
                raise ValueError("backup_changed_before_unlink")
            # Shared hardlinks are references, not independently reclaimed bytes.
            if path.stat().st_nlink == 1:
                result["unlinked_bytes"] += path.stat().st_size
            path.unlink()
        entry["directory"].rmdir()
        result["removed"] += 1
    return result


def deduplicate(root, staging, pg_command):
    root = checked_root(root)
    current = verify(Path(staging).absolute(), root, pg_command, staging=True)
    valid, held = inventory(root, pg_command)
    saved, reused = 0, 0
    for name in COMPONENTS:
        match = next((item for item in valid[:2] if item["checksums"][name] == current["checksums"][name]), None)
        if match is None:
            continue
        unchanged(match)
        target, source = current["directory"] / name, match["directory"] / name
        if identity(target)[0] != identity(source)[0]:
            continue
        temporary = current["directory"] / ("." + name + ".reuse")
        try:
            os.link(str(source), str(temporary))
            if identity(temporary) != match["identities"][name]:
                raise ValueError("backup_changed_before_reuse")
            os.replace(str(temporary), str(target))
        finally:
            if temporary.exists():
                temporary.unlink()
        saved += target.stat().st_size
        reused += 1
    # Re-read the output, including PostgreSQL TOC, before publication.
    verify(current["directory"], root, pg_command, staging=True)
    return {"reused_components": reused, "avoided_duplicate_bytes": saved, "held": held,
            "independent_physical_copies": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("report", "prune", "deduplicate"))
    parser.add_argument("--backup-dir", required=True)
    parser.add_argument("--staging")
    parser.add_argument("--release-verified", action="store_true", help="Only after successful application release acceptance")
    parser.add_argument("--pg-restore", help="Local PostgreSQL pg_restore executable; otherwise use the existing image")
    parser.add_argument("--postgres-image", default="postgres:16-alpine")
    args = parser.parse_args()
    pg = [args.pg_restore, "--list"] if args.pg_restore else ["docker", "run", "--rm", "-i", "--pull=never", "--network", "none", args.postgres_image, "pg_restore", "--list"]
    try:
        if args.operation == "prune" and not args.release_verified:
            raise ValueError("release_acceptance_required")
        if args.operation == "deduplicate":
            if not args.staging:
                raise ValueError("staging_required")
            result = deduplicate(args.backup_dir, args.staging, pg)
        else:
            result = retain(args.backup_dir, pg, apply=args.operation == "prune")
        print(json.dumps(result, sort_keys=True))
        return 0
    except (OSError, ValueError, tarfile.TarError, UnicodeError) as error:
        print(json.dumps({"ok": False, "error": str(error) if isinstance(error, ValueError) else type(error).__name__}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
