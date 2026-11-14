"""Additive, offline negative controls for the one-off image-only release path."""
from __future__ import annotations

import copy
from datetime import datetime, timezone
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile


spec = importlib.util.spec_from_file_location(
    "image_only_quality_reuse", Path(__file__).with_name("image-only-quality-reuse.py"),
)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
HEAD = "b" * 40


def blob(value):
    return hashlib.sha256(value).hexdigest()


def source_fixture():
    run = {
        "id": int(gate.BASE_RUN), "head_sha": gate.BASE_SHA, "head_branch": "master",
        "path": gate.WORKFLOW, "event": "workflow_dispatch", "run_attempt": 1,
        "status": "completed", "conclusion": "failure",
        "repository": {"full_name": gate.REPOSITORY},
        "head_repository": {"full_name": gate.REPOSITORY},
    }
    jobs = []
    for index, name in enumerate((*gate.QUALITY_NAMES, "build-images", "inspect-release-artifact")):
        result = "success" if index < 4 else "failure" if index == 4 else "skipped"
        jobs.append({
            "id": index + 1, "name": name, "run_id": int(gate.BASE_RUN),
            "run_attempt": 1, "head_sha": gate.BASE_SHA, "status": "completed",
            "conclusion": result, "started_at": "2026-11-14T09:01:00Z",
            "completed_at": "2026-11-14T09:57:00Z",
            "steps": [{"name": "Verify real 320 MiB worker ZIP analysis and commit without swap"
                       if index == 4 else "Original quality step", "conclusion": result}],
        })
    return run, {"total_count": len(jobs), "jobs": jobs}


def browser_summary(kind):
    ids = gate.WEB_GATE_IDS if kind == "web" else ("settings-stages-1-4", "system-archive-new-instance")
    cases = []
    for name in ids:
        count = 470 if name == "settings-stages-1-4" else 1
        cases.append({
            "gate_id": name, "status": "PASS", "evidence_status": "passed",
            "test_count": count, "result_counts": {
                "passed": count, "failed": 0, "timedOut": 0, "skipped": 0, "interrupted": 0,
            },
        })
    return {
        "schema_version": 1, "source_sha": gate.BASE_SHA, "overall_status": "PASS",
        "counts": {"PASS": len(ids), "FAIL": 0, "NOT_VERIFIED": 0, "SKIPPED": 0},
        "gates": cases,
    }


def zip_fixture(kind, value, *, duplicate=False):
    member = (
        "_temp/reading-comparison/candidate/gate-evidence.json" if kind == "reading" else
        f"chat-reader/apps/web/test-results/{'release' if kind == 'web' else 'settings'}-gate-summary.json"
    )
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as archive:
        archive.writestr(member, json.dumps(value))
        if duplicate:
            archive.writestr("duplicate/" + member, json.dumps(value))
    data = stream.getvalue()
    specification = {"id": 1, "name": "synthetic-quality-control", "kind": kind,
                     "size_in_bytes": len(data), "digest": "sha256:" + blob(data)}
    return data, specification


class SourceEquivalenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.old_workflow = gate.git("show", f"{gate.BASE_SHA}:{gate.WORKFLOW}")
        cls.old_helper = gate.git("show", f"{gate.BASE_SHA}:{gate.HELPER}")
        cls.contract = (gate.REPO / gate.PATCH).read_bytes().replace(b"\r\n", b"\n")

    def setUp(self):
        self.objects = {}
        self.base = {}
        self.candidate = {}
        for name, value in {
            gate.WORKFLOW: self.old_workflow, gate.HELPER: self.old_helper,
            "apps/api/app/workers/import_worker.py": b"original worker",
            "apps/api/tests/test_original.py": b"original API tests",
            "apps/web/app/page.tsx": b"original UI",
            "apps/web/e2e/settings-original.spec.ts": b"original browser cases",
            "apps/web/playwright.config.ts": b"original native deadlines",
            "pnpm-lock.yaml": b"original dependencies",
            "scripts/ci/small-import-memory-gate.py": b"original memory sensor/gates",
            ".github/workflows/reading-performance.yml": b"original comparison",
            "PROJECT_STATE.md": b"original documentation",
        }.items():
            self.base[name] = self.put(value)
        self.candidate = copy.deepcopy(self.base)
        self.candidate[gate.HELPER] = self.put(self.old_helper.replace(gate.OLD_FAILURE, gate.NEW_FAILURE))
        self.candidate[gate.WORKFLOW] = self.put(gate.approved_workflow(self.old_workflow, self.contract))
        for name in (gate.PATCH, "scripts/ci/image-only-quality-reuse.py",
                     "scripts/ci/test_image_only_quality_reuse.py",
                     "apps/api/scripts/test_verify_small_zip_memory.py"):
            self.candidate[name] = self.put(self.contract if name == gate.PATCH else b"additive control")

    def put(self, value, mode="100644"):
        object_id = blob(value)
        self.objects[object_id] = value
        return mode, object_id

    def verify(self, *, parents=None):
        return gate.verify_equivalence(
            self.base, self.candidate, self.objects.__getitem__,
            [gate.BASE_SHA] if parents is None else parents, HEAD,
        )

    def test_exact_one_line_repair_and_additive_controls_are_accepted(self):
        result = self.verify()
        self.assertEqual(result["application_dependency_and_existing_test_changes"], 0)
        self.assertTrue(result["exact_null_failure_fix_verified"])
        self.assertTrue(result["original_workflow_gates_preserved"])
        self.assertEqual(result["candidate_sha"], HEAD)

    def test_owned_documentation_and_original_dispatch_receipt_can_be_preserved(self):
        self.candidate["PROJECT_STATE.md"] = self.put(b"current facts only")
        self.candidate["docs/evidence/reliability-2026-11-14/ci-offline-optional-dispatch.json"] = self.put(b"old receipt")
        self.assertIn("PROJECT_STATE.md", self.verify()["changed_paths"])

    def test_application_dependency_existing_tests_and_native_gates_never_reuse(self):
        for name in (set(self.base) - {gate.HELPER, gate.WORKFLOW, "PROJECT_STATE.md"}):
            with self.subTest(name=name):
                original = self.candidate[name]
                self.candidate[name] = self.put(b"changed input")
                with self.assertRaisesRegex(gate.GateError, "unapproved file"):
                    self.verify()
                self.candidate[name] = original

    def test_unknown_file_configuration_migration_or_workflow_is_rejected(self):
        for name in ("apps/api/alembic/versions/new.py", ".env.production",
                     "docker-compose.production.yml", ".github/workflows/unsafe.yml",
                     "scripts/ci/unreviewed.py", "docs/unrelated.md"):
            with self.subTest(name=name):
                self.candidate[name] = self.put(b"unexpected input")
                with self.assertRaises(gate.GateError):
                    self.verify()
                del self.candidate[name]

    def test_helper_cannot_change_fixture_or_any_other_behavior(self):
        self.candidate[gate.HELPER] = self.put(
            self.old_helper.replace(gate.OLD_FAILURE, gate.NEW_FAILURE).replace(b"range(13)", b"range(1)"),
        )
        with self.assertRaisesRegex(gate.GateError, "exact null-failure"):
            self.verify()

    def test_no_fix_is_not_a_valid_image_only_repair(self):
        self.candidate[gate.HELPER] = self.base[gate.HELPER]
        with self.assertRaisesRegex(gate.GateError, "Both the exact helper"):
            self.verify()

    def test_memory_or_browser_workflow_command_change_is_rejected(self):
        for before, after in (
            (b"small-import-memory-gate.py", b"skip-memory.py"),
            (b"e2e/settings-.*", b"e2e/settings-one"),
            (b"memory_limit_bytes == 335544320", b"memory_limit_bytes == 671088640"),
        ):
            with self.subTest(before=before):
                approved = gate.approved_workflow(self.old_workflow, self.contract)
                self.assertIn(before, approved)
                self.candidate[gate.WORKFLOW] = self.put(approved.replace(before, after))
                with self.assertRaisesRegex(gate.GateError, "byte-exact"):
                    self.verify()

    def test_tampered_patch_contract_is_rejected(self):
        self.candidate[gate.PATCH] = self.put(self.contract + b" ")
        with self.assertRaisesRegex(gate.GateError, "patch contract changed"):
            self.verify()

    def test_unreviewed_workflow_base_is_rejected(self):
        with self.assertRaisesRegex(gate.GateError, "reviewed base"):
            gate.approved_workflow(self.old_workflow + b"\n", self.contract)

    def test_removed_or_linked_new_control_is_rejected(self):
        name = "apps/api/scripts/test_verify_small_zip_memory.py"
        self.candidate.pop(name)
        with self.assertRaisesRegex(gate.GateError, "additive repair controls"):
            self.verify()
        self.candidate[name] = self.put(b"../other", "120000")
        with self.assertRaisesRegex(gate.GateError, "link/mode"):
            self.verify()

    def test_deletion_and_executable_mode_change_are_rejected(self):
        del self.candidate["PROJECT_STATE.md"]
        with self.assertRaisesRegex(gate.GateError, "Deletion"):
            self.verify()
        self.candidate["PROJECT_STATE.md"] = self.put(b"modified docs", "100755")
        with self.assertRaisesRegex(gate.GateError, "executable"):
            self.verify()

    def test_merge_extra_commit_or_wrong_parent_is_rejected(self):
        for parents in ([], [HEAD], [gate.BASE_SHA, HEAD], [gate.BASE_SHA, gate.BASE_SHA]):
            with self.subTest(parents=parents), self.assertRaisesRegex(gate.GateError, "direct, non-merge"):
                self.verify(parents=parents)

    def test_original_quality_jobs_commands_and_order_are_byte_preserved(self):
        approved = gate.approved_workflow(self.old_workflow, self.contract).decode()
        for name in (*gate.NEEDS_NAMES[:3], "reading-performance-comparison"):
            # A generic regex is unnecessary: each original body remains after the
            # sole added job selector, including all steps/commands/environment.
            import re
            marker = rf"\n  {re.escape(name)}:\n"
            old_body = re.split(r"\n  [a-z][a-z0-9-]*:\n", re.split(marker, self.old_workflow.decode())[1], 1)[0]
            new_body = re.split(r"\n  [a-z][a-z0-9-]*:\n", re.split(marker, approved)[1], 1)[0]
            self.assertEqual(
                new_body.replace("    if: ${{ inputs.quality_source_run_id == '' }}\n", "", 1), old_body,
            )
        self.assertNotIn("timeout-minutes:", approved)

    def test_additive_orm_controls_do_not_prewarm_original_memory_measurements(self):
        approved = gate.approved_workflow(self.old_workflow, self.contract).decode()
        self.assertLess(
            approved.index("python3 scripts/ci/bounded-import-memory-gate.py"),
            approved.index("Verify real ORM memory-control-plane status and source guards"),
        )
        self.assertLess(
            approved.index("Verify real ORM memory-control-plane status and source guards"),
            approved.index("- name: Build Web image"),
        )


