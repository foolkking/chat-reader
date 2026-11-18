// Run the real Playwright workflow/security source assertions before any build.
// This is deliberately not a browser gate and never replaces the full E2E run.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const web = join(root, "apps/web");
const requireWeb = createRequire(join(web, "package.json"));
const explicitTemp = process.env.RUNNER_TEMP || process.env.TEMP;
assert.ok(explicitTemp, "Use an explicit task temporary directory.");
const tempRoot = realpathSync(resolve(explicitTemp));
if (process.platform === "win32") {
  assert.match(tempRoot.toLowerCase().replaceAll("\\", "/"),
    /^(?:c:\/users\/86182\/desktop\/wkkk|e:\/chat-reader-temp)\/[^/]+/);
}
const output = mkdtempSync(join(tempRoot, "release-source-controls-"));
const scopeTests = spawnSync(process.execPath,
  ["--test", join(root, "scripts/security/verify-picomatch-scope.test.mjs")],
  { cwd: root, env: { ...process.env, TEMP: output, TMP: output }, stdio: "inherit" });
assert.ifError(scopeTests.error);
assert.equal(scopeTests.signal, null, "Dependency scope controls were interrupted.");
assert.equal(scopeTests.status, 0, "Dependency scope controls did not pass.");
const config = join(output, "playwright.config.cjs");
writeFileSync(config, `
const original = require(${JSON.stringify(join(web, "playwright.config.ts"))}).default;
module.exports = {
  ...original,
  testDir: ${JSON.stringify(join(web, "e2e"))},
  testMatch: "**/release-security-baseline.spec.ts",
  grep: /(?:^| )release (workflow cannot|quality gate rejects)/,
  webServer: undefined,
  outputDir: ${JSON.stringify(join(output, "results"))},
  reporter: [["list"], ["json", { outputFile: ${JSON.stringify(join(output, "native-report.json"))} }]],
};
`);
const result = spawnSync(process.execPath,
  [requireWeb.resolve("@playwright/test/cli"), "test", `--config=${config}`],
  { cwd: web, env: { ...process.env, TEMP: output, TMP: output }, stdio: "inherit" });
assert.ifError(result.error);
assert.equal(result.signal, null, "Source controls were interrupted.");
assert.ok(Number.isInteger(result.status), "Source controls did not complete.");
console.log(`Native source-only report: ${join(output, "native-report.json")}; full browser gates remain required.`);
process.exitCode = result.status;
