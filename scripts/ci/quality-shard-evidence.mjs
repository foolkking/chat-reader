import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

export const SETTINGS_CASE_COUNT = 470;
export const WEB_GATE_GROUPS = [
  ["adaptive-import-recovery", "csp-enforcement", "focused-online-security", "share-focus",
    "source-editor-mutation", "source-editor-cleanup", "upload-token-atomicity"],
  ["context-files", "markdown-image-viewer", "reading-stability", "pdfjs-maintained-line",
    "default-pwa", "single-owner-auth", "pwa-negative"],
];
const WEB_GATE_IDS = [
  "adaptive-import-recovery", "csp-enforcement", "context-files", "focused-online-security",
  "share-focus", "source-editor-mutation", "source-editor-cleanup", "upload-token-atomicity",
  "markdown-image-viewer", "reading-stability", "pdfjs-maintained-line", "default-pwa",
  "single-owner-auth", "pwa-negative",
];
const zeroCounts = () => ({ passed: 0, failed: 0, timedOut: 0, skipped: 0, interrupted: 0 });
const passCounts = (count) => ({ ...zeroCounts(), passed: count });
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CONTRACT_SHA256 = "af1523d28f658f4bd3d1b3a6ad2f018250b5b909db0f7b81f4e00eeeb212084c";

class EvidenceError extends Error {}
function requireEvidence(condition, rule) {
  if (!condition) throw new EvidenceError(rule);
}
function requireSha(sourceSha) {
  requireEvidence(typeof sourceSha === "string" && /^[0-9a-f]{40}$/.test(sourceSha), "exact source SHA required");
}
function sameIds(actual, expected, rule) {
  requireEvidence(actual.length === expected.length
    && new Set(actual).size === actual.length
    && isDeepStrictEqual([...actual].sort(), [...expected].sort()), rule);
}

export function mergeWebSummaries(summaries, sourceSha, generatedAt = new Date().toISOString()) {
  requireSha(sourceSha);
  requireEvidence(Array.isArray(summaries) && summaries.length === 2, "exactly two Web shards required");
  const gates = new Map();
  summaries.forEach((summary, index) => {
    const expected = WEB_GATE_GROUPS[index];
    requireEvidence(summary?.schema_version === 1 && summary.source_sha === sourceSha
      && summary.overall_status === "PASS", "wrong or incomplete Web shard source");
    requireEvidence(isDeepStrictEqual(summary.counts,
      { PASS: expected.length, FAIL: 0, NOT_VERIFIED: 0, SKIPPED: 0 }), "Web shard count summary rejected");
    requireEvidence(Array.isArray(summary.gates), "Web shard gate list required");
    sameIds(summary.gates.map((gate) => gate.gate_id), expected, "original Web shard gate selection changed");
    for (const gate of summary.gates) {
      const counts = gate.result_counts;
      requireEvidence(gate.status === "PASS" && gate.evidence_status === "passed"
        && Number.isInteger(gate.test_count) && gate.test_count > 0, "Web gate did not execute successfully");
      requireEvidence(counts && Object.keys(counts).length === 5
        && Object.keys(zeroCounts()).every((key) => Number.isInteger(counts[key]) && counts[key] >= 0)
        && counts.passed > 0 && counts.failed === 0 && counts.timedOut === 0 && counts.interrupted === 0
        && counts.passed + counts.skipped === gate.test_count, "Web gate result counts incomplete");
      requireEvidence(!gates.has(gate.gate_id), "duplicate Web gate");
      gates.set(gate.gate_id, gate);
    }
  });
  sameIds([...gates.keys()], WEB_GATE_IDS, "complete original fourteen Web gates required");
  return {
    schema_version: 1, source_sha: sourceSha, generated_at: generatedAt, overall_status: "PASS",
    counts: { PASS: gates.size, FAIL: 0, NOT_VERIFIED: 0, SKIPPED: 0 },
    gates: WEB_GATE_IDS.map((id) => gates.get(id)),
  };
}

