import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] ?? "apps/web/test-results/reading-stability";
const gate = JSON.parse(readFileSync(join(root, "gate-evidence.json"), "utf8"));
assert.equal(gate.gate_id, "reading-stability");
assert.equal(gate.status, "passed");
assert.ok(gate.test_count >= 35, "Existing stability, seven natural-flow cases and all fold/public-output audit regressions must run.");
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
  assert.ok(Array.isArray(evidence.events));
  if (file.endsWith("viewer-frames.json")) {
    assert.ok(evidence.events.some(event => event.type === "pointerdown" && event.targetsAnchor), "Viewer needs a real hit-tested trigger action.");
    assert.ok(evidence.frames.some(frame => frame.viewerLocked && frame.viewerVisible));
    assert.equal(evidence.frames.at(-1).viewerLocked, false, "Viewer must relinquish reading ownership.");
  }
  if (file.endsWith("stopped-frames.json") || file.endsWith("viewer-frames.json")) {
    const first = evidence.frames[0].top;
    assert.ok(Math.max(...evidence.frames.map(frame => Math.abs(frame.top - first))) <= 2);
    assert.ok(Math.abs(evidence.frames.at(-1).top - first) <= 1);
  }
}
const foldFiles = readdirSync(root, { recursive: true }).filter(name => /fold-(?:preserved|hidden|cancelled)-frames\.json$/.test(name));
assert.equal(foldFiles.length, 12, "Each of four surfaces needs all three collapse branches in addition to the original 64 traces.");
for (const phase of ["preserved", "hidden", "cancelled"])
  assert.equal(foldFiles.filter(file => file.endsWith(`fold-${phase}-frames.json`)).length, 4);
for (const file of foldFiles) {
  const evidence = JSON.parse(readFileSync(join(root, file), "utf8")), frames = evidence.frames;
  assert.ok(frames.length > 10);
  assert.ok(frames.every(frame => [frame.top, frame.time, frame.scroll, frame.height].every(Number.isFinite)));
  for (const frame of frames) assert.deepEqual(frame.otherScroll, frames[0].otherScroll, "Other Compare scroller must remain stationary.");
  if (file.endsWith("preserved-frames.json")) {
    assert.ok(evidence.events.some(event => event.type === "keydown"));
    assert.ok(Math.max(...frames.map(frame => Math.abs(frame.top - frames[0].top))) <= 2);
    assert.ok(Math.abs(frames.at(-1).top - frames[0].top) <= 1);
  } else if (file.endsWith("hidden-frames.json")) {
    assert.ok(evidence.events.some(event => event.type === "pointerdown" && event.targetsAnchor));
    const aligned = frames.findIndex(frame => Math.abs(frame.top - 120) <= 1);
    assert.ok(aligned >= 0);
    assert.ok(frames.slice(aligned).every(frame => Math.abs(frame.top - 120) <= 2));
    assert.ok(Math.abs(frames.at(-1).top - 120) <= 1);
  } else {
    assert.equal(evidence.preDefaultWheel, true, "Movement needs a pre-default wheel baseline, not post-compositor delivery.");
    const wheel = evidence.events.find(event => event.type === "wheel");
    assert.ok(wheel);
    assert.equal(wheel.cancelable, true);
    assert.equal(wheel.trusted, true, "The probe must observe a real wheel, not dispatchEvent.");
    const after = frames.filter(frame => frame.time >= wheel.time);
    assert.ok(after.length > 10);
    for (let i = 1; i < after.length; i++) assert.ok(after[i].top - after[i - 1].top <= 2);
    assert.ok(after.at(-1).top < wheel.top - 20);
  }
}
const passiveFiles = readdirSync(root, { recursive: true }).filter(name => name.endsWith("fold-passive-frames.json"));
assert.equal(passiveFiles.length, 4, "Pre-default measurement must not replace the normal passive delivery path.");
for (const file of passiveFiles) {
  const evidence = JSON.parse(readFileSync(join(root, file), "utf8"));
  assert.equal(evidence.preDefaultWheel, false);
  const wheel = evidence.events.find(event => event.type === "wheel");
  assert.equal(wheel?.trusted, true);
  const frames = evidence.frames.filter(frame => frame.time >= wheel.time);
  assert.ok(frames.length > 10);
  assert.ok(frames.every(frame => [frame.top, frame.time, frame.scroll, frame.height].every(Number.isFinite)));
  for (const frame of frames) assert.ok(frame.top - wheel.top <= 2);
  for (let i = 1; i < frames.length; i++) assert.ok(frames[i].top - frames[i - 1].top <= 2);
  assert.ok(frames.at(-1).top - wheel.top <= 1);
  for (const frame of evidence.frames) assert.deepEqual(frame.otherScroll, evidence.frames[0].otherScroll);
}
const coldShell = readdirSync(root, { recursive: true }).filter(name => name.endsWith("viewer-cold-shell.json"));
assert.equal(coldShell.length, 1);
const shellFrames = JSON.parse(readFileSync(join(root, coldShell[0]), "utf8")).frames;
assert.ok(shellFrames.length > 30);
for (const frame of shellFrames) for (let axis = 0; axis < 4; axis++) {
  assert.ok(Number.isFinite(frame[axis]));
  assert.ok(Math.abs(frame[axis] - shellFrames[0][axis]) <= 1);
}
console.info("reading-stability: required cases, original 64 traces, 12 collapse plus 4 passive traces and cold Viewer shell verified");
