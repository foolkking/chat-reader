#!/usr/bin/env python3
"""Fail-closed, one-off reuse of the November 14 *quality* results.

The normal empty-input workflow still runs all four quality jobs. The opt-in
now requires the fixed source -> null-repair -> selector-fixture-repair lineage.
Only the separately approved, SHA-bound selector test may change; application,
dependency, quality-test, resource-gate and arbitrary workflow changes fail.
Both image producer and independent artifact consumer verify the same proof.
Only stdlib and the runner's existing Git/GitHub CLIs are used.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import time
import zipfile


REPO = Path(__file__).resolve().parents[2]
REPOSITORY = "foolkking/chat-reader"
BASE_SHA = "4481fa37c355a296ce878c214525d3273a8bfe20"
BASE_RUN = "43578495558"
BASE_ATTEMPT = 1
POLICY = "null-failure-control-plane-2026-11-14"
WORKFLOW = ".github/workflows/build-release-images.yml"
HELPER = "apps/api/scripts/verify_small_zip_memory.py"
PATCH = "scripts/ci/image-only-workflow-patch.json"
PATCH_SHA256 = "7c64c286ccb658c6c4f80a2868744c843fe3a036f51d66c41fbd155e02b47d01"
BASE_HELPER_SHA256 = "c53122073487001d8e0b8afb6a7a20d5c873f2db7f17f33c54ec48431951f0d1"
OLD_FAILURE = b'(record.analysis_summary or {}).get("failure", {}).get("code")'
NEW_FAILURE = b'((record.analysis_summary or {}).get("failure") or {}).get("code")'
QUALITY_NAMES = (
    "api-quality", "web-quality", "settings-quality", "reading-performance-comparison / compare",
)
NEEDS_NAMES = ("api-quality", "web-quality", "settings-quality", "reading-performance-comparison")
EVIDENCE_GET_TIMEOUT_SECONDS = 180
EVIDENCE_GET_MAX_ATTEMPTS = 3
DOC_PATHS = {
    "PROJECT_STATE.md", "docs/index.md", "docs/documentation-inventory.md",
    "docs/system/SMALL_HOST_IMPROVEMENT_STATUS.md", "docs/system/RELEASE_SAFETY_BASELINE.md",
    "docs/system/DEPLOYMENT_AND_ENVIRONMENT.md", "docs/deployment.md", "docs/testing.md",
    "docs/evidence/README.md",
}
NEW_PATHS = {
    PATCH,
    "scripts/ci/image-only-quality-reuse.py",
    "scripts/ci/test_image_only_quality_reuse.py",
    "apps/api/scripts/test_verify_small_zip_memory.py",
    "docs/evidence/reliability-2026-11-14/ci-offline-optional-dispatch.json",
    "docs/evidence/reliability-2026-11-14/ci-build-images-failure.json",
    "docs/evidence/reliability-2026-11-14/ci-image-only-verification.json",
    "docs/evidence/reliability-2026-11-14/ci-image-only-inputs.json",
}
WEB_GATE_IDS = (
    "adaptive-import-recovery", "csp-enforcement", "context-files", "focused-online-security",
    "share-focus", "source-editor-mutation", "source-editor-cleanup", "upload-token-atomicity",
    "markdown-image-viewer", "reading-stability", "pdfjs-maintained-line", "default-pwa",
    "single-owner-auth", "pwa-negative",
)
# These three immutable diagnostic ZIPs were independently downloaded, size /
# SHA-256 / CRC checked after the user reported the failure. No images are reused.
ARTIFACTS = (
    {
        "id": 14109396218, "kind": "web",
        "name": f"release-a-quality-evidence-{BASE_SHA}-1", "size_in_bytes": 40483492,
        "digest": "sha256:9e383624f101cd6ae1a154e46c2816156361cb29f9eb74d8aa0e22c7866efefc",
    },
    {
        "id": 14108604966, "kind": "settings",
        "name": f"settings-quality-evidence-{BASE_SHA}-1", "size_in_bytes": 15746661,
        "digest": "sha256:33e40743dbfd32c34307d21790e2f12f26353366f98953a4892d51e3c1d1ed96",
    },
    {
        "id": 14108609489, "kind": "reading", "name": "reading-performance-comparison",
        "size_in_bytes": 4063272,
        "digest": "sha256:9cacfb3003151f57d09142a1d7139d4b2dd2c455893d8a263481714fe0e55671",
    },
)

# The first image-only authorization was used by this exact commit. Keep its
# original contract/verifier intact, and prove it before admitting one child.
REPAIR_SHA = "74f4636e9d29098fb9a30bb42bdb7ada696373f8"
REPAIR_TREE_SHA256 = "3c086ec82a03eca4a0f8d67c55a9268f76b1a8c61f39923ebfaf6be9264b9c8e"
SELECTOR_POLICY = "selector-fixture-exact-lineage-2026-11-14"
SELECTOR = "scripts/ci/changed-area-selector.mjs"
SELECTOR_TEST = "scripts/ci/changed-area-selector.test.mjs"
BASE_SELECTOR_SHA256 = "8cd2cb8c7636fd2d9fde05139ae27673df449fbf8026987b5de87d846f6df106"
BASE_SELECTOR_TEST_SHA256 = "1fe0ebb0ae537ae481b3f8b2a7b3451e49148d1117edea4451731faaa1880d38"
SELECTOR_TEST_SHA256 = "8bb1a861309ebb92bae29ea36c29e92a38b56d25d416ba09cab4d712daf1ffdd"
SELECTOR_PATCH = "scripts/ci/image-only-selector-workflow-patch.json"
SELECTOR_PATCH_SHA256 = "c73ffa3cc3d1dd9e046be767522eb7071a3ed4f9f90665cd86f835f2d224144f"
POLICY_SCRIPT = "scripts/ci/image-only-quality-reuse.py"
SELECTOR_CONTROL_TEST = "scripts/ci/test_image_only_selector_lineage.py"
SELECTOR_HISTORICAL_EVIDENCE = {
    "docs/evidence/reliability-2026-11-14/ci-image-only-dispatch.json":
        "35fbb8b5ac69714f9a75ef0313c46efe4ad60a16de21cdf7ad3a7328bdf1c608",
    "docs/evidence/reliability-2026-11-14/ci-image-only-failure.json":
        "87caeb3feea4cbbe75f66dc505b3c105759b7dc0b19bf3bacb735aea1e12d5b7",
    "docs/evidence/reliability-2026-11-14/ci-image-only-selector-verification.json":
        "a014566d7400e1aa6c23fe19940cadb4732ba1a4db6d1bab7ba1acde4744efb8",
    "docs/evidence/reliability-2026-11-14/ci-image-only-selector-inputs.json":
        "6b5ddfd7cfbf1818b788d1f12cc1fdd57385d30fda3a79d138d45a21a04b7325",
}
SELECTOR_NEW_PATHS = {
    SELECTOR_PATCH, SELECTOR_CONTROL_TEST, *SELECTOR_HISTORICAL_EVIDENCE,
    "docs/evidence/reliability-2026-11-14/ci-image-only-selector-lineage-verification.json",
    "docs/evidence/reliability-2026-11-14/ci-image-only-selector-lineage-inputs.json",
}


class GateError(RuntimeError):
    pass


def require(condition, message):
    if not condition:
        raise GateError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical_json(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def git(*args, cwd=REPO):
    result = subprocess.run(["git", *args], cwd=cwd, capture_output=True, timeout=60)
    require(result.returncode == 0, "Git source verification failed; no fallback source is allowed.")
    return result.stdout


def tree(revision, *, cwd=REPO):
    result = {}
    for item in git("ls-tree", "-rz", "--full-tree", revision, cwd=cwd).split(b"\0"):
        if not item:
            continue
        metadata, name = item.split(b"\t", 1)
        mode, kind, object_id = metadata.decode("ascii").split()
        require(kind == "blob", "Submodules/non-blob source entries are not supported for reuse.")
        result[name.decode("utf-8")] = (mode, object_id)
    return result


def approved_workflow(base, contract_bytes):
    require(digest(contract_bytes) == PATCH_SHA256, "The reviewed workflow patch contract changed.")
    contract = json.loads(contract_bytes)
    require(contract["schema_version"] == 1 and contract["policy"] == POLICY,
            "Unknown workflow patch policy.")
    require(digest(base) == contract["base_workflow_sha256"], "The source workflow is not the reviewed base.")
    value = base.decode("utf-8")
    for operation in contract["replacements"]:
        require(value.count(operation["before"]) == operation["count"],
                "A reviewed workflow patch anchor is missing or duplicated.")
        value = value.replace(operation["before"], operation["after"])
    return value.encode("utf-8")


def verify_equivalence(base_tree, candidate_tree, read_blob, parents, candidate_sha):
    require(parents == [BASE_SHA], "Image-only reuse requires one direct, non-merge repair commit.")
    changes = sorted(
        name for name in base_tree.keys() | candidate_tree.keys()
        if base_tree.get(name) != candidate_tree.get(name)
    )
    allowed = DOC_PATHS | NEW_PATHS | {WORKFLOW, HELPER}
    require(not (set(changes) - allowed), "Application/dependency/test/config or unapproved file changed: "
            + ", ".join(sorted(set(changes) - allowed)))
    for name in changes:
        require(name in candidate_tree and candidate_tree[name][0] == "100644",
                f"Deletion, executable or link/mode change is not allowed: {name}")
        if name in NEW_PATHS:
            require(name not in base_tree, f"A new-control/evidence path replaced an existing source: {name}")
    require({HELPER, WORKFLOW} <= set(changes), "Both the exact helper fix and protected workflow are required.")
    require(all(name in candidate_tree and name not in base_tree for name in (
        PATCH, "scripts/ci/image-only-quality-reuse.py", "scripts/ci/test_image_only_quality_reuse.py",
        "apps/api/scripts/test_verify_small_zip_memory.py",
    )), "All additive repair controls are required.")
    old_helper = read_blob(base_tree[HELPER][1])
    require(digest(old_helper) == BASE_HELPER_SHA256 and old_helper.count(OLD_FAILURE) == 1,
            "The helper is not the reviewed failure source.")
    require(read_blob(candidate_tree[HELPER][1]) == old_helper.replace(OLD_FAILURE, NEW_FAILURE),
            "Only the exact null-failure status expression may change in the helper.")
    expected_workflow = approved_workflow(
        read_blob(base_tree[WORKFLOW][1]), read_blob(candidate_tree[PATCH][1]),
    )
    require(read_blob(candidate_tree[WORKFLOW][1]) == expected_workflow,
            "Workflow changes exceed the byte-exact additive repair contract.")
    unchanged = sorted(set(base_tree) - set(changes))
    fingerprint = "\n".join(f"{name}\t{' '.join(base_tree[name])}" for name in unchanged).encode()
    return {
        "policy": POLICY, "base_sha": BASE_SHA, "candidate_sha": candidate_sha,
        "direct_repair_parent_verified": True, "changed_paths": changes,
        "unchanged_tracked_files": len(unchanged),
        "unchanged_tree_sha256": digest(fingerprint),
        "application_dependency_and_existing_test_changes": 0,
        "exact_null_failure_fix_verified": True, "original_workflow_gates_preserved": True,
        "workflow_patch_sha256": PATCH_SHA256,
    }


def tree_fingerprint(entries):
    return digest("\n".join(
        f"{name}\t{' '.join(entries[name])}" for name in sorted(entries)
    ).encode())


def approved_selector_workflow(previous, contract_bytes):
    require(digest(contract_bytes) == SELECTOR_PATCH_SHA256,
            "The reviewed selector workflow patch contract changed.")
    contract = json.loads(contract_bytes)
    require(contract["schema_version"] == 1 and contract["policy"] == SELECTOR_POLICY
            and contract["base_sha"] == REPAIR_SHA, "Unknown selector workflow patch policy.")
    require(digest(previous) == contract["base_workflow_sha256"],
            "The selector patch requires the exact previous repair workflow.")
    value = previous.decode("utf-8")
    for operation in contract["replacements"]:
        require(value.count(operation["before"]) == operation["count"],
                "A reviewed selector workflow patch anchor is missing or duplicated.")
        value = value.replace(operation["before"], operation["after"])
    return value.encode("utf-8")


def verify_selector_lineage(base_tree, repair_tree, candidate_tree, read_blob,
                            repair_parents, parents, candidate_sha):
    require(re.fullmatch(r"[0-9a-f]{40}", candidate_sha) and candidate_sha != REPAIR_SHA,
            "A new full lowercase selector-repair candidate SHA is required.")
    require(parents == [REPAIR_SHA],
            "Selector repair requires one direct, non-merge child of the fixed74f repair.")
    require(repair_parents == [BASE_SHA],
            "The fixed74f repair must have the exact4481 quality-source parent.")
    require(tree_fingerprint(repair_tree) == REPAIR_TREE_SHA256,
            "The previous repair's complete Git mode/blob tree changed.")
    # This is the original strict proof, not another parent added to its allowlist.
    previous_proof = verify_equivalence(
        base_tree, repair_tree, read_blob, repair_parents, REPAIR_SHA,
    )
    changes = sorted(
        name for name in repair_tree.keys() | candidate_tree.keys()
        if repair_tree.get(name) != candidate_tree.get(name)
    )
    allowed = DOC_PATHS | SELECTOR_NEW_PATHS | {WORKFLOW, POLICY_SCRIPT, SELECTOR_TEST}
    require(not (set(changes) - allowed),
            "Application/dependency/quality-test/resource or unapproved selector-repair file changed: "
            + ", ".join(sorted(set(changes) - allowed)))
    for name in changes:
        require(name in candidate_tree and candidate_tree[name][0] == "100644",
                f"Deletion, executable or link/mode change is not allowed: {name}")
        if name in SELECTOR_NEW_PATHS:
            require(name not in repair_tree and name not in base_tree,
                    f"A new selector control/evidence path replaced existing source: {name}")
    require({WORKFLOW, POLICY_SCRIPT, SELECTOR_TEST, SELECTOR_PATCH, SELECTOR_CONTROL_TEST}
            <= set(changes), "All exact selector repair and lineage/workflow controls are required.")
    require(digest(read_blob(base_tree[SELECTOR][1])) == BASE_SELECTOR_SHA256
            and candidate_tree[SELECTOR] == repair_tree[SELECTOR] == base_tree[SELECTOR],
            "The selector implementation must retain its original Git mode/blob.")
    require(digest(read_blob(base_tree[SELECTOR_TEST][1])) == BASE_SELECTOR_TEST_SHA256
            and repair_tree[SELECTOR_TEST] == base_tree[SELECTOR_TEST],
            "The previous selector test is not the exact reviewed failure source.")
    require(digest(read_blob(candidate_tree[SELECTOR_TEST][1])) == SELECTOR_TEST_SHA256,
            "Only the exact approved selector Git-fixture test bytes may change.")
    expected_workflow = approved_selector_workflow(
        read_blob(repair_tree[WORKFLOW][1]), read_blob(candidate_tree[SELECTOR_PATCH][1]),
    )
    require(read_blob(candidate_tree[WORKFLOW][1]) == expected_workflow,
            "Workflow changes exceed the byte-exact selector checkout/control contract.")
    for name, expected_digest in SELECTOR_HISTORICAL_EVIDENCE.items():
        require(name in candidate_tree and name not in repair_tree
                and digest(read_blob(candidate_tree[name][1])) == expected_digest,
                f"The historical selector diagnostic/dispatch bytes must be preserved: {name}")
    final_changes = sorted(
        name for name in base_tree.keys() | candidate_tree.keys()
        if base_tree.get(name) != candidate_tree.get(name)
    )
    unchanged = {name: base_tree[name] for name in base_tree if name not in final_changes}
    return {
        "policy": SELECTOR_POLICY, "base_sha": BASE_SHA, "candidate_sha": candidate_sha,
        "previous_repair_sha": REPAIR_SHA, "verified_lineage": [BASE_SHA, REPAIR_SHA, candidate_sha],
        "direct_repair_parent_verified": True, "previous_repair_parent_verified": True,
        "previous_repair_tree_sha256": REPAIR_TREE_SHA256,
        "previous_repair_source_equivalence": previous_proof,
        "changed_paths": final_changes, "selector_repair_changed_paths": changes,
        "unchanged_tracked_files": len(unchanged),
        "unchanged_tree_sha256": tree_fingerprint(unchanged),
        "application_dependency_and_quality_test_changes": 0,
        "approved_existing_selector_test_changes": 1,
        "exact_selector_fixture_fix_verified": True, "selector_test_sha256": SELECTOR_TEST_SHA256,
        "selector_implementation_sha256": BASE_SELECTOR_SHA256,
        "exact_null_failure_fix_verified": True, "original_workflow_gates_preserved": True,
        "workflow_patch_sha256": PATCH_SHA256,
        "selector_workflow_patch_sha256": SELECTOR_PATCH_SHA256,
        "historical_evidence_sha256": SELECTOR_HISTORICAL_EVIDENCE,
    }


def git_equivalence(head, *, cwd=REPO):
    def parents(revision):
        return git("rev-list", "--parents", "-n", "1", revision, cwd=cwd).decode().strip().split()[1:]

    return verify_selector_lineage(
        tree(BASE_SHA, cwd=cwd), tree(REPAIR_SHA, cwd=cwd), tree(head, cwd=cwd),
        lambda value: git("cat-file", "blob", value, cwd=cwd),
        parents(REPAIR_SHA), parents(head), head,
    )


def verified_jobs(run, jobs, *, source_sha, source_run, attempt, reuse):
    require(str(run["id"]) == source_run and run["head_sha"] == source_sha,
            "Official run/revision does not match the quality source.")
    require(run["path"] == WORKFLOW and run["event"] == "workflow_dispatch",
            "The source did not run the release workflow.")
    require(run["repository"]["full_name"] == REPOSITORY
            and run["head_repository"]["full_name"] == REPOSITORY,
            "A fork/foreign repository is not a quality source.")
    require(jobs["total_count"] == len(jobs["jobs"]),
            "Incomplete or paginated source job set.")
    by_name = {}
    for job in jobs["jobs"]:
        require(job["name"] not in by_name, "Duplicate source job name.")
        by_name[job["name"]] = job
    allowed_jobs = set(QUALITY_NAMES) | {"build-images", "inspect-release-artifact"}
    require(set(QUALITY_NAMES) | {"build-images"} <= set(by_name) <= allowed_jobs,
            "The original quality/image release gate is required.")
    if reuse:
        require(set(by_name) == allowed_jobs, "The completed original six-job release gate is required.")
        require(source_run == BASE_RUN and source_sha == BASE_SHA and attempt == BASE_ATTEMPT,
                "Only the user-approved November 14 quality source is reusable.")
        require(run["run_attempt"] == BASE_ATTEMPT and run["status"] == "completed"
                and run["conclusion"] == "failure" and run["head_branch"] == "master",
                "The immutable source attempt is no longer the observed completed failure.")
        require(by_name["build-images"]["conclusion"] == "failure"
                and by_name["inspect-release-artifact"]["conclusion"] == "skipped",
                "The approved source's release-job states changed.")
        failures = [step["name"] for step in by_name["build-images"]["steps"]
                    if step["conclusion"] == "failure"]
        require(failures == ["Verify real 320 MiB worker ZIP analysis and commit without swap"],
                "The source did not fail at the reviewed memory control-plane step.")
    result = []
    for name in QUALITY_NAMES:
        job = by_name[name]
        require(job["status"] == "completed" and job["conclusion"] == "success",
                f"Required source quality job did not pass: {name}")
        require(job["run_id"] == int(source_run) and job["run_attempt"] == attempt
                and job["head_sha"] == source_sha, "Quality job attempt/revision mismatch.")
        require(job["steps"] and all(step["conclusion"] not in {"failure", "cancelled", "timed_out"}
                                    for step in job["steps"]), "Failed/interrupted source quality step.")
        started = datetime.fromisoformat(job["started_at"].replace("Z", "+00:00"))
        completed = datetime.fromisoformat(job["completed_at"].replace("Z", "+00:00"))
        require(completed >= started, "Invalid official quality-job clocks.")
        result.append({
            "name": name, "job_id": job["id"], "source_attempt": attempt,
            "status": "completed", "conclusion": "success",
            "started_at": job["started_at"], "completed_at": job["completed_at"],
            "elapsed_seconds": (completed - started).total_seconds(),
        })
    return result


def evidence_error_kind(stderr):
    """Classify only known transient failures, without exposing raw CLI errors."""
    statuses = set(re.findall(rb"\(HTTP ([1-5]\d{2})\)", stderr or b""))
    if len(statuses) == 1:
        status = int(statuses.pop())
        return f"http-{status}", status in {408, 429, 500, 502, 503, 504}
    if statuses:
        return "ambiguous-http-status", False
    for text, kind in (
        (b"connection reset by peer", "connection-reset"),
        (b"TLS handshake timeout", "tls-timeout"),
        (b"i/o timeout", "io-timeout"),
        (b"unexpected EOF", "unexpected-eof"),
        (b"context deadline exceeded", "transport-timeout"),
    ):
        if text in (stderr or b""):
            return kind, True
    return "unclassified", False


def api(endpoint, *, cache, name, binary=False):
    deadline = time.monotonic() + EVIDENCE_GET_TIMEOUT_SECONDS
    for attempt in range(1, EVIDENCE_GET_MAX_ATTEMPTS + 1):
        remaining = deadline - time.monotonic()
        require(remaining > 0,
                f"Official GitHub evidence query failed: {name} (deadline; attempts={attempt - 1})")
        try:
            result = subprocess.run(["gh", "api", f"repos/{REPOSITORY}/{endpoint}"],
                                    cwd=REPO, capture_output=True, timeout=remaining)
        except subprocess.TimeoutExpired:
            # Timeout objects can include raw command, response and credential data.
            raise GateError(f"Official GitHub evidence query failed: {name} "
                            f"(deadline; attempts={attempt})") from None
        require(time.monotonic() <= deadline,
                f"Official GitHub evidence query failed: {name} (deadline; attempts={attempt})")
        if result.returncode == 0:
            break
        kind, transient = evidence_error_kind(result.stderr)
        delay = attempt
        budget_available = deadline - time.monotonic() > delay
        require(transient and attempt < EVIDENCE_GET_MAX_ATTEMPTS and budget_available,
                f"Official GitHub evidence query failed: {name} "
                f"({kind}; attempts={attempt}{'; deadline' if not budget_available else ''})")
        # These fields are fixed rule names/numbers, never raw API/token data.
        print(f"Official GitHub evidence GET retry: {name} "
              f"({kind}; attempt={attempt}/{EVIDENCE_GET_MAX_ATTEMPTS}; delay={delay}s)")
        time.sleep(delay)
    # Failed/partial responses and stale cache files are never accepted.
    path = cache / name
    require(not path.is_symlink(), "Refusing a linked diagnostic cache path.")
    path.write_bytes(result.stdout)
    return result.stdout if binary else json.loads(result.stdout)


def validate_artifact_metadata(metadata, specification):
    for key in ("id", "name", "size_in_bytes", "digest"):
        require(metadata.get(key) == specification[key], "Wrong immutable source artifact identity.")
    require(metadata.get("expired") is False, "Required source quality evidence expired.")
    run = metadata.get("workflow_run") or {}
    require(run.get("id") == int(BASE_RUN) and run.get("head_sha") == BASE_SHA,
            "Artifact source run/revision mismatch.")


def json_member(archive, suffix):
    names = [name for name in archive.namelist() if name.endswith(suffix)]
    require(len(names) == 1, "Quality evidence JSON is missing or ambiguous: " + suffix)
    require(archive.getinfo(names[0]).file_size <= 1024 * 1024, "Oversized quality summary.")
    return json.loads(archive.read(names[0]))


def valid_counts(value, passed):
    require(value == {"passed": passed, "failed": 0, "timedOut": 0, "skipped": 0, "interrupted": 0},
            "Required quality matrix is failed, skipped, interrupted or incomplete.")


def validate_quality_zip(data, specification):
    require(len(data) == specification["size_in_bytes"]
            and "sha256:" + digest(data) == specification["digest"],
            "Source quality ZIP size/digest mismatch.")
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        require(len(archive.namelist()) == len(set(archive.namelist())),
                "Duplicate quality ZIP entries.")
        require(archive.testzip() is None, "Source quality ZIP CRC failed.")
        kind = specification["kind"]
        if kind in {"web", "settings"}:
            summary = json_member(archive, f"apps/web/test-results/{'release' if kind == 'web' else 'settings'}-gate-summary.json")
            require(summary["schema_version"] == 1 and summary["source_sha"] == BASE_SHA
                    and summary["overall_status"] == "PASS", "Wrong/failed browser source summary.")
            expected_ids = WEB_GATE_IDS if kind == "web" else ("settings-stages-1-4", "system-archive-new-instance")
            require(summary["counts"] == {"PASS": len(expected_ids), "FAIL": 0, "NOT_VERIFIED": 0, "SKIPPED": 0}
                    and len(summary["gates"]) == len(expected_ids)
                    and {item["gate_id"] for item in summary["gates"]} == set(expected_ids),
                    "Missing/failed browser gate.")
            for gate in summary["gates"]:
                require(gate["status"] == "PASS" and gate["evidence_status"] == "passed",
                        "A browser gate did not pass.")
                counts = gate["result_counts"]
                require(counts["passed"] > 0
                        and counts["failed"] == counts["timedOut"] == counts["interrupted"] == 0
                        and counts["passed"] + counts["skipped"] == gate["test_count"],
                        "Incomplete browser result counts.")
                if kind == "settings":
                    passed = 470 if gate["gate_id"] == "settings-stages-1-4" else 1
                    require(gate["test_count"] == passed, "Original Settings/restore selection changed.")
                    valid_counts(counts, passed)
            facts = summary
        else:
            facts = json_member(archive, "_temp/reading-comparison/candidate/gate-evidence.json")
            require(facts["schema_version"] == 2 and facts["gate_id"] == "reader-capacity-candidate"
                    and facts["status"] == "passed" and facts["test_count"] == 9,
                    "The complete non-diagnostic candidate comparison is required.")
            valid_counts(facts["result_counts"], 9)
        return {"id": specification["id"], "name": specification["name"],
                "size_in_bytes": len(data), "digest": specification["digest"],
                "crc_verified": True, "entries": len(archive.namelist()), "quality_summary": facts}


def source_proof(source_run, source_sha, attempt, *, reuse, cache):
    run = api(f"actions/runs/{source_run}", cache=cache, name="source-run.json")
    jobs = api(f"actions/runs/{source_run}/attempts/{attempt}/jobs?per_page=100",
               cache=cache, name="source-jobs.json")
    quality = verified_jobs(run, jobs, source_sha=source_sha, source_run=source_run,
                            attempt=attempt, reuse=reuse)
    evidence = []
    if reuse:
        listed = api(f"actions/runs/{BASE_RUN}/artifacts?per_page=100",
                     cache=cache, name="source-artifacts.json")
        require(listed["total_count"] == len(listed["artifacts"]), "Paginated/incomplete source artifacts.")
        for specification in ARTIFACTS:
            matches = [item for item in listed["artifacts"] if item["id"] == specification["id"]]
            require(len(matches) == 1, "Required immutable source artifact is missing.")
            validate_artifact_metadata(matches[0], specification)
            data = api(f"actions/artifacts/{specification['id']}/zip",
                       cache=cache, name=f"source-artifact-{specification['id']}.zip", binary=True)
            evidence.append(validate_quality_zip(data, specification))
        api_job = next(job for job in quality if job["name"] == "api-quality")
        log = api(f"actions/jobs/{api_job['job_id']}/logs",
                  cache=cache, name="source-api-quality.log", binary=True)
        text = log.decode("utf-8")
        require(re.search(r"6751 passed, 3 skipped, 5 warnings in 2176\.23s", text),
                "The complete observed API source regression is required.")
        cases = re.findall(r"tests/test_worker_supervisor\.py::(\S+) PASSED", text)
        require(len(cases) == len(set(cases)) == 17, "The original 17 supervisor cases did not all pass.")
        for poll in (1, 20):
            require(len(re.findall(
                rf"tests/test_supervised_execution_postgres\.py::test_actual_supervisor_process_drains_two_jobs_without_overlapping\[{poll}\] PASSED",
                text)) == 1, "The real PostgreSQL supervisor poll case is missing.")
        evidence.append({"kind": "api-log", "sha256": digest(log), "bytes": len(log),
                         "passed": 6751, "skipped": 3, "warnings": 5,
                         "supervisor_unit_cases_passed": 17, "real_pg_poll_cases_passed": [1, 20]})
    return {
        "repository": REPOSITORY, "sha": source_sha, "workflow_run_id": source_run,
        "workflow_run_attempt": attempt, "workflow_path": WORKFLOW,
        "url": f"https://github.com/{REPOSITORY}/actions/runs/{source_run}",
        "quality_jobs": quality, "verified_evidence": evidence,
    }


def validate_needs(needs, *, reuse):
    require(set(needs) == set(NEEDS_NAMES), "All four original quality dependencies are required.")
    expected = "skipped" if reuse else "success"
    require(all(needs[name].get("result") == expected for name in NEEDS_NAMES),
            "The normal/reuse quality-job branch does not match its declared provenance.")


def verify_report(report, manifest, expected):
    require(isinstance(report, dict)
            and set(report) == {"schema_version", "recorded_at", "verification"},
            "Unknown quality verification report shape.")
    require(type(report["schema_version"]) is int and report["schema_version"] == 1
            and canonical_json(report["verification"]) == canonical_json(expected),
            "Quality report differs from independently verified source, policy or producer identity.")
    require(isinstance(report["recorded_at"], str), "Quality report requires a timestamp string.")
    timestamp = datetime.fromisoformat(report["recorded_at"].replace("Z", "+00:00"))
    require(timestamp.tzinfo is not None, "Quality report requires an explicit time zone.")
    require(isinstance(manifest, dict)
            and type(manifest.get("schema_version")) is int and manifest.get("schema_version") == 2
            and manifest.get("commit") == expected["candidate"]["sha"]
            and manifest.get("workflow_run_id") == expected["candidate"]["workflow_run_id"]
            and manifest.get("workflow_run_attempt") == str(expected["candidate"]["workflow_run_attempt"])
            and manifest.get("archive") == "chat-reader-images.tar.gz"
            and canonical_json(manifest.get("quality_verification")) == canonical_json(report),
            "Release manifest is not bound to this exact candidate and producer quality proof.")


def validate_checkout(head, *, consumer=False, preflight=False):
    require(git("rev-parse", "HEAD").decode().strip() == head, "Checkout does not match the candidate SHA.")
    tracked = git("diff", "--name-only", head, "--").decode().splitlines()
    if preflight:
        tracked = [name for name in tracked if name not in {"apps/web/tsconfig.tsbuildinfo"}]
    require(not tracked and not git("diff", "--cached", "--name-only").strip(),
            "Tracked/index drift is not an accepted image source.")
    if not preflight:
        untracked = git("ls-files", "--others", "--exclude-standard", "-z").decode().split("\0")
        require(all(not name or (consumer and name.startswith("release-artifact/")) for name in untracked),
                "Untracked image-source files are not allowed.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-run", default="")
    parser.add_argument("--head", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--producer-attempt", type=int)
    parser.add_argument("--verify-report", type=Path)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--preflight", action="store_true")
    args = parser.parse_args()
    require(re.fullmatch(r"[0-9a-f]{40}", args.head), "A full lowercase candidate SHA is required.")
    reuse = args.source_run != ""
    require(not reuse or args.source_run == BASE_RUN, "This is not a general quality-skip input; run full CI.")
    require(bool(args.verify_report) == bool(args.manifest), "Consumer requires both proof and manifest.")
    require(not args.preflight or (reuse and not args.verify_report),
            "Read-only preflight is only for the approved image-only repair.")
    validate_checkout(args.head, consumer=bool(args.verify_report), preflight=args.preflight)
    root = os.environ.get("RUNNER_TEMP") or os.environ.get("TEMP")
    require(root and Path(root).is_dir(), "An explicit existing task/runner temporary root is required.")
    require(args.output.resolve().is_relative_to(Path(root).resolve()),
            "Quality proof output must remain inside the explicit task/runner temporary root.")
    cache = Path(root) / ("image-only-consumer" if args.verify_report else "image-only-producer")
    require(not cache.is_symlink(), "A linked evidence-cache directory is not allowed.")
    cache.mkdir(exist_ok=True)
    equivalence = git_equivalence(args.head) if reuse else None
    if args.preflight:
        verification = {
            "purpose": "local-read-only-preflight", "candidate_sha": args.head,
            "source": source_proof(BASE_RUN, BASE_SHA, BASE_ATTEMPT, reuse=True, cache=cache),
            "source_equivalence": equivalence, "ci_dispatched": False, "images_built": False,
        }
    else:
        require(os.environ.get("CI") == "true" and os.environ.get("GITHUB_REPOSITORY") == REPOSITORY
                and os.environ.get("GITHUB_SHA") == args.head, "Only the exact repository CI can create/consume release proof.")
        require(not reuse or os.environ.get("GITHUB_REF") == "refs/heads/master",
                "The approved image-only repair must run on master.")
        run_id = os.environ.get("GITHUB_RUN_ID", "")
        current_attempt = os.environ.get("GITHUB_RUN_ATTEMPT", "")
        require(re.fullmatch(r"[1-9]\d*", run_id) and re.fullmatch(r"[1-9]\d*", current_attempt),
                "Invalid producer/consumer run identity.")
        attempt = args.producer_attempt if args.producer_attempt is not None else int(current_attempt)
        require(1 <= attempt <= int(current_attempt)
                and (args.verify_report is not None or attempt == int(current_attempt)),
                "Invalid artifact producer attempt.")
        if not args.verify_report:
            validate_needs(json.loads(os.environ.get("QUALITY_JOB_RESULTS", "{}")), reuse=reuse)
        verification = {
            "mode": "authorized-image-only" if reuse else "full-exact",
            "candidate": {"sha": args.head, "workflow_run_id": run_id, "workflow_run_attempt": attempt},
            "source": source_proof(
                BASE_RUN if reuse else run_id, BASE_SHA if reuse else args.head,
                BASE_ATTEMPT if reuse else attempt, reuse=reuse, cache=cache,
            ),
            "source_equivalence": equivalence,
            "quality_passed": True,
            "old_images_or_memory_results_reused": False,
        }
        if args.verify_report:
            require(not args.verify_report.is_symlink() and not args.manifest.is_symlink(),
                    "Linked artifact proof/manifest files are not allowed.")
            verify_report(json.loads(args.verify_report.read_text(encoding="utf-8")),
                          json.loads(args.manifest.read_text(encoding="utf-8")), verification)
    report = {"schema_version": 1, "recorded_at": datetime.now(timezone.utc).isoformat(),
              "verification": verification}
    require(not args.output.is_symlink(), "A linked output path is not allowed.")
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"mode": verification.get("mode", verification.get("purpose")),
                      "candidate_sha": args.head, "source_run": args.source_run or os.environ.get("GITHUB_RUN_ID"),
                      "source_verified": True, "images_or_memory_accepted_by_this_guard": False}))


if __name__ == "__main__":
    try:
        main()
    except GateError as error:
        # Gate messages contain only rule names/paths, never raw API/token data.
        raise SystemExit("Release quality/source proof failed: " + str(error))
    except (KeyError, ValueError, TypeError, zipfile.BadZipFile, subprocess.TimeoutExpired) as error:
        # Trace details can contain untrusted API data; report only the safe type.
        raise SystemExit("Release quality/source proof failed (" + type(error).__name__
                         + "); no image build or release bypass is permitted.")
