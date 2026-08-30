import fs from "node:fs";
import path from "node:path";
import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestResult } from "@playwright/test/reporter";

type GateEvidenceReporterOptions = {
  gateId: string;
  outputFile: string;
};

type GateEvidence = {
  schema_version: 2;
  gate_id: string;
  status: "running" | FullResult["status"];
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
  test_count: number;
  result_counts?: Record<TestResult["status"], number>;
};

export default class GateEvidenceReporter implements Reporter {
  private readonly options: GateEvidenceReporterOptions;
  private evidence: GateEvidence | null = null;
  private readonly finalTestStatuses = new Map<string, TestResult["status"]>();

  constructor(options: GateEvidenceReporterOptions) {
    this.options = options;
  }

  onBegin(_config: FullConfig, suite: Suite): void {
    this.evidence = {
      schema_version: 2,
      gate_id: this.options.gateId,
      status: "running",
      started_at: new Date().toISOString(),
      test_count: suite.allTests().length,
    };
    this.writeEvidence();
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    this.finalTestStatuses.set(test.id, result.status);
  }

  onEnd(result: FullResult): void {
    if (!this.evidence) return;
    this.evidence = {
      ...this.evidence,
      status: result.status,
      completed_at: new Date().toISOString(),
      duration_ms: Math.round(result.duration),
      result_counts: Array.from(this.finalTestStatuses.values()).reduce<Record<TestResult["status"], number>>(
        (counts, status) => ({ ...counts, [status]: counts[status] + 1 }),
        { passed: 0, failed: 0, timedOut: 0, skipped: 0, interrupted: 0 },
      ),
    };
    this.writeEvidence();
  }

  private writeEvidence(): void {
    if (!this.evidence) return;
    const outputFile = path.resolve(process.cwd(), this.options.outputFile);
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    const temporaryFile = `${outputFile}.tmp`;
    fs.writeFileSync(temporaryFile, `${JSON.stringify(this.evidence, null, 2)}\n`, "utf8");
    fs.renameSync(temporaryFile, outputFile);
  }
}
