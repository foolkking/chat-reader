import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { summarizeGateEvidence } from "../../apps/web/e2e/gate-summary.mjs";
import {
  SETTINGS_CASE_COUNT, WEB_GATE_GROUPS, mergeSettingsReports, mergeWebSummaries,
  prepareSettingsBlobs, verifyNativeShardUnion, frozenSettingsRuntimeTimeouts,
} from "./quality-shard-evidence.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPT = path.join(REPO, "scripts/ci/quality-shard-evidence.mjs");
const SHA = "b".repeat(40);
const clone = (value) => JSON.parse(JSON.stringify(value));
const counts = (passed) => ({ passed, failed: 0, timedOut: 0, skipped: 0, interrupted: 0 });

function nativeReport(ids, { collection = false, shard = null, merged = false } = {}) {
  return {
    config: {
      version: "1.62.0", fullyParallel: false, workers: merged ? 2 : 1, globalTimeout: 0, maxFailures: 0, shard,
      projects: merged
        ? [1, 2].map(() => ({ name: "", retries: 0, repeatEach: 1, timeout: 90_000, metadata: { actualWorkers: 1 } }))
        : [{ id: "", name: "", retries: 0, repeatEach: 1, timeout: 90_000 }],
    },
    suites: [{ specs: ids.map((id) => ({
      id, file: "synthetic.spec.ts", title: `Synthetic ${id}`, line: 1, column: 1, ok: true,
      tests: [{
        ...(merged ? { projectName: "" } : { projectId: "", projectName: "" }),
        timeout: 90_000, expectedStatus: "passed", status: collection ? "skipped" : "expected",
        results: collection ? [] : [{
          status: "passed", retry: 0, duration: 1, startTime: "2026-11-16T00:00:00.000Z", errors: [],
        }],
      }],
    })) }],
    errors: [],
    stats: { expected: collection ? 0 : ids.length, skipped: collection ? ids.length : 0,
      unexpected: 0, flaky: 0, duration: 1000 },
  };
}
function settingsFixture() {
  const ids = Array.from({ length: SETTINGS_CASE_COUNT }, (_, index) => `synthetic-${index}`);
  return {
    collection: nativeReport(ids, { collection: true }),
    shards: [1, 2].map((index) => nativeReport(ids.slice((index - 1) * 235, index * 235),
      { shard: { current: index, total: 2 } })),
    merged: nativeReport(ids, { merged: true }),
  };
}
function verify(fixture) {
  return mergeSettingsReports(fixture.collection, fixture.shards, fixture.merged, SHA);
}
function webFixture() {
  return WEB_GATE_GROUPS.map((group) => ({
    schema_version: 1, source_sha: SHA, overall_status: "PASS",
    counts: { PASS: group.length, FAIL: 0, NOT_VERIFIED: 0, SKIPPED: 0 },
    gates: group.map((id) => ({
      gate_id: id, status: "PASS", evidence_status: "passed", test_count: 3, result_counts: counts(3),
    })),
  }));
}
function ownedTemp(prefix) {
  const base = process.env.RUNNER_TEMP || process.env.TEMP;
  assert.ok(base && fs.existsSync(base), "An explicit task/runner TEMP is required");
  if (process.platform === "win32") {
    assert.match(path.resolve(base), /^(?:E:\\chat-reader-temp\\|C:\\Users\\86182\\Desktop\\wkkk\\)/i);
  }
  const root = fs.mkdtempSync(path.join(base, prefix));
  assert.equal(fs.realpathSync(root), path.resolve(root));
  assert.equal(path.dirname(root), path.resolve(base));
  return root; // Preserve small native reports and rejection controls, no recursive cleanup.
}
function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value), { flag: "wx" });
}
function command(args, options = {}) {
  return spawnSync(process.execPath, args, {
    cwd: REPO, encoding: "utf8", timeout: 30_000, ...options,
  });
}

test("two exact native Settings shards produce the original470-case evidence", () => {
  const result = verify(settingsFixture());
  assert.equal(result.evidence.test_count, 470);
  assert.deepEqual(result.evidence.result_counts, counts(470));
  assert.equal(result.coverage.case_ids.length, new Set(result.coverage.case_ids).size);
  assert.deepEqual(result.coverage.shard_counts, [235, 235]);
});

