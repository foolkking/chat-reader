"""Versioned, source-bound full-CI partitions; never a changed-tests selector."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
ORIGINAL_SHA256 = "af1523d28f658f4bd3d1b3a6ad2f018250b5b909db0f7b81f4e00eeeb212084c"
BASE_SCHEDULE_SHA256 = "34cffe5e0c2057c9eb9ad6f616773996260e7e785b50162a4702dfbd6e761aee"
COVERAGE_SHA256 = "c32a293ecf329de54f3ca2cc991f70e94b84811980427590eb72575a7dcc6c71"
SCHEDULE_SHA256 = hashlib.sha256(f"{BASE_SCHEDULE_SHA256}:{COVERAGE_SHA256}".encode()).hexdigest()


def lf_sha(path):
    return hashlib.sha256(Path(path).read_bytes().replace(b"\r\n", b"\n")).hexdigest()


def balanced(weights, count, pinned=None):
    """Longest processing time first; stable path/index tie breaks."""
    pinned = pinned or {}
    assigned = dict(pinned)
    loads = [0] * count
    for name, index in pinned.items():
        assert type(index) is int and 1 <= index <= count and name in weights
        loads[index - 1] += weights[name]
    for name in sorted(set(weights) - set(pinned), key=lambda name: (-weights[name], name)):
        index = min(range(count), key=lambda index: (loads[index], index))
        assigned[name] = index + 1
        loads[index] += weights[name]
    return dict(sorted(assigned.items())), loads


def load_schedule():
    original = ROOT / "scripts/ci/quality-scheduling-contract.json"
    path = ROOT / "scripts/ci/quality-schedule-v2.json"
    assert lf_sha(original) == ORIGINAL_SHA256, "Original gate contract changed"
    assert lf_sha(path) == BASE_SCHEDULE_SHA256, "Reviewed partition changed"
    value = json.loads(path.read_text("utf8"))
    assert value["schema_version"] == 2 and value["original_contract_sha256"] == ORIGINAL_SHA256
    for family, count in (("api", 4), ("settings", 4), ("web", 3)):
        plan = value[family]
        assert plan["shards"] == count
        assert all(type(weight) is int and weight >= 0 for weight in plan["weights_ms"].values())
        assigned, loads = balanced(plan["weights_ms"], count, plan.get("pinned", {}))
        assert assigned == plan["assignment"] and loads == plan["estimated_work_ms"]
        assert set(assigned.values()) == set(range(1, count + 1))
    extension_path = ROOT / "scripts/ci/quality-coverage-extension.json"
    assert lf_sha(extension_path) == COVERAGE_SHA256, "Reviewed coverage extension changed"
    return extend_coverage(value, json.loads(extension_path.read_text("utf8")))


def extend_coverage(value, extension):
    """Append new product tests; never rebalance or rewrite the frozen baseline."""
    assert extension["schema_version"] == 1
    assert extension["base_schedule_sha256"] == BASE_SCHEDULE_SHA256
    assert set(extension) == {"schema_version", "base_schedule_sha256", "reason", "api"}
    api = value["api"]
    assert extension["api"] and not (set(extension["api"]) & set(api["assignment"]))
    api["added_file_counts"] = {}
    for file, entry in extension["api"].items():
        assert re.fullmatch(r"tests/test_[a-z0-9_]+\.py", file)
        assert set(entry) == {"count", "shard", "source_lf_sha256"}
        assert type(entry["count"]) is int and entry["count"] > 0
        assert type(entry["shard"]) is int and 1 <= entry["shard"] <= api["shards"]
        assert re.fullmatch(r"[0-9a-f]{64}", entry["source_lf_sha256"])
        api["assignment"][file] = entry["shard"]
        api["source_lf_sha256"][file] = entry["source_lf_sha256"]
        api["added_file_counts"][file] = entry["count"]
        api["collected_count"] += entry["count"]
        api["expected_passed"] += entry["count"]
    return value


def active_web_contract():
    contract = json.loads((ROOT / "scripts/ci/quality-scheduling-contract.json").read_text("utf8"))
    schedule = load_schedule()
    return {**contract, "web_assignment": schedule["web"]["assignment"],
            "web_gate_groups": schedule["web"]["gate_groups"]}


def validate_api_sources(schedule):
    for relative, expected in schedule["api"]["source_lf_sha256"].items():
        assert relative.startswith("tests/") and ".." not in Path(relative).parts
        assert lf_sha(ROOT / "apps/api" / relative) == expected, "Original API test changed: " + relative
