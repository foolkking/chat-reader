"""Attest the exact unpacked, loopback extension before starting a test browser."""
import hashlib
import json
import os
import re
import stat
import sys
from pathlib import Path
from zipfile import ZipFile


def verify(build: Path, origin: str, expected: str) -> dict:
    if origin not in {"http://127.0.0.1:18383", "http://127.0.0.1:18483"}:
        raise ValueError("Not an approved disposable Reader origin")
    if not re.fullmatch(r"[0-9a-f]{64}", expected):
        raise ValueError("Pin the approved candidate ZIP SHA-256 explicitly")

    def linked(p):
        s = p.lstat()
        return stat.S_ISLNK(s.st_mode) or bool(getattr(s, "st_file_attributes", 0) & 0x400)

    if linked(build) or linked(build / "manifest.json"):
        raise ValueError("Unexpected linked extension")
    version = json.loads((build / "manifest.json").read_bytes())["version"]
    if not re.fullmatch(r"\d+(?:\.\d+){1,3}", version):
        raise ValueError("Invalid extension version")
    package = build.parent / f"chat-reader-{version}.zip"
    if linked(package) or package.stat().st_size > 16 * 1024**2:
        raise ValueError("Not a small local rehearsal package")
    with package.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
        if digest != expected:
            raise ValueError("Selected ZIP differs from the pinned candidate")
        stream.seek(0)
        with ZipFile(stream) as z:
            entries = z.infolist()
            if len(entries) != len(set(z.namelist())) or sum(i.file_size for i in entries) > 32 * 1024**2:
                raise ValueError("Ambiguous or oversized test package")
            actual = set()
            for root, dirs, files in os.walk(build):
                if any(linked(Path(root) / name) for name in dirs + files):
                    raise ValueError("Unexpected link inside extension")
                actual.update((Path(root) / name).relative_to(build).as_posix() for name in files)
            if actual != set(z.namelist()):
                raise ValueError("Installed file set differs from the ZIP")
            for item in entries:
                f = build / item.filename
                if f.stat().st_size != item.file_size or f.read_bytes() != z.read(item):
                    raise ValueError("Installed bytes differ from the ZIP")
            if z.read("config.js") != f'globalThis.READER_ORIGIN="{origin}";\n'.encode():
                raise ValueError("Candidate is not bound to the selected lab")
            return {"sha256": digest, "files": len(actual), "zipBytes": package.stat().st_size, "version": version}


if __name__ == "__main__":
    try:
        print(json.dumps(verify(Path(sys.argv[1]), sys.argv[2], sys.argv[3])))
    except (OSError, ValueError, TypeError, KeyError, IndexError) as exc:
        sys.exit(str(exc) if type(exc) is ValueError else "Could not verify the local test package")
