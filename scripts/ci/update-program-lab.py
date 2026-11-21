"""Operator half of the disposable, signed program-only acceptance fixture."""

import argparse
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import shutil
import subprocess
import time


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


lab = module("lab", Path(__file__).with_name("update-lab.py"))


def guard():
    assert (
        Path("/.dockerenv").exists()
        and (lab.LAB / "dedicated-engine").read_text() == "disposable-nested-engine"
    )
    assert json.loads((lab.ETC / "source.json").read_text())["repository"] == "fixture/chat-reader"
    assert json.loads((lab.ETC / "host.json").read_text())["project"] == "updatefixture"


def state():
    return json.loads((lab.ROOT / "state.json").read_text())


def backups():
    return sorted(
        str(p.relative_to(lab.LAB)) for p in (lab.LAB / "backups").glob("update-*/chat-reader-*/MANIFEST")
    )


def ids():
    return {
        r: lab.run(
            "docker",
            "inspect",
            "-f",
            "{{.Id}} {{.State.StartedAt}}",
            "updatefixture-" + r + "-1",
        )
        .decode()
        .strip()
        for r in ("api", "web", "import-worker", "postgres")
    }


def stop_control():
    argv = [os.fsencode(lab.LIB / "updater"), b"control", b""]
    ps = []
    for p in Path("/proc").glob("[0-9]*"):
        try:
            if (p / "cmdline").read_bytes().split(b"\0") == argv:
                ps.append(int(p.name))
        except FileNotFoundError:
            pass
    assert len(ps) == 1
    os.kill(ps[0], signal.SIGTERM)


