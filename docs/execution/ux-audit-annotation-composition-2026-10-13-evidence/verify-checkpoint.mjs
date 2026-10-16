import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const evidence = "docs/execution/ux-audit-annotation-composition-2026-10-13-evidence";
const output = `${evidence}/local-verification.json`;
const parentPath = "docs/execution/ux-audit-annotation-writes-2026-10-13-evidence/local-verification.json";
const bytes = file => readFileSync(path.resolve(root, file));
const read = file => bytes(file).toString("utf8").replace(/^\uFEFF/, "");
const json = file => JSON.parse(read(file));
const hash = file => createHash("sha256").update(bytes(file)).digest("hex");
const base = "84988a260c48fcafb8b3bed6fcb7a1f16348111d";
assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: root }).toString().trim(), base);
assert.equal(hash(parentPath), "74263a41c5b83def66208d9f6b05de3c22b8eb3158d576e0dc11600cc1627c3e");
const parent = json(parentPath), probe = json(`${evidence}/probes.json`);
assert.equal(probe.parent_checkpoint_sha256, hash(parentPath));
for (const [file, digest] of Object.entries(probe.source_sha256)) assert.equal(parent.verified_file_sha256_at_checkpoint[file], digest, file);
const inherited = Object.keys(parent.verified_file_sha256_at_checkpoint);
const changed = ["apps/web/features/annotations/annotation-workspace.tsx", "scripts/ux/annotation-workspace-reads.test.mjs"].sort();
const added = ["apps/web/e2e/settings-annotation-composition.spec.ts"];
assert.equal(inherited.length, 136);
assert.deepEqual(inherited.filter(file => hash(file) !== parent.verified_file_sha256_at_checkpoint[file]).sort(), changed);
const sources = [...new Set([...inherited, ...added])].sort();
const ancestry = { [parentPath]: hash(parentPath), ...parent.previous_ledger_sha256_by_path };
for (const [file, expected] of Object.entries(ancestry)) {
  assert.equal(hash(file), expected, file);
  const ledger = json(file);
  for (const key of ["pre_edit_evidence_sha256", "preserved_fifth_ci_evidence_sha256", "reviewed_screenshot_sha256", "verification_log_sha256"]) {
    for (const [relative, digest] of Object.entries(ledger[key] ?? {})) assert.equal(hash(path.posix.join(path.posix.dirname(file), relative)), digest);
  }
  if (ledger.intermediate_checkpoint) assert.equal(hash(ledger.intermediate_checkpoint.path), ledger.intermediate_checkpoint.sha256);
}
assert.equal(hash("apps/web/tsconfig.tsbuildinfo"), parent.unrelated_buildinfo_sha256);
const logNames = ["all-node", "focused", "lint", "types", "discovery", "build"];
const logFile = name => `${name}.txt`;
const logs = Object.fromEntries(logNames.map(name => [name, read(`${evidence}/${logFile(name)}`)]));
const logHashes = Object.fromEntries(logNames.map(name => [logFile(name), hash(`${evidence}/${logFile(name)}`)]));
const countsOf = log => Object.fromEntries([...log.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo|duration_ms) ([\d.]+)\r?$/gm)].map(([, key, value]) => [key, Number(value)]));
const counts = countsOf(logs["all-node"]), focused = countsOf(logs.focused);
assert.equal(counts.tests, 844); assert.equal(counts.pass, 844); assert.equal(counts.fail, 0); assert.equal(counts.skipped, 0);
assert.equal(focused.tests, 74); assert.equal(focused.pass, 74); assert.equal(focused.fail, 0); assert.equal(focused.skipped, 0);
assert.match(logs.lint, /eslint \. --max-warnings=0/); assert.equal(logs.types.trim(), "");
assert.match(logs.build, /Compiled successfully/);
assert.match(logs.build, /Finished TypeScript/);
assert.match(logs.build, /Generating static pages using 1 worker \(14\/14\)/);
assert.match(logs.build, /Route \(pages\)/);
assert.doesNotMatch(logs.build, /Fatal|Failed to type check|ERR_PNPM_RECURSIVE/);
assert.match(logs.discovery, /Total: 52 tests in 6 files/);
const cleanup = json(`${evidence}/temp-cleanup.json`);
assert.equal(cleanup.removed_duplicate_bytes, 405809581);
assert.equal(cleanup.original_ci_artifacts_removed, false);
const loss = json(`${evidence}/temp-evidence-loss.json`);
assert.equal(loss.previous_observations.full_parallel_node.pass, 713);
assert.equal(loss.previous_observations.full_parallel_node.failed_processes, 5);
const docs = ["PROJECT_STATE.md", "docs/index.md", "docs/testing.md", "docs/documentation-inventory.md",
  "docs/system/USER_FLOWS.md", "docs/system/KNOWN_ISSUES_AND_UNCERTAINTIES.md", "docs/execution/ux-audit-annotation-composition-2026-10-13.md"];