function nativeCases(report, {
  collection = false, shard = null, merged = false, referenceProject = null, runtimeTimeouts = null,
} = {}) {
  requireEvidence(report && Array.isArray(report.suites) && Array.isArray(report.errors)
    && report.errors.length === 0, "native Playwright report missing or errored");
  const config = report.config;
  // Native blob merge retains both physical project configurations, sums their
  // workers, and emits projectName instead of projectId. Bind that representation
  // to the one original selected project; do not rewrite the original reports.
  requireEvidence(config?.version === "1.62.0" && config.workers === (merged ? 2 : 1) && config.fullyParallel === false
    && config.globalTimeout === 0 && config.maxFailures === 0
    && Array.isArray(config.projects) && config.projects.length === (merged ? 2 : 1)
    && config.projects.every((project) => project.retries === 0 && project.repeatEach === 1
      && project.timeout === 90_000), "original native configuration changed");
  const project = merged ? referenceProject : config.projects[0];
  requireEvidence(project && typeof project.id === "string" && typeof project.name === "string",
    "one original named native project required");
  if (merged) {
    requireEvidence(config.projects.every((entry) => entry.id === undefined && entry.name === project.name
      && entry.metadata?.actualWorkers === 1), "merged native project configurations changed");
  }
  if (collection) requireEvidence(config.shard === null, "full unsharded collection required");
  if (merged) requireEvidence(config.shard === null, "native combined report required");
  if (shard) requireEvidence(isDeepStrictEqual(config.shard, { current: shard, total: 2 }),
    "native report does not belong to the declared shard");
  requireEvidence(report.stats && ["expected", "skipped", "unexpected", "flaky"]
    .every((key) => Number.isInteger(report.stats[key]) && report.stats[key] >= 0)
    && Number.isFinite(report.stats.duration) && report.stats.duration >= 0, "invalid native report statistics");
  const cases = new Map();
  function visit(suites) {
    for (const suite of suites) {
      requireEvidence(suite && Array.isArray(suite.specs ?? []) && Array.isArray(suite.suites ?? []),
        "invalid native suite");
      for (const spec of suite.specs ?? []) {
        requireEvidence(typeof spec.id === "string" && spec.id.length > 0 && spec.id.length <= 256
          && !cases.has(spec.id) && Array.isArray(spec.tests) && spec.tests.length === 1,
        "native case missing, duplicated or repeated across projects");
        const test = spec.tests[0];
        requireEvidence(typeof spec.file === "string" && typeof spec.title === "string"
          && Number.isInteger(spec.line) && Number.isInteger(spec.column)
          && Number.isInteger(test.timeout) && test.timeout > 0
          && (merged ? test.projectId === undefined && test.projectName === project.name
            : test.projectId === project.id) && test.expectedStatus === "passed"
          && Array.isArray(test.results), "native case identity or expected status changed");
        const identity = {
          id: spec.id, file: spec.file, title: spec.title, line: spec.line, column: spec.column,
          timeout: test.timeout, project_id: project.id,
        };
        if (collection) {
          requireEvidence(test.results.length === 0, "collection is not a prior execution report");
          if (runtimeTimeouts) {
            requireEvidence(runtimeTimeouts.has(spec.id), "original runtime timeout missing");
            identity.timeout = runtimeTimeouts.get(spec.id);
          }
          cases.set(spec.id, { identity, result: null });
        } else {
          requireEvidence(spec.ok === true && test.status === "expected" && test.results.length === 1,
            "native case failed, skipped, retried or not executed");
          const result = test.results[0];
          requireEvidence(result.status === "passed" && result.retry === 0
            && Array.isArray(result.errors) && result.errors.length === 0 && !result.error
            && Number.isFinite(result.duration) && result.duration >= 0
            && typeof result.startTime === "string" && Number.isFinite(Date.parse(result.startTime)),
          "native attempt failed, skipped, interrupted, retried or incomplete");
          cases.set(spec.id, { identity, result: {
            status: result.status, retry: result.retry, duration: result.duration, startTime: result.startTime,
          } });
        }
      }
      visit(suite.suites ?? []);
    }
  }
  visit(report.suites);
  requireEvidence(cases.size > 0, "no native cases collected");
  requireEvidence(report.stats.expected === (collection ? 0 : cases.size)
    && report.stats.skipped === (collection ? cases.size : 0)
    && report.stats.unexpected === 0 && report.stats.flaky === 0, "native counts do not match actual case results");
  return cases;
}

