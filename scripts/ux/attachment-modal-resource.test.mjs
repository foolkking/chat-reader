import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

const appRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = appRequire("typescript");
const read = path => readFileSync(new URL(`../../apps/web/${path}`, import.meta.url), "utf8");
const compile = source => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const all = node => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(all) : [node, ...all(node.props?.children)];
const find = (tree, type) => all(tree).find(node => node.type === type);
const Drawer = Object.fromEntries(["Root", "Portal", "Overlay", "Content", "Title"].map(name => [name, `drawer-${name}`]));
const noop = () => {};

// Execute the production component with hook/JSX doubles. This proves props and
// event ownership, not native inert, focus trapping, pointer routing or scroll.
function sheet(viewerOpen, props = {}) {
  const exports = {};
  const react = { useEffect: noop, useRef: value => ({ current: value }), useState: value => [value, noop] };
  new Function("exports", "require", compile(read("components/mobile-reader-sheet.tsx")))(exports, name => {
    if (name === "react") return react;
    if (name === "vaul") return { Drawer };
    if (name.endsWith("attachment-viewer-state")) return { useAttachmentViewerOpen: () => viewerOpen };
    return appRequire(name);
  });
  return exports.MobileReaderSheet({ open: true, title: "Synthetic files", onOpenChange: noop, children: "retained files", ...props });
}

test("an open attachment suspends drawer interaction without removing its content", () => {
  const content = find(sheet(true), Drawer.Content);
  assert.ok(content); assert.equal(content.props.inert, true); assert.equal(content.props["aria-hidden"], true);
  assert.ok(all(content).some(node => node.props?.children === "retained files"));
});

test("a suspended drawer releases only its Overlay-owned scroll lock", () => {
  assert.equal(find(sheet(true), Drawer.Overlay), undefined);
  assert.ok(find(sheet(false), Drawer.Overlay));
  assert.equal(find(sheet(true), Drawer.Root).props.modal, true);
  assert.equal(find(sheet(false), Drawer.Root).props.modal, true);
});

test("retained sheet content stays above its remounted scrim regardless of portal insertion order", () => {
  const reopened = sheet(false);
  const layer = node => {
    const classes = node.props.className.split(/\s+/);
    const value = classes.map(name => /^(?:z-(\d+)|z-\[(\d+)\])$/.exec(name)).find(Boolean);
    assert.ok(value, "Each modal surface declares an explicit stacking level");
    return Number(value[1] ?? value[2]);
  };
  assert.ok(layer(find(reopened, Drawer.Content)) > layer(find(reopened, Drawer.Overlay)),
    "A later-mounted transparent Overlay cannot cover the retained file controls");
});

test("returning from an attachment re-enables the same drawer structure and child identity", () => {
  const child = { type: "synthetic-files", props: {} };
  const before = sheet(false, { children: child }), during = sheet(true, { children: child }), after = sheet(false, { children: child });
  for (const tree of [before, during, after]) {
    assert.equal(find(tree, Drawer.Content).type, Drawer.Content);
    assert.equal(find(tree, Drawer.Content).key, null);
    assert.equal(find(tree, "synthetic-files"), child);
  }
  assert.notEqual(find(after, Drawer.Content).props.inert, true);
  assert.notEqual(find(after, Drawer.Content).props["aria-hidden"], true);
});

