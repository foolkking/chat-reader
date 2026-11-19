import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../check-dependency-audit.mjs", import.meta.url));
const clean = () => ({ advisories: {}, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 } } });
function run(audit) {
  const dir = mkdtempSync(join(os.tmpdir(), "dependency-audit-control-"));
  const [input, policy, results] = ["input", "policy", "results"].map(name => join(dir, `${name}.json`));
  writeFileSync(input, JSON.stringify(audit));
  writeFileSync(policy, JSON.stringify({ policy: { blocked_severities: ["high", "critical"] }, exceptions: [] }));
  const child = spawnSync(process.execPath, [cli, input, policy, results], { encoding: "utf8" });
  assert.ifError(child.error);
  return { status: child.status, counts: JSON.parse(readFileSync(results, "utf8")).counts };
}
test("an empty allowance accepts an explicit clean audit, never a transport error or absent inventory", () => {
  assert.equal(run(clean()).status, 0);
  for (const bad of [{}, { error: { code: "NETWORK" } }, { ...clean(), error: true }, { ...clean(), advisories: [] },
    { ...clean(), metadata: {} }, { ...clean(), metadata: { vulnerabilities: { ...clean().metadata.vulnerabilities, high: 1 } } }]) {
    const outcome = run(bad); assert.equal(outcome.status, 1); assert.ok(outcome.counts.policy_errors > 0);
  }
});
test("a new high advisory cannot pass without an exception; affected versions may exceed advisory count", () => {
  const envelope = clean();
  envelope.advisories.one = { module_name: "fixture", github_advisory_id: "GHSA-synthetic", severity: "high" };
  envelope.metadata.vulnerabilities.high = 2;
  const blocked = run(envelope); assert.equal(blocked.status, 1); assert.equal(blocked.counts.unapproved, 1);
  envelope.advisories.one.severity = "low"; envelope.metadata.vulnerabilities.high = 0; envelope.metadata.vulnerabilities.low = 2;
  assert.equal(run(envelope).status, 0);
});
