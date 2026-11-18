"""Disposable Docker-in-Docker fixture ONLY. Both program versions run real app/PG.

The origin is an isolated TLS GitHub-protocol fixture, not a live GitHub acceptance.
Never invoke this on an installed instance. Test signing material stays in the lab.
"""
import base64
import gzip
import hashlib
import http.server
import io
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import ssl
import subprocess
import sys
import time

LAB = Path("/lab")
DIST = LAB / "source"
LIB = Path("/usr/local/lib/chat-reader-updater")
ETC = Path("/etc/chat-reader/updater")
PTR = Path("/etc/chat-reader/release-state")
PUBLIC = Path("/var/lib/chat-reader-update-progress")
ROOT = Path("/var/lib/chat-reader-updater")
REPO = "fixture/chat-reader"
ORIGIN = "https://localhost:32481"
CMD_GID, STATUS_GID = 29001, 65534
SCHEMA = json.loads((DIST / "deploy/updater/compatibility.json").read_text())["schema"]


def run(*args, stdin=None, env=None):
    p = subprocess.run(
        [str(x) for x in args], input=stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env
    )
    if p.returncode:
        raise RuntimeError(
            "fixture command failed: "
            + str(args[0])
            + " "
            + str(args[1])
            + " (exit "
            + str(p.returncode)
            + ")"
        )
    return p.stdout


def dump(p, value):
    p.write_text(json.dumps(value))


def sha(p):
    h = hashlib.sha256()
    with p.open("rb") as f:
        for block in iter(lambda: f.read(1048576), b""):
            h.update(block)
    return h.hexdigest()


