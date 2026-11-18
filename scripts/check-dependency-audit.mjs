import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { collectNextPatternEvidence, collectRuntimeSources, verifyPicomatchScope } from "./security/verify-picomatch-scope.mjs";

const [auditPath, exceptionsPath, reportPath] = process.argv.slice(2);
if (!auditPath || !exceptionsPath || !reportPath) {
  console.error("Usage: node scripts/check-dependency-audit.mjs <audit.json> <exceptions.json> <report.json>");
  process.exit(2);
}

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
const audit = readJson(auditPath);
const policyDocument = readJson(exceptionsPath);
const blockedSeverities = new Set(policyDocument.policy?.blocked_severities ?? ["critical", "high"]);
const allowedDispositions = new Set([
  "FIXED",
  "NOT_APPLICABLE",
  "MITIGATED_PENDING_MIGRATION",
  "EXPLICIT_TEMPORARY_EXCEPTION",
]);
const today = new Date().toISOString().slice(0, 10);
const exceptions = new Map();
const policyErrors = [];
let picomatchScopeVerification = null;

const picomatchAdvisories = Object.values(audit.advisories ?? {}).filter(
  (item) => item.module_name === "picomatch" && item.github_advisory_id === "GHSA-fc5q-39xc-vjpf",
);
if (picomatchAdvisories.length) {
  const pnpmArgs = ["--filter", "web", "list", "--prod", "--depth", "Infinity", "--json"];
  const result = spawnSync(
    process.platform === "win32" ? "corepack.cmd" : "pnpm",
    process.platform === "win32" ? ["pnpm", ...pnpmArgs] : pnpmArgs,
    {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      shell: process.platform === "win32",
      timeout: 60_000,
    },
  );
  if (result.error || result.status !== 0) {
    policyErrors.push(`Could not verify the production dependency tree for picomatch: ${result.error?.message ?? result.stderr ?? `exit ${result.status}`}`);
  } else {
    try {
      picomatchScopeVerification = verifyPicomatchScope({
        audit,
        productionTree: JSON.parse(result.stdout.replace(/^\uFEFF/, "")),
        webPackage: readJson(path.resolve("apps/web/package.json")),
        exceptions: policyDocument,
        runtimeSources: collectRuntimeSources(path.resolve()),
        nextPatternEvidence: collectNextPatternEvidence(path.resolve()),
      });
    } catch (error) {
      policyErrors.push(`picomatch scope verification failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

for (const item of policyDocument.exceptions ?? []) {
  const key = `${item.advisory_id}:${item.package}`;
  if (exceptions.has(key)) policyErrors.push(`Duplicate exception ${key}`);
  if (!allowedDispositions.has(item.disposition)) policyErrors.push(`Invalid disposition for ${key}`);
  if (!item.review_by || item.review_by < today) policyErrors.push(`Expired exception ${key} (${item.review_by ?? "missing"})`);
  for (const field of ["severity", "scope", "reason", "mitigation", "track"]) {
    if (!item[field]) policyErrors.push(`Missing ${field} for ${key}`);
  }
  if (item.disposition === "NOT_APPLICABLE") {
    const evidencePath = typeof item.evidence === "string"
      ? path.resolve(process.cwd(), item.evidence)
      : "";
    const repoRoot = path.resolve(process.cwd());
    if (!evidencePath || !evidencePath.startsWith(`${repoRoot}${path.sep}`) || !fs.existsSync(evidencePath)) {
      policyErrors.push(`NOT_APPLICABLE exception ${key} requires an in-repository automated evidence file`);
    }
  }
  exceptions.set(key, item);
}

const advisories = Object.values(audit.advisories ?? {});
const blocked = advisories.filter((item) => blockedSeverities.has(item.severity));
const blockedKeys = new Set(blocked.map((item) => `${item.github_advisory_id}:${item.module_name}`));
const unapproved = [];
const approved = [];

for (const key of exceptions.keys()) {
  if (!blockedKeys.has(key)) policyErrors.push(`Unused exception ${key}`);
}

for (const advisory of blocked) {
  const key = `${advisory.github_advisory_id}:${advisory.module_name}`;
  const exception = exceptions.get(key);
  if (!exception || exception.severity !== advisory.severity) {
    unapproved.push({
      advisory_id: advisory.github_advisory_id,
      package: advisory.module_name,
      severity: advisory.severity,
      title: advisory.title,
    });
    continue;
  }
  approved.push({
    advisory_id: advisory.github_advisory_id,
    package: advisory.module_name,
    severity: advisory.severity,
    disposition: exception.disposition,
    scope: exception.scope,
    track: exception.track,
    review_by: exception.review_by,
    evidence: exception.evidence ?? null,
  });
}

const report = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  audit_source: policyDocument.policy?.audit_source,
  metadata: audit.metadata ?? null,
  counts: {
    advisories: advisories.length,
    blocked: blocked.length,
    approved_exceptions: approved.length,
    unapproved: unapproved.length,
    policy_errors: policyErrors.length,
  },
  approved_exceptions: approved,
  picomatch_scope_verification: picomatchScopeVerification,
  unapproved,
  policy_errors: policyErrors,
  lower_severity_advisories: advisories
    .filter((item) => !blockedSeverities.has(item.severity))
    .map((item) => ({
      advisory_id: item.github_advisory_id,
      package: item.module_name,
      severity: item.severity,
      title: item.title,
    })),
};

fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report.counts));

if (policyErrors.length || unapproved.length) {
  for (const error of policyErrors) console.error(`POLICY ERROR: ${error}`);
  for (const item of unapproved) console.error(`UNAPPROVED: ${item.advisory_id} ${item.package} ${item.severity}`);
  process.exit(1);
}
