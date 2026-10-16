import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const evidence = "docs/execution/ux-audit-notebook-editing-2026-10-13-evidence";
const output = `${evidence}/local-verification.json`;
const parentPath = "docs/execution/ux-audit-annotation-composition-2026-10-13-evidence/local-verification.json";
const bytes = file => readFileSync(path.resolve(root, file));
const read = file => bytes(file).toString("utf8").replace(/^\uFEFF/, "");
const json = file => JSON.parse(read(file));
const hash = file => createHash("sha256").update(bytes(file)).digest("hex");
assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: root }).toString().trim(), "84988a260c48fcafb8b3bed6fcb7a1f16348111d");
assert.equal(hash(parentPath), "1e8170e208875d8f0d2ce89ea12f23ec9df47c31b5b7acf1e4d8086fd9fda8e5");
const parent = json(parentPath), probe = json(`${evidence}/probes.json`);
assert.equal(probe.parent_checkpoint_sha256, hash(parentPath));
for (const [file, digest] of Object.entries(probe.source_sha256)) assert.equal(parent.verified_file_sha256_at_checkpoint[file], digest, file);
const inherited = Object.keys(parent.verified_file_sha256_at_checkpoint);
const changed = ["apps/web/e2e/settings-annotation-reads.spec.ts", "apps/web/e2e/settings-notebook-drafts.spec.ts",
  "apps/web/e2e/settings-offline-conflicts.spec.ts", "apps/web/features/annotations/notebook-view.tsx",
  "scripts/ux/annotation-workspace-reads.test.mjs"].sort();
assert.equal(inherited.length, 137);
assert.deepEqual(inherited.filter(file => hash(file) !== parent.verified_file_sha256_at_checkpoint[file]).sort(), changed);
const ancestry = { [parentPath]: hash(parentPath), ...parent.previous_ledger_sha256_by_path };
for (const [file, expected] of Object.entries(ancestry)) {
  assert.equal(hash(file), expected, file);
  const ledger = json(file);
  for (const key of ["pre_edit_evidence_sha256", "preserved_fifth_ci_evidence_sha256", "reviewed_screenshot_sha256", "verification_log_sha256"]) {
    for (const [relative, digest] of Object.entries(ledger[key] ?? {})) assert.equal(hash(path.posix.join(path.posix.dirname(file), relative)), digest);
  }
  if (ledger.intermediate_checkpoint) assert.equal(hash(ledger.intermediate_checkpoint.path), ledger.intermediate_checkpoint.sha256);
}
const countsOf = log => Object.fromEntries([...log.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo|duration_ms) ([\d.]+)\r?$/gm)].map(([, key, value]) => [key, Number(value)]));
const all = countsOf(read(`${evidence}/all-node.txt`)), focused = countsOf(read(`${evidence}/focused.txt`));
assert.equal(all.tests, 845); assert.equal(all.pass, 845); assert.equal(all.fail, 0); assert.equal(all.skipped, 0);
assert.equal(focused.tests, 75); assert.equal(focused.pass, 75); assert.equal(focused.fail, 0); assert.equal(focused.skipped, 0);
const lint = read(`${evidence}/lint.txt`), types = read(`${evidence}/types.txt`), discovery = read(`${evidence}/discovery.txt`), build = read(`${evidence}/build.txt`);
assert.match(lint, /eslint \. --max-warnings=0/); assert.equal(types.trim(), "");
assert.match(discovery, /Total: 52 tests in 6 files/);
assert.match(build, /Compiled successfully/); assert.match(build, /Finished TypeScript/);
assert.match(build, /Generating static pages using 1 worker \(14\/14\)/); assert.match(build, /Route \(pages\)/);
assert.doesNotMatch(build, /Fatal|Failed to type check|ERR_PNPM_RECURSIVE/);
const logFiles = ["all-node.txt", "focused.txt", "lint.txt", "types.txt", "discovery.txt", "build.txt"];
const logHashes = Object.fromEntries(logFiles.map(file => [file, hash(`${evidence}/${file}`)]));
const browserFiles = ["apps/web/e2e/settings-annotation-reads.spec.ts", "apps/web/e2e/settings-notebook-drafts.spec.ts", "apps/web/e2e/settings-offline-conflicts.spec.ts"];
for (const file of browserFiles) {
  const source = read(file);
  assert.match(source, /Notebook title\|精选笔记标题/);
  assert.doesNotMatch(source, /name: "Notebook title", exact: true/);
}
assert.match(read(browserFiles[1]), /name: locale === "zh-CN" \? "精选笔记标题" : "Notebook title", exact: true/);
const docs = ["PROJECT_STATE.md", "docs/index.md", "docs/testing.md", "docs/documentation-inventory.md",
  "docs/system/USER_FLOWS.md", "docs/system/KNOWN_ISSUES_AND_UNCERTAINTIES.md", "docs/execution/ux-audit-notebook-editing-2026-10-13.md"];
