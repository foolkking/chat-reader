"""Installed root-owned adapter, compatible with host Python 3.6+. No remotely supplied commands.

Called only by the local daemon, never by HTTP. stdout is a bounded receipt; do not
log subprocess output (Compose config contains instance secrets).
"""

import hashlib
import gzip
import copy
import datetime
import http.client
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import zlib
import tarfile
import tempfile
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote, urlencode, urlsplit

ETC = Path("/etc/chat-reader/updater")
LIB = Path("/usr/local/lib/chat-reader-updater")
JOBS = Path("/var/lib/chat-reader-updater/jobs")
GATE = Path("/var/lib/chat-reader-update-progress/maintenance")
PROFILE = ETC / "program-profile.enabled"
SCRATCH = Path("/var/lib/chat-reader-program-scratch")
ROLES = ("api", "import-worker", "web")
DATA = {"/data/" + n for n in ("imports", "exports", "offline", "assets")}


def docker_read(path):
    """Local host only. Avoid launching dozens of CLI processes for small read
    probes in the cutover window. No URL, verb or socket path is an API input."""

    # Without native overlay diff, Docker walks the complete filesystem before
    # replying. A cold scan on a small host can exceed the metadata RPC budget.
    # Keep this one read bounded and fail closed; never skip the core-file check.
    timeout = 120 if re.fullmatch(r"containers/[a-f0-9]{64}/changes", path) else 15

    class Local(http.client.HTTPConnection):
        def connect(self):
            self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            self.sock.settimeout(timeout)
            self.sock.connect("/var/run/docker.sock")

    conn = Local("localhost", timeout=timeout)
    try:
        conn.request("GET", "/v1.41/" + path)
        response = conn.getresponse()
        need(response.status == 200)
        data = response.read((16 << 20) + 1)
        need(len(data) <= (16 << 20))
        return json.loads(data)
    finally:
        conn.close()


def need(value):
    if not value:
        raise ValueError("guard")
    return value


def id_valid(value):
    return isinstance(value, str) and re.fullmatch("[0-9a-f]{32}", value)


def exact(path, kind="file"):
    p = Path(path)
    need(p.is_absolute() and p.resolve() == p and (p.is_file() if kind == "file" else p.is_dir()))
    return p


