import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

const appRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = appRequire("typescript"), React = appRequire("react"), jsx = appRequire("react/jsx-runtime");
const { renderToStaticMarkup } = appRequire("react-dom/server");
const { QueryClient, QueryObserver, InfiniteQueryObserver } = appRequire("@tanstack/react-query");
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

// Real infinite/query observer request/cache transitions and actual JSX. React
// renders are independent static snapshots; selection, transport and unrelated
// children are explicit doubles, not browser/lifecycle/layout/focus acceptance.
async function fixture({ mode = "active", rows = [row(mode)], cached = true, error = new Error("Synthetic raw upstream detail"),
  selected = false, locale = "en-US", existenceRows = [], existenceError = null, existenceCached = false,
  sortMode = "recent_read", direction = "desc" } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  let mainError = error, savedError = existenceError, mainRows = rows, reads = 0, existenceReads = 0, held = null, imports = 0;
  const page = (items, offset = 0) => ({ items: items.slice(offset, offset + 100), offset, hasMore: items.length > offset + 100 });
  const main = new InfiniteQueryObserver(client, { queryKey: ["conversations", "paged", mode, sortMode, direction], enabled: false,
    initialPageParam: 0, getNextPageParam: last => last.hasMore ? last.offset + 100 : undefined,
    initialData: cached ? { pages: [page(rows)], pageParams: [0] } : undefined,
    queryFn: async ({ pageParam }) => { reads += 1; const items = held ? await held : mainRows;
      if (mainError) throw mainError; return page(items, pageParam); } });
  const existence = new QueryObserver(client, { queryKey: ["conversations", "existence"], enabled: false,
    initialData: existenceCached ? existenceRows : undefined,
    queryFn: async () => { existenceReads += 1; if (savedError) throw savedError; return existenceRows; } });
  const stopMain = main.subscribe(noop), stopExistence = existence.subscribe(noop);
  await main.refetch();
  if (mode === "active" && main.getCurrentResult().isSuccess && rows.length === 0) await existence.refetch();
  const retryButtons = [], inputs = new Map(), mergeOwners = [], apiReads = [], orderWrites = [], sortableRows = [];
  let dragContext;
  let stateIndex = 0;
  const RenderedRetry = props => { retryButtons.push(props); return React.createElement("button", props); };
  const capture = factory => (type, props, key) => {
    // Only record a button React actually renders, not an element constructed
    // for another conditional branch and never inserted into the tree.
    if (type === "button" && ["Retry", "重试"].includes(props.children)) return factory(RenderedRetry, props, key);
    return factory(type, props, key);
  };
  const overrides = { selectedConversationIds: new Set(selected ? rows.slice(0, 100).map(item => item.id) : []),
    selectionMode: selected, mergeOrderIds: selected ? rows.slice(0, 100).map(item => item.id) : [] };
  const mocks = {
    react: { ...React, useState: initial => { const name = stateNames[stateIndex++]; return React.useState(Object.hasOwn(overrides, name) ? overrides[name] : initial); } },
    "react/jsx-runtime": { ...jsx, jsx: capture(jsx.jsx), jsxs: capture(jsx.jsxs) },
    "@tanstack/react-query": { useQueryClient: () => client, useInfiniteQuery: input => {
      inputs.set(input.queryKey[2], input); return main.getCurrentResult();
    }, useQuery: input => {
      inputs.set(input.queryKey[1], input);
      return input.queryKey[0] === "projects" ? { data: [] } : input.queryKey[1] === "existence" ? existence.getCurrentResult() : main.getCurrentResult();
    } },
    "@dnd-kit/core": { DndContext: props => { dragContext = props; return props.children; },
      DragOverlay: () => null, useSensor: noop, useSensors: noop },
    "@dnd-kit/sortable": { SortableContext: childrenOnly,
      arrayMove: appRequire("@dnd-kit/sortable").arrayMove,
      useSortable: input => { sortableRows.push(input); return { setNodeRef: noop }; } },
    "@dnd-kit/utilities": { CSS: { Transform: { toString: noop } } },
    "../../lib/api": { ApiRequestError,
      updateConversationOrder: async ids => { orderWrites.push(ids); },
      getConversations: async input => { apiReads.push(input); return mainRows.slice(input.offset ?? 0, (input.offset ?? 0) + input.limit); } },
    "./markdown-renderer": { stripLeadingTimestamp: text => text },
    "./conversation-action-menu": { ConversationActionMenu: () => null },
    "./conversation-deletion-provider": { useConversationDeletion: () => ({ busy: false,
      submit: async () => { throw new Error("A read-recovery test must not delete"); } }) },
    // Placement has its own executable suite; this fixture isolates list reads.
    "./conversation-placement": { useConversationPlacement: () => ({}), ConversationPlacementSurface: () => null },
    "./conversation-undo": {},
    "./merge-conversations-dialog": { MergeConversationsDialog: props => { mergeOwners.push(props); return null; } },
    "../../components/sort-menu": { ConversationSortMenu: () => null },
    "../../components/preferences-provider": { usePreferences: () => ({ resolvedLocale: locale, conversationSortMode: sortMode, conversationSortDirection: direction }) },
    "../../components/quick-start-guide": { QuickStartGuide: () => null },
    "../../lib/activity-time": { formatActivityTime: () => "Synthetic time", fullActivityTime: () => "Synthetic time" },
    "../../components/interaction-dialog-provider": { useInteractionDialog: () => ({}) },
    "./use-batch-export": { useBatchExport: () => ({ feedback: null }) },
    "../../components/selection-toolbar": { SelectionModeButton: () => null,
      SelectionToolbar: ({ selectedCount, loadedOnly }) => { inputs.set("selection", { selectedCount, loadedOnly });
        return React.createElement("aside", { "data-testid": "synthetic-selection-toolbar" }, selectedCount); } },
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
  const render = () => { stateIndex = 0; retryButtons.length = 0; mergeOwners.length = 0; sortableRows.length = 0;
    return renderToStaticMarkup(React.createElement(module.exports.ConversationList, { mode, onImportClick: () => { imports += 1; } })); };
  return { client, main, existence, render, retryButtons, inputs, mergeOwners, apiReads, orderWrites, sortableRows,
    async drag(from, to) { assert.ok(dragContext); dragContext.onDragEnd({ active: { id: from }, over: { id: to } }); await setImmediate(); },
    reads: () => reads, existenceReads: () => existenceReads, imports: () => imports,
    recover: () => { mainError = null; savedError = null; }, setRows: next => { mainRows = next; },
    holdRead: () => { let release; held = new Promise(resolve => { release = resolve; }); return () => { release(mainRows); held = null; }; },
    dispose: () => { stopMain(); stopExistence(); main.destroy(); existence.destroy(); client.clear(); } };
}

for (const mode of ["active", "archived"]) {
  test(`${mode}: failed refresh keeps the cached reading link and a localized retry notice`, async () => {
    const f = await fixture({ mode });
    try {
      const html = f.render();
      assert.equal(f.main.getCurrentResult().isError, true); assert.equal(f.main.getCurrentResult().data.pages[0].items.length, 1);
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
  test(`${mode}: sorts start with their own pages and page requests preserve the list scope`, async () => {
    const f = await fixture({ mode, error: null });
    try {
      f.render(); const options = f.inputs.get(mode);
      assert.equal(options.placeholderData, undefined);
      assert.deepEqual(options.queryKey, ["conversations", "paged", mode, "recent_read", "desc"]);
      await options.queryFn({ pageParam: 100, signal: new AbortController().signal });
      assert.equal(f.apiReads[0].scope, "all"); assert.equal(f.apiReads[0].statusScope, mode);
      assert.equal(f.apiReads[0].offset, 100); assert.equal(f.apiReads[0].limit, 101);
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

test("large lists can reach items beyond 5,000 without claiming an unloaded total", async () => {
  const rows = Array.from({ length: 5001 }, (_, index) => ({
    ...row("active"), id: `synthetic-large-${index}`, title: `Synthetic item ${index}`, display_title: `Synthetic item ${index}`,
  }));
  const f = await fixture({ rows, error: null, selected: true });
  try {
    assert.match(f.render(), /100 loaded, more available/);
    assert.equal(f.inputs.get("selection").loadedOnly, true);
    const options = f.inputs.get("active");
    for (let offset = 0; offset <= 5000; offset += 100) {
      const page = await options.queryFn({ pageParam: offset, signal: new AbortController().signal });
      assert.equal(page.items[0].id, `synthetic-large-${offset}`);
      assert.equal(options.getNextPageParam(page), offset < 5000 ? offset + 100 : undefined);
    }
    await f.main.fetchNextPage();
    assert.match(f.render(), /200 loaded, more available/);
    assert.equal(new Set(f.main.getCurrentResult().data.pages.flatMap(page => page.items.map(item => item.id))).size, 200);
  } finally { f.dispose(); }
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

for (const mode of ["active", "archived"]) for (const count of [499, 500, 501]) {
  test(`${mode}: custom order permits at most 500 fully loaded conversations (${count})`, async () => {
    const rows = Array.from({ length: count }, (_, index) => ({ ...row(mode), id: `synthetic-order-${index}` }));
    const f = await fixture({ mode, rows, error: null, sortMode: "custom", direction: "asc" });
    try {
      f.render();
      assert.ok(f.sortableRows.every(item => item.disabled));
      await f.drag(rows[0].id, rows[1].id);
      assert.deepEqual(f.orderWrites, []);
      while (f.main.getCurrentResult().hasNextPage) {
        await f.main.fetchNextPage();
        const html = f.render();
        if (count === 501 && f.sortableRows.length === 500) {
          assert.match(html, /500-conversation custom-order API limit/);
          assert.doesNotMatch(html, /Load all conversations before custom drag ordering/);
        }
      }
      const html = f.render();
      assert.equal(f.sortableRows.length, count);
      assert.ok(f.sortableRows.every(item => item.disabled === (count > 500)));
      await f.drag(rows[0].id, rows[1].id);
      assert.equal(f.orderWrites.length, count <= 500 ? 1 : 0);
      if (count <= 500) assert.deepEqual(f.orderWrites[0], [rows[1].id, rows[0].id, ...rows.slice(2).map(item => item.id)]);
      else assert.match(html, /500-conversation custom-order API limit/);
    } finally { f.dispose(); }
  });
}

for (const direction of ["asc", "desc"]) {
  test(`custom ${direction}: saved ranks preserve visible order within server pin priorities`, async () => {
    const rows = [
      ...["pin-new", "pin-same-a", "pin-same-b", "pin-old", "plain-a", "plain-b"].map(id => ({ ...row("active"), id })),
    ].map((item, index) => ({ ...item, is_global_pinned: index < 4,
      global_pinned_at: index === 0 ? "2026-01-03T00:00:00Z" : index < 3 ? "2026-01-02T00:00:00Z" : index === 3 ? "2026-01-01T00:00:00Z" : null }));
    const f = await fixture({ rows, error: null, sortMode: "custom", direction });
    try {
      f.render();
      // Different pin timestamps outrank manual rank, just like pin status.
      await f.drag("pin-new", "pin-same-a");
      await f.drag("pin-old", "plain-a");
      assert.deepEqual(f.orderWrites, []);
      await f.drag("plain-a", "plain-b");
      const expected = ["pin-new", "pin-same-a", "pin-same-b", "pin-old", "plain-b", "plain-a"];
      const canonical = direction === "asc" ? expected
        : ["pin-new", "pin-same-b", "pin-same-a", "pin-old", "plain-a", "plain-b"];
      assert.deepEqual(f.orderWrites[0], canonical);
      const ranks = new Map(canonical.map((id, index) => [id, index]));
      const reloaded = [...rows].sort((a, b) =>
        Number(b.is_global_pinned) - Number(a.is_global_pinned)
        || (b.global_pinned_at ?? "").localeCompare(a.global_pinned_at ?? "")
        || (ranks.get(a.id) - ranks.get(b.id)) * (direction === "asc" ? 1 : -1));
      assert.deepEqual(reloaded.map(item => item.id), expected);
      await f.drag("pin-same-a", "pin-same-b");
      assert.deepEqual(f.orderWrites[1], direction === "asc"
        ? ["pin-new", "pin-same-b", "pin-same-a", "pin-old", "plain-a", "plain-b"]
        : ["pin-new", "pin-same-a", "pin-same-b", "pin-old", "plain-b", "plain-a"]);
    } finally { f.dispose(); }
  });
}
