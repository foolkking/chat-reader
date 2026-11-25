import json
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import publish_update as pub
from update_distribution import OFFICIAL, full_repository


class HostIntegrityReadTest(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location("updater_host_test", pub.ROOT / "deploy/updater/host.py")
        self.host = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.host)

    def test_migration_uses_only_the_signed_target_and_a_supported_no_pull_contract(self):
        host = object.__new__(self.host.Host)
        release = {"revision": "a" * 40, "schema": "20261123_0064", "images": {"api": {}, "web": {}}}
        images = host.images(release)
        legacy = "Options:\n      --entrypoint string\n      --no-deps\n  -T, --no-TTY\n      --rm\n"
        modern = legacy + "      --pull string     Pull image before running\n"
        base = {"image": images["API_IMAGE"]}
        tail = ["-T", "--entrypoint", "alembic", "migrate", "upgrade", release["schema"]]
        for help_text, service, flags in [
            (modern, dict(base, build={"context": "app"}), ["--pull", "never"]),
            (legacy, dict(base, pull_policy="never"), []),
            (legacy, base, None),
            (legacy, dict(base, pull_policy="missing"), None),
            (legacy, dict(base, pull_policy="never", build={}), None),
            (modern, dict(base, pull_policy="build"), None),
            (modern, dict(base, pull_policy="always"), None),
            (modern, {"image": "chat-reader-api:latest"}, None),
            (legacy.replace("--no-deps", "--something-else"), dict(base, pull_policy="never"), None),
            (legacy + "  --foo  also accepts --pull", base, None),
        ]:
            with self.subTest(help=help_text.splitlines()[-1], service=service):
                host.dc = Mock(side_effect=[json.dumps({"services": {"migrate": service}}), help_text])
                if flags is None:
                    with self.assertRaises(ValueError):
                        host.migration_command(release)
                else:
                    self.assertEqual(host.migration_command(release), ["run", "--rm", "--no-deps"] + flags + tail)
                self.assertEqual(host.dc.call_args_list[0].args, ("config", "--format", "json"))
                self.assertEqual(host.dc.call_args_list[0].kwargs, {"env": images})
                self.assertTrue(all(call.args[0] == "config" or call.args == ("run", "--help") for call in host.dc.call_args_list))

    def read(self, path, elapsed=0, data=b"[]", status=200):
        connection = Mock()
        response = Mock(status=status)
        response.read.return_value = data

        def request(client, method, endpoint):
            self.assertEqual(method, "GET")
            self.assertEqual(endpoint, "/v1.41/" + path)
            client.connect()

        def receive(client):
            # Model a complete cold filesystem scan, not an idle/HTTP retry.
            # Production measured this operation at >20s with no core changes.
            if elapsed >= connection.settimeout.call_args.args[0]:
                raise TimeoutError("bounded local scan exceeded its deadline")
            return response

        with patch.object(self.host.socket, "AF_UNIX", 1, create=True), \
             patch.object(self.host.socket, "socket", return_value=connection), \
             patch.object(self.host.http.client.HTTPConnection, "request", request), \
             patch.object(self.host.http.client.HTTPConnection, "getresponse", receive):
            try:
                return self.host.docker_read(path), connection, response
            finally:
                connection.close.assert_called_once()
                connection.connect.assert_called_once_with("/var/run/docker.sock")

    def test_only_exact_container_integrity_scan_gets_a_bounded_cold_scan_budget(self):
        _, sock, response = self.read("containers/" + "a" * 64 + "/changes", elapsed=21)
        sock.settimeout.assert_called_once_with(120)
        response.read.assert_called_once_with((16 << 20) + 1)

    def test_metadata_and_noncanonical_paths_keep_the_original_deadline(self):
        for path in ("containers/json", "images/sha256:" + "b" * 64 + "/json",
                     "containers/short/changes", "containers/" + "a" * 64 + "/changes?all=1"):
            with self.subTest(path=path):
                _, sock, _ = self.read(path)
                sock.settimeout.assert_called_once_with(15)
                with self.assertRaises(TimeoutError):
                    self.read(path, elapsed=16)

    def test_scan_timeout_bad_status_and_oversized_reply_fail_closed(self):
        path = "containers/" + "a" * 64 + "/changes"
        with self.assertRaises(TimeoutError):
            self.read(path, elapsed=121)
        with self.assertRaises(ValueError):
            self.read(path, status=500)
        with self.assertRaises(ValueError):
            self.read(path, data=b" " * ((16 << 20) + 1))

    def test_integrity_check_still_rejects_every_protected_core_path(self):
        host = object.__new__(self.host.Host)
        for root in ("/app", "/usr", "/etc", "/lib", "/bin", "/opt", "/sbin"):
            for path in (root, root + "/changed"):
                with self.subTest(path=path), patch.object(self.host, "docker_read", return_value=[{"Path": path}]):
                    with self.assertRaises(ValueError):
                        host.unpatched("a" * 64)
        with patch.object(self.host, "docker_read", return_value=[{"Path": "/tmp/runtime"}]):
            host.unpatched("a" * 64)
        with patch.object(self.host, "docker_read", return_value=None):
            host.unpatched("a" * 64)
        with patch.object(self.host, "docker_read", side_effect=TimeoutError):
            with self.assertRaises(TimeoutError):
                host.unpatched("a" * 64)


