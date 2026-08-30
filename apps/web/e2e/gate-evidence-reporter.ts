import fs from "node:fs";
import path from "node:path";
import type { FullConfig, FullResult, Reporter, Suite } from "@playwright/test/reporter";

type GateEvidenceReporterOptions = {
  gateId: string;
  outputFile: string;
};

type GateEvidence = {
  schema_version: 1;
  gate_id: string;
  status: "running" | FullResult["status"];
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
  test_count: number;
};

export default class GateEvidenceReporter implements Reporter {
  private readonly options: GateEvidenceReporterOptions;
  private evidence: GateEvidence | null = null;

  constructor(options: GateEvidenceReporterOptions) {
    this.options = options;
  }

  onBegin(_config: FullConfig, suite: Suite): void {
    this.evidence = {
      schema_version: 1,
      gate_id: this.options.gateId,
      status: "running",
      started_at: new Date().toISOString(),
      test_count: suite.allTests().length,
    };
    this.writeEvidence();
  }

  onEnd(result: FullResult): void {
    if (!this.evidence) return;
    this.evidence = {
      ...this.evidence,
      status: result.status,
      completed_at: new Date().toISOString(),
      duration_ms: Math.round(result.duration),
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
