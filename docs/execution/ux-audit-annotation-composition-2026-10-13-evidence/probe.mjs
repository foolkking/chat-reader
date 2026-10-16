import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { setImmediate } from "node:timers/promises";

const root = new URL("../../../", import.meta.url);
const read = file => readFileSync(new URL(file, root), "utf8");
const hash = file => createHash("sha256").update(readFileSync(new URL(file, root))).digest("hex");
const parentPath = "docs/execution/ux-audit-annotation-writes-2026-10-13-evidence/local-verification.json";
const parent = JSON.parse(read(parentPath));
const sources = ["apps/web/features/annotations/annotation-workspace.tsx", "apps/web/features/annotations/use-annotation-workspace-reads.ts",
  "apps/web/lib/annotation-repository.ts", "scripts/ux/annotation-workspace-reads.test.mjs"];
for (const file of sources) assert.equal(hash(file), parent.verified_file_sha256_at_checkpoint[file], file);
const harnessUrl = new URL("scripts/ux/annotation-workspace-reads.test.mjs", root), require = createRequire(harnessUrl);
const ts = createRequire(new URL("apps/web/package.json", root))("typescript");
const marker = "const code = ts.transpileModule(source,";
const harness = read("scripts/ux/annotation-workspace-reads.test.mjs");
assert.equal(harness.split(marker).length, 2);
// Only expose existing setters/callbacks before rendering; no production branch
// is replaced. Selecting text is a setter double, not a browser DOM selection.
const instrumented = harness.replaceAll("import.meta.url", JSON.stringify(harnessUrl.href))
  .replace("const mocks = {", 'const mocks = { "probe-capture": { observe() {} },').replace(marker,
  `const code = ts.transpileModule(file === "annotation-workspace.tsx" ? source.replace("const creationTypes =", "require('probe-capture').observe({ setSelection, createTextAnnotation }); const creationTypes =") : source,`);
const compiled = ts.transpileModule(instrumented, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
const module = { exports: {} };
const { runtime, batchFixture, repository, annotation, find, text, button, deferred } = new Function("require", "module", "exports", compiled +
  "\nreturn { runtime, batchFixture, repository, annotation, find, text, button, deferred };")(
  name => name === "node:test" ? { test: () => {} } : name === "probe-capture" ? { observe() {} } : require(name), module, module.exports);
const failures = [], rejected = error => failures.push(error.message);
process.on("unhandledRejection", rejected);
const settle = async () => { await setImmediate(); await setImmediate(); };
const result = {};
try {
  const f = batchFixture(), pending = deferred(); let saves = 0;
  f.repo.value.saveNotebook = () => { saves++; return pending.promise; };
  let tree = await f.start(), add = button(tree, "Add to notes (2)"); add.onClick(); add.onClick();
  assert.equal(saves, 2); result.repeat_add = { notebook_requests_before_ack: saves };
  pending.reject(new Error("Synthetic unknown note addition")); await settle(); tree = f.render();
  result.add_failure = { input_selection_retained: text(tree).includes("2 selected"), rendered_error: /failed|unknown|not confirmed/i.test(text(tree)),
    unhandled_rejections: failures.length };
  assert.equal(result.add_failure.rendered_error, false); f.r.dispose();

  let observed, prompts = 0; const requests = [], wait = deferred();
  const r = runtime({ "probe-capture": { observe(value) { observed = value; } },
    "../../components/interaction-dialog-provider": { useInteractionDialog: () => ({ prompt: async () => { prompts++; return "Synthetic retained comment"; } }) } }, true);
  const repo = repository({ create: (_id, input) => { requests.push(input); return wait.promise; } });
  const props = { conversationId: "synthetic-a", repository: repo.value, open: true,
    messages: [{ id: "synthetic-message", role: "user", order_key: 1 }], activeMessageId: "synthetic-message", onOpenChange() {}, onNavigate() {} };
  const render = () => r.render("annotation-workspace.tsx", "AnnotationWorkspace", props);
  render(); r.flush(); await settle(); render();
  observed.setSelection({ messageId: "synthetic-message", messageVersionId: "synthetic-version", startBlockIndex: 0, startOffset: 0,
    endBlockIndex: 0, endOffset: 9, quote: "Synthetic", prefix: "", suffix: " source", rect: { left: 0, width: 100, top: 150 } });
  render(); const first = observed.createTextAnnotation("comment", "yellow"), second = observed.createTextAnnotation("comment", "yellow");
  await settle();
  result.repeat_text_creation = { prompts, requests: requests.length, stable_ids: requests.map(item => item.id ?? null) };
  assert.equal(prompts, 2); assert.equal(requests.length, 2); assert.equal(requests[0].id, undefined);
  wait.reject(new Error("Synthetic unknown annotation creation"));
  const outcomes = await Promise.allSettled([first, second]); tree = render();
  result.text_creation_failure = { escaped_rejections: outcomes.filter(item => item.status === "rejected").length,
    comment_in_rendered_tree: text(tree).includes("Synthetic retained comment"), failure_in_rendered_tree: /not confirmed|failed/i.test(text(tree)) };
  assert.equal(result.text_creation_failure.escaped_rejections, 2); assert.equal(result.text_creation_failure.comment_in_rendered_tree, false);
  const success = deferred(); repo.value.create = () => success.promise;
  render(); const oldCreate = observed.createTextAnnotation("highlight", "yellow");
  observed.setSelection({ messageId: "synthetic-message", messageVersionId: "synthetic-version", startBlockIndex: 0, startOffset: 10,
    endBlockIndex: 0, endOffset: 20, quote: "Newer selection", prefix: "", suffix: "", rect: { left: 0, width: 100, top: 180 } });
  render(); success.resolve(annotation("created")); await oldCreate; tree = render();
  result.late_creation = { newer_selection_toolbar_retained: Boolean(find(tree, item => item.props?.["aria-label"] === "Create annotation")) };
  assert.equal(result.late_creation.newer_selection_toolbar_retained, false);
  r.dispose();
} finally { process.off("unhandledRejection", rejected); }
console.log(JSON.stringify({ schema_version: 1, recorded_at_utc: new Date().toISOString(), parent_checkpoint: parentPath, parent_checkpoint_sha256: hash(parentPath),
  evidence: "Real compiled workspace callbacks; explicit React/repository/selection setter doubles. No browser, geometry, real database mutation or frequency measurement.",
  source_sha256: Object.fromEntries(sources.map(file => [file, hash(file)])), findings: result }, null, 2));
