"""Updater backup I/O. Same pg_dump and tar.gz bytes as the manual v1 backup.

The producer's exit status is checked by backup.sh separately (POSIX sh has no
pipefail). Verification always opens the published bytes again, never verifies
the creation stream against itself. Compatible with host Python 3.6+.
"""

import hashlib
import os
from pathlib import Path
import re
import subprocess
import sys


PARTS = (
    "postgres.dump",
    "imports.tar.gz",
    "exports.tar.gz",
    "offline.tar.gz",
    "assets.tar.gz",
)


def chunks(stream):
    return iter(lambda: stream.read(1024 * 1024), b"")


def syncdir(path):
    fd = os.open(str(path), os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def seal(directory):
    # The five large files were fsynced while writing. Don't flush an entire
    # filesystem (including unrelated services) to make these three durable.
    for name in ("MANIFEST", "SHA256SUMS", "postgres.toc"):
        with (directory / name).open("rb") as f:
            os.fsync(f.fileno())
    syncdir(directory)


def write(path, source):
    if path.name not in PARTS:
        raise ValueError("unexpected backup component")
    digest = hashlib.sha256()
    with path.open("xb") as out:
        for buf in chunks(source):
            digest.update(buf)
            out.write(buf)
        out.flush()
        os.fsync(out.fileno())
    return digest.hexdigest() + "  " + path.name


def check_files(directory):
    manifest = (directory / "MANIFEST").read_text().splitlines()
    if (
        len(manifest) != 6 + len(PARTS)
        or manifest[0] != "schema_version=1"
        or not re.fullmatch(r"created_at=\d{8}T\d{6}Z", manifest[1])
        or not manifest[2].startswith("source_sha=")
        or not manifest[3].startswith("postgres_tool=")
        or manifest[4:6]
        != ["source=postgres-and-business-volumes", "components=postgres,imports,exports,offline,assets"]
    ):
        raise ValueError("invalid backup manifest")
    lines = (directory / "SHA256SUMS").read_text().splitlines()
    expected = {}
    for line in lines:
        match = re.fullmatch(r"([a-f0-9]{64}) [ *]([a-z.]+)", line)
        if not match or match[2] not in PARTS or match[2] in expected:
            raise ValueError("bad checksums")
        expected[match[2]] = match[1]
    if set(expected) != set(PARTS) or manifest[-len(PARTS) :] != lines:
        raise ValueError("incomplete manifest")
    for name in PARTS:
        path = directory / name
        if path.is_symlink() or not path.is_file() or not path.stat().st_size:
            raise ValueError("invalid component")
        digest = hashlib.sha256()
        with path.open("rb") as source:
            if name == "postgres.dump":
                for buf in chunks(source):
                    digest.update(buf)
            else:
                # gzip checks every member's CRC/trailer. GNU tar must consume
                # the whole decompressed stream, including trailing records.
                with subprocess.Popen(["gzip", "-dc"], stdin=subprocess.PIPE, stdout=subprocess.PIPE) as gz:
                    try:
                        with subprocess.Popen(
                            ["tar", "--ignore-zeros", "-tf", "-"],
                            stdin=gz.stdout,
                            stdout=subprocess.DEVNULL,
                        ) as tar:
                            gz.stdout.close()
                            try:
                                for buf in chunks(source):
                                    digest.update(buf)
                                    gz.stdin.write(buf)
                            finally:
                                gz.stdin.close()
                            if gz.wait() or tar.wait():
                                raise ValueError("unreadable archive")
                    finally:
                        if not gz.stdin.closed:
                            gz.stdin.close()
        if digest.hexdigest() != expected[name]:
            raise ValueError("changed backup bytes")


if __name__ == "__main__":
    mode, entry = sys.argv[1:]
    if mode == "write":
        print(write(Path(entry), sys.stdin.buffer))
    elif mode == "verify":
        check_files(Path(entry))
    elif mode == "sync":
        syncdir(entry)
    elif mode == "seal":
        seal(Path(entry))
    else:
        sys.exit(2)