class DistributionTest(unittest.TestCase):
    def test_full_dispatch_preserves_frozen_inspector_and_rejects_cross_repo_and_reuse(self):
        with tempfile.TemporaryDirectory() as directory:
            event = Path(directory) / "event.json"
            env = {"GITHUB_ACTIONS": "true", "GITHUB_EVENT_NAME": "workflow_dispatch",
                   "GITHUB_REPOSITORY": "demo/fork", "GITHUB_REPOSITORY_ID": "42", "GITHUB_EVENT_PATH": str(event)}
            with patch.dict(os.environ, env, clear=True):
                body = {"repository": {"id": 42, "full_name": "demo/fork"}, "inputs": {"distribution": "demo/fork:42"}}
                event.write_text(json.dumps(body)); self.assertEqual(full_repository(), "demo/fork")
                body["inputs"]["quality_source_run_id"] = "43578495558"
                event.write_text(json.dumps(body))
                with self.assertRaises(ValueError): full_repository()
                del body["inputs"]["quality_source_run_id"]
                body["repository"]["id"] = 43
                event.write_text(json.dumps(body))
                with self.assertRaises(ValueError): full_repository()

    def test_fork_is_explicit_and_identity_bound(self):
        with patch.dict(
            os.environ,
            {"GITHUB_REPOSITORY": "fixture/fork", "GITHUB_REPOSITORY_ID": "42", "UPDATE_DISTRIBUTION": ""},
            clear=True,
        ):
            self.assertEqual(full_repository(), OFFICIAL)
            os.environ["UPDATE_DISTRIBUTION"] = "fixture/fork:43"
            with self.assertRaises(ValueError):
                full_repository()
            os.environ["UPDATE_DISTRIBUTION"] = "fixture/fork:42"
            self.assertEqual(full_repository(), "fixture/fork")

    def test_tag_policy(self):
        for name in ("v1.3.4", "v0.0.1-rc.12"):
            self.assertTrue(pub.TAG.fullmatch(name))
        for name in ("latest", "v01.2.3", "v1.2.3-rc.0", "v1.2", "v1.2.3+fork", "v1.2.3/next"):
            self.assertFalse(pub.TAG.fullmatch(name))

    def test_gate_rejects_other_run_tag_and_attempt(self):
        sha = "d" * 40
        run = {
            "id": 5,
            "head_sha": sha,
            "event": "workflow_dispatch",
            "repository": {"id": 7},
            "head_repository": {"id": 7},
            "path": ".github/workflows/build-release-images.yml",
            "display_title": "Release qualification 31-1",
            "run_attempt": 1,
            "status": "completed",
            "conclusion": "success",
        }
        with patch.object(pub, "ctx", return_value=("fixture/fork", "v1.2.3", sha, 7)), patch.dict(
            os.environ, {"GITHUB_RUN_ID": "31", "GITHUB_RUN_ATTEMPT": "1"}
        ):
            for change in (
                {"id": 9},
                {"head_sha": "e" * 40},
                {"event": "pull_request"},
                {"head_repository": {"id": 9}},
                {"run_attempt": 2},
                {"conclusion": "failure"},
                {"display_title": "Release qualification 30-1"},
            ):
                with patch.object(pub, "api", return_value=dict(run, **change)), self.assertRaises(
                    ValueError
                ):
                    pub.artifact("5", False)

    def test_only_complete_independent_qualification(self):
        sha = "d" * 40
        spec = pub.importlib.util.spec_from_file_location(
            "policy_test", pub.ROOT / "scripts/ci/image-only-quality-reuse.py"
        )
        policy = pub.importlib.util.module_from_spec(spec)
        spec.loader.exec_module(policy)
        jobs = [
            dict(name=n, head_sha=sha, status="completed", conclusion="success")
            for n in (*policy.FULL_QUALITY_NAMES, "build-images", "inspect-release-artifact")
        ]
        run = dict(
            id=5,
            head_sha=sha,
            event="workflow_dispatch",
            repository={"id": 7},
            head_repository={"id": 7},
            path=".github/workflows/build-release-images.yml",
            display_title="Release qualification 31-1",
            run_attempt=1,
            status="completed",
            conclusion="success",
        )
        art = dict(
            name="chat-reader-images-" + sha + "-1",
            expired=False,
            workflow_run={"head_sha": sha, "id": 5},
            digest="sha256:" + "e" * 64,
            size_in_bytes=200,
            id=9,
        )

        def api(path):
            if "/jobs?" in path:
                return {"total_count": len(jobs), "jobs": jobs}
            if "/artifacts?" in path:
                return {"total_count": 1, "artifacts": [art]}
            return run

        with patch.object(pub, "ctx", return_value=("fixture/fork", "v1.2.3", sha, 7)), patch.object(
            pub, "api", side_effect=api
        ), patch.dict(os.environ, {"GITHUB_RUN_ID": "31", "GITHUB_RUN_ATTEMPT": "1"}):
            self.assertEqual(pub.artifact("5", False)["id"], 9)
            jobs[-1]["conclusion"] = "skipped"
            with self.assertRaises(ValueError):
                pub.artifact("5", False)
