import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET

from api_shard_evidence import validate
from quality_schedule import ROOT, SCHEDULE_SHA256, balanced, extend_coverage, load_schedule, validate_api_sources

SOURCE = "a" * 40


def fixture():
    files = {f"tests/test_{i}.py": i for i in range(1, 5)}
    nodes = [f"{file}::test_first" for file in files] + ["tests/test_4.py::test_skip"]
    plan = {"api": {"assignment": files, "collected_count": 5,
                    "allowed_skips": [nodes[-1]], "expected_passed": 4}}
    shards = []
    for index in range(1, 5):
        selected = [node for node in nodes if files[node.split("::")[0]] == index]
        reports = []
        suite = ET.Element("testsuite", tests=str(len(selected)), failures="0", errors="0",
                           skipped=str(int(index == 4)))
        for node in selected:
            skipped = node.endswith("test_skip")
            for when, outcome in ([("setup", "skipped"), ("teardown", "passed")] if skipped else
                                  [("setup", "passed"), ("call", "passed"), ("teardown", "passed")]):
                reports.append({"nodeid": node, "when": when, "outcome": outcome,
                                "duration": 0.01, "wasxfail": False})
            case = ET.SubElement(suite, "testcase", time="0.03")
            ET.SubElement(ET.SubElement(case, "properties"), "property", name="ci_nodeid", value=node)
            if skipped:
                ET.SubElement(case, "skipped")
        shards.append(({
            "schema_version": 1, "schedule_sha256": SCHEDULE_SHA256, "source_sha": SOURCE,
            "run_id": "1", "run_attempt": "1", "shard": index, "collection": nodes.copy(),
            "selected": selected, "reports": reports, "exitstatus": 0,
        }, ET.tostring(suite)))
    return plan, shards


