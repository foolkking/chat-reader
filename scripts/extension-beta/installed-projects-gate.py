"""Add actual installed-browser project creation to the disposable PG/API/worker gate.

The Next build must rewrite to 127.0.0.1:18872 and the sealed installation must bind
to the chosen disposable Web port. Never take over an existing listener, browser profile or service.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess

spec = importlib.util.spec_from_file_location("mapping_base", Path(__file__).with_name("backend-gate.py"))
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)


class MappingGate(base.Gate):
    def create_frontend(self):
        for port in (self.front_port, 18872):
            with socket.socket() as sock:
                try:
                    sock.bind(("127.0.0.1", port))
                except OSError as exc:
                    raise AssertionError(f"loopback-port-unavailable:{port}:{exc.errno}") from exc
        self.api_port = self.report["api_port"] = 18872
        self.origin = f"http://127.0.0.1:{self.front_port}"
        self.report["browser_origin"] = self.origin
        base.approved(self.web_build)
        base.approved(self.install)
        self.web_hashes = json.loads((self.web_build / "inputs.json").read_bytes())
        self.verify_frontend()
        self.report["web_inputs_sha256"] = base.sha((self.web_build / "inputs.json").read_bytes())
        self.report["harness_sha256"].update({
            "installed-projects-gate.py": base.sha(Path(__file__).read_bytes()),
            "reader-project-mapping-check.cjs": base.sha((self.fork / "scripts/reader-project-mapping-check.cjs").read_bytes()),
        })

    def verify_frontend(self):
        import zipfile
        for name, digest in self.web_hashes.items():
            base.require(base.sha((base.REPO / name).read_bytes()) == digest, "web-source-drift")
            base.require(base.sha((self.web_build / name).read_bytes()) == digest, "web-copy-drift")
        base.require((self.web_build / "apps/web/.next/BUILD_ID").is_file(), "next-build-required")
        archive = self.install.parent / "chat-reader-0.3.0.zip"
        with zipfile.ZipFile(archive) as package:
            base.require(set(package.namelist()) == {p.relative_to(self.install).as_posix()
                         for p in self.install.rglob("*") if p.is_file()}, "installed-file-set")
            for name in package.namelist():
                base.require(package.read(name) == (self.install / name).read_bytes(), "installed-file-mismatch")
        base.require((self.install / "config.js").read_text().strip() == f'globalThis.READER_ORIGIN="{self.origin}";', "loopback-only")
        self.report["install_sha256"] = base.sha(archive.read_bytes())

    def prepare(self):
        self.next = None
        self.create_frontend()
        super().prepare()

    def start_app(self):
        web_dir = self.web_build / "apps/web"
        executable = web_dir / "node_modules/next/dist/bin/next"
        self.next_log = (self.root / "next.log").open("wb")
        self.next = subprocess.Popen([shutil.which("node"), executable, "start", "-H", "127.0.0.1", "-p", str(self.front_port)],
            cwd=web_dir, stdout=self.next_log, stderr=subprocess.STDOUT,
            env={**os.environ, "TEMP": str(self.root), "TMP": str(self.root), "APP_ENV": "test", "AUTH_ENABLED": "true",
                 "API_INTERNAL_URL": "http://127.0.0.1:18872", "NEXT_TELEMETRY_DISABLED": "1"},
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        super().start_app()
        base.require(self.next.poll() is None, "owned-web-service")

    def verify_runtime(self):
        super().verify_runtime()  # Original package, bad ZIP, attachments and duplicate gates are independent and intact.
        existing = self.request(self.web, "POST", "/api/projects", expected=201, json={"name": "Mapping existing"}).json()["id"]
        before = len(self.request(self.web, "GET", "/api/conversations").json())
        session = {"cookies": {k: self.web.cookies[k] for k in ("chat_reader_session", "chat_reader_session_present")},
                   "existing": existing, "device": self.device, "user": self.user_id,
                   "token": self.device_client.headers["Authorization"].removeprefix("Bearer ")}
        self.sensitive.append(session["cookies"]["chat_reader_session"])
        browser_env = {k: v for k, v in self.env.items() if not k.startswith("G1_")}
        self.command(["node", self.fork / "scripts/reader-project-mapping-check.cjs", self.install],
                     env={**browser_env, "MAPPING_TEST_ORIGIN": self.origin, "MAPPING_SYNTHETIC_SESSION": json.dumps(session)}, timeout=270, log="browser.log")
        projects = self.request(self.device_client, "GET", "/api/extension/v1/projects").json()
        project_ids = [p["id"] for p in projects if p["name"] == "Mapping 海洋"]
        base.require(len(project_ids) == 1 and project_ids[0] != existing, "one-new-distinct-project")
        for pid, indices in [(existing, [0]), (project_ids[0], [1, 2])]:
            rows = self.request(self.web, "GET", "/api/projects/" + pid + "/conversations").json()
            base.require(len(rows) == len(indices), "mapped-project-count")
            expected = sorted([(f"Mapping question {i}", f"Mapping answer {i}") for i in indices])
            actual = []
            for row in rows:
                messages = self.request(self.web, "GET", "/api/conversations/" + row["id"] + "/messages").json()
                base.require([m["role"] for m in messages] == ["user", "assistant"], "mapped-message-roles")
                actual.append(tuple(m["current_version"]["display_text"] for m in messages))
            base.require(sorted(actual) == expected, "mapped-message-bytes")
        base.require(len(self.request(self.web, "GET", "/api/conversations").json()) == before + 3, "mapped-conversation-count")
        self.verify_snapshot()
        self.verify_frontend()
        self.step("installed-project-mapping", projects=2, new_conversations=3, canonical_messages=6,
                  same_name_reuse=True, native_web_confirmation=True, ids_and_message_bytes_verified=True)

    def cleanup(self):
        try:
            super().cleanup()
        finally:
            if self.next:
                self.next.terminate()
                try:
                    self.next.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    self.next.kill()
                    self.next.wait()
                self.next_log.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for arg in ("parent", "fork", "web-build", "install"):
        parser.add_argument("--" + arg, required=True, type=Path)
    parser.add_argument("--port", required=True, type=int)
    parser.add_argument("--parser-fixture", type=Path)
    args = parser.parse_args()
    gate = MappingGate(args.parent, args.fork, diagnostics=True, parser_fixture=args.parser_fixture)
    base.require(1024 <= args.port <= 65535 and args.port != 18872, "distinct-loopback-test-port")
    gate.front_port = args.port
    gate.web_build, gate.install = args.web_build, args.install
    raise SystemExit(gate.run())
