"""Protected tag dispatch, exact-run qualification and publication of already tested bytes."""
import argparse
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import time
import zipfile

from image_archive_identity import identities
from update_distribution import full_repository

ROOT = Path(__file__).resolve().parents[2]
TAG = re.compile(r"v(?:0|[1-9]\d{0,8})\.(?:0|[1-9]\d{0,8})\.(?:0|[1-9]\d{0,8})(?:-rc\.[1-9]\d{0,8})?")
WORKFLOW = "build-release-images.yml"


def need(v, msg="Release verification failed"):
    if not v:
        raise ValueError(msg)
    return v


def run(*cmd, stdin=None):
    p = subprocess.run(cmd, input=stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    need(not p.returncode, "Command failed: " + str(cmd[0]))
    return p.stdout


def api(path, *args):
    return json.loads(run("gh", "api", path, *args))


def checksum(path):
    with path.open("rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()


def ctx():
    repo = full_repository()
    tag = os.environ["GITHUB_REF_NAME"]
    sha = os.environ["GITHUB_SHA"]
    rid = int(os.environ["GITHUB_REPOSITORY_ID"])
    need(TAG.fullmatch(tag) and re.fullmatch("[a-f0-9]{40}", sha))
    need(
        os.environ["UPDATE_DISTRIBUTION"] == f"{repo}:{rid}" and os.environ["GITHUB_REF_PROTECTED"] == "true"
    )
    need(run("git", "rev-parse", "HEAD").decode().strip() == sha)
    need(api(f"repos/{repo}")["id"] == rid)
    ref = api(f"repos/{repo}/git/ref/tags/{tag}")["object"]
    for _ in range(4):
        if ref["type"] != "tag":
            break
        ref = api(f"repos/{repo}/git/tags/{ref['sha']}")["object"]
    need(ref == dict(ref, type="commit", sha=sha))
    return repo, tag, sha, rid


def output(k, v):
    with open(os.environ["GITHUB_OUTPUT"], "a") as f:
        f.write(f"{k}={v}\n")


def dispatch():
    repo, tag, sha, _ = ctx()
    key = os.environ["GITHUB_RUN_ID"] + "-" + os.environ["GITHUB_RUN_ATTEMPT"]
    run(
        "gh",
        "api",
        "--method",
        "POST",
        f"repos/{repo}/actions/workflows/{WORKFLOW}/dispatches",
        "-f",
        "ref=" + tag,
        "-f",
        "inputs[release_request]=" + key,
        "-f",
        "inputs[distribution]=" + os.environ["UPDATE_DISTRIBUTION"],
        "-f",
        "inputs[quality_source_run_id]=",
    )
    for _ in range(60):
        data = api(
            f"repos/{repo}/actions/workflows/{WORKFLOW}/runs?event=workflow_dispatch&head_sha={sha}&per_page=100"
        )
        found = [r for r in data["workflow_runs"] if r["display_title"] == "Release qualification " + key]
        if found:
            need(len(found) == 1 and found[0]["head_sha"] == sha)
            output("run", int(found[0]["id"]))
            return
        time.sleep(5)
    raise ValueError("Exact dispatch not found; never substitute the most recent run")


def artifact(run_id, wait):
    repo, tag, sha, rid = ctx()
    need(re.fullmatch("[1-9][0-9]*", run_id))
    key = os.environ["GITHUB_RUN_ID"] + "-" + os.environ["GITHUB_RUN_ATTEMPT"]
    for n in range(150 if wait else 1):
        r = api(f"repos/{repo}/actions/runs/{run_id}")
        need(
            r["id"] == int(run_id)
            and r["head_sha"] == sha
            and r["event"] == "workflow_dispatch"
            and r["repository"]["id"] == r["head_repository"]["id"] == rid
            and r["path"] == ".github/workflows/" + WORKFLOW
            and r["display_title"] == "Release qualification " + key
            and r["run_attempt"] == 1
        )
        if r["status"] == "completed":
            break
        need(wait)
        time.sleep(45)
    need(r["status"] == "completed" and r["conclusion"] == "success")
    spec = importlib.util.spec_from_file_location("policy", ROOT / "scripts/ci/image-only-quality-reuse.py")
    policy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(policy)
    jobs = api(f"repos/{repo}/actions/runs/{run_id}/attempts/1/jobs?per_page=100")
    need(
        jobs["total_count"] == len(jobs["jobs"]) == 19
        and {j["name"] for j in jobs["jobs"]}
        == {*policy.FULL_QUALITY_NAMES, "build-images", "inspect-release-artifact"}
    )
    need(
        all(
            j["head_sha"] == sha and j["status"] == "completed" and j["conclusion"] == "success"
            for j in jobs["jobs"]
        )
    )
    artifacts = api(f"repos/{repo}/actions/runs/{run_id}/artifacts?per_page=100")
    need(artifacts["total_count"] <= 100)
    eligible = [a for a in artifacts["artifacts"] if a["name"] == f"chat-reader-images-{sha}-1"]
    need(len(eligible) == 1)
    a = eligible[0]
    need(
        not a["expired"]
        and a["workflow_run"]["head_sha"] == sha
        and a["workflow_run"]["id"] == int(run_id)
        and re.fullmatch("sha256:[a-f0-9]{64}", a["digest"])
        and 0 < a["size_in_bytes"] < 2**31
    )
    return a


def materialize(run_id, work):
    repo, tag, sha, rid = ctx()
    a = artifact(run_id, False)
    pack = work / "transport.zip"
    with pack.open("xb") as f:
        p = subprocess.run(
            ["gh", "api", f"repos/{repo}/actions/artifacts/{a['id']}/zip"],
            stdout=f,
            stderr=subprocess.DEVNULL,
        )
    need(
        not p.returncode
        and pack.stat().st_size == a["size_in_bytes"]
        and "sha256:" + checksum(pack) == a["digest"]
    )
    names = {
        "release-manifest.json",
        "quality-verification.json",
        "image-candidate.json",
        "chat-reader-images.tar.gz",
        "image-inspection.json",
        "small-zip-memory.json",
        "bounded-zip-memory.json",
        "deploy/nginx-internal-diagnostics.location.conf",
    }
    with zipfile.ZipFile(pack) as z:
        files = [x for x in z.infolist() if not x.is_dir()]
        need({x.filename for x in files} == names and len(files) == len(names))
        for x in files:
            need(
                not stat.S_ISLNK(x.external_attr >> 16)
                and 0 < x.file_size < (2**31 if x.filename.endswith(".gz") else 32 << 20)
            )
            dst = work / x.filename
            dst.parent.mkdir(parents=True, exist_ok=True)
            with z.open(x) as src, dst.open("xb") as out:
                shutil.copyfileobj(src, out)
    m = json.loads((work / "release-manifest.json").read_bytes())
    q = m["quality_verification"]["verification"]
    need(
        m["commit"] == sha
        and m["workflow_run_id"] == run_id
        and m["workflow_run_attempt"] == "1"
        and q["mode"] == "full-exact"
        and q["quality_passed"] is True
        and q["source"]["repository"] == repo
    )
    return a


def fetch_kit(repo, sha, work):
    kid = os.environ["UPDATER_KIT_ID"]
    need(re.fullmatch("[1-9][0-9]*", kid))
    a = api(f"repos/{repo}/actions/artifacts/{kid}")
    wanted = os.environ["UPDATER_KIT_DIGEST"].removeprefix("sha256:")
    need(
        re.fullmatch("[a-f0-9]{64}", wanted)
        and a["digest"] == "sha256:" + wanted
        and not a["expired"]
        and a["workflow_run"]["id"] == int(os.environ["GITHUB_RUN_ID"])
        and a["workflow_run"]["head_sha"] == sha
        and a["name"] == "updater-kit-" + os.environ["GITHUB_RUN_ID"] + "-" + os.environ["GITHUB_RUN_ATTEMPT"]
        and 0 < a["size_in_bytes"] <= 64 << 20
    )
    pack = work / "bootstrap.zip"
    with pack.open("xb") as f:
        p = subprocess.run(
            ["gh", "api", f"repos/{repo}/actions/artifacts/{kid}/zip"], stdout=f, stderr=subprocess.DEVNULL
        )
    need(not p.returncode and checksum(pack) == wanted and pack.stat().st_size == a["size_in_bytes"])
    tar = work / "chat-reader-updater-linux-amd64.tar.gz"
    with zipfile.ZipFile(pack) as z:
        need(z.namelist() == [tar.name] and 0 < z.getinfo(tar.name).file_size <= 64 << 20)
        with z.open(tar.name) as src, tar.open("xb") as f:
            shutil.copyfileobj(src, f)
    return tar


def publish(run_id, work):
    repo, tag, sha, rid = ctx()
    a = materialize(run_id, work)
    arc = work / "chat-reader-images.tar.gz"
    images = identities(arc, sha)
    run("docker", "load", "-i", str(arc))
    manifest = {}
    kit = fetch_kit(repo, sha, work)
    for role in ("api", "web"):
        local = f"chat-reader-{role}:{sha}"
        remote = f"ghcr.io/{repo.lower()}-{role}:{tag}"
        run("docker", "tag", local, remote)
        run("docker", "push", remote)
        # Fetch the manifest list by immutable digest, then the amd64 manifest/config.
        base = remote.rsplit(":", 1)[0]
        reg = run("docker", "buildx", "imagetools", "inspect", "--raw", remote)
        index_digest = "sha256:" + hashlib.sha256(reg).hexdigest()
        pinned = base + "@" + index_digest
        need(run("docker", "buildx", "imagetools", "inspect", "--raw", pinned) == reg)
        desc = json.loads(reg)
        if "manifests" in desc:
            platform = [
                d for d in desc["manifests"] if d.get("platform") == {"os": "linux", "architecture": "amd64"}
            ]
            need(len(platform) == 1)
            dig = platform[0]["digest"]
            need(re.fullmatch("sha256:[a-f0-9]{64}", dig))
            raw = run("docker", "buildx", "imagetools", "inspect", "--raw", base + "@" + dig)
            need("sha256:" + hashlib.sha256(raw).hexdigest() == dig)
            desc = json.loads(raw)
        need(desc["config"]["digest"] == images[role]["config_id"])
        run("docker", "pull", "--platform", "linux/amd64", pinned)
        actual = json.loads(run("docker", "image", "inspect", pinned))[0]
        need(actual["RootFS"]["Layers"] == images[role]["rootfs"])
        manifest[role] = {
            "config": images[role]["config_id"],
            "engine_ids": images[role]["accepted_engine_ids"],
            "registry_digest": index_digest,
            "rootfs": images[role]["rootfs"],
        }
    compat = json.loads((ROOT / "deploy/updater/compatibility.json").read_bytes())
    heads = (
        run(
            "docker",
            "run",
            "--network",
            "none",
            "--rm",
            "--pull=never",
            "--entrypoint",
            "alembic",
            "chat-reader-api:" + sha,
            "heads",
        )
        .decode()
        .split()
    )
    need(heads == [compat["schema"], "(head)"])
    notes = api(
        f"repos/{repo}/releases/generate-notes",
        "--method",
        "POST",
        "-f",
        "tag_name=" + tag,
        "-f",
        "target_commitish=" + sha,
    )["body"]
    data = dict(
        compat,
        format=1,
        version=tag,
        repository=repo,
        repository_id=rid,
        revision=sha,
        notes=notes,
        built_at=json.loads((work / "image-candidate.json").read_bytes())["built_at"],
        run_id=int(run_id),
        attempt=1,
        artifact_id=a["id"],
        artifact_digest=a["digest"],
        archive_sha256=checksum(arc),
        archive_bytes=arc.stat().st_size,
        images=manifest,
    )
    need(len(notes.encode()) <= 24000)
    raw = work / "update-v1.json"
    raw.write_bytes(json.dumps(data, ensure_ascii=False, sort_keys=True).encode())
    key = work / "signing.pem"
    try:
        with os.fdopen(os.open(key, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600), "wb") as f:
            f.write(base64.b64decode(os.environ.pop("RELEASE_SIGNING_KEY"), validate=True))
        pub = run("openssl", "pkey", "-in", str(key), "-pubout", "-outform", "DER")
        need(
            pub[:12] == bytes.fromhex("302a300506032b6570032100")
            and len(pub) == 44
            and base64.b64encode(pub[12:]).decode() == os.environ["RELEASE_PUBLIC_KEY"]
        )
        boot = work / "updater-kit.sha256"
        boot.write_text(checksum(kit) + "  " + kit.name + "\n", encoding="ascii")

        def sign(file):
            signature = run("openssl", "pkeyutl", "-sign", "-rawin", "-inkey", str(key), "-in", str(file))
            need(len(signature) == 64)
            sig = work / (file.name + ".sig")
            sig.write_bytes(base64.b64encode(signature))
            return sig

        sig = sign(raw)
        boot_sig = sign(boot)
    finally:
        key.unlink(missing_ok=True)
    ctx()
    draft = json.loads(
        run(
            "gh",
            "api",
            "--method",
            "POST",
            f"repos/{repo}/releases",
            "--input",
            "-",
            stdin=json.dumps(
                dict(
                    tag_name=tag,
                    target_commitish=sha,
                    name=tag,
                    body=notes,
                    draft=True,
                    prerelease="-rc." in tag,
                )
            ).encode(),
        )
    )
    need(draft["tag_name"] == tag and draft["draft"] and isinstance(draft["id"], int))
    assets = (arc, raw, sig, kit, boot, boot_sig)
    run("gh", "release", "upload", tag, *map(str, assets), "--repo", repo)
    endpoint = f"repos/{repo}/releases/{draft['id']}"
    release = api(endpoint)
    need(release["draft"] and release["tag_name"] == tag)
    expected = {f.name: "sha256:" + checksum(f) for f in assets}
    need({f["name"]: f["digest"] for f in release["assets"]} == expected)
    ctx()
    published = api(
        endpoint,
        "--method",
        "PATCH",
        "-F",
        "draft=false",
        "-f",
        "make_latest=" + ("false" if "-rc." in tag else "legacy"),
    )
    need(published["id"] == draft["id"] and not published["draft"])


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["dispatch", "wait", "publish", "materialize"])
    parser.add_argument("run", nargs="?")
    args = parser.parse_args()
    if args.mode == "dispatch":
        dispatch()
    elif args.mode == "wait":
        artifact(args.run, True)
    else:
        work = Path(os.environ["RUNNER_TEMP"]) / "verified-release"
        work.mkdir(mode=0o700)
        (publish if args.mode == "publish" else materialize)(args.run, work)
