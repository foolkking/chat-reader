import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

const appRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = appRequire("typescript"), React = appRequire("react"), jsx = appRequire("react/jsx-runtime");
const { renderToStaticMarkup } = appRequire("react-dom/server");
const { QueryClient, QueryObserver } = appRequire("@tanstack/react-query");
const noop = () => {}, childrenOnly = ({ children }) => children;
const row = mode => ({ id: `synthetic-${mode}`, title: `Synthetic ${mode} conversation`, display_title: `Synthetic ${mode} conversation`,
  status: mode, first_user_message: "Synthetic preview", message_count: 2 });
class ApiRequestError extends Error { constructor(status) { super("Synthetic raw upstream detail"); this.status = status; } }
const source = readFileSync(new URL("../../apps/web/features/conversations/conversation-list.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("conversation-list.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ConversationList");
const stateNames = [];
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && ts.isCallExpression(node.initializer)
    && node.initializer.expression.getText(ast) === "useState") stateNames.push(node.name.elements[0].name.getText(ast));
  ts.forEachChild(node, visit);
}
visit(component);
const compiled = ts.transpileModule(source, { fileName: "conversation-list.tsx", compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;

// Real QueryObserver request/cache transitions and actual component JSX. React
// renders are independent static snapshots; selection, transport and unrelated
// children are explicit doubles, not browser/lifecycle/layout/focus acceptance.
async function fixture({ mode = "active", rows = [row(mode)], cached = true, error = new Error("Synthetic raw upstream detail"),
  selected = false, locale = "en-US", existenceRows = [], existenceError = null, existenceCached = false } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  let mainError = error, savedError = existenceError, mainRows = rows, reads = 0, existenceReads = 0, held = null, imports = 0;
  const main = new QueryObserver(client, { queryKey: ["conversations", mode, "recent_read", "desc"], enabled: false,
    initialData: cached ? rows : undefined, queryFn: async () => { reads += 1; if (held) return held; if (mainError) throw mainError; return mainRows; } });
  const existence = new QueryObserver(client, { queryKey: ["conversations", "existence"], enabled: false,
    initialData: existenceCached ? existenceRows : undefined,
    queryFn: async () => { existenceReads += 1; if (savedError) throw savedError; return existenceRows; } });
  const stopMain = main.subscribe(noop), stopExistence = existence.subscribe(noop);
  await main.refetch();
  if (mode === "active" && main.getCurrentResult().isSuccess && rows.length === 0) await existence.refetch();
  const retryButtons = [], inputs = new Map(), mergeOwners = [], apiReads = [];
  let stateIndex = 0;
  const RenderedRetry = props => { retryButtons.push(props); return React.createElement("button", props); };
  const capture = factory => (type, props, key) => {
    // Only record a button React actually renders, not an element constructed
    // for another conditional branch and never inserted into the tree.
    if (type === "button" && ["Retry", "重试"].includes(props.children)) return factory(RenderedRetry, props, key);
    return factory(type, props, key);
  };
  const overrides = { selectedConversationIds: new Set(selected ? rows.map(item => item.id) : []),
    selectionMode: selected, mergeOrderIds: selected ? rows.map(item => item.id) : [] };
  const mocks = {
    react: { ...React, useState: initial => { const name = stateNames[stateIndex++]; return React.useState(Object.hasOwn(overrides, name) ? overrides[name] : initial); } },
    "react/jsx-runtime": { ...jsx, jsx: capture(jsx.jsx), jsxs: capture(jsx.jsxs) },
    "@tanstack/react-query": { useQueryClient: () => client, useQuery: input => {
      inputs.set(input.queryKey[1], input);
      return input.queryKey[0] === "projects" ? { data: [] } : input.queryKey[1] === "existence" ? existence.getCurrentResult() : main.getCurrentResult();
    } },
    "@dnd-kit/core": { DndContext: childrenOnly, DragOverlay: () => null, useSensor: noop, useSensors: noop },
    "@dnd-kit/sortable": { SortableContext: childrenOnly, useSortable: () => ({ setNodeRef: noop }) },
    "@dnd-kit/utilities": { CSS: { Transform: { toString: noop } } },
    "../../lib/api": { ApiRequestError, getConversations: async input => { apiReads.push(input); return rows; } },
    "./markdown-renderer": { stripLeadingTimestamp: text => text },
    "./conversation-action-menu": { ConversationActionMenu: () => null },
    // Placement has its own executable suite; this fixture isolates list reads.
    "./conversation-placement": { useConversationPlacement: () => ({}), ConversationPlacementSurface: () => null },
    "./conversation-undo": {},
    "./merge-conversations-dialog": { MergeConversationsDialog: props => { mergeOwners.push(props); return null; } },
    "../../components/sort-menu": { ConversationSortMenu: () => null },
    "../../components/preferences-provider": { usePreferences: () => ({ resolvedLocale: locale, conversationSortMode: "recent_read", conversationSortDirection: "desc" }) },
    "../../components/quick-start-guide": { QuickStartGuide: () => null },
    "../../lib/activity-time": { formatActivityTime: () => "Synthetic time", fullActivityTime: () => "Synthetic time" },
    "../../components/interaction-dialog-provider": { useInteractionDialog: () => ({}) },
    "./use-batch-export": { useBatchExport: () => ({ feedback: null }) },
    "../../components/selection-toolbar": { SelectionModeButton: () => null,
      SelectionToolbar: ({ selectedCount }) => React.createElement("aside", { "data-testid": "synthetic-selection-toolbar" }, selectedCount) },
    "../../components/use-linear-selection": { useLinearSelection: () => ({ itemHandlers: () => ({}), checkboxClass: () => "flex" }) },
    "../../lib/batch-selection": {},
    "../../components/hover-preview-link": { HoverPreviewLink: ({ href, children }) => React.createElement("a", { href }, children) },
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith(".")) throw new Error(`Unexpected component dependency: ${name}`);
    return appRequire(name);
  }, module, module.exports);
  const render = () => { stateIndex = 0; retryButtons.length = 0; mergeOwners.length = 0;
    return renderToStaticMarkup(React.createElement(module.exports.ConversationList, { mode, onImportClick: () => { imports += 1; } })); };
  return { client, main, existence, render, retryButtons, inputs, mergeOwners, apiReads, reads: () => reads, existenceReads: () => existenceReads, imports: () => imports,
    recover: () => { mainError = null; savedError = null; }, setRows: next => { mainRows = next; },
    holdRead: () => { let release; held = new Promise(resolve => { release = resolve; }); return () => { release(mainRows); held = null; }; },
    dispose: () => { stopMain(); stopExistence(); main.destroy(); existence.destroy(); client.clear(); } };
}