def serve():
    class Feed(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_GET(self):
            files = {1: "update-v1.json", 2: "update-v1.json.sig", 3: "chat-reader-images.tar.gz"}
            root = LAB / "feed"
            if self.path == "/repos/" + REPO:
                body = json.dumps({"id": 31, "full_name": REPO}).encode()
            elif self.path.startswith("/repos/" + REPO + "/releases?"):
                body = json.dumps(
                    [
                        {
                            "tag_name": json.loads((root / "update-v1.json").read_bytes())["version"],
                            "draft": False,
                            "prerelease": False,
                            "assets": [
                                {"id": i, "name": n, "size": (root / n).stat().st_size}
                                for i, n in files.items()
                            ],
                        }
                    ]
                ).encode()
            elif self.path.startswith("/repos/" + REPO + "/releases/assets/") and self.path.split("/")[
                -1
            ] in ("1", "2", "3"):
                file = root / files[int(self.path.split("/")[-1])]
                self.send_response(200)
                self.send_header("Content-Length", str(file.stat().st_size))
                self.end_headers()
                with file.open("rb") as f:
                    shutil.copyfileobj(f, self.wfile)
                return
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = http.server.ThreadingHTTPServer(("127.0.0.2", 443), Feed)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(LAB / "cert.pem", LAB / "tls.key")
    server.socket = context.wrap_socket(server.socket, server_side=True)
    server.serve_forever()


def fixture_version(base, rev, tag, folder, *, failure_schema=None, failed_start=False):
    folder.mkdir()
    overlay = LAB / "overlay"
    for role in ("api", "web"):
        ctx = overlay / role
        ctx.mkdir(parents=True, exist_ok=True)
        df = f"FROM chat-reader-{role}:{base}\nLABEL org.opencontainers.image.revision={rev} org.opencontainers.image.source=https://github.com/{REPO}\n"
        # Local working-tree rehearsal may layer the tested Web build/API edit over
        # the previous exact artifact. CI instead uses the qualified image as-is.
        if (ctx / "overlay").is_dir():
            df += (
                "COPY --chown="
                + ("chatreader:chatreader" if role == "api" else "nextjs:nodejs")
                + " overlay/ /app/\n"
            )
        if failed_start and role == "web":
            df += 'CMD ["node","-e","process.exit(77)"]\n'
        if role == "api":
            dump(ctx / "metadata.json", {"revision": rev})
            df += "COPY metadata.json /app/app/build_metadata.json\n"
            if failure_schema:
                (ctx / "refusal.py").write_text(
                    "revision = {!r}\ndown_revision = {!r}\nbranch_labels=None\ndepends_on=None\n"
                    "def upgrade():\n    raise RuntimeError('synthetic negative rehearsal')\n"
                    "def downgrade():\n    raise RuntimeError('not permitted')\n".format(
                        failure_schema, SCHEMA
                    )
                )
                df += "COPY refusal.py /app/alembic/versions/fixture_refusal.py\n"
        (ctx / "Dockerfile").write_text(df)
        run("docker", "build", "--network=none", "--pull=false", "-t", f"chat-reader-{role}:{rev}", ctx)
    roles = ("api", "import-worker", "migrate", "web")
    for role in ("migrate", "import-worker"):
        run("docker", "tag", "chat-reader-api:" + rev, f"chat-reader-{role}:{rev}")
    out = folder / "chat-reader-images.tar.gz"
    with out.open("wb") as f, gzip.GzipFile(fileobj=f, mode="wb", compresslevel=1) as zipped:
        with subprocess.Popen(
            ["docker", "save", *[f"chat-reader-{r}:{rev}" for r in roles]], stdout=subprocess.PIPE
        ) as p:
            shutil.copyfileobj(p.stdout, zipped)
            assert p.wait() == 0
    imgs = {}
    for role in ("api", "web"):
        i = json.loads(run("docker", "image", "inspect", f"chat-reader-{role}:{rev}"))[0]
        imgs[role] = {
            "config": i["Id"],
            "engine_ids": [i["Id"]],
            "rootfs": i["RootFS"]["Layers"],
            "registry_digest": "sha256:" + ("e" * 64),
        }
    compat = json.loads((DIST / "deploy/updater/compatibility.json").read_text())
    if failure_schema:
        compat["schema"] = failure_schema
    raw = folder / "update-v1.json"
    dump(
        raw,
        dict(
            format=1,
            version=tag,
            repository=REPO,
            repository_id=31,
            revision=rev,
            notes="Synthetic isolated upgrade.",
            built_at="2026-11-18T00:00:00Z",
            run_id=1,
            attempt=1,
            artifact_id=21,
            artifact_digest="sha256:" + "f" * 64,
            archive_sha256=sha(out),
            archive_bytes=out.stat().st_size,
            images=imgs,
            **compat,
        ),
    )
    (folder / "update-v1.json.sig").write_bytes(
        base64.b64encode(run("openssl", "pkeyutl", "-sign", "-rawin", "-inkey", LAB / "sign.key", "-in", raw))
    )


def setup(base):
    # Positive marker, private engine, fresh roots and NO preexisting containers/volumes.
    assert (LAB / "dedicated-engine").read_text().strip() == "disposable-nested-engine"
    assert (
        Path("/.dockerenv").exists()
        and not ROOT.exists()
        and not ETC.exists()
        and not run("docker", "ps", "-aq").strip()
    )
    assert not run("docker", "volume", "ls", "-q").strip()
    os.umask(0o077)
    for p in (
        LIB,
        ETC,
        PTR,
        ROOT,
        ROOT / "jobs",
        PUBLIC,
        LAB / "backups",
        Path("/run/chat-reader-updater"),
        Path("/run/chat-reader-update-status"),
    ):
        p.mkdir(parents=True, exist_ok=True)
    for p in (PUBLIC,):
        os.chown(p, 0, STATUS_GID)
        p.chmod(0o2750)
    for p, g, uid in [
        (Path("/run/chat-reader-updater"), CMD_GID, 0),
        (Path("/run/chat-reader-update-status"), STATUS_GID, STATUS_GID),
    ]:
        os.chown(p, uid, g)
        p.chmod(0o750)
    LIB.chmod(0o755)
    (LIB.parent).chmod(0o755)
    for f in ("host.py", "nginx.conf"):
        shutil.copyfile(DIST / "deploy/updater" / f, LIB / f)
    for f in ("preflight_release_space.sh", "backup.sh", "backup_volume_reader.sh", "verify_backup.sh"):
        shutil.copyfile(DIST / "deploy" / f, LIB / f)
    shutil.copyfile(LAB / "updater", LIB / "updater")
    (LIB / "updater").chmod(0o755)
    (LIB / "api-socket.yml").write_text(
        (DIST / "deploy/updater/api-socket.yml").read_text().replace("__COMMAND_GID__", str(CMD_GID))
    )
    run("openssl", "genpkey", "-algorithm", "ED25519", "-out", LAB / "sign.key")
    pk = base64.b64encode(
        run("openssl", "pkey", "-in", LAB / "sign.key", "-pubout", "-outform", "DER")[-32:]
    ).decode()
    api_uid = int(
        run(
            "docker",
            "run",
            "--rm",
            "--pull=never",
            "--network=none",
            "--entrypoint",
            "id",
            "chat-reader-api:" + base,
            "-u",
        ).strip()
    )
    dump(
        ETC / "source.json",
        dict(
            repository=REPO,
            repository_id=31,
            public_key=pk,
            channel="stable",
            command_uid=api_uid,
            command_gid=CMD_GID,
            status_gid=STATUS_GID,
        ),
    )
    print("fixture: creating two signed Docker versions", flush=True)
    a, b = (hashlib.sha1(("synthetic-" + base + x).encode()).hexdigest() for x in ("a", "b"))
    fixture_version(base, a, "v1.0.0", LAB / "initial")
    fixture_version(base, b, "v1.1.0", LAB / "feed")
    # Only synthetic non-running candidate tags in this newly created engine.
    # The old release's shared layers stay installed, as on an existing instance.
    run(
        "docker", "image", "rm", *[f"chat-reader-{r}:{b}" for r in ("api", "web", "import-worker", "migrate")]
    )
    for suffix in ("", ".sig"):
        shutil.copyfile(
            LAB / "initial" / ("update-v1.json" + suffix), ETC / ("installed-update-v1.json" + suffix)
        )
    (PTR / "current-images.env").write_text(
        f"RELEASE_SHA={a}\nAPI_IMAGE=chat-reader-api:{a}\nWEB_IMAGE=chat-reader-web:{a}\n"
    )
    run(
        "openssl",
        "req",
        "-x509",
        "-nodes",
        "-newkey",
        "rsa:2048",
        "-days",
        "2",
        "-subj",
        "/CN=updater-fixture",
        "-addext",
        "subjectAltName=DNS:localhost,DNS:api.github.com",
        "-addext",
        "basicConstraints=critical,CA:TRUE",
        "-keyout",
        LAB / "tls.key",
        "-out",
        LAB / "cert.pem",
    )
    shutil.copyfile(LAB / "cert.pem", "/usr/local/share/ca-certificates/chat-reader-lab.crt")
    run("update-ca-certificates")
    with open("/etc/hosts", "a") as f:
        f.write("\n127.0.0.2 api.github.com\n")
    ip = socket.gethostbyname(socket.gethostname())
    ng = LAB / "nginx.conf"
    api_upstream, web_upstream = "127.0.0.1:18000", "127.0.0.1:13000"
    if (LAB / "routed-host").exists():
        # WSL without a working loopback Docker userland proxy: the test gateway
        # uses two fixed addresses on the private fixture bridge, not a second
        # process bound to Docker's published ports (which would block recreation).
        # Several WSL distros can share a kernel/network namespace. Never take
        # over or remove another fixture's bridge route.
        routes=run("ip","route").decode()
        prefix=next("10.237."+str(n)+"." for n in range(83,150) if ("10.237."+str(n)+".") not in routes)
        c = DIST / "docker-compose.production.yml"
        text = c.read_text()
        for role, addr in [("api", prefix+"10"), ("web", prefix+"11")]:
            head, tail = text.split("\n  " + role + ":\n", 1)
            needle = "    networks:\n      - backend"
            assert needle in tail
            text = (
                head
                + "\n  "
                + role
                + ":\n"
                + tail.replace(needle, "    networks:\n      backend:\n        ipv4_address: " + addr, 1)
            )
        needle = "  backend:\n    driver: bridge"
        assert text.count(needle) == 1
        c.write_text(
            text.replace(needle, needle + "\n    ipam:\n      config:\n        - subnet: "+prefix+"0/24")
        )
        api_upstream, web_upstream = prefix+"10:8000",prefix+"11:3000"
    ng.write_text(
        f"""user nobody; worker_processes 1; pid /lab/nginx.pid; error_log /lab/nginx-error.log;
events {{worker_connections 128;}} http {{access_log off; client_body_temp_path /lab/nginx-client-body;
proxy_temp_path /lab/nginx-proxy-temp; server {{listen {ip}:443 ssl; listen 32481 ssl;
ssl_certificate /lab/cert.pem; ssl_certificate_key /lab/tls.key; include {LIB}/nginx.conf;
location /api/ {{proxy_pass http://{api_upstream};proxy_set_header Host $http_host;}}
location / {{proxy_pass http://{web_upstream};proxy_set_header Host $http_host;}} }} }}"""
    )
    launch(base)


def launch(base):
    assert (LAB / "dedicated-engine").read_text().strip() == "disposable-nested-engine" and not (
        LAB / "instance.env"
    ).exists()
    a = hashlib.sha1(("synthetic-" + base + "a").encode()).hexdigest()
    ng = LAB / "nginx.conf"
    for p in ("/var/lib/nginx/tmp", "/var/lib/nginx/logs"):
        Path(p).mkdir(parents=True, exist_ok=True)
    run("nginx", "-t", "-c", ng)
    run("nginx", "-c", ng)
    # Separate fetch process, never a configurable upstream in the shipping binary.
    subprocess.Popen(
        [sys.executable, __file__, "feed"],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    password = secrets.token_hex(24)
    env = LAB / "instance.env"
    env.write_text(
        f"POSTGRES_PASSWORD={secrets.token_hex(24)}\nAUTH_SESSION_SECRET={secrets.token_hex(32)}\nATTACHMENT_CURSOR_SECRET={secrets.token_hex(32)}\nADMIN_EMAIL=root@example.test\nADMIN_PASSWORD={password}\nPUBLIC_WEB_BASE_URL={ORIGIN}\nWEB_BIND_ADDRESS=127.0.0.1\nWEB_PORT=13000\nAPI_PORT=18000\n"
    )
    dump(LAB / "browser-login.json", {"email": "root@example.test", "password": password})
    compose = DIST / "docker-compose.production.yml"
    dump(
        ETC / "host.json",
        dict(
            project="updatefixture",
            compose=str(compose),
            project_dir=str(DIST),
            env_file=str(env),
            origin=ORIGIN,
            release_state=str(PTR),
            backups=str(LAB / "backups"),
            protected_files=[str(ng), str(LIB / "nginx.conf")],
        ),
    )
    dc = [
        "docker",
        "compose",
        "-p",
        "updatefixture",
        "--env-file",
        env,
        "-f",
        compose,
        "-f",
        LIB / "api-socket.yml",
    ]
    environ = dict(os.environ, API_IMAGE="chat-reader-api:" + a, WEB_IMAGE="chat-reader-web:" + a)
    print("fixture: initializing isolated PostgreSQL and business volumes", flush=True)
    run(*dc, "up", "-d", "--no-build", "--pull", "never", "postgres", env=environ)
    run(*dc, "run", "--rm", "--pull", "never", "-T", "migrate", env=environ)
    run(
        *dc,
        "up",
        "-d",
        "--no-build",
        "--pull",
        "never",
        "--no-deps",
        "api",
        "web",
        "import-worker",
        env=environ,
    )
    for _ in range(100):
        try:
            if (
                json.loads(
                    run("docker", "inspect", run(*dc, "ps", "-q", "api", env=environ).decode().strip())
                )[0]["State"]["Health"]["Status"]
                == "healthy"
            ):
                break
        except Exception:
            pass
        time.sleep(2)
    run(
        *dc,
        "exec",
        "-T",
        "api",
        "sh",
        "-ec",
        'for n in imports exports offline assets; do printf "synthetic-update-preservation-%s" "$n" > "/data/$n/update-fixture";done',
        env=environ,
    )
    run(
        *dc,
        "exec",
        "-T",
        "postgres",
        "sh",
        "-ec",
        'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "create table update_fixture (n integer primary key); insert into update_fixture values (7129)"',
        env=environ,
    )
    run(LIB / "updater", "enroll")
    checkpoint()
    for cmd, kw in [("progress", dict(user=65534, group=65534, extra_groups=[])), ("control", {})]:
        subprocess.Popen(
            [str(LIB / "updater"), cmd],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
            **kw,
        )
    print("fixture enrolled", flush=True)


def snapshot():
    assert (LAB / "dedicated-engine").read_text() == "disposable-nested-engine"
    paths = [
        LAB / "instance.env",
        DIST / "docker-compose.production.yml",
        LAB / "nginx.conf",
        LIB / "api-socket.yml",
        ETC / "source.json",
        ETC / "host.json",
    ]
    return {
        **{str(p): sha(p) for p in paths},
        "postgres": run("docker", "inspect", "-f", "{{.Id}}", "updatefixture-postgres-1").decode().strip(),
    }


def checkpoint():
    target = LAB / "initial-runtime.json"
    assert not target.exists()
    dump(
        target,
        {
            "runtime": snapshot(),
            "existing_backups": sorted(
                p.parent.parent.name for p in (LAB / "backups").glob("update-*/chat-reader-*/SHA256SUMS")
            ),
        },
    )


def verify(expected_pairs=1):
    s = json.loads((ROOT / "state.json").read_text())
    assert (
        s["Current"]["version"] == "v1.0.0"
        and s["Previous"]["version"] == "v1.1.0"
        and s["Job"]["phase"] == "succeeded"
    )
    initial = json.loads((LAB / "initial-runtime.json").read_bytes())
    existing = set(initial["existing_backups"])
    now = {p.parent.parent.name for p in (LAB / "backups").glob("update-*/chat-reader-*/SHA256SUMS")}
    assert (
        not (PUBLIC / "maintenance").exists()
        and existing <= now
        and len(now - existing) == 2 * expected_pairs
    )
    assert snapshot() == initial["runtime"]

    def container(role):
        return (
            run(
                "docker",
                "ps",
                "-q",
                "--filter",
                "label=com.docker.compose.project=updatefixture",
                "--filter",
                "label=com.docker.compose.service=" + role,
            )
            .decode()
            .strip()
        )

    run(
        "docker",
        "exec",
        container("api"),
        "sh",
        "-ec",
        'for n in imports exports offline assets; do test "$(cat /data/$n/update-fixture)" = "synthetic-update-preservation-$n";done',
    )
    assert (
        run(
            "docker",
            "exec",
            container("postgres"),
            "sh",
            "-ec",
            'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select n from update_fixture"',
        ).strip()
        == b"7129"
    )
    print(
        f"Verified {expected_pairs} upgrade/rollback pair(s), {2*expected_pairs} five-component backups, four file sentinels, PostgreSQL sentinel/identity and six configuration hashes."
    )


if __name__ == "__main__":
    if sys.argv[1] == "feed":
        serve()
    elif sys.argv[1] == "verify":
        verify()
    elif sys.argv[1] == "setup":
        setup(sys.argv[2])
    elif sys.argv[1] == "launch":
        launch(sys.argv[2])
