import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

export const BASE_SCHEDULE_SHA256 = "34cffe5e0c2057c9eb9ad6f616773996260e7e785b50162a4702dfbd6e761aee";
export const COVERAGE_SHA256 = "c32a293ecf329de54f3ca2cc991f70e94b84811980427590eb72575a7dcc6c71";
export const ORIGINAL_SHA256 = "af1523d28f658f4bd3d1b3a6ad2f018250b5b909db0f7b81f4e00eeeb212084c";
export const digest = (data) => crypto.createHash("sha256").update(data).digest("hex");
export const SCHEDULE_SHA256 = digest(`${BASE_SCHEDULE_SHA256}:${COVERAGE_SHA256}`);
const read = (file) => fs.readFileSync(new URL(file, import.meta.url), "utf8").replaceAll("\r\n", "\n");
export function loadSchedule() {
  const raw = read("./quality-schedule-v2.json");
  assert.equal(digest(raw), BASE_SCHEDULE_SHA256, "Reviewed schedule changed");
  assert.equal(digest(read("./quality-scheduling-contract.json")), ORIGINAL_SHA256);
  const plan = JSON.parse(raw);
  assert.equal(plan.schema_version, 2);
  assert.equal(plan.original_contract_sha256, ORIGINAL_SHA256);
  for (const [family, count] of [["api", 4], ["settings", 4], ["web", 3]]) {
    const section = plan[family];
    assert.equal(section.shards, count);
    const assignment = { ...section.pinned };
    const loads = Array(count).fill(0);
    for (const [name, index] of Object.entries(assignment)) loads[index - 1] += section.weights_ms[name];
    for (const name of Object.keys(section.weights_ms).filter((name) => !(name in assignment))
      .sort((a, b) => section.weights_ms[b] - section.weights_ms[a] || (a < b ? -1 : a > b ? 1 : 0))) {
      const index = loads.indexOf(Math.min(...loads));
      assignment[name] = index + 1;
      loads[index] += section.weights_ms[name];
    }
    assert.deepEqual(assignment, section.assignment);
    assert.deepEqual(loads, section.estimated_work_ms);
  }
  const coverage = read("./quality-coverage-extension.json");
  assert.equal(digest(coverage), COVERAGE_SHA256, "Reviewed coverage extension changed");
  return extendCoverage(plan, JSON.parse(coverage));
}
export function extendCoverage(plan, extension) {
  assert.equal(extension.schema_version, 1);
  assert.equal(extension.base_schedule_sha256, BASE_SCHEDULE_SHA256);
  assert.deepEqual(Object.keys(extension).sort(), ["api", "base_schedule_sha256", "reason", "schema_version"]);
  assert.ok(Object.keys(extension.api).length);
  const api = plan.api;
  api.added_file_counts = {};
  for (const [file, entry] of Object.entries(extension.api)) {
    assert.match(file, /^tests\/test_[a-z0-9_]+\.py$/);
    assert.ok(!(file in api.assignment), "Original assignment cannot be replaced");
    assert.deepEqual(Object.keys(entry).sort(), ["count", "shard", "source_lf_sha256"]);
    assert.ok(Number.isSafeInteger(entry.count) && entry.count > 0);
    assert.ok(Number.isInteger(entry.shard) && entry.shard >= 1 && entry.shard <= api.shards);
    assert.match(entry.source_lf_sha256, /^[0-9a-f]{64}$/);
    api.assignment[file] = entry.shard;
    api.source_lf_sha256[file] = entry.source_lf_sha256;
    api.added_file_counts[file] = entry.count;
    api.collected_count += entry.count;
    api.expected_passed += entry.count;
  }
  return plan;
}
export function validateSettingsSources() {
  const original = JSON.parse(read("./quality-scheduling-contract.json"));
  const plan = loadSchedule();
  assert.deepEqual(Object.keys(plan.settings.assignment).sort(), Object.keys(original.settings_test_source_lf_sha256).sort());
  for (const [file, sha] of Object.entries(original.settings_test_source_lf_sha256)) {
    assert.match(file, /^(?:settings-[a-z0-9-]+|context-admin-bundles)\.spec\.ts$/);
    assert.equal(digest(read(`../../apps/web/e2e/${file}`)), sha, `Original Settings source changed: ${file}`);
  }
  return plan;
}
