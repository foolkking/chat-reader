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
const project = { id: "synthetic-sidebar-project", name: "Synthetic sidebar project", is_default: false,
  is_archived: false, conversation_count: 1, pinned_count: 0 };
const conversation = (id, projectId = null) => ({ id, title: `Synthetic ${id}`, display_title: `Synthetic ${id}`,
  first_user_message: "Synthetic preview", project_id: projectId, project_name: projectId ? project.name : null,
  status: "active", offline_revision: 1, message_count: 2, project_relation: { is_pinned: false } });
const history = conversation("synthetic-sidebar-history"), branch = conversation("synthetic-sidebar-project-row", project.id);
const defaults = { projects: [project], history: [history], branch: [branch] };
const keys = { projects: ["projects", "custom", "asc"], history: ["conversations", "history", "recent_read", "desc"],
  branch: ["project-conversations", project.id, "recent_read", "desc"] };
const identity = { projects: project.name, history: history.title, branch: branch.title };
const href = { projects: `/projects/${project.id}`, history: `/conversations/${history.id}`, branch: `/conversations/${branch.id}?projectId=${project.id}` };
const dropId = { projects: `project-order-slot-${project.id}`, history: `conversation-row-${history.id}`, branch: `conversation-row-${branch.id}` };
const stale = { projects: "Could not update projects. Previously loaded items are shown.",
  history: "Could not update conversations. Previously loaded items are shown.",
  branch: "Could not update project conversations. Previously loaded items are shown." };
