"""Full collection, whole-file scheduling, and actual pytest lifecycle evidence."""
from __future__ import annotations

import json
import os
from collections import Counter
from pathlib import Path

import pytest

from quality_schedule import SCHEDULE_SHA256, load_schedule, validate_api_sources


def pytest_addoption(parser):
    parser.addoption("--ci-shard", type=int, choices=(1, 2, 3, 4))
    parser.addoption("--ci-evidence", type=Path)


def pytest_configure(config):
    if config.getoption("--ci-shard"):
        plan = load_schedule()
        validate_api_sources(plan)
        config._ci_evidence = {
            "schema_version": 1, "schedule_sha256": SCHEDULE_SHA256,
            "source_sha": os.environ["GITHUB_SHA"], "run_id": os.environ["GITHUB_RUN_ID"],
            "run_attempt": os.environ["GITHUB_RUN_ATTEMPT"],
            "shard": config.getoption("--ci-shard"), "collection": [],
            "selected": [], "reports": [], "exitstatus": None,
        }
        config._ci_plan = plan
        config.pluginmanager.register(ExecutionRecorder(config), "ci-execution-recorder")


@pytest.hookimpl(trylast=True)
def pytest_collection_modifyitems(config, items):
    if not hasattr(config, "_ci_evidence"):
        return
    state, plan = config._ci_evidence, config._ci_plan["api"]
    full = [item.nodeid for item in items]
    assert len(full) == len(set(full)) == plan["collected_count"], "Incomplete original collection"
    assert {nodeid.split("::")[0] for nodeid in full} == set(plan["assignment"])
    counts = Counter(nodeid.split("::")[0] for nodeid in full)
    assert all(counts[file] == count for file, count in plan.get("added_file_counts", {}).items()), "Additional coverage changed"
    state["collection"] = full
    selected, deselected = [], []
    for item in items:
        if plan["assignment"][item.nodeid.split("::")[0]] == state["shard"]:
            item.user_properties.append(("ci_nodeid", item.nodeid))
            selected.append(item)
        else:
            deselected.append(item)
    state["selected"] = [item.nodeid for item in selected]
    assert selected, "Empty shard"
    items[:] = selected
    config.hook.pytest_deselected(items=deselected)


class ExecutionRecorder:
    def __init__(self, config):
        self.config = config

    def pytest_runtest_logreport(self, report):
        self.config._ci_evidence["reports"].append({
            "nodeid": report.nodeid, "when": report.when, "outcome": report.outcome,
            "duration": report.duration, "wasxfail": hasattr(report, "wasxfail"),
        })

    @pytest.hookimpl(trylast=True)
    def pytest_sessionfinish(self, session, exitstatus):
        state = self.config._ci_evidence
        state["exitstatus"] = int(exitstatus)
        output = self.config.getoption("--ci-evidence")
        assert output is not None
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open("x", encoding="utf8") as stream:
            json.dump(state, stream, indent=2)
            stream.write("\n")
