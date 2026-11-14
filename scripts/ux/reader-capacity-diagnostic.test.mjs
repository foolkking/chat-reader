// Static workflow/harness boundaries, not capacity or Linux acceptance.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
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
  const window = { innerWidth: 1280, location: { href: "http://reader.synthetic/", origin: "http://reader.synthetic" } };
  const longTasks = [{ startTime: 101, duration: 213 }, { startTime: 102, duration: 60 }];
  const nativeFrame = {
    startTime: 103, duration: 151, blockingDuration: 101, renderStart: 110, styleAndLayoutStart: 120,
    scripts: [
      { startTime: 104, duration: 140, executionStart: 105, forcedStyleAndLayoutDuration: 90, pauseDuration: 0,
        invokerType: "event-listener", invoker: "private synthetic event", sourceCharPosition: 321,
        sourceURL: "http://reader.synthetic/_next/static/chunks/synthetic.js?private=query#private-fragment",
        sourceFunctionName: "syntheticHandler" },
      { startTime: 105, duration: 3, invokerType: "private synthetic invoker",
        sourceURL: "https://foreign.invalid/_next/static/chunks/foreign.js?private=query",
        sourceFunctionName: "private synthetic body" },
      { startTime: 106, duration: 2, sourceURL: "http://reader.synthetic/conversations/private-synthetic-id?private=query",
        sourceFunctionName: "<private synthetic inline source>", sourceCharPosition: Number.NaN },
    ],
  };
  let observer, animationObserver;
  const observers = [];
  class Observer {
    static supportedEntryTypes = kind === "unsupported-longtasks" ? []
      : kind.startsWith("native-") ? ["longtask", "long-animation-frame"] : ["longtask"];
    constructor(callback) { this.callback = callback; this.pending = []; observers.push(this); }
    observe({ type }) { this.type = type; if (type === "longtask") observer = this; else animationObserver = this; }
    takeRecords() { const result = this.pending; this.pending = []; return result; }
    disconnect() { this.disconnected = true; }
  }
  const context = {
    exports: {}, window, innerWidth: 1280, URL,
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
      if (step === 0) {
        observer?.callback({ getEntries: () => longTasks });
        animationObserver?.callback({ getEntries: () => [nativeFrame] });
        if (kind === "native-drain") {
          observer.pending = [{ startTime: 104, duration: 80 }];
          animationObserver.pending = [{ startTime: 104, duration: 80 }];
        }
      }
      step++;
    },
  };
  runInNewContext(compiled, context);
  const result = await context.exports.runWheelTelemetry(page, root, 6);
  assert.ok(observers.every(item => item.disconnected && item.pending.length === 0),
    "All native observers must be drained and disconnected.");
  assert.equal(scheduled.size, 0, "The collector must cancel its animation frame.");
  return result;
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

test("ordinary unprofiled runs retain every native long-task start time and duration", async () => {
  const result = await coordinateFixture("ordinary");
  assert.equal(result.longTaskObserverSupported, true);
  assert.deepEqual(Array.from(result.longTaskSpans, span => ({ ...span })), [
    { startTime: 101, duration: 213 }, { startTime: 102, duration: 60 },
  ]);
  assert.equal(result.longestTask, 213);
  assert.equal(result.longTaskTotal, 273);
  assert.equal(result.diagnosticTiming, undefined, "Ordinary evidence must not enable the CPU diagnostic mode.");
});

test("unsupported native long-task measurement is explicit and cannot satisfy the required cold-run assertion", async () => {
  const result = await coordinateFixture("unsupported-longtasks");
  assert.equal(result.longTaskObserverSupported, false);
  assert.equal(result.longTaskSpans.length, 0);
  assert.match(harness, /expect\(run\.longTaskObserverSupported,[^;]*\)\.toBe\(true\)/);
});

test("long animation frames retain native script, render and forced-layout durations without changing the budget", async () => {
  const result = await coordinateFixture("native-attribution");
  assert.equal(result.longAnimationFrameDiagnostics.supported, true);
  const [frame] = result.longAnimationFrameDiagnostics.frames;
  assert.equal(frame.duration, 151);
  assert.equal(frame.blockingDuration, 101);
  assert.equal(frame.renderStart, 110);
  assert.equal(frame.styleAndLayoutStart, 120);
  assert.equal(frame.scripts.length, 3, "Opaque script entries remain present, not filtered out.");
  assert.equal(frame.scripts[0].duration, 140);
  assert.equal(frame.scripts[0].forcedStyleAndLayoutDuration, 90);
  assert.equal(frame.scripts[0].sourceFunctionName, "syntheticHandler");
  assert.equal(frame.scripts[0].sourceCharPosition, 321);
  assert.equal(result.longestTask, 213, "Native frame attribution must not replace the original long-task gate.");
});

