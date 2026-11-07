import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
function declaration(file, name) {
  const source = ts.createSourceFile(file, readFileSync(new URL(`../../apps/web/features/attachments/${file}`, import.meta.url), "utf8"),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const node = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(node);
  return node.getText(source);
}
function compile(source, name, scope) {
  const output = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  return new Function("require", "exports", ...Object.keys(scope), `${output}; return ${name};`)(require, {}, ...Object.values(scope));
}
const retryableUrl = compile(declaration("attachment-viewer.tsx", "retryableUrl"), "retryableUrl",
  { window: { location: { origin: "https://synthetic.test" } } });
function nodes(value) {
  if (Array.isArray(value)) return value.flatMap(nodes);
  return value && typeof value === "object" ? [value, ...nodes(value.props?.children)] : [];
}

// Actual component and URL helper, with explicit state/layout/DOM doubles.
// Real decoding, remote permissions and per-frame movement remain browser gates.
for (const url of ["/api/attachments/synthetic/content?scope=preserved", "blob:https://synthetic.test/local-source"]) {
  test(`explicit inline retry reads immediately and preserves source semantics: ${url.startsWith("blob:") ? "Blob" : "HTTP"}`, () => {
    let attempt = 0, state = { status: "failed" }, layout;
    const commits = [], ref = { current: {} };
    const bodyImage = {
      ref, body: { width: 240, height: 630, fullHeight: 4000, foldable: true, adapted: false },
      size: { width: 240, height: 4000 }, expanded: false, setExpanded() {}, lane: { width: 720, height: 900 }, onDecoded() {},
    };
    const component = compile(declaration("attachment-block.tsx", "InlineImage"), "InlineImage", {
      useBodyImage: () => bodyImage,
      useState: () => [attempt, update => { attempt = typeof update === "function" ? update(attempt) : update; }],
      useLayoutEffect: callback => { layout = callback; },
      reconcileReadingViewport: node => commits.push(node),
      normalizeImageDisplayMode: () => "auto", normalizeVisibleCaption: () => "",
      attachmentLocatorAttributes: () => ({}), retryableUrl,
      ImageDisplayControls: "ImageDisplayControls", DownloadButton: "DownloadButton",
      flushSync: callback => callback(), navigateMountedTarget() {}, crypto: { randomUUID: () => "synthetic" },
    });
    const props = { attachment: { id: "synthetic", display_name: "synthetic.png", content_url: url },
      props: {}, onOpen() {}, onRuntime: value => { state = value; }, zh: false, unavailable: false };
    let tree = component(props);
    assert.equal(nodes(tree).find(node => node.type === "img").props.loading, "lazy");
    props.unavailable = true; tree = component(props);
    const retry = nodes(tree).find(node => node.type === "button" && node.props.children === "Retry preview");
    assert.ok(retry);
    retry.props.onClick();
    assert.equal(attempt, 1); assert.deepEqual(state, { status: "idle" });
    props.unavailable = false; tree = component(props);
    const image = nodes(tree).find(node => node.type === "img");
    assert.equal(image.props.loading, "eager");
    if (url.startsWith("blob:")) assert.equal(image.props.src, url);
    else {
      const retried = new URL(image.props.src);
      assert.equal(retried.pathname, "/api/attachments/synthetic/content");
      assert.equal(retried.searchParams.get("scope"), "preserved");
      assert.equal(retried.searchParams.get("viewer_retry"), "1");
    }
    assert.deepEqual(image.props.style, { width: 240, height: 4000 });
    assert.equal(commits.length, 0);
    layout();
    assert.deepEqual(commits, [ref.current], "The commit delegates to the shared viewport owner.");
  });
}

for (const scenario of [
  { name: "virtual hidden reading point", expanded: true, top: -2000, virtual: true, navigate: true },
  { name: "ordinary hidden reading point", expanded: true, top: -2000, virtual: false, navigate: true },
  { name: "surviving reading point", expanded: true, top: -4100, virtual: true, navigate: false },
  { name: "expansion", expanded: false, top: 120, virtual: true, navigate: false },
]) {
  test(`fold action uses the existing owner and only pins its real hidden target: ${scenario.name}`, () => {
    const navigation = [], changes = [];
    let flushing = false;
    const root = { getBoundingClientRect: () => ({ top: 0 }) };
    const element = { id: "attachment-occurrence-synthetic", getBoundingClientRect: () => ({ top: scenario.top }),
      closest: selector => ({
        '[data-reader-scroll-root="true"]': root,
        "[data-block-index]": { dataset: { blockIndex: "6" } },
        "article[data-message-id]": { dataset: { messageId: "synthetic-message" } },
        '[data-virtualized-block-list="true"]': scenario.virtual ? {} : null,
      })[selector] ?? null,
    };
    const component = compile(declaration("attachment-block.tsx", "InlineImage"), "InlineImage", {
      useBodyImage: () => ({
        ref: { current: element }, body: { width: 240, height: scenario.expanded ? 4000 : 630, fullHeight: 4000, foldable: true },
        size: { width: 240, height: 4000 }, expanded: scenario.expanded, lane: { width: 720, height: 900 },
        setExpanded: value => { assert.equal(flushing, true); changes.push(value); },
      }),
      useState: () => [0, () => {}], useLayoutEffect() {},
      normalizeImageDisplayMode: () => "auto", normalizeVisibleCaption: () => "",
      attachmentLocatorAttributes: () => ({}), retryableUrl,
      ImageDisplayControls: "ImageDisplayControls", DownloadButton: "DownloadButton",
      flushSync: operation => { flushing = true; try { operation(); } finally { flushing = false; } },
      navigateMountedTarget: options => {
        assert.equal(flushing, true);
        navigation.push(options); options.commitLayout(); return Promise.resolve({ ok: true });
      },
    });
    const tree = component({ attachment: { id: "synthetic", display_name: "synthetic.png", content_url: "/synthetic" },
      props: {}, onOpen() {}, onRuntime() {}, zh: false, unavailable: false });
    const toggle = nodes(tree).find(node => node.type === "button" && node.props.children === (scenario.expanded ? "Collapse image" : "Expand full image"));
    toggle.props.onClick();
    assert.deepEqual(changes, [!scenario.expanded]);
    assert.equal(navigation.length, scenario.navigate ? 1 : 0);
    if (scenario.navigate) {
      const options = navigation[0];
      assert.equal(options.targetId, element.id); assert.equal(options.root, root);
      assert.equal(options.offset, 120); assert.equal(options.alignmentTolerance, 1);
      assert.deepEqual(options.virtualBlock, scenario.virtual ? { messageId: "synthetic-message", blockIndex: 6 } : undefined);
    }
  });
}