test("runtime timeout mapping must contain the exact selected case IDs and exact original limits", () => {
  const fixture = settingsFixture();
  const timeouts = new Map(fixture.collection.suites[0].specs.map((spec) => [spec.id, 90_000]));
  const first = fixture.shards[0].suites[0].specs[0];
  first.tests[0].timeout = 120_000;
  fixture.merged.suites[0].specs[0].tests[0].timeout = 120_000;
  assert.throws(() => verifyNativeShardUnion(fixture.collection, fixture.shards, fixture.merged));
  timeouts.set(first.id, 120_000);
  assert.equal(verifyNativeShardUnion(fixture.collection, fixture.shards, fixture.merged, timeouts).cases.size, 470);
  timeouts.set(first.id, 120_001);
  assert.throws(() => verifyNativeShardUnion(fixture.collection, fixture.shards, fixture.merged, timeouts));
  timeouts.set(first.id, 120_000);
  timeouts.set("not-collected", 90_000);
  assert.throws(() => verifyNativeShardUnion(fixture.collection, fixture.shards, fixture.merged, timeouts));
});

test("frozen Settings source binding cannot be replaced by a synthetic470 collection", () => {
  assert.throws(() => frozenSettingsRuntimeTimeouts(settingsFixture().collection), /source selection/);
});

const badSettings = [
  ["one missing shard", (f) => f.shards.pop()],
  ["one extra shard", (f) => f.shards.push(clone(f.shards[0]))],
  ["old --list instead of actual execution", (f) => {
    f.shards[0] = nativeReport(f.shards[0].suites[0].specs.map((s) => s.id),
      { collection: true, shard: { current: 1, total: 2 } });
  }],
  ["a count-only470 pass without attempts", (f) => { f.shards[0].suites[0].specs[0].tests[0].results = []; }],
  ["duplicate case within one shard", (f) => { f.shards[0].suites[0].specs[1].id = f.shards[0].suites[0].specs[0].id; }],
  ["duplicate case across shards", (f) => { f.shards[1].suites[0].specs[0] = clone(f.shards[0].suites[0].specs[0]); }],
  ["a substituted case ID", (f) => { f.shards[0].suites[0].specs[0].id = "not-original"; }],
  ["a missing original case", (f) => { f.shards[0].suites[0].specs.pop(); f.shards[0].stats.expected--; }],
  ["a repeated project case", (f) => { f.shards[0].suites[0].specs[0].tests.push(clone(f.shards[0].suites[0].specs[0].tests[0])); }],
  ["a replaced source location", (f) => { f.shards[0].suites[0].specs[0].file = "another.spec.ts"; }],
  ["an increased per-case deadline", (f) => { f.shards[0].suites[0].specs[0].tests[0].timeout++; }],
  ["a failed report-level error", (f) => { f.shards[0].errors.push({ message: "synthetic failure" }); }],
  ["an incorrect shard number", (f) => { f.shards[0].config.shard.current = 2; }],
  ["an incorrect shard total", (f) => { f.shards[0].config.shard.total = 3; }],
  ["a full execution reused as collection", (f) => { f.collection.suites[0].specs[0].tests[0].results = [{}]; }],
  ["a sharded full collection", (f) => { f.collection.config.shard = { current: 1, total: 2 }; }],
  ["a changed native version", (f) => { f.shards[0].config.version = "other"; }],
  ["concurrent workers in one physical fixture", (f) => { f.shards[0].config.workers = 2; }],
  ["fully parallel cases in one fixture", (f) => { f.shards[0].config.fullyParallel = true; }],
  ["a new global deadline", (f) => { f.shards[0].config.globalTimeout = 1; }],
  ["early max-failures", (f) => { f.shards[0].config.maxFailures = 1; }],
  ["configured retries", (f) => { f.shards[0].config.projects[0].retries = 1; }],
  ["changed original test deadline", (f) => { f.shards[0].config.projects[0].timeout++; }],
  ["a skipped expected failure", (f) => { f.shards[0].suites[0].specs[0].tests[0].expectedStatus = "failed"; }],
  ["a retry after a prior failure", (f) => { f.shards[0].suites[0].specs[0].tests[0].results.push({ status: "passed", retry: 1 }); }],
  ["a lone passed retry", (f) => { f.shards[0].suites[0].specs[0].tests[0].results[0].retry = 1; }],
  ["unreported failed statistics", (f) => { f.shards[0].stats.unexpected = 1; }],
  ["boolean numeric counts", (f) => { f.shards[0].stats.expected = true; }],
  ["missing merged native case", (f) => { f.merged.suites[0].specs.pop(); f.merged.stats.expected--; }],
  ["merged attempt not from either original shard", (f) => { f.merged.suites[0].specs[0].tests[0].results[0].duration++; }],
  ["incorrectly serial-looking merged worker total", (f) => { f.merged.config.workers = 1; }],
  ["missing physical merged project", (f) => { f.merged.config.projects.pop(); }],
  ["an extra merged project", (f) => { f.merged.config.projects.push(clone(f.merged.config.projects[0])); }],
  ["a different merged project name", (f) => { f.merged.config.projects[1].name = "another-project"; }],
  ["concurrent actual workers in a merged physical project", (f) => { f.merged.config.projects[1].metadata.actualWorkers = 2; }],
  ["configured retries in the second merged project", (f) => { f.merged.config.projects[1].retries = 1; }],
  ["an increased deadline in the second merged project", (f) => { f.merged.config.projects[1].timeout++; }],
  ["a substituted merged case project", (f) => { f.merged.suites[0].specs[0].tests[0].projectName = "another-project"; }],
  ["a native project ID invented by the merged report", (f) => { f.merged.suites[0].specs[0].tests[0].projectId = ""; }],
];
for (const [name, mutate] of badSettings) {
  test(`Settings merge rejects ${name}`, () => {
    const fixture = settingsFixture();
    mutate(fixture);
    assert.throws(() => verify(fixture));
  });
}
for (const status of ["failed", "timedOut", "skipped", "interrupted"]) {
  test(`Settings merge rejects an actual ${status} attempt`, () => {
    const fixture = settingsFixture();
    fixture.shards[0].suites[0].specs[0].tests[0].results[0].status = status;
    assert.throws(() => verify(fixture));
  });
}

