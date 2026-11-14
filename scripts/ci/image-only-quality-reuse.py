#!/usr/bin/env python3
"""Fail-closed, one-off reuse of the November 14 *quality* results.

The normal empty-input workflow still runs all four quality jobs. The opt-in
permits only the exact null-failure control-plane repair, never application,
dependency, old-test, resource-gate or arbitrary workflow changes. Both image
producer and independent artifact consumer verify the same source/proof.
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


def git_equivalence(head):
    parents = git("rev-list", "--parents", "-n", "1", head).decode().strip().split()[1:]
    return verify_equivalence(
        tree(BASE_SHA), tree(head), lambda value: git("cat-file", "blob", value), parents, head,
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


def api(endpoint, *, cache, name, binary=False):
    result = subprocess.run(["gh", "api", f"repos/{REPOSITORY}/{endpoint}"],
                            cwd=REPO, capture_output=True, timeout=180)
    # Never print or persist credentials, subprocess environment or raw errors.
    require(result.returncode == 0, f"Official GitHub evidence query failed: {name}")
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
