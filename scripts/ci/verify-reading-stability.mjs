import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] ?? "apps/web/test-results/reading-stability";
const gate = JSON.parse(readFileSync(join(root, "gate-evidence.json"), "utf8"));
assert.equal(gate.gate_id, "reading-stability");
assert.equal(gate.status, "passed");
assert.ok(gate.test_count >= 23);
assert.equal(gate.result_counts.passed, gate.test_count, "Every new gate case must actually run.");
for (const status of ["skipped", "failed", "timedOut", "interrupted"]) assert.equal(gate.result_counts[status], 0);
const files = readdirSync(root, { recursive: true }).filter(name => /(?:stopped|down|up|viewer)-frames\.json$/.test(name));
assert.equal(files.length, 16 * 4, "All four surfaces, two widths, normal/virtual, stationary, both scroll directions and Viewer round-trips need frame evidence.");
for (const phase of ["stopped", "down", "up", "viewer"])
  assert.equal(files.filter(file => file.endsWith(`${phase}-frames.json`)).length, 16);
for (const file of files) {
  const evidence = JSON.parse(readFileSync(join(root, file), "utf8"));
  assert.ok(evidence.frames.length > 10);
  assert.ok(evidence.frames.every(frame => [frame.top, frame.time, frame.scroll, frame.height].every(Number.isFinite)));
  assert.ok(Array.isArray(evidence.corrections));
  if (file.endsWith("stopped-frames.json") || file.endsWith("viewer-frames.json")) {
    const first = evidence.frames[0].top;
    assert.ok(Math.max(...evidence.frames.map(frame => Math.abs(frame.top - first))) <= 2);
    assert.ok(Math.abs(evidence.frames.at(-1).top - first) <= 1);
  }
}
console.info("reading-stability: all required cases and 64 complete frame traces verified");
