import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

const appRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = appRequire("typescript");
const source = ts.createSourceFile("attachment-viewer.tsx", readFileSync(new URL("../../apps/web/features/attachments/attachment-viewer.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const complexSource = ts.createSourceFile("complex-attachment-viewer.tsx", readFileSync(new URL("../../apps/web/features/attachments/complex-attachment-viewer.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const policyUrl = new URL("../../apps/web/features/attachments/pdf-viewer-policy.ts", import.meta.url);
const policy = {};
if (existsSync(policyUrl)) {
  const compiled = ts.transpileModule(readFileSync(policyUrl, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function("exports", compiled)(policy);
}
const registry = {};
new Function("exports", ts.transpileModule(readFileSync(new URL("../../apps/web/features/attachments/preview-adapter-registry.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(registry);
const flush = async () => { await setImmediate(); await setImmediate(); };
const noop = () => {};
function find(predicate) {
  let result;
  const visit = node => { if (!result && predicate(node)) result = node; if (!result) ts.forEachChild(node, visit); };
  visit(source); assert.ok(result, "expected production fragment"); return result;
}
function fn(name) { return find(node => ts.isFunctionDeclaration(node) && node.name?.text === name); }
function complexFn(name) { const result = complexSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name); assert.ok(result); return result; }
function compile(fragment, scope, result) {
  const compiled = ts.transpileModule(fragment.replaceAll("import.meta.url", '"http://synthetic.test/viewer-module.js"'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  return new Function("require", "exports", ...Object.keys(scope), compiled + "\nreturn " + result)(appRequire, {}, ...Object.values(scope));
}
function nodes(root) {
  if (!root || typeof root !== "object") return [];
  if (Array.isArray(root)) return root.flatMap(nodes);
  return [root, ...nodes(root.props?.children)];
}
function named(root, name) { return nodes(root).filter(node => node.type === name); }
const attachment = { id: "synthetic-preview", display_name: "synthetic.pdf", content_url: "/api/synthetic-preview", download_url: "/api/synthetic-download", asset_object: { byte_size: 100 }, resolution_status: "resolved" };

// Actual component/handler AST, with explicit hook/effect, DOM, PDF transport,
// canvas and child-renderer doubles. No browser or real pixel rendering claim.
function fixture(name, props, overrides = {}, extra = {}) {
  const declaration = name === "ComplexAttachmentViewer" ? complexFn(name) : fn(name), states = new Map(), refs = new Map(), effects = [];
  const componentSource = declaration.getSourceFile();
  const stateNames = [], refNames = [];
  for (const statement of declaration.body.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const binding of statement.declarationList.declarations) {
      if (!binding.initializer || !ts.isCallExpression(binding.initializer)) continue;
      if (binding.initializer.expression.getText(componentSource) === "useState") stateNames.push(binding.name.elements[0].getText(componentSource) || `${binding.name.elements[1].getText(componentSource)}:state`);
      if (binding.initializer.expression.getText(componentSource) === "useRef") refNames.push(binding.name.getText(componentSource));
    }
  }
  let stateIndex = 0, refIndex = 0, effectIndex = 0;
  const canvas = { width: 0, height: 0, style: {} };
  const element = { clientWidth: 1000, clientHeight: 800, scrollTop: 0, scrollLeft: 0, isConnected: true,
    querySelector: () => null, contains: () => true, getBoundingClientRect: () => ({ top: 0, left: 0, width: 1000, height: 800 }),
    scrollTo: noop, addEventListener: noop, removeEventListener: noop };
  const window = { devicePixelRatio: 4, requestAnimationFrame: callback => { callback(); return 1; }, cancelAnimationFrame: noop,
    setTimeout, clearTimeout, matchMedia: () => ({ matches: true }), location: { origin: "http://synthetic.test" } };
  const effect = (operation, deps) => { const index = effectIndex++, previous = effects[index];
    effects[index] = { operation, deps, previousDeps: previous?.previousDeps, cleanup: previous?.cleanup }; };
  const scope = { ...policy, ...registry, window, document: {}, UIEvent: class {},
    usePreferences: () => ({ resolvedLocale: "en-US" }),
    useState: initial => { const key = stateNames[stateIndex++]; assert.ok(key, "named state");
      if (!states.has(key)) states.set(key, Object.hasOwn(overrides, key) ? overrides[key] : typeof initial === "function" ? initial() : initial);
      return [states.get(key), value => { states.set(key, typeof value === "function" ? value(states.get(key)) : value); }]; },
    useRef: initial => { const key = refNames[refIndex++]; if (!refs.has(key)) refs.set(key, { current: key === "canvasRef" ? canvas : /hostRef|viewportRef|rootRef/.test(key) ? element : initial }); return refs.get(key); },
    useEffect: effect, useLayoutEffect: effect, useMemo: operation => operation(), useCallback: operation => operation,
    createPortal: children => children, retryableUrl: url => url, inspectJsonComplexity: () => ({ valid: true }),
    useVirtualizer: () => ({ getVirtualItems: () => [], getTotalSize: () => 0, scrollToIndex: noop }),
    readPreviewText: async () => "{}", loadPdfJs: async () => ({ version: "synthetic", getDocument: () => ({ promise: Promise.resolve({ numPages: 4 }), destroy: async () => {} }) }),
    MAX_SOURCE_BYTES: 50 * 1024 * 1024, withAttempt: url => url, presentationMetrics: () => null,
    readPreviewBytes: async () => new ArrayBuffer(1), crypto: { randomUUID: () => "synthetic-request" },
    ResizeObserver: class { observe() {} disconnect() {} }, IntersectionObserver: class { observe() {} disconnect() {} },
  };
  for (const child of ["ViewerError", "ComplexError", "DocumentView", "SpreadsheetView", "PresentationView", "ArchiveView", "ModeButton", "PdfPage", "PdfThumbnail", "PdfPageList", "PdfThumbnailRail", "ImageViewer", "TextualViewer", "JsonViewer", "MediaViewer", "PdfViewer", "ComplexAttachmentViewer", "Suspense", "Loader2", "ZoomIn", "ZoomOut", "ChevronLeft", "ChevronRight", "PanelLeftOpen", "PanelLeftClose", "RotateCcw"]) scope[child] = child;
  Object.assign(scope, extra);
  const component = compile(declaration.getText(componentSource), scope, name);
  const render = () => { stateIndex = refIndex = effectIndex = 0; return component(props); };
  return { render, states, refs, canvas, scope,
    runEffects: async () => { for (const item of effects) {
      if (item.previousDeps && item.deps?.every((value, index) => Object.is(value, item.previousDeps[index]))) continue;
      item.cleanup?.(); item.previousDeps = item.deps; item.cleanup = item.operation();
    } await flush(); }, dispose: () => { for (const item of effects) item.cleanup?.(); } };
}

test("PDF page canvas has an area and edge budget at high zoom/DPR", async () => {
  const page = { getViewport: ({ scale }) => ({ width: 2000 * scale, height: 3000 * scale }), render: () => ({ promise: Promise.resolve(), cancel: noop }), cleanup: noop };
  const f = fixture("PdfPage", { documentProxy: { getPage: async () => page }, pageNumber: 1, fitMode: "custom", zoom: 4,
    containerWidth: 1000, containerHeight: 800, renderQueue: policy.createPdfRenderQueue?.(), onScaleChange: noop });
  try { f.render(); await f.runEffects(); f.render(); await f.runEffects();
    assert.ok(f.canvas.width > 0); assert.ok(f.canvas.width * f.canvas.height <= 4 * 1024 * 1024); assert.ok(Math.max(f.canvas.width, f.canvas.height) <= 4096);
  } finally { f.dispose(); }
});
test("PDF failed page exposes a local retry instead of an empty canvas", async () => {
  const f = fixture("PdfPage", { documentProxy: { getPage: async () => { throw new Error("Synthetic page read failed"); } }, pageNumber: 2,
    fitMode: "page", zoom: 1, containerWidth: 1000, containerHeight: 800, renderQueue: policy.createPdfRenderQueue?.(), onScaleChange: noop });
  try { f.render(); await f.runEffects(); const errors = named(f.render(), "ViewerError"); assert.equal(errors.length, 1); assert.equal(typeof errors[0].props.onRetry, "function"); } finally { f.dispose(); }
});
test("closing PDF before the lazy module arrives does not start a document request", async () => {
  let resolveImport, requests = 0;
  const delayed = new Promise(resolve => { resolveImport = resolve; });
  const f = fixture("PdfViewer", { attachment, toolbarHost: null, onPageCountChange: noop }, {}, { loadPdfJs: () => delayed });
  f.render(); await f.runEffects(); f.dispose();
  resolveImport({ version: "synthetic", getDocument: () => { requests += 1; return { promise: Promise.resolve({ numPages: 4 }), destroy: async () => {} }; } });
  await flush(); assert.equal(requests, 0);
});
test("PDF direct page entry is a labelled input", () => {
  const f = fixture("PdfViewer", { attachment, toolbarHost: {}, onPageCountChange: noop }, { documentProxy: { numPages: 1000 } });
  const input = named(f.render(), "input").find(node => node.props["aria-label"] && node.props.inputMode === "numeric");
  assert.ok(input, "direct page entry must be present without opening another dialog");
});
test("JSON transport failure has retry and is not called complex JSON", async () => {
  const f = fixture("JsonViewer", { attachment: { ...attachment, display_name: "synthetic.json" } }, {}, { readPreviewText: async () => { throw new Error("Synthetic unavailable"); } });
  try { f.render(); await f.runEffects(); const errors = named(f.render(), "ViewerError"); assert.equal(errors.length, 1); assert.equal(typeof errors[0].props.onRetry, "function"); } finally { f.dispose(); }
});
test("JSON Raw retains its format/source controls", () => {
  const f = fixture("JsonViewer", { attachment }, { text: '{"synthetic":true}', raw: true });
  assert.equal(named(f.render(), "ModeButton").length, 2);
});
for (const [label, kind, content] of [["unsupported", null, "/api/synthetic-binary"], ["missing", "pdf", null], ["empty", "text", "/api/synthetic-empty"]]) {
  test(label + " attachment does not mount a false text/PDF reader", () => {
    const f = fixture("ViewerBody", { attachment: { ...attachment, content_url: content, asset_object: { byte_size: label === "empty" ? 0 : 100 } }, kind,
      mode: null, session: { permissions: { downloadOriginal: false } } });
    const root = f.render(); assert.equal(root.type, "ViewerError"); assert.equal(root.props.downloadUrl, undefined);
  });
}
test("gallery next reads the latest selected item on every key press", () => {
  let activeKey = "a";
  const next = compile(fn("setActiveIndex").getText(source), { session: { items: ["a", "b", "c"].map(itemKey => ({ itemKey })) },
    index: 0, activeKey: "a", setMode: noop, setActiveKey: update => { activeKey = typeof update === "function" ? update(activeKey) : update; } }, "setActiveIndex");
  next(1); assert.equal(activeKey, "b"); next(1); assert.equal(activeKey, "c"); next(1); assert.equal(activeKey, "a");
});
for (const [label, event] of [["browser zoom", { key: "+", ctrlKey: true }], ["editable input", { key: "ArrowRight", target: { closest: () => ({}) } }], ["handled key", { key: "ArrowRight", defaultPrevented: true }]]) {
  test("viewer shortcut leaves " + label + " alone", () => {
    const effect = find(node => ts.isCallExpression(node) && node.expression.getText(source) === "useEffect" && node.arguments[0]?.getText(source).includes("acquireViewerScrollLock();"));
    let handler, actions = 0;
    const document = { addEventListener: (_, callback) => { handler = callback; }, removeEventListener: noop, querySelector: () => ({ click: () => { actions += 1; } }) };
    const scope = { ...policy, document, session: { items: [{ itemKey: "a" }, { itemKey: "b" }] },
      dialogRef: { current: { contains: () => true, querySelector: document.querySelector } },
      acquireViewerScrollLock: noop, releaseViewerScrollLock: noop, setActiveIndex: () => { actions += 1; }, useEffect: operation => operation() };
    compile(effect.getText(source) + ";", scope, "undefined");
    handler({ preventDefault: noop, stopPropagation: noop, target: { closest: () => null }, ...event }); assert.equal(actions, 0);
  });
}

for (const name of ["retryableUrl", "withAttempt"]) {
  test(name + " preserves real Blob URLs on retry", async () => {
    const declaration = name === "withAttempt" ? complexFn(name) : fn(name);
    const retry = compile(declaration.getText(declaration.getSourceFile()), { window: { location: { origin: "http://synthetic.test" } } }, name);
    const url = URL.createObjectURL(new Blob(["Synthetic offline attachment"]));
    try {
      const retried = retry(url, 1);
      assert.equal(retried, url);
      assert.equal(await (await fetch(retried)).text(), "Synthetic offline attachment");
    } finally { URL.revokeObjectURL(url); }
  });
}

test("complex worker startup failure offers recovery without starting the byte read", async () => {
  let reads = 0;
  const f = fixture("ComplexAttachmentViewer", { attachment, kind: "document", onPresentationMetrics: noop }, {}, {
    Worker: class { constructor() { throw new Error("Synthetic unsupported worker"); } },
    readPreviewBytes: async () => { reads += 1; return new ArrayBuffer(1); },
  });
  try {
    f.render(); await f.runEffects();
    const errors = named(f.render(), "ComplexError");
    assert.equal(errors.length, 1); assert.equal(typeof errors[0].props.onRetry, "function"); assert.equal(reads, 0);
  } finally { f.dispose(); }
});

test("complex preview worker has a stable diagnostic identity independent of module bundling", async () => {
  let options;
  const f = fixture("ComplexAttachmentViewer", { attachment, kind: "document", onPresentationMetrics: noop }, {}, {
    Worker: class { constructor(_url, value) { options = value; } terminate() {} postMessage() {} },
  });
  try {
    f.render(); await f.runEffects();
    assert.equal(options.name, "chat-reader-attachment-preview");
  } finally { f.dispose(); }
});

test("closing complex preview ignores late bytes and stale worker messages", async () => {
  let resolveBytes, worker, posts = 0;
  const pending = new Promise(resolve => { resolveBytes = resolve; });
  const f = fixture("ComplexAttachmentViewer", { attachment, kind: "document", onPresentationMetrics: noop }, {}, {
    Worker: class { constructor() { worker = this; } terminate() {} postMessage() { posts += 1; } }, readPreviewBytes: () => pending,
  });
  f.render(); await f.runEffects(); f.dispose();
  resolveBytes(new ArrayBuffer(1));
  worker.onmessage({ data: { requestId: "synthetic-request", ok: true, result: { kind: "document", paragraphs: ["late"], tables: [] } } });
  await flush(); assert.equal(posts, 0); assert.equal(f.states.get("result"), null);
});

test("PDF page retry reads again and releases the displayed bitmap on unmount", async () => {
  let reads = 0, renders = 0, cleaned = 0;
  const page = { getViewport: ({ scale }) => ({ width: 612 * scale, height: 792 * scale }), render: () => { renders += 1; return { promise: Promise.resolve(), cancel: noop }; }, cleanup: () => { cleaned += 1; } };
  const f = fixture("PdfPage", { documentProxy: { getPage: async () => { reads += 1; if (reads === 1) throw new Error("synthetic failure"); return page; } }, pageNumber: 1, fitMode: "page", zoom: 1, containerWidth: 1000, containerHeight: 800, renderQueue: policy.createPdfRenderQueue() });
  f.render(); await f.runEffects();
  named(f.render(), "ViewerError")[0].props.onRetry();
  f.render(); await f.runEffects();
  assert.equal(f.states.get("error"), false); assert.equal(renders, 1); assert.equal(reads, 2); assert.ok(f.canvas.width > 0);
  f.dispose(); await flush(); assert.equal(f.canvas.width, 0); assert.equal(f.canvas.height, 0); assert.equal(cleaned, 1);
});

test("PDF resizing waits for the cancelled render before reusing its canvas", async () => {
  let finishFirst, renders = 0, cancelled = 0;
  const first = new Promise(resolve => { finishFirst = resolve; });
  const page = { getViewport: ({ scale }) => ({ width: 612 * scale, height: 792 * scale }), cleanup: noop,
    render: () => { renders += 1; return { promise: renders === 1 ? first : Promise.resolve(), cancel: () => { cancelled += 1; } }; } };
  const props = { documentProxy: { getPage: async () => page }, pageNumber: 1, fitMode: "custom", zoom: 1, containerWidth: 1000, containerHeight: 800, renderQueue: policy.createPdfRenderQueue() };
  const f = fixture("PdfPage", props);
  try {
    f.render(); await f.runEffects(); assert.equal(renders, 1);
    props.zoom = 2; f.render(); await f.runEffects(); assert.equal(cancelled, 1); assert.equal(renders, 1);
    finishFirst(); await flush(); assert.equal(renders, 2); assert.equal(f.canvas.style.width, "1224px");
  } finally { finishFirst(); f.dispose(); await flush(); }
});

test("PDF unmount during page fetch never starts a late canvas render", async () => {
  let resolvePage, renders = 0;
  const pending = new Promise(resolve => { resolvePage = resolve; });
  const f = fixture("PdfPage", { documentProxy: { getPage: () => pending }, pageNumber: 1, fitMode: "page", zoom: 1, containerWidth: 1000, containerHeight: 800, renderQueue: policy.createPdfRenderQueue() });
  f.render(); await f.runEffects(); f.dispose();
  resolvePage({ getViewport: ({ scale }) => ({ width: 612 * scale, height: 792 * scale }), cleanup: noop, render: () => { renders += 1; return { promise: Promise.resolve(), cancel: noop }; } });
  await flush(); assert.equal(renders, 0); assert.equal(f.canvas.width, 0);
});

test("PDF thumbnail failure retains a selectable page number", async () => {
  const f = fixture("PdfThumbnail", { documentProxy: { getPage: async () => { throw new Error("synthetic failed thumbnail"); } }, pageNumber: 20, active: false, onClick: noop, renderQueue: policy.createPdfRenderQueue() });
  try {
    f.render(); await f.runEffects(); const root = f.render();
    assert.equal(root.type, "button"); assert.equal(root.props.onClick, noop); assert.equal(root.props["aria-label"], "打开 PDF 第 20 页"); assert.equal(f.states.get("failed"), true);
  } finally { f.dispose(); }
});

test("continuous PDF keeps the final page selected when its top cannot reach the viewport top", async () => {
  const { Virtualizer } = appRequire("@tanstack/react-virtual");
  let onScroll, visiblePage;
  const root = { clientWidth: 375, clientHeight: 640, scrollTop: 0, scrollHeight: 0,
    addEventListener: (name, callback) => { if (name === "scroll") onScroll = callback; }, removeEventListener: noop };
  let virtualizer;
  const f = fixture("PdfPageList", { documentProxy: { numPages: 120 }, currentPage: 120, scrollRequest: { page: 120 },
    onVisiblePageChange: page => { visiblePage = page; }, fitMode: "width", zoom: 1, containerWidth: 375, containerHeight: 640,
    viewportRef: { current: root }, pageSizesRef: { current: new Map([[120, { width: 792, height: 240 }]]) },
    renderQueue: policy.createPdfRenderQueue(), onPageSize: noop }, {}, {
    useVirtualizer: options => virtualizer ??= new Virtualizer({ ...options, getScrollElement: () => null,
      initialRect: { width: 375, height: 640 }, observeElementRect: noop, observeElementOffset: noop, scrollToFn: noop }),
  });
  try {
    f.render(); await f.runEffects();
    root.scrollHeight = virtualizer.getTotalSize();
    root.scrollTop = root.scrollHeight - root.clientHeight;
    virtualizer.scrollOffset = root.scrollTop;
    assert.ok(virtualizer.getVirtualItemForOffset(root.scrollTop + 16).index < 119, "the short final page is genuinely scroll-clamped");
    onScroll(); assert.equal(visiblePage, 120);
    root.scrollTop = 0; onScroll(); assert.equal(visiblePage, 1, "scrolling back still follows the visible page");
  } finally { f.dispose(); }
});

for (const width of [375, 1267]) for (const round of [Math.floor, Math.round]) {
  test(`continuous PDF keeps fractional page alignment at ${width}px with ${round.name} scrolling`, async () => {
    const { Virtualizer } = appRequire("@tanstack/react-virtual");
    let onScroll, visiblePage, virtualizer, nextFrame;
    const root = { clientWidth: width, clientHeight: 730, scrollTop: 0, scrollHeight: 200000,
      addEventListener: (name, callback) => { if (name === "scroll") onScroll = callback; }, removeEventListener: noop };
    const props = { documentProxy: { numPages: 120 }, currentPage: 90, scrollRequest: { page: 90 },
      onVisiblePageChange: page => { visiblePage = page; }, fitMode: "width", zoom: 1, containerWidth: width, containerHeight: 730,
      viewportRef: { current: root }, pageSizesRef: { current: new Map([[90, { width: 792, height: 612 }]]) },
      renderQueue: policy.createPdfRenderQueue(), onPageSize: noop };
    const f = fixture("PdfPageList", props, {}, {
      useVirtualizer: options => {
        if (!virtualizer) {
          virtualizer = new Virtualizer({ ...options, initialRect: { width, height: 730 }, observeElementRect: noop, observeElementOffset: noop,
            scrollToFn: (offset, { adjustments = 0 }) => { root.scrollTop = round(offset + adjustments); virtualizer.scrollOffset = root.scrollTop; } });
          virtualizer.scrollElement = root;
          virtualizer.targetWindow = { requestAnimationFrame: callback => { nextFrame = callback; return 1; }, cancelAnimationFrame: noop };
        } else virtualizer.setOptions({ ...virtualizer.options, ...options });
        return virtualizer;
      },
    });
    const settle = async () => {
      // Pump actual Virtualizer reconciliation after the hook double's render;
      // observing its intermediate old measurements would not model a browser.
      for (let tick = 0; tick < 4; tick++) {
        f.render(); await f.runEffects();
        f.render(); await f.runEffects();
        const callback = nextFrame; nextFrame = undefined; callback?.();
      }
      assert.equal(virtualizer.scrollState, null, "real virtualizer alignment has settled");
    };
    const assertPageAndRealScroll = () => {
      onScroll(); assert.equal(visiblePage, 90, "fractional alignment must not select the preceding page");
      const target = virtualizer.getMeasurements()[89], next = virtualizer.getMeasurements()[90];
      assert.ok(root.scrollTop + 16 < target.start + 1 && root.scrollTop + 16 > target.start - 1);
      root.scrollTop = Math.floor(target.start - 16) - 2;
      onScroll(); assert.equal(visiblePage, 89, "genuine backward scrolling still updates the page");
      root.scrollTop = Math.ceil(next.start - 16) + 2;
      onScroll(); assert.equal(visiblePage, 91, "genuine forward scrolling still updates the page");
      root.scrollTop = 0;
      onScroll(); assert.equal(visiblePage, 1, "the first page is not pinned to the selected page");
    };
    try {
      await settle(); assertPageAndRealScroll();
      props.fitMode = "custom"; props.zoom = 1.1;
      await settle(); assertPageAndRealScroll();
      props.containerWidth = width + 55; props.containerHeight = 640;
      await settle(); assertPageAndRealScroll();
      props.scrollRequest = { page: 90 };
      await settle(); assertPageAndRealScroll();
    } finally { f.dispose(); }
  });
}

// Exercise the actual browser test's injector with explicit DOM/canvas doubles.
// This is not a browser click or a real PDF render.
function pdfPageFailureInjector() {
  const e2e = ts.createSourceFile("pdfjs-migration.spec.ts", readFileSync(new URL("../../apps/web/e2e/pdfjs-migration.spec.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let init;
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(e2e) === "page.addInitScript" && node.arguments[0]?.getText(e2e).includes("Synthetic PDF canvas failure")) init = node.arguments[0].getText(e2e);
    ts.forEachChild(node, visit);
  };
  visit(e2e); assert.ok(init);
  const listeners = new Map(), window = {};
  class Element {
    constructor(pageNumber = 1, textContent = "重试") { this.pageNumber = pageNumber; this.textContent = textContent; }
    closest(selector) { return selector === "button" || (selector === '[data-pdf-page="1"]' && this.pageNumber === 1) ? this : null; }
  }
  class Canvas extends Element { getContext() { return {}; } }
  const document = { addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: name => listeners.delete(name) };
  compile(`const install = ${init};`, { HTMLCanvasElement: Canvas, Element, window, document }, "install")();
  return { Canvas, window, click: (pageNumber = 1, label = "重试", isTrusted = true) => listeners.get("click")?.({ target: new Element(pageNumber, label), isTrusted }) };
}

test("PDF browser fault stays page-local until a real Retry click on that page", () => {
  const fault = pdfPageFailureInjector();
  const first = new fault.Canvas(1), second = new fault.Canvas(2);
  assert.throws(() => first.getContext("2d"), /Synthetic PDF canvas failure/);
  assert.doesNotThrow(() => second.getContext("2d"));
  for (const click of [() => fault.click(2), () => fault.click(1, "关闭"), () => fault.click(1, "重试", false)]) {
    click(); assert.throws(() => first.getContext("2d"), /Synthetic PDF canvas failure/, "unrelated or synthetic clicks must not release the outage");
  }
  fault.click(); assert.doesNotThrow(() => first.getContext("2d"));
  assert.equal(fault.window.__pdfPageFailureTest.retryClicks, 1);
  assert.equal(fault.window.__pdfPageFailureTest.failedAttempts, 4);
});

test("PDF persistent canvas failure survives resize then actual component Retry recovers", async () => {
  const fault = pdfPageFailureInjector();
  let renders = 0, completed = 0;
  const page = { getViewport: ({ scale }) => ({ width: 612 * scale, height: 792 * scale }), cleanup: noop,
    render: ({ canvas }) => { renders++; canvas.getContext("2d"); completed++; return { promise: Promise.resolve(), cancel: noop }; } };
  const props = { documentProxy: { getPage: async () => page }, pageNumber: 1, fitMode: "page", zoom: 1,
    containerWidth: 1230, containerHeight: 720, renderQueue: policy.createPdfRenderQueue() };
  const f = fixture("PdfPage", props);
  Object.setPrototypeOf(f.canvas, fault.Canvas.prototype); f.canvas.pageNumber = 1;
  try {
    f.render(); await f.runEffects(); assert.equal(f.states.get("error"), true);
    props.containerHeight = 722;
    f.render(); await f.runEffects(); assert.equal(f.states.get("error"), true); assert.equal(completed, 0);
    fault.click(); named(f.render(), "ViewerError")[0].props.onRetry();
    f.render(); await f.runEffects(); assert.equal(f.states.get("error"), false); assert.equal(completed, 1); assert.equal(renders, 3);
    assert.ok(f.canvas.width > 0); assert.equal(fault.window.__pdfPageFailureTest.retryClicks, 1);
  } finally { f.dispose(); await flush(); }
});

test("direct PDF entry changes page only after submission and validates without jumping", () => {
  const f = fixture("PdfViewer", { attachment, toolbarHost: {}, onPageCountChange: noop }, { documentProxy: { numPages: 1000 }, currentPage: 12 });
  const input = () => named(f.render(), "input")[0];
  input().props.onChange({ target: { value: "5" } }); assert.equal(f.states.get("currentPage"), 12);
  input().props.onChange({ target: { value: "500" } }); assert.equal(f.states.get("currentPage"), 12);
  named(f.render(), "form")[0].props.onSubmit({ preventDefault: noop }); assert.equal(f.states.get("currentPage"), 500); assert.equal(f.states.get("scrollRequest").page, 500);
  for (const value of ["0", "1001", "50foo", "1.5"]) {
    input().props.onChange({ target: { value } }); named(f.render(), "form")[0].props.onSubmit({ preventDefault: noop });
    assert.equal(f.states.get("currentPage"), 500); assert.equal(f.states.get("pageInputError"), true);
  }
});

test("PDF fit and zoom retain the selected page and zoom from the actual fit scale", () => {
  const f = fixture("PdfViewer", { attachment, toolbarHost: {}, onPageCountChange: noop }, { documentProxy: { numPages: 1000 }, currentPage: 50, fitMode: "width", zoom: 1, viewportSize: { width: 1000, height: 800 } });
  f.render(); f.refs.get("pageSizesRef").current.set(50, { width: 612, height: 792 });
  const zoomOut = named(f.render(), "button").find(node => node.props["aria-label"] === "缩小 PDF");
  assert.equal(zoomOut.props.disabled, false); zoomOut.props.onClick();
  assert.ok(Math.abs(f.states.get("zoom") - (968 / 612 - 0.1)) < 1e-8);
  assert.equal(f.states.get("scrollRequest").page, 50); assert.equal(f.states.get("currentPage"), 50);
  named(f.render(), "ModeButton").find(node => node.props.children === "Fit page").props.onClick();
  assert.equal(f.states.get("currentPage"), 50); assert.equal(f.states.get("fitMode"), "page");
});

test("continuous PDF and thumbnail components hand bounded ranges to the installed virtualizer", () => {
  const { Virtualizer } = appRequire("@tanstack/react-virtual");
  const actualVirtualizer = options => new Virtualizer({ ...options, initialRect: { width: 1000, height: 800 }, observeElementRect: noop, observeElementOffset: noop, scrollToFn: noop });
  const props = { documentProxy: { numPages: 5000 }, currentPage: 1, scrollRequest: { page: 1 }, onVisiblePageChange: noop, fitMode: "width", zoom: 1,
    containerWidth: 1000, containerHeight: 800, viewportRef: { current: null }, pageSizesRef: { current: new Map() }, renderQueue: policy.createPdfRenderQueue(), onPageSize: noop, onSelect: noop };
  const pages = fixture("PdfPageList", props, {}, { useVirtualizer: actualVirtualizer });
  assert.ok(named(pages.render(), "PdfPage").length > 0); assert.ok(named(pages.render(), "PdfPage").length <= 4);
  const thumbs = fixture("PdfThumbnailRail", props, {}, { useVirtualizer: actualVirtualizer });
  assert.ok(named(thumbs.render(), "PdfThumbnail").length > 0); assert.ok(named(thumbs.render(), "PdfThumbnail").length <= 8);
});

test("PDF document loading retains ranged HTTP policy and destroys the session on close", async () => {
  let options, destroyed = 0;
  const f = fixture("PdfViewer", { attachment, toolbarHost: null, onPageCountChange: noop }, {}, {
    loadPdfJs: async () => ({ version: "synthetic", getDocument: value => { options = value; return { promise: Promise.resolve({ numPages: 2 }), destroy: async () => { destroyed += 1; } }; } }),
  });
  f.render(); await f.runEffects();
  assert.equal(options.disableStream, true); assert.equal(options.disableAutoFetch, true); assert.equal(options.rangeChunkSize, 64 * 1024); assert.equal(options.useWasm, false);
  f.dispose(); await flush(); assert.equal(destroyed, 1);
});

for (const name of ["TextualViewer", "JsonViewer"]) {
  test(name + " ignores a successful read received after closure", async () => {
    let resolveRead; const pending = new Promise(resolve => { resolveRead = resolve; });
    const f = fixture(name, { attachment, mode: "source", onModeChange: noop }, {}, { readPreviewText: () => pending });
    f.render(); await f.runEffects(); f.dispose(); resolveRead("synthetic late content"); await flush(); assert.equal(f.states.get("text"), null);
  });
  test(name + " retries a failed read without changing the original source", async () => {
    let reads = 0; const original = '  {"synthetic":true}\n';
    const f = fixture(name, { attachment, mode: "source", onModeChange: noop }, {}, { readPreviewText: async () => { reads += 1; if (reads === 1) throw new Error("synthetic outage"); return original; } });
    try {
      f.render(); await f.runEffects(); named(f.render(), "ViewerError")[0].props.onRetry(); f.render(); await f.runEffects();
      assert.equal(f.states.get("text"), original); assert.equal(f.states.get("error"), false); assert.equal(reads, 2);
    } finally { f.dispose(); }
  });
}

test("JSON source mode returns to formatting and malformed JSON remains readable", () => {
  const f = fixture("JsonViewer", { attachment }, { text: '{"synthetic":true}' });
  named(f.render(), "ModeButton")[1].props.onClick(); assert.equal(named(f.render(), "pre")[0].props.children, '{"synthetic":true}');
  named(f.render(), "ModeButton")[0].props.onClick(); assert.equal(named(f.render(), "pre")[0].props.children, '{\n  "synthetic": true\n}');
  f.states.set("text", "{ incomplete synthetic");
  assert.equal(named(f.render(), "ViewerError").length, 0); assert.equal(named(f.render(), "pre")[0].props.children, "{ incomplete synthetic");
});

test("every renderer receives the session's original-download restriction", () => {
  for (const kind of ["image", "markdown", "text", "code", "json", "table", "audio", "video", "pdf", "document", "spreadsheet", "presentation", "archive"]) {
    const f = fixture("ViewerBody", { attachment, kind, mode: null, session: { permissions: { downloadOriginal: false } } });
    const renderer = nodes(f.render()).find(node => node.props?.attachment);
    assert.ok(renderer, kind); assert.equal(renderer.props.attachment.download_url, null, kind); assert.equal(attachment.download_url, "/api/synthetic-download");
  }
});

for (const audio of [true, false]) test((audio ? "audio" : "video") + " retains native low-cost controls and explicit codec recovery", async () => {
  const f = fixture("MediaViewer", { attachment: { ...attachment, declared_mime_type: audio ? "audio/aac" : "video/mp4" }, audio, onMediaDimensions: noop });
  try {
    const media = named(f.render(), audio ? "audio" : "video")[0];
    assert.equal(media.props.controls, true); assert.equal(media.props.preload, "metadata"); assert.equal(media.props.autoPlay, undefined);
    if (!audio) assert.equal(media.props.playsInline, true);
    media.props.onError({ currentTarget: { canPlayType: () => "" } });
    assert.equal(f.states.get("failure"), "unsupported");
    const error = named(f.render(), "ViewerError")[0]; assert.equal(typeof error.props.onRetry, "function");
    error.props.onRetry(); f.render(); await f.runEffects(); assert.equal(named(f.render(), audio ? "audio" : "video").length, 1);
  } finally { f.dispose(); }
});