export function frozenSettingsRuntimeTimeouts(collection) {
  const raw = fs.readFileSync(path.join(REPO, "scripts/ci/quality-scheduling-contract.json"), "utf8")
    .replaceAll("\r\n", "\n");
  requireEvidence(sha256(raw) === CONTRACT_SHA256, "frozen original execution contract changed");
  const contract = JSON.parse(raw);
  const cases = nativeCases(collection, { collection: true });
  const files = [...new Set([...cases.values()].map(({ identity }) => identity.file))];
  const sources = contract.settings_test_source_lf_sha256;
  sameIds(files, Object.keys(sources), "original Settings source selection changed");
  for (const file of files) {
    requireEvidence(/^(?:settings-[a-z0-9-]+|context-admin-bundles)\.spec\.ts$/.test(file),
      "unexpected Settings source path");
    const source = fs.readFileSync(path.join(REPO, "apps/web/e2e", file), "utf8").replaceAll("\r\n", "\n");
    requireEvidence(sha256(source) === sources[file], "original Settings test source changed");
  }
  // --list never enters test bodies. Bind each original body-level setTimeout
  // to its unchanged source location instead of comparing it with the default.
  const key = ({ file, line, column }) => JSON.stringify([file, line, column]);
  const overrides = new Map();
  for (const override of contract.settings_runtime_timeout_overrides) {
    const location = key(override);
    requireEvidence(!overrides.has(location) && sources[override.file]
      && Number.isInteger(override.timeout) && override.timeout > 0, "ambiguous original runtime timeout");
    overrides.set(location, override.timeout);
  }
  const used = new Set();
  const timeouts = new Map();
  for (const [id, { identity }] of cases) {
    const location = key(identity);
    if (overrides.has(location)) used.add(location);
    timeouts.set(id, overrides.get(location) ?? identity.timeout);
  }
  sameIds([...used], [...overrides.keys()], "original runtime timeout declaration missing from collection");
  return timeouts;
}

// This primitive is also exercised with small, genuinely executed native blob
// reports. The release entry point below separately fixes the original 470.
export function verifyNativeShardUnion(collection, shardReports, merged, runtimeTimeouts = null) {
  requireEvidence(Array.isArray(shardReports) && shardReports.length === 2, "exactly two Settings shards required");
  const expected = nativeCases(collection, { collection: true, runtimeTimeouts });
  if (runtimeTimeouts) sameIds([...runtimeTimeouts.keys()], [...expected.keys()], "runtime timeout case set changed");
  const shards = shardReports.map((report, index) => nativeCases(report, { shard: index + 1 }));
  const union = new Map();
  for (const shard of shards) {
    for (const [id, entry] of shard) {
      requireEvidence(!union.has(id), "duplicate Settings case across shards");
      requireEvidence(expected.has(id) && isDeepStrictEqual(entry.identity, expected.get(id).identity),
        "Settings shard case not in original full collection");
      union.set(id, entry);
    }
  }
  sameIds([...union.keys()], [...expected.keys()], "original Settings collection missing or replaced");
  const mergedCases = nativeCases(merged, { merged: true, referenceProject: collection.config.projects[0] });
  sameIds([...mergedCases.keys()], [...union.keys()], "native blob merge has missing or extra cases");
  for (const [id, entry] of mergedCases) {
    requireEvidence(isDeepStrictEqual(entry, union.get(id)), "native blob merge differs from original shard attempts");
  }
  return { cases: mergedCases, shardCounts: shards.map((shard) => shard.size) };
}