test("native diagnostics never persist query/fragment, foreign URLs, conversation paths or inline/event text", async () => {
  const result = await coordinateFixture("native-privacy");
  const [frame] = result.longAnimationFrameDiagnostics.frames;
  assert.equal(frame.scripts[0].sourcePath, "/_next/static/chunks/synthetic.js");
  assert.equal(frame.scripts[1].sourcePath, null);
  assert.equal(frame.scripts[1].sourceFunctionName, null);
  assert.equal(frame.scripts[1].invokerType, null);
  assert.equal(frame.scripts[2].sourcePath, null);
  assert.equal(frame.scripts[2].sourceFunctionName, null);
  assert.equal(frame.scripts[2].sourceCharPosition, null);
  assert.doesNotMatch(JSON.stringify(result.longAnimationFrameDiagnostics), /private|foreign|sourceURL|invoker"/);
});

test("undelivered native records are drained once and remain in the original task totals", async () => {
  const result = await coordinateFixture("native-drain");
  assert.deepEqual(Array.from(result.longTasks), [213, 60, 80]);
  assert.deepEqual(Array.from(result.longTaskSpans, span => ({ ...span })), [
    { startTime: 101, duration: 213 }, { startTime: 102, duration: 60 }, { startTime: 104, duration: 80 },
  ]);
  assert.equal(result.longestTask, 213);
  assert.equal(result.longTaskTotal, 353);
  assert.equal(result.longAnimationFrameDiagnostics.frames.length, 2);
  assert.equal(result.longAnimationFrameDiagnostics.frames[1].blockingDuration, null, "Missing attribution is unknown, not zero.");
});

test("missing long-animation-frame support is unknown supplemental evidence, not fabricated zero browser cost", async () => {
  const result = await coordinateFixture("ordinary");
  assert.equal(result.longAnimationFrameDiagnostics.supported, false);
  assert.equal(result.longAnimationFrameDiagnostics.frames.length, 0);
  assert.equal(result.longTaskObserverSupported, true);
  assert.equal(result.longestTask, 213);
});

// Execute the actual nine-case callback's assertions and publish ordering.
// Only import/browser/FS transport is adapted; Playwright's real expect is used.
async function coldBudget({ longest = 151, total = 231, supported = true } = {}) {
  const ts = require("typescript");
  const ast = ts.createSourceFile("reader-capacity.spec.ts", harness, ts.ScriptTarget.ES2022, true);
  let callback;
  const find = node => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "test"
      && node.arguments[0]?.getText(ast).includes("three cold runs and warm revisit")) callback = node.arguments[1];
    ts.forEachChild(node, find);
  };
  find(ast);
  assert.ok(callback);
  const compiled = ts.transpileModule(`exports.run = ${callback.getText(ast)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exported = {}, phases = [], written = [];
  new Function("exports", "profile", "messages", "diagnostic", "seedConversation", "measureReader",
    "measureWarmRevisit", "mkdir", "writeFile", "dirname", "expect", "console", compiled)(
    exported, "math", 10000, false,
    async () => { phases.push("seed"); return "synthetic-cold-gate"; },
    async (_page, _id, run) => {
      phases.push(`cold-${run}`);
      return { run, scrollMonotonic: true, pageHorizontalOverflow: false,
        longTaskObserverSupported: supported, mountedMessagesMax: 22, mountedBlocksMax: 77,
        p95FrameInterval: 16.8, longestTask: run === 2 ? longest : 0,
        longTaskTotal: run === 2 ? total : 0,
        longTaskSpans: run === 2 ? [{ startTime: 2000, duration: 80 }, { startTime: 2100, duration: longest }] : [] };
    },
    async () => { phases.push("warm"); return { scrollMonotonic: true }; },
    async () => { phases.push("mkdir"); },
    async (_path, value) => { phases.push("write"); written.push(JSON.parse(value)); },
    dirname, require("@playwright/test").expect, { info: () => { phases.push("log"); } },
  );
  let failure;
  try {
    await exported.run({ page: { addInitScript: async () => {} }, request: {} }, {
      outputPath: name => join(process.env.RUNNER_TEMP ?? process.env.TEMP, "cold-budget-control", name),
      attach: async () => { phases.push("attach"); },
    });
  } catch (error) { failure = error; }
  assert.deepEqual(phases, ["seed", "cold-0", "cold-1", "cold-2", "warm", "mkdir", "write", "attach", "log"]);
  assert.equal(written.length, 1);
  assert.equal(written[0].runs.length, 3, "A failed cold run cannot remove another raw measurement.");
  assert.equal(written[0].measurement.diagnosticOnly, false);
  return { failure, payload: written[0] };
}

test("the actual capacity assertion rejects the official 151ms cold-2 pattern after retaining all raw evidence", async () => {
  const result = await coldBudget();
  assert.ok(result.failure);
  assert.match(result.failure.message, /cold run 2/);
  assert.match(result.failure.message, /Expected:.*<=.*150/);
  assert.equal(result.payload.runs[2].longestTask, 151);
  assert.equal(result.payload.runs[2].longTaskTotal, 231);
});

test("150ms still passes the same actual assertion without rounding or a new tolerance", async () => {
  const result = await coldBudget({ longest: 150, total: 230 });
  assert.equal(result.failure, undefined);
  assert.equal(result.payload.runs[2].longestTask, 150);
});

test("251ms total still fails independently of a passing maximum task", async () => {
  const result = await coldBudget({ longest: 100, total: 251 });
  assert.ok(result.failure);
  assert.match(result.failure.message, /total long tasks/);
  assert.equal(result.payload.runs[2].longTaskTotal, 251);
});

test("missing native task support cannot turn unknown zero-duration evidence into a capacity pass", async () => {
  const result = await coldBudget({ longest: 0, total: 0, supported: false });
  assert.ok(result.failure);
  assert.match(result.failure.message, /missing long-task evidence/);
  assert.equal(result.payload.runs[0].longTaskObserverSupported, false);
});