let links = 0;
for (const file of docs) for (const match of read(file).replace(/^```[^\n]*\n[\s\S]*?^```[^\n]*$/gm, "").matchAll(/!?\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\)/g)) {
  const target = match[1] ?? match[2]; if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(target)) continue;
  links++;
  const resolved = path.resolve(root, path.dirname(file), decodeURIComponent(target.split("#")[0]));
  assert.ok(existsSync(resolved), `${file}: ${target}`);
}
const result = {
  schema_version: 1, date: "2026-10-13", checkpoint: "local notebook editor accessible-name repair; no new release",
  parent_commit: "84988a260c48fcafb8b3bed6fcb7a1f16348111d", committed: false, submitted_to_ci: false, deployed: false,
  previous_checkpoint: parentPath, previous_ledger_sha256: hash(parentPath), previous_ledger_sha256_by_path: ancestry,
  source_file_count: inherited.length,
  previous_source_comparison: { inherited: inherited.length, unchanged: inherited.length - changed.length, changed_inherited: changed, newly_bound_files: [] },
  verified_file_sha256_at_checkpoint: Object.fromEntries(inherited.map(file => [file, hash(file)])),
  pre_edit_evidence_sha256: { "probe.mjs": hash(`${evidence}/probe.mjs`), "probes.json": hash(`${evidence}/probes.json`) },
  verification_log_sha256: logHashes, verification_log_location: evidence,
  checkpoint_verifier_sha256: hash(`${evidence}/verify-checkpoint.mjs`), unrelated_buildinfo_sha256: parent.unrelated_buildinfo_sha256,
  node_regression: { ...all, repository_script_files: 29, process_concurrency: 1, focused_annotation_cases: focused.pass, overlaps_prior_counts: true },
  checks: { lint: "PASS", nonincremental_types: "PASS", bounded_web_build: "PASS: one worker, 1024 MiB V8 heap; TypeScript and all 14 page generations retained",
    browser_discovery: { tests: 52, files: 6, new_cases: 0, existing_locale_name_assertions_added: 1, executed: 0, screenshots: 0 },
    localized_browser_locators: { files: browserFiles, exact_english_chinese_name_assertion_added: 1 }, links: { documents: docs.length, checked: links, missing: 0 },
    workflow_and_budgets: "UNCHANGED", api_rerun: "NOT_RUN: API/schema unchanged", screen_reader_voice: "NOT_TESTED",
    visual: "NOT_SCORED", cpu_rss: "NOT_MEASURED", local_services_started: 0, local_or_king_image_builds: 0,
    production_accessed: false, dependencies_added: 0, migrations_added: 0 },
  implemented_findings: ["A11Y-NOTE-01"],
  unconfirmed_candidates: ["Direct callback probe bypassed disabled duplicate-compare UI; no product change made",
    "Confirmation callback probe bypassed aria-modal focus interaction; IndexedDB expected-version deletion guard remains unchanged"],
  boundaries: ["Browser and screen-reader voice acceptance pending", "No visual, touch or resource measurement",
    "No CI/deployment authorization", "Broader optimization goal remains active"]
};
if (process.argv.includes("--verify")) {
  assert.deepEqual(json(output), result);
  console.log(JSON.stringify({ status: "PASS", sources: inherited.length, inherited_unchanged: inherited.length - changed.length,
    immutable_ancestors: Object.keys(ancestry).length, node_pass: all.pass, focused_pass: focused.pass,
    browser_discovered: 52, browser_executed: 0, links, buildinfo_unchanged: true }));
} else console.log(JSON.stringify(result, null, 2));
