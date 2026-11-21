"""Root-only fixed scratch mount for disk-backed streaming uploads. Never delete data."""

import os
from pathlib import Path
import subprocess

ROOT = Path("/var/lib/chat-reader-program-scratch")


def checked(ok):
    if not ok:
        raise ValueError("unsafe program scratch")


def options():
    lines = [r.split() for r in Path("/proc/self/mountinfo").read_text().splitlines()]
    mounts = [r for r in lines if r[4] == str(ROOT)]
    checked(len(mounts) <= 1 and not any(r[4].startswith(str(ROOT) + "/") for r in lines))
    return set(mounts[0][5].split(",")) if mounts else set()


def main():
    checked(os.geteuid() == 0 and ROOT.parent.resolve() == ROOT.parent)
    ROOT.mkdir(mode=0o700, exist_ok=True)
    checked(ROOT == ROOT.resolve() and ROOT.stat().st_uid == 0 and ROOT.stat().st_mode & 0o777 == 0o700)
    allowed = {"api", "import-worker", "web"}
    checked({p.name for p in ROOT.iterdir()} <= allowed)
    if not options():
        subprocess.check_call(["mount", "--bind", str(ROOT), str(ROOT)])
    subprocess.check_call(["mount", "-o", "remount,bind,rw,noexec,nosuid,nodev", str(ROOT), str(ROOT)])
    checked({"noexec", "nosuid", "nodev", "rw"} <= options())
    for k in allowed:
        p = ROOT / k
        if not p.exists():
            p.mkdir(mode=0o700)
            p.chmod(0o1777)
        checked(
            p.is_dir() and p.resolve() == p and p.stat().st_uid == 0 and p.stat().st_mode & 0o7777 == 0o1777
        )


if __name__ == "__main__":
    main()
