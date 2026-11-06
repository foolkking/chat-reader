import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const source = readFileSync(new URL("../../apps/web/features/compare/conversation-compare.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("conversation-compare.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const pane = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ComparePane");
const effect = pane.body.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
  && node.expression.expression.getText(ast) === "useEffect");
assert.ok(effect);
const compiled = ts.transpileModule(`return (${effect.expression.arguments[0].getText(ast)})();`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

// The actual Compare effect; only async transport/virtual leases and DOM
// geometry are adapters. Browser alignment and opposite-pane proof stay in CI.
function fixture({ targetPresent = true } = {}) {
  const root = new EventTarget(), other = new EventTarget();
  Object.assign(root, { dataset: {}, isConnected: true, scrollTop: 100 });
  Object.assign(other, { dataset: {}, isConnected: true, scrollTop: 240 });
  const target = { id: "block-synthetic-190" };
  root.contains = node => node === target && targetPresent;
  const token = { current: 0 }, block = deferred(), alignment = deferred();
  const calls = [], releases = [], handoffs = [], errors = [], targets = [], cancellations = [];
  const lease = { targetId: target.id, release: () => releases.push({ stage: root.dataset.navigationStage, handoffs: handoffs.length }) };
  root.addEventListener("chat-reader:position-released", () => handoffs.push({ stage: root.dataset.navigationStage, top: root.scrollTop }));
  const inputs = {
    targetBlockId: target.id, activeMessageId: "synthetic", turn: { data: { items: [{ id: "synthetic" }] } },
    navigationToken: token, rootRef: { current: root },
    document: { getElementById: () => targetPresent ? target : null },
    acquireReaderBlockLease: (messageId, index, current) => { calls.push({ kind: "lease", messageId, index, current }); return block.promise; },
    navigateMountedTarget: options => { calls.push({ kind: "navigate", options }); return alignment.promise; },
    cancelReaderPosition: value => cancellations.push(value),
    setNavigationError: value => errors.push(value), setTargetBlockId: value => targets.push(value),
  };
  const cleanup = new Function(...Object.keys(inputs), compiled)(...Object.values(inputs));
  return { root, other, token, block, alignment, lease, calls, releases, handoffs, errors, targets, cancellations, cleanup };
}

test("Compare requests strict alignment and hands geometry back before virtual pin release", async () => {
  const f = fixture();
  f.block.resolve(f.lease); await flush();
  const options = f.calls.find(call => call.kind === "navigate").options;
  assert.equal(options.root, f.root);
  assert.equal(options.offset, 24);
  assert.equal(options.alignmentTolerance, 1);
  f.alignment.resolve({ ok: true }); await flush();
  assert.deepEqual(f.errors, [false]);
  assert.deepEqual(f.targets, [null]);
  assert.deepEqual(f.handoffs, [{ stage: undefined, top: 100 }]);
  assert.deepEqual(f.releases, [{ stage: undefined, handoffs: 1 }]);
  assert.equal(f.other.scrollTop, 240);
  assert.deepEqual(f.other.dataset, {});
  f.cleanup();
  assert.equal(f.releases.length, 1, "Cleanup cannot release a virtual lease twice.");
});

test("failed exact alignment keeps its retry target but never strands ownership", async () => {
  const f = fixture();
  f.block.resolve(f.lease); await flush();
  f.alignment.resolve({ ok: false }); await flush();
  assert.deepEqual(f.errors, [true]);
  assert.deepEqual(f.targets, []);
  assert.equal(f.root.dataset.navigationStage, undefined);
  assert.deepEqual(f.releases, [{ stage: undefined, handoffs: 1 }]);
  f.cleanup();
});

test("a missing real target cannot report navigation success or keep a pin", async () => {
  const f = fixture({ targetPresent: false });
  f.block.resolve(f.lease); await flush();
  assert.equal(f.calls.some(call => call.kind === "navigate"), false);
  assert.deepEqual(f.errors, [true]);
  assert.equal(f.releases.length, 1);
  assert.equal(f.root.dataset.navigationStage, undefined);
  f.cleanup();
});

test("input cleanup during alignment releases once and rejects the late result", async () => {
  const f = fixture();
  f.block.resolve(f.lease); await flush();
  const options = f.calls.find(call => call.kind === "navigate").options;
  f.cleanup();
  assert.equal(options.tokenIsCurrent(), false);
  assert.deepEqual(f.cancellations, [f.root]);
  assert.deepEqual(f.releases, [{ stage: undefined, handoffs: 1 }]);
  f.alignment.resolve({ ok: true }); await flush();
  assert.deepEqual(f.errors, []);
  assert.deepEqual(f.targets, []);
  assert.equal(f.releases.length, 1);
});

test("a lease arriving after cleanup is released without resurrecting navigation", async () => {
  const f = fixture();
  f.cleanup(); f.block.resolve(f.lease); await flush();
  assert.equal(f.calls.length, 1);
  assert.equal(f.releases.length, 1);
  assert.equal(f.handoffs.length, 1);
  assert.equal(f.root.dataset.navigationStage, undefined);
});

test("a retired completion cannot clear a replacement pane navigation", async () => {
  const f = fixture();
  f.block.resolve(f.lease); await flush(); f.cleanup();
  f.token.current++; f.root.dataset.navigationStage = "aligning:replacement";
  f.alignment.resolve({ ok: true }); await flush();
  assert.equal(f.root.dataset.navigationStage, "aligning:replacement");
  assert.equal(f.handoffs.length, 1);
  assert.equal(f.releases.length, 1);
  assert.deepEqual(f.targets, []);
});
