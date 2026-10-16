import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { setImmediate } from "node:timers/promises";

const root = new URL("../../../", import.meta.url);
const read = file => readFileSync(new URL(file, root), "utf8");
const hash = file => createHash("sha256").update(readFileSync(new URL(file, root))).digest("hex");
const parentPath = "docs/execution/ux-audit-followup-2026-10-13-evidence/local-verification.json";
const parent = JSON.parse(read(parentPath));
const sources = ["apps/web/features/annotations/annotation-workspace.tsx", "apps/web/features/annotations/notebook-view.tsx",
  "apps/web/features/annotations/use-annotation-workspace-reads.ts", "apps/web/lib/annotation-repository.ts",
  "apps/web/lib/notebook-drafts.ts", "scripts/ux/annotation-workspace-reads.test.mjs"];
for (const file of sources) assert.equal(hash(file), parent.verified_file_sha256_at_checkpoint[file], file);
const harnessUrl = new URL("scripts/ux/annotation-workspace-reads.test.mjs", root), require = createRequire(harnessUrl);
const ts = createRequire(new URL("apps/web/package.json", root))("typescript");
// Reuse the explicit hook/repository/DOM doubles already audited at the prior
// checkpoint. Suppress test registration, and expose the real private list
// function for observation only; no production statements are replaced.
const harness = read("scripts/ux/annotation-workspace-reads.test.mjs");
const marker = "const code = ts.transpileModule(source,";
assert.equal(harness.split(marker).length, 2);
const instrumented = harness.replaceAll("import.meta.url", JSON.stringify(harnessUrl.href))
  .replace(marker, 'const code = ts.transpileModule(file === "annotation-workspace.tsx" ? source + "\\nexport { AnnotationList };" : source,');
