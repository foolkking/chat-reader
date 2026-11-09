import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
function compile(file) {
  return ts.transpileModule(readFileSync(new URL(`../../apps/web/${file}`, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
}
const policy = {};
new Function("exports", compile("features/conversations/reader-render-policy.ts"))(policy);
const block = (text, block_type = "paragraph") => ({ block_type, data: {}, plain_text: text });
test("release CI requires the mounted Reader regression and preserves its evidence", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/build-release-images.yml", import.meta.url), "utf8");
  const step = workflow.split("- name: Formula reading, focus tools and timed return regression")[1]?.split("- name:")[0];
  assert.ok(step, "The mounted regression must be a required release step.");
  assert.match(step, /run: node scripts\/ux\/reader-interaction-browser\.mjs/);
  assert.match(step, /PLAYWRIGHT_USE_BUNDLED_CHROMIUM: "1"/);
  assert.doesNotMatch(step, /continue-on-error|if:|\|\| true/);
  assert.match(workflow, /reader-interaction-browser\/result\.json/);
  assert.match(workflow, /reader-interaction-browser\/failure-state\.json/);
  assert.match(workflow, /reader-interaction-browser\/\*\.png/);
});

test("math cost detects all existing delimiters without interpreting inline/fenced code", () => {
  for (const source of ["$x^2$", "$$x^2$$", "\\(x\\)", "\\[x\\]", "[\n\\frac{a}{b}\n]"]) {
    assert.equal(policy.hasReaderMath([block(source)]), true, source);
  }
  for (const source of ["plain text", "`$not math$`", "``\\(code\\)``", "```latex\n$$example$$\n```", "~~~latex\n\\[example\\]\n~~~"]) {
    assert.equal(policy.hasReaderMath([block(source)]), false, source);
  }
  assert.equal(policy.hasReaderMath([block("$code$", "code")]), false);
  assert.equal(policy.hasReaderMath([block("x", "math")]), true);
});
test("nine formula display units virtualize below the old character/block thresholds", () => {
  assert.equal(policy.virtualizeReaderBlocks(9, 400, 9, true), true);
  assert.equal(policy.virtualizeReaderBlocks(8, 400, 8, true), false);
  assert.equal(policy.virtualizeReaderBlocks(9, 400, 9, false), false);
  assert.equal(policy.virtualizeReaderBlocks(161, 400, 1, false), true);
  assert.equal(policy.virtualizeReaderBlocks(2, 50_001, 1, false), true);
});

// Real hook body, deterministic clock/hook adapters. No implementation copied.
function cueFixture() {
  let now = 1000, props = [1000, true, false], index = 0, value, dirty = false, cleanup, oldDeps;
  const state = [], timers = new Map();
  let timerId = 0;
  const hooks = {
    useState(initial) { const slot = index++; if (!(slot in state)) state[slot] = initial;
      return [state[slot], next => { const v = typeof next === "function" ? next(state[slot]) : next; if (state[slot] !== v) { state[slot] = v; dirty = true; } }]; },
    useEffect(effect, deps) { if (!oldDeps || deps.some((d, i) => d !== oldDeps[i])) {
      oldDeps = deps; cleanup?.(); cleanup = effect();
    } },
  };
  const exports = {};
  new Function("require", "exports", "window", "Date", compile("features/conversations/use-return-reading-cue.ts"))(
    () => hooks, exports,
    { setTimeout(fn, delay) { timers.set(++timerId, { at: now + delay, fn }); return timerId; }, clearTimeout(id) { timers.delete(id); } },
    { now: () => now },
  );
  const render = () => { do { dirty = false; index = 0; value = exports.useReturnReadingCue(...props); } while (dirty); return value; };
  return {
    render, props: next => { props = next; return render(); },
    tick(ms) { now += ms; for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.fn(); } return render(); },
    close() { cleanup?.(); assert.equal(timers.size, 0); },
  };
}
test("return cue loses emphasis at 3 seconds, hides at 30 without deleting the checkpoint", () => {
  const f = cueFixture();
  assert.equal(f.render().emphasized, true);
  assert.equal(f.tick(2999).emphasized, true);
  assert.deepEqual([f.tick(1).visible, f.render().emphasized], [true, false]);
  assert.equal(f.tick(27_000).visible, false);
  // The checkpoint is still available; a new successful navigation renews it.
  assert.equal(f.props([31_000, true, false]).emphasized, true);
  f.close();
});
test("focused/busy return entries survive expiry; identity changes cancel timers", () => {
  const f = cueFixture();
  f.render().onFocus(); f.render();
  assert.equal(f.tick(30_000).visible, true);
  f.render().onBlur(); assert.equal(f.render().visible, false);
  assert.equal(f.props([1000, true, true]).visible, true);
  assert.equal(f.props([0, false, false]).visible, false);
  f.close();
});
test("renewing the cue does not forget a still-focused persistent Return button", () => {
  const f = cueFixture();
  f.render().onFocus(); f.render(); f.tick(1000);
  assert.equal(f.props([2000, true, false]).emphasized, true);
  assert.equal(f.tick(30_000).visible, true);
  f.render().onBlur();
  assert.equal(f.render().visible, false);
  f.close();
});
