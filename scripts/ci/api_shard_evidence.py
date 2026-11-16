"""Reject missing/duplicate/changed collection or execution, including native JUnit."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import xml.etree.ElementTree as ET

from quality_schedule import SCHEDULE_SHA256, load_schedule, validate_api_sources


def validate(shards, source, run, attempt, plan=None):
    plan = plan or load_schedule()
    assert re.fullmatch(r"[0-9a-f]{40}", source)
    assert re.fullmatch(r"[1-9][0-9]*", run) and re.fullmatch(r"[1-9][0-9]*", attempt)
    assert len(shards) == 4, "Four independent shards required"
    api = plan["api"]
    expected = None
    union, skipped = set(), set()
    counts = []
    for index, (report, junit) in enumerate(shards, 1):
        assert report["schema_version"] == 1 and report["schedule_sha256"] == SCHEDULE_SHA256
        assert (report["source_sha"], report["run_id"], report["run_attempt"], report["shard"]) == (
            source, run, attempt, index), "Foreign shard source"
        assert report["exitstatus"] == 0, "Pytest did not complete successfully"
        collection = report["collection"]
        assert len(collection) == len(set(collection)) == api["collected_count"]
        assert {nodeid.split("::")[0] for nodeid in collection} == set(api["assignment"])
        if expected is None:
            expected = collection
        assert collection == expected, "Full cross-process collection changed, including order"
        selected = [nodeid for nodeid in collection if api["assignment"][nodeid.split("::")[0]] == index]
        assert report["selected"] == selected and selected
        assert not union.intersection(selected), "Duplicate execution"
        union.update(selected)
        counts.append(len(selected))
        phases = {nodeid: [] for nodeid in selected}
        for entry in report["reports"]:
            assert entry["nodeid"] in phases and entry["wasxfail"] is False
            assert type(entry["duration"]) in (int, float) and math.isfinite(entry["duration"]) and entry["duration"] >= 0
            phases[entry["nodeid"]].append((entry["when"], entry["outcome"]))
        for nodeid, actual in phases.items():
            passed = [("setup", "passed"), ("call", "passed"), ("teardown", "passed")]
            if nodeid in api["allowed_skips"]:
                assert actual in (
                    [("setup", "skipped"), ("teardown", "passed")],
                    [("setup", "passed"), ("call", "skipped"), ("teardown", "passed")],
                ), "Original skip changed"
                skipped.add(nodeid)
            else:
                assert actual == passed, "Failed, skipped, retried, incomplete or collection-only execution"
        assert isinstance(junit, bytes) and b"<!DOCTYPE" not in junit and b"<!ENTITY" not in junit
        tree = ET.fromstring(junit)
        suites = list(tree.iter("testsuite"))
        assert len(suites) == 1, "Exactly one native pytest suite required"
        suite = suites[0]
        assert int(suite.attrib["tests"]) == len(selected)
        assert int(suite.attrib["failures"]) == int(suite.attrib["errors"]) == 0
        assert int(suite.attrib["skipped"]) == len(set(selected) & set(api["allowed_skips"]))
        native = {}
        for case in suite.findall("testcase"):
            props = [p.attrib["value"] for p in case.findall("./properties/property")
                     if p.attrib["name"] == "ci_nodeid"]
            assert len(props) == 1 and props[0] not in native and props[0] in phases
            native[props[0]] = case
            assert case.find("failure") is None and case.find("error") is None
            assert (case.find("skipped") is not None) == (props[0] in skipped)
            duration = float(case.attrib["time"])
            assert math.isfinite(duration) and duration >= 0
        assert set(native) == set(selected), "Native JUnit lacks actual executions"
    assert union == set(expected) and skipped == set(api["allowed_skips"])
    assert len(union) - len(skipped) == api["expected_passed"]
    return {
        "schema_version": 1, "source_sha": source, "run_id": run, "run_attempt": attempt,
        "schedule_sha256": SCHEDULE_SHA256, "collected": len(union),
        "passed": len(union) - len(skipped), "skips": sorted(skipped), "shard_counts": counts,
        "case_ids": sorted(union), "native_junit_and_lifecycle_match": True,
    }


def one(root, name):
    assert root.is_dir() and not root.is_symlink()
    for path in root.rglob("*"):
        assert not path.is_symlink(), "Linked artifact rejected"
    paths = list(root.rglob(name))
    assert len(paths) == 1 and paths[0].is_file() and paths[0].stat().st_size <= 64 * 1024 * 1024
    return paths[0]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("source")
    parser.add_argument("run")
    parser.add_argument("attempt")
    args = parser.parse_args()
    plan = load_schedule()
    validate_api_sources(plan)
    inputs, hashes = [], []
    for index in range(1, 5):
        folder = args.root / f"shard-{index}"
        report, junit = one(folder, "api-execution.json"), one(folder, "api-junit.xml")
        inputs.append((json.loads(report.read_text("utf8")), junit.read_bytes()))
        hashes.append({p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in (report, junit)})
    result = validate(inputs, args.source, args.run, args.attempt, plan)
    result["native_input_sha256"] = hashes
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x", encoding="utf8") as stream:
        json.dump(result, stream, indent=2)
        stream.write("\n")
    print("All original API cases executed exactly once; native JUnit and lifecycle agree.")


if __name__ == "__main__":
    main()