const initial = { projects: "Could not load projects.", history: "Could not load conversations.", branch: "Could not load project conversations." };
const chinese = { projects: "项目更新失败，仍显示上次内容。", history: "对话更新失败，仍显示上次内容。", branch: "项目对话更新失败，仍显示上次内容。" };
const translations = { projects: "Projects", unclassified: "Unclassified", loadingProjects: "Loading projects…", noUnclassified: "No unclassified conversations" };
class ApiRequestError extends Error { constructor(status) { super("Synthetic raw upstream detail"); this.status = status; } }
const source = readFileSync(new URL("../../apps/web/features/projects/project-sidebar.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("project-sidebar.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ProjectSidebar");
const stateNames = [];
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && node.initializer && ts.isCallExpression(node.initializer)
    && node.initializer.expression.getText(ast) === "useState") stateNames.push(node.name.elements[0].name.getText(ast));
  ts.forEachChild(node, visit);
}
visit(component);
const compiled = ts.transpileModule(source, { fileName: "project-sidebar.tsx", compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;

// Actual full sidebar/branch/history JSX and actual query functions run against
// subscribed installed QueryObservers. Static renders, seeded expansion, DnD,
// browser effects and transport are explicit doubles, not React lifecycle,
// live DOM identity/focus, drag placement or network-outage acceptance.
async function fixture({ scope = "history", cached = true, rows = defaults[scope], error = new ApiRequestError(503),
  locale = "en-US", expanded = scope === "branch", prepareRead = true } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const data = { ...defaults, [scope]: rows }, errors = { projects: null, history: null, branch: null, [scope]: error };
  const holds = {}, observers = new Map(), stops = [], inputs = new Map(), retryButtons = [], requests = [], writes = [], navigation = [];
  for (const name of Object.keys(keys)) if (name !== scope || cached) client.setQueryData(keys[name], data[name]);
  let stateIndex = 0;
  const RenderedRetry = props => { retryButtons.push(props); return React.createElement("button", props); };
  const capture = factory => (type, props, key) => type === "button" && ["Retry", "重试"].includes(props.children)
    ? factory(RenderedRetry, props, key) : factory(type, props, key);
  const read = async (name, options) => {
    requests.push({ scope: name, options });
    if (holds[name]) await holds[name];
    if (errors[name]) throw errors[name];
    return data[name];
  };
  const mutation = name => async input => { writes.push({ name, input }); throw new Error("A read-recovery test must not write"); };
  const mocks = {
    react: { ...React, useState: initialValue => {
      const name = stateNames[stateIndex++];
      return React.useState(name === "expandedProjects" ? new Set(expanded ? [project.id] : []) : initialValue);
    } },
    "react/jsx-runtime": { ...jsx, jsx: capture(jsx.jsx), jsxs: capture(jsx.jsxs) },
    "react-dom": { createPortal: element => element },
    "@tanstack/react-query": { useQueryClient: () => client, useMutation: input => ({ isPending: false, isError: false,
      mutate: variables => input.mutationFn(variables) }), useQuery: input => {
      const name = input.queryKey[0] === "projects" ? "projects" : input.queryKey[0] === "project-conversations" ? "branch" : "history";
      inputs.set(name, input);
      if (!observers.has(name)) {
        const observer = new QueryObserver(client, { ...input, enabled: false, retry: false });
        observers.set(name, observer); stops.push(observer.subscribe(noop));
      }
      return observers.get(name).getCurrentResult();
    } },
    "@dnd-kit/core": { DndContext: childrenOnly, DragOverlay: () => null, useSensor: noop, useSensors: noop,
      useDraggable: () => ({ setNodeRef: noop, attributes: {}, listeners: {} }), useDroppable: () => ({ setNodeRef: noop }),
      useDndContext: () => ({ active: null }) },
    "@dnd-kit/sortable": { SortableContext: childrenOnly, useSortable: () => ({ setNodeRef: noop, attributes: {}, listeners: {} }) },
    "@dnd-kit/utilities": { CSS: { Transform: { toString: noop }, Translate: { toString: noop } } },
    "next/link": { default: ({ href, children, ...props }) => React.createElement("a", { href, ...props }, children) },
    "next/navigation": { usePathname: () => "/", useRouter: () => ({ push: target => navigation.push(target) }) },
    "../../lib/api": { ApiRequestError, getProjects: options => read("projects", options),
      getConversations: options => read("history", options), getProjectConversations: (id, options) => read("branch", { id, ...options }),
      createProject: mutation("createProject"), placeConversation: mutation("placeConversation"), placeProject: mutation("placeProject") },
    "../conversations/conversation-action-menu": { ConversationActionMenu: () => null },
    "../conversations/conversation-placement": { useConversationPlacement: () => ({}), ConversationPlacementSurface: () => null },
    "../conversations/new-conversation-dialog": { NewConversationDialog: () => null },
    "../import/import-task-monitor": { ImportTaskMonitor: () => null },
    "./project-symbol": { ProjectSymbol: () => null },
    "../import/task-center-dialog": { TaskCenterDialog: () => null },
    "../../components/reader-sidebar-frame": { ReaderSidebarFrame: childrenOnly },
    "../../components/sidebar-preferences": { SidebarPreferences: () => null },
    "../../components/preferences-provider": { usePreferences: () => ({ resolvedLocale: locale, conversationSortMode: "recent_read", conversationSortDirection: "desc" }),
      useTranslations: () => key => translations[key] ?? key },
    "../../components/import-dialog-provider": { useImportDialog: () => ({ openImportDialog: noop }) },
    "../search/sidebar-search": { SidebarSearch: () => null },
    "../../components/sort-menu": { ConversationSortMenu: () => null },
    "../../lib/activity-time": { formatActivityTime: () => "Synthetic time", fullActivityTime: () => "Synthetic time" },
    "./project-action-menu": { ProjectActionMenu: () => null, ProjectArchiveFeedback: () => null, useProjectArchive: () => ({}) },
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith(".")) throw new Error(`Unexpected sidebar dependency: ${name}`);
    return appRequire(name);
  }, module, module.exports);
  const render = () => { stateIndex = 0; retryButtons.length = 0;
    return renderToStaticMarkup(React.createElement(module.exports.ProjectSidebar)); };
  render();
  if (prepareRead) await observers.get(scope).refetch();
  return { client, observers, inputs, render, retryButtons, requests, writes, navigation,
    reads: name => requests.filter(item => item.scope === name).length,
    recover: () => { errors[scope] = null; }, fail: next => { errors[scope] = next; },
    holdRead: () => { let release; holds[scope] = new Promise(resolve => { release = resolve; });
      return () => { delete holds[scope]; release(); }; },
    dispose: () => { stops.forEach(stop => stop()); observers.forEach(observer => observer.destroy()); client.clear(); },
  };
}

