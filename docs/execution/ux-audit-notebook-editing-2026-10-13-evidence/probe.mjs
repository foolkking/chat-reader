import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { setImmediate } from "node:timers/promises";

const root = new URL("../../../", import.meta.url);
const read = file => readFileSync(new URL(file, root), "utf8");
const hash = file => createHash("sha256").update(readFileSync(new URL(file, root))).digest("hex");
const parentPath = "docs/execution/ux-audit-annotation-composition-2026-10-13-evidence/local-verification.json";
const parent = JSON.parse(read(parentPath));
const sources = ["apps/web/features/annotations/notebook-view.tsx", "apps/web/lib/notebook-drafts.ts",
  "apps/web/features/annotations/annotation-workspace.tsx", "scripts/ux/annotation-workspace-reads.test.mjs"];
for (const file of sources) assert.ok(parent.verified_file_sha256_at_checkpoint[file], `${file} is parent-bound`);
const harnessUrl = new URL("scripts/ux/annotation-workspace-reads.test.mjs", root), require = createRequire(harnessUrl);
const ts = createRequire(new URL("apps/web/package.json", root))("typescript");
const marker = 'if (observeWorkspace && file === "annotation-workspace.tsx") source = source.replace("const creationTypes =",';
const originalHarness = read("scripts/ux/annotation-workspace-reads.test.mjs");
assert.equal(originalHarness.split(marker).length, 2);
let harness = originalHarness.replaceAll("import.meta.url", JSON.stringify(harnessUrl.href));
harness = harness.replace("function runtime(extra = {}, desktop = false, observeWorkspace) {",
  "function runtime(extra = {}, desktop = false, observeWorkspace, observeNotebook) {");
harness = harness.replace(marker,
  'if (observeNotebook && file === "notebook-view.tsx") source = source.replace("const dirty = Boolean", "observeNotebook({ compare, chooseServer }); const dirty = Boolean");\n    if (observeWorkspace && file === "annotation-workspace.tsx") source = source.replace("const creationTypes =",');
const invokeMarker = 'new Function("require", "module", "exports", "window", "document", "ResizeObserver", "CSS", "observeWorkspace", code)';
assert.equal(harness.split(invokeMarker).length, 2);
harness = harness.replace(invokeMarker, 'new Function("require", "module", "exports", "window", "document", "ResizeObserver", "CSS", "observeWorkspace", "observeNotebook", code)')
  .replace("}, module, module.exports, window, document, class { observe() {} disconnect() {} }, { highlights: { delete: noop } }, observeWorkspace);",
    "}, module, module.exports, window, document, class { observe() {} disconnect() {} }, { highlights: { delete: noop } }, observeWorkspace, observeNotebook);");
const compiled = ts.transpileModule(harness, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
const module = { exports: {} };
const { runtime, note, find, text, button, deferred } = new Function("require", "module", "exports", compiled +
  "\nreturn { runtime, note, find, text, button, deferred };")(
  name => name === "node:test" ? { test: () => {} } : require(name), module, module.exports);
const settle = async () => { await setImmediate(); await setImmediate(); };
const result = {};

{
  const latest = deferred(); let reads = 0, observed;
  const r = runtime({ "../../lib/interaction-dialog-provider": { useInteractionDialog: () => ({ confirm: async () => true }) },
    "../../components/interaction-dialog-provider": { useInteractionDialog: () => ({ confirm: async () => true }) },
    "../../lib/notebook-drafts": { notebookDraftKey: () => "probe", readNotebookDraft: async () => undefined,
      writeNotebookDraft: async (_key, version) => version + 1, removeNotebookDraft: async () => {} } }, false,
    undefined, value => { observed = value; });
  const repository = { mode: "remote", saveNotebook: async () => { throw new Error("Synthetic save failure"); }, getNotebook: () => { reads++; return latest.promise; } };
  const props = { notebook: note("base"), conflicts: [], annotations: [], repository, onSaved: noop => {}, onReload: async () => {},
    onResolve: async () => {}, onRiskChange: () => {}, onNavigate: () => {} };
  const render = () => r.render("notebook-view.tsx", "NotebookView", props);
  render(); r.flush(); await settle(); render();
  const input = find(render(), item => item.type === "input" && item.props["aria-label"] === "Notebook title");
  input.props.onChange({ target: { value: "edited" } });
  render();
  await button(render(), "Save notebook").onClick(); await settle(); render();
  const first = button(render(), "Compare current version"); first.onClick(); first.onClick();
  result.concurrent_compare = { get_notebook_requests_before_response: reads };
  latest.resolve(note("current")); await settle(); r.dispose();
}

{
  const confirmation = deferred(); let removed = 0, storedDraftTitle = "edited", observed;
  const r = runtime({ "../../components/interaction-dialog-provider": { useInteractionDialog: () => ({ confirm: () => confirmation.promise }) },
    "../../lib/notebook-drafts": { notebookDraftKey: () => "probe", readNotebookDraft: async () => ({ base: note("base"), title: "edited", blocks: [], version: 1 }),
      writeNotebookDraft: async (_key, version, value) => { storedDraftTitle = value.title; return version + 1; },
      removeNotebookDraft: async () => { removed++; storedDraftTitle = null; } } }, false,
    undefined, value => { observed = value; });
  const repository = { mode: "remote", saveNotebook: async () => { throw new Error("Synthetic save failure"); }, getNotebook: async () => note("current") };
  const props = { notebook: note("base"), conflicts: [], annotations: [], repository, onSaved: () => {}, onReload: async () => {},
    onResolve: async () => {}, onRiskChange: () => {}, onNavigate: () => {} };
  const render = () => r.render("notebook-view.tsx", "NotebookView", props);
  render(); r.flush(); await settle(); render();
  find(render(), item => item.type === "input" && item.props["aria-label"] === "Notebook title")
    .props.onChange({ target: { value: "edited before confirm" } });
  render(); await button(render(), "Save notebook").onClick(); await settle(); render(); observed.compare(); await settle(); render();
  const oldChoose = observed.chooseServer;
  const action = oldChoose(); await settle();
  find(render(), item => item.type === "input" && item.props["aria-label"] === "Notebook title")
    .props.onChange({ target: { value: "newer edit during confirmation" } });
  render(); confirmation.resolve(true); await action; await settle();
  result.confirm_discard_race = { newer_input: "newer edit during confirmation", retained_storage_after_confirm: storedDraftTitle,
    local_draft_removals: removed, editor_value_after_confirm: find(render(), item => item.type === "input" && item.props["aria-label"] === "Notebook title")?.props.value };
  r.dispose();
}

console.log(JSON.stringify({ schema_version: 1, parent_checkpoint: parentPath, parent_checkpoint_sha256: hash(parentPath),
  source_sha256: Object.fromEntries(sources.map(file => [file, hash(file)])),
  evidence: "Real compiled NotebookView callbacks with explicit React, IndexedDB, repository and confirmation-dialog doubles; no browser rendering or real storage/network.",
  result }, null, 2));
