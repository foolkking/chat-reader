"""Produce/read a bounded qualification receipt; unknown changes are FULL.

The writer runs outside the signing environment. It executes only independently
verified images on an ephemeral Docker engine, never with publisher credentials.
"""

import ast
import base64
import difflib
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import tarfile
import time

from image_archive_identity import identities

HERE = Path(__file__).resolve().parent
API = "apps/api/app/services/search/search_service.py"
PARTS = ("api", "web")
TESTS = [
    "same-runtime-outside-reviewed-api",
    "old-writes-new-reads",
    "new-writes-old-reads",
    "database-select-only",
    "four-read-only-volumes",
    "unchanged-contracts",
    "tested-program-cutovers",
]
HASH = re.compile("[a-f0-9]{64}")
SHA = re.compile("[a-f0-9]{40}")
TAG = re.compile(r"v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.([1-9]\d*))?")


def need(ok):
    if not ok:
        raise ValueError("program proof verification failed")


def run(*args, data=None):
    p = subprocess.run(list(map(str, args)), input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if p.returncode:
        raise RuntimeError("program qualification: " + str(args[0]) + " " + str(args[1]) + " failed")
    return p.stdout


def packed(data):
    return json.dumps(data, sort_keys=True, separators=(",", ":")).encode()


def digest(b):
    return hashlib.sha256(b).hexdigest()


def css(a, b):
    # Only literal visual declaration values may change. Not selectors,
    # imports, URLs, pseudo content, unreviewed CSS variables or external assets.
    prop = r"(?:color|background-color|border(?:-(?:color|width|radius))?|opacity|gap|(?:row-|column-)gap|padding(?:-(?:inline|block|left|right|top|bottom))?|margin(?:-(?:inline|block|left|right|top|bottom))?|font-size|font-weight|line-height)"
    decl = re.compile(
        r"\s*(" + prop + r")\s*:\s*(?:(?:[\d.#%a-z -]+)|(?:var\(--[\w-]+\)))\s*;\s*",
        re.I,
    )
    x, y = a.splitlines(), b.splitlines()
    for op, i, j, k, l in difflib.SequenceMatcher(None, x, y, autojunk=False).get_opcodes():
        if op == "equal":
            continue
        if op != "replace" or j - i != l - k:
            return False
        for u, v in zip(x[i:j], y[k:l]):
            left, right = decl.fullmatch(u), decl.fullmatch(v)
            if not left or not right or left[1] != right[1]:
                return False
    return True


def pure(a, b):
    names = {
        "_snippet_at_range",
        "_escape_like_pattern",
        "_needs_substring_first",
        "_safe_tsquery_text",
        "_query_tokens",
    }

    def signature(text):
        tree = ast.parse(text)
        for f in tree.body:
            if not isinstance(f, ast.FunctionDef) or f.name not in names:
                continue
            local = {arg.arg for arg in f.args.args}
            local.update(
                n.id
                for st in f.body
                for n in ast.walk(st)
                if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Store)
            )
            for st in f.body:
                for n in ast.walk(st):
                    if isinstance(
                        n,
                        (
                            ast.Import,
                            ast.ImportFrom,
                            ast.Global,
                            ast.Nonlocal,
                            ast.Lambda,
                            ast.FunctionDef,
                            ast.ClassDef,
                            ast.Delete,
                            ast.With,
                            ast.Try,
                            ast.Raise,
                            ast.Await,
                        ),
                    ):
                        return None
                    if isinstance(n, ast.Name) and n.id not in local | {
                        "min",
                        "max",
                        "len",
                        "bool",
                        "re",
                    }:
                        return None
                    if isinstance(n, ast.Attribute) and (
                        not isinstance(n.ctx, ast.Load)
                        or n.attr
                        not in {
                            "casefold",
                            "strip",
                            "split",
                            "join",
                            "replace",
                            "findall",
                            "search",
                            "UNICODE",
                        }
                    ):
                        return None
                    if isinstance(n, ast.Call) and not (
                        isinstance(n.func, ast.Attribute)
                        or isinstance(n.func, ast.Name)
                        and n.func.id in {"min", "max", "len", "bool"}
                    ):
                        return None
            f.body = [ast.Pass()]
        return ast.dump(tree)

    left, right = signature(a), signature(b)
    return left is not None and left == right