export function mergeSettingsReports(collection, shardReports, merged, sourceSha, runtimeTimeouts = null) {
  requireSha(sourceSha);
  const { cases, shardCounts } = verifyNativeShardUnion(collection, shardReports, merged, runtimeTimeouts);
  requireEvidence(cases.size === SETTINGS_CASE_COUNT, "complete original470 Settings cases required");
  const attempts = [...cases.values()].map((entry) => entry.result);
  const started = Math.min(...attempts.map((result) => Date.parse(result.startTime)));
  const completed = Math.max(...attempts.map((result) => Date.parse(result.startTime) + result.duration));
  const counts = attempts.reduce((value, result) => ({ ...value, [result.status]: value[result.status] + 1 }), zeroCounts());
  return {
    evidence: {
      schema_version: 2, gate_id: "settings-stages-1-4", status: "passed",
      started_at: new Date(started).toISOString(), completed_at: new Date(completed).toISOString(),
      duration_ms: Math.round(merged.stats.duration), test_count: cases.size, result_counts: counts,
    },
    coverage: {
      schema_version: 1, source_sha: sourceSha, original_case_count: SETTINGS_CASE_COUNT,
      native_collection_case_count: cases.size, unique_executed_case_count: cases.size,
      shard_counts: shardCounts, result_counts: counts,
      case_ids: [...cases.keys()].sort(), no_missing_duplicate_skipped_failed_or_retried_cases: true,
      native_blob_merge_matches_original_json_attempts: true,
      original_runtime_timeouts_source_bound: runtimeTimeouts !== null,
    },
  };
}

function filesUnder(root) {
  const absolute = path.resolve(root);
  requireEvidence(fs.existsSync(absolute) && !fs.lstatSync(absolute).isSymbolicLink()
    && fs.lstatSync(absolute).isDirectory(), "regular shard artifact directory required");
  const realRoot = fs.realpathSync(absolute);
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      const stat = fs.lstatSync(file);
      requireEvidence(!stat.isSymbolicLink(), "linked shard artifact rejected");
      const relative = path.relative(realRoot, fs.realpathSync(file));
      requireEvidence(relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
        "shard artifact escaped its root");
      if (stat.isDirectory()) visit(file);
      else {
        requireEvidence(stat.isFile(), "nonregular shard artifact rejected");
        files.push(file);
      }
    }
  }
  visit(absolute);
  return files;
}
function uniqueFile(files, suffix) {
  const matches = files.filter((file) => file.replaceAll("\\", "/").endsWith(suffix));
  requireEvidence(matches.length === 1, "required shard evidence missing or ambiguous");
  return matches[0];
}
function readJson(file) {
  requireEvidence(!fs.lstatSync(file).isSymbolicLink() && fs.statSync(file).isFile()
    && fs.statSync(file).size <= 64 * 1024 * 1024, "invalid or oversized native JSON evidence");
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { throw new EvidenceError("native JSON evidence unreadable"); }
}
function writeJson(file, value) {
  const absolute = path.resolve(file);
  for (let parent = path.dirname(absolute); ; parent = path.dirname(parent)) {
    if (fs.existsSync(parent)) requireEvidence(!fs.lstatSync(parent).isSymbolicLink(), "linked evidence output rejected");
    if (parent === path.dirname(parent)) break;
  }
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}
function settingsInputs(root) {
  return [1, 2].map((index) => {
    const files = filesUnder(path.join(root, `shard-${index}`));
    const reportFile = uniqueFile(files, "/settings-shard-report.json");
    const report = readJson(reportFile);
    const cases = nativeCases(report, { shard: index });
    const summary = readJson(uniqueFile(files, "/apps/web/test-results/settings-shard-gate-summary.json"));
    requireEvidence(summary.schema_version === 1 && summary.overall_status === "PASS"
      && isDeepStrictEqual(summary.counts, { PASS: 1, FAIL: 0, NOT_VERIFIED: 0, SKIPPED: 0 })
      && summary.gates?.length === 1, "Settings shard gate summary incomplete");
    const gate = summary.gates[0];
    requireEvidence(gate.gate_id === `settings-stages-1-4-shard-${index}`
      && gate.status === "PASS" && gate.evidence_status === "passed" && gate.test_count === cases.size
      && isDeepStrictEqual(gate.result_counts, passCounts(cases.size)), "Settings shard summary disagrees with native attempts");
    return { index, files, reportFile, report, summary };
  });
}