for (const handler of ["onPointerDownOutside", "onInteractOutside", "onEscapeKeyDown"]) {
  test(`only the foreground Viewer owns ${handler} while open`, () => {
    let prevented = false;
    find(sheet(true), Drawer.Content).props[handler]?.({ preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
    prevented = false;
    find(sheet(false), Drawer.Content).props[handler]?.({ preventDefault: () => { prevented = true; } });
    assert.equal(prevented, false);
  });
}

test("underlying drawer open-change cannot close the attachment's mounted owner", () => {
  const changes = [];
  find(sheet(true, { onOpenChange: value => changes.push(value) }), Drawer.Root).props.onOpenChange(false);
  assert.deepEqual(changes, []);
  find(sheet(false, { onOpenChange: value => changes.push(value) }), Drawer.Root).props.onOpenChange(false);
  assert.deepEqual(changes, [false]);
});

test("a drawer unmount cannot restore focus behind the still-open Viewer", () => {
  let restored = 0, prevented = 0;
  const props = { restoreFocus: () => ({ isConnected: true, focus: () => { restored += 1; } }) };
  find(sheet(true, props), Drawer.Content).props.onCloseAutoFocus({ preventDefault: () => { prevented += 1; } });
  assert.equal(restored, 0); assert.equal(prevented, 1);
  find(sheet(false, props), Drawer.Content).props.onCloseAutoFocus({ preventDefault: noop });
  assert.equal(restored, 1);
});

test("a closed mobile sheet still mounts no modal content", () => {
  assert.equal(sheet(false, { open: false }), null); assert.equal(sheet(true, { open: false }), null);
});

const viewerSource = ts.createSourceFile("viewer.tsx", read("features/attachments/attachment-viewer.tsx"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
test("the separately portalled Viewer explicitly accepts pointers under a modal body", () => {
  let root;
  const visit = node => {
    if (ts.isJsxOpeningElement(node) && node.attributes.properties.some(prop => prop.name?.getText(viewerSource) === "data-testid" && prop.initializer?.getText(viewerSource) === '"attachment-viewer-shell"')) root = node;
    ts.forEachChild(node, visit);
  };
  visit(viewerSource); assert.ok(root);
  assert.match(root.attributes.properties.find(prop => prop.name?.getText(viewerSource) === "className").initializer.text, /\bpointer-events-auto\b/);
});

test("Viewer publishes open state separately without changing command context identity", () => {
  const declaration = viewerSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "AttachmentViewerProvider");
  let current = null, memoIndex = 0;
  const memos = [];
  function memo(operation, deps) {
    const index = memoIndex++, old = memos[index];
    if (!old || !deps.every((value, index) => Object.is(value, old.deps[index]))) memos[index] = { value: operation(), deps };
    return memos[index].value;
  }
  const exports = {};
  new Function("exports", "require", "useState", "useCallback", "useMemo", "AttachmentViewerContext", "AttachmentViewerOpenContext", "AttachmentViewerShell", compile(declaration.getText(viewerSource)))(
    exports, appRequire, () => [current, update => { current = typeof update === "function" ? update(current) : update; }],
    (operation, deps) => memo(() => operation, deps), memo,
    { Provider: "commands" }, { Provider: "open-state" }, "viewer-shell",
  );
  const render = () => { memoIndex = 0; return exports.AttachmentViewerProvider({ children: "retained page" }); };
  const closed = render(), commands = find(closed, "commands").props.value;
  assert.equal(find(closed, "open-state")?.props.value, false);
  commands.open({ items: [{ itemKey: "synthetic" }], activeItemKey: "synthetic" });
  const opened = render();
  assert.equal(find(opened, "open-state")?.props.value, true);
  assert.equal(find(opened, "commands").props.value, commands);
  assert.equal(all(opened).filter(node => node.type === "viewer-shell").length, 1);
  commands.close();
  const closedAgain = render();
  assert.equal(find(closedAgain, "open-state")?.props.value, false);
  assert.equal(find(closedAgain, "commands").props.value, commands);
});

const { default: config } = await import(new URL("../../apps/web/next.config.mjs", import.meta.url));
const policy = (await config.headers()).find(rule => rule.source === "/:path*").headers.find(header => header.key === "Content-Security-Policy").value;
const directive = name => policy.split(";").map(value => value.trim()).find(value => value.startsWith(`${name} `));

test("generated document CSP allows same-origin and local Blob reads only", () => {
  assert.equal(directive("connect-src"), "connect-src 'self' blob:");
});
for (const [name, expected] of [["worker-src", "'self'"], ["frame-src", "'none'"], ["object-src", "'none'"], ["script-src-attr", "'none'"]]) {
  test(`Blob reads do not relax ${name}`, () => assert.equal(directive(name), `${name} ${expected}`));
}

const registry = {};
new Function("exports", compile(read("features/attachments/preview-adapter-registry.ts")))(registry);
const capability = (name, detected = "application/zip", declared = null, nestedDetected = null) => registry.resolveAttachmentCapability({
  display_name: name, original_filename: name, detected_mime_type: detected, declared_mime_type: declared,
  asset_object: { detected_mime_type: nestedDetected },
}).viewerKind;

for (const [extension, kind] of [["docx", "document"], ["odt", "document"], ["xlsx", "spreadsheet"], ["ods", "spreadsheet"], ["pptx", "presentation"], ["odp", "presentation"]]) {
  test(`a generic ZIP detector result refines supported .${extension} content`, () => {
    assert.equal(capability(`synthetic.${extension}`), kind);
    assert.equal(capability(`synthetic.${extension.toUpperCase()}`, " Application/ZIP; charset=binary "), kind);
    assert.equal(capability(`synthetic.${extension}`, null, null, "application/zip"), kind);
  });
}
for (const filename of ["synthetic.zip", "synthetic.doc", "synthetic.xls", "synthetic.ppt", "synthetic.docm", "synthetic.bin", "synthetic.zip.exe"]) {
  test(`generic ZIP ${filename} cannot become Office through declared MIME alone`, () => {
    assert.equal(capability(filename, "application/zip", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), "archive");
  });
}
for (const [mime, kind] of [["application/pdf", "pdf"], ["image/png", "image"], ["audio/wav", "audio"], ["video/mp4", "video"]]) {
  test(`a filename cannot override strong detected ${mime}`, () => assert.equal(capability("synthetic.docx", mime), kind));
}

// Real bounded parser and fflate, with only worker messaging doubled. No browser
// worker scheduling or peak-memory measurement is implied by these tests.
async function parseOffice(filename, kind, files) {
  const { strToU8, zipSync } = appRequire("fflate");
  let response;
  const self = { postMessage: value => { response = value; } };
  new Function("exports", "require", "self", compile(read("features/attachments/complex-attachment-worker.ts")))({}, appRequire, self);
  const bytes = zipSync(Object.fromEntries(Object.entries(files).map(([name, contents]) => [name, strToU8(contents)])));
  self.onmessage({ data: { requestId: "synthetic-parser", filename, kind, bytes: bytes.buffer } });
  await setImmediate(); assert.ok(response); return response;
}
test("the actual DOCX parser yields inert paragraph text from a ZIP-backed document", async () => {
  const response = await parseOffice("synthetic.docx", "document", {
    "word/document.xml": "<w:document><w:body><w:p><w:r><w:t>Synthetic &lt;script&gt; text</w:t></w:r></w:p></w:body></w:document>",
  });
  assert.equal(response.ok, true); assert.deepEqual(response.result.paragraphs, ["Synthetic <script> text"]);
});
test("renaming arbitrary ZIP bytes as DOCX cannot claim a readable document", async () => {
  const response = await parseOffice("synthetic.docx", "document", { "notes.txt": "synthetic plain archive" });
  assert.equal(response.ok, false); assert.match(response.error, /word\/document.xml/);
});
test("ordinary ZIP still uses the same read-only directory parser", async () => {
  const response = await parseOffice("synthetic.zip", "archive", { "notes.txt": "synthetic archive text" });
  assert.equal(response.ok, true); assert.equal(response.result.kind, "archive");
  assert.deepEqual(response.result.entries[0].preview, { kind: "text", text: "synthetic archive text" });
});
