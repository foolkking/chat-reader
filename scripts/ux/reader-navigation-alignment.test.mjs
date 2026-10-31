import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const appRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = appRequire("typescript");
const source = readFileSync(new URL("../../apps/web/features/conversations/reader-navigation.ts", import.meta.url), "utf8");
const readerSource = readFileSync(new URL("../../apps/web/features/conversations/conversation-reader.tsx", import.meta.url), "utf8");
const readerAst = ts.createSourceFile("conversation-reader.tsx", readerSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const reader = readerAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ConversationReader");
const readerDeclarations = new Map(reader.body.statements.filter(ts.isVariableStatement)
  .flatMap(node => [...node.declarationList.declarations].map(item => [item.name.getText(readerAst), item])));
const compiled = ts.transpileModule(source, { fileName: "reader-navigation.ts", compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText;

// Actual navigation module with controlled scroll/Range/animation adapters.
// This is not mounted DOM or browser geometry evidence; CI's Reader/PWA cases
// retain their exact target, fallback, transient pulse and replay assertions.
function fixture({ height = 500, extent = 2000, contentTop = 600, targetHeight = 80,
  rangeInset, paddingTop = 0, windowScroll = false, stuck = false } = {}) {
  let now = 0, nextFrame = 0, frameCount = 0, current = true, position = 0;
  const frames = new Map(), observers = [], writes = [];
  const rootTop = windowScroll ? 0 : 80;
  const rect = (top, size) => ({ top, bottom: top + size, height: size, left: 0, right: 300, width: 300 });
  const root = {
    clientHeight: height, clientTop: 0, scrollHeight: extent,
    get scrollTop() { return position; },
    set scrollTop(value) {
      writes.push(value);
      if (!stuck) position = Math.min(Math.max(0, root.scrollHeight - height), Math.max(0, value));
    },
    getBoundingClientRect: () => rect(rootTop, height),
  };
  const target = {
    id: "synthetic-target", isConnected: true,
    closest: () => null,
    querySelectorAll: () => [],
    getBoundingClientRect: () => rect(rootTop + contentTop - position, targetHeight),
  };
  const rangeRect = () => rect(rootTop + contentTop + (rangeInset ?? 0) - position, 20);
  const range = rangeInset === undefined ? null : { getBoundingClientRect: rangeRect };
  const document = {
    scrollingElement: root,
    getElementById: id => id === target.id ? target : null,
  };
  const window = {
    innerHeight: height,
    get scrollY() { return position; },
    scrollTo: ({ top }) => { root.scrollTop = top; },
    performance: { now: () => now },
    requestAnimationFrame: action => { const id = ++nextFrame; frames.set(id, action); return id; },
    cancelAnimationFrame: id => frames.delete(id),
  };
  class ResizeObserver {
    constructor(action) { this.action = action; this.disconnected = false; observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  }
  const imports = name => {
    assert.equal(name, "./text-anchor");
    return {
      resolveTextAnchorRange: (_target, anchor) => anchor.startOffset !== undefined || anchor.quote ? range : null,
      firstVisibleRangeRect: value => value?.getBoundingClientRect() ?? null,
    };
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", "document", "window", "ResizeObserver", "getComputedStyle", compiled)(
    imports, module, module.exports, document, window, ResizeObserver,
    () => ({ scrollPaddingTop: `${paddingTop}px` }),
  );
  async function drain(task, onFrame) {
    let settled = false;
    task.then(() => { settled = true; }, () => { settled = true; });
    for (let index = 0; index < 100 && !settled; index += 1) {
      await Promise.resolve();
      now += 20;
      onFrame(++frameCount);
      const pending = [...frames.values()];
      frames.clear();
      for (const action of pending) action(now);
    }
    assert.equal(settled, true, "The bounded navigation must resolve.");
    assert.equal(frames.size, 0);
    assert.ok(observers.every(observer => observer.disconnected), "Navigation observers must be released.");
    return task;
  }
  return {
    root, target, writes, rangeRect,
    cancel: () => { current = false; },
    grow: size => { root.scrollHeight = size; for (const observer of observers) observer.action(); },
    restore(options = {}, onFrame = () => {}) {
      const anchor = { targetId: target.id, offset: target.getBoundingClientRect().top - rootTop };
      const { tokenIsCurrent = () => current, ...restoreOptions } = options;
      return drain(module.exports.restoreScrollAnchor({
        root, anchor, tokenIsCurrent, ...restoreOptions,
      }), onFrame);
    },
    async run(options = {}, onFrame = () => {}) {
      const task = module.exports.navigateMountedTarget({
        root: windowScroll ? null : root, targetId: target.id,
        offset: 120, timeoutMs: 600, tokenIsCurrent: () => current,
        ...(range ? { characterOffset: 2, endCharacterOffset: 8 } : {}), ...options,
      });
      return drain(task, onFrame);
    },
  };
}

test("an interior target still reaches the reading line, not a merely visible position", async () => {
  const f = fixture();
  const result = await f.run();
  assert.equal(result.ok, true);
  assert.equal(result.fallback, false);
  assert.equal(f.root.scrollTop, 480);
  assert.equal(f.target.getBoundingClientRect().top - f.root.getBoundingClientRect().top, 120);
});

for (const windowScroll of [false, true]) {
  test(`${windowScroll ? "window" : "Reader"}: a short first target settles at its visible upper endpoint`, async () => {
    const f = fixture({ windowScroll, extent: 400, contentTop: 32 });
    assert.equal((await f.run()).ok, true);
    assert.equal(f.root.scrollTop, 0);
  });

  test(`${windowScroll ? "window" : "Reader"}: an exact Range settles at its visible lower endpoint`, async () => {
    const f = fixture({ windowScroll, extent: 600, contentTop: 350, rangeInset: 20 });
    const result = await f.run();
    assert.equal(result.ok, true);
    assert.equal(result.fallback, false);
    assert.equal(f.root.scrollTop, 100);
    const top = f.rangeRect().top - f.root.getBoundingClientRect().top;
    assert.equal(top, 270);
    assert.ok(top < f.root.clientHeight);
  });
}

test("a clamped but offscreen virtual target still fails", async () => {
  const f = fixture({ extent: 600, contentTop: 800, rangeInset: 20 });
  assert.deepEqual(await f.run(), { ok: false, targetId: f.target.id, reason: "target-not-aligned" });
});

test("a target covered by the mobile header cannot pass the endpoint exception", async () => {
  // Stay outside the normal 24px tolerance so both controls must use the
  // physical-endpoint path. Only the selected Range's visibility changes.
  const options = { extent: 400, contentTop: 32, rangeInset: 0 };
  const visible = fixture(options);
  assert.ok(visible.root.scrollHeight <= visible.root.clientHeight);
  assert.ok(Math.abs(visible.rangeRect().top - visible.root.getBoundingClientRect().top - 120) > 24);
  assert.equal((await visible.run()).ok, true);
  assert.equal(visible.root.scrollTop, 0);

  const paddingTop = 56;
  const covered = fixture({ ...options, paddingTop });
  assert.ok(covered.rangeRect().bottom <= covered.root.getBoundingClientRect().top + paddingTop);
  assert.deepEqual(await covered.run(), {
    ok: false, targetId: covered.target.id, reason: "target-not-aligned",
  });
  assert.equal(covered.root.scrollTop, 0);
});

test("a scroll stalled away from its physical endpoint is not accepted", async () => {
  const f = fixture({ stuck: true, contentTop: 200, rangeInset: 20 });
  assert.equal((await f.run()).ok, false);
  assert.equal(f.root.scrollTop, 0);
  assert.ok(f.writes.length > 0);
});

test("zero-height mounted anchors still fail", async () => {
  const f = fixture({ extent: 400, contentTop: 32, targetHeight: 0 });
  assert.equal((await f.run()).ok, false);
});

test("an endpoint stops qualifying when appended content makes exact alignment possible", async () => {
  const f = fixture({ extent: 600, contentTop: 350, rangeInset: 20 });
  const result = await f.run({}, frame => { if (frame === 5) f.grow(2000); });
  assert.equal(result.ok, true);
  assert.equal(f.root.scrollTop, 250);
  assert.equal(f.rangeRect().top - f.root.getBoundingClientRect().top, 120);
});

test("an absent text Range remains a disclosed fallback at the visible endpoint", async () => {
  const f = fixture({ extent: 400, contentTop: 32 });
  assert.deepEqual(await f.run({ characterOffset: 9999 }), {
    ok: true, targetId: f.target.id, fallback: true, reason: "stale-anchor",
  });
});

test("retired navigation cannot become a successful endpoint alignment", async () => {
  const f = fixture({ extent: 400, contentTop: 32 });
  assert.equal((await f.run({}, frame => { if (frame === 5) f.cancel(); })).reason, "cancelled");
});

test("Reader edge restore and trim both retire when a new scroll intent arrives", () => {
  for (const name of ["loadPreviousWindow", "loadNextWindow"]) {
    const declaration = readerDeclarations.get(name);
    assert.ok(declaration, `${name} must remain a Reader callback`);
    const callback = declaration.initializer.arguments[0].getText(readerAst);
    assert.match(callback, /const scrollIntentAtAnchor = scrollIntentSequenceRef\.current/);
    assert.match(callback, /scrollIntentSequenceRef\.current === scrollIntentAtAnchor/);
    assert.match(callback, /tokenIsCurrent: restoreIsCurrent/);
    assert.match(callback, /const trimIntent = scrollIntentSequenceRef\.current/);
    assert.match(callback, /scrollIntentSequenceRef\.current === trimIntent/);
    assert.match(callback, /tokenIsCurrent: trimIsCurrent/);
  }
});

test("retired Reader edge restoration cannot overwrite a later user scroll", async () => {
  const f = fixture({ extent: 5000 });
  let userScrollWriteCount = 0;
  const task = f.restore({}, frame => {
    if (frame === 2) {
      f.cancel();
      f.root.scrollTop = 120;
      userScrollWriteCount = f.writes.length;
    }
  });
  assert.equal(await task, false);
  assert.equal(f.root.scrollTop, 120);
  assert.deepEqual(
    f.writes.slice(userScrollWriteCount),
    [],
    "A retired anchor must not write over the later scroll.",
  );
});
