"""Additive controls for the separately approved, exact selector-repair lineage."""
from __future__ import annotations

import copy
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location(
    "image_only_selector_quality_gate", Path(__file__).with_name("image-only-quality-reuse.py"),
)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
HEAD = "b" * 40


class ExactSelectorLineageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Real immutable source/repair trees, not a permissive synthetic parent.
        cls.source_tree = gate.tree(gate.BASE_SHA)
        cls.repair_tree = gate.tree(gate.REPAIR_SHA)
        cls.blobs = {}
        for name in (gate.HELPER, gate.WORKFLOW, gate.SELECTOR, gate.SELECTOR_TEST, gate.PATCH):
            for entries in (cls.source_tree, cls.repair_tree):
                if name in entries:
                    object_id = entries[name][1]
                    cls.blobs[object_id] = gate.git("cat-file", "blob", object_id)
        cls.repair_bytes = {
            name: (gate.REPO / name).read_bytes().replace(b"\r\n", b"\n")
            for name in (
                gate.WORKFLOW, gate.POLICY_SCRIPT, gate.SELECTOR_TEST,
                gate.SELECTOR_PATCH, gate.SELECTOR_CONTROL_TEST,
            )
        }
        # Historical byte evidence is deliberately NOT newline-normalized.
        cls.repair_bytes.update({
            name: (gate.REPO / name).read_bytes() for name in gate.SELECTOR_HISTORICAL_EVIDENCE
        })

    def setUp(self):
        self.source = copy.deepcopy(self.source_tree)
        self.previous = copy.deepcopy(self.repair_tree)
        self.candidate = copy.deepcopy(self.previous)
        self.objects = dict(self.blobs)
        self.candidate.update({name: self.put(value) for name, value in self.repair_bytes.items()})

    def put(self, value, mode="100644"):
        object_id = hashlib.sha256(value).hexdigest()
        self.objects[object_id] = value
        return mode, object_id

    def read(self, object_id):
        if object_id not in self.objects:
            self.objects[object_id] = gate.git("cat-file", "blob", object_id)
        return self.objects[object_id]

    def verify(self, *, parents=None, repair_parents=None, head=HEAD):
        return gate.verify_selector_lineage(
            self.source, self.previous, self.candidate, self.read,
            [gate.BASE_SHA] if repair_parents is None else repair_parents,
            [gate.REPAIR_SHA] if parents is None else parents, head,
        )

    def test_exact_fixed_two_edge_chain_and_selector_bytes_are_accepted(self):
        result = self.verify()
        self.assertEqual(result["verified_lineage"], [gate.BASE_SHA, gate.REPAIR_SHA, HEAD])
        self.assertEqual(result["policy"], gate.SELECTOR_POLICY)
        self.assertEqual(result["previous_repair_tree_sha256"], gate.REPAIR_TREE_SHA256)
        self.assertTrue(result["direct_repair_parent_verified"])
        self.assertTrue(result["previous_repair_parent_verified"])
        self.assertTrue(result["exact_selector_fixture_fix_verified"])
        self.assertEqual(result["approved_existing_selector_test_changes"], 1)
        self.assertEqual(result["application_dependency_and_quality_test_changes"], 0)

    def test_original_strict_repair_proof_is_recomputed_not_replaced(self):
        result = self.verify()["previous_repair_source_equivalence"]
        self.assertEqual(result["candidate_sha"], gate.REPAIR_SHA)
        self.assertEqual(result["base_sha"], gate.BASE_SHA)
        self.assertEqual(result["policy"], gate.POLICY)
        self.assertEqual(result["workflow_patch_sha256"], gate.PATCH_SHA256)
        self.assertTrue(result["exact_null_failure_fix_verified"])
        self.assertEqual(result["application_dependency_and_existing_test_changes"], 0)

    def test_used_direct4481_authorization_is_not_available_to_a_new_candidate(self):
        with self.assertRaisesRegex(gate.GateError, "fixed74f"):
            self.verify(parents=[gate.BASE_SHA])

    def test_wrong_root_parent_extra_parent_or_merge_is_rejected(self):
        for parents in ([], ["c" * 40], [gate.REPAIR_SHA, gate.BASE_SHA],
                        [gate.REPAIR_SHA, gate.REPAIR_SHA]):
            with self.subTest(parents=parents), self.assertRaisesRegex(gate.GateError, "direct, non-merge"):
                self.verify(parents=parents)

    def test_previous_repair_cannot_have_a_different_or_merge_parent(self):
        for parents in ([], [HEAD], [gate.BASE_SHA, HEAD], [gate.BASE_SHA, gate.BASE_SHA]):
            with self.subTest(parents=parents), self.assertRaisesRegex(gate.GateError, "exact4481"):
                self.verify(repair_parents=parents)

    def test_candidate_sha_must_be_new_full_and_lowercase(self):
        for head in ("74f4636", "B" * 40, "b" * 39, gate.REPAIR_SHA):
            with self.subTest(head=head), self.assertRaisesRegex(gate.GateError, "full lowercase"):
                self.verify(head=head)

    def test_entire_previous_mode_blob_tree_is_pinned_including_documentation(self):
        self.previous["PROJECT_STATE.md"] = self.put(b"mutated previous documentation")
        with self.assertRaisesRegex(gate.GateError, "complete Git mode/blob tree"):
            self.verify()

    def test_previous_control_mode_mutation_is_rejected(self):
        self.previous[gate.PATCH] = ("100755", self.previous[gate.PATCH][1])
        with self.assertRaisesRegex(gate.GateError, "complete Git mode/blob tree"):
            self.verify()

    def test_source_application_mutation_still_fails_the_original_strict_proof(self):
        self.source["pnpm-lock.yaml"] = self.put(b"a different original dependency graph")
        with self.assertRaisesRegex(gate.GateError, "unapproved file"):
            self.verify()

    def test_original_helper_source_is_still_sha_bound(self):
        self.source[gate.HELPER] = self.put(self.read(self.source[gate.HELPER][1]) + b"\n")
        with self.assertRaisesRegex(gate.GateError, "reviewed failure source"):
            self.verify()

    def test_original_source_workflow_is_still_sha_bound(self):
        self.source[gate.WORKFLOW] = self.put(self.read(self.source[gate.WORKFLOW][1]) + b"\n")
        with self.assertRaisesRegex(gate.GateError, "reviewed base"):
            self.verify()

    def test_application_dependency_quality_fixture_migration_and_memory_changes_are_rejected(self):
        paths = (
            "apps/api/app/workers/import_worker.py",
            "apps/api/tests/test_worker_supervisor.py",
            "apps/api/tests/test_supervised_execution_postgres.py",
            "apps/web/app/layout.tsx",
            "apps/web/e2e/settings-offline-recovery.spec.ts",
            "apps/web/playwright.config.ts",
            "scripts/ci/small-import-memory-gate.py",
            "scripts/ci/bounded-import-memory-gate.py",
            ".github/workflows/reading-performance.yml",
            "pnpm-lock.yaml", "package.json", "apps/web/package.json",
            "apps/api/requirements-runtime.lock",
            "apps/api/requirements-test.lock",
            "apps/api/requirements-build.lock",
            "docker-compose.production.yml",
            "apps/api/Dockerfile", "apps/web/Dockerfile",
            "apps/api/alembic/versions/20261112_0061_task_execution_control.py",
        )
        for name in paths:
            self.assertIn(name, self.previous)
            original = self.candidate[name]
            self.candidate[name] = self.put(b"unapproved mutation")
            with self.subTest(path=name), self.assertRaisesRegex(gate.GateError, "unapproved selector-repair"):
                self.verify()
            self.candidate[name] = original

    def test_no_additional_helper_or_orm_control_change_is_authorized(self):
        for name in (gate.HELPER, "apps/api/scripts/test_verify_small_zip_memory.py"):
            original = self.candidate[name]
            self.candidate[name] = self.put(b"changed helper or memory fixture")
            with self.subTest(path=name), self.assertRaisesRegex(gate.GateError, "unapproved selector-repair"):
                self.verify()
            self.candidate[name] = original

    def test_original37_controls_and_original_workflow_patch_remain_immutable(self):
        for name in ("scripts/ci/test_image_only_quality_reuse.py", gate.PATCH):
            original = self.candidate[name]
            self.candidate[name] = self.put(b"relaxed old controls")
            with self.subTest(path=name), self.assertRaisesRegex(gate.GateError, "unapproved selector-repair"):
                self.verify()
            self.candidate[name] = original

    def test_selector_implementation_cannot_change(self):
        self.candidate[gate.SELECTOR] = self.put(b"always skip quality")
        with self.assertRaisesRegex(gate.GateError, "unapproved selector-repair"):
            self.verify()

    def test_exact_approved_selector_test_digest_is_not_a_generic_test_exception(self):
        original = self.repair_bytes[gate.SELECTOR_TEST]
        for value in (original + b"\n", original.replace(b"full_gate_required, true", b"full_gate_required, false"),
                      original.replace(b"timeout: 10_000", b"timeout: 60_000")):
            self.assertNotEqual(value, original)
            self.candidate[gate.SELECTOR_TEST] = self.put(value)
            with self.subTest(digest=gate.digest(value)), self.assertRaisesRegex(gate.GateError, "exact approved"):
                self.verify()

    def test_previous_selector_test_must_be_the_reviewed_failure_bytes(self):
        self.source[gate.SELECTOR_TEST] = self.put(b"another selector baseline")
        with self.assertRaisesRegex(gate.GateError, "unapproved file"):
            self.verify()

    def test_every_required_control_must_be_new_or_changed_as_declared(self):
        for name in (gate.WORKFLOW, gate.POLICY_SCRIPT, gate.SELECTOR_TEST,
                     gate.SELECTOR_PATCH, gate.SELECTOR_CONTROL_TEST):
            original = self.candidate[name]
            if name in self.previous:
                self.candidate[name] = self.previous[name]
            else:
                del self.candidate[name]
            with self.subTest(path=name), self.assertRaisesRegex(gate.GateError, "All exact selector repair"):
                self.verify()
            self.candidate[name] = original

    def test_removed_required_existing_source_cannot_be_replaced_by_a_new_control(self):
        del self.candidate[gate.SELECTOR_TEST]
        with self.assertRaisesRegex(gate.GateError, "Deletion"):
            self.verify()

    def test_control_executable_and_link_modes_are_rejected(self):
        for name in (gate.POLICY_SCRIPT, gate.SELECTOR_TEST, gate.SELECTOR_PATCH, gate.SELECTOR_CONTROL_TEST):
            original = self.candidate[name]
            for mode in ("100755", "120000"):
                self.candidate[name] = (mode, original[1])
                with self.subTest(path=name, mode=mode), self.assertRaisesRegex(gate.GateError, "link/mode"):
                    self.verify()
            self.candidate[name] = original

    def test_only_the_nine_owned_existing_document_paths_are_allowed(self):
        for name in gate.DOC_PATHS:
            self.assertIn(name, self.previous)
            self.candidate[name] = self.put(b"current scoped documentation facts")
        self.assertTrue(gate.DOC_PATHS <= set(self.verify()["selector_repair_changed_paths"]))
        self.candidate["docs/unrelated.md"] = self.put(b"unrelated documentation")
        with self.assertRaisesRegex(gate.GateError, "unapproved selector-repair"):
            self.verify()

    def test_document_deletion_or_executable_change_is_rejected(self):
        del self.candidate["PROJECT_STATE.md"]
        with self.assertRaisesRegex(gate.GateError, "Deletion"):
            self.verify()
        self.candidate["PROJECT_STATE.md"] = self.put(b"current facts", "100755")
        with self.assertRaisesRegex(gate.GateError, "executable"):
            self.verify()

    def test_unreviewed_new_test_configuration_or_evidence_is_rejected(self):
        for name in ("apps/api/tests/test_skip.py", ".env.production", "scripts/ci/unreviewed.py",
                     ".github/workflows/new.yml", "docs/evidence/reliability-2026-11-14/fake-pass.json"):
            self.candidate[name] = self.put(b"not part of this approval")
            with self.subTest(path=name), self.assertRaisesRegex(gate.GateError, "unapproved selector-repair"):
                self.verify()
            del self.candidate[name]

    def test_only_two_new_scoped_verification_receipts_can_be_added(self):
        names = gate.SELECTOR_NEW_PATHS - {
            gate.SELECTOR_PATCH, gate.SELECTOR_CONTROL_TEST, *gate.SELECTOR_HISTORICAL_EVIDENCE,
        }
        self.assertEqual(len(names), 2)
        for name in names:
            self.candidate[name] = self.put(b"independent local verification receipt")
        self.assertTrue(names <= set(self.verify()["selector_repair_changed_paths"]))

    def test_historical_dispatch_and_diagnostic_receipts_are_byte_pinned(self):
        for name, expected in gate.SELECTOR_HISTORICAL_EVIDENCE.items():
            original = self.candidate[name]
            self.assertEqual(gate.digest(self.read(original[1])), expected)
            self.candidate[name] = self.put(self.read(original[1]) + b" ")
            with self.subTest(path=name), self.assertRaisesRegex(gate.GateError, "historical selector"):
                self.verify()
            self.candidate[name] = original

    def test_historical_diagnostics_cannot_be_removed_or_reclassified(self):
        for name in gate.SELECTOR_HISTORICAL_EVIDENCE:
            original = self.candidate.pop(name)
            with self.subTest(path=name), self.assertRaisesRegex(gate.GateError, "historical selector"):
                self.verify()
            self.candidate[name] = original

    def test_new_workflow_patch_is_sha_pinned(self):
        self.candidate[gate.SELECTOR_PATCH] = self.put(self.repair_bytes[gate.SELECTOR_PATCH] + b" ")
        with self.assertRaisesRegex(gate.GateError, "selector workflow patch contract changed"):
            self.verify()

    def test_new_patch_only_applies_to_the_exact_previous_workflow(self):
        with self.assertRaisesRegex(gate.GateError, "exact previous repair workflow"):
            gate.approved_selector_workflow(
                self.read(self.previous[gate.WORKFLOW][1]) + b"\n", self.repair_bytes[gate.SELECTOR_PATCH],
            )

    def test_workflow_cannot_change_commands_resource_bounds_or_checkout_depth(self):
        original = self.repair_bytes[gate.WORKFLOW]
        for before, after in (
            (b"fetch-depth: 3", b"fetch-depth: 2"),
            (b"small-import-memory-gate.py", b"skip-memory.py"),
            (b"memory_limit_bytes == 335544320", b"memory_limit_bytes == 671088640"),
            (b"workspace_peak_delta_bytes <= 67108864", b"workspace_peak_delta_bytes <= 134217728"),
            (b".oom_kill == 0", b".oom_kill >= 0"),
            (b"e2e/settings-.*", b"e2e/settings-one"),
            (b"test_image_only_quality_reuse.py", b"test_skip_quality.py"),
            (b"node --test scripts/ci/*.test.mjs", b"true"),
        ):
            self.assertIn(before, original)
            self.candidate[gate.WORKFLOW] = self.put(original.replace(before, after))
            with self.subTest(before=before), self.assertRaisesRegex(gate.GateError, "byte-exact selector"):
                self.verify()

    def test_two_checkouts_have_three_commits_and_original_commands_are_retained(self):
        previous = self.read(self.previous[gate.WORKFLOW][1]).decode()
        current = self.repair_bytes[gate.WORKFLOW].decode()
        contract = self.repair_bytes[gate.SELECTOR_PATCH]
        self.assertEqual(gate.approved_selector_workflow(previous.encode(), contract).decode(), current)
        self.assertEqual(current.count("          fetch-depth: 3\n"), 2)
        self.assertNotIn("fetch-depth: 2", current)
        added = "          python3 -m unittest discover -s scripts/ci -p 'test_image_only_selector_lineage.py' -v\n"
        self.assertEqual(current.count(added), 1)
        self.assertEqual(
            current.replace("fetch-depth: 3", "fetch-depth: 2").replace(added, ""), previous,
        )
        self.assertNotIn("timeout-minutes:", current)

    def test_all_original_quality_job_bodies_are_identical(self):
        previous = self.read(self.previous[gate.WORKFLOW][1]).decode()
        current = self.repair_bytes[gate.WORKFLOW].decode()
        for name in gate.NEEDS_NAMES:
            marker = rf"\n  {re.escape(name)}:\n"
            def body(value):
                return re.split(r"\n  [a-z][a-z0-9-]*:\n", re.split(marker, value)[1], 1)[0]
            with self.subTest(job=name):
                self.assertEqual(body(previous), body(current))

    def test_all_original_memory_orm_build_and_consumer_order_remains(self):
        value = self.repair_bytes[gate.WORKFLOW].decode()
        order = (
            "test_image_only_quality_reuse.py", "test_image_only_selector_lineage.py",
            "node --test scripts/ci/*.test.mjs", "Record verified release quality provenance",
            "Prepare pinned image bases with official-source fallback",
            "Build API and worker image", "python3 scripts/ci/small-import-memory-gate.py",
            "python3 scripts/ci/bounded-import-memory-gate.py",
            "Verify real ORM memory-control-plane status and source guards",
            "Build Web image", "Inspect release images", "Package images and provenance",
            "Upload deployable release artifact", "Inspect downloaded release archive independently",
        )
        positions = [value.index(name) for name in order]
        self.assertEqual(positions, sorted(positions))
        self.assertIn("--verify-report quality-verification.json --manifest release-manifest.json", value)
        self.assertIn('--producer-attempt "$ARTIFACT_PRODUCER_ATTEMPT"', value)

    def test_unique_quality_source_and_empty_default_are_unchanged(self):
        value = self.repair_bytes[gate.WORKFLOW].decode()
        self.assertEqual(gate.BASE_RUN, "43578495558")
        self.assertEqual(gate.BASE_ATTEMPT, 1)
        self.assertIn("        default: ''\n", value)
        self.assertEqual(value.count("    if: ${{ inputs.quality_source_run_id == '' }}\n"), 4)
        for source in ("43591310367", "1", " 43578495558", "43578495558 "):
            args = ["quality-gate", "--source-run", source, "--head", HEAD, "--output", "unused.json"]
            with self.subTest(source=source), patch.object(sys, "argv", args), \
                    patch.object(gate, "validate_checkout") as checkout, \
                    patch.object(gate, "source_proof") as lookup:
                with self.assertRaisesRegex(gate.GateError, "not a general quality-skip input"):
                    gate.main()
                checkout.assert_not_called()
                lookup.assert_not_called()

    def test_independent_consumer_rejects_rewritten_lineage_or_selector_digest(self):
        expected = {
            "mode": "authorized-image-only",
            "candidate": {"sha": HEAD, "workflow_run_id": "9001", "workflow_run_attempt": 1},
            "source": {"sha": gate.BASE_SHA, "workflow_run_id": gate.BASE_RUN},
            "source_equivalence": self.verify(),
            "quality_passed": True, "old_images_or_memory_results_reused": False,
        }
        report = {"schema_version": 1, "recorded_at": datetime.now(timezone.utc).isoformat(),
                  "verification": expected}
        manifest = {
            "schema_version": 2, "commit": HEAD, "workflow_run_id": "9001",
            "workflow_run_attempt": "1", "archive": "chat-reader-images.tar.gz",
            "quality_verification": report,
        }
        gate.verify_report(report, manifest, expected)
        for field, value in (
            ("verified_lineage", [gate.BASE_SHA, HEAD]),
            ("selector_test_sha256", "0" * 64),
            ("selector_workflow_patch_sha256", gate.PATCH_SHA256),
            ("application_dependency_and_quality_test_changes", 1),
            ("previous_repair_source_equivalence", None),
        ):
            changed = copy.deepcopy(report)
            changed["verification"]["source_equivalence"][field] = value
            with self.subTest(field=field), self.assertRaisesRegex(gate.GateError, "independently verified"):
                gate.verify_report(changed, {**manifest, "quality_verification": changed}, expected)


if __name__ == "__main__":
    unittest.main()
