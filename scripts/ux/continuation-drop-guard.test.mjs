import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

const appRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const React = appRequire("react"), ts = appRequire("typescript");
const noop = () => {};
const same = (a, b) => a && b && a.length === b.length && a.every((item, index) => Object.is(item, b[index]));

// Execute the complete, actual TSX callbacks. Hook/render/effect timing, query
// data, persistence, transport and portals are explicit doubles. In particular,
// withholding passive effects models the guard's safety boundary; it does not
// assert that this was the exact scheduler sequence of the CI failure.
function runtime(file, mocks, window) {
  let cursor = 0, tree;
  const hooks = [], pending = new Map();
  const hook = initial => { const index = cursor++; if (!hooks[index]) hooks[index] = initial(); return hooks[index]; };
  const react = { ...React,
    useState: initial => { const entry = hook(() => ({ value: typeof initial === "function" ? initial() : initial }));
      return [entry.value, value => { entry.value = typeof value === "function" ? value(entry.value) : value; }]; },
    useRef: initial => hook(() => ({ current: initial })),
    useCallback: (fn, deps) => { const entry = hook(() => ({})); if (!same(entry.deps, deps)) Object.assign(entry, { value: fn, deps }); return entry.value; },
    useEffect: (fn, deps) => { const index = cursor, entry = hook(() => ({}));
      if (!same(entry.deps, deps)) { pending.set(index, fn); entry.deps = deps; } },
  };
  const compiled = ts.transpileModule(readFileSync(new URL(`../../apps/web/features/exporting/${file}.tsx`, import.meta.url), "utf8"), {
    fileName: `${file}.tsx`, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", "window", "navigator", "document", compiled)(name => {
    if (name === "react") return react;
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith(".")) throw new Error(`Unexpected dependency: ${name}`);
    return appRequire(name);
  }, module, module.exports, window, { onLine: true }, { body: {} });
  return {
    render: (name, props) => { cursor = 0; tree = module.exports[name](props); return tree; },
    flush: () => { for (const [index, fn] of pending) { hooks[index].cleanup?.(); hooks[index].cleanup = fn(); } pending.clear(); },
    dispose: () => { for (const entry of hooks) entry?.cleanup?.(); pending.clear(); },
    get tree() { return tree; },
  };
}
function find(tree, predicate) {
  if (!tree || typeof tree !== "object") return undefined;
  if (Array.isArray(tree)) { for (const node of tree) { const found = find(node, predicate); if (found) return found; } return; }
  if (predicate(tree)) return tree;
  return find(tree.props?.children, predicate);
}
function text(tree) {
  if (tree == null || typeof tree === "boolean") return "";
  if (typeof tree !== "object") return String(tree);
  if (Array.isArray(tree)) return tree.map(text).join("");
  return text(tree.props?.children);
}
function button(tree, label) {
  const node = find(tree, item => item.type === "button" && (item.props["aria-label"] ?? text(item.props.children)) === label);
  assert.ok(node, `Missing button: ${label}`); return node.props;
}

