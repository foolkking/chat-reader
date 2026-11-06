import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const source = readFileSync(new URL("../../apps/web/features/conversations/conversation-reader.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("conversation-reader.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const reader = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ConversationReader");
const effects = reader.body.statements.filter(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
  && node.expression.expression.getText(ast) === "useEffect" && node.getText(ast).includes("const capturePreferenceAnchor ="));
assert.equal(effects.length, 1);
const helpers = ast.statements.filter(node => ts.isFunctionDeclaration(node) && [
  "parseBlockTargetId", "settlePreferenceLayoutAnchor", "compensateScrollAnchorFrame", "focusAnchorError",
].includes(node.name?.text));
assert.equal(helpers.length, 4);
const compiled = ts.transpileModule(`
${helpers.map(node => node.getText(ast)).join("\n")}
return (${effects[0].expression.arguments[0].getText(ast)})();`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

// Execute the actual effect and settling helpers. Only DOM measurements,
// block leases and animation frames are controlled; no parallel copy of the
// transition logic and no real browser/layout claims live in this test.
function fixture({ mounted = true } = {}) {
  const window = new EventTarget(), root = new EventTarget(), frames = new Map();
  let clock = 0, next = 0, scroll = 0, flowTop = 150, attached = mounted;
  const writes = [], releases = [], handoffs = [], leases = [];
  Object.assign(window, {
    performance: { now: () => clock },
    requestAnimationFrame: callback => { frames.set(++next, callback); return next; },
    cancelAnimationFrame: id => frames.delete(id),
  });
  root.dataset = {};
  root.getBoundingClientRect = () => ({ top: 0 });
  Object.defineProperty(root, "scrollTop", { get: () => scroll, set: value => { scroll = value; writes.push(value); } });
  const target = { id: "block-synthetic-message-57",
    get isConnected() { return attached; }, getBoundingClientRect: () => ({ top: flowTop - scroll }) };
  root.contains = node => attached && node === target;
  const document = { getElementById: id => attached && id === target.id ? target : null };
  root.addEventListener("chat-reader:position-released", () => handoffs.push({
    top: target.getBoundingClientRect().top, flag: root.dataset.readerLayoutCompensating,
  }));
  const refs = Object.fromEntries(Object.entries({
    scrollContainerRef: root, preferenceAnchorRef: null, preferenceStableAnchorRef: null,
    preferenceTransitionRef: 0, preferenceBlockLeaseRef: null, preferenceCompensationFrameRef: null,
    cancelPreferenceTransitionRef: () => {},
  }).map(([key, current]) => [key, { current }]));
  const captureScrollAnchor = () => attached ? { targetId: target.id, offset: target.getBoundingClientRect().top } : null;
  const acquireReaderBlockLease = async (_message, _block, current) => {
    const lease = { current, release: () => releases.push(lease) }; leases.push(lease); return lease;
  };
  const inputs = { ...refs, window, document, ACTIVE_READING_OFFSET: 120, captureScrollAnchor, acquireReaderBlockLease };
  const cleanup = new Function(...Object.keys(inputs), compiled)(...Object.values(inputs));
  const tick = async () => {
    clock += 16;
    const tasks = [...frames.values()]; frames.clear();
    tasks.forEach(task => task(clock));
    // Resume suspended actual settlers and their finally/lease continuations.
    for (let pass = 0; pass < 6; pass++) await Promise.resolve();
  };
  const event = (phase, id) => window.dispatchEvent(id === undefined
    ? new Event(`chat-reader:reader-layout-${phase}-change`)
    : new CustomEvent(`chat-reader:reader-layout-${phase}-change`, { detail: id }));
  return { root, refs, frames, writes, handoffs, releases, leases, tick, event, cleanup,
    setMounted: value => { attached = value; }, shift: delta => { flowTop += delta; },
    cancel: () => refs.cancelPreferenceTransitionRef.current(),
    advance: async (count = 80) => { for (let i = 0; i < count; i++) await tick(); },
  };
}

test("a layout event before canonical content mounts cannot strand the progress/geometry lock", async () => {
  const f = fixture({ mounted: false });
  try {
    f.event("will", "cold");
    assert.equal(f.root.dataset.readerLayoutCompensating, undefined);
    f.event("did", "cold"); await f.tick();
    assert.equal(f.frames.size, 0);
    assert.equal(f.leases.length, 0);
    f.setMounted(true); f.event("will", "ready"); f.shift(42); f.event("did", "ready");
    await f.advance();
    assert.equal(f.root.scrollTop, 42);
    assert.equal(f.root.dataset.readerLayoutCompensating, undefined);
    assert.deepEqual(f.handoffs, [{ top: 150, flag: undefined }]);
    assert.equal(f.releases.length, 1);
  } finally { f.cleanup(); }
});

for (const takeover of ["input", "navigation", "unmount"]) {
  test(`${takeover} between settle await and RAF cannot revive a stale preference restore`, async () => {
    const f = fixture();
    try {
      f.event("will", "old"); f.event("did", "old");
      assert.equal(f.frames.size, 2, "One writer and one read-only waiter.");
      if (takeover === "unmount") f.cleanup(); else f.cancel();
      f.shift(25);
      await f.tick();
      assert.deepEqual(f.writes, []);
      assert.equal(f.root.dataset.readerLayoutCompensating, undefined);
      assert.equal(f.refs.preferenceAnchorRef.current, null);
      assert.equal(f.frames.size, 0);
      assert.equal(f.releases.length, 1);
    } finally { f.cleanup(); }
  });
}

test("an old did-change event cannot start or end a newer identified transition", async () => {
  const f = fixture();
  try {
    f.event("will", "A"); f.event("will", "B"); f.shift(30);
    f.event("did", "A"); await f.advance();
    assert.equal(f.root.scrollTop, 30);
    assert.equal(f.root.dataset.readerLayoutCompensating, "true");
    assert.equal(f.refs.preferenceAnchorRef.current?.offset, 150);
    f.event("did", "B"); await f.advance();
    assert.equal(f.root.dataset.readerLayoutCompensating, undefined);
    assert.equal(f.handoffs.length, 1);
    assert.equal(f.releases.length, 2);
  } finally { f.cleanup(); }
});

test("duplicate did-change events share one waiter and one lease release", async () => {
  const f = fixture();
  try {
    f.event("will", "A"); f.event("did", "A"); f.event("did", "A");
    assert.equal(f.frames.size, 2);
    f.shift(12); await f.advance();
    assert.deepEqual(f.writes, [12]);
    assert.equal(f.handoffs.length, 1);
    assert.equal(f.releases.length, 1);
  } finally { f.cleanup(); }
});

test("an anonymous surface event cannot complete a newer identified typography change", async () => {
  const f = fixture();
  try {
    f.event("will"); f.event("will", "font");
    f.event("did"); await f.advance();
    assert.equal(f.root.dataset.readerLayoutCompensating, "true");
    f.event("did", "font"); await f.advance();
    assert.equal(f.root.dataset.readerLayoutCompensating, undefined);
    assert.equal(f.handoffs.length, 1);
  } finally { f.cleanup(); }
});

test("successive density changes retire the old waiter without alternating scroll writers", async () => {
  const f = fixture();
  try {
    f.event("will", "compact"); f.shift(-40); f.event("did", "compact"); await f.tick();
    f.event("will", "spacious"); f.shift(80); f.event("did", "spacious");
    await f.advance();
    assert.deepEqual(f.writes, [-40, 40]);
    assert.equal(f.root.dataset.readerLayoutCompensating, undefined);
    assert.equal(f.handoffs.length, 1);
    assert.equal(f.releases.length, 2);
  } finally { f.cleanup(); }
});
