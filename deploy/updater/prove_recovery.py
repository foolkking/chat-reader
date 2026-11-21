"""Create a receipt ONLY after restoring this exact backup on an isolated host.

No production connections or host-supplied database URLs. Docker receives only
a fresh private PostgreSQL container, no network, published ports or host mounts.
Extract only regular archive files into a new task-owned scratch directory.
"""

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import tarfile
import tempfile
import time


def require(value):
    if not value:
        raise ValueError("recovery proof refused")


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def run(*cmd, stdin=None):
    p = subprocess.run(
        list(map(str, cmd)),
        stdin=stdin,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    require(p.returncode == 0)
    return p.stdout.decode().strip()


def restore_files(archive, scratch):
    with tempfile.TemporaryDirectory(dir=str(scratch)) as tmp:
        root = Path(tmp)
        with tarfile.open(str(archive), "r|gz") as t:
            for m in t:
                parts = PurePosixPath(m.name)
                require(not parts.is_absolute() and ".." not in parts.parts and (m.isdir() or m.isreg()))
                p = root.joinpath(*parts.parts)
                if m.isdir():
                    p.mkdir(parents=True, exist_ok=True)
                else:
                    h = hashlib.sha256()
                    p.parent.mkdir(parents=True, exist_ok=True)
                    with p.open("xb") as out, t.extractfile(m) as src:
                        for chunk in iter(lambda: src.read(1 << 20), b""):
                            out.write(chunk)
                            h.update(chunk)
                    require(p.stat().st_size == m.size and digest(p) == h.hexdigest())


def prove(root, relative, scratch, image, repo, rid):
    require(re.fullmatch(r"(?:update-[a-f0-9]{32}/)?chat-reader-\d{8}T\d{6}Z", relative))
    require(
        re.fullmatch(r"sha256:[a-f0-9]{64}", image) and rid > 0 and re.fullmatch(r"[\w.-]+/[\w.-]+", repo)
    )
    folder = root / relative
    require(
        folder.is_absolute()
        and folder.resolve() == folder
        and scratch.resolve() == scratch
        and scratch.is_dir()
    )
    members = ["postgres.dump"] + [k + ".tar.gz" for k in ("imports", "exports", "offline", "assets")]
    require(
        all(
            (folder / n).is_file() and (folder / n).resolve() == folder / n
            for n in members + ["MANIFEST", "SHA256SUMS", "postgres.toc"]
        )
    )
    checks = (folder / "SHA256SUMS").read_text().splitlines()
    require(len(checks) == 5 and (folder / "MANIFEST").read_text().splitlines()[-5:] == checks)
    sums = {n: digest(folder / n) for n in members}
    require(set(checks) == {h + "  " + n for n, h in sums.items()})
    cid = run(
        "docker",
        "run",
        "--pull=never",
        "--rm",
        "-d",
        "--network",
        "none",
        "-e",
        "POSTGRES_HOST_AUTH_METHOD=trust",
        image,
    )
    require(re.fullmatch("[a-f0-9]{64}", cid))
    try:
        for _ in range(120):
            if (
                subprocess.run(
                    [
                        "docker",
                        "exec",
                        cid,
                        "pg_isready",
                        "-h",
                        "127.0.0.1",
                        "-U",
                        "postgres",
                    ],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                ).returncode
                == 0
            ):
                break
            time.sleep(0.5)
        with (folder / "postgres.dump").open("rb") as src:
            run(
                "docker",
                "exec",
                "-i",
                cid,
                "pg_restore",
                "--exit-on-error",
                "--no-owner",
                "--no-privileges",
                "-U",
                "postgres",
                "-d",
                "postgres",
                stdin=src,
            )
        schema = run(
            "docker",
            "exec",
            cid,
            "psql",
            "-U",
            "postgres",
            "-Atc",
            "SELECT version_num FROM alembic_version",
        )
        require(re.fullmatch(r"[0-9]{8}_[0-9]{4}", schema))
        for member in members[1:]:
            restore_files(folder / member, scratch)
        require(all(digest(folder / n) == h for n, h in sums.items()))
        return {
            "format": 1,
            "repository": repo,
            "repository_id": rid,
            "backup": relative,
            "schema": schema,
            "restored": ["postgres", "imports", "exports", "offline", "assets"],
            "manifest_sha256": digest(folder / "MANIFEST"),
            "sums_sha256": digest(folder / "SHA256SUMS"),
        }
    finally:
        run("docker", "stop", cid)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    for name in (
        "backup_root",
        "relative",
        "scratch",
        "postgres_image",
        "repository",
        "repository_id",
        "output",
    ):
        p.add_argument(name)
    a = p.parse_args()
    result = prove(
        Path(a.backup_root),
        a.relative,
        Path(a.scratch),
        a.postgres_image,
        a.repository,
        int(a.repository_id),
    )
    with Path(a.output).open("x") as out:
        json.dump(result, out, sort_keys=True)
