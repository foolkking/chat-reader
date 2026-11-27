"""Fresh G4 PG/API/640-MiB worker, synthetic real-package HTTP, never production.

python -B scripts/extension-beta/append-backend-gate.py --parent APPROVED_TEMP --fork LOCAL_EXPORTER
The existing inspected G1 harness supplies isolation/cleanup, not prior acceptance.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import sys
import time
import uuid

spec = importlib.util.spec_from_file_location("g1_backend_gate", Path(__file__).with_name("backend-gate.py"))
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)


class Gate(base.Gate):
    def snapshot(self):
        super().snapshot()
        base.require("apps/api/app/services/adaptive_import/append_scratch.py" in self.hashes,
                     "append-snapshot-dependency-missing")
        inputs = [
            "scripts/extension-beta/append-backend-gate.py", "scripts/extension-beta/append-package.cjs",
            "apps/api/tests/test_selective_append_postgres.py", "apps/api/tests/test_append_ranges_postgres.py",
            "apps/api/tests/test_append_selection_ranges.py", "apps/web/lib/append-selection.ts",
            "apps/web/features/import/append-import-workspace.tsx", "apps/web/lib/api.ts",
        ]
        self.report["g4_inputs"] = {name: base.sha((base.REPO / name).read_bytes()) for name in inputs}

    def pg_tests(self):
        tests = ["apps/api/tests/test_selective_append_postgres.py", "apps/api/tests/test_append_ranges_postgres.py",
                 "apps/api/tests/test_append_selection_ranges.py"]
        env = {**self.env, "APP_ENV": "test", "SETTINGS_POSTGRES_INTEGRATION": "1",
               "DATABASE_URL": f"postgresql+psycopg://postgres:{self.pg_password}@127.0.0.1:{self.pg_port}/{self.database}?connect_timeout=5",
               "IMPORT_STORAGE_DIR": str(self.root / "pg-unit-imports")}
        command = [sys.executable, "-B", "-m", "pytest", *tests, "-q", "--tb=short", "--show-capture=no",
                   "--basetemp=" + str(self.root / "pg-pytest"), "-o", "cache_dir=" + str(self.root / "pg-cache")]
        self.report["postgres_command"] = command
        self.command(command, env=env, timeout=1800, log="postgres-tests.log")
        self.step("g4-postgres-regressions", exit_code=0)

    def status(self, iid, terminal):
        deadline = time.monotonic() + 480
        while True:
            state = self.request(self.web, "GET", f"/api/append-imports/{iid}").json()
            if state["status"] == terminal:
                return state
            base.require(state["status"] != "failed", "append-worker-failed")
            base.require(time.monotonic() < deadline, "append-timeout")
            time.sleep(0.3)

    def staged(self, cid, raw):
        result = self.request(self.web, "POST", f"/api/conversations/{cid}/append-imports", expected=201,
                              files={"files": ("synthetic-range.zip", raw, "application/zip")},
                              headers={"Idempotency-Key": str(uuid.uuid4())}).json()
        iid = result["id"]
        state = self.status(iid, "previewed")
        return iid, {"target": cid, "edition": state["edition"], "volume": 0,
                     "ranges": [[0, self.expected["count"]]], "selected_count": self.expected["count"]}

    def canonical_rows(self, cid):
        # /messages is a paged compatibility read (default 50, max 200).
        rows = []
        while True:
            page = self.request(self.web, "GET", f"/api/conversations/{cid}/messages",
                params={"include_blocks": "false", "limit": 200, "offset": len(rows)}).json()
            rows.extend(page)
            if len(page) < 200:
                return rows

    def http_gate(self):
        self.command(["node", base.REPO / "scripts/extension-beta/append-package.cjs", self.fork, self.root / "ranged-package"],
                     log="ranged-package.log")
        self.expected = json.loads((self.root / "ranged-package/expected.json").read_bytes())
        self.report["range_writer"] = {k: self.expected[k] for k in ("count", "zip_sha256", "source_hashes", "scope")}
        raw = (self.root / "ranged-package/range-1001.zip").read_bytes()
        base.require(base.sha(raw) == self.expected["zip_sha256"], "ranged-fixture-hash")
        capabilities = self.request(self.device_client, "GET", "/api/extension/v1/capabilities").json()
        base.require(capabilities["selective_append_ranges"] is True, "missing-range-capability")
        cid = self.request(self.web, "POST", "/api/conversations", expected=201, json={
            "title": "Synthetic HTTP append target", "messages": [
                {"role": "user", "content_markdown": "Synthetic existing question"},
                {"role": "assistant", "content_markdown": "Synthetic original end"}]}).json()["conversation"]["id"]
        iid, chosen = self.staged(cid, raw)
        path = f"/api/append-imports/{iid}"
        state = self.request(self.web, "GET", path).json()
        base.require(state["sources"][0]["count"] == self.expected["count"], "range-source-count")
        page = self.request(self.web, "GET", path + "/choices",
                            params={"edition": chosen["edition"], "volume": 0, "page": 25}).json()
        base.require([row["index"] for row in page["items"]] == [1000], "range-last-page")
        legacy = {k: chosen[k] for k in ("target", "edition", "volume")}
        self.request(self.web, "POST", path + "/review", expected=422, json={**legacy, "indexes": list(range(251))})
        self.request(self.web, "POST", path + "/review", json={**legacy, "indexes": list(range(250))})
        reviewed = self.request(self.web, "POST", path + "/review", json=chosen).json()
        base.require((reviewed["add"], reviewed["skip"]) == (1001, 0), "range-review-counts")
        approved = {**chosen, "receipt": reviewed["receipt"]}
        self.request(self.web, "POST", path + "/confirm", expected=202, json=approved)
        self.request(self.web, "POST", path + "/confirm", expected=(200, 202), json=approved)
        done = self.status(iid, "committed")
        base.require(done["result"] == {"target": cid, "added": 1001, "skipped": 0, "partial": False}, "range-result")
        rows = self.canonical_rows(cid)
        base.require(len(rows) == 1003, "range-canonical-count")
        base.require([base.sha(row["current_version"]["display_text"].encode()) for row in rows[2:]]
                     == self.expected["body_hashes"], "range-canonical-order-and-bodies")
        base.require([row["role"] for row in rows[2:]] == self.expected["roles"], "range-canonical-roles")
        self.step("range-http-1001-canonical", import_id=iid, count=1001, duplicate_confirm=True,
                  last_page=[1000], old_indexes_250=200, old_indexes_251=422, canonical_body_hashes_matched=True)
        iid2, duplicate = self.staged(cid, raw)
        path2 = f"/api/append-imports/{iid2}"
        reviewed = self.request(self.web, "POST", path2 + "/review", json=duplicate).json()
        base.require((reviewed["add"], reviewed["skip"]) == (0, 1001), "range-duplicates")
        self.request(self.web, "POST", path2 + "/confirm", expected=202, json={**duplicate, "receipt": reviewed["receipt"]})
        self.status(iid2, "committed")
        rows2 = self.canonical_rows(cid)
        base.require(rows2 == rows, "duplicate-mutated-canonical")
        self.step("range-http-duplicates", import_id=iid2, added=0, skipped=1001, canonical_unchanged=True)

    def verify_runtime(self):
        rows = self.docker_json("inspect", *self.dc("ps", "-q", "api", "worker").decode().split())
        worker = next(row for row in rows if row["Config"]["Labels"]["com.docker.compose.service"] == "worker")
        base.require(worker["HostConfig"]["Memory"] == 640 * 1024**2 and not worker["State"]["OOMKilled"],
                     "worker-memory-limit-or-oom")
        schema = self.dc("exec", "-T", "pg", "psql", "-U", "postgres", "-d", self.database,
                         "-tAc", "SELECT version_num FROM alembic_version").decode().strip()
        base.require(schema == "20261125_0065", "schema-head")
        usage = self.dc("exec", "-T", "worker", "python", "-c",
            "from pathlib import Path; import json; p=Path('/sys/fs/cgroup/memory.peak'); "
            "print(json.dumps({'cgroup_peak_bytes':int(p.read_text()) if p.exists() else None}))").decode()
        self.verify_snapshot()
        self.step("g4-runtime-and-source", schema=schema, worker_memory_bytes=worker["HostConfig"]["Memory"],
                  worker_oom_killed=False, source_stable=True, **json.loads(usage))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--parent", type=Path, required=True)
    parser.add_argument("--fork", type=Path, required=True)
    args = parser.parse_args()
    gate = Gate(args.parent, args.fork)
    gate.report["scope"] = "G4 synthetic Reader range selection only; G1/G2 frozen evidence excluded; no real capture or browser."
    sys.exit(gate.run())