class OfficialQualityTests(unittest.TestCase):
    def setUp(self):
        self.run, self.jobs = source_fixture()

    def verify(self):
        return gate.verified_jobs(self.run, self.jobs, source_sha=gate.BASE_SHA,
                                  source_run=gate.BASE_RUN, attempt=1, reuse=True)

    def test_exact_original_four_successes_are_accepted(self):
        self.assertEqual([item["name"] for item in self.verify()], list(gate.QUALITY_NAMES))

    def test_wrong_run_sha_attempt_repository_event_or_workflow_is_rejected(self):
        variants = (
            ("id", 1), ("head_sha", HEAD), ("run_attempt", 2),
            ("status", "in_progress"), ("conclusion", "success"), ("head_branch", "other"),
            ("event", "pull_request"), ("path", ".github/workflows/other.yml"),
            ("repository", {"full_name": "foreign/repository"}),
            ("head_repository", {"full_name": "foreign/repository"}),
        )
        for key, value in variants:
            with self.subTest(key=key):
                old = self.run[key]
                self.run[key] = value
                with self.assertRaises(gate.GateError):
                    self.verify()
                self.run[key] = old

    def test_failed_cancelled_skipped_or_running_quality_is_rejected(self):
        for index in range(4):
            for status in ("failure", "cancelled", "skipped", "timed_out", None):
                with self.subTest(index=index, status=status):
                    self.jobs["jobs"][index]["conclusion"] = status
                    with self.assertRaises(gate.GateError):
                        self.verify()
            self.jobs["jobs"][index]["conclusion"] = "success"
        self.jobs["jobs"][0]["status"] = "in_progress"
        with self.assertRaises(gate.GateError):
            self.verify()

    def test_wrong_quality_job_source_identity_is_rejected(self):
        for key, value in (("run_id", 1), ("run_attempt", 2), ("head_sha", HEAD)):
            with self.subTest(key=key):
                original = self.jobs["jobs"][0][key]
                self.jobs["jobs"][0][key] = value
                with self.assertRaises(gate.GateError):
                    self.verify()
                self.jobs["jobs"][0][key] = original

    def test_failed_quality_step_and_wrong_memory_failure_are_rejected(self):
        self.jobs["jobs"][0]["steps"][0]["conclusion"] = "failure"
        with self.assertRaises(gate.GateError):
            self.verify()
        self.jobs["jobs"][0]["steps"][0]["conclusion"] = "success"
        self.jobs["jobs"][4]["steps"][0]["name"] = "Build Web image"
        with self.assertRaisesRegex(gate.GateError, "reviewed memory"):
            self.verify()

    def test_missing_paginated_duplicate_or_extra_jobs_are_rejected(self):
        self.jobs["total_count"] = 7
        with self.assertRaises(gate.GateError):
            self.verify()
        self.jobs["total_count"] = 6
        self.jobs["jobs"][1]["name"] = self.jobs["jobs"][0]["name"]
        with self.assertRaisesRegex(gate.GateError, "Duplicate"):
            self.verify()

    def test_wrong_or_expired_immutable_artifact_is_rejected(self):
        specification = gate.ARTIFACTS[0]
        metadata = {**specification, "expired": False,
                    "workflow_run": {"id": int(gate.BASE_RUN), "head_sha": gate.BASE_SHA}}
        gate.validate_artifact_metadata(metadata, specification)
        for key, value in (("id", 2), ("digest", "sha256:" + HEAD), ("size_in_bytes", 1),
                           ("name", "wrong-artifact"), ("expired", True),
                           ("workflow_run", {"id": 1, "head_sha": HEAD})):
            with self.subTest(key=key), self.assertRaises(gate.GateError):
                gate.validate_artifact_metadata({**metadata, key: value}, specification)

    def test_normal_full_mode_can_accept_a_different_exact_tested_sha(self):
        self.run.update(id=9001, head_sha=HEAD, run_attempt=2, status="in_progress", conclusion=None)
        for job in self.jobs["jobs"]:
            job.update(run_id=9001, head_sha=HEAD, run_attempt=2)
        result = gate.verified_jobs(self.run, self.jobs, source_sha=HEAD, source_run="9001",
                                    attempt=2, reuse=False)
        self.assertEqual(len(result), 4)

    def test_full_producer_does_not_require_a_not_yet_created_downstream_consumer(self):
        self.run.update(id=9001, head_sha=HEAD, status="in_progress", conclusion=None)
        self.jobs["jobs"].pop()
        self.jobs["total_count"] = 5
        for job in self.jobs["jobs"]:
            job.update(run_id=9001, head_sha=HEAD)
        self.assertEqual(len(gate.verified_jobs(
            self.run, self.jobs, source_sha=HEAD, source_run="9001", attempt=1, reuse=False,
        )), 4)
        self.jobs["jobs"].pop(0)
        self.jobs["total_count"] = 4
        with self.assertRaises(gate.GateError):
            gate.verified_jobs(self.run, self.jobs, source_sha=HEAD,
                               source_run="9001", attempt=1, reuse=False)