for (const mode of ["active", "archived"]) {
  test(`${mode}: failed refresh keeps the cached reading link and a localized retry notice`, async () => {
    const f = await fixture({ mode });
    try {
      const html = f.render();
      assert.equal(f.main.getCurrentResult().isError, true); assert.equal(f.main.getCurrentResult().data.length, 1);
      assert.match(html, new RegExp(`href="/conversations/synthetic-${mode}"`));
      assert.match(html, /Previously loaded items are shown/); assert.match(html, /role="alert"/);
      assert.doesNotMatch(html, /Synthetic raw upstream detail/); assert.equal(f.retryButtons.length, 1);
    } finally { f.dispose(); }
  });
  test(`${mode}: a transient failure retains selected rows and controls`, async () => {
    const f = await fixture({ mode, selected: true, error: new ApiRequestError(503) });
    try { const html = f.render(); assert.match(html, /synthetic-selection-toolbar">1</); assert.match(html, /checked=""/); }
    finally { f.dispose(); }
  });
  for (const cached of [false, true]) {
    test(`${mode}: ${cached ? "empty cached" : "initial"} failure is not a confirmed empty list`, async () => {
      const f = await fixture({ mode, cached, rows: [] });
      try {
        const html = f.render(); assert.match(html, /Failed to load conversations/); assert.match(html, /role="alert"/);
        assert.doesNotMatch(html, /No archived conversations|There are no conversations here yet|No unfiled conversations|Previously loaded items|Synthetic raw upstream detail/);
        assert.equal(f.retryButtons.length, 1);
      } finally { f.dispose(); }
    });
  }
  for (const status of [401, 403, 404]) {
    test(`${mode}: HTTP ${status} never reveals retained rows or bulk selection`, async () => {
      const f = await fixture({ mode, selected: true, error: new ApiRequestError(status) });
      try { assert.doesNotMatch(f.render(), /Synthetic (active|archived) conversation|synthetic-selection-toolbar|checked=""/); }
      finally { f.dispose(); }
    });
  }
  test(`${mode}: retry reads only the failed query and recovers without clearing selection`, async () => {
    const f = await fixture({ mode, selected: true });
    try {
      f.render(); assert.equal(f.retryButtons.length, 1); assert.equal(f.reads(), 1);
      f.recover(); f.retryButtons[0].onClick(); await setImmediate();
      assert.equal(f.reads(), 2); assert.equal(f.existenceReads(), 0);
      const html = f.render(); assert.match(html, /synthetic-selection-toolbar">1</); assert.match(html, /checked=""/);
      assert.doesNotMatch(html, /Previously loaded items|Failed to load conversations/); assert.equal(f.retryButtons.length, 0);
    } finally { f.dispose(); }
  });
  test(`${mode}: held retry keeps cached content and disables its retry control`, async () => {
    const f = await fixture({ mode }); let release = noop;
    try {
      f.render(); release = f.holdRead(); f.retryButtons[0].onClick(); await setImmediate();
      const html = f.render(); assert.equal(f.main.getCurrentResult().isFetching, true);
      assert.match(html, new RegExp(`href="/conversations/synthetic-${mode}"`)); assert.equal(f.retryButtons[0].disabled, true);
      assert.match(html, /aria-busy="true"/);
    } finally { release(); await setImmediate(); f.dispose(); }
  });
  test(`${mode}: sort placeholders belong only to the same list scope`, async () => {
    const f = await fixture({ mode, error: null });
    try {
      f.render(); const options = f.inputs.get(mode), previous = [row(mode)];
      assert.equal(options.placeholderData(previous, { queryKey: ["conversations", mode, "title", "asc"] }), previous);
      assert.equal(options.placeholderData(previous, { queryKey: ["conversations", mode === "active" ? "archived" : "active"] }), undefined);
      assert.equal(options.placeholderData(previous, { queryKey: ["conversations", "existence"] }), undefined);
      await options.queryFn(); assert.equal(f.apiReads[0].scope, "all"); assert.equal(f.apiReads[0].statusScope, mode);
    } finally { f.dispose(); }
  });
  test(`${mode}: successful rendering excludes conversations of the other status`, async () => {
    const f = await fixture({ mode, error: null, rows: [row("active"), row("archived")] });
    try {
      const html = f.render(); assert.match(html, new RegExp(`Synthetic ${mode} conversation`));
      assert.doesNotMatch(html, new RegExp(`Synthetic ${mode === "active" ? "archived" : "active"} conversation`));
    } finally { f.dispose(); }
  });
}

test("a verified first-run empty workspace keeps transcript import and no archive action", async () => {
  const f = await fixture({ rows: [], error: null });
  try { const html = f.render(); assert.match(html, /There are no conversations here yet/); assert.match(html, />Import conversations</); assert.doesNotMatch(html, /href="\/archived"/); }
  finally { f.dispose(); }
});

test("an archived-only workspace points to Archive, not project filing", async () => {
  const f = await fixture({ rows: [], error: null, existenceRows: [row("archived")] });
  try {
    const html = f.render(); assert.match(html, /No active conversations/); assert.match(html, /href="\/archived"/); assert.match(html, />View archive</);
    assert.doesNotMatch(html, /No unfiled conversations|filed in projects|There are no conversations here yet/);
  } finally { f.dispose(); }
});

for (const existenceCached of [false, true]) {
  test(`${existenceCached ? "cached" : "initial"} archive check failure stays explicit and retries only that read`, async () => {
    const f = await fixture({ rows: [], error: null, existenceCached, existenceError: new Error("Synthetic raw archive detail") });
    try {
      const html = f.render(); assert.match(html, /Could not check saved conversations/); assert.match(html, /role="alert"/);
      assert.doesNotMatch(html, /There are no conversations here yet|filed in projects|Synthetic raw archive detail/);
      assert.equal(f.retryButtons.length, 1); f.recover(); f.retryButtons[0].onClick(); await setImmediate();
      assert.equal(f.reads(), 1); assert.equal(f.existenceReads(), 2);
      assert.match(f.render(), /There are no conversations here yet/);
    } finally { f.dispose(); }
  });
}

test("Chinese retained content uses readable feedback and the existing retry action", async () => {
  const f = await fixture({ locale: "zh-CN" });
  try { const html = f.render(); assert.match(html, /对话更新失败，仍显示上次内容/); assert.match(html, />重试</); assert.doesNotMatch(html, /Synthetic raw upstream detail/); }
  finally { f.dispose(); }
});

test("Chinese archived-only empty state gives an actual archive link", async () => {
  const f = await fixture({ rows: [], error: null, existenceRows: [row("archived")], locale: "zh-CN" });
  try { const html = f.render(); assert.match(html, /暂无活动对话/); assert.match(html, />查看归档</); assert.match(html, /href="\/archived"/); assert.doesNotMatch(html, /归入项目|未分类/); }
  finally { f.dispose(); }
});
