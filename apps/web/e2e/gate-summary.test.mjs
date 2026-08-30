import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { summarizeGateEvidence } from "./gate-summary.mjs";

test("summarizes pass, fail, skipped and missing evidence without guessing", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-reader-gates-"));
  try {
    writeEvidence(rootDir, "passed", { status: "passed", test_count: 2, result_counts: counts({ passed: 2 }) });
    writeEvidence(rootDir, "failed", { status: "failed", test_count: 1, result_counts: counts({ failed: 1 }) });
    writeEvidence(rootDir, "skipped", { status: "passed", test_count: 3, result_counts: counts({ skipped: 3 }) });
    const summary = summarizeGateEvidence({
      rootDir,
      expectedGateIds: ["passed", "failed", "skipped", "missing"],
      sourceSha: "synthetic-sha",
      generatedAt: "2026-08-31T00:00:00.000Z",
    });
    assert.equal(summary.overall_status, "FAIL");
    assert.deepEqual(summary.counts, { PASS: 1, FAIL: 1, NOT_VERIFIED: 1, SKIPPED: 1 });
    assert.equal(summary.gates.find((gate) => gate.gate_id === "missing")?.reason, "evidence_missing");
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("incomplete and zero-test gates remain not verified", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-reader-gates-"));
  try {
    writeEvidence(rootDir, "running", { status: "running", test_count: 2 });
    writeEvidence(rootDir, "empty", { status: "passed", test_count: 0, result_counts: counts({}) });
    const summary = summarizeGateEvidence({ rootDir, expectedGateIds: ["running", "empty"] });
    assert.equal(summary.overall_status, "NOT_VERIFIED");
    assert.equal(summary.counts.NOT_VERIFIED, 2);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

function writeEvidence(rootDir, gateId, evidence) {
  const directory = path.join(rootDir, gateId);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "gate-evidence.json"), JSON.stringify({ schema_version: 2, gate_id: gateId, ...evidence }));
}

function counts(overrides) {
  return { passed: 0, failed: 0, timedOut: 0, skipped: 0, interrupted: 0, ...overrides };
}