function fixture({ member = "index", accepted = false, reject = false, resume = false } = {}) {
  const original = member === "index" ? '{"note":"Saved index"}' : "# Saved current";
  const edited = member === "index" ? '{"note":"Unsaved draft"}' : "# Unsaved draft";
  const revision = { id: "synthetic-revision", created_at: "2026-10-12T00:00:00Z", members: { current: {}, index: {} } };
  const state = { generation: 2, adopted_revision_id: revision.id };
  const calls = { writes: [], confirms: [], discards: 0, closed: 0, drafts: [] };
  let hold = null, localText = null;
  const window = { confirm: message => { calls.confirms.push(message); return accepted; }, addEventListener: noop, removeEventListener: noop };
  const cache = { invalidateQueries: async () => {}, cancelQueries: async () => {}, setQueryData: noop };
  const api = { updateFiles: async (id, form) => { calls.writes.push({ id, form }); if (hold) await hold;
    if (reject) throw new Error("Synthetic save failure"); return { generation: 3, revision_id: "synthetic-next" }; } };
  const preferences = { usePreferences: () => ({ resolvedLocale: "en-US" }) };
  const workspace = runtime("continuation-workspace", {
    "react-dom": { createPortal: node => node }, "../../lib/export-usage": { releaseExportScope: noop },
    "../../components/use-dialog-focus": { useDialogFocus: noop }, "../../components/preferences-provider": preferences,
    "./continuation-panel": { ContinuationPanel: "Panel" }, "./offline-continuation-panel": { OfflineContinuationPanel: "Offline" },
    "./continuation-guide": { ContinuationGuide: "Guide" },
  }, window);
  const renderWorkspace = () => workspace.render("ContinuationWorkspace", { conversationId: "synthetic", onClose: () => { calls.closed++; }, restoreFocus: () => null, viewState: { member } });
  renderWorkspace();
  const panelProps = find(workspace.tree, item => item.type === "Panel").props;
  const panel = runtime("continuation-panel", {
    "../../components/preferences-provider": preferences,
    "@tanstack/react-query": { useQueryClient: () => cache, useQuery: ({ queryKey }) => ({ data: queryKey[2] === "state" ? state : queryKey[2] === "history" ? [revision] : undefined }) },
    "../../lib/api": { continuationApi: api, getTask: noop },
    "./continuation-document": { ContinuationDocument: "Document" }, "./continuation-drop-target": { ContinuationDropTarget: "Drop" },
    "./continuation-history": { ContinuationHistory: "History" },
  }, window);
  const renderPanel = () => panel.render("ContinuationPanel", panelProps);
  renderPanel();
  const documentProps = find(panel.tree, item => item.type === "Document").props;
  const saved = { key: "synthetic-draft", value: { text: edited, original, base_generation: 2 } };
  const local = { list: { data: resume ? [saved] : [], refetch: async () => {} }, status: "saved",
    begin: saved => { localText = saved?.value.text ?? null; }, retain: value => { localText = value; calls.drafts.push(value); },
    discard: async () => { calls.discards++; localText = null; }, remove: noop };
  const document = runtime("continuation-document", {
    "../../components/preferences-provider": preferences,
    "@tanstack/react-query": { useQueryClient: () => cache, useQuery: () => ({ data: original }) },
    "../../lib/api": { continuationApi: api }, "../conversations/markdown-renderer": { MarkdownRenderer: "Markdown" },
    "./continuation-find": { ContinuationFind: "Find" }, "./continuation-index": { IndexReading: "Index" },
    "./use-continuation-draft": { useContinuationDraft: () => local },
  }, window);
  const renderDocument = () => document.render("ContinuationDocument", documentProps);
  renderDocument(); document.flush(); panel.flush(); renderPanel(); renderWorkspace();
  const flush = () => { document.flush(); renderPanel(); panel.flush(); renderWorkspace(); };
  const edit = () => { button(document.tree, resume ? "Resume draft" : "Edit").onClick(); renderDocument(); document.flush(); renderPanel(); panel.flush(); renderWorkspace(); };
  const input = value => { find(document.tree, item => item.type === "textarea").props.onChange({ target: { value } }); renderDocument(); };
  const drop = () => find(panel.tree, item => item.type === "Drop").props.onFiles([new File([edited], member === "index" ? "index.json" : "current.md")]);
  return { calls, original, edited, panel, document, workspace, renderPanel, renderDocument, flush, edit, input, drop,
    localText: () => localText,
    hold: () => { let release; hold = new Promise(resolve => { release = resolve; }); return release; },
    dispose: () => { document.dispose(); panel.dispose(); workspace.dispose(); },
  };
}