class QualityEvidenceTests(unittest.TestCase):
    def test_web_and_complete_470_plus_independent_restore_are_accepted(self):
        for kind in ("web", "settings"):
            with self.subTest(kind=kind):
                data, specification = zip_fixture(kind, browser_summary(kind))
                self.assertTrue(gate.validate_quality_zip(data, specification)["crc_verified"])

    def test_wrong_source_failed_or_incomplete_browser_summary_is_rejected(self):
        for field, value in (("source_sha", HEAD), ("overall_status", "FAIL"),
                             ("counts", {"PASS": 1}), ("gates", [])):
            summary = browser_summary("web")
            summary[field] = value
            with self.subTest(field=field), self.assertRaises(gate.GateError):
                gate.validate_quality_zip(*zip_fixture("web", summary))

    def test_469_only_skipped_failed_timed_out_or_interrupted_settings_is_rejected(self):
        for field in ("passed", "skipped", "failed", "timedOut", "interrupted"):
            summary = browser_summary("settings")
            summary["gates"][0]["result_counts"][field] = 469 if field == "passed" else 1
            with self.subTest(field=field), self.assertRaises(gate.GateError):
                gate.validate_quality_zip(*zip_fixture("settings", summary))

    def test_restore_cannot_be_missing_or_replaced_by_matrix_pass(self):
        summary = browser_summary("settings")
        summary["gates"].pop()
        with self.assertRaises(gate.GateError):
            gate.validate_quality_zip(*zip_fixture("settings", summary))

    def test_full_nine_case_candidate_comparison_is_required(self):
        value = {"schema_version": 2, "gate_id": "reader-capacity-candidate", "status": "passed",
                 "test_count": 9, "result_counts": {
                     "passed": 9, "failed": 0, "timedOut": 0, "skipped": 0, "interrupted": 0,
                 }}
        self.assertEqual(gate.validate_quality_zip(*zip_fixture("reading", value))["quality_summary"], value)
        for key, item in (("test_count", 8), ("status", "failed"), ("gate_id", "diagnostic-only")):
            with self.subTest(key=key), self.assertRaises(gate.GateError):
                gate.validate_quality_zip(*zip_fixture("reading", {**value, key: item}))

    def test_zip_digest_size_crc_and_ambiguous_json_are_not_bypassed(self):
        data, specification = zip_fixture("settings", browser_summary("settings"))
        with self.assertRaisesRegex(gate.GateError, "size/digest"):
            gate.validate_quality_zip(data + b"changed", specification)
        data, specification = zip_fixture("settings", browser_summary("settings"), duplicate=True)
        with self.assertRaisesRegex(gate.GateError, "ambiguous"):
            gate.validate_quality_zip(data, specification)
        damaged = bytearray(data)
        position = damaged.find(b'{"schema_version"')
        self.assertGreater(position, 0)
        damaged[position] ^= 1
        specification = {**specification, "digest": "sha256:" + blob(damaged)}
        with self.assertRaisesRegex(gate.GateError, "CRC failed"):
            gate.validate_quality_zip(bytes(damaged), specification)