for (const scope of ["projects", "history", "branch"]) {
  test(`${scope}: successful reads preserve the existing real links, drop ids and query scope (control)`, async () => {
    const f = await fixture({ scope, error: null });
    try {
      const html = f.render(); assert.ok(html.includes(`href="${href[scope]}"`));
      assert.ok(html.includes(`data-testid="${dropId[scope]}"`)); assert.doesNotMatch(html, /role="alert"/);
      assert.deepEqual(f.inputs.get(scope).queryKey, keys[scope]);
      assert.equal(f.reads(scope), 1); assert.deepEqual(f.writes, []); assert.deepEqual(f.navigation, []);
    } finally { f.dispose(); }
  });

  test(`${scope}: a transient failure retains its actual reading link/drop identifier with localized recovery`, async () => {
    const f = await fixture({ scope });
    try {
      assert.equal(f.observers.get(scope).getCurrentResult().isError, true);
      assert.equal(f.observers.get(scope).getCurrentResult().data.length, 1);
      const html = f.render();
      assert.ok(html.includes(`href="${href[scope]}"`), "cached reading link must remain");
      assert.ok(html.includes(`data-testid="${dropId[scope]}"`), "existing drop row must remain");
      assert.ok(html.includes(stale[scope]), "retained-content notice must describe the affected region");
      assert.match(html, /role="alert"/); assert.doesNotMatch(html, /Synthetic raw upstream detail/);
      assert.equal(f.retryButtons.length, 1);
    } finally { f.dispose(); }
  });

  for (const cached of [false, true]) {
    test(`${scope}: ${cached ? "empty cached" : "initial"} failure is an error, not empty guidance`, async () => {
      const f = await fixture({ scope, rows: [], cached });
      try {
        const html = f.render(); assert.ok(html.includes(initial[scope]), "initial read error must name this region");
        assert.doesNotMatch(html, /Previously loaded|Synthetic raw upstream detail/);
        if (scope === "branch") assert.doesNotMatch(html, /Drag conversations here|拖动对话到这里/);
        if (scope === "history") assert.doesNotMatch(html, /No unclassified conversations/);
        assert.equal(f.retryButtons.length, 1);
      } finally { f.dispose(); }
    });
  }

  test(`${scope}: Retry only repeats its original GET and keeps the current reading route`, async () => {
    const f = await fixture({ scope });
    try {
      f.render(); assert.equal(f.retryButtons.length, 1); f.recover();
      f.retryButtons[0].onClick(); await setImmediate();
      assert.equal(f.reads(scope), 2);
      for (const other of Object.keys(keys).filter(name => name !== scope)) assert.equal(f.reads(other), 0);
      assert.deepEqual(f.requests[0], f.requests[1]);
      const expected = scope === "projects" ? { sort: "custom", direction: "asc" }
        : scope === "history" ? { scope: "history", sort: "recent_read", direction: "desc", limit: 5000 }
          : { id: project.id, sort: "recent_read", direction: "desc", limit: 5000 };
      assert.deepEqual(f.requests[1].options, expected);
      assert.deepEqual(f.writes, []); assert.deepEqual(f.navigation, []);
      assert.ok(f.render().includes(`href="${href[scope]}"`)); assert.equal(f.retryButtons.length, 0);
    } finally { f.dispose(); }
  });

  test(`${scope}: held Retry retains cached rows and disables only the pending read control`, async () => {
    const f = await fixture({ scope }); let release = noop;
    try {
      f.render(); assert.equal(f.retryButtons.length, 1); f.recover(); release = f.holdRead();
      f.retryButtons[0].onClick(); await setImmediate();
      const html = f.render(); assert.ok(html.includes(`href="${href[scope]}"`));
      assert.equal(f.retryButtons[0].disabled, true); assert.match(html, /aria-busy="true"/);
      assert.deepEqual(f.writes, []); assert.equal(f.reads(scope), 2);
    } finally { release(); await setImmediate(); f.dispose(); }
  });

  for (const status of [401, 403, 404]) {
    test(`${scope}: HTTP ${status} hides retained private rows without exposing raw details`, async () => {
      const f = await fixture({ scope, error: new ApiRequestError(status) });
      try {
        const html = f.render();
        assert.equal(f.observers.get(scope).getCurrentResult().data.length, 1);
        assert.ok(!html.includes(identity[scope]), "access-unavailable data must not remain visible");
        assert.ok(!html.includes(`data-testid="${dropId[scope]}"`));
        assert.doesNotMatch(html, /Previously loaded|Synthetic raw upstream detail/);
        assert.ok(html.includes(initial[scope])); assert.equal(f.retryButtons.length, 1);
      } finally { f.dispose(); }
    });
  }

  test(`${scope}: a successful empty result has no error or retry`, async () => {
    const f = await fixture({ scope, rows: [], error: null });
    try {
      const html = f.render(); assert.equal(f.retryButtons.length, 0); assert.doesNotMatch(html, /role="alert"/);
      if (scope === "branch") { assert.match(html, /Drag conversations here/); assert.doesNotMatch(html, /拖动对话到这里/); }
      if (scope === "history") assert.match(html, /No unclassified conversations/);
    } finally { f.dispose(); }
  });

  test(`${scope}: Chinese cached-read recovery is localized`, async () => {
    const f = await fixture({ scope, locale: "zh-CN" });
    try { const html = f.render(); assert.ok(html.includes(chinese[scope])); assert.match(html, />重试</); }
    finally { f.dispose(); }
  });

  test(`${scope}: an initial held read is busy loading, never confirmed empty`, async () => {
    const f = await fixture({ scope, cached: false, rows: [], error: null, prepareRead: false }); let release = noop;
    try {
      release = f.holdRead(); void f.observers.get(scope).refetch(); await setImmediate();
      const html = f.render(); assert.match(html, /aria-busy="true"/); assert.match(html, /role="status"/);
      if (scope === "branch") assert.doesNotMatch(html, /Drag conversations here|拖动对话到这里/);
      if (scope === "history") assert.doesNotMatch(html, /No unclassified conversations/);
      assert.deepEqual(f.writes, []);
    } finally { release(); await setImmediate(); f.dispose(); }
  });
}