def scope(old, new):
    roles = set()
    for filename in run("git", "diff", "--no-renames", "--name-only", "-z", old, new).decode().split("\0"):
        if not filename:
            continue
        if (
            filename.startswith("docs/")
            and filename.endswith(".md")
            or filename in ("PROJECT_STATE.md", "README.md")
        ):
            continue
        if (
            filename != API
            and filename != "apps/web/app/globals.css"
            and not (filename.startswith("apps/web/components/") and filename.endswith(".tsx"))
        ):
            return []
        if not all(
            run("git", "ls-tree", rev, "--", filename).startswith(b"100644 blob ") for rev in (old, new)
        ):
            return []
        a, b = (run("git", "show", rev + ":" + filename).decode() for rev in (old, new))
        if filename == API:
            if not pure(a, b):
                return []
            roles.add("api")
        elif filename.endswith(".css"):
            if not css(a, b):
                return []
            roles.add("web")
        else:
            p = subprocess.run(
                ["node", str(HERE / "program-jsx-proof.cjs")],
                input=packed([a, b]),
                stdout=subprocess.DEVNULL,
            )
            if p.returncode not in (0, 1):
                raise ValueError("JSX comparison unavailable")
            if p.returncode:
                return []
            roles.add("web")
    return sorted(roles)


def version(v):
    m = TAG.fullmatch(v)
    need(m)
    return tuple(int(m[i]) for i in (1, 2, 3)) + (m[4] is None, int(m[4] or 0))


