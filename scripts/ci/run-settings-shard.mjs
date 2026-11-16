// Whole-file partitions, never count-based Playwright shards or shared workers.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { validateSettingsSources, SCHEDULE_SHA256, digest } from "./quality-schedule.mjs";

const plan = validateSettingsSources();
const shard = Number(process.env.CI_QUALITY_SHARD);
assert.ok(Number.isInteger(shard) && shard >= 1 && shard <= 4);
const source = process.env.GITHUB_SHA;
assert.match(source, /^[a-f0-9]{40}$/);
for (const name of ["GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"]) assert.match(process.env[name], /^[1-9][0-9]*$/);
const root = process.env.RUNNER_TEMP;
assert.ok(root && path.isAbsolute(root));
const collectionFile = path.join(root, "settings-shard-collection.json");
const selected = Object.keys(plan.settings.assignment).filter((file) => plan.settings.assignment[file] === shard).sort();
const base = ["--filter", "web", "exec", "playwright", "test", "--config=playwright.config.ts"];
function run(args, env = process.env) {
  const result = spawnSync("pnpm", args, { env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
assert.ok(!fs.existsSync(collectionFile));
run([...base, "e2e/settings-.*\\.spec\\.ts", "e2e/context-admin-bundles.spec.ts", "--list", "--reporter=json"],
  { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: collectionFile });
const collection = JSON.parse(fs.readFileSync(collectionFile, "utf8"));
const files = new Set();
let count = 0;
function visit(suites) {
  for (const suite of suites) {
    for (const spec of suite.specs ?? []) { files.add(spec.file); count += 1; }
    visit(suite.suites ?? []);
  }
}
visit(collection.suites);
assert.equal(count, 470);
assert.deepEqual([...files].sort(), Object.keys(plan.settings.assignment).sort());
assert.equal(collection.errors.length, 0);
assert.equal(collection.config.shard, null);
// Argument array, no shell interpolation; retain natural Playwright file ordering.
run([...base, ...selected.map((file) => `e2e/${file.replaceAll(".", "\\.")}$`)]);
const report = process.env.PLAYWRIGHT_JSON_OUTPUT_NAME;
const blob = path.join(process.env.PLAYWRIGHT_BLOB_OUTPUT_DIR, process.env.PLAYWRIGHT_BLOB_OUTPUT_NAME);
const proof = {
  schema_version: 2, source_sha: source, run_id: process.env.GITHUB_RUN_ID,
  run_attempt: process.env.GITHUB_RUN_ATTEMPT, schedule_sha256: SCHEDULE_SHA256,
  shard, selected_files: selected, collection_sha256: digest(fs.readFileSync(collectionFile)),
  report_sha256: digest(fs.readFileSync(report)), blob_sha256: digest(fs.readFileSync(blob)),
};
fs.writeFileSync(path.join(root, "settings-selection.json"), `${JSON.stringify(proof, null, 2)}\n`, { flag: "wx" });
