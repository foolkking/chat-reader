// Static workflow/harness boundaries, not capacity or Linux acceptance.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
const read = file => readFileSync(new URL("../../" + file, import.meta.url), "utf8");
const workflow = read(".github/workflows/reading-performance.yml");
const harness = read("apps/web/e2e/reader-capacity.spec.ts");
const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));

test("CPU diagnostics select an explicitly validated failed SHA and cannot be requested by the reusable release workflow", () => {
  assert.match(workflow, /workflow_dispatch:\s+inputs:\s+diagnostic_ref:/);
  assert.match(workflow, /workflow_call:\s*\n\s*\npermissions:/);
  assert.match(workflow, /\[\[ "\$READER_DIAGNOSTIC_REF" =~ \^\[0-9a-f\]\{40\}\$ \]\]/);
  assert.match(workflow, /git cat-file -e "\$READER_DIAGNOSTIC_REF\^\{commit\}"/);
  assert.match(workflow, /diagnostic_args=\(\)[\s\S]*if \[ -n "\$READER_DIAGNOSTIC_REF" \]; then[\s\S]*export E2E_READER_CAPACITY_PROFILE=1/);
  assert.match(workflow, /for phase in baseline candidate/);
  assert.doesNotMatch(workflow, /diagnostic_args=\(--grep/);
  assert.match(workflow, /Total: 9 tests in 1 file/);
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

// Execute the actual warm measurement function, not a second implementation
// of its counter arithmetic. This is not a browser performance claim.
async function warmCounters(before, after) {
  const ts = require("typescript");
  const ast = ts.createSourceFile("reader-capacity.spec.ts", harness, ts.ScriptTarget.ES2022, true);
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "measureWarmRevisit");
  assert.ok(fn);
  const compiled = ts.transpileModule(`export ${fn.getText(ast)}`, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText;
  const exported = {}, phases = [], probes = [structuredClone(before), structuredClone(after)];
  const root = { evaluate: async () => { phases.push("scroll"); } };
  const page = {
    locator: selector => { assert.equal(selector, "[data-reader-scroll-root='true']"); return root; },
    waitForTimeout: async ms => { assert.equal(ms, 300); phases.push("settle"); },
    evaluate: async () => { phases.push("probe"); return probes.shift(); },
  };
  new Function("exports", "waitForReaderEdgeIdle", "runWheelTelemetry", compiled)(
    exported,
    async target => { assert.equal(target, root); phases.push("edge"); },
    async (target, element, steps) => {
      assert.equal(target, page); assert.equal(element, root); assert.equal(steps, 12);
      phases.push("measure"); return { scrollMonotonic: true, longestTask: 170 };
    },
  );
  const result = await exported.measureWarmRevisit(page, "synthetic-counter-fixture");
  assert.deepEqual(phases, ["scroll", "settle", "edge", "scroll", "settle", "edge", "probe", "measure", "probe"]);
  assert.equal(result.longestTask, 170, "Counter reporting must not filter or modify measured performance.");
  return result;
}

test("warm parser evidence counts the actual pipeline separately from component renders", async () => {
  const result = await warmCounters({ markdownParseTotal: 3, markdownRenderTotal: 20 },
    { markdownParseTotal: 5, markdownRenderTotal: 80 });
  assert.equal(result.parseDelta, 2);
  assert.equal(result.renderDelta, 60);
});

test("historical baseline without a real parse probe is unmeasured, not zero or render count", async () => {
  const result = await warmCounters({ markdownRenderTotal: 10 }, { markdownRenderTotal: 30 });
  assert.equal(result.parseDelta, null);
  assert.equal(result.renderDelta, 20);
});