def control():
    subprocess.Popen(
        [lab.LIB / "updater", "control"],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


def enroll(mib):
    assert state()["Current"]["version"] == "v1.0.0" and len(backups()) == 2
    scratch = lab.LAB / "program-scratch"
    scratch.mkdir(mode=0o700)
    img = lab.run("docker", "inspect", "-f", "{{.Image}}", "updatefixture-postgres-1").decode().strip()
    rec = lab.ETC / "program-recovery.json"
    lab.run(
        "python3",
        lab.LIB / "prove_recovery.py",
        lab.LAB / "backups",
        Path(backups()[-1]).parent.relative_to("backups"),
        scratch,
        img,
        lab.REPO,
        "31",
        rec,
    )
    rec.chmod(0o600)
    stop_control()
    lab.run(lab.LIB / "updater", "audit-hardening")
    activate(mib)


def activate(mib):
    scratch = lab.LAB / "program-scratch"
    assert (lab.ROOT / "hardening-audit.json").is_file() and (lab.ETC / "program-recovery.json").is_file()
    assert not (lab.ETC / "program-profile.enabled").exists() and not (scratch / "baseline.json").exists()
    lab.run("python3", "-I", lab.LIB / "program_scratch.py")
    (lab.ETC / "program-profile.enabled").write_text("program-profile-v1\n")
    rev = state()["Current"]["revision"]
    env = dict(
        os.environ,
        API_IMAGE="chat-reader-api:" + rev,
        WEB_IMAGE="chat-reader-web:" + rev,
        WORKER_IMAGE="chat-reader-api:" + rev,
    )
    lab.run(
        "docker",
        "stop",
        "-t",
        "-1",
        *["updatefixture-" + r + "-1" for r in ("web", "api", "import-worker")],
    )
    lab.run(
        "docker",
        "compose",
        "-p",
        "updatefixture",
        "--env-file",
        lab.LAB / "instance.env",
        "-f",
        lab.DIST / "docker-compose.production.yml",
        "-f",
        lab.LIB / "api-socket.yml",
        "-f",
        lab.LIB / "program-profile.yml",
        "up",
        "-d",
        "--no-build",
        "--pull",
        "never",
        "--no-deps",
        "api",
        "web",
        "import-worker",
        env=env,
    )
    lab.run(lab.LIB / "updater", "enroll-hardening")
    control()
    # A normal upload must not acquire an artificial 64 MiB RAM-spool cap.
    lab.run(
        "docker",
        "exec",
        "updatefixture-api-1",
        "python",
        "-c",
        "import os,tempfile\nwith tempfile.TemporaryFile() as f:\n"
        " for i in range(96): f.write(b'x'*(1<<20))\n"
        " f.flush(); os.fsync(f.fileno()); assert os.fstat(f.fileno()).st_size==96<<20",
    )
    # Allocate real blocks across the four private volumes (not sparse, not
    # copied on each iteration). The older restored recovery point predates it.
    assert mib in (4, 4352)
    engine = Path(json.loads(lab.run("docker", "info", "--format", "{{json .DockerRootDir}}")))
    assert engine == Path("/var/lib/docker") and shutil.disk_usage(engine).free >= (mib + 1024) << 20
    seed = """import hashlib,os,sys
n=int(sys.argv[1]); b=b''.join(hashlib.sha256(str(i).encode()).digest() for i in range(32768))
for k in ('imports','exports','offline','assets'):
 p='/data/'+k+'/program-load.bin'
 with open(p,'xb') as f:
  for _ in range(n//4): f.write(b)
  f.flush();os.fsync(f.fileno())
 s=os.stat(p);assert s.st_size==n//4*1048576 and s.st_blocks*512>=s.st_size
"""
    lab.run("docker", "exec", "updatefixture-api-1", "python", "-c", seed, str(mib))
    lab.dump(
        scratch / "baseline.json",
        dict(backups=backups(), runtime=lab.snapshot(), mib=mib),
    )


def cert(scope):
    assert state()["Current"]["version"] == "v1.0.0" and scope in (
        "web",
        "api",
        "api+web",
    )
    old = json.loads((lab.LAB / "initial/update-v1.json").read_bytes())
    target = lab.LAB / "feed" / "update-v1.json"
    proof = {
        "format": 1,
        "repository": lab.REPO,
        "repository_id": 31,
        "from_version": old["version"],
        "from_revision": old["revision"],
        "from_archive_sha256": old["archive_sha256"],
        "from_config": {r: i["config"] for r, i in old["images"].items()},
        "target_manifest_sha256": lab.sha(target),
        "roles": scope.split("+"),
        "evidence_sha256": hashlib.sha256(("synthetic fixture only:" + scope).encode()).hexdigest(),
    }
    p = target.with_name("program-transition-v1.json")
    lab.dump(p, proof)
    p.with_suffix(".json.sig").write_bytes(
        base64.b64encode(
            lab.run(
                "openssl",
                "pkeyutl",
                "-sign",
                "-rawin",
                "-inkey",
                lab.LAB / "sign.key",
                "-in",
                p,
            )
        )
    )
    lab.dump(lab.LAB / "program-scratch/round.json", ids())
    return {"old": old["revision"], "next": json.loads(target.read_bytes())["revision"]}


def cache(scope, thermal):
    # Flush/evict or pre-read ONLY this fixture's image files, not host-wide
    # drop_caches. Candidate containers always start a new OS process.
    rev = json.loads((lab.LAB / "feed/update-v1.json").read_text())["revision"]
    seen = set()
    for k in scope.split("+"):
        i = json.loads(lab.run("docker", "image", "inspect", "chat-reader-" + k + ":" + rev))[0]
        d = i["GraphDriver"]["Data"]
        for s in [d["UpperDir"], *d.get("LowerDir", "").split(":")]:
            if not s or s in seen:
                continue
            seen.add(s)
            root = Path(s)
            assert str(root).startswith("/var/lib/docker/overlay2/") and root.is_dir()
            for parent, _, names in os.walk(root):
                for n in names:
                    path = Path(parent) / n
                    if path.is_symlink() or not path.is_file():
                        continue
                    with path.open("rb") as f:
                        if thermal == "cold":
                            os.posix_fadvise(f.fileno(), 0, 0, os.POSIX_FADV_DONTNEED)
                        else:
                            while f.read(1 << 20):
                                pass


def verify(scope):
    baseline = json.loads((lab.LAB / "program-scratch/baseline.json").read_bytes())
    before = json.loads((lab.LAB / "program-scratch/round.json").read_bytes())
    after = ids()
    assert all((before[k] != after[k]) == (k in scope.split("+")) for k in before)
    assert (
        backups() == baseline["backups"]
        and lab.snapshot() == baseline["runtime"]
        and not (lab.PUBLIC / "maintenance").exists()
    )
    assert state()["Job"]["phase"] == "succeeded" and state()["Current"]["version"] == "v1.0.0"
    for k in ("imports", "exports", "offline", "assets"):
        assert (
            int(
                lab.run(
                    "docker",
                    "exec",
                    "updatefixture-api-1",
                    "stat",
                    "-c",
                    "%s",
                    "/data/" + k + "/program-load.bin",
                )
            )
            == baseline["mib"] // 4 * 1048576
        )


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("op", choices=["enroll", "cert", "cache", "verify"])
    p.add_argument("arg")
    p.add_argument("thermal", nargs="?", choices=["cold", "warm"])
    a = p.parse_args()
    guard()
    if a.op == "enroll":
        enroll(int(a.arg))
    elif a.op == "cert":
        print(json.dumps(cert(a.arg)))
    elif a.op == "cache":
        cache(a.arg, a.thermal)
    else:
        verify(a.arg)
