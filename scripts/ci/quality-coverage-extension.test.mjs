import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { BASE_SCHEDULE_SHA256, COVERAGE_SHA256, SCHEDULE_SHA256, digest, extendCoverage, loadSchedule, validateSettingsSources } from "./quality-schedule.mjs";
import { validateReviewedSettingsCases } from "./quality-shard-evidence.mjs";

const read = name => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
test("product coverage is additive; frozen scheduling and original skips remain identical", () => {
  const base = read("./quality-schedule-v2.json"), active = loadSchedule();
  assert.equal(SCHEDULE_SHA256, digest(`${BASE_SCHEDULE_SHA256}:${COVERAGE_SHA256}`));
  assert.deepEqual(active.settings, base.settings);
  assert.deepEqual(active.web, base.web);
  assert.deepEqual(active.api.allowed_skips, base.api.allowed_skips);
  assert.equal(active.api.collected_count, base.api.collected_count + 24);
  assert.equal(active.api.expected_passed, base.api.expected_passed + 24);
  for (const [file, shard] of Object.entries(base.api.assignment)) assert.equal(active.api.assignment[file], shard);
  for (const [file, expected] of Object.entries(active.api.source_lf_sha256)) {
    const source = readFileSync(new URL(`../../apps/api/${file}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
    assert.equal(digest(source), expected, file);
  }
});

test("coverage extensions reject unreviewed old files, shard bounds, counts, hashes and skip policy", () => {
  const base = read("./quality-schedule-v2.json"), original = read("./quality-coverage-extension.json");
  const file = Object.keys(original.api)[0];
  for (const mutate of [
    value => { value.base_schedule_sha256 = "0".repeat(64); },
    value => { value.allowed_skips = ["new skip"]; },
    value => { value.api[Object.keys(base.api.assignment)[0]] = value.api[file]; },
    value => { value.api[file].shard = 5; },
    value => { value.api[file].count = 0; },
    value => { value.api[file].count = 1.5; },
    value => { value.api[file].source_lf_sha256 = "unverified"; },
    value => { value.api[file].allowed_skips = ["new skip"]; },
    value => { value.api["tests/../escape.py"] = value.api[file]; },
    value => { Object.values(value.api_fixture_revisions)[0].previous_source_lf_sha256 = "0".repeat(64); },
    value => { Object.values(value.api_fixture_revisions)[0].source_lf_sha256 = "unverified"; },
    value => { Object.values(value.api_fixture_revisions)[0].nodeids = []; },
    value => { const nodes = Object.values(value.api_fixture_revisions)[0].nodeids; nodes.push(nodes[0]); },
    value => { Object.values(value.api_fixture_revisions)[0].nodeids = ["tests/test_foreign.py::test_other"]; },
    value => { Object.values(value.api_fixture_revisions)[0].shard = 2; },
    value => { Object.values(value.settings_fixture_revisions)[0].previous_source_lf_sha256 = "0".repeat(64); },
    value => { Object.values(value.settings_fixture_revisions)[0].source_lf_sha256 = "unknown"; },
    value => { Object.values(value.settings_fixture_revisions)[0].cases = []; },
    value => { Object.values(value.settings_fixture_revisions)[0].cases[0].timeout++; },
    value => { Object.values(value.settings_fixture_revisions)[0].cases[0].file = "foreign.spec.ts"; },
    value => { const cases = Object.values(value.settings_fixture_revisions)[0].cases; cases.push(cases[0]); },
    value => { Object.values(value.settings_fixture_revisions)[0].shard = 2; },
  ]) {
    const value = structuredClone(original);
    mutate(value);
    assert.throws(() => extendCoverage(structuredClone(base), value));
  }
});

test("reviewed Settings navigation adaptation preserves all original native cases and deadlines", () => {
  const schedule = validateSettingsSources();
  const revision = schedule.settings_fixture_revisions["settings-format-health.spec.ts"];
  assert.equal(revision.cases.length, 6);
  const cases = () => new Map(revision.cases.map(identity => [identity.id, { identity: structuredClone(identity) }]));
  validateReviewedSettingsCases(cases(), schedule);
  for (const mutate of [
    value => { value.delete(revision.cases[0].id); },
    value => { const first = value.values().next().value; value.set("extra", structuredClone(first)); },
    value => { value.values().next().value.identity.id = "substitute"; },
    value => { value.values().next().value.identity.title = "different test"; },
    value => { value.values().next().value.identity.line++; },
    value => { value.values().next().value.identity.timeout++; },
    value => { value.values().next().value.identity.project_id = "other"; },
  ]) {
    const value = cases(); mutate(value);
    assert.throws(() => validateReviewedSettingsCases(value, schedule));
  }
});
