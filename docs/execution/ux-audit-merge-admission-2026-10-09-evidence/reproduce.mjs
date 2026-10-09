// Baseline only: execute exact-source callbacks with explicit transport/DOM doubles.
// This does not start an application, run a browser, or test PostgreSQL concurrency.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { setImmediate } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const appRequire = createRequire(new URL("../../../apps/web/package.json", import.meta.url));
const ts = appRequire("typescript");
const React = appRequire("react");
const jsx = appRequire("react/jsx-runtime");
const { renderToStaticMarkup } = appRequire("react-dom/server");
const source = "a12ce9e287fdddfd4df8a6039a212cec04629568";
const read = path => execFileSync("git", ["show", `${source}:${path}`], { cwd: root, encoding: "utf8" });
const transpile = input => ts.transpileModule(input, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const noop = () => {};

function callback(path, overrides = {}) {
  const code = read(path);
  const ast = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const matches = [];
  function visit(node) {
    if (ts.isJsxAttribute(node) && node.name.text === "onMerge" && node.initializer?.expression?.getText(ast).includes("crypto.randomUUID()")) matches.push(node.initializer.expression.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(matches.length, 1);
  const writes = [];
  const titleChanges = [];
  let counter = 0;
  const env = {
    mergeConversations: async input => { writes.push(input); if (writes.length === 1) throw new TypeError("Synthetic response lost after admission"); },
    crypto: { randomUUID: () => `synthetic-request-${++counter}` },
    setIsMerging: noop, setBulkBusy: noop, setSelectedConversationIds: noop, setMergeOrderIds: noop,
    setMergeTitle: value => titleChanges.push(value),
    queryClient: { invalidateQueries: async () => {} },
    projectId: "synthetic-project", project: { name: "Synthetic project" },
    ...overrides,
  };
  const module = { exports: {} };
  new Function("exports", ...Object.keys(env), transpile(`export const callback = ${matches[0]};`))(module.exports, ...Object.values(env));
  return { run: module.exports.callback, writes, titleChanges };
}

const paths = ["apps/web/features/conversations/conversation-list.tsx", "apps/web/features/projects/project-conversation-list.tsx"];
const results = [];
for (const path of paths) {
  const fixture = callback(path);
  await assert.rejects(fixture.run(["synthetic-first", "synthetic-second"], "Synthetic merge"), /response lost/);
  await fixture.run(["synthetic-first", "synthetic-second"], "Synthetic merge");
  results.push({ path, check: "lost-response retry retains one request key", passed: fixture.writes[0].idempotencyKey === fixture.writes[1].idempotencyKey,
    post_attempts: fixture.writes.length, distinct_keys: new Set(fixture.writes.map(x => x.idempotencyKey)).size,
    identical_order_and_title: JSON.stringify(fixture.writes[0].conversationIds) === JSON.stringify(fixture.writes[1].conversationIds) && fixture.writes[0].title === fixture.writes[1].title });

  let release;
  const held = new Promise(resolve => { release = resolve; });
  const acknowledged = callback(path, { mergeConversations: async () => ({}), queryClient: { invalidateQueries: () => held } });
  let settled = false;
  const pending = acknowledged.run(["synthetic-first", "synthetic-second"], "Synthetic merge").then(() => { settled = true; });
  await setImmediate();
  results.push({ path, check: "confirmed admission settles before task refresh", passed: settled });
  release(); await pending;
}

let titleInput;
let draft = "Synthetic submitted title";
const mocks = {
  "react": React,
  "react/jsx-runtime": { ...jsx, jsx: (type, props, ...rest) => { if (type === "input") titleInput = props; return jsx.jsx(type, props, ...rest); } },
  "react-dom": { createPortal: element => element },
  "@tanstack/react-query": { useQueryClient: () => ({}), useQuery: () => ({ data: { maximum_merge_message_count: 1000 } }) },
  "../../lib/api": { ApiRequestError: class extends Error {} },
  "../../lib/auth-client": {},
  "../../components/support-limit-action": { SupportLimitAction: () => null },
  "../../components/use-dialog-focus": { useDialogFocus: noop },
  "../../components/preferences-provider": { usePreferences: () => ({ resolvedLocale: "en-US" }) },
  "./merge-order-list": { MergeOrderList: () => null },
};
const module = { exports: {} };
new Function("require", "module", "exports", "document", transpile(read("apps/web/features/conversations/merge-conversations-dialog.tsx")))(
  name => Object.hasOwn(mocks, name) ? mocks[name] : appRequire(name), module, module.exports, { body: {} });
renderToStaticMarkup(React.createElement(module.exports.MergeConversationsDialog, {
  open: true, busy: true, conversations: [{ id: "synthetic-first", message_count: 1 }, { id: "synthetic-second", message_count: 1 }],
  title: draft, onTitleChange: value => { draft = value; }, onReorder: noop, onMerge: noop, onClose: noop,
}));
assert.ok(titleInput);
if (!titleInput.disabled && !titleInput.readOnly) titleInput.onChange({ target: { value: "Synthetic typed while submitting" } });
const editedWhilePending = draft === "Synthetic typed while submitting";
const completed = callback(paths[0], { mergeConversations: async () => ({}), setMergeTitle: value => { draft = value; } });
await completed.run(["synthetic-first", "synthetic-second"], "Synthetic submitted title");
results.push({ path: "apps/web/features/conversations/merge-conversations-dialog.tsx", check: "pending title cannot accept text that completion discards", passed: !editedWhilePending,
  pending_input_disabled: Boolean(titleInput.disabled), pending_input_readonly: Boolean(titleInput.readOnly), accepted_edit: editedWhilePending, completion_cleared_edit: draft !== "Synthetic typed while submitting" });

process.stdout.write(`${JSON.stringify({ source, evidence: "Actual transpiled callbacks/JSX with explicit transport, state and DOM doubles; not an actual browser or database.", checks: results }, null, 2)}\n`);
