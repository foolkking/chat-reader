"""Exact execution-contract controls for isolated full-CI scheduling only."""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import re
import unittest

import yaml


REPO = Path(__file__).resolve().parents[2]
CONTRACT = REPO / "scripts/ci/quality-scheduling-contract.json"
CONTRACT_SHA256 = "af1523d28f658f4bd3d1b3a6ad2f018250b5b909db0f7b81f4e00eeeb212084c"


def read(file):
    return (REPO / file).read_text(encoding="utf-8").replace("\r\n", "\n")


def load(file):
    return yaml.safe_load(read(file))


def named(steps, name):
    matches = [step for step in steps if step.get("name") == name]
    if len(matches) != 1:
        raise AssertionError("Exactly one original step required: " + name)
    return matches[0]


class QualitySchedulingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        raw = CONTRACT.read_bytes().replace(b"\r\n", b"\n")
        assert hashlib.sha256(raw).hexdigest() == CONTRACT_SHA256, "Frozen original execution contract changed"
        cls.contract = json.loads(raw)
        cls.main = load(".github/workflows/build-release-images.yml")
        cls.web = load(".github/workflows/web-quality.yml")
        cls.settings = load(".github/workflows/settings-browser-shard.yml")
        cls.web_job = cls.web["jobs"]["gates"]
        cls.settings_job = cls.settings["jobs"]["matrix"]

    def test_original_api_image_memory_and_independent_consumer_jobs_are_structurally_unchanged(self):
        for name, job in self.contract["unchanged_jobs"].items():
            with self.subTest(job=name):
                self.assertEqual(self.main["jobs"][name], job)

    def test_reader_has_its_original_independent_workflow_without_the_unconsumed_api_dependency(self):
        self.assertEqual(self.main["jobs"]["reading-performance-comparison"],
                         self.contract["reader_job_without_unconsumed_api_dependency"])
        self.assertNotIn("needs", self.main["jobs"]["reading-performance-comparison"])
        comparison = read(".github/workflows/reading-performance.yml")
        self.assertIn("for phase in baseline candidate; do", comparison)
        self.assertIn('exit "$candidate_failed"', comparison)
        self.assertNotIn("download-artifact", comparison)

    def test_two_explicit_callers_per_family_have_no_shared_runner_or_cross_quality_dependency(self):
        self.assertEqual(len(self.main["jobs"]), 10)
        for family, filename in [
            ("web", "web-quality.yml"), ("settings", "settings-browser-shard.yml"),
        ]:
            for index in (1, 2):
                with self.subTest(family=family, shard=index):
                    self.assertEqual(self.main["jobs"][f"{family}-quality-shard-{index}"], {
                        "if": "${{ inputs.quality_source_run_id == '' }}",
                        "uses": f"./.github/workflows/{filename}", "with": {"shard": index},
                    })
        for workflow, name in [(self.web, "gates"), (self.settings, "matrix")]:
            self.assertEqual(set(workflow["jobs"]), {name})
            self.assertEqual(workflow["jobs"][name]["runs-on"], "ubuntu-latest")
            self.assertNotIn("strategy", workflow["jobs"][name])
            self.assertNotIn("needs", workflow["jobs"][name])

    def test_aggregators_require_both_fresh_successful_shards_and_keep_original_build_dependencies(self):
        for family in ("web", "settings"):
            job = self.main["jobs"][f"{family}-quality"]
            dependencies = [f"{family}-quality-shard-{index}" for index in (1, 2)]
            self.assertEqual(job["needs"], dependencies)
            self.assertEqual(job["if"], "${{ !cancelled() && inputs.quality_source_run_id == '' && "
                             + " && ".join(f"needs.{name}.result == 'success'" for name in dependencies) + " }}")
        self.assertEqual(self.main["jobs"]["build-images"]["needs"], [
            "api-quality", "web-quality", "settings-quality", "reading-performance-comparison",
        ])

    def test_every_original_web_command_environment_and_assigned_gate_executes_without_reduction(self):
        steps = self.web_job["steps"]
        for original in self.contract["web_steps"]:
            with self.subTest(step=original["name"]):
                current = named(steps, original["name"])
                assigned = self.contract["web_assignment"].get(original["name"])
                self.assertEqual(current.get("if"),
                                 f"${{{{ inputs.shard == {assigned} }}}}" if assigned else original.get("if"))
                self.assertEqual({key: value for key, value in current.items() if not (assigned and key == "if")},
                                 original)

    def test_web_gate_partition_and_all_node_browser_evidence_paths_are_retained(self):
        original_ids = [gate for group in self.contract["web_gate_groups"] for gate in group]
        self.assertEqual(len(original_ids), 14)
        self.assertEqual(len(original_ids), len(set(original_ids)))
        summary = named(self.web_job["steps"], "Build machine-readable browser gate summary")
        expected = ("${{ inputs.shard == 1 && '" + ",".join(self.contract["web_gate_groups"][0])
                    + "' || '" + ",".join(self.contract["web_gate_groups"][1]) + "' }}")
        self.assertEqual(summary["env"]["PLAYWRIGHT_EXPECTED_GATES"], expected)
        upload = named(self.web_job["steps"], "Upload non-deployable quality evidence")
        self.assertEqual(upload["with"]["path"], self.contract["web_original_artifact_paths"])
        self.assertIn("$RUNNER_TEMP/web-shards", named(
            self.main["jobs"]["web-quality"]["steps"], "Require the complete original Web gate union",
        )["run"])
        final_upload = named(self.main["jobs"]["web-quality"]["steps"], "Upload non-deployable quality evidence")
        self.assertIn("${{ runner.temp }}/web-shards", final_upload["with"]["path"])

    def test_reusable_workflows_explicitly_keep_every_original_global_fixture_input(self):
        self.assertEqual(self.main["env"], self.contract["global_env"])
        for workflow in (self.web, self.settings):
            self.assertEqual(workflow["env"], self.contract["global_env"])
        self.assertEqual(self.main["jobs"]["settings-quality"]["env"], self.contract["settings_env"])
        expected = {
            **self.contract["settings_env"],
            "PLAYWRIGHT_GATE_ID": "${{ format('settings-stages-1-4-shard-{0}', inputs.shard) }}",
            "CI_QUALITY_SHARD": "${{ inputs.shard }}",
        }
        self.assertEqual(self.settings_job["env"], expected)

    def test_native_reporter_paths_use_step_env_where_the_runner_context_is_available(self):
        matrix = named(self.settings_job["steps"], self.contract["settings_matrix"]["name"])
        self.assertEqual(matrix["env"], {
            **self.contract["settings_matrix"]["env"],
            "PLAYWRIGHT_BLOB_OUTPUT_DIR": "${{ runner.temp }}/settings-blob-report",
            "PLAYWRIGHT_JSON_OUTPUT_NAME": "${{ runner.temp }}/settings-shard-report.json",
        })
        self.assertFalse(any("${{ runner." in str(value) for value in self.settings_job["env"].values()))

    def test_settings_matrix_only_adds_native_sharding_and_a_separate_shard_summary(self):
        original = self.contract["settings_matrix"]
        current = named(self.settings_job["steps"], original["name"])
        command = ("pnpm --filter web exec playwright test --config=playwright.config.ts "
                   "'e2e/settings-.*\\.spec\\.ts' e2e/context-admin-bundles.spec.ts")
        expected_run = original["run"].replace(command, command + ' --shard="$CI_QUALITY_SHARD/2"').replace(
            "PLAYWRIGHT_EXPECTED_GATES=settings-stages-1-4 node apps/web/e2e/gate-summary.mjs apps/web/test-results apps/web/test-results/settings-gate-summary.json",
            'PLAYWRIGHT_EXPECTED_GATES="$PLAYWRIGHT_GATE_ID" node apps/web/e2e/gate-summary.mjs apps/web/test-results apps/web/test-results/settings-shard-gate-summary.json',
        )
        self.assertEqual(current, {
            **original,
            "env": {
                **original["env"],
                "PLAYWRIGHT_BLOB_OUTPUT_DIR": "${{ runner.temp }}/settings-blob-report",
                "PLAYWRIGHT_JSON_OUTPUT_NAME": "${{ runner.temp }}/settings-shard-report.json",
            },
            "run": expected_run,
        })
        self.assertNotIn(original["name"], [step.get("name") for step in self.main["jobs"]["settings-quality"]["steps"]])

    def test_original_independent_restore_command_and_its_fresh_database_are_unchanged(self):
        original = self.contract["settings_restore"]
        current = named(self.main["jobs"]["settings-quality"]["steps"], original["name"])
        self.assertEqual(current, original)
        self.assertIn('CREATE DATABASE "chat_reader_archive_restore"', current["run"])
        self.assertFalse(any(step.get("name") == original["name"] for step in self.settings_job["steps"]))

    def test_native_blob_and_json_merge_precedes_restore_and_is_not_a_count_only_echo(self):
        steps = self.main["jobs"]["settings-quality"]["steps"]
        merge = named(steps, "Collect original Settings selection and merge genuine Playwright blobs")
        self.assertEqual(merge["env"], {"E2E_CONTEXT_ADMIN": "1"})
        self.assertIn("--list --reporter=json", merge["run"])
        self.assertIn("playwright merge-reports --reporter=json", merge["run"])
        self.assertIn("quality-shard-evidence.mjs merge-settings", merge["run"])
        self.assertLess(steps.index(merge), steps.index(named(steps, self.contract["settings_restore"]["name"])))
        self.assertNotRegex(merge["run"], r"echo.*(?:470|passed)|\|\| true|exit 0|--(?:grep|workers|retries)")
        source = read("scripts/ci/quality-shard-evidence.mjs")
        self.assertIn("export const SETTINGS_CASE_COUNT = 470", source)
        self.assertIn("test.results.length === 1", source)
        self.assertIn('result.status === "passed" && result.retry === 0', source)
        self.assertIn("sameIds([...union.keys()], [...expected.keys()]", source)
        self.assertIn("isDeepStrictEqual(entry, union.get(id))", source)

    def test_original_native_deadlines_serial_workers_and_no_project_total_timeout_remain(self):
        config = read("apps/web/playwright.config.ts")
        for value in ["timeout: 90_000", "expect: { timeout: 60_000 }", "fullyParallel: false", "workers: 1"]:
            self.assertIn(value, config)
        for file in [
            ".github/workflows/build-release-images.yml", ".github/workflows/web-quality.yml",
            ".github/workflows/settings-browser-shard.yml", ".github/workflows/reading-performance.yml",
        ]:
            value = read(file)
            self.assertNotRegex(value, re.compile(r"^\s*timeout-minutes:|continue-on-error:", re.M), file)
        self.assertNotRegex(read(".github/workflows/settings-browser-shard.yml"),
                            r"--(?:grep|grep-invert|workers|retries|max-failures)")

    def test_original_settings_source_hashes_bind_body_level_timeouts_without_changing_case_budgets(self):
        sources = self.contract["settings_test_source_lf_sha256"]
        self.assertEqual(len(sources), 60)
        self.assertEqual(self.contract["settings_original_test_revision"],
                         "71342129b861925692f5ea587d2f3ab2fa3404f9")
        for filename, expected in sources.items():
            with self.subTest(source=filename):
                raw = (REPO / "apps/web/e2e" / filename).read_bytes().replace(b"\r\n", b"\n")
                self.assertEqual(hashlib.sha256(raw).hexdigest(), expected)
        overrides = self.contract["settings_runtime_timeout_overrides"]
        self.assertEqual(len(overrides), 54)
        locations = [(item["file"], item["line"], item["column"]) for item in overrides]
        self.assertEqual(len(locations), len(set(locations)))
        self.assertTrue(all(item["file"] in sources and 90_000 <= item["timeout"] <= 180_000
                            for item in overrides))
        helper = read("scripts/ci/quality-shard-evidence.mjs")
        self.assertIn(CONTRACT_SHA256, helper)
        self.assertIn("sourceSha, frozenSettingsRuntimeTimeouts(collection)", helper)

    def test_shard_evidence_is_named_by_source_attempt_and_never_overwritten(self):
        for family, job in [("web", self.web_job), ("settings", self.settings_job)]:
            upload = next(step for step in job["steps"] if "actions/upload-artifact@" in step.get("uses", ""))
            self.assertEqual(upload["with"]["name"],
                             f"{family}-quality-shard-${{{{ inputs.shard }}}}-${{{{ github.sha }}}}-${{{{ github.run_attempt }}}}")
            self.assertNotIn("overwrite", upload["with"])
        settings_upload = named(self.main["jobs"]["settings-quality"]["steps"], "Upload settings quality evidence")
        for file in ["settings-shards", "settings-merged-blobs", "settings-full-collection.json", "settings-merged-report.json"]:
            self.assertIn("${{ runner.temp }}/" + file, settings_upload["with"]["path"])

    def test_full_provenance_requires_all_fixed_shard_names_but_historical_reuse_stays_exact_six(self):
        spec = importlib.util.spec_from_file_location("quality_scheduling_policy", REPO / "scripts/ci/image-only-quality-reuse.py")
        policy = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(policy)
        self.assertEqual(policy.QUALITY_NAMES, (
            "api-quality", "web-quality", "settings-quality", "reading-performance-comparison / compare",
        ))
        expected = [
            "api-quality", "web-quality-shard-1 / gates", "web-quality-shard-2 / gates", "web-quality",
            "settings-quality-shard-1 / matrix", "settings-quality-shard-2 / matrix", "settings-quality",
            "reading-performance-comparison / compare",
        ]
        self.assertEqual(list(policy.FULL_QUALITY_NAMES), expected)
        self.assertEqual(policy.BASE_RUN, "43578495558")
        self.assertEqual(policy.BASE_ATTEMPT, 1)
        self.assertEqual(policy.REPAIR_SHA, "74f4636e9d29098fb9a30bb42bdb7ada696373f8")
        self.assertEqual(policy.PATCH_SHA256, "7c64c286ccb658c6c4f80a2868744c843fe3a036f51d66c41fbd155e02b47d01")
        self.assertEqual(policy.SELECTOR_PATCH_SHA256, "c73ffa3cc3d1dd9e046be767522eb7071a3ed4f9f90665cd86f835f2d224144f")


if __name__ == "__main__":
    unittest.main()
