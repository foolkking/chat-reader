"""Exact execution-contract controls for isolated full-CI scheduling only."""
from __future__ import annotations

import hashlib
import copy
import importlib.util
import json
from pathlib import Path
import re
import unittest

import yaml
from quality_schedule import load_schedule
from quality_dag import validate_dag


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
        cls.schedule = load_schedule()
        cls.api = load(".github/workflows/api-quality-shard.yml")

    def test_original_api_image_memory_and_independent_consumer_contracts_are_retained(self):
        originals = self.contract["unchanged_jobs"]
        original_api = originals["api-quality"]
        current = self.api["jobs"]["suite"]
        self.assertEqual(current["env"], {**original_api["env"], "CI_QUALITY_SHARD": "${{ inputs.shard }}"})
        for step in original_api["steps"]:
            if step.get("name") == "API full suite":
                actual = named(current["steps"], step["name"])
                self.assertEqual(actual["env"], step["env"])
                for part in ["pytest -vv --capture=tee-sys -o faulthandler_timeout=120",
                             "-p api_shard_plugin", '--ci-shard="$CI_QUALITY_SHARD"',
                             '--ci-evidence="$RUNNER_TEMP/api-execution.json"',
                             '--junitxml="$RUNNER_TEMP/api-junit.xml"']:
                    self.assertIn(part, actual["run"])
                self.assertNotRegex(actual["run"], r"--(?:ignore|deselect|lf|ff|maxfail)|\|\| true|pytest.* -[km] ")
            else:
                self.assertIn(step, current["steps"])
        prepared = self.main["jobs"]["image-preparation"]
        original_build = originals["build-images"]
        self.assertEqual(prepared["env"], original_build["env"])
        start = next(i for i, step in enumerate(original_build["steps"]) if "docker/setup-buildx-action@" in step.get("uses", ""))
        end = original_build["steps"].index(named(original_build["steps"], "Package images and provenance"))
        positions = [prepared["steps"].index(step) for step in original_build["steps"][start:end]]
        self.assertEqual(positions, sorted(positions), "Original image build and all five memory gates keep order")
        inspector = dict(self.main["jobs"]["inspect-release-artifact"])
        inspector["steps"] = inspector["steps"][:-1]
        self.assertEqual(inspector, originals["inspect-release-artifact"])

    def test_reader_has_its_original_independent_workflow_without_the_unconsumed_api_dependency(self):
        self.assertEqual(self.main["jobs"]["reading-performance-comparison"],
                         self.contract["reader_job_without_unconsumed_api_dependency"])
        self.assertNotIn("needs", self.main["jobs"]["reading-performance-comparison"])
        comparison = read(".github/workflows/reading-performance.yml")
        self.assertIn("for phase in baseline candidate; do", comparison)
        self.assertIn('exit "$candidate_failed"', comparison)
        self.assertNotIn("download-artifact", comparison)

    def test_fixed_explicit_callers_have_no_shared_runner_or_cross_quality_dependency(self):
        self.assertEqual(len(self.main["jobs"]), 19)
        for family, filename, count in [
            ("api", "api-quality-shard.yml", 4), ("web", "web-quality.yml", 3),
            ("settings", "settings-browser-shard.yml", 4),
        ]:
            for index in range(1, count + 1):
                with self.subTest(family=family, shard=index):
                    self.assertEqual(self.main["jobs"][f"{family}-quality-shard-{index}"], {
                        "if": "${{ inputs.quality_source_run_id == '' }}",
                        "uses": f"./.github/workflows/{filename}", "with": {"shard": index},
                    })
        for workflow, name in [(self.web, "gates"), (self.settings, "matrix"), (self.api, "suite")]:
            self.assertEqual(set(workflow["jobs"]), {name})
            self.assertEqual(workflow["jobs"][name]["runs-on"], "ubuntu-latest")
            self.assertNotIn("strategy", workflow["jobs"][name])
            self.assertNotIn("needs", workflow["jobs"][name])

    def test_aggregators_require_all_fresh_shards_restore_and_original_build_dependencies(self):
        for family, count in (("api", 4), ("web", 3), ("settings", 4)):
            job = self.main["jobs"][f"{family}-quality"]
            dependencies = [f"{family}-quality-shard-{index}" for index in range(1, count + 1)]
            if family == "settings":
                dependencies.append("settings-restore")
            self.assertEqual(job["needs"], dependencies)
            self.assertEqual(job["if"], "${{ !cancelled() && inputs.quality_source_run_id == '' && "
                             + " && ".join(f"needs.{name}.result == 'success'" for name in dependencies) + " }}")
        self.assertEqual(self.main["jobs"]["build-images"]["needs"], [
            "api-quality", "web-quality", "settings-quality", "reading-performance-comparison", "image-preparation",
        ])

    def test_every_original_web_command_environment_and_assigned_gate_executes_without_reduction(self):
        steps = self.web_job["steps"]
        for original in self.contract["web_steps"]:
            with self.subTest(step=original["name"]):
                current = named(steps, original["name"])
                assigned = self.schedule["web"]["assignment"].get(original["name"])
                self.assertEqual(current.get("if"),
                                 f"${{{{ inputs.shard == {assigned} }}}}" if assigned else original.get("if"))
                self.assertEqual({key: value for key, value in current.items() if not (assigned and key == "if")},
                                 original)

    def test_product_component_gate_is_required_and_retains_its_evidence(self):
        def check(web):
            validate_dag(self.main)
            steps = web["jobs"]["gates"]["steps"]
            gate = named(steps, "Import batch disposition and scoped navigation layouts")
            self.assertEqual(gate, {
                "name": "Import batch disposition and scoped navigation layouts",
                "if": "${{ inputs.shard == 1 }}",
                "env": {"PLAYWRIGHT_USE_BUNDLED_CHROMIUM": "1"},
                "run": "node scripts/ux/import-batch-browser.mjs\nnode scripts/ux/navigation-import-layout-browser.mjs\n",
            })
            upload = named(steps, "Preserve navigation and import component evidence")
            self.assertEqual(upload["if"], "${{ always() && inputs.shard == 1 }}")
            self.assertNotIn("continue-on-error", upload)
            self.assertEqual(upload["with"]["if-no-files-found"], "error")
            for name in ("import-batch-browser", "navigation-import-layout-browser"):
                for suffix in ("result.json", "failure.json", "*.png"):
                    self.assertIn("${{ runner.temp }}/" + name + "/" + suffix, upload["with"]["path"].splitlines())
        check(self.web)
        for kind in ("missing", "shard", "swallow", "continue", "evidence"):
            copy_web = copy.deepcopy(self.web)
            steps = copy_web["jobs"]["gates"]["steps"]
            gate = named(steps, "Import batch disposition and scoped navigation layouts")
            if kind == "missing":
                steps.remove(gate)
            elif kind == "shard":
                gate["if"] = "${{ inputs.shard == 2 }}"
            elif kind == "swallow":
                gate["run"] += " || true"
            elif kind == "continue":
                gate["continue-on-error"] = True
            else:
                named(steps, "Preserve navigation and import component evidence")["with"]["path"] = "missing"
            with self.subTest(kind=kind), self.assertRaises(AssertionError):
                check(copy_web)

    def test_web_gate_partition_and_all_node_browser_evidence_paths_are_retained(self):
        original_ids = [gate for group in self.contract["web_gate_groups"] for gate in group]
        self.assertEqual(len(original_ids), 14)
        self.assertEqual(len(original_ids), len(set(original_ids)))
        summary = named(self.web_job["steps"], "Build machine-readable browser gate summary")
        groups = self.schedule["web"]["gate_groups"]
        self.assertEqual(sorted(gate for group in groups for gate in group), sorted(original_ids))
        expected = ("${{ inputs.shard == 1 && '" + ",".join(groups[0])
                    + "' || inputs.shard == 2 && '" + ",".join(groups[1])
                    + "' || '" + ",".join(groups[2]) + "' }}")
        self.assertEqual(summary["env"]["PLAYWRIGHT_EXPECTED_GATES"], expected)
        upload = named(self.web_job["steps"], "Upload non-deployable quality evidence")
        self.assertEqual(upload["with"]["path"], self.contract["web_original_artifact_paths"])
        self.assertIn("$RUNNER_TEMP/web-shards", named(
            self.main["jobs"]["web-quality"]["steps"], "Require the complete original Web gate union",
        )["run"])
        final_upload = named(self.main["jobs"]["web-quality"]["steps"], "Upload non-deployable quality evidence")
        self.assertIn("${{ runner.temp }}/web-shards", final_upload["with"]["path"])

    def test_full_web_shard_runs_its_contract_controls_without_replaying_image_only_history_controls(self):
        control = named(self.web_job["steps"], "Quality scheduling source and real-report controls")
        self.assertEqual(control["if"], "${{ inputs.shard == 1 }}")
        self.assertIn("test_quality_scheduling.py", control["run"])
        self.assertIn("quality-shard-evidence.test.mjs", control["run"])
        self.assertIn("node scripts/ci/run-release-source-controls.mjs", control["run"])
        self.assertLess(self.web_job["steps"].index(control),
                        self.web_job["steps"].index(named(self.web_job["steps"], "Web production build (timed)")))
        self.assertNotIn("test_image_only", control["run"])
        image_only = named(self.main["jobs"]["build-images"]["steps"], "Image-only release policy negative controls")
        self.assertEqual(image_only["if"], "${{ inputs.quality_source_run_id != '' }}")
        self.assertIn("test_image_only_quality_reuse.py", image_only["run"])
        self.assertIn("test_image_only_selector_lineage.py", image_only["run"])

    def test_all_api_shards_require_the_original_real_migration_gate(self):
        def check(workflow):
            validate_dag(self.main)
            job = workflow["jobs"]["suite"]
            self.assertNotIn("if", job)
            self.assertNotIn("continue-on-error", job)
            gate = named(job["steps"], "Alembic single-head and current validation")
            self.assertEqual(gate, {
                "name": "Alembic single-head and current validation",
                "run": "cd apps/api\npython scripts/verify_migration_state.py --require-current\n",
            })
            self.assertGreater(job["steps"].index(gate),
                               job["steps"].index(named(job["steps"], "API full suite")))

        check(self.api)
        for key, value in (("if", "${{ false }}"), ("continue-on-error", True),
                           ("run", "echo migration-passed"), ("run", "python -m alembic heads"),
                           ("run", "cd apps/api\npython scripts/verify_migration_state.py --require-current || true\n")):
            with self.subTest(key=key, value=value):
                unsafe = copy.deepcopy(self.api)
                named(unsafe["jobs"]["suite"]["steps"], "Alembic single-head and current validation")[key] = value
                with self.assertRaises(AssertionError):
                    check(unsafe)

    def test_reusable_workflows_explicitly_keep_every_original_global_fixture_input(self):
        self.assertEqual(self.main["env"], self.contract["global_env"])
        for workflow in (self.web, self.settings, self.api):
            self.assertEqual(workflow["env"], self.contract["global_env"])
        self.assertEqual(self.main["jobs"]["settings-quality"]["env"], self.contract["settings_env"])
        self.assertEqual(self.main["jobs"]["settings-restore"]["env"], self.contract["settings_env"])
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
            "PLAYWRIGHT_BLOB_OUTPUT_NAME": "settings-${{ inputs.shard }}.zip",
        })
        self.assertFalse(any("${{ runner." in str(value) for value in self.settings_job["env"].values()))

    def test_settings_matrix_only_adds_reviewed_whole_file_selection_and_separate_summary(self):
        original = self.contract["settings_matrix"]
        current = named(self.settings_job["steps"], original["name"])
        command = ("pnpm --filter web exec playwright test --config=playwright.config.ts "
                   "'e2e/settings-.*\\.spec\\.ts' e2e/context-admin-bundles.spec.ts")
        expected_run = original["run"].replace(command, "node scripts/ci/run-settings-shard.mjs").replace(
            "PLAYWRIGHT_EXPECTED_GATES=settings-stages-1-4 node apps/web/e2e/gate-summary.mjs apps/web/test-results apps/web/test-results/settings-gate-summary.json",
            'PLAYWRIGHT_EXPECTED_GATES="$PLAYWRIGHT_GATE_ID" node apps/web/e2e/gate-summary.mjs apps/web/test-results apps/web/test-results/settings-shard-gate-summary.json',
        )
        self.assertEqual(current, {
            **original,
            "env": {
                **original["env"],
                "PLAYWRIGHT_BLOB_OUTPUT_DIR": "${{ runner.temp }}/settings-blob-report",
                "PLAYWRIGHT_JSON_OUTPUT_NAME": "${{ runner.temp }}/settings-shard-report.json",
                "PLAYWRIGHT_BLOB_OUTPUT_NAME": "settings-${{ inputs.shard }}.zip",
            },
            "run": expected_run,
        })
        self.assertNotIn(original["name"], [step.get("name") for step in self.main["jobs"]["settings-quality"]["steps"]])

    def test_original_independent_restore_command_and_its_fresh_database_are_unchanged(self):
        original = self.contract["settings_restore"]
        job = self.main["jobs"]["settings-restore"]
        current = named(job["steps"], original["name"])
        self.assertNotIn("needs", job)
        self.assertEqual(job["if"], "${{ inputs.quality_source_run_id == '' }}")
        self.assertEqual(current["run"], original["run"].replace(
            "PLAYWRIGHT_EXPECTED_GATES=settings-stages-1-4,system-archive-new-instance",
            "PLAYWRIGHT_EXPECTED_GATES=system-archive-new-instance"))
        self.assertEqual(current["env"], {
            "PLAYWRIGHT_JSON_OUTPUT_NAME": "${{ runner.temp }}/settings-restore-report.json",
            "PLAYWRIGHT_BLOB_OUTPUT_DIR": "${{ runner.temp }}/settings-restore-blob",
            "PLAYWRIGHT_BLOB_OUTPUT_NAME": "restore.zip",
        })
        self.assertIn('CREATE DATABASE "chat_reader_archive_restore"', current["run"])
        self.assertFalse(any(step.get("name") == original["name"] for step in self.settings_job["steps"]))

    def test_native_blob_and_json_aggregate_requires_independent_restore_and_no_services(self):
        steps = self.main["jobs"]["settings-quality"]["steps"]
        merge = named(steps, "Collect original Settings selection and merge genuine Playwright blobs")
        self.assertEqual(merge["env"], {"E2E_CONTEXT_ADMIN": "1"})
        self.assertIn("--list --reporter=json", merge["run"])
        self.assertIn("playwright merge-reports --reporter=json", merge["run"])
        self.assertIn("quality-shard-evidence.mjs merge-settings", merge["run"])
        body = json.dumps(steps)
        self.assertNotRegex(body, r"uvicorn|import_worker|alembic|postgres-service|pnpm --filter web build|playwright install")
        self.assertIn("quality-shard-evidence.mjs verify-restore", body)
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
            ".github/workflows/api-quality-shard.yml",
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
            *[f"api-quality-shard-{i} / suite" for i in range(1, 5)], "api-quality",
            *[f"web-quality-shard-{i} / gates" for i in range(1, 4)], "web-quality",
            *[f"settings-quality-shard-{i} / matrix" for i in range(1, 5)],
            "settings-restore", "settings-quality", "reading-performance-comparison / compare", "image-preparation",
        ]
        self.assertEqual(list(policy.FULL_QUALITY_NAMES), expected)
        self.assertEqual(policy.BASE_RUN, "43578495558")
        self.assertEqual(policy.BASE_ATTEMPT, 1)
        self.assertEqual(policy.REPAIR_SHA, "74f4636e9d29098fb9a30bb42bdb7ada696373f8")
        self.assertEqual(policy.PATCH_SHA256, "7c64c286ccb658c6c4f80a2868744c843fe3a036f51d66c41fbd155e02b47d01")
        self.assertEqual(policy.SELECTOR_PATCH_SHA256, "c73ffa3cc3d1dd9e046be767522eb7071a3ed4f9f90665cd86f835f2d224144f")

    def test_preparation_is_non_deployable_and_full_publisher_cannot_rebuild(self):
        prep = self.main["jobs"]["image-preparation"]
        self.assertNotIn("needs", prep)
        self.assertEqual(prep["if"], "${{ inputs.quality_source_run_id == '' }}")
        upload = named(prep["steps"], "Upload non-deployable image candidate only")
        self.assertEqual(upload["with"]["name"], "non-deployable-image-candidate-${{ github.sha }}-${{ github.run_attempt }}")
        self.assertNotIn("release-manifest.json", upload["with"]["path"])
        publisher = self.main["jobs"]["build-images"]
        self.assertIn("needs.image-preparation.result == 'success'", publisher["if"])
        for step in publisher["steps"]:
            if "docker build " in step.get("run", ""):
                self.assertEqual(step["if"], "${{ inputs.quality_source_run_id != '' }}")
        promote = named(publisher["steps"], "Promote exact prepared candidate after every quality gate")
        self.assertEqual(promote["if"], "${{ inputs.quality_source_run_id == '' }}")
        self.assertIn("--artifact-id", promote["run"])
        self.assertIn("--artifact-digest", promote["run"])
        self.assertIn("--quality", promote["run"])
        self.assertNotIn("continue-on-error", promote)

    def test_real_dag_and_missing_wrong_skipped_or_bypassed_edges(self):
        validate_dag(self.main)
        mutations = []
        for family, count in (("api", 4), ("web", 3), ("settings", 4)):
            for index in range(1, count + 1):
                name = f"{family}-quality-shard-{index}"
                mutations += [
                    (name + " missing", lambda d, n=name: d["jobs"].pop(n)),
                    (name + " wrong assignment", lambda d, n=name: d["jobs"][n]["with"].update(shard=0)),
                    (name + " conditional bypass", lambda d, n=name: d["jobs"][n].update({"continue-on-error": True})),
                ]
            mutations.append((family + " omitted dependency", lambda d, f=family: d["jobs"][f"{f}-quality"]["needs"].pop()))
        for name in ("settings-restore", "image-preparation"):
            mutations.append((name + " late", lambda d, n=name: d["jobs"][n].update(needs="api-quality")))
        for name in ("api-quality", "web-quality", "settings-quality", "image-preparation"):
            mutations.append((name + " unpublished dependency", lambda d, n=name: d["jobs"]["build-images"]["needs"].remove(n)))
        mutations += [
            ("wrong candidate artifact", lambda d: named(d["jobs"]["build-images"]["steps"],
             "Promote exact prepared candidate after every quality gate")["env"].update(CANDIDATE_ARTIFACT_ID="123")),
            ("early deployable manifest", lambda d: named(d["jobs"]["image-preparation"]["steps"],
             "Upload non-deployable image candidate only")["with"].update(path="release-manifest.json")),
            ("consumer bypass", lambda d: d["jobs"]["inspect-release-artifact"].update({"continue-on-error": True})),
        ]
        for name, mutate in mutations:
            with self.subTest(mutation=name):
                changed = copy.deepcopy(self.main)
                mutate(changed)
                with self.assertRaises((AssertionError, KeyError)):
                    validate_dag(changed)


if __name__ == "__main__":
    unittest.main()