def durable(path, data, mode=0o600):
    with tempfile.NamedTemporaryFile(dir=str(path.parent), delete=False) as f:
        os.chmod(f.name, mode)
        f.write(data.encode())
        f.flush()
        os.fsync(f.fileno())
    os.replace(f.name, str(path))
    fd = os.open(str(path.parent), os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def poll(check, seconds=150):
    stop = time.monotonic() + seconds
    while True:
        if check():
            return
        need(time.monotonic() < stop)
        time.sleep(0.3)


def archive_admission(archive, release, measure_layers=False, retained=()):
    """Inspect without extraction. docker load must not overwrite any unrelated tags."""
    tags = {
        "chat-reader-" + role + ":" + release["revision"]: ("web" if role == "web" else "api")
        for role in (*ROLES, "migrate")
    }
    manifest = None
    configs = {}
    seen = set()
    total = 0
    index = None
    documents = {}
    load_budget = 0
    sizes = {}
    with gzip.open(str(archive), "rb") as stream, tarfile.open(
        fileobj=stream, mode="r|", bufsize=1024 * 1024
    ) as data:
        for member in data:
            path = member.name
            if path.startswith("./"):
                path = path[2:]
            need(
                path not in seen
                and not path.startswith("/")
                and ".." not in path.split("/")
                and (member.isfile() or member.isdir())
                and len(seen) < 4096
            )
            seen.add(path)
            total += member.size
            need(total <= 32 * 1024**3)
            if not member.isfile():
                continue
            # OCI payloads can already be compressed inside docker save. Do not
            # use a guessed compression ratio to budget an unpacked image.
            if measure_layers and (path.startswith("blobs/sha256/") or path.endswith("layer.tar")):
                start_size = load_budget
                reader = data.extractfile(member)
                first = reader.read(min(64, member.size))
                need(not first.startswith(b"\x28\xb5\x2f\xfd"))  # Unsupported zstd => refuse before load.
                if first.startswith(b"\x1f\x8b"):
                    dec = zlib.decompressobj(31)
                    chunk = first
                    while chunk:
                        load_budget += len(dec.decompress(chunk, 1 << 20))
                        need(load_budget <= 32 << 30 and not dec.unused_data)
                        chunk = dec.unconsumed_tail or reader.read(1 << 20)
                    need(dec.eof)
                    sizes[path] = load_budget - start_size
                    continue
                load_budget += member.size
                sizes[path] = member.size
                if member.size > 2 * 1024**2:
                    continue
                raw = first + reader.read()
            elif member.size > 2 * 1024**2:
                continue
            else:
                raw = data.extractfile(member).read()
            if path.startswith("blobs/sha256/") and raw.lstrip().startswith(b"{"):
                digest = hashlib.sha256(raw).hexdigest()
                need(path == "blobs/sha256/" + digest)
                documents["sha256:" + digest] = json.loads(raw)
            if path == "manifest.json":
                manifest = json.loads(raw)
            elif path == "index.json":
                index = json.loads(raw)
            elif "sha256:" + hashlib.sha256(raw).hexdigest() in {
                i["config"] for i in release["images"].values()
            }:
                configs[path] = (hashlib.sha256(raw).hexdigest(), json.loads(raw))
        # Force the gzip trailer/CRC and count the real expanded bytes once, not
        # three separate whole-archive inflations before docker load.
        while stream.read(1024 * 1024):
            need(stream.tell() <= 32 * 1024**3)
        expanded = stream.tell()
    need(manifest and len(manifest) <= 4)
    if index is not None:
        roots = index["manifests"]
        need(index["schemaVersion"] == 2 and len(roots) == len(tags))
        names = set()
        for root in roots:
            annotations = root["annotations"]
            name = annotations["io.containerd.image.name"]
            need(name.startswith("docker.io/library/"))
            tag = name[len("docker.io/library/") :]
            need(tag in tags and tag not in names)
            names.add(tag)
            alt = annotations.get("org.opencontainers.image.ref.name")
            need(alt in (None, tag, name, release["revision"]))
            desc = documents[root["digest"]]
            need(desc["schemaVersion"] == 2)
            if "manifests" in desc:
                need(root["digest"] in release["images"][tags[tag]]["engine_ids"])
                choices = [
                    d
                    for d in desc["manifests"]
                    if d.get("platform") == {"os": "linux", "architecture": "amd64"}
                ]
                need(len(choices) == 1)
                desc = documents[choices[0]["digest"]]
            need(desc["config"]["digest"] == release["images"][tags[tag]]["config"])
            row = next(item for item in manifest if tag in item["RepoTags"])
            need(["blobs/sha256/" + v["digest"][7:] for v in desc["layers"]] == row["Layers"])
        need(names == set(tags))
    observed = set()
    for row in manifest:
        h, config = configs[row["Config"]]
        for tag in row["RepoTags"]:
            need(tag in tags and tag not in observed)
            observed.add(tag)
            im = release["images"][tags[tag]]
            need(
                "sha256:" + h == im["config"]
                and config["rootfs"]["diff_ids"] == im["rootfs"]
                and config["config"]["Labels"]["org.opencontainers.image.revision"] == release["revision"]
            )
        need(all(layer in seen for layer in row["Layers"]))
    need(observed == set(tags))
    if not measure_layers:
        return expanded
    # The engine may spool the complete outer tar. Charge new decompressed
    # chains separately, deduplicating only *identical prefixes*, not individual
    # diff IDs on unrelated parents. The compressed download is already on disk.
    chains = {tuple(r[:n]) for r in retained for n in range(1, len(r) + 1)}
    missing = 0
    for row in manifest:
        _, cfg = configs[row["Config"]]
        layers = cfg["rootfs"]["diff_ids"]
        need(len(layers) == len(row["Layers"]))
        for n, path in enumerate(row["Layers"], 1):
            chain = tuple(layers[:n])
            if chain not in chains:
                need(path in sizes)
                missing += sizes[path]
                chains.add(chain)
    return expanded + missing


class Host:
    def __init__(self, req, enroll=False):
        self.cfg = json.loads(exact(ETC / "host.json").read_text())
        self.old, self.new = req["old"], req["next"]
        self.dir = None if enroll else exact(req["directory"], "dir")
        if self.dir:
            need(self.dir.parent == JOBS and re.fullmatch("[0-9a-f]{32}", self.dir.name))
        c = self.cfg
        self.project = need(re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,62}", c["project"])).group()
        self.base = exact(c["project_dir"], "dir")
        self.compose = exact(c["compose"])
        self.envfile = exact(c["env_file"])
        self.pointer = exact(c["release_state"], "dir")
        self.backups = exact(c["backups"], "dir")
        self.origin = c["origin"].rstrip("/")
        u = urlsplit(self.origin)
        need(
            u.scheme == "https"
            and u.hostname
            and not (u.username or u.password or u.path or u.query or u.fragment)
        )
        self.fp = req["fingerprint"]
        self.nginx = [exact(p) for p in c["protected_files"]]
        need(self.nginx)
        self.env = dict(
            PATH="/usr/sbin:/usr/bin:/sbin:/bin",
            HOME="/root",
            LANG="C",
            DOCKER_HOST="unix:///var/run/docker.sock",
            COMPOSE_PROJECT_NAME=self.project,
            COMPOSE_FILE=str(self.compose),
            COMPOSE_ENV_FILE=str(self.envfile),
            BACKUP_DIR=str(self.backups),
            BACKUP_DEDUPLICATE="0",
            UPDATER_BATCH_READER="1",
            SOURCE_SHA=self.old["revision"],
        )
        self.env.update(self.images(self.old))
        self.refs = {}
        self.immutables = {}

    @staticmethod
    def images(r):
        images = {}
        for role, key in zip(ROLES, ("API_IMAGE", "WORKER_IMAGE", "WEB_IMAGE")):
            rev, _ = Host.role_image(role, r)
            images[key] = ("chat-reader-web:" if role == "web" else "chat-reader-api:") + rev
        return images

    @staticmethod
    def role_image(role, r):
        actual = r.get("installed_roles", {}).get(role)
        rev = actual["revision"] if actual else r["revision"]
        need(re.fullmatch("[a-f0-9]{40}", rev))
        return rev, actual["image"] if actual else r["images"]["web" if role == "web" else "api"]

    def run(self, args, env=None, timeout=300, quiet=False):
        cmd = subprocess.run(
            [str(x) for x in args],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL if quiet else subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            cwd=str(self.base),
            env=dict(self.env, **(env or {})),
            timeout=timeout,
        )
        need(cmd.returncode == 0)
        return "" if quiet else cmd.stdout.decode().strip()

    def dc(self, *args, **kw):
        return self.run(
            [
                "docker",
                "compose",
                "--project-directory",
                self.base,
                "-p",
                self.project,
                "--env-file",
                self.envfile,
                "-f",
                self.compose,
                "-f",
                LIB / "api-socket.yml",
            ]
            + (["-f", LIB / "program-profile.yml"] if PROFILE.is_file() else [])
            + list(args),
            **kw,
        )

    def ctr(self, role):
        if role not in self.refs:
            rows = docker_read(
                "containers/json?"
                + urlencode(
                    {
                        "all": "1",
                        "filters": json.dumps({"label": ["com.docker.compose.project=" + self.project]}),
                    }
                )
            )
            for name in ROLES + ("postgres",):
                matches = [
                    r["Id"]
                    for r in rows
                    if r["Labels"].get("com.docker.compose.service") == name
                    and r["Labels"].get("com.docker.compose.oneoff", "").lower() == "false"
                ]
                need(len(matches) == 1 and re.fullmatch("[a-f0-9]{64}", matches[0]))
                self.refs[name] = matches[0]
        return self.refs[role]

    def inspect(self, kind, ref):
        # Lifetime: one fixed host operation only. Container state is never cached.
        if (kind, ref) in self.immutables:
            return self.immutables[(kind, ref)]
        prefix, suffix = {
            "container": ("containers/", "/json"),
            "image": ("images/", "/json"),
            "volume": ("volumes/", ""),
        }[kind]
        item = docker_read(prefix + quote(ref, safe="") + suffix)
        if kind in ("image", "volume"):
            self.immutables[(kind, ref)] = item
        return item

    def nodes(self, roles):
        rows = [self.inspect("container", self.ctr(k)) for k in roles]
        need(len(rows) == len(roles) and all(n["Id"] == self.ctr(k) for k, n in zip(roles, rows)))
        return rows

    def inventory(self):
        # Separate per-operation caches so structural checks can run alongside
        # startup without importing stale running/healthy state into its probes.
        other = copy.copy(self)
        other.refs = {}
        other.immutables = {}
        return other

    def sql(self, stmt):
        return self.run(
            [
                "docker",
                "exec",
                self.ctr("postgres"),
                "sh",
                "-ec",
                'exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "$1"',
                "sh",
                stmt,
            ]
        )

    def schema(self):
        return self.sql("SELECT version_num FROM alembic_version")

    def idle(self):
        return (
            self.sql(
                "SELECT NOT EXISTS(SELECT 1 FROM background_jobs WHERE status IN ('queued','processing','cancelling')) "
                "AND NOT EXISTS(SELECT 1 FROM imports WHERE status IN ('queued','processing','cancelling')) "
                "AND EXISTS(SELECT 1 FROM worker_runtime_states WHERE worker_key='primary' AND state='idle' "
                "AND heartbeat_at>now()-interval '100 seconds')"
            )
            == "t"
        )

    def protected(self):
        """Bound the hot rollback contract to the same PG instance and four named volumes."""
        keys = ("postgres", "api", "import-worker")
        snapshots = {}
        for node in self.nodes(keys):
            role = node["Config"]["Labels"]["com.docker.compose.service"]
            mounts = {m["Destination"]: m["Name"] for m in node["Mounts"] if m["Type"] == "volume"}
            snapshots[role] = mounts
        need(snapshots["api"] == snapshots["import-worker"] and set(snapshots["api"]) == DATA)
        return snapshots

    def image(self, role, r, ref=None):
        rev, i = self.role_image(role, r)
        need(i["config"] in i["engine_ids"] and re.fullmatch("sha256:[a-f0-9]{64}", i["config"]))
        actual = self.inspect(
            "image",
            ref or self.images(r)[dict(zip(ROLES, ("API_IMAGE", "WORKER_IMAGE", "WEB_IMAGE")))[role]],
        )
        labels = actual["Config"]["Labels"]
        need(
            actual["Id"] in i["engine_ids"]
            and actual["RootFS"]["Layers"] == i["rootfs"]
            and actual["Os"] == "linux"
            and actual["Architecture"] == "amd64"
            and labels["org.opencontainers.image.revision"] == rev
            and labels["org.opencontainers.image.source"] == "https://github.com/" + r["repository"]
        )
        return actual["Id"]

    def fingerprint(self):
        cfg = json.loads(self.dc("config", "--format", "json"))
        services = cfg["services"]
        need(set(services) <= {"api", "web", "migrate", "import-worker", "postgres", "clamav"})
        env = services["api"]["environment"]
        for role in ("api", "migrate", "import-worker"):
            e = services[role]["environment"]
            need(
                e["ASSET_STORAGE_BACKEND"] == "local"
                and e["ATTACHMENT_SCANNER"] in ("disabled", "clamav")
                and urlsplit(e["DATABASE_URL"]).hostname == "postgres"
                and e["AUTH_ENABLED"].lower() == "true"
            )
        need(env["PUBLIC_WEB_BASE_URL"].rstrip("/") == self.origin)
        for role in ROLES + ("migrate",):
            s = services[role]
            s.pop("image")
            need(
                not s.get("privileged")
                and not s.get("devices")
                and not s.get("cap_add")
                and not s.get("volumes_from")
                and not s.get("network_mode")
                and not s.get("entrypoint")
            )
            if role in ("web", "api"):
                need(all(p.get("host_ip") == "127.0.0.1" for p in s.get("ports", [])))
            mounts = {m["target"]: m for m in s.get("volumes", [])}
            expected = (
                DATA
                if role == "import-worker"
                else DATA | {"/run/chat-reader-updater"}
                if role == "api"
                else set()
            )
            if PROFILE.is_file() and role in ROLES:
                expected = expected | {"/tmp"}
            need(set(mounts) == expected)
            for target, m in mounts.items():
                if target == "/tmp":
                    need(
                        m["type"] == "bind" and m["source"] == str(SCRATCH / role) and not m.get("read_only")
                    )
                elif target in DATA:
                    need(m["type"] == "volume")
                else:
                    need(m["type"] == "bind" and m["source"] == target and m.get("read_only"))
        need(
            not services["postgres"].get("ports")
            and len(services["postgres"]["volumes"]) == 1
            and services["postgres"]["volumes"][0]["type"] == "volume"
            and services["postgres"]["volumes"][0]["target"] == "/var/lib/postgresql/data"
        )
        h = hashlib.sha256(json.dumps(cfg, sort_keys=True).encode())
        roles = ROLES + ("postgres",)
        nodes = self.nodes(roles)
        names = sorted({m["Name"] for node in nodes for m in node["Mounts"] if m["Type"] == "volume"})
        for name in names:
            self.inspect("volume", name)
        for role, actual in zip(roles, nodes):
            spec = services[role]
            actual_env = dict(x.split("=", 1) for x in actual["Config"]["Env"])
            need(all(actual_env.get(k) == str(v) for k, v in spec.get("environment", {}).items()))
            if role == "api" and actual["State"]["Running"]:
                need(
                    int(self.run(["docker", "exec", actual["Id"], "id", "-u"]))
                    == json.loads(exact(ETC / "source.json").read_text())["command_uid"]
                )
            actual_mounts = {m["Destination"]: m for m in actual["Mounts"]}
            for m in spec.get("volumes", []):
                if m["type"] == "volume":
                    name = cfg["volumes"][m["source"]]["name"]
                    need(actual_mounts[m["target"]]["Name"] == name)
                    info = self.inspect("volume", name)
                    need(
                        info["Driver"] == "local"
                        and not info["Options"]
                        and info["Labels"]["com.docker.compose.project"] == self.project
                    )
                    h.update(name.encode())
        h.update(self.ctr("postgres").encode())
        for p in self.config_paths():
            blob = exact(p).read_bytes()
            h.update(hashlib.sha256(blob).digest())
        return h.hexdigest()

    def live(self, r, expect_running=True, roles=ROLES):
        for role, x in zip(roles, self.nodes(roles)):
            label = x["Config"]["Labels"]
            need(
                label["com.docker.compose.project"] == self.project
                and label["com.docker.compose.service"] == role
            )
            need(not x["HostConfig"]["Privileged"] and not x["HostConfig"].get("CapAdd"))
            need(
                x["Image"] == self.image(role, r)
                and (expect_running is None or x["State"]["Running"] == expect_running)
                and (expect_running is None or not x["State"]["OOMKilled"])
            )
            wanted = (
                DATA
                if role == "import-worker"
                else DATA | {"/run/chat-reader-updater"}
                if role == "api"
                else set()
            )
            mounts = {m["Destination"]: m for m in x["Mounts"]}
            need(set(mounts) - ({"/tmp"} if PROFILE.is_file() else set()) == wanted)
            for dest, m in mounts.items():
                if dest == "/tmp":
                    need(
                        m["Type"] == "bind"
                        and m["Source"] == str(SCRATCH / role)
                        and m["RW"]
                        and m["Propagation"] == "rprivate"
                    )
                elif dest in DATA:
                    need(m["Type"] == "volume" and m["RW"])
                else:
                    need(m["Type"] == "bind" and m["Source"] == dest and not m["RW"])
            if role in ("api", "web"):
                need(
                    all(
                        p["HostIp"] == "127.0.0.1"
                        for ps in (x["HostConfig"].get("PortBindings") or {}).values()
                        for p in ps
                    )
                )
            base = self.inspect("image", x["Image"])["Config"]
            if PROFILE.is_file():
                need(self.stock_runtime(x["Config"], base))
            need(
                x["Config"].get("User") == base.get("User")
                and x["Config"].get("Entrypoint") == base.get("Entrypoint")
            )
            expected = (
                ["python", "-m", "app.workers.import_worker"] if role == "import-worker" else base["Cmd"]
            )
            need(x["Config"]["Cmd"] == expected)
            # The image label alone cannot detect `docker exec` edits in the
            # writable layer. Never bless a patched core as a stock installation.
            self.check_core(x)

    @staticmethod
    def stock_runtime(actual, base):
        # Read-only roots don't protect programs explicitly loaded from writable
        # data/scratch via an operator's custom loader or working directory.
        def loading(cfg):
            env = dict(s.split("=", 1) for s in cfg.get("Env", []))
            return {
                k: v
                for k, v in env.items()
                if k.startswith(("LD_", "DYLD_", "PYTHON", "UVICORN_", "GUNICORN_"))
                or k in ("PATH", "NODE_OPTIONS", "NODE_PATH", "BASH_ENV", "ENV", "TMPDIR", "TMP", "TEMP")
            }

        return actual.get("WorkingDir") == base.get("WorkingDir") and loading(actual) == loading(base)

    def check_core(self, node):
        if not PROFILE.is_file():
            return self.unpatched(node["Id"])
        hc = node["HostConfig"]
        need(
            hc["ReadonlyRootfs"]
            and not hc["Privileged"]
            and not hc.get("CapAdd")
            and not hc.get("Devices")
            and not hc.get("VolumesFrom")
            and hc.get("PidMode") in ("", None)
            and hc.get("IpcMode") in ("", None, "private")
            and "ALL" in (hc.get("CapDrop") or [])
            and any(x in ("no-new-privileges:true", "no-new-privileges") for x in hc.get("SecurityOpt") or [])
            and not hc.get("Tmpfs")
        )
        role = node["Config"]["Labels"]["com.docker.compose.service"]
        need(role in ROLES)
        mount = next((m for m in node["Mounts"] if m["Destination"] == "/tmp"), {})
        need(
            mount.get("Type") == "bind"
            and mount.get("Source") == str(SCRATCH / role)
            and mount.get("RW")
            and mount.get("Propagation") == "rprivate"
        )
        self.scratch_safe(role)
        need(all(m["Destination"] in DATA | {"/run/chat-reader-updater", "/tmp"} for m in node["Mounts"]))

    def scratch_safe(self, role):
        root = exact(SCRATCH, "dir").stat()
        sub = exact(SCRATCH / role, "dir").stat()
        need(
            root.st_uid == sub.st_uid == 0
            and root.st_mode & 0o777 == 0o700
            and sub.st_mode & 0o7777 == 0o1777
        )
        lines = [r.split() for r in Path("/proc/self/mountinfo").read_text().splitlines()]
        mounts = [r for r in lines if r[4] == str(SCRATCH)]
        need(
            len(mounts) == 1
            and {"noexec", "nosuid", "nodev", "rw"} <= set(mounts[0][5].split(","))
            and not any(r[4].startswith(str(SCRATCH) + "/") for r in lines)
        )

    def unpatched(self, cid):
        need(re.fullmatch("[a-f0-9]{64}", cid))
        for change in docker_read("containers/" + cid + "/changes") or []:
            dest = change["Path"]
            need(
                not any(
                    dest == p or dest.startswith(p + "/")
                    for p in ("/app", "/usr", "/etc", "/lib", "/bin", "/opt", "/sbin")
                )
            )

    def exclusive(self):
        """Reject unaccounted writers rather than claiming their files were frozen."""
        roles = {self.ctr(k) for k in ROLES + ("postgres",)}
        volumes = set()
        ips = set()
        running = [c["Id"] for c in docker_read("containers/json")]
        ctrs = [self.inspect("container", cid) for cid in set(running) | roles]
        for c in ctrs:
            if c["Id"] not in roles:
                continue
            volumes.update(m["Name"] for m in c["Mounts"] if m["Type"] == "volume")
            for net in c["NetworkSettings"]["Networks"].values():
                for key in ("IPAddress", "GlobalIPv6Address"):
                    if net.get(key):
                        ips.add(str(ipaddress.ip_address(net[key])))
        for c in ctrs:
            if c["Id"] in roles:
                continue
            need(not any(m.get("Name") in volumes and m["RW"] for m in c["Mounts"]))
        actual = self.sql(
            "SELECT DISTINCT host(client_addr) FROM pg_stat_activity WHERE datname=current_database() AND client_addr IS NOT NULL"
        )
        need(all(addr in ips for addr in actual.splitlines()))

    def pointertext(self, r):
        i = self.images(r)
        text = "RELEASE_SHA={}\nAPI_IMAGE={}\nWEB_IMAGE={}\n".format(
            r["revision"], i["API_IMAGE"], i["WEB_IMAGE"]
        )
        if i["WORKER_IMAGE"] != i["API_IMAGE"]:
            text += "WORKER_IMAGE=" + i["WORKER_IMAGE"] + "\n"
        return text

    def pointer_matches(self, r):
        pairs = dict(
            line.split("=", 1)
            for line in exact(self.pointer / "current-images.env").read_text().splitlines()
            if line and not line.startswith("#")
        )
        need(pairs == dict(line.split("=", 1) for line in self.pointertext(r).splitlines()))

    def probe(self, path, code, build=None):
        # No redirects: a login redirect is not a successful health verification.
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *_):
                return None

        try:
            req = urllib.request.Request(self.origin + path, headers={"Cache-Control": "no-cache, no-store"})
            with urllib.request.build_opener(NoRedirect).open(req, timeout=6) as r:
                return r.status == code and (build is None or r.headers.get("X-Chat-Reader-Build") == build)
        except urllib.error.HTTPError as e:
            return e.code == code and build is None
        except OSError:
            return False

    def gate_owned(self):
        return GATE.is_file() and GATE.read_text() == self.dir.name

    def config_paths(self, base_only=False):
        return (
            [
                self.compose,
                self.envfile,
                ETC / "host.json",
                ETC / "source.json",
                LIB / "api-socket.yml",
            ]
            + self.nginx
            + ([PROFILE, LIB / "program-profile.yml"] if PROFILE.is_file() and not base_only else [])
        )

    def file_seal(self, base_only=False):
        h = hashlib.sha256()
        for p in self.config_paths(base_only):
            h.update(hashlib.sha256(exact(p).read_bytes()).digest())
        return h.hexdigest()

    def running_receipt(self, r, externally_ready=()):
        roles = ROLES + ("postgres",)
        nodes = self.nodes(roles)
        result = []
        for role, n in zip(roles, nodes):
            s = n["State"]
            need(s["Running"] and not s["OOMKilled"] and not s["Restarting"])
            if role != "import-worker":
                status = s["Health"]["Status"]
                need(status == "healthy" or (role in externally_ready and status == "starting"))
            if role != "postgres":
                need(n["Image"] in self.role_image(role, r)[1]["engine_ids"])
            result.append([n["Id"], n["Image"], s["StartedAt"], n["RestartCount"]])
        return {"roles": result, "config": self.file_seal(), "schema": self.schema()}

    def writers(self):
        # Includes committed tuples/deletes on all business tables, even changes
        # which preserve row count. The worker's own heartbeat is the only exemption.
        return self.sql(
            "SELECT relid||':'||n_tup_ins||':'||n_tup_upd||':'||n_tup_del FROM pg_stat_user_tables "
            "WHERE schemaname='public' AND relname<>'worker_runtime_states' ORDER BY relid"
        )

    def reopen(self):
        if GATE.exists():
            need(self.gate_owned())
            GATE.unlink()
        if not (self.probe("/api/admin/runtime-status", 401) and self.probe("/login", 200)):
            durable(GATE, self.dir.name, 0o640)
            raise ValueError("ingress not healthy")

    def health(self, r):
        self.live(r)
        need(self.schema() == r["schema"])
        for role in ("postgres", "web", "api"):
            poll(lambda: self.inspect("container", self.ctr(role))["State"]["Health"]["Status"] == "healthy")
        since = self.inspect("container", self.ctr("import-worker"))["State"]["StartedAt"]
        need(re.fullmatch(r"[0-9TZ.:\-]+", since))
        poll(
            lambda: (
                self.sql(
                    "SELECT EXISTS(SELECT 1 FROM worker_runtime_states WHERE worker_key='primary' AND "
                    "heartbeat_at >= '{}'::timestamptz AND heartbeat_at>now()-interval '90 seconds')".format(
                        since
                    )
                )
                == "t"
            )
        )
        need(self.probe("/api/health", 200) and self.probe("/__updates/status", 404))
        need(
            self.run(
                [
                    "docker",
                    "exec",
                    self.ctr("api"),
                    "python",
                    "-c",
                    "import urllib.request,urllib.error\ntry: urllib.request.urlopen('http://127.0.0.1:8000/api/admin/runtime-status')\nexcept urllib.error.HTTPError as e: print(e.code)",
                ]
            )
            == "401"
        )

    def up(self, r):
        self.dc(
            "up",
            "--no-start",
            "--no-deps",
            "--no-build",
            "--pull",
            "never",
            *ROLES,
            env=self.images(r),
        )
        self.refs.clear()
        self.run(["docker", "start"] + [self.ctr(k) for k in ROLES])

    def stopped(self):
        need(all(not x["State"]["Running"] for x in self.nodes(ROLES)))

    def admission_for_restart(self):
        f = self.dir
        old = self.old
        for role in ROLES:
            self.image(role, self.new)
        if not (f / "staging-job").exists():
            self.do("admit")
            return
        stage = exact(f / "staging-job").read_text()
        need(re.fullmatch("[0-9a-f]{32}", stage))
        prior = json.loads(exact(JOBS / stage / "incumbent").read_text())
        # Config/HostConfig and mounts are immutable for an existing container.
        # Check all mutable inputs again, including its writable layer.
        need(not GATE.exists() and self.running_receipt(old) == prior and prior["schema"] == old["schema"])
        self.pointer_matches(old)
        self.exclusive()
        for role, record in zip(ROLES, prior["roles"]):
            need(self.image(role, old) == record[1])
            self.check_core(self.inspect("container", record[0]))
        need(self.probe("/api/health", 200) and self.probe("/api/admin/runtime-status", 401))
        durable(f / "incumbent", json.dumps(prior, sort_keys=True))

    def recovery_stamp(self, verify=False):
        # Only root installs this proof, after an isolated physical restore.
        receipt = exact(ETC / "program-recovery.json")

        def trusted(p):
            s = p.lstat()
            need(s.st_uid == 0 and not s.st_mode & 0o022)
            return [s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns]

        trusted(receipt)
        need(receipt.stat().st_size < 4096)
        proof = json.loads(receipt.read_text())
        relative = proof["backup"]
        need(re.fullmatch(r"(?:update-[0-9a-f]{32}/)?chat-reader-[0-9]{8}T[0-9]{6}Z", relative))
        directory = exact(self.backups / relative, "dir")
        for parent in (self.backups, directory.parent, directory):
            trusted(parent)
        members = {
            "MANIFEST",
            "SHA256SUMS",
            "postgres.dump",
            "postgres.toc",
            "imports.tar.gz",
            "exports.tar.gz",
            "offline.tar.gz",
            "assets.tar.gz",
        }
        need({p.name for p in directory.iterdir()} == members)
        seals = {n: trusted(exact(directory / n)) for n in members}
        need(
            proof["format"] == 1
            and proof["repository_id"] == self.old["repository_id"]
            and proof["repository"] == self.old["repository"]
            and proof["schema"] == self.old["schema"]
            and proof["restored"] == ["postgres", "imports", "exports", "offline", "assets"]
        )
        for n, key in (("MANIFEST", "manifest_sha256"), ("SHA256SUMS", "sums_sha256")):
            p = directory / n
            need(p.stat().st_size <= 16384 and hashlib.sha256(p.read_bytes()).hexdigest() == proof[key])
        stamp = directory.name[len("chat-reader-") :]
        stamp_iso = datetime.datetime.strptime(stamp, "%Y%m%dT%H%M%SZ").strftime("%Y-%m-%dT%H:%M:%SZ")
        need("created_at=" + stamp in (directory / "MANIFEST").read_text().splitlines())
        result = {
            "files": seals,
            "proof": hashlib.sha256(receipt.read_bytes()).hexdigest(),
            "at": stamp_iso,
        }
        if verify:
            self.run(
                ["sh", LIB / "verify_backup.sh", directory],
                env={"POSTGRES_IMAGE": self.inspect("container", self.ctr("postgres"))["Image"]},
                quiet=True,
                timeout=7200,
            )
            need(self.recovery_stamp() == result)
        return result

    def register_recovery(self):
        checked = self.recovery_stamp(verify=True)
        durable(
            JOBS.parent / "program-recovery-seal.json",
            json.dumps({"at": int(time.time()), "stamp": checked}, sort_keys=True),
        )

    def known_recovery(self):
        # The root-owned seal follows a full physical restore and independent
        # local read. Refuse on replacement, metadata change or stale scrub.
        # Never reread several GiB merely because someone opened the panel.
        p = exact(JOBS.parent / "program-recovery-seal.json")
        st = p.stat()
        need(st.st_uid == 0 and not st.st_mode & 0o077 and st.st_size < 16384)
        record = json.loads(p.read_text())
        need(0 <= int(time.time()) - record["at"] <= 7 * 86400)
        actual = self.recovery_stamp()
        need(actual == record["stamp"])
        return actual

    def program_budget(self, load_bytes=0):
        # Account per actual filesystem. No new DB/volume archive is created.
        journal = self.dir
        docker = exact(docker_read("info")["DockerRootDir"], "dir")
        budget = {}
        for path, amount in (
            (journal, 128 << 20),
            (docker, (512 << 20) + load_bytes),
        ):
            dev = path.stat().st_dev
            budget[dev] = budget.get(dev, 0) + amount
        for path in (journal, docker):
            need(shutil.disk_usage(str(path)).free >= budget[path.stat().st_dev])

    def program_public(self, target):
        for role, path in (("web", "/login"), ("api", "/api/health")):
            rev, _ = self.role_image(role, target)
            marker = hashlib.sha256(("reader:" + role + ":" + rev).encode()).hexdigest()
            need(self.probe(path, 200, marker))
        need(self.probe("/api/admin/runtime-status", 401) and self.probe("/__updates/status", 404))

    def program_ready(self, target, changed):
        # The image healthcheck runs on a timer. An actual HTTPS response from
        # this exact build is better than waiting for its first scheduled tick.
        def ready():
            try:
                self.program_public(target)
                return True
            except ValueError:
                return False

        self.live(target)
        poll(ready, 60)
        receipt = self.running_receipt(target, changed)
        need(receipt["schema"] == target["schema"])
        started = receipt["roles"][ROLES.index("import-worker")][2]
        need(re.fullmatch(r"[0-9TZ.:\-]+", started))
        need(
            self.sql(
                "SELECT EXISTS(SELECT 1 FROM worker_runtime_states WHERE worker_key='primary' AND "
                "heartbeat_at >= '{}'::timestamptz AND heartbeat_at>now()-interval '90 seconds')".format(
                    started
                )
            )
            == "t"
        )
        return receipt

    def program_op(self, op):
        j = json.loads(exact(self.dir / "program.json").read_text())
        roles = j["Plan"]["roles"]
        need(roles in (["api"], ["web"], ["api", "web"]) and PROFILE.is_file() and not GATE.exists())
        stage = exact(self.dir / "staging-job").read_text()
        need(id_valid(stage) and stage == j["Stage"])
        source = exact(JOBS / stage, "dir")
        saved = json.loads(exact(source / "recovery.json").read_text())
        plan = json.loads(exact(source / "plan.json").read_text())
        need(plan == j["Plan"] and plan["mode"] == "program" and plan["recovery_at"] == saved["at"])
        need(
            self.known_recovery() == saved
            and all(self.old[k] == self.new[k] for k in ("schema", "provider_abi", "job_abi"))
        )
        if op == "program-preflight":
            self.pointer_matches(self.old)
            self.program_budget()
            need(self.fingerprint() == self.fp)
            self.exclusive()
            baseline = self.program_ready(self.old, roles)
            if not j["Rollback"]:
                need(baseline == json.loads(exact(source / "incumbent").read_text()))
            for r in (self.old, self.new):
                for k in ROLES:
                    self.image(k, r)
            for k in set(ROLES) - set(roles):
                need(self.role_image(k, self.old) == self.role_image(k, self.new))
            durable(
                self.dir / "program-baseline",
                json.dumps({"live": baseline, "mounts": self.protected()}),
            )
            return
        receipt = json.loads(exact(self.dir / "program-baseline").read_text())
        need(
            receipt["live"]["config"] == self.file_seal()
            and self.schema() == self.old["schema"]
            and self.protected() == receipt["mounts"]
        )
        for k, before in zip(ROLES + ("postgres",), receipt["live"]["roles"]):
            if k not in roles:
                n = self.inspect("container", self.ctr(k))
                need(
                    [n["Id"], n["Image"], n["State"]["StartedAt"], n["RestartCount"]] == before
                    and n["State"]["Running"]
                )
        if op != "program-committed":
            self.pointer_matches(self.old)
        if op in ("program-switch", "program-restore"):
            target = self.old if op == "program-restore" else self.new
            if op == "program-switch":
                need(self.running_receipt(self.old, roles) == receipt["live"])
            # Do not overwrite a third image or a foreign container after a crash.
            for k in roles:
                x = self.inspect("container", self.ctr(k))
                candidate = self.old if x["Image"] == self.image(k, self.old) else self.new
                # Even on recovery, never replace an unrelated mount, command,
                # privileged container or program that merely uses the same tag.
                self.live(candidate, None, (k,))
            if op == "program-restore":
                need(self.fingerprint() == self.fp)
                if not (self.dir / "program-mutating").exists():
                    self.program_ready(self.old, roles)
                    return
            else:
                durable(self.dir / "program-mutating", "1")
            # Do not let Compose's default timeout SIGKILL a live upload or transaction.
            # No timeout on the Docker daemon's stop operation; no worker drain/fence.
            self.run(
                ["docker", "stop", "-t", "-1"] + [self.ctr(k) for k in roles],
                timeout=6900,
            )
            self.dc(
                "up",
                "-d",
                "--no-deps",
                "--no-build",
                "--pull",
                "never",
                *roles,
                env=self.images(target),
            )
            self.refs.clear()
            if op == "program-restore":
                self.program_ready(target, roles)
            return
        if op in ("program-health", "program-committed"):
            if op == "program-committed":
                self.pointer_matches(self.new)
            health = self.program_ready(self.new, roles)
            need(self.fingerprint() == self.fp)
            durable(self.dir / "program-healthy", json.dumps(health))
        elif op == "program-commit":
            need(
                self.running_receipt(self.new, roles)
                == json.loads(exact(self.dir / "program-healthy").read_text())
            )
            self.program_public(self.new)
            durable(self.pointer / "rollback-images.env", self.pointertext(self.old))
            durable(self.pointer / "current-images.env", self.pointertext(self.new))
        else:
            raise ValueError("unknown program operation")

    def do(self, op):
        if op == "refresh-recovery":
            need(PROFILE.is_file() and not GATE.exists() and self.fingerprint() == self.fp)
            self.pointer_matches(self.old)
            self.live(self.old)
            self.register_recovery()
            return self.fp
        if op in ("audit-hardening", "enroll-hardening"):
            audit = JOBS.parent / "hardening-audit.json"
            need(not GATE.exists() and not self.old.get("installed_roles"))
            self.pointer_matches(self.old)
            self.exclusive()
            self.health(self.old)
            self.program_public(self.old)
            seal = {
                "base": self.file_seal(base_only=True),
                "revision": self.old["revision"],
                "mounts": self.protected(),
                "schema": self.schema(),
                "postgres": self.ctr("postgres"),
                "profile": hashlib.sha256(exact(LIB / "program-profile.yml").read_bytes()).hexdigest(),
                "fingerprint": self.fp,
            }
            if op == "audit-hardening":
                need(not PROFILE.exists() and self.fingerprint() == self.fp)
                durable(audit, json.dumps(seal, sort_keys=True))
            else:
                need(PROFILE.is_file() and json.loads(exact(audit).read_text()) == seal)
                # Even newly read-only roots must undergo a full /changes audit
                # once, not merely be blessed on the strength of a Docker label.
                for k in ROLES:
                    self.unpatched(self.ctr(k))
                self.register_recovery()
                return self.fingerprint()
            return
        if op.startswith("program-"):
            return self.program_op(op)
        if op == "classify-program":
            if not PROFILE.is_file():
                return json.dumps({"mode": "full", "reason": "mutable_host"})
            self.program_public(self.old)
            proof = self.known_recovery()
            durable(self.dir / "recovery.json", json.dumps(proof))
            return json.dumps(
                {
                    "mode": "program",
                    "roles": self.new["transition"]["roles"],
                    "recovery_at": proof["at"],
                }
            )
        if op in ("enroll", "admit"):
            need(not GATE.exists())
            self.pointer_matches(self.old)
            fp = self.fingerprint()
            self.protected()
            if op == "enroll":
                self.live(self.old)
                if PROFILE.is_file():
                    for role in ROLES:
                        self.unpatched(self.ctr(role))
                    self.register_recovery()
                need(self.schema() == self.old["schema"])
                return fp
            need(fp == self.fp)
            self.exclusive()
            self.health(self.old)
            need(self.probe("/api/admin/runtime-status", 401))
            durable(
                self.dir / "incumbent",
                json.dumps(self.running_receipt(self.old), sort_keys=True),
            )
            return
        f = self.dir
        old, new = self.old, self.new
        if op == "space":
            need(shutil.disk_usage(str(f)).free >= new["archive_bytes"] + (128 << 20))
        elif op == "stage":
            archive = exact(f / "chat-reader-images.tar.gz")
            plan = json.loads(exact(f / "plan.json").read_text())
            fast = plan["mode"] == "program"
            held = (
                [self.inspect("image", self.image(k, old))["RootFS"]["Layers"] for k in ROLES] if fast else ()
            )
            expanded = archive_admission(archive, new, fast, held)
            if fast:
                need(PROFILE.is_file() and exact(f / "recovery.json"))
                self.program_budget(expanded)
            else:
                self.run(
                    ["sh", LIB / "preflight_release_space.sh", archive],
                    env={"UPDATER_VERIFIED_EXPANDED_BYTES": str(expanded)},
                    timeout=3600,
                    quiet=True,
                )
            self.run(["docker", "load", "-i", archive], timeout=3600, quiet=True)
            for role in ROLES:
                self.image(role, new)
            need(
                self.run(
                    [
                        "docker",
                        "run",
                        "--rm",
                        "--pull=never",
                        "--network=none",
                        "--read-only",
                        "--cap-drop=ALL",
                        "--security-opt=no-new-privileges",
                        "--entrypoint",
                        "alembic",
                        self.images(new)["API_IMAGE"],
                        "heads",
                    ]
                )
                == new["schema"] + " (head)"
            )
        elif op == "restart-preflight":
            with ThreadPoolExecutor(max_workers=1) as pool:
                budget = pool.submit(
                    self.run,
                    ["sh", LIB / "preflight_release_space.sh", "--retained-images"],
                    timeout=1800,
                    quiet=True,
                )
                self.admission_for_restart()
                budget.result()
        elif op == "fencing":
            need(not GATE.exists())
            durable(GATE, f.name, 0o640)
            need(
                self.probe("/api/auth/session", 503)
                and self.probe("/api/imports/preview", 503)
                and self.probe("/__updates/status", 404)
            )
        elif op == "draining":
            need(self.gate_owned())
            poll(self.idle, 180)
            # -1 waits indefinitely rather than killing an active transaction on timeout.
            self.run(
                ["docker", "stop", "-t", "-1"] + [self.ctr(k) for k in ROLES],
                timeout=300,
            )
            self.stopped()
            need(self.idle())
        elif op == "backup":
            self.stopped()
            self.exclusive()
            need(self.gate_owned())
            dest = f / "backup"
            dest.mkdir(mode=0o700)
            env = {
                "BACKUP_DIR": str(self.backups),
                "POSTGRES_IMAGE": self.inspect("container", self.ctr("postgres"))["Image"],
            }
            # Keep immutable, per-job backups on the operator's designated backup filesystem.
            sub = self.backups / ("update-" + f.name)
            sub.mkdir(mode=0o700)
            env["BACKUP_DIR"] = str(sub)
            self.run(["sh", LIB / "backup.sh"], env=env, timeout=7200, quiet=True)
            saved = list(sub.glob("chat-reader-*"))
            need(len(saved) == 1)
            # Batch backup publishes only after the independent disk reader
            # and pg_restore verifier have both succeeded.
            exact(saved[0], "dir")
            durable(
                dest / "receipt",
                json.dumps(
                    {
                        "directory": saved[0].name,
                        "manifest": hashlib.sha256((saved[0] / "MANIFEST").read_bytes()).hexdigest(),
                        "mounts": self.protected(),
                    },
                    sort_keys=True,
                ),
            )
        elif op == "migration":
            self.stopped()
            need(self.gate_owned() and exact(f / "backup" / "receipt") and self.schema() == old["schema"])
            if new["schema"] != old["schema"]:
                need(re.fullmatch(r"[0-9]{8}_[0-9]{4}", new["schema"]))
                # A partially committed migration must never trigger automatic image rollback.
                durable(f / "schema-attempted", new["schema"])
                self.dc(
                    "run",
                    "--rm",
                    "--no-deps",
                    "--pull",
                    "never",
                    "-T",
                    "--entrypoint",
                    "alembic",
                    "migrate",
                    "upgrade",
                    new["schema"],
                    env=self.images(new),
                    timeout=3600,
                )
            need(self.schema() == new["schema"])
        elif op == "switching":
            incumbent = json.loads(exact(f / "incumbent").read_text())
            self.stopped()
            need(
                self.gate_owned()
                and self.file_seal() == incumbent["config"]
                and [self.ctr(k) for k in ROLES + ("postgres",)]
                == [record[0] for record in incumbent["roles"]]
                and self.schema() == new["schema"]
            )
            for role in ROLES:
                self.image(role, new)
            durable(f / "writers", self.writers())
            durable(f / "candidate-started", new["revision"])
            self.up(new)
        elif op == "health":
            need(self.gate_owned())

            def validate_layout():
                other = self.inventory()
                need(
                    other.protected() == json.loads(exact(f / "backup" / "receipt").read_text())["mounts"]
                    and other.fingerprint() == self.fp
                )

            with ThreadPoolExecutor(max_workers=1) as pool:
                layout = pool.submit(validate_layout)
                self.health(new)
                layout.result()
            need(self.writers() == exact(f / "writers").read_text())
            durable(
                f / "health-receipt",
                json.dumps(self.running_receipt(new), sort_keys=True),
            )
        elif op == "commit":
            need(
                self.gate_owned()
                and self.running_receipt(new) == json.loads(exact(f / "health-receipt").read_text())
                and self.writers() == exact(f / "writers").read_text()
            )
            self.pointer_matches(old)
            durable(self.pointer / "rollback-images.env", self.pointertext(old))
            durable(self.pointer / "current-images.env", self.pointertext(new))
        elif op in ("unfence", "reconcile-committed"):
            self.pointer_matches(new)
            need(self.running_receipt(new) == json.loads(exact(f / "health-receipt").read_text()))
            if GATE.exists():
                need(self.writers() == exact(f / "writers").read_text())
            if op == "reconcile-committed":
                need(self.fingerprint() == self.fp)
                self.health(new)
            self.reopen()
        elif op == "restore-old":
            need(
                not (f / "schema-attempted").exists()
                and self.schema() == old["schema"]
                and self.fingerprint() == self.fp
            )
            self.pointer_matches(old)
            if GATE.exists():
                need(self.gate_owned())
            # Start the exact original containers, never recreate based on an uncertain pointer.
            if (f / "candidate-started").exists():
                need(
                    self.gate_owned()
                    and (f / "backup" / "receipt").is_file()
                    and all(old[k] == new[k] for k in ("schema", "provider_abi", "job_abi"))
                )
                # Accept no third image, no outstanding writer, and no schema downgrade.
                for role in ROLES:
                    need(
                        self.inspect("container", self.ctr(role))["Image"]
                        in (self.image(role, old), self.image(role, new))
                    )
                need(
                    self.sql(
                        "SELECT NOT EXISTS(SELECT 1 FROM background_jobs WHERE status IN ('queued','processing','cancelling')) AND NOT EXISTS(SELECT 1 FROM imports WHERE status IN ('queued','processing','cancelling'))"
                    )
                    == "t"
                )
                self.dc("stop", "-t", "-1", *ROLES, timeout=300)
                self.stopped()
                self.exclusive()
                need(self.writers() == exact(f / "writers").read_text())
                self.unchanged_files()
                self.up(old)
            else:
                for role in ROLES:
                    need(self.inspect("container", self.ctr(role))["Image"] == self.image(role, old))
                self.dc("start", *ROLES)
            self.health(old)
            self.reopen()
        else:
            raise ValueError("unknown operation")

    def unchanged_files(self):
        receipt = json.loads(exact(self.dir / "backup" / "receipt").read_text())
        saved = exact(self.backups / ("update-" + self.dir.name) / receipt["directory"], "dir")
        need(
            self.protected() == receipt["mounts"]
            and hashlib.sha256(exact(saved / "MANIFEST").read_bytes()).hexdigest() == receipt["manifest"]
        )
        # Only on exceptional recovery: compare full stopped-volume tar streams
        # from the same pinned reader (including extra files), not just timestamps.
        for name in sorted(DATA):
            component = name.rsplit("/", 1)[1]
            checksum = next(
                line.split()[0]
                for line in exact(saved / "SHA256SUMS").read_text().splitlines()
                if line.split()[-1] == component + ".tar.gz"
            )
            cmd = [
                "docker",
                "run",
                "--rm",
                "--pull=never",
                "--network=none",
                "--read-only",
                "--cap-drop=ALL",
                "--security-opt=no-new-privileges",
                "--volumes-from",
                self.ctr("api") + ":ro",
                "--entrypoint",
                "sh",
                self.image("api", self.old),
                "-c",
                'exec tar -C "$1" -czf - .',
                "sh",
                name,
            ]
            h = hashlib.sha256()
            with subprocess.Popen(
                cmd,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                env=self.env,
            ) as proc:
                for chunk in iter(lambda: proc.stdout.read(1024 * 1024), b""):
                    h.update(chunk)
                need(proc.wait() == 0 and h.hexdigest() == checksum)


if __name__ == "__main__":
    try:
        import fcntl  # Linux-only shipping adapter. Serialize surviving child operations after a daemon crash.

        operation = sys.argv[1]
        req = json.load(sys.stdin)
        with (JOBS.parent / "adapter.lock").open("a") as lock:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
            result = Host(
                req, operation in ("enroll", "audit-hardening", "enroll-hardening", "refresh-recovery")
            ).do(operation)
        if result:
            print(result)
    except Exception:
        sys.exit(1)