for (const member of ["current", "index"]) test(`${member}: immediate declined drop cannot write before parent effects settle`, async () => {
  const f = fixture({ member });
  try { f.edit(); f.input(f.edited); f.drop(); await setImmediate();
    assert.equal(f.calls.confirms.length, 1); assert.equal(f.calls.writes.length, 0);
    assert.equal(f.calls.discards, 0); assert.equal(f.localText(), f.edited);
  } finally { f.dispose(); }
});
test("settled dirty draft also requires confirmation and preserves the text on decline", async () => {
  const f = fixture();
  try { f.edit(); f.input(f.edited); f.flush(); f.drop(); await setImmediate();
    assert.equal(f.calls.confirms.length, 1); assert.equal(f.calls.writes.length, 0); assert.equal(f.localText(), f.edited);
  } finally { f.dispose(); }
});
test("resuming a dirty draft protects an immediate drop before effects", async () => {
  const f = fixture({ resume: true });
  try { button(f.document.tree, "Resume draft").onClick(); f.renderDocument(); f.drop(); await setImmediate();
    assert.equal(f.calls.confirms.length, 1); assert.equal(f.calls.writes.length, 0); assert.equal(f.localText(), f.edited);
  } finally { f.dispose(); }
});
test("accepted immediate replacement waits for save acknowledgement before discarding", async () => {
  const f = fixture({ accepted: true }); const release = f.hold();
  try { f.edit(); f.input(f.edited); f.drop(); await setImmediate();
    assert.equal(f.calls.confirms.length, 1); assert.equal(f.calls.writes.length, 1); assert.equal(f.calls.discards, 0);
    assert.equal(f.calls.writes[0].form.get("base_generation"), "2");
    release(); await setImmediate(); assert.equal(f.calls.discards, 1);
  } finally { release(); await setImmediate(); f.dispose(); }
});
test("failed replacement preserves dirty draft and asks again on retry", async () => {
  const f = fixture({ accepted: true, reject: true });
  try { f.edit(); f.input(f.edited); f.flush(); f.drop(); await setImmediate(); f.renderPanel();
    assert.equal(f.calls.discards, 0); assert.equal(f.localText(), f.edited);
    button(f.panel.tree, "Retry file update").onClick(); await setImmediate();
    assert.equal(f.calls.confirms.length, 2); assert.equal(f.calls.writes.length, 2); assert.equal(f.calls.discards, 0);
  } finally { f.dispose(); }
});
test("pristine drop writes without an unnecessary draft confirmation", async () => {
  const f = fixture();
  try { f.drop(); await setImmediate(); assert.equal(f.calls.confirms.length, 0); assert.equal(f.calls.writes.length, 1); }
  finally { f.dispose(); }
});
test("reverting to original clears protection immediately even with stale parent render", async () => {
  const f = fixture();
  try { f.edit(); f.input(f.edited); f.flush(); f.input(f.original); f.drop(); await setImmediate();
    assert.equal(f.calls.confirms.length, 0); assert.equal(f.calls.writes.length, 1);
  } finally { f.dispose(); }
});
test("in-flight lock still admits only one drop", async () => {
  const f = fixture(); const release = f.hold();
  try { f.drop(); f.drop(); await setImmediate(); assert.equal(f.calls.writes.length, 1); }
  finally { release(); await setImmediate(); f.dispose(); }
});
test("immediate panel navigation cannot discard a newly changed draft", async () => {
  const f = fixture();
  try { f.edit(); f.input(f.edited); await button(f.panel.tree, "Current").onClick(); f.renderPanel();
    assert.equal(f.calls.confirms.length, 1); assert.equal(f.calls.discards, 0);
    assert.equal(find(f.panel.tree, item => item.type === "Document").props.member, "index");
  } finally { f.dispose(); }
});
test("immediate workspace close requires confirmation before losing the editor", async () => {
  const f = fixture();
  try { f.edit(); f.input(f.edited); await button(f.workspace.tree, "Close continuation").onClick();
    assert.equal(f.calls.confirms.length, 1); assert.equal(f.calls.closed, 0); assert.equal(f.calls.discards, 0);
  } finally { f.dispose(); }
});
test("unmount clears the editor guard without deleting the retained local draft", async () => {
  const f = fixture();
  try { f.edit(); f.input(f.edited); f.flush(); f.document.dispose();
    await button(f.workspace.tree, "Close continuation").onClick();
    assert.equal(f.calls.closed, 1); assert.equal(f.calls.discards, 0); assert.equal(f.localText(), f.edited);
  } finally { f.dispose(); }
});
test("confirmed editor save clears the workspace guard before parent effects", async () => {
  const f = fixture();
  try { f.edit(); f.input(f.edited); f.flush(); button(f.document.tree, "Save").onClick(); await setImmediate();
    await button(f.workspace.tree, "Close continuation").onClick();
    assert.equal(f.calls.writes.length, 1); assert.equal(f.calls.discards, 1);
    assert.equal(f.calls.confirms.length, 0); assert.equal(f.calls.closed, 1);
  } finally { f.dispose(); }
});
test("failed editor save retains the immediate workspace guard", async () => {
  const f = fixture({ reject: true });
  try { f.edit(); f.input(f.edited); f.flush(); button(f.document.tree, "Save").onClick(); await setImmediate();
    await button(f.workspace.tree, "Close continuation").onClick();
    assert.equal(f.calls.writes.length, 1); assert.equal(f.calls.discards, 0);
    assert.equal(f.calls.confirms.length, 1); assert.equal(f.calls.closed, 0); assert.equal(f.localText(), f.edited);
  } finally { f.dispose(); }
});
test("confirmed editor discard clears the guard without a server write", async () => {
  const f = fixture({ accepted: true });
  try { f.edit(); f.input(f.edited); f.flush(); button(f.document.tree, "Cancel").onClick(); await setImmediate();
    await button(f.workspace.tree, "Close continuation").onClick();
    assert.equal(f.calls.writes.length, 0); assert.equal(f.calls.discards, 1);
    assert.equal(f.calls.confirms.length, 1); assert.equal(f.calls.closed, 1);
  } finally { f.dispose(); }
});
test("an older panel effect cannot restore a dirty flag after reverting the input", async () => {
  const f = fixture();
  try { f.edit(); f.input(f.edited); f.renderPanel(); f.input(f.original); f.panel.flush();
    await button(f.workspace.tree, "Close continuation").onClick();
    assert.equal(f.calls.confirms.length, 0); assert.equal(f.calls.closed, 1); assert.equal(f.calls.discards, 0);
  } finally { f.dispose(); }
});
