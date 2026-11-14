// Static workflow/harness boundaries, not capacity or Linux acceptance.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
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

// Execute the real browser collector with deterministic geometry/clock inputs.
// These controls are not a replacement for the mounted actual-Reader regression.
async function coordinateFixture(kind, backwardPx = 120) {
  const ts = require("typescript");
  const ast = ts.createSourceFile("reader-capacity.spec.ts", harness, ts.ScriptTarget.ES2022, true);
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "runWheelTelemetry");
  assert.ok(fn);
  const compiled = ts.transpileModule(`export ${fn.getText(ast)}`, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText;
  let now = 100, step = 0, nextFrameId = 1;
  const scheduled = new Map();
  const root = {
    scrollTop: 0, scrollHeight: 20_000, isConnected: true,
    // Compensation flags must never excuse a real backwards movement.
    dataset: { readerEdgeStage: "next:settled", readerLayoutCompensating: "true", readerSurfaceCompensating: "true" },
    getBoundingClientRect: () => ({ top: 40, bottom: 640, height: 600, width: 1280 }),
    contains: node => node.isConnected,
    hover: async () => {},
    evaluate: async (fn, arg) => fn(root, arg),
  };
  let documentTop = 100;
  let article = {
    id: "message-synthetic", dataset: { messageId: "synthetic", messageVersionId: "version-1" }, isConnected: true,
    getBoundingClientRect: () => ({ top: 40 + documentTop - root.scrollTop, bottom: 40 + documentTop - root.scrollTop + 5000, height: 5000 }),
    closest: () => article,
  };
  const makeBlock = (owner = article) => ({
    id: "block-synthetic-0", dataset: { blockId: "real-block", blockIndex: "0" }, isConnected: true,
    getBoundingClientRect: owner.getBoundingClientRect, closest: () => owner,
  });
  let block = makeBlock();
  root.querySelectorAll = selector => {
    if (kind === "no-visible-anchor") return [];
    if (selector === "article[data-message-id]") return [article];
    if (selector === "[data-block-index]") return [block];
    return [article, block];
  };
  const window = { innerWidth: 1280 };
  const longTasks = [{ startTime: 101, duration: 213 }, { startTime: 102, duration: 60 }];
  let observer;
  class Observer {
    static supportedEntryTypes = ["longtask"];
    constructor(callback) { this.callback = callback; observer = this; }
    observe() {}
    takeRecords() { return []; }
    disconnect() {}
  }
  const context = {
    exports: {}, window, innerWidth: 1280,
    document: { documentElement: { scrollWidth: 1280 }, getElementsByTagName: () => [root, article, block] },
    performance: { now: () => now }, PerformanceObserver: Observer,
    requestAnimationFrame: callback => { const id = nextFrameId++; scheduled.set(id, callback); return id; },
    cancelAnimationFrame: id => scheduled.delete(id),
  };
  const tick = (elapsed = 16.7) => {
    now += elapsed;
    const callbacks = [...scheduled.values()]; scheduled.clear();
    for (const callback of callbacks) callback(now);
  };
  const page = {
    evaluate: async (fn, arg) => fn(arg),
    mouse: { wheel: async (x, y) => {
      assert.equal(x, 0); assert.equal(y, 120);
      root.scrollTop += y;
      tick();
    } },
    waitForTimeout: async ms => {
      assert.equal(ms, 34, "The original wheel sampling delay is frozen.");
      if (step === 3) {
        if (kind === "coordinate-rebase") {
          root.scrollTop -= 400; documentTop -= 400;
        } else if (kind === "physical-reverse") {
          root.scrollTop -= 120 + backwardPx;
        } else if (kind === "between-sample-jump") {
          root.scrollTop -= backwardPx;
          tick();
          root.scrollTop += backwardPx;
        } else if (kind === "same-id-replacement") {
          article.isConnected = false; block.isConnected = false;
          article = { ...article, isConnected: true };
          article.closest = () => article;
          block = makeBlock();
        } else if (kind === "changed-version") {
          article.dataset.messageVersionId = "version-2";
        }
      }
      tick(kind === "unfiltered-freeze" && step === 2 ? 1200 : 16.7);
      if (step === 0) observer.callback({ getEntries: () => longTasks });
      step++;
    },
  };
  runInNewContext(compiled, context);
  return context.exports.runWheelTelemetry(page, root, 6);
}

test("coordinate reclamation keeps raw reversals but measures the same real DOM reading anchor", async () => {
  const result = await coordinateFixture("coordinate-rebase");
  assert.equal(result.scrollMonotonic, true);
  assert.equal(result.rawScrollMonotonic, false);
  assert.equal(result.scrollEvidenceComplete, true);
  assert.equal(result.scrollReversals.length, 1, "Original raw reversal evidence must not be dropped.");
  assert.equal(result.physicalScrollReversals.length, 0);
  assert.equal(result.scrollSamples.length, 6);
  assert.equal(result.scrollWheelSamples.length, 6);
});

test("physical reverse movement still fails even with settled/compensating flags", async () => {
  const result = await coordinateFixture("physical-reverse");
  assert.equal(result.scrollMonotonic, false);
  assert.equal(result.scrollEvidenceComplete, true);
  assert.ok(result.physicalScrollReversals.some(sample => sample.forwardPx <= -120));
});

test("a backwards jump undone before the next wheel sample still fails on the unfiltered frame trace", async () => {
  const result = await coordinateFixture("between-sample-jump");
  assert.equal(result.scrollMonotonic, false);
  assert.equal(result.rawScrollMonotonic, true, "The old wheel-only comparison misses this real movement.");
  assert.ok(result.scrollFrames.some(sample => sample.forwardPx < -2));
});

for (const kind of ["no-visible-anchor", "same-id-replacement", "changed-version"]) {
  test(`${kind} is unknown/failure, never invented zero movement or a pass`, async () => {
    const result = await coordinateFixture(kind);
    assert.equal(result.scrollMonotonic, false);
    assert.equal(result.scrollEvidenceComplete, false);
    assert.ok(result.scrollUnknowns.length > 0);
  });
}

for (const [backwardPx, pass] of [[2, true], [2.001, false]]) {
  test(`the physical reverse tolerance remains exactly 2px (${backwardPx}px)`, async () => {
    const result = await coordinateFixture("between-sample-jump", backwardPx);
    assert.equal(result.scrollMonotonic, pass);
  });
}

test("every original frame and long task is retained, including a 1200ms freeze and 213ms failure", async () => {
  const result = await coordinateFixture("unfiltered-freeze");
  assert.deepEqual(Array.from(result.longTasks), [213, 60]);
  assert.equal(result.longestTask, 213);
  assert.equal(result.longTaskTotal, 273);
  assert.ok(result.frameIntervals.includes(1200));
  assert.equal(result.frameCount, result.frameIntervals.length);
  assert.equal(result.p95FrameInterval, 1200);
  assert.equal(result.scrollFrames.length, 12);
});
