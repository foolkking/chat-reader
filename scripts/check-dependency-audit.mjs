import fs from "node:fs";

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

for (const item of policyDocument.exceptions ?? []) {
  const key = `${item.advisory_id}:${item.package}`;
  if (exceptions.has(key)) policyErrors.push(`Duplicate exception ${key}`);
  if (!allowedDispositions.has(item.disposition)) policyErrors.push(`Invalid disposition for ${key}`);
  if (!item.review_by || item.review_by < today) policyErrors.push(`Expired exception ${key} (${item.review_by ?? "missing"})`);
  for (const field of ["severity", "scope", "reason", "mitigation", "track"]) {
    if (!item[field]) policyErrors.push(`Missing ${field} for ${key}`);
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
