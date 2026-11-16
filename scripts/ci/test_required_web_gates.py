import copy
import json
from pathlib import Path
import unittest

import yaml
from required_web_gates import validate_required_web_gate
from quality_schedule import active_web_contract

ROOT = Path(__file__).resolve().parents[2]
NAMES = (
    "Failed and paused import source repair",
    "Formula reading, focus tools and timed return regression",
    "Cross-device reading handoff and conflict recovery",
    "Retained import stop and per-task recovery controls",
    "Reader table export and recovery controls",
)


class RequiredWebGatesTests(unittest.TestCase):
    def setUp(self):
        self.main = yaml.safe_load((ROOT / ".github/workflows/build-release-images.yml").read_text("utf8"))
        self.web = yaml.safe_load((ROOT / ".github/workflows/web-quality.yml").read_text("utf8"))
        self.contract = active_web_contract()

    def check(self):
        for name in NAMES:
            validate_required_web_gate(self.main, self.web, self.contract, name)

    def test_all_five_retained_gates_are_required_through_the_real_dag(self):
        self.check()

    def test_missing_caller_rejected(self):
        del self.main["jobs"]["web-quality-shard-1"]
        with self.assertRaises((AssertionError, KeyError)):
            self.check()

    def test_wrong_shard_rejected(self):
        self.main["jobs"]["web-quality-shard-1"]["with"]["shard"] = 2
        with self.assertRaises(AssertionError):
            self.check()

    def test_missing_aggregate_dependency_rejected(self):
        self.main["jobs"]["web-quality"]["needs"].pop()
        with self.assertRaises(AssertionError):
            self.check()

    def test_missing_publisher_dependency_rejected(self):
        self.main["jobs"]["build-images"]["needs"].remove("web-quality")
        with self.assertRaises(AssertionError):
            self.check()

    def test_gate_bypass_command_and_missing_evidence_rejected(self):
        original = copy.deepcopy(self.web)
        for mutation in ("continue", "conditional", "swallow", "missing", "duplicate", "evidence"):
            with self.subTest(mutation=mutation):
                self.web = copy.deepcopy(original)
                steps = self.web["jobs"]["gates"]["steps"]
                step = next(step for step in steps if step.get("name") == NAMES[0])
                if mutation == "continue":
                    step["continue-on-error"] = True
                elif mutation == "conditional":
                    step["if"] += " && false"
                elif mutation == "swallow":
                    step["run"] += " || true"
                elif mutation == "missing":
                    steps.remove(step)
                elif mutation == "duplicate":
                    steps.append(copy.deepcopy(step))
                else:
                    upload = next(step for step in steps if step.get("name") == "Upload non-deployable quality evidence")
                    upload["with"]["path"] = "apps/web/test-results"
                with self.assertRaises(AssertionError):
                    self.check()


if __name__ == "__main__":
    unittest.main()
