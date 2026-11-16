"""Versioned, source-bound full-CI partitions; never a changed-tests selector."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ORIGINAL_SHA256 = "af1523d28f658f4bd3d1b3a6ad2f018250b5b909db0f7b81f4e00eeeb212084c"
SCHEDULE_SHA256 = "34cffe5e0c2057c9eb9ad6f616773996260e7e785b50162a4702dfbd6e761aee"


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
    assert lf_sha(path) == SCHEDULE_SHA256, "Reviewed partition changed"
    value = json.loads(path.read_text("utf8"))
    assert value["schema_version"] == 2 and value["original_contract_sha256"] == ORIGINAL_SHA256
    for family, count in (("api", 4), ("settings", 4), ("web", 3)):
        plan = value[family]
        assert plan["shards"] == count
        assert all(type(weight) is int and weight >= 0 for weight in plan["weights_ms"].values())
        assigned, loads = balanced(plan["weights_ms"], count, plan.get("pinned", {}))
        assert assigned == plan["assignment"] and loads == plan["estimated_work_ms"]
        assert set(assigned.values()) == set(range(1, count + 1))
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