for (const scope of ["projects", "branch"]) {
  test(`${scope}: the existing transient-error path already keeps cached rows (control)`, async () => {
    const f = await fixture({ scope });
    try { assert.ok(f.render().includes(`href="${href[scope]}"`)); assert.equal(f.observers.get(scope).getCurrentResult().isError, true); }
    finally { f.dispose(); }
  });
}

test("a collapsed project already disables its branch query (control)", async () => {
  const f = await fixture({ scope: "history", expanded: false, error: null });
  try { f.render(); assert.equal(f.inputs.get("branch").enabled, false); assert.equal(f.reads("branch"), 0); }
  finally { f.dispose(); }
});

test("project sidebar excludes archived/default records even when an existing cache contains them", async () => {
  const f = await fixture({ scope: "projects", rows: [project, { ...project, id: "synthetic-archived", name: "Synthetic archived project", is_archived: true },
    { ...project, id: "synthetic-default", name: "Synthetic default project", is_default: true }], error: null });
  try {
    const html = f.render(); assert.match(html, /Synthetic sidebar project/);
    assert.doesNotMatch(html, /Synthetic archived project|Synthetic default project/);
  } finally { f.dispose(); }
});

test("retrying Unclassified does not fetch a collapsed project branch", async () => {
  const f = await fixture({ scope: "history", expanded: false });
  try {
    f.render(); assert.equal(f.inputs.get("branch").enabled, false);
    assert.equal(f.retryButtons.length, 1); f.recover(); f.retryButtons[0].onClick(); await setImmediate();
    assert.equal(f.reads("branch"), 0); assert.equal(f.reads("projects"), 0); assert.equal(f.reads("history"), 2);
    assert.deepEqual(f.writes, []);
  } finally { f.dispose(); }
});
