"""Fresh synthetic-only PG/API/worker gate; no browser and no production target option.

python -B scripts/extension-beta/backend-gate.py --parent APPROVED_NEW_RUN_PARENT --fork FORK
Dependencies must already be installed locally; images are never pulled. Credentials live
only in this process/child environment and Docker's disposable container configuration.
"""
from __future__ import annotations

import argparse
import base64
from datetime import datetime, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import time
import traceback
import uuid
import zipfile

import httpx

REPO = Path(__file__).resolve().parents[2]
EXTENSION = "gihbiofiiflkckcmomddkkjkoifkddfi"
DEPENDENCY_IMAGE = "chat-reader-api:54d67649057e4dfc98e45364d6438cfbdf74a329"
API_SOURCE = ("apps/api/app", "apps/api/alembic", "apps/api/scripts",
              "apps/api/alembic.ini", "apps/api/pyproject.toml",
              "apps/api/requirements-runtime.lock", "apps/api/requirements-build.lock")


def require(value, code):
    if not value:
        raise AssertionError(code)


def now():
    return datetime.now(timezone.utc).isoformat()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def ordinary(path: Path):
    require(path.is_absolute() and path.resolve() == path, "resolved-path")
    for item in (path, *path.parents):
        if item.exists():
            require(not item.is_symlink() and not getattr(item.lstat(), "st_file_attributes", 0) & 0x400,
                    "reparse-path")


