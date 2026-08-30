import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export function summarizeGateEvidence({ rootDir, expectedGateIds, sourceSha = null, generatedAt = new Date().toISOString() }) {
  const gates = expectedGateIds.map((gateId) => {
    const evidenceFile = path.join(rootDir, gateId, "gate-evidence.json");
    if (!fs.existsSync(evidenceFile)) {
      return { gate_id: gateId, status: "NOT_VERIFIED", reason: "evidence_missing" };
    }
    let evidence;
    try {
      evidence = JSON.parse(fs.readFileSync(evidenceFile, "utf8"));
    } catch {
      return { gate_id: gateId, status: "NOT_VERIFIED", reason: "evidence_unreadable" };
    }
    if (evidence.gate_id !== gateId) {
      return { gate_id: gateId, status: "NOT_VERIFIED", reason: "gate_id_mismatch" };
    }
    const resultCounts = evidence.result_counts ?? null;
    const testCount = Number.isInteger(evidence.test_count) ? evidence.test_count : 0;
    let status;
    let reason;
    if (["failed", "timedout", "timedOut", "interrupted"].includes(evidence.status)) {
      status = "FAIL";
    } else if (evidence.status !== "passed") {
      status = "NOT_VERIFIED";
      reason = evidence.status === "running" ? "gate_incomplete" : "unknown_status";
    } else if (testCount === 0) {
      status = "NOT_VERIFIED";
      reason = "no_tests_collected";
    } else if (resultCounts && resultCounts.skipped === testCount) {
      status = "SKIPPED";
    } else {
      status = "PASS";
    }
    return {
      gate_id: gateId,
      status,
      ...(reason ? { reason } : {}),
      evidence_status: evidence.status,
      test_count: testCount,
      ...(resultCounts ? { result_counts: resultCounts } : {}),
      ...(Number.isFinite(evidence.duration_ms) ? { duration_ms: evidence.duration_ms } : {}),
    };
  });
  const counts = gates.reduce(
    (summary, gate) => ({ ...summary, [gate.status]: summary[gate.status] + 1 }),
    { PASS: 0, FAIL: 0, NOT_VERIFIED: 0, SKIPPED: 0 },
  );
  const overallStatus = counts.FAIL > 0 ? "FAIL" : counts.NOT_VERIFIED > 0 ? "NOT_VERIFIED" : counts.PASS > 0 ? "PASS" : "SKIPPED";
  return {
    schema_version: 1,
    source_sha: sourceSha,
    generated_at: generatedAt,
    overall_status: overallStatus,
    counts,
    gates,
  };
}

function main() {
  const rootDir = path.resolve(process.argv[2] ?? "apps/web/test-results");
  const outputFile = path.resolve(process.argv[3] ?? path.join(rootDir, "release-gate-summary.json"));
  const expectedGateIds = (process.env.PLAYWRIGHT_EXPECTED_GATES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!expectedGateIds.length) throw new Error("PLAYWRIGHT_EXPECTED_GATES must list at least one gate.");
  const summary = summarizeGateEvidence({ rootDir, expectedGateIds, sourceSha: process.env.GITHUB_SHA ?? null });
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  const temporaryFile = `${outputFile}.tmp`;
  fs.writeFileSync(temporaryFile, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryFile, outputFile);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