def contract(old, new, oldid, newid, search_blobs):
    # Separate private DB, network, volumes. No host mounts, ports, secrets,
    # release sockets or Docker socket are ever passed to tested programs.
    suffix = "crpair" + secrets.token_hex(6)
    net = pg = suffix
    volumes = [suffix + "-" + k for k in ("imports", "exports", "offline", "assets")]
    probe = (HERE / "program-proof-probe.py").read_bytes()
    owned = []
    run("docker", "network", "create", "--internal", net)
    try:
        for v in volumes:
            run("docker", "volume", "create", v)
            owned.append(v)
        pgimg = run("docker", "image", "inspect", "-f", "{{.Id}}", "postgres:16-alpine").decode().strip()
        need(re.fullmatch("sha256:[a-f0-9]{64}", pgimg))
        run(
            "docker",
            "run",
            "-d",
            "--pull=never",
            "--name",
            pg,
            "--network",
            net,
            "-e",
            "POSTGRES_HOST_AUTH_METHOD=trust",
            pgimg,
        )
        try:
            for _ in range(120):
                if (
                    subprocess.run(
                        [
                            "docker",
                            "exec",
                            pg,
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

            def app(rev, cmd, read=False, data=None):
                flags = [
                    "--rm",
                    "-i",
                    "--pull=never",
                    "--read-only",
                    "--cap-drop=ALL",
                    "--security-opt=no-new-privileges",
                    "--network",
                    net,
                    "--tmpfs",
                    "/tmp:rw,noexec,nosuid,nodev",
                    "-e",
                    "APP_ENV=test",
                    "-e",
                    "AUTH_ENABLED=false",
                    "-e",
                    "ATTACHMENT_CURSOR_SECRET=qualification-fixture-only-0123456789",
                    "-e",
                    "DATABASE_URL=postgresql+psycopg://"
                    + ("reader" if read else "postgres")
                    + "@"
                    + pg
                    + "/postgres",
                ]
                for k, v in zip(("imports", "exports", "offline", "assets"), volumes):
                    flags += [
                        "-v",
                        v + ":/data/" + k + (":ro" if read else ":rw"),
                        "-e",
                        dict(
                            imports="IMPORT",
                            exports="EXPORT",
                            assets="ASSET",
                            offline="OFFLINE",
                        )[k]
                        + "_STORAGE_DIR=/data/"
                        + k,
                    ]
                return run(
                    "docker",
                    "run",
                    *flags,
                    "--entrypoint",
                    cmd[0],
                    "chat-reader-api:" + rev,
                    *cmd[1:],
                    data=data,
                )

            hashes = []
            for rev, im in ((old, oldid), (new, newid)):
                fingerprint = []
                for r in PARTS:
                    node = json.loads(run("docker", "image", "inspect", "chat-reader-" + r + ":" + rev))[0]
                    need(
                        node["Id"] in im[r]["accepted_engine_ids"]
                        and node["RootFS"]["Layers"] == im[r]["rootfs"]
                    )
                    cfg = node["Config"]
                    fingerprint.append(
                        {
                            k: cfg.get(k)
                            for k in (
                                "Cmd",
                                "User",
                                "Entrypoint",
                                "WorkingDir",
                                "Env",
                                "StopSignal",
                                "Healthcheck",
                                "ExposedPorts",
                                "Volumes",
                                "Shell",
                                "OnBuild",
                            )
                        }
                    )
                    if r == "web":
                        # Production frontend is a fixed Node runtime plus three
                        # COPY instructions for application / static / public.
                        # Do not inherit a changed Node/OS runtime unnoticed.
                        fingerprint.append(im[r]["rootfs"][:-3])
                        fingerprint.append(
                            run(
                                "docker",
                                "run",
                                "--rm",
                                "--network=none",
                                "--read-only",
                                "--pull=never",
                                "--cap-drop=ALL",
                                "--entrypoint",
                                "node",
                                "chat-reader-web:" + rev,
                                "-p",
                                "JSON.stringify([process.versions,require('./apps/web/node_modules/next/package.json').version])",
                            ).decode()
                        )
                h, source = json.loads(app(rev, ["python", "-", "runtime"], read=True, data=probe))
                need(source == search_blobs[rev])
                hashes.append((h, fingerprint))
            # A dependency/platform drift is legitimate but NOT program-only.
            if hashes[0] != hashes[1]:
                return False
            app(old, ["alembic", "upgrade", "head"])
            for rev, label in ((old, "old"), (new, "new")):
                app(rev, ["python", "-", "write", label], data=probe)
            run(
                "docker",
                "exec",
                "-i",
                pg,
                "psql",
                "-U",
                "postgres",
                "-v",
                "ON_ERROR_STOP=1",
                data=b"""
CREATE USER reader; GRANT USAGE ON SCHEMA public TO reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO reader;
ALTER ROLE reader SET default_transaction_read_only = on;
""",
            )
            for rev in (old, new):
                app(rev, ["python", "-", "read", "both"], read=True, data=probe)
            return True
        finally:
            run("docker", "rm", "-fv", pg)
    finally:
        for v in owned:
            run("docker", "volume", "rm", v)
        run("docker", "network", "rm", net)


def qualify(work, repo, tag, sha, rid):
    from publish_update import checksum

    arc = work / "chat-reader-images.tar.gz"
    result = dict(
        format=1,
        mode="full",
        repository=repo,
        repository_id=rid,
        revision=sha,
        version=tag,
        archive_sha256=checksum(arc),
        release_run=int(os.environ["GITHUB_RUN_ID"]),
        release_attempt=int(os.environ["GITHUB_RUN_ATTEMPT"]),
    )

    def full(reason):
        return dict(result, reason=reason)

    # An immediate, published same-channel ancestor; never substitute a newer
    # Actions success or a different fork merely because its tag looks similar.
    releases = json.loads(run("gh", "api", "--paginate", "--slurp", f"repos/{repo}/releases?per_page=100"))
    candidates = [
        r
        for page in releases
        for r in page
        if TAG.fullmatch(r["tag_name"])
        and not r["draft"]
        and r["prerelease"] == ("-rc." in tag)
        and version(r["tag_name"]) < version(tag)
    ]
    if not candidates:
        return full("no_published_pair")
    base = max(candidates, key=lambda r: version(r["tag_name"]))
    v = base["tag_name"]
    before = run("git", "rev-parse", f"refs/tags/{v}^{{commit}}").decode().strip()
    if subprocess.run(["git", "merge-base", "--is-ancestor", before, sha]).returncode:
        return full("not_ancestor")
    roles = scope(before, sha)
    if not roles:
        return full("unproven_changes")
    pub = os.environ.get("RELEASE_PUBLIC_KEY", "")
    if not pub:
        return full("no_pinned_rehearsal_key")
    key = base64.b64decode(pub, validate=True)
    need(len(key) == 32)
    d = work / "previous-program-proof"
    d.mkdir(mode=0o700)

    def fetch(n, limit):
        assets = [a for a in base["assets"] if a["name"] == n]
        need(len(assets) == 1 and 0 < assets[0]["size"] <= limit and type(assets[0]["id"]) is int)
        p = d / n
        with p.open("xb") as f:
            subprocess.run(
                [
                    "gh",
                    "api",
                    "-H",
                    "Accept: application/octet-stream",
                    f"repos/{repo}/releases/assets/{assets[0]['id']}",
                ],
                stdout=f,
                stderr=subprocess.DEVNULL,
                check=True,
            )
        need(p.stat().st_size == assets[0]["size"] and assets[0]["digest"] == "sha256:" + checksum(p))
        return p

    raw = fetch("update-v1.json", 128 << 10)
    sig = base64.b64decode(fetch("update-v1.json.sig", 128).read_bytes(), validate=True)
    (d / "pub.der").write_bytes(bytes.fromhex("302a300506032b6570032100") + key)
    (d / "sig").write_bytes(sig)
    run(
        "openssl",
        "pkeyutl",
        "-verify",
        "-rawin",
        "-pubin",
        "-keyform",
        "DER",
        "-inkey",
        d / "pub.der",
        "-in",
        raw,
        "-sigfile",
        d / "sig",
    )
    prev = json.loads(raw.read_bytes())
    need(
        (
            prev["format"],
            prev["version"],
            prev["revision"],
            prev["repository"],
            prev["repository_id"],
        )
        == (1, v, before, repo, rid)
    )
    compat = json.loads((HERE.parents[1] / "deploy/updater/compatibility.json").read_bytes())
    if any(prev[k] != compat[k] for k in ("schema", "provider_abi", "job_abi")):
        return full("changed_contract")
    prior = fetch(arc.name, 2**31 - 1)
    need(checksum(prior) == prev["archive_sha256"] and prior.stat().st_size == prev["archive_bytes"])
    oldid, newid = identities(prior, before), identities(arc, sha)
    for r in PARTS:
        need(
            oldid[r]["config_id"] == prev["images"][r]["config"]
            and oldid[r]["rootfs"] == prev["images"][r]["rootfs"]
        )
    for p in (prior, arc):
        run("docker", "load", "-i", p)
    if not contract(
        before, sha, oldid, newid, {r: digest(run("git", "show", r + ":" + API)) for r in (before, sha)}
    ):
        return full("runtime_drift")
    return dict(
        result,
        mode="program",
        from_version=v,
        from_revision=before,
        from_archive_sha256=prev["archive_sha256"],
        from_config={r: oldid[r]["config_id"] for r in PARTS},
        target_config={r: newid[r]["config_id"] for r in PARTS},
        roles=roles,
        checks=TESTS,
        verification_key_sha256=digest(key),
    )


def for_signer(kit, manifest, raw, release_run, attempt, public_key):
    with tarfile.open(kit, "r:gz") as t:
        items = [m for m in t if m.name == "deploy/updater/program-evidence.json"]
        need(len(items) == 1 and items[0].isreg() and 0 < items[0].size <= 8192)
        proof = t.extractfile(items[0]).read()
    p = json.loads(proof)
    need(p["release_run"] == release_run and p["release_attempt"] == attempt and len(public_key) == 32)
    need(
        p["format"] == 1
        and all(
            p[k] == manifest[k]
            for k in (
                "revision",
                "version",
                "archive_sha256",
                "repository",
                "repository_id",
            )
        )
    )
    if p["mode"] == "full":
        need(
            p["reason"]
            in (
                "no_published_pair",
                "not_ancestor",
                "unproven_changes",
                "no_pinned_rehearsal_key",
                "changed_contract",
                "runtime_drift",
            )
        )
        return proof, None
    need(
        p["mode"] == "program"
        and p["verification_key_sha256"] == digest(public_key)
        and p["checks"] == TESTS
        and p["roles"] in (["api"], ["web"], ["api", "web"])
        and SHA.fullmatch(p["from_revision"])
        and p["from_revision"] != p["revision"]
        and version(p["from_version"]) < version(p["version"])
        and HASH.fullmatch(p["from_archive_sha256"])
        and set(p["from_config"]) == set(PARTS)
        and all(re.fullmatch("sha256:[a-f0-9]{64}", x) for x in p["from_config"].values())
        and p["target_config"] == {k: manifest["images"][k]["config"] for k in PARTS}
    )
    return proof, packed(
        {
            **{
                k: p[k]
                for k in (
                    "format",
                    "repository",
                    "repository_id",
                    "from_version",
                    "from_revision",
                    "from_archive_sha256",
                    "from_config",
                    "roles",
                )
            },
            "target_manifest_sha256": digest(raw),
            "evidence_sha256": digest(proof),
        }
    )
