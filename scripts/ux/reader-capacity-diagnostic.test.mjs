// Static workflow/harness boundaries, not capacity or Linux acceptance.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const read = file => readFileSync(new URL("../../" + file, import.meta.url), "utf8");
const workflow = read(".github/workflows/reading-performance.yml");
const harness = read("apps/web/e2e/reader-capacity.spec.ts");

test("CPU diagnostics select an explicitly validated failed SHA and cannot be requested by the reusable release workflow", () => {
  assert.match(workflow, /workflow_dispatch:\s+inputs:\s+diagnostic_ref:/);
  assert.match(workflow, /workflow_call:\s*\n\s*\npermissions:/);
  assert.match(workflow, /\[\[ "\$READER_DIAGNOSTIC_REF" =~ \^\[0-9a-f\]\{40\}\$ \]\]/);
  assert.match(workflow, /git cat-file -e "\$READER_DIAGNOSTIC_REF\^\{commit\}"/);
  assert.match(workflow, /diagnostic_args=\(\)[\s\S]*if \[ -n "\$READER_DIAGNOSTIC_REF" \]; then[\s\S]*export E2E_READER_CAPACITY_PROFILE=1/);
  assert.match(workflow, /for phase in baseline candidate/);
  assert.match(workflow, /diagnostic_args=\(--grep 'plain 10000 messages:'\)/);
  assert.match(workflow, /diagnostic-only; not release acceptance/);
  assert.match(harness, /const diagnostic = process\.env\.E2E_READER_CAPACITY_PROFILE === "1"/);
  assert.match(harness, /const cdp = profilePath \? await page\.context\(\)\.newCDPSession\(page\) : null/);
});

test("all cold runs keep the frozen budgets and unfiltered failures while diagnostics add evidence only", () => {
  assert.match(harness, /const tiers: Tier\[\] = \[398, 1000, 10000\]/);
  assert.match(harness, /const profiles: Profile\[\] = \["plain", "math", "mixed"\]/);
  assert.match(harness, /for \(let run = 0; run < 3; run \+= 1\)/);
  for (const [name, maximum] of [["mountedMessagesMax", 40], ["mountedBlocksMax", 120], ["longestTask", 150], ["longTaskTotal", 250]]) {
    assert.match(harness, new RegExp(`expect\\(run\\.${name}[^;]*toBeLessThanOrEqual\\(${maximum}\\)`));
  }
  assert.match(harness, /expect\(run\.p95FrameInterval!\)\.toBeLessThanOrEqual\(34\)/);
  assert.match(harness, /expect\(run\.scrollMonotonic\)\.toBe\(true\)/);
  assert.doesNotMatch(harness, /if \(!diagnostic\)[\s\S]{0,60}expect|frames\.filter|longTasks\.filter/);
  assert.match(harness, /test\.use\(\{ trace: "off" \}\)/);
  assert.match(harness, /finally \{\s+if \(cdp && profilePath\)/);
});