export function prepareSettingsBlobs(root, outputDir) {
  const inputs = settingsInputs(root);
  const blobs = inputs.map(({ index, files }) => {
    const matches = files.filter((file) => /\/settings-blob-report\/[^/]+\.zip$/.test(file.replaceAll("\\", "/")));
    requireEvidence(matches.length === 1 && path.basename(matches[0]).endsWith(`-${index}.zip`)
      && fs.statSync(matches[0]).size > 0, "one original native blob per declared shard required");
    return matches[0];
  });
  requireEvidence(new Set(blobs.map((file) => path.basename(file))).size === 2, "duplicate native blob filename");
  requireEvidence(!fs.existsSync(outputDir), "native blob output already exists; no overwrite allowed");
  // writeJson applies the same no-linked-ancestor check before creating output.
  writeJson(path.join(outputDir, "native-blob-inputs.json"), {
    schema_version: 1, blobs: blobs.map((file, index) => ({
      shard: index + 1, name: path.basename(file), sha256: sha256(fs.readFileSync(file)),
    })),
  });
  for (const file of blobs) {
    const target = path.join(outputDir, path.basename(file));
    fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL);
    requireEvidence(sha256(fs.readFileSync(file)) === sha256(fs.readFileSync(target)), "native blob copy bytes changed");
  }
}

function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === "merge-web") {
    requireEvidence(args.length === 3, "invalid Web merge invocation");
    const [root, output, sourceSha] = args;
    const summaries = [1, 2].map((index) => readJson(uniqueFile(
      filesUnder(path.join(root, `shard-${index}`)), "/apps/web/test-results/web-shard-gate-summary.json",
    )));
    writeJson(output, mergeWebSummaries(summaries, sourceSha));
  } else if (mode === "prepare-settings-blobs") {
    requireEvidence(args.length === 2, "invalid native blob preparation invocation");
    prepareSettingsBlobs(...args);
  } else if (mode === "merge-settings") {
    requireEvidence(args.length === 5, "invalid Settings merge invocation");
    const [root, collectionFile, mergedFile, output, sourceSha] = args;
    const inputs = settingsInputs(root);
    requireEvidence(inputs.every((input) => input.summary.source_sha === sourceSha), "wrong Settings shard source");
    const collection = readJson(collectionFile);
    const result = mergeSettingsReports(collection, inputs.map((input) => input.report),
      readJson(mergedFile), sourceSha, frozenSettingsRuntimeTimeouts(collection));
    result.coverage.native_report_sha256 = {
      collection: sha256(fs.readFileSync(collectionFile)), merged: sha256(fs.readFileSync(mergedFile)),
      shards: inputs.map((input) => sha256(fs.readFileSync(input.reportFile))),
    };
    writeJson(path.join(output, "settings-stages-1-4/gate-evidence.json"), result.evidence);
    writeJson(path.join(output, "settings-shard-coverage.json"), result.coverage);
  } else {
    throw new EvidenceError("unknown quality shard evidence invocation");
  }
  console.log("Original quality shard evidence independently combined; no image or product acceptance implied.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) {
    console.error(`Quality shard evidence rejected: ${error instanceof EvidenceError ? error.message : error?.name ?? "unknown error"}`);
    process.exitCode = 1;
  }
}
