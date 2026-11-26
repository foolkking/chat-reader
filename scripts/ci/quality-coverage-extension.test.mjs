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
  assert.equal(active.api.collected_count, base.api.collected_count + 487);
  assert.equal(active.api.expected_passed, base.api.expected_passed + 487);
  for (const [file, count] of Object.entries({
    "test_extension_diagnostics.py": 34, "test_append_selection_ranges.py": 24,
    "test_selective_append_postgres.py": 8, "test_append_ranges_postgres.py": 6,
    "test_append_recovery.py": 7,
  })) assert.equal(active.api.added_file_counts[`tests/${file}`], count);
  assert.equal(active.api.added_file_counts["tests/test_project_export_scope.py"], 6);
  assert.equal(active.api.added_file_counts["tests/test_selective_append.py"], 6);
  assert.equal(active.api.added_file_counts["tests/test_reader_extension.py"], 17);
  assert.equal(active.api.added_file_counts["tests/test_extension_release_postgres.py"], 18);
  assert.equal(active.api.added_file_counts["tests/test_extension_retry.py"], 18);
  assert.equal(active.api.added_file_counts["tests/test_extension_transfer.py"], 4);
  assert.equal(active.api.added_file_counts["tests/test_extension_transfer_postgres.py"], 2);
  assert.equal(active.api.added_file_counts["tests/test_memory_probe_windows.py"], 5);
  assert.equal(active.api.added_file_counts["tests/test_reader_index_metadata.py"], 19);
  assert.equal(active.api.added_file_counts["tests/test_reader_long_message_storage.py"], 83);
  assert.equal(active.api.added_file_counts["tests/test_import_message_units.py"], 39);
  assert.equal(active.api.added_file_counts["tests/test_program_update_confirmation.py"], 1);
  assert.equal(active.api.added_file_counts["tests/test_admin_updates.py"], 9);
  assert.equal(active.api.added_file_counts["tests/test_reader_find.py"], 6);
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
  const format = schedule.settings_fixture_revisions["settings-format-health.spec.ts"];
  const help = schedule.settings_fixture_revisions["settings-help-runtime.spec.ts"];
  const presentation = schedule.settings_fixture_revisions["settings-presentation.spec.ts"];
  assert.equal(format.cases.length, 6);
  assert.equal(help.cases.length, 6);
  assert.equal(help.cases.filter(item => item.timeout === 180_000).length, 4);
  assert.equal(presentation.cases.filter(item => item.timeout === 180_000).length, 6);
  const bulk = schedule.settings_fixture_revisions["settings-batch-export.spec.ts"];
  assert.equal(bulk.cases.length, 7);
  const signout = schedule.settings_fixture_revisions["settings-pending-signout.spec.ts"];
  assert.deepEqual(signout.cases.map(item => item.title).sort(), [
    "pending signout: discard failure", "pending signout: export", "pending signout: password", "pending signout: sync",
  ]);
  assert.ok(signout.cases.every(item => item.timeout === 140_000));
  const cases = () => new Map([...format.cases, ...help.cases, ...presentation.cases, ...bulk.cases, ...signout.cases].map(identity => [identity.id, { identity: structuredClone(identity) }]));
  validateReviewedSettingsCases(cases(), schedule);
  for (const mutate of [
    value => { value.delete(format.cases[0].id); },
    value => { value.delete(presentation.cases[0].id); },
    value => { value.delete(signout.cases.find(item => item.title === "pending signout: export").id); },
    value => { value.get(help.cases.find(item => item.timeout === 180_000).id).identity.timeout = 90_000; },
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