def approved(path):
    ordinary(path)
    require(any(path.is_relative_to(root) and path != root for root in
                (Path(r"E:\chat-reader-temp"), Path(r"C:\Users\86182\Desktop\wkkk"))), "scratch-root")


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class Gate:
    def __init__(self, parent, fork, *, diagnostics=False, parser_fixture=None):
        approved(parent)
        require(parent.is_dir(), "existing-task-parent-required")
        ordinary(fork)
        self.root = parent / ("http-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + secrets.token_hex(3))
        self.root.mkdir()
        self.project = "reader-g1-" + secrets.token_hex(6)
        self.api_port, self.pg_port = free_port(), free_port()
        require(self.api_port != self.pg_port, "distinct-ports")
        self.origin = f"http://127.0.0.1:{self.api_port}"
        self.database = "g1_backend_" + secrets.token_hex(6)
        self.password, self.pg_password, self.session_secret = (secrets.token_urlsafe(36) for _ in range(3))
        self.sensitive = [self.password, self.pg_password, self.session_secret]
        self.env = {**os.environ, "TEMP": str(self.root), "TMP": str(self.root), "PYTHONDONTWRITEBYTECODE": "1",
                    "G1_PASSWORD": self.password, "G1_PG_PASSWORD": self.pg_password,
                    "G1_SESSION_SECRET": self.session_secret}
        self.fork = fork
        self.diagnostics = diagnostics
        self.parser_fixture = parser_fixture
        self.parser_case = None
        self.report = {"schema_version": 1, "started_at": now(), "project": self.project,
                       "scope": "Synthetic package.js -> real HTTP -> separate API/PG/640-MiB worker -> canonical HTTP readback; no browser/source-adapter/ChatGPT claim.",
                       "api_port": self.api_port, "pg_port": self.pg_port, "steps": [],
                       "harness_sha256": {name: sha((REPO / "scripts/extension-beta" / name).read_bytes())
                                           for name in ("backend-gate.py", "backend-package.cjs")}}
        self.compose = self.root / "compose.json"
        self.before = None
        self.device = None
        self.extra_devices = []
        self.web = self.device_client = None

    def save(self):
        (self.root / "receipt.json").write_text(json.dumps(self.report, indent=2) + "\n", encoding="utf8")

    def command(self, args, *, timeout=120, env=None, log=None):
        p = subprocess.run([str(x) for x in args], cwd=REPO, env=env or self.env,
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout)
        if log:
            text = p.stdout.decode("utf8", errors="replace")
            for secret in self.sensitive:
                text = text.replace(secret, "<redacted>")
            (self.root / log).write_text(text, encoding="utf8")
        require(p.returncode == 0, "command-failed:" + (log or str(args[0])))
        return p.stdout

    def docker_json(self, *args):
        return json.loads(self.command(["docker", *args]))

    def dc(self, *args, timeout=180, log=None):
        return self.command(["docker", "compose", "-p", self.project, "-f", self.compose, *args], timeout=timeout, log=log)

    def step(self, name, **facts):
        self.report["steps"].append({"name": name, "at": now(), **facts})
        self.save()
        print(json.dumps({"step": name, **facts}), flush=True)

    def unrelated(self):
        ids = self.command(["docker", "ps", "-aq"]).decode().split()
        rows = self.docker_json("inspect", *ids) if ids else []
        return {r["Id"]: [r["Image"], r["State"]["StartedAt"], r["RestartCount"], r["State"]["Status"]]
                for r in rows if r["Config"]["Labels"].get("com.docker.compose.project") != self.project}

    def source_files(self):
        def listed(*flags):
            return set(filter(None, self.command(["git", "ls-files", "-z", *flags, "--", *API_SOURCE])
                              .decode("utf8").split("\0")))
        tracked = listed("--cached")
        extra = listed("--others", "--exclude-standard")
        # New Python runtime modules may precede git add. Never copy unknown
        # untracked artifacts (exports, config, private data) as source.
        for name in extra:
            path = Path(name)
            require(path.suffix == ".py" and any(path.is_relative_to(root) for root in API_SOURCE[:3])
                    and not any(p.startswith(".") for p in path.parts), "unreviewed-untracked-snapshot-input")
        return sorted(tracked | extra)

    def verify_snapshot(self):
        require(self.source_files() == sorted(self.hashes), "snapshot-file-set-changed")
        copied_root = self.root / "source"
        copied = set()
        for path in copied_root.rglob("*"):
            ordinary(path)
            if path.is_file():
                copied.add("apps/api/" + path.relative_to(copied_root).as_posix())
        require(copied == set(self.hashes), "snapshot-copy-file-set-changed")
        for name, digest in self.hashes.items():
            for path in (REPO / name, copied_root / Path(name).relative_to("apps/api")):
                ordinary(path)
                require(path.is_file() and sha(path.read_bytes()) == digest, "snapshot-source-or-copy-changed")

    def snapshot(self):
        hashes = {}
        for name in self.source_files():
            source = REPO / name
            ordinary(source)
            require(source.is_file(), "source-file-required")
            raw = source.read_bytes()
            target = self.root / "source" / Path(name).relative_to("apps/api")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(raw)
            hashes[name] = sha(raw)
        require(hashes and "apps/api/app/main.py" in hashes, "snapshot-empty")
        self.hashes = hashes
        self.verify_snapshot()
        (self.root / "source-hashes.json").write_text(json.dumps(hashes, indent=2), encoding="utf8")
        self.report["reader_head"] = self.command(["git", "rev-parse", "HEAD"]).decode().strip()
        self.report["source_manifest_sha256"] = sha(json.dumps(hashes, sort_keys=True).encode())
        self.report["source_files"] = len(hashes)

    def prepare(self):
        context = self.docker_json("context", "inspect")
        endpoint = context[0]["Endpoints"]["docker"]["Host"]
        require(endpoint.startswith("npipe://") and not os.environ.get("DOCKER_HOST", endpoint).startswith(("ssh:", "tcp:", "http")),
                "local-desktop-daemon-required")
        self.env["DOCKER_HOST"] = endpoint
        self.env.pop("DOCKER_CONTEXT", None)
        require(not self.command(["docker", "ps", "-aq", "--filter", "label=com.docker.compose.project=" + self.project]).strip(),
                "project-already-exists")
        self.before = self.unrelated()
        # A cached image supplies dependencies only. Its code is replaced by our sealed source snapshot.
        self.command(["git", "diff", "--exit-code", "54d67649057e4dfc98e45364d6438cfbdf74a329", "HEAD", "--",
                      "apps/api/requirements-runtime.lock", "apps/api/requirements-build.lock", "apps/api/pyproject.toml"])
        api_image = self.docker_json("image", "inspect", DEPENDENCY_IMAGE)[0]["Id"]
        pg_image = self.docker_json("image", "inspect", "postgres:16-alpine")[0]["Id"]
        self.report["dependency_images"] = {"api": api_image, "postgres": pg_image}
        self.snapshot()
        self.command(["node", REPO / "scripts/extension-beta/backend-package.cjs", self.fork, self.root / "packages"],
                     log="package.log")
        self.fixtures = json.loads((self.root / "packages/fixtures.json").read_bytes())
        self.report["package_writer"] = {k: self.fixtures[k] for k in ("fork_head", "source_hashes", "scope")}
        if self.parser_fixture:
            self.load_parser_fixture()
        if self.diagnostics:
            self.corrupt_fixture()
        data = self.root / "data"
        for name in ("imports", "assets", "exports", "offline", "tmp"):
            (data / name).mkdir(parents=True)
        environment = {
            "APP_ENV": "test", "AUTH_ENABLED": "true", "AUTH_COOKIE_SECURE": "false",
            "AUTH_SESSION_SECRET": "${G1_SESSION_SECRET:?}", "PUBLIC_WEB_BASE_URL": self.origin,
            "DATABASE_URL": "postgresql+psycopg://postgres:${G1_PG_PASSWORD:?}@pg/" + self.database,
            "READER_EXTENSION_IDS": EXTENSION, "READER_EXTENSION_CAPTURE": "true",
            "IMPORT_STORAGE_DIR": "/data/imports", "ASSET_STORAGE_DIR": "/data/assets",
            "EXPORT_STORAGE_DIR": "/data/exports", "OFFLINE_STORAGE_DIR": "/data/offline",
            "TEMP": "/data/tmp", "TMP": "/data/tmp", "PYTHONDONTWRITEBYTECODE": "1",
            "ATTACHMENT_SCANNER": "disabled", "IMPORT_COMMIT_INLINE": "false",
        }
        mounts = [{"type": "bind", "source": (self.root / "source" / n).as_posix(),
                   "target": "/app/" + n, "read_only": True} for n in ("app", "scripts", "alembic", "alembic.ini")]
        mounts.append({"type": "bind", "source": data.as_posix(), "target": "/data"})
        common = {"image": api_image, "pull_policy": "never", "environment": environment,
                  "volumes": mounts, "labels": {"reader-g1-owner": self.project}}
        spec = {"services": {
            "pg": {"image": pg_image, "pull_policy": "never", "tmpfs": ["/var/lib/postgresql/data"],
                   "environment": {"POSTGRES_PASSWORD": "${G1_PG_PASSWORD:?}", "POSTGRES_DB": self.database},
                   "ports": [f"127.0.0.1:{self.pg_port}:5432"], "labels": {"reader-g1-owner": self.project},
                   "healthcheck": {"test": ["CMD", "pg_isready", "-U", "postgres", "-d", self.database],
                                   "interval": "1s", "timeout": "3s", "retries": 40}},
            "migrate": {**common, "environment": {**environment, "ADMIN_EMAIL": "g1-backend@example.test",
                                                "ADMIN_PASSWORD": "${G1_PASSWORD:?}"},
                        "command": ["sh", "-ec", "alembic upgrade head && python -m scripts.owner_auth ensure-configured"]},
            "api": {**common, "ports": [f"127.0.0.1:{self.api_port}:8000"]},
            "worker": {**common, "mem_limit": "640m", "memswap_limit": "640m",
                       "command": ["python", "-m", "app.workers.import_worker"]}},
                # Dedicated bridge, not a preexisting network. Docker Desktop's
                # internal bridge did not expose its published loopback port in
                # the retained first attempt. No client accepts an external URL.
                "networks": {"default": {}}}
        self.compose.write_text(json.dumps(spec, indent=2), encoding="utf8")
        self.dc("up", "-d", "--wait", "pg", log="pg-start.log")
        with socket.create_connection(("127.0.0.1", self.pg_port), timeout=5):
            pass
        self.step("fresh-postgres", isolated_data=True, source_snapshot=True)

    def load_parser_fixture(self):
        """Consume the parser sidecar's synthetic capture artifact, never real user data."""
        approved(self.parser_fixture)
        expected_bytes = self.parser_fixture.read_bytes()
        expected = json.loads(expected_bytes)
        require(expected["syntheticOnly"] is True and expected["partial"] is True
                and expected["messageCount"] == 2, "synthetic-parser-fixture")
        filename = expected["fixture"]
        require(Path(filename).name == filename and filename.endswith(".zip"), "fixture-filename")
        source = self.parser_fixture.parent / filename
        approved(source)
        data = source.read_bytes()
        require(len(data) == expected["zipBytes"] and sha(data) == expected["zipSHA256"], "parser-fixture-digest")
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            head = json.loads(archive.read("manifest.json"))
            index = [json.loads(line) for line in archive.read("reader/source.jsonl").splitlines()]
            markdown = archive.read("conversation.md")
        require(head["version"] == "reader-chat-v1" and head["partial"] is True and head["assets"] == []
                and len(index) == len(expected["bodyHashes"]) == 2, "parser-fixture-shape")
        rows = []
        for row, item in zip(index, expected["bodyHashes"]):
            body = markdown[row["offset"]:row["offset"] + row["bytes"]]
            require(row["role"] == item["role"] and len(body) == item["bytes"]
                    and sha(body) == row["sha256"] == item["sha256"]
                    and body.decode() == item["expectedSyntheticBody"], "parser-fixture-body")
            rows.append({"id": row["id"], "role": row["role"], "body": item["expectedSyntheticBody"],
                         "source_path": row["source_path"]})
        # Recompute the declared native source identity independently of canonical persistence.
        digest = hashlib.sha256((head["lineage"] + "\n").encode())
        for row in index:
            require(row["assets"] == [], "parser-fixture-assets")
            digest.update(json.dumps([row["id"], row["parent"], row["source_path"], row["role"],
                                      row["at"], row["sha256"], []],
                                     ensure_ascii=False, separators=(",", ":")).encode() + b"\n")
        require(digest.hexdigest() == expected["sourceDigest"], "parser-fixture-source-digest")
        target = self.root / "packages" / "parser-partial.zip"
        target.write_bytes(data)
        (self.root / "packages/parser-partial.expected.json").write_bytes(expected_bytes)
        self.parser_case = {"name": "parser-partial", "zip_sha256": sha(data), "zip_bytes": len(data),
                            "rows": rows, "source_id": head["source_id"], "assets": [],
                            "source_digest": expected["sourceDigest"], "partial": True}
        self.report["parser_fixture"] = {
            "generated_at": expected["generatedAt"], "zip_sha256": sha(data),
            "expected_manifest_sha256": sha(expected_bytes), "source_digest": digest.hexdigest(),
            "input_hashes_at_generation": expected["inputs"],
            "scope": "Synthetic DOM/API/OPFS; actual parser/source-dom/capture/host/package/uploader. Not live ChatGPT.",
        }

    def corrupt_fixture(self):
        """Corrupt one byte-index offset in an actual package.js output; do not loosen validation."""
        original = self.fixtures["cases"][0]
        target = io.BytesIO()
        with zipfile.ZipFile(self.root / "packages/complete.zip") as source, zipfile.ZipFile(target, "w") as output:
            for member in source.infolist():
                raw = source.read(member)
                if member.filename == "reader/source.jsonl":
                    rows = [json.loads(line) for line in raw.splitlines()]
                    rows[0]["offset"] += 1
                    raw = "".join(json.dumps(row, separators=(",", ":")) + "\n" for row in rows).encode()
                output.writestr(member, raw)
        raw = target.getvalue()
        (self.root / "packages/invalid-index.zip").write_bytes(raw)
        self.invalid_case = {**original, "name": "invalid-index", "zip_sha256": sha(raw), "zip_bytes": len(raw)}

    def pg_tests(self):
        env = {**self.env, "APP_ENV": "test", "SETTINGS_POSTGRES_INTEGRATION": "1",
               "DATABASE_URL": f"postgresql+psycopg://postgres:{self.pg_password}@127.0.0.1:{self.pg_port}/{self.database}?connect_timeout=5",
               "IMPORT_STORAGE_DIR": str(self.root / "pg-unit-imports")}
        tests = ["apps/api/tests/test_extension_transfer_postgres.py", "apps/api/tests/test_extension_release_postgres.py"]
        self.command([sys.executable, "-B", "-m", "pytest", *tests, "-q", "--tb=short", "--show-capture=no",
                      "--basetemp=" + str(self.root / "pg-pytest"), "-o", "cache_dir=" + str(self.root / "pg-cache")],
                     env=env, timeout=900, log="postgres-tests.log")
        self.step("postgres-regressions", exit_code=0)

    def request(self, client, method, path, expected=200, **kw):
        require(path.startswith("/api/") and "://" not in path, "local-api-path")
        response = client.request(method, path, **kw)
        require(response.status_code in ((expected,) if isinstance(expected, int) else expected),
                f"http-status:{method}:{response.status_code}")
        return response

    def start_app(self):
        self.dc("run", "--rm", "--no-deps", "migrate", log="migrate.log")
        self.dc("up", "-d", "api", "worker", log="app-start.log")
        self.web = httpx.Client(base_url=self.origin, headers={"Origin": self.origin}, timeout=30, trust_env=False)
        end = time.monotonic() + 90
        while True:
            try:
                if self.web.get("/api/health").status_code == 200:
                    break
            except httpx.TransportError:
                pass
            require(time.monotonic() < end, "api-readiness-timeout")
            time.sleep(0.5)
        user = self.request(self.web, "POST", "/api/auth/login",
                            json={"email": "g1-backend@example.test", "password": self.password}).json()
        self.user_id = user["user_id"]
        verifier = secrets.token_urlsafe(32)
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
        self.sensitive.append(verifier)
        consent = self.request(self.web, "POST", "/api/extension-devices/authorize",
                               json={"client": EXTENSION, "challenge": challenge, "state": secrets.token_urlsafe(32),
                                     "expected_user_id": user["user_id"]}).json()
        from urllib.parse import urlsplit, parse_qs
        redirect = urlsplit(consent["redirect"])
        require(redirect.hostname == EXTENSION + ".chromiumapp.org" and redirect.path == "/reader", "pair-redirect")
        code = parse_qs(redirect.query)["code"][0]
        self.sensitive.append(code)
        self.device_client = httpx.Client(base_url=self.origin, headers={"Origin": "chrome-extension://" + EXTENSION},
                                         timeout=45, trust_env=False)
        grant = self.request(self.device_client, "POST", "/api/extension/v1/token",
                             json={"client": EXTENSION, "code": code, "verifier": verifier}).json()
        self.sensitive.extend([grant["access_token"], grant["refresh_token"]])
        self.device = grant["device_id"]
        self.device_client.headers["Authorization"] = "Bearer " + grant["access_token"]
        caps = self.request(self.device_client, "GET", "/api/extension/v1/capabilities").json()
        require(caps["resumable_capture"] and caps["capture"] and caps["import_profile"] == "reader-chat-v1", "capabilities")
        if self.diagnostics:
            require(caps["import_diagnostics"] is True, "diagnostics-capability")
        self.step("fresh-api-worker", worker_memory_bytes=640 * 1024**2, normal_http_pairing=True)

    def receive(self, case, *, interruptions=False, project=None):
        data = (self.root / "packages" / (case["name"] + ".zip")).read_bytes()
        require(sha(data) == case["zip_sha256"], "fixture-digest")
        key = str(uuid.uuid4())
        path = "/api/extension/v1/transfers/" + key
        binding = {"size": len(data), "sha256": sha(data)}
        if project is not None:
            binding["project"] = project
        client = self.device_client
        state = self.request(client, "POST", path, json=binding).json()
        require(state["id"] is None and state["offset"] == 0 and state["chunk_bytes"] == 4 * 1024**2, "begin-receipt")
        chunks = 0
        while state["offset"] < len(data):
            offset = state["offset"]
            chunk = data[offset:offset + state["chunk_bytes"]]
            form = {"offset": str(offset), "sha256": sha(chunk)}
            files = {"chunk": ("chunk", chunk, "application/octet-stream")}
            if interruptions and chunks == 0:
                self.request(client, "POST", path + "/chunks", expected=422, data={**form, "sha256": "0" * 64}, files=files)
                require(self.request(client, "POST", path, json=binding).json()["offset"] == 0, "bad-chunk-advanced")
            state = self.request(client, "POST", path + "/chunks", data=form, files=files).json()
            chunks += 1
            require(state["offset"] == offset + len(chunk), "chunk-ack")
            if interruptions and chunks == 1:
                require(state["offset"] < len(data), "multi-chunk-fixture-required")
                # Drop the HTTP client after the durable chunk acknowledgement; resume with its original binding.
                headers = dict(client.headers)
                client.close()
                client = self.device_client = httpx.Client(base_url=self.origin, headers=headers, timeout=45, trust_env=False)
                require(self.request(client, "GET", "/api/extension/v1/requests/" + key).json()["id"] is None, "premature-receipt")
                require(self.request(client, "POST", path, json=binding).json() == state, "resume-offset")
                self.request(client, "POST", path + "/chunks", expected=409, data=form, files=files)
                self.request(client, "POST", path, expected=409, json={**binding, "sha256": "1" * 64})
                self.request(client, "POST", path + "/finish", expected=409)
        done = self.request(client, "POST", path + "/finish").json()
        iid = done["id"]
        self.last_transfer = {"key": key, "path": path, "binding": binding}
        require(iid and self.request(client, "GET", "/api/extension/v1/requests/" + key).json()["id"] == iid, "accepted-receipt")
        require(self.request(client, "POST", path + "/finish").json()["id"] == iid, "finish-duplicate")
        require(self.request(client, "POST", path, json=binding).json()["id"] == iid, "begin-duplicate")
        self.request(client, "DELETE", path, expected=409)
        self.step("receive-" + case["name"], chunks=chunks, bytes=len(data), sha256=sha(data),
                  original_receipt_reused=True, interruption_controls=interruptions)
        return iid

    def wait_import(self, iid, *, committed=False):
        end = time.monotonic() + 240
        statuses = []
        while True:
            state = self.request(self.device_client, "GET", "/api/extension/v1/imports/" + iid).json()
            pair = [state["status"], state["state"]]
            if not statuses or statuses[-1] != pair:
                statuses.append(pair)
            if (state["status"] == "committed" if committed else bool(state.get("review"))):
                if self.diagnostics:
                    require("failure" in state and state["failure"] is None, "successful-receipt-failure")
                return state, statuses
            require(state["status"] not in {"failed", "paused", "blocked", "cancelled"}, "worker-terminal-before-result:" + state["status"])
            require(time.monotonic() < end, "worker-timeout")
            time.sleep(0.4)

    def commit(self, iid, review, *, partial=False):
        path = "/api/extension/v1/imports/" + iid + "/commit"
        body = {"receipt": review["receipt"], "accept_partial": partial}
        if partial:
            self.request(self.device_client, "POST", path, expected=409, json={"receipt": review["receipt"]})
        self.request(self.device_client, "POST", path, expected=(200, 202), json=body)
        self.request(self.device_client, "POST", path, expected=(200, 202), json=body)
        return self.wait_import(iid, committed=True)

    def canonical(self, cid, case):
        detail = self.request(self.web, "GET", "/api/conversations/" + cid).json()
        rows = self.request(self.web, "GET", f"/api/conversations/{cid}/messages", params={"include_blocks": "true"}).json()
        assets = self.request(self.web, "GET", f"/api/conversations/{cid}/attachments").json()["items"]
        require(detail["message_count"] == len(rows) == len(case["rows"]), "canonical-message-count")
        require(len(assets) == len(case["assets"]), "canonical-asset-count")
        by_path = {a["metadata"].get("archive_path"): a for a in assets}
        for expected in case["assets"]:
            asset = by_path[expected["path"]]
            require(asset["asset_object"]["sha256"] == expected["sha256"] and asset["resolution_status"] == "resolved", "canonical-asset-digest")
            body = self.request(self.web, "GET", "/api/attachments/" + asset["id"] + "/content").content
            require(len(body) == expected["bytes"] and sha(body) == expected["sha256"], "asset-readback")
        for item, expected in zip(rows, case["rows"]):
            text = expected["body"]
            for name, asset in by_path.items():
                text = text.replace("](" + name + ")", "](cr-asset://" + asset["id"] + ")")
            require(item["role"] == expected["role"] and item["current_version"]["display_text"] == text, "canonical-message-bytes")
            detail = self.request(self.web, "GET", "/api/messages/" + item["id"]).json()
            refs = detail["source_refs"]
            # Enrichment retains both native Reader identity and archive provenance.
            # The first strengthened run incorrectly expected only the native ref;
            # keep its failed receipt, and assert both complete contracts here.
            by_profile = {ref["source_profile"]: ref for ref in refs}
            require(len(refs) == len(by_profile) == 2 and set(by_profile) == {
                "reader-chat-v1", "conversation-zip-markdown-v1"}, "canonical-source-profiles")
            native, archive = by_profile["reader-chat-v1"], by_profile["conversation-zip-markdown-v1"]
            require(native["source_conversation_id"] == case["source_id"]
                    and native["source_message_id"] == expected["id"]
                    and native["raw_metadata"]["tree_nodes"] == expected["source_path"], "canonical-source-identity")
            require(archive["source_type"] == "adaptive_archive"
                    and archive["source_message_id"] == expected["id"]
                    and archive["raw_metadata"]["conversation_index"] == 0
                    and bool(archive["raw_metadata"]["archive_member_id"]), "canonical-archive-provenance")
        return sha(json.dumps([rows, assets], sort_keys=True).encode())

    def project_gate(self):
        """Pairing remains read/organize: only the owner's Web session can confirm a named target."""
        path, catalog = "/api/extension-devices/import-project", "/api/extension/v1/projects"
        caps = self.request(self.device_client, "GET", "/api/extension/v1/capabilities").json()
        require(caps["web_import_project"] is True, "web-project-capability")
        listed = lambda: self.request(self.device_client, "GET", catalog).json()
        initial = listed()
        body = {"device_id": self.device, "expected_user_id": self.user_id, "name": "Synthetic Ocean"}
        self.request(self.device_client, "POST", catalog, expected=405, json=body)
        self.request(self.device_client, "POST", path, expected=403, json=body)
        self.request(self.web, "POST", path, expected=403, json={**body, "device_id": str(uuid.uuid4())})
        self.request(self.web, "POST", path, expected=403, json={**body, "expected_user_id": str(uuid.uuid4())})
        self.request(self.web, "POST", path, expected=422, json={**body, "name": "   "})
        self.request(self.web, "POST", path, expected=422, json={**body, "name": "海" * 121})
        self.request(self.web, "POST", path, expected=422, json={**body, "name": "No\0NUL"})
        self.request(self.web, "POST", path, expected=409, json={**body, "name": next(p["name"] for p in initial if p["default"])})
        require(listed() == initial, "invalid-project-created")
        # Simultaneous confirmations for a name serialize with ordinary Reader mutations.
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=2) as pool:
            replies = list(pool.map(lambda _: self.request(self.web, "POST", path, json=body).json(), range(2)))
        require(replies[0] == replies[1] and replies[0]["client"] == EXTENSION, "project-confirmation-not-idempotent")
        first = replies[0]["id"]
        with_spaces = self.request(self.web, "POST", path, json={**body, "name": "  Synthetic Ocean  "}).json()
        require(with_spaces == replies[0], "project-trim-not-idempotent")
        second = self.request(self.web, "POST", "/api/projects", expected=201, json={"name": "Synthetic Bay"}).json()["id"]
        archive = self.request(self.web, "POST", "/api/projects", expected=201, json={"name": "Synthetic Archived"}).json()["id"]
        self.request(self.web, "PATCH", "/api/projects/" + archive, json={"is_archived": True})
        self.request(self.web, "POST", path, expected=409, json={**body, "name": "Synthetic Archived"})
        require({p["id"] for p in listed() if not p["default"]} == {first, second}, "project-selection-list")
        self.step("project-confirmation", web_session_only=True, wrong_account_or_device_rejected=True,
                  concurrent_exact_name_one_result=True, archived_and_default_rejected=True)
        return first, second

    def http_gate(self):
        complete, partial = self.fixtures["cases"]
        require(self.request(self.web, "GET", "/api/conversations").json() == [], "fresh-database-not-empty")
        first_project, second_project = self.project_gate()
        iid = self.receive(complete, interruptions=True, project=first_project)
        ready, sequence = self.wait_import(iid)
        require(ready["review"]["action"] == "new" and not ready["review"]["partial"], "complete-review")
        require(self.request(self.web, "GET", "/api/conversations").json() == [], "canonical-write-before-confirm")
        done, committed_sequence = self.commit(iid, ready["review"])
        cid = done["conversation_id"]
        require(done["result"]["completeness"] == "complete", "complete-result")
        require(all(done["result"][key]["id"] == first_project for key in ("saved_project", "current_project")), "created-project-receipt")
        original = self.canonical(cid, complete)
        self.step("complete-canonical-readback", messages=2, attachments=2, canonical_sha256=original,
                  analysis_states=sequence, commit_states=committed_sequence)
        second = self.receive(complete, project=second_project)
        ready, _ = self.wait_import(second)
        require(ready["review"]["action"] == "unchanged" and ready["review"]["conversation_id"] == cid, "duplicate-source-review")
        duplicate, _ = self.commit(second, ready["review"])
        require(duplicate["conversation_id"] == cid and self.canonical(cid, complete) == original, "duplicate-mutated-canonical")
        require(duplicate["result"]["current_project"]["id"] == first_project, "duplicate-moved-existing-project")
        require(len(self.request(self.web, "GET", "/api/conversations").json()) == 1, "duplicate-conversation")
        self.step("duplicate-source", existing_conversation_reused=True, canonical_identity_unchanged=True)
        iid = self.receive(partial, project=second_project)
        ready, sequence = self.wait_import(iid)
        require(ready["review"]["partial"] and ready["review"]["messages"] == 2, "partial-review")
        done, committed_sequence = self.commit(iid, ready["review"], partial=True)
        require(done["result"]["completeness"] == "partial", "false-complete-on-missing-image")
        require(all(done["result"][key]["id"] == second_project for key in ("saved_project", "current_project")), "selected-project-receipt")
        for project, conversation in [(first_project, cid), (second_project, done["conversation_id"])]:
            actual = self.request(self.web, "GET", "/api/projects/" + project + "/conversations").json()
            require([c["id"] for c in actual] == [conversation], "canonical-project-membership")
        self.step("mapped-projects-canonical", distinct_targets=2, duplicate_retained_original_project=True)
        digest = self.canonical(done["conversation_id"], partial)
        require(len(self.request(self.web, "GET", "/api/conversations").json()) == 2, "final-conversation-count")
        self.step("partial-missing-image", messages=2, attachments=0, partial_consent_required=True,
                  completeness="partial", canonical_sha256=digest, analysis_states=sequence, commit_states=committed_sequence)
        if self.parser_case:
            self.parser_http()
        if self.diagnostics:
            self.invalid_http()
        require(self.canonical(cid, complete) == original, "later-cases-mutated-original")

    def parser_http(self):
        case = self.parser_case
        iid = self.receive(case)
        ready, sequence = self.wait_import(iid)
        require(ready["review"]["partial"] and ready["review"]["messages"] == 2
                and ready["review"]["action"] == "new", "actual-parser-partial-review")
        done, committed_sequence = self.commit(iid, ready["review"], partial=True)
        require(done["result"]["completeness"] == "partial", "actual-parser-false-complete")
        digest = self.canonical(done["conversation_id"], case)
        self.step("actual-parser-missing-image-canonical", messages=2, attachments=0, partial_consent_required=True,
                  completeness="partial", source_digest=case["source_digest"], canonical_sha256=digest,
                  analysis_states=sequence, commit_states=committed_sequence)

    def invalid_http(self):
        before = len(self.request(self.web, "GET", "/api/conversations").json())
        iid = self.receive(self.invalid_case)
        path, transfer = "/api/extension/v1/imports/" + iid, self.last_transfer
        statuses, end = [], time.monotonic() + 240
        while True:
            state = self.request(self.device_client, "GET", path).json()
            pair = [state["status"], state["state"]]
            if not statuses or statuses[-1] != pair:
                statuses.append(pair)
            if state["status"] == "failed":
                break
            require(state["review"] is None and state["status"] not in {"committed", "paused", "blocked"},
                    "invalid-package-published")
            require(time.monotonic() < end, "invalid-package-worker-timeout")
            time.sleep(0.4)
        expected = {"code": "READER_PACKAGE_INVALID", "stage": "archive", "recovery": "system_support"}
        require(state["state"] == "FAILED" and state["phase"] == "analysis_failed"
                and state["failure"] == expected and state["review"] is None
                and state["conversation_id"] is None and state["result"] is None, "invalid-package-diagnostic")
        for _ in range(2):
            retry = self.request(self.device_client, "POST", path + "/retry", expected=409).json()
            require(retry == {"detail": expected}, "invalid-package-requeued")
            require(self.request(self.device_client, "POST", transfer["path"] + "/finish").json()["id"] == iid,
                    "failed-original-receipt-lost")
            require(self.request(self.device_client, "GET", "/api/extension/v1/requests/" + transfer["key"]).json()["id"] == iid,
                    "failed-request-receipt-lost")
        self.other_device_denied(path, transfer)
        require(len(self.request(self.web, "GET", "/api/conversations").json()) == before, "invalid-canonical-write")
        self.step("invalid-index-diagnostic", failure=expected, analysis_states=statuses,
                  same_invalid_artifact_retry_status=409, other_paired_device_status=404,
                  original_receipt_reused=True, canonical_writes=0)

    def other_device_denied(self, path, transfer):
        """A second valid grant for the same synthetic owner cannot read/retry this receipt."""
        from urllib.parse import urlsplit, parse_qs
        verifier = secrets.token_urlsafe(32)
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
        self.sensitive.append(verifier)
        consent = self.request(self.web, "POST", "/api/extension-devices/authorize", json={
            "client": EXTENSION, "challenge": challenge, "state": secrets.token_urlsafe(32),
            "expected_user_id": self.user_id,
        }).json()
        redirect = urlsplit(consent["redirect"])
        require(redirect.hostname == EXTENSION + ".chromiumapp.org" and redirect.path == "/reader", "second-pair-redirect")
        code = parse_qs(redirect.query)["code"][0]
        self.sensitive.append(code)
        with httpx.Client(base_url=self.origin, headers={"Origin": "chrome-extension://" + EXTENSION},
                          timeout=45, trust_env=False) as second:
            grant = self.request(second, "POST", "/api/extension/v1/token",
                                 json={"client": EXTENSION, "code": code, "verifier": verifier}).json()
            self.sensitive.extend([grant["access_token"], grant["refresh_token"]])
            self.extra_devices.append(grant["device_id"])
            require(grant["device_id"] != self.device and grant["user_id"] == self.user_id, "distinct-same-owner-device")
            second.headers["Authorization"] = "Bearer " + grant["access_token"]
            require(self.request(second, "GET", "/api/extension/v1/capabilities").json()["import_diagnostics"] is True,
                    "second-device-authenticated")
            self.request(second, "GET", path, expected=404)
            self.request(second, "POST", path + "/retry", expected=404)
            self.request(second, "GET", "/api/extension/v1/requests/" + transfer["key"], expected=404)
            self.request(second, "POST", transfer["path"] + "/finish", expected=404)

    def verify_runtime(self):
        ids = self.command(["docker", "ps", "-q", "--filter", "label=com.docker.compose.project=" + self.project]).decode().split()
        rows = self.docker_json("inspect", *ids)
        roles = {r["Config"]["Labels"]["com.docker.compose.service"]: r for r in rows}
        require(set(roles) == {"api", "worker", "pg"}, "live-role-inventory")
        require(all(r["Config"]["Labels"].get("reader-g1-owner") == self.project and r["State"]["Running"]
                    for r in rows), "live-role-owner")
        require(roles["api"]["Image"] == roles["worker"]["Image"] == self.report["dependency_images"]["api"]
                and roles["worker"]["HostConfig"]["Memory"] == 640 * 1024**2, "live-image-and-memory")
        payload = """
import json,sys
from sqlalchemy import text
from app.core.database import SessionLocal
with SessionLocal() as db:
 db.execute(text("SET TRANSACTION READ ONLY"))
 assert db.scalar(text("SELECT current_database()")) == sys.argv[1]
 extra=int(sys.argv[2]); invalid=int(sys.argv[3])
 schema=db.execute(text("SELECT version_num FROM alembic_version")).scalars().all()
 assert schema == ["20261125_0065"]
 counts={name:db.scalar(text("SELECT count(*) FROM "+name)) for name in ("conversations","messages","attachments","imports","source_message_refs")}
 assert counts == {"conversations":2+extra,"messages":4+2*extra,"attachments":2,"imports":3+extra+invalid,"source_message_refs":8+4*extra}
 profiles=dict(db.execute(text("SELECT source_profile,count(*) FROM source_message_refs GROUP BY source_profile")).all())
 assert profiles == {"reader-chat-v1":4+2*extra,"conversation-zip-markdown-v1":4+2*extra}
 jobs=dict(db.execute(text("SELECT status,count(*) FROM background_jobs WHERE job_type='adaptive_import_analysis' GROUP BY status")).all())
 assert jobs == ({"committed":3+extra,"failed":1} if invalid else {"committed":3+extra})
 if extra:
  from sqlalchemy import select
  from app.models.reader_extension import ExtensionSource
  assert db.scalar(select(ExtensionSource.source_digest).where(ExtensionSource.source_key=="chatgpt:"+sys.argv[4])) == sys.argv[5]
 assert db.scalar(text("SELECT count(*) FROM worker_runtime_states WHERE worker_key='primary' AND heartbeat_at>now()-interval '90 seconds'")) == 1
 db.rollback()
 print(json.dumps({"schema":schema[0],"counts":counts,"source_profiles":profiles,"analysis_jobs":jobs,"fresh_worker_heartbeat":True,"parser_source_digest_verified":bool(extra)}))
"""
        parser_args = [self.parser_case["source_id"], self.parser_case["source_digest"]] if self.parser_case else []
        result = json.loads(self.command(["docker", "exec", roles["api"]["Id"], "python", "-B", "-c", payload,
                                          self.database, int(bool(self.parser_case)), int(self.diagnostics), *parser_args]))
        self.verify_snapshot()
        self.step("live-schema-worker-and-single-receipts", **result)

    def cleanup(self):
        if self.web and self.device:
            for device in [self.device, *self.extra_devices]:
                self.request(self.web, "DELETE", "/api/extension-devices/" + device, expected=204)
            require(self.request(self.web, "GET", "/api/extension-devices").json()["items"] == [], "synthetic-device-cleanup")
            self.report["synthetic_device_revoked"] = True
            self.report["synthetic_devices_revoked"] = 1 + len(self.extra_devices)
        for client in (self.web, self.device_client):
            if client:
                client.close()
        ids = self.command(["docker", "ps", "-aq", "--filter", "label=com.docker.compose.project=" + self.project]).decode().split()
        if ids:
            rows = self.docker_json("inspect", *ids)
            require(all(r["Config"]["Labels"].get("reader-g1-owner") == self.project for r in rows), "cleanup-owner-mismatch")
            self.dc("down", "--timeout", "20", log="cleanup.log")
        require(not self.command(["docker", "ps", "-aq", "--filter", "label=com.docker.compose.project=" + self.project]).strip(), "cleanup-incomplete")
        self.report["unrelated_containers_unchanged"] = self.unrelated() == self.before if self.before is not None else True
        require(self.report["unrelated_containers_unchanged"], "unrelated-container-state-changed")
        self.report["owned_services_removed"] = True

    def run(self):
        try:
            self.prepare()
            self.pg_tests()
            self.start_app()
            self.http_gate()
            self.verify_runtime()
            self.report["passed"] = True
        except Exception as exc:
            self.report.update(passed=False, failure={
                "type": type(exc).__name__,
                "code": str(exc) if isinstance(exc, AssertionError) else "operation-incomplete",
                "lines": [f.lineno for f in traceback.extract_tb(exc.__traceback__) if Path(f.filename).resolve() == Path(__file__).resolve()],
            })
        finally:
            try:
                self.cleanup()
            except Exception as exc:
                self.report.update(passed=False, cleanup_failure={"type": type(exc).__name__,
                    "code": str(exc) if isinstance(exc, AssertionError) else "cleanup-incomplete"})
            self.report["finished_at"] = now()
            self.save()
        print(json.dumps({"passed": self.report["passed"], "receipt": str(self.root / "receipt.json"),
                          "failure": self.report.get("failure"), "cleanup_failure": self.report.get("cleanup_failure")}), flush=True)
        return 0 if self.report["passed"] else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--parent", type=Path, required=True)
    parser.add_argument("--fork", type=Path, required=True)
    parser.add_argument("--diagnostics", action="store_true", help="Require G2 safe failure/retry contract.")
    parser.add_argument("--parser-fixture", type=Path, help="Parser sidecar's synthetic .expected.json under an approved temp root.")
    args = parser.parse_args()
    return Gate(args.parent, args.fork, diagnostics=args.diagnostics, parser_fixture=args.parser_fixture).run()


if __name__ == "__main__":
    sys.exit(main())
