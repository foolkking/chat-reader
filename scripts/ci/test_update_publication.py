import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import publish_update as pub
from update_distribution import OFFICIAL, full_repository


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