test("Web merge preserves every original gate and legitimate conditional skips", () => {
  const fixture = webFixture();
  fixture[0].gates[0].test_count = 5;
  fixture[0].gates[0].result_counts.skipped = 2;
  const merged = mergeWebSummaries(fixture, SHA);
  assert.equal(merged.gates.length, 14);
  assert.deepEqual(merged.counts, { PASS: 14, FAIL: 0, NOT_VERIFIED: 0, SKIPPED: 0 });
});
for (const [name, mutate] of [
  ["inherited source", (f) => { f[0].source_sha = "c".repeat(40); }],
  ["missing gate", (f) => f[0].gates.pop()],
  ["duplicate gate", (f) => { f[0].gates[1].gate_id = f[0].gates[0].gate_id; }],
  ["gate in the wrong shard", (f) => { f[0].gates[0].gate_id = f[1].gates[0].gate_id; }],
  ["incomplete report", (f) => { f[0].overall_status = "NOT_VERIFIED"; }],
  ["nonexecuted gate", (f) => { f[0].gates[0].result_counts = counts(0); }],
  ["all skipped gate", (f) => { f[0].gates[0].result_counts = { ...counts(0), skipped: 3 }; }],
  ["failed native status", (f) => { f[0].gates[0].evidence_status = "failed"; }],
  ["misreported counts", (f) => { f[0].gates[0].result_counts.failed = 1; }],
  ["boolean counts", (f) => { f[0].gates[0].result_counts.passed = true; }],
  ["omitted count fields", (f) => { delete f[0].gates[0].result_counts.interrupted; }],
]) {
  test(`Web merge rejects ${name}`, () => {
    const fixture = webFixture();
    mutate(fixture);
    assert.throws(() => mergeWebSummaries(fixture, SHA));
  });
}

test("artifact consumer preserves raw evidence and rejects ambiguous or linked summaries and overwrites", () => {
  const root = ownedTemp("quality-artifact-control-");
  const fixture = webFixture();
  for (const index of [1, 2]) {
    write(path.join(root, `shard-${index}/original/apps/web/test-results/web-shard-gate-summary.json`), fixture[index - 1]);
    write(path.join(root, `shard-${index}/original/_temp/node-browser/control.png`), "synthetic PNG bytes");
  }
  const output = path.join(root, "combined/release-gate-summary.json");
  let result = command([SCRIPT, "merge-web", root, output, SHA]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(fs.readFileSync(output)).gates.length, 14);
  assert.equal(fs.readFileSync(path.join(root, "shard-1/original/_temp/node-browser/control.png"), "utf8"), "synthetic PNG bytes");
  const original = fs.readFileSync(output);
  result = command([SCRIPT, "merge-web", root, output, SHA]);
  assert.equal(result.status, 1);
  assert.deepEqual(fs.readFileSync(output), original);
  write(path.join(root, "shard-1/duplicate/apps/web/test-results/web-shard-gate-summary.json"), fixture[0]);
  result = command([SCRIPT, "merge-web", root, path.join(root, "ambiguous.json"), SHA]);
  assert.equal(result.status, 1);
  assert.equal(fs.existsSync(path.join(root, "ambiguous.json")), false);
  const linkedRoot = ownedTemp("quality-linked-control-");
  const target = path.join(linkedRoot, "synthetic-target");
  fs.mkdirSync(target);
  fs.symlinkSync(target, path.join(root, "shard-2/linked"), process.platform === "win32" ? "junction" : "dir");
  result = command([SCRIPT, "merge-web", root, path.join(root, "linked.json"), SHA]);
  assert.equal(result.status, 1);
  assert.equal(fs.readdirSync(target).length, 0);
});

