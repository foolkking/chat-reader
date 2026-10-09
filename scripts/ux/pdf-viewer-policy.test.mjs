import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

const appRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = appRequire("typescript");
const policy = {};
new Function("exports", ts.transpileModule(readFileSync(new URL("../../apps/web/features/attachments/pdf-viewer-policy.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(policy);
const { Virtualizer } = appRequire("@tanstack/react-virtual");
const noop = () => {};
const flush = async () => { await setImmediate(); await setImmediate(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test("page input accepts only an entire in-range integer", () => {
  for (const [value, expected] of [["1", 1], [" 999 ", 999], ["01", 1], ["1000", 1000], ["0", null], ["1001", null], ["1.5", null], ["2x", null], ["1e2", null], ["", null], ["-1", null], ["9007199254740992", null]]) {
    assert.equal(policy.parsePdfPageInput(value, 1000), expected, value);
  }
});

test("fit page and width keep CSS geometry separate from bitmap budgets", () => {
  const base = { width: 612, height: 792 }, container = { width: 1000, height: 800 };
  const page = policy.pdfPageLayout(base, container, "page", 1, 3);
  assert.ok(page.width <= 968); assert.ok(page.height <= 768);
  const width = policy.pdfPageLayout(base, container, "width", 1, 3);
  assert.equal(width.width, 968); assert.ok(width.height > page.height);
  assert.equal(policy.pdfPageLayout(base, container, "custom", 3, 1).width, 1836);
});

test("canvas budget holds across small, landscape and large high-DPR pages", () => {
  for (const width of [1, 64, 612, 2000, 8192]) for (const height of [1, 100, 792, 6000, 8192]) for (const zoom of [0.25, 1, 4]) {
    const result = policy.pdfPageLayout({ width, height }, { width: 1440, height: 900 }, "custom", zoom, 8);
    assert.ok(result.pixelWidth * result.pixelHeight <= policy.PDF_CANVAS_MAX_PIXELS);
    assert.ok(Math.max(result.pixelWidth, result.pixelHeight) <= policy.PDF_CANVAS_MAX_EDGE);
    assert.ok(result.pixelWidth >= 1 && result.pixelHeight >= 1);
    assert.equal(result.width, width * zoom);
  }
});

test("invalid PDF dimensions fail before allocating a canvas", () => {
  for (const base of [{ width: 0, height: 792 }, { width: NaN, height: 792 }, { width: Infinity, height: 1 }, { width: 50000, height: 50000 }]) {
    assert.throws(() => policy.pdfPageLayout(base, { width: 1000, height: 800 }, "custom", 1));
  }
});

test("render queue never exceeds two active tasks and gives pages priority", async () => {
  const queue = policy.createPdfRenderQueue(), jobs = [], order = [], pending = [];
  let active = 0, peak = 0;
  const add = (name, priority) => {
    const wait = deferred(); jobs.push(wait);
    pending.push(queue.run(new AbortController().signal, async () => { active += 1; peak = Math.max(peak, active); order.push(name); await wait.promise; active -= 1; }, priority));
  };
  add("first", 0); add("second", 0); add("thumbnail", 1); add("page", 0);
  await flush(); assert.deepEqual(order, ["first", "second"]);
  jobs[0].resolve(); await flush(); assert.deepEqual(order, ["first", "second", "page"]);
  jobs[1].resolve(); jobs[2].resolve(); jobs[3].resolve(); await Promise.all(pending);
  assert.equal(peak, 2); assert.equal(active, 0);
});

test("queued cancellation discards work; failure returns the occupied slot", async () => {
  const queue = policy.createPdfRenderQueue(1), first = deferred(), controller = new AbortController();
  let cancelledCalls = 0, lastCalls = 0;
  const running = queue.run(new AbortController().signal, () => first.promise);
  const rejected = assert.rejects(running, /synthetic failure/);
  const queued = queue.run(controller.signal, async () => { cancelledCalls += 1; });
  const cancelled = assert.rejects(queued, { name: "AbortError" });
  const last = queue.run(new AbortController().signal, async () => { lastCalls += 1; });
  controller.abort(); first.reject(new Error("synthetic failure"));
  await Promise.all([rejected, cancelled, last]);
  assert.equal(cancelledCalls, 0); assert.equal(lastCalls, 1);
});

test("an aborted running task retains its slot until work settles", async () => {
  const queue = policy.createPdfRenderQueue(1), first = deferred(), controller = new AbortController();
  let nextCalls = 0;
  const running = queue.run(controller.signal, () => first.promise); await flush(); controller.abort();
  const next = queue.run(new AbortController().signal, async () => { nextCalls += 1; });
  await flush(); assert.equal(nextCalls, 0);
  first.resolve(); await Promise.all([running, next]); assert.equal(nextCalls, 1);
});

test("queue validates its concurrency", () => {
  for (const concurrency of [0, -1, 1.5, NaN, Infinity]) assert.throws(() => policy.createPdfRenderQueue(concurrency));
});

test("main page and thumbnail share a lease without cleaning each other's resources", async () => {
  let reads = 0, cleaned = 0;
  const page = { cleanup: () => { cleaned += 1; } }, document = { getPage: async () => { reads += 1; return page; } };
  const main = policy.acquirePdfPage(document, 1), thumbnail = policy.acquirePdfPage(document, 1);
  await Promise.all([main.promise, thumbnail.promise]); assert.equal(reads, 1);
  main.release(); await flush(); assert.equal(cleaned, 0);
  thumbnail.release(); await flush(); assert.equal(cleaned, 1);
  thumbnail.release(); await flush(); assert.equal(cleaned, 1);
});

test("a released unresolved lease cannot clean a newly acquired consumer", async () => {
  const wait = deferred(); let cleaned = 0;
  const document = { getPage: () => wait.promise };
  const first = policy.acquirePdfPage(document, 1); first.release();
  const second = policy.acquirePdfPage(document, 1);
  wait.resolve({ cleanup: () => { cleaned += 1; } }); await second.promise; await flush(); assert.equal(cleaned, 0);
  second.release(); await flush(); assert.equal(cleaned, 1);
});

test("a failed lease is not reused by an immediate explicit retry", async () => {
  let reads = 0;
  const document = { getPage: async () => { reads += 1; if (reads === 1) throw new Error("synthetic page failure"); return { cleanup: noop }; } };
  const first = policy.acquirePdfPage(document, 1); await assert.rejects(first.promise); first.release();
  const next = policy.acquirePdfPage(document, 1);
  try { await next.promise; assert.equal(reads, 2); } finally { next.release(); }
});

test("real installed virtualizer mounts a viewport-sized range rather than 5000 pages", () => {
  const virtualizer = new Virtualizer({ count: 5000, getScrollElement: () => null, estimateSize: () => 1000, overscan: 1, gap: 16, paddingStart: 16, paddingEnd: 16,
    initialRect: { width: 1000, height: 800 }, observeElementRect: noop, observeElementOffset: noop, scrollToFn: noop });
  for (const index of [0, 20, 2500, 4999]) {
    virtualizer.scrollOffset = 16 + index * 1016;
    const items = virtualizer.getVirtualItems();
    assert.ok(items.length <= 4 && items.length > 0);
    assert.ok(items.some(item => item.index === index));
    assert.equal(virtualizer.getVirtualItemForOffset(16 + index * 1016).index, index);
  }
});

test("real virtualizer adjusts mixed page measurements without mounting the whole document", () => {
  const virtualizer = new Virtualizer({ count: 1000, getScrollElement: () => null, estimateSize: () => 800, overscan: 1, gap: 16, initialRect: { width: 900, height: 600 }, observeElementRect: noop, observeElementOffset: noop, scrollToFn: noop });
  virtualizer.scrollOffset = 0; virtualizer.getVirtualItems();
  virtualizer.resizeItem(0, 400); virtualizer.resizeItem(1, 1200);
  assert.equal(virtualizer.getVirtualItemForOffset(500).index, 1);
  assert.ok(virtualizer.getVirtualItems().length <= 4);
});

test("shortcut guard leaves composition, browser commands and media/input controls alone", () => {
  for (const flags of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { defaultPrevented: true }, { target: { closest: () => ({}) } }]) {
    assert.equal(policy.isViewerShortcut({ target: { closest: () => null }, ...flags }), false);
  }
  assert.equal(policy.isViewerShortcut({ target: { closest: () => null } }), true);
});