class ProducerConsumerControlsTests(unittest.TestCase):
    def test_full_branch_requires_four_successes_and_reuse_requires_four_explicit_skips(self):
        for reuse in (False, True):
            desired = "skipped" if reuse else "success"
            needs = {name: {"result": desired} for name in gate.NEEDS_NAMES}
            gate.validate_needs(needs, reuse=reuse)
            for name in gate.NEEDS_NAMES:
                with self.subTest(reuse=reuse, name=name):
                    with self.assertRaises(gate.GateError):
                        gate.validate_needs({**needs, name: {"result": "failure"}}, reuse=reuse)
            with self.assertRaises(gate.GateError):
                gate.validate_needs({**needs, "unexpected": {"result": desired}}, reuse=reuse)

    def report_fixture(self):
        verification = {
            "mode": "authorized-image-only",
            "candidate": {"sha": HEAD, "workflow_run_id": "9001", "workflow_run_attempt": 1},
            "source": {"sha": gate.BASE_SHA, "workflow_run_id": gate.BASE_RUN},
            "source_equivalence": {"application_dependency_and_existing_test_changes": 0},
            "quality_passed": True, "old_images_or_memory_results_reused": False,
        }
        report = {"schema_version": 1, "recorded_at": datetime.now(timezone.utc).isoformat(),
                  "verification": verification}
        manifest = {"schema_version": 2, "commit": HEAD, "workflow_run_id": "9001",
                    "workflow_run_attempt": "1", "archive": "chat-reader-images.tar.gz",
                    "quality_verification": report}
        return verification, report, manifest

    def test_independent_consumer_accepts_the_exact_producer_identity(self):
        expected, report, manifest = self.report_fixture()
        gate.verify_report(report, manifest, expected)

    def test_report_mode_source_candidate_attempt_or_acceptance_tampering_is_rejected(self):
        expected, report, manifest = self.report_fixture()
        for key, value in (
            ("mode", "full-exact"), ("quality_passed", False),
            ("candidate", {"sha": HEAD, "workflow_run_id": "9001", "workflow_run_attempt": 2}),
            ("source", {"sha": HEAD, "workflow_run_id": "1"}),
            ("old_images_or_memory_results_reused", True), ("source_equivalence", None),
        ):
            changed = copy.deepcopy(report)
            changed["verification"][key] = value
            with self.subTest(key=key), self.assertRaises(gate.GateError):
                gate.verify_report(changed, {**manifest, "quality_verification": changed}, expected)

    def test_manifest_must_bind_same_report_sha_run_archive_and_producer_attempt(self):
        expected, report, manifest = self.report_fixture()
        for key, value in (("commit", gate.BASE_SHA), ("workflow_run_id", "1"),
                           ("workflow_run_attempt", "2"), ("archive", "other.tar.gz"),
                           ("quality_verification", {})):
            with self.subTest(key=key), self.assertRaises(gate.GateError):
                gate.verify_report(report, {**manifest, key: value}, expected)

    def test_naive_timestamp_or_unknown_proof_fields_are_rejected(self):
        expected, report, manifest = self.report_fixture()
        report["recorded_at"] = "2026-11-14T10:00:00"
        with self.assertRaises(gate.GateError):
            gate.verify_report(report, manifest, expected)
        report["recorded_at"] = datetime.now(timezone.utc).isoformat()
        with self.assertRaises(gate.GateError):
            gate.verify_report({**report, "bypass": True}, manifest, expected)

    def test_boolean_number_coercion_cannot_fake_proof_acceptance_or_attempt(self):
        expected, report, manifest = self.report_fixture()
        for change in ("quality_passed", "workflow_run_attempt", "schema_version"):
            changed = copy.deepcopy(report)
            if change == "quality_passed":
                changed["verification"]["quality_passed"] = 1
            elif change == "workflow_run_attempt":
                changed["verification"]["candidate"]["workflow_run_attempt"] = True
            else:
                changed["schema_version"] = True
            with self.subTest(change=change), self.assertRaises(gate.GateError):
                gate.verify_report(changed, {**manifest, "quality_verification": changed}, expected)

    def test_git_reads_use_real_immutable_blobs_not_worktree_content(self):
        root = os.environ.get("RUNNER_TEMP") or os.environ.get("TEMP")
        self.assertTrue(root and Path(root).is_dir(), "Set an explicit task TEMP/RUNNER_TEMP.")
        directory = tempfile.TemporaryDirectory(prefix="image-source-git-", dir=root)
        path = Path(directory.name)
        try:
            subprocess.run(["git", "init", "-q", str(path)], check=True, capture_output=True)
            (path / "source.txt").write_text("original", encoding="utf-8")
            subprocess.run(["git", "-c", "core.autocrlf=false", "add", "source.txt"],
                           cwd=path, check=True, capture_output=True)
            subprocess.run(["git", "-c", "user.name=Synthetic Control",
                            "-c", "user.email=synthetic@example.test", "commit", "-qm", "original"],
                           cwd=path, check=True, capture_output=True)
            entries = gate.tree("HEAD", cwd=path)
            self.assertEqual(entries["source.txt"][0], "100644")
            (path / "source.txt").write_text("uncommitted mutation", encoding="utf-8")
            self.assertEqual(gate.git("cat-file", "blob", entries["source.txt"][1], cwd=path), b"original")
        finally:
            self.assertFalse(path.is_symlink())
            self.assertTrue(path.resolve().is_relative_to(Path(root).resolve()))
            directory.cleanup()

    def test_github_command_errors_do_not_print_tokens_or_raw_credential_errors(self):
        result = subprocess.CompletedProcess([], 1, stdout=b"", stderr=b"secret credential")
        with patch.object(gate.subprocess, "run", return_value=result):
            with self.assertRaises(gate.GateError) as error:
                gate.api("actions/runs/1", cache=Path("."), name="source-run.json")
        self.assertNotIn("secret", str(error.exception))


if __name__ == "__main__":
    unittest.main()