test("genuine pinned Playwright blob merge retains IDs and attempts, but four controls cannot release470", () => {
  const root = ownedTemp("quality-native-blob-control-");
  const webRequire = createRequire(path.join(REPO, "apps/web/package.json"));
  const entry = webRequire.resolve("@playwright/test");
  const packageFile = createRequire(webRequire.resolve("@playwright/test/package.json")).resolve("playwright/package.json");
  const cli = path.join(path.dirname(packageFile), "cli.js");
  const config = path.join(root, "native.config.ts");
  write(config, `import { defineConfig } from ${JSON.stringify(entry)};
export default defineConfig({
  testDir: ${JSON.stringify(root)}, testMatch: "native-*.spec.ts",
  fullyParallel: false, workers: 1, timeout: 90000,
  outputDir: ${JSON.stringify(path.join(root, "native-results"))},
  reporter: [
    ["json"], ["blob", { outputDir: process.env.PLAYWRIGHT_BLOB_OUTPUT_DIR }],
    [${JSON.stringify(path.join(REPO, "apps/web/e2e/gate-evidence-reporter.ts"))}, {
      gateId: process.env.PLAYWRIGHT_GATE_ID, outputFile: process.env.CONTROL_GATE_EVIDENCE_FILE,
    }],
  ],
});`);
  for (const file of ["one", "two"]) {
    write(path.join(root, `native-${file}.spec.ts`), `import { test, expect } from ${JSON.stringify(entry)};
test("synthetic ${file} first", () => { test.setTimeout(120000); expect(1 + 1).toBe(2); });
test("synthetic ${file} second", () => expect("retained").toContain("tain"));`);
  }
  const collectionFile = path.join(root, "full-collection.json");
  let result = command([cli, "test", `--config=${config}`, "--list", "--reporter=json"], {
    env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: collectionFile },
  });
  assert.equal(result.status, 0, result.stderr);
  const reports = [];
  for (const index of [1, 2]) {
    const shardRoot = path.join(root, `artifacts/shard-${index}`);
    const gateId = `settings-stages-1-4-shard-${index}`;
    const testResults = path.join(shardRoot, "apps/web/test-results");
    const reportFile = path.join(shardRoot, "_temp/settings-shard-report.json");
    const blobDir = path.join(shardRoot, "_temp/settings-blob-report");
    // The native blob reporter clears outputDir: admit only this new owned path.
    assert.ok(path.resolve(blobDir).startsWith(`${fs.realpathSync(root)}${path.sep}`));
    assert.equal(fs.existsSync(blobDir), false);
    fs.mkdirSync(path.dirname(blobDir), { recursive: true });
    result = command([cli, "test", `--config=${config}`, `--shard=${index}/2`], {
      env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile, PLAYWRIGHT_BLOB_OUTPUT_DIR: blobDir,
        PLAYWRIGHT_GATE_ID: gateId, CONTROL_GATE_EVIDENCE_FILE: path.join(testResults, gateId, "gate-evidence.json") },
    });
    assert.equal(result.status, 0, result.stderr);
    reports.push(JSON.parse(fs.readFileSync(reportFile)));
    const summary = summarizeGateEvidence({ rootDir: testResults, expectedGateIds: [gateId], sourceSha: SHA });
    assert.equal(summary.overall_status, "PASS");
    write(path.join(testResults, "settings-shard-gate-summary.json"), summary);
  }
  const blobs = path.join(root, "native-merged-blobs");
  prepareSettingsBlobs(path.join(root, "artifacts"), blobs);
  const mergedFile = path.join(root, "native-merged.json");
  result = command([cli, "merge-reports", "--reporter=json", blobs], {
    env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: mergedFile },
  });
  assert.equal(result.status, 0, result.stderr);
  const collection = JSON.parse(fs.readFileSync(collectionFile));
  const merged = JSON.parse(fs.readFileSync(mergedFile));
  const timeouts = new Map(collection.suites.flatMap((suite) => suite.specs.map((spec) =>
    [spec.id, spec.title.endsWith("first") ? 120_000 : 90_000])));
  assert.throws(() => verifyNativeShardUnion(collection, reports, merged),
    /original full collection/, "native --list keeps the default while test bodies use their original limits");
  const verified = verifyNativeShardUnion(collection, reports, merged, timeouts);
  assert.equal(verified.cases.size, 4);
  assert.deepEqual(verified.shardCounts, [2, 2]);
  assert.equal(merged.config.workers, 2, "native sum of two genuinely serial physical shards");
  assert.equal(merged.config.projects.length, 2, "native merge retains the two physical shard configurations");
  assert.ok(merged.config.projects.every((project) => project.id === undefined && project.metadata.actualWorkers === 1));
  assert.throws(() => mergeSettingsReports(collection, reports, merged, SHA, timeouts), /original470/);
});