class ApiShardTests(unittest.TestCase):
    def test_reviewed_sources_and_deterministic_complete_partitions(self):
        plan = load_schedule()
        validate_api_sources(plan)
        original = json.loads((ROOT / "scripts/ci/quality-schedule-v2.json").read_text("utf8"))
        self.assertEqual(original["api"]["collected_count"], 7010)
        self.assertEqual(original["api"]["expected_passed"], 7007)
        self.assertEqual(plan["api"]["collected_count"], 7034)
        self.assertEqual(plan["api"]["expected_passed"], 7031)
        self.assertEqual(sum(plan["api"]["added_file_counts"].values()), 24)
        for family in ("settings", "web"):
            self.assertEqual(plan[family], original[family])
        for file, index in original["api"]["assignment"].items():
            self.assertEqual(plan["api"]["assignment"][file], index)
        self.assertEqual(plan["api"]["allowed_skips"], original["api"]["allowed_skips"])
        self.assertEqual(len(plan["api"]["allowed_skips"]), 3)
        a, loads = balanced({"b": 10, "a": 10, "c": 1}, 2)
        self.assertEqual(a, {"a": 1, "b": 2, "c": 1})
        self.assertEqual(loads, [11, 10])

    def test_additive_coverage_cannot_replace_original_or_change_skips(self):
        original = json.loads((ROOT / "scripts/ci/quality-schedule-v2.json").read_text("utf8"))
        extension = json.loads((ROOT / "scripts/ci/quality-coverage-extension.json").read_text("utf8"))
        file = next(iter(extension["api"]))
        changes = [
            lambda e: e.update(base_schedule_sha256="0" * 64),
            lambda e: e.update(allowed_skips=["new skip"]),
            lambda e: e["api"].update({next(iter(original["api"]["assignment"])): e["api"][file]}),
            lambda e: e["api"][file].update(shard=5),
            lambda e: e["api"][file].update(count=0),
            lambda e: e["api"][file].update(source_lf_sha256="unknown"),
            lambda e: e["api"][file].update(allowed_skips=["new skip"]),
            lambda e: e["api"].update({"tests/../escape.py": e["api"][file]}),
            lambda e: next(iter(e["api_fixture_revisions"].values())).update(previous_source_lf_sha256="0" * 64),
            lambda e: next(iter(e["api_fixture_revisions"].values())).update(source_lf_sha256="unverified"),
            lambda e: next(iter(e["api_fixture_revisions"].values())).update(nodeids=[]),
            lambda e: next(iter(e["api_fixture_revisions"].values())).update(nodeids=["tests/test_foreign.py::test_other"]),
            lambda e: next(iter(e["api_fixture_revisions"].values())).update(shard=2),
        ]
        for mutate in changes:
            value = copy.deepcopy(extension)
            mutate(value)
            with self.assertRaises(AssertionError):
                extend_coverage(copy.deepcopy(original), value)

    def test_additional_per_file_counts_are_not_only_a_total(self):
        plan, shards = fixture()
        plan["api"]["added_file_counts"] = {"tests/test_1.py": 2}
        with self.assertRaises(AssertionError):
            validate(shards, SOURCE, "1", "1", plan)
        plan, shards = fixture()
        plan["api"]["fixture_revised_nodeids"] = {"tests/test_1.py": ["tests/test_1.py::test_removed"]}
        with self.assertRaises(AssertionError):
            validate(shards, SOURCE, "1", "1", plan)

    def test_lifecycle_and_native_junit_must_agree(self):
        plan, shards = fixture()
        result = validate(shards, SOURCE, "1", "1", plan)
        self.assertEqual((result["collected"], result["passed"]), (5, 4))
        self.assertEqual(result["shard_counts"], [1, 1, 1, 2])

    def test_forged_counts_and_source_and_execution_fail_closed(self):
        mutations = {
            "wrong source": lambda s: s[0][0].update(source_sha="b" * 40),
            "wrong attempt": lambda s: s[0][0].update(run_attempt="2"),
            "wrong run": lambda s: s[0][0].update(run_id="2"),
            "wrong shard": lambda s: s[0][0].update(shard=2),
            "wrong schedule": lambda s: s[0][0].update(schedule_sha256="0" * 64),
            "failed command": lambda s: s[0][0].update(exitstatus=1),
            "collection only": lambda s: s[0][0].update(reports=[]),
            "missing shard": lambda s: s.pop(),
            "duplicate shard": lambda s: s.__setitem__(1, copy.deepcopy(s[0])),
            "parameter drift": lambda s: s[0][0]["collection"].__setitem__(0, "tests/test_1.py::gzip-changing"),
            "order drift": lambda s: s[0][0]["collection"].reverse(),
            "duplicate collection": lambda s: s[0][0]["collection"].append(s[0][0]["collection"][0]),
            "missing case": lambda s: s[0][0]["selected"].pop(),
            "new skip": lambda s: s[0][0]["reports"][1].update(outcome="skipped"),
            "xfail": lambda s: s[0][0]["reports"][1].update(wasxfail=True),
            "failed case": lambda s: s[0][0]["reports"][1].update(outcome="failed"),
            "retry": lambda s: s[0][0]["reports"].extend(copy.deepcopy(s[0][0]["reports"])),
            "missing teardown": lambda s: s[0][0]["reports"].pop(),
            "invented native": lambda s: s.__setitem__(0, (s[0][0], b'<testsuite tests="1" failures="0" errors="0" skipped="0"/>')),
            "native wrong id": lambda s: s.__setitem__(0, (s[0][0], s[0][1].replace(b"test_first", b"test_other"))),
            "native failed": lambda s: s.__setitem__(0, (s[0][0], s[0][1].replace(b"</testcase>", b"<failure/></testcase>"))),
        }
        for name, mutate in mutations.items():
            with self.subTest(name=name):
                plan, shards = fixture()
                mutate(shards)
                with self.assertRaises((AssertionError, KeyError)):
                    validate(shards, SOURCE, "1", "1", plan)

    def test_real_pytest_lifecycle_junit_and_independent_collection(self):
        # Small actual executions validate the reporter mechanics, not the7010 release gate.
        # Hosted Linux exposes RUNNER_TEMP, while local Windows uses the explicit
        # task TEMP directory. Never fall back to the system temporary directory.
        temp_root = os.environ.get("RUNNER_TEMP") or os.environ.get("TEMP")
        self.assertTrue(temp_root, "An explicit task temporary directory is required")
        self.assertTrue(Path(temp_root).is_dir())
        root = Path(tempfile.mkdtemp(prefix="api-native-control-", dir=temp_root))
        root.joinpath("pytest.ini").write_text("[pytest]\n", encoding="utf8")
        for index in range(1, 5):
            folder = root / "tests"
            folder.mkdir(exist_ok=True)
            (folder / f"test_{index}.py").write_text(
                "import pytest\n"
                "def test_first():\n    assert 1 + 1 == 2\n"
                + ("@pytest.mark.skip(reason='original synthetic skip')\ndef test_skip():\n    assert False\n" if index == 4 else ""),
                encoding="utf8",
            )
        plan, _ = fixture()
        hook = root / "native_control.py"
        hook.write_text(
            "import api_shard_plugin as original\n"
            + f"original.load_schedule = lambda: {plan!r}\n"
            + "original.validate_api_sources = lambda _: None\n"
            + "pytest_addoption = original.pytest_addoption\npytest_configure = original.pytest_configure\n"
            + "pytest_collection_modifyitems = original.pytest_collection_modifyitems\n",
            encoding="utf8",
        )
        env = {**os.environ, "GITHUB_SHA": SOURCE, "GITHUB_RUN_ID": "1", "GITHUB_RUN_ATTEMPT": "1",
               "PYTHONPATH": str(Path(__file__).parent.resolve()) + os.pathsep + str(root),
               "PYTEST_DISABLE_PLUGIN_AUTOLOAD": "1"}
        shards = []
        for index in range(1, 5):
            report, junit = root / f"report-{index}.json", root / f"junit-{index}.xml"
            result = subprocess.run([
                sys.executable, "-m", "pytest", "-p", "native_control", "-q", f"--ci-shard={index}",
                f"--ci-evidence={report}", f"--junitxml={junit}", f"--basetemp={root / ('tmp-' + str(index))}",
            ], cwd=root, env=env, capture_output=True, timeout=60)
            self.assertEqual(result.returncode, 0, result.stdout.decode("utf8", errors="replace") + result.stderr.decode("utf8", errors="replace"))
            shards.append((json.loads(report.read_text()), junit.read_bytes()))
        self.assertEqual(validate(shards, SOURCE, "1", "1", plan)["passed"], 4)


if __name__ == "__main__":
    unittest.main()