const compiled = ts.transpileModule(instrumented, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
const module = { exports: {} };
const { runtime, batchFixture, repository, annotation, note, find, text, button, deferred } = new Function("require", "module", "exports", compiled +
  "\nreturn { runtime, batchFixture, repository, annotation, note, find, text, button, deferred };")(
  name => name === "node:test" ? { test: () => {} } : require(name), module, module.exports);
const rejected = [];
const onRejected = error => rejected.push(error);
process.on("unhandledRejection", onRejected);
const settle = async () => { await setImmediate(); await setImmediate(); };
const result = {};
try {
  const r = runtime(), item = { ...annotation("comment"), metadata: {}, revision: 1, quote: "Synthetic source", comment_markdown: "stored" };
  const props = { items: [item], editable: true, messages: [], focusedAnnotationId: null, selectionMode: false,
    selectedAnnotationIds: new Set(), onToggleSelected() {}, onNavigate() {}, onUpdate: async () => { throw new Error("synthetic rejected save"); }, onStyle() {}, onDelete() {}, onAddToNotebook() {} };
  const render = () => r.render("annotation-workspace.tsx", "AnnotationList", props);
  let tree = render(), input = find(tree, node => node.type === "textarea");
  const originalKey = input.key;
  input.props.onBlur({ target: { value: "Synthetic unsaved comment" } }); await settle();
  props.items = [{ ...item, revision: 2, color: "green" }]; tree = render(); input = find(tree, node => node.type === "textarea");
  result.comment_revision = { before_key: originalKey, after_key: input.key, replacement_default: input.props.defaultValue,
    controlled_value: input.props.value ?? null, change_handler: Boolean(input.props.onChange), failure_visible_in_tree: text(tree).includes("Save failed") };
  assert.notEqual(input.key, originalKey); assert.equal(input.props.defaultValue, "stored"); assert.equal(input.props.value, undefined);
  r.dispose();

  const f = batchFixture(), backend = new Map(["first", "second"].map((id, index) => [id, { ...annotation(id), revision: 1, quote: index ? "hidden" : "shown" }]));
  let reads = 0; const updates = [];
  f.repo.value.list = async () => { reads++; return [...backend.values()]; };
  f.repo.value.update = async (item, patch) => {
    updates.push({ id: item.id, revision: item.revision });
    if (backend.get(item.id).revision !== item.revision) throw new Error("synthetic revision conflict");
    if (item.id === "second") throw new Error("synthetic transient failure");
    const saved = { ...item, ...patch, revision: item.revision + 1 }; backend.set(item.id, saved); return saved;
  };
  tree = await f.start(); button(tree, "Apply style (2)").onClick(); await settle(); tree = f.render();
  const shown = find(tree, node => node.type?.name === "AnnotationList").props.items[0];
  result.partial_style = { reads_after_failure: reads, stored_first_revision: backend.get("first").revision,
    shown_first_revision: shown.revision, first_attempt_requests: updates.slice() };
  button(tree, "Apply style (2)").onClick(); await settle(); result.partial_style.retry_requests = updates.slice(2);
  assert.equal(reads, 1); assert.equal(shown.revision, 1); assert.deepEqual(updates.map(item => item.id), ["first", "second", "first"]);
  f.r.dispose();

  const d = batchFixture(); let deletes = 0;
  d.setNotebook({ ...note("saved"), blocks: ["first", "second"].map(id => ({ id: `ref-${id}`, type: "annotation_reference", annotation_id: id })) });
  d.repo.value.delete = async () => { deletes++; throw new Error("synthetic delete failure"); };
  tree = await d.start(); button(tree, "Delete").onClick(); await settle();
  result.delete_order = { notebook_saves: d.saves.length, references_after_notebook_save: d.saves[0].blocks.length,
    annotation_delete_attempts: deletes, confirmed_annotation_deletions: 0 };
  assert.equal(d.saves[0].blocks.length, 0); assert.equal(deletes, 1); d.r.dispose();

  const pending = deferred(), r2 = runtime({}, true), repo = repository({ create: () => pending.promise });
  const bookmarkProps = { conversationId: "synthetic-a", repository: repo.value, open: false,
    messages: [{ id: "synthetic-message", role: "user", order_key: 1 }], activeMessageId: null, onOpenChange() {}, onNavigate() {} };
  r2.render("annotation-workspace.tsx", "AnnotationWorkspace", bookmarkProps); r2.flush();
  r2.render("annotation-workspace.tsx", "AnnotationWorkspace", bookmarkProps); r2.flush();
  for (let index = 0; index < 2; index++) r2.events.dispatchEvent(new CustomEvent("chat-reader:create-bookmark", { detail: { messageId: "synthetic-message" } }));
  result.repeat_bookmark = { create_calls_before_first_acknowledgement: repo.calls.create };
  assert.equal(repo.calls.create, 2); pending.resolve(annotation("created")); await settle(); r2.dispose();

  const calls = { server_saves: 0, removes: 0, draft_writes: 0 }, base = note("old");
  const r3 = runtime({ "../../lib/notebook-drafts": { notebookDraftKey: () => "synthetic-draft", readNotebookDraft: async () => ({ base, title: "edited", blocks: [], version: 1 }),
    writeNotebookDraft: async () => { calls.draft_writes++; return 2; }, removeNotebookDraft: async () => { calls.removes++; throw new Error("synthetic cleanup failure"); } } });
  const notebookProps = { notebook: base, conflicts: [], annotations: [], repository: { ...repository().value,
    saveNotebook: async () => { calls.server_saves++; return { ...note("edited"), revision: 2 }; } }, onSaved() {}, onReload() {}, onResolve() {}, onRiskChange() {}, onNavigate() {} };
  const renderNote = () => r3.render("notebook-view.tsx", "NotebookView", notebookProps);
  renderNote(); r3.flush(); await settle(); tree = renderNote(); button(tree, "Save notebook").onClick(); await settle(); tree = renderNote();
  const offered = Boolean(find(tree, node => node.type === "button" && text(node) === "Retry saving draft"));
  button(tree, "Retry saving draft").onClick(); await settle();
  result.cleanup_recovery = { ...calls, offered_save_draft_instead_of_cleanup: offered, still_says_retry_clearing: text(renderNote()).includes("Retry clearing it") };
  assert.equal(calls.removes, 1); assert.equal(calls.draft_writes, 1); r3.dispose();
  result.unhandled_rejections_observed = rejected.length;
  assert.equal(rejected.length, 4);
} finally { process.off("unhandledRejection", onRejected); }
console.log(JSON.stringify({ schema_version: 1, recorded_at_utc: new Date().toISOString(),
  parent_checkpoint: parentPath, parent_checkpoint_sha256: hash(parentPath),
  evidence: "Real compiled callbacks and React element properties; scheduling, repository, storage and DOM are explicit doubles. No browser execution or actual server mutation.",
  source_sha256: Object.fromEntries(sources.map(file => [file, hash(file)])), findings: result }, null, 2));