let links = 0;
for (const file of docs) for (const match of read(file).replace(/^```[^\n]*\n[\s\S]*?^```[^\n]*$/gm, "").matchAll(/!?\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\)/g)) {
  const target = match[1] ?? match[2]; if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(target)) continue;
  links++;
  const resolved = path.resolve(root, path.dirname(file), decodeURIComponent(target.split("#")[0]));
  assert.ok(existsSync(resolved) || (!process.argv.includes("--verify") && resolved === path.resolve(root, output)), `${file}: ${target}`);
}
const result = {
  schema_version: 1, date: "2026-10-13", checkpoint: "local annotation creation and notebook addition recovery; no new release",
  parent_commit: base, committed: false, submitted_to_ci: false, deployed: false,
  previous_checkpoint: parentPath, previous_ledger_sha256: hash(parentPath), previous_ledger_sha256_by_path: ancestry,
  source_file_count: sources.length,
  previous_source_comparison: { inherited: inherited.length, unchanged: inherited.length - changed.length, changed_inherited: changed, newly_bound_files: added },
  verified_file_sha256_at_checkpoint: Object.fromEntries(sources.map(file => [file, hash(file)])),
  pre_edit_evidence_sha256: { "probe.mjs": hash(`${evidence}/probe.mjs`), "probes.json": hash(`${evidence}/probes.json`) },
  temp_cleanup: { path: `${evidence}/temp-cleanup.json`, sha256: hash(`${evidence}/temp-cleanup.json`), removed_duplicate_bytes: cleanup.removed_duplicate_bytes,
    recoverable_when_removed: true, retained_recovery_sources_later_disappeared: true },
  temporary_evidence_loss: { path: `${evidence}/temp-evidence-loss.json`, sha256: hash(`${evidence}/temp-evidence-loss.json`), cause: "UNKNOWN" },
  verification_log_sha256: logHashes, verification_log_location: evidence,
  checkpoint_verifier_sha256: hash(`${evidence}/verify-checkpoint.mjs`), unrelated_buildinfo_sha256: parent.unrelated_buildinfo_sha256,
  node_regression: { ...counts, repository_script_files: 29, process_concurrency: 1, focused_annotation_cases: focused.pass, overlaps_prior_counts: true },
  checks: { lint: "PASS", nonincremental_types: "PASS", bounded_web_build: "PASS: one worker, 1024 MiB V8 heap limit; typecheck and all 14 page generation checks retained",
    browser_discovery: { tests: 52, files: 6, new_cases: 4, executed: 0, screenshots: 0, selection_method: "Real DOM Range in authored browser tests; no native touch gesture claim" },
    inherited_browser_files: "Unchanged from parent source bindings; no deleted assertions",
    links: { documents: docs.length, checked: links, missing: 0 }, workflow_and_budgets: "UNCHANGED",
    api_rerun: "NOT_RUN: API and schema unchanged", visual: "NOT_SCORED", cpu_rss: "NOT_MEASURED",
    local_services_started: 0, local_or_king_image_builds: 0, production_accessed_for_this_repair: false,
    dependencies_added: 0, migrations_added: 0 },
  previously_observed_failed_attempts: [
    { original_log: "annotation-composition-all-node-20261013.log", original_log_available: false, pass: 713, failed_processes: 5, tap_nodes: 718, cause: "V8 native Zone memory exhaustion; incomplete enumeration is not a skip or assertion pass" },
    { original_log: "annotation-composition-all-node-bounded-20261013.log", original_log_available: false, status: "INVALID_INCOMPLETE", cause: "C: zero free bytes interrupted logging; stale LASTEXITCODE made outer shell exit zero; not a passing run" },
    { original_log: "annotation-composition-build-20261013.log", original_log_available: false, exit_code: 1, cause: "Compile passed; V8 Zone memory exhaustion during TypeScript; no specific type diagnostic" }
  ],
  implemented_findings: ["FORM-CREATE-01", "STATE-NOTE-ADD-01", "STATE-CREATE-02"],
  boundaries: ["Browser, touch, focus and visual acceptance still pending", "Recovered writes and retained comments stay in current scope memory, not across routing/reload",
    "Current-state reads are not mutation receipts", "No new dependencies, polling, server transactions or offline format changes",
    "Local resource failures do not measure product CPU/RSS", "No additional CI/deployment without explicit user request", "Broader goal remains active"]
};
if (process.argv.includes("--verify")) {
  assert.deepEqual(json(output), result);
  console.log(JSON.stringify({ status: "PASS", sources: sources.length, inherited_unchanged: inherited.length - changed.length,
    immutable_ancestors: Object.keys(ancestry).length, node_pass: counts.pass, focused_pass: focused.pass, browser_discovered: 52, browser_executed: 0,
    documents: docs.length, links, buildinfo_unchanged: true }));
} else console.log(JSON.stringify(result, null, 2));
