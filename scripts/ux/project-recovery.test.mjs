import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { URL } from "node:url";

const appRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = appRequire("typescript");
const React = appRequire("react");
const { renderToStaticMarkup } = appRequire("react-dom/server");
const query = appRequire("@tanstack/react-query");
const noop = () => {};
const childrenOnly = ({ children }) => children;
const project = {
  id: "synthetic-project", name: "Synthetic original name", description: "Synthetic original description",
  color: "#0f766e", icon: "folder", is_default: false, is_archived: false,
  conversation_count: 1, pinned_count: 0,
};
const row = {
  id: "synthetic-conversation", title: "Synthetic retained conversation", display_title: "Synthetic retained conversation",
  first_user_message: "Synthetic retained preview", message_count: 2,
  project_relation: { is_pinned: false },
};

class ApiRequestError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

// Execute actual component callbacks/JSX with installed React and QueryObserver.
// API, DOM portals and unrelated child components are explicit doubles. Static
// markup cannot verify browser layout, effects, focus, hydration or user input.
function loadComponent(relativePath, mocks) {
  const source = readFileSync(new URL(`../../apps/web/${relativePath}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    fileName: relativePath,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  const requireModule = (name) => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith(".")) throw new Error(`Unexpected component dependency: ${name}`);
    return appRequire(name);
  };
  new Function("require", "module", "exports", "document", compiled)(requireModule, module, module.exports, { body: {} });
  return module.exports;
}

function settingsFixture({ opening = project, draft = {}, onChanged = noop, saveError = null, canonical = {} } = {}) {
  const client = new query.QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: Infinity } } });
  const keys = [["projects", "custom", "asc"], ["projects", "title", "desc"], ["projects", "search-filter"], ["projects", "archived"]];
  const other = { ...project, id: "synthetic-other", name: "Synthetic other project" };
  for (const key of keys) client.setQueryData(key, [opening, other]);
  const display = { name: opening.name, description: opening.description ?? "", color: opening.color ?? "#0f766e", icon: opening.icon ?? "folder" };
  const overrides = new Map(Object.entries(draft).map(([field, value]) => [display[field], value]));
  let options;
  let closed = 0;
  const writes = [];
  const saved = { ...opening, ...draft, updated_at: "2026-10-09T00:00:00.000Z", ...canonical };
  const { ProjectSettingsDialog } = loadComponent("features/projects/project-settings-dialog.tsx", {
    react: { ...React, useState: (initial) => React.useState(overrides.has(initial) ? overrides.get(initial) : initial) },
    "react-dom": { createPortal: (element) => element },
    "@tanstack/react-query": {
      useQueryClient: () => client,
      useMutation: (input) => { options = input; return { isPending: false, isError: false, reset: noop }; },
    },
    "../../lib/api": { updateProject: async (id, patch) => { writes.push({ id, patch }); if (saveError) throw saveError; return saved; } },
    "../../components/preferences-provider": { usePreferences: () => ({ resolvedLocale: "en-US" }) },
    "../../components/use-dialog-focus": { useDialogFocus: noop },
    "../../components/use-unsaved-close": { useUnsavedClose: ({ onClose }) => onClose },
    "./project-symbol": { ProjectSymbol: () => null, projectSymbols: [] },
  });
  renderToStaticMarkup(React.createElement(ProjectSettingsDialog, {
    project: opening, open: true, onClose: () => { closed += 1; }, onChanged,
  }));
  const observer = new query.MutationObserver(client, options);
  return { client, observer, writes, saved, other, keys, closed: () => closed };
}

test("description-only settings changes do not submit untouched opening metadata", async () => {
  const fixture = settingsFixture({ draft: { description: "Synthetic revised description" } });
  try {
    await fixture.observer.mutate();
    assert.deepEqual(fixture.writes, [{ id: project.id, patch: { description: "Synthetic revised description" } }]);
  } finally { fixture.client.clear(); }
});

test("untouched null color and icon are not replaced with display defaults", async () => {
  const fixture = settingsFixture({ opening: { ...project, color: null, icon: null }, draft: { name: "Synthetic edited name" } });
  try {
    await fixture.observer.mutate();
    assert.deepEqual(fixture.writes[0].patch, { name: "Synthetic edited name" });
  } finally { fixture.client.clear(); }
});

test("confirmed settings save closes and settles before held follow-up reads", async () => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const fixture = settingsFixture({ draft: { name: "Synthetic edited name" }, onChanged: () => held });
  const pending = fixture.observer.mutate();
  try {
    await setImmediate();
    assert.equal(fixture.writes.length, 1);
    assert.equal(fixture.closed(), 1);
    assert.equal(fixture.observer.getCurrentResult().status, "success");
  } finally { release(); await pending; fixture.client.clear(); }
});

test("rejecting refresh cannot change a confirmed save into a mutation error", async () => {
  const fixture = settingsFixture({
    draft: { name: "Synthetic edited name" },
    onChanged: async () => { throw new Error("Synthetic refresh failed"); },
  });
  try {
    const result = await fixture.observer.mutate().then(() => "success", () => "error");
    await setImmediate();
    assert.equal(result, "success");
    assert.equal(fixture.closed(), 1);
    assert.equal(fixture.writes.length, 1);
  } finally { fixture.client.clear(); }
});

test("all existing project cache variants receive the canonical save without changing other projects", async () => {
  const fixture = settingsFixture({
    draft: { name: "Synthetic edited name" },
    canonical: { description: "Synthetic unrelated remote description", icon: "star" },
  });
  try {
    await fixture.observer.mutate();
    for (const key of fixture.keys) assert.deepEqual(fixture.client.getQueryData(key), [fixture.saved, fixture.other]);
  } finally { fixture.client.clear(); }
});

test("dirty metadata is normalized and clearing a description sends explicit null", async () => {
  const fixture = settingsFixture({ draft: { name: "  Synthetic revised name  ", description: " \n " } });
  try {
    await fixture.observer.mutate();
    assert.deepEqual(fixture.writes[0].patch, { name: "Synthetic revised name", description: null });
  } finally { fixture.client.clear(); }
});

test("whitespace-only changes do not resubmit untouched metadata", async () => {
  const fixture = settingsFixture({ draft: { name: ` ${project.name} `, description: ` ${project.description} ` } });
  try {
    await fixture.observer.mutate();
    assert.deepEqual(fixture.writes[0].patch, {});
  } finally { fixture.client.clear(); }
});

test("synchronous follow-up callback failure does not reject the confirmed save", async () => {
  const fixture = settingsFixture({
    draft: { name: "Synthetic edited name" },
    onChanged: () => { throw new Error("Synthetic synchronous refresh failure"); },
  });
  try {
    await fixture.observer.mutate();
    await setImmediate();
    assert.equal(fixture.closed(), 1);
    assert.equal(fixture.observer.getCurrentResult().status, "success");
  } finally { fixture.client.clear(); }
});

test("rejected writes preserve the open form and existing caches without refreshing", async () => {
  let refreshed = 0;
  const fixture = settingsFixture({
    draft: { name: "Synthetic edited name" }, saveError: new Error("Synthetic write rejected"),
    onChanged: () => { refreshed += 1; },
  });
  try {
    await assert.rejects(fixture.observer.mutate(), /Synthetic write rejected/);
    assert.equal(fixture.closed(), 0);
    assert.equal(refreshed, 0);
    assert.equal(fixture.observer.getCurrentResult().status, "error");
    for (const key of fixture.keys) assert.deepEqual(fixture.client.getQueryData(key), [project, fixture.other]);
  } finally { fixture.client.clear(); }
});

test("late cancelled reads cannot replace confirmed metadata and active refresh does not delay success", async () => {
  let releaseOld;
  let releaseFresh;
  const oldRead = new Promise((resolve) => { releaseOld = resolve; });
  const freshRead = new Promise((resolve) => { releaseFresh = resolve; });
  const fixture = settingsFixture({ draft: { name: "Synthetic edited name" } });
  const signals = [];
  const reader = new query.QueryObserver(fixture.client, {
    queryKey: fixture.keys[0], retry: false, staleTime: 0,
    queryFn: ({ signal }) => { signals.push(signal); return signals.length === 1 ? oldRead : freshRead; },
  });
  const stop = reader.subscribe(noop);
  try {
    await setImmediate();
    assert.equal(signals.length, 1);
    await fixture.observer.mutate();
    assert.equal(fixture.closed(), 1);
    assert.equal(fixture.observer.getCurrentResult().status, "success");
    assert.equal(signals[0].aborted, true);
    assert.equal(signals.length, 2);
    assert.equal(reader.getCurrentResult().isFetching, true);
    releaseOld([project, fixture.other]);
    await setImmediate();
    assert.deepEqual(fixture.client.getQueryData(fixture.keys[0]), [fixture.saved, fixture.other]);
    releaseFresh([fixture.saved, fixture.other]);
    await setImmediate();
    assert.equal(reader.getCurrentResult().isFetching, false);
    assert.deepEqual(fixture.client.getQueryData(fixture.keys[0]), [fixture.saved, fixture.other]);
  } finally {
    releaseOld([project, fixture.other]);
    releaseFresh([fixture.saved, fixture.other]);
    stop(); fixture.client.clear();
  }
});

async function listFixture({ cached = true, rows = [row], error = new Error("Synthetic raw upstream detail"), locale = "en-US", selectedIds = [] } = {}) {
  const client = new query.QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  let reads = 0;
  const observer = new query.QueryObserver(client, {
    queryKey: ["project-conversations", project.id, "recent_read", "desc"],
    initialData: cached ? rows : undefined,
    enabled: false,
    queryFn: async () => { reads += 1; if (error) throw error; return rows; },
  });
  await observer.refetch();
  let options;
  let stateIndex = 0;
  const retryButtons = [];
  const jsxRuntime = appRequire("react/jsx-runtime");
  const captureJsx = (factory) => (type, props, key) => {
    if (type === "button" && ["Retry", "重试"].includes(props.children)) retryButtons.push(props);
    return factory(type, props, key);
  };
  const { ProjectConversationList } = loadComponent("features/projects/project-conversation-list.tsx", {
    react: { ...React, useState: (initial) => {
      const index = stateIndex++;
      return React.useState(index === 0 ? new Set(selectedIds) : index === 1 ? selectedIds.length > 0 : initial);
    } },
    "react/jsx-runtime": { ...jsxRuntime, jsx: captureJsx(jsxRuntime.jsx), jsxs: captureJsx(jsxRuntime.jsxs) },
    "@tanstack/react-query": {
      useQueryClient: () => client,
      useQuery: (input) => {
        if (input.queryKey[0] === "projects") return { data: [project], isFetching: false };
        options = input;
        return observer.getCurrentResult();
      },
    },
    "@dnd-kit/core": { DndContext: childrenOnly, DragOverlay: () => null, useSensor: noop, useSensors: noop },
    "@dnd-kit/sortable": { SortableContext: childrenOnly, useSortable: () => ({ setNodeRef: noop }) },
    "@dnd-kit/utilities": { CSS: { Transform: { toString: noop } } },
    "../../lib/api": { ApiRequestError },
    "../conversations/conversation-action-menu": { ConversationActionMenu: () => null },
    "../conversations/conversation-placement": { useConversationPlacement: () => ({}), ConversationPlacementSurface: () => null },
    "../conversations/conversation-undo": {},
    // The page-level merge owner now remains mounted outside selection. Its
    // recovery contract is exercised separately by merge-reentry.test.mjs.
    "../conversations/merge-conversations-dialog": { MergeConversationsDialog: () => null },
    "../conversations/markdown-renderer": { stripLeadingTimestamp: (text) => text },
    "./project-symbol": { ProjectSymbol: () => null },
    "./project-sidebar": { ProjectSidebar: () => null },
    "../../components/sort-menu": { ConversationSortMenu: () => null },
    "../../components/preferences-provider": {
      usePreferences: () => ({ resolvedLocale: locale, conversationSortMode: "recent_read", conversationSortDirection: "desc" }),
    },
    "../../lib/activity-time": { formatActivityTime: () => "Synthetic time", fullActivityTime: () => "Synthetic time" },
    "../../components/interaction-dialog-provider": { useInteractionDialog: () => ({}) },
    "../conversations/use-batch-export": { useBatchExport: () => ({ feedback: null }) },
    "../../components/selection-toolbar": {
      SelectionModeButton: () => null,
      SelectionToolbar: ({ selectedCount }) => React.createElement("aside", { "data-testid": "synthetic-selection-toolbar" }, String(selectedCount)),
    },
    "../../components/use-linear-selection": { useLinearSelection: () => ({ itemHandlers: () => ({}), checkboxClass: () => "flex" }) },
    "../../lib/batch-selection": {},
    "../../components/mobile-page-header": { MobilePageHeader: () => null },
    "../../components/workspace-shell": { useWorkspaceShell: () => ({ embedded: true }) },
    "../../components/hover-preview-link": { HoverPreviewLink: ({ href, children }) => React.createElement("a", { href }, children) },
  });
  const markup = renderToStaticMarkup(React.createElement(ProjectConversationList, { projectId: project.id }));
  return { client, observer, markup, options, retryButtons, reads: () => reads };
}

test("failed refresh keeps same-project cached rows, the real reading link and a safe retry notice", async () => {
  const fixture = await listFixture();
  try {
    assert.equal(fixture.observer.getCurrentResult().isError, true);
    assert.equal(fixture.observer.getCurrentResult().data.length, 1);
    assert.match(fixture.markup, /Synthetic retained conversation/);
    assert.match(fixture.markup, /href="\/conversations\/synthetic-conversation\?projectId=synthetic-project"/);
    assert.match(fixture.markup, /role="alert"/);
    assert.match(fixture.markup, /Previously loaded items are shown/);
    assert.match(fixture.markup, />Retry<\/button>/);
    assert.doesNotMatch(fixture.markup, /Synthetic raw upstream detail/);
  } finally { fixture.client.clear(); }
});

test("initial list failure explains retry without showing an empty project or raw error", async () => {
  const fixture = await listFixture({ cached: false });
  try {
    assert.match(fixture.markup, /Could not load project conversations/);
    assert.match(fixture.markup, /role="alert"/);
    assert.match(fixture.markup, />Retry<\/button>/);
    assert.doesNotMatch(fixture.markup, /No conversations in this project|Synthetic raw upstream detail/);
  } finally { fixture.client.clear(); }
});

test("sort placeholders retain only their own project, never another project's rows", async () => {
  const fixture = await listFixture({ error: null });
  try {
    const previous = [row];
    assert.equal(fixture.options.placeholderData(previous, { queryKey: ["project-conversations", "synthetic-other"] }), undefined);
    assert.equal(fixture.options.placeholderData(previous, { queryKey: ["project-conversations", project.id] }), previous);
  } finally { fixture.client.clear(); }
});

test("missing projects do not expose retained rows as still available", async () => {
  const fixture = await listFixture({ error: new ApiRequestError("Synthetic missing project", 404) });
  try { assert.doesNotMatch(fixture.markup, /Synthetic retained conversation/); }
  finally { fixture.client.clear(); }
});

for (const status of [401, 403, 404]) {
  test(`project HTTP ${status} hides cached rows, metadata and selected bulk actions`, async () => {
    const fixture = await listFixture({ error: new ApiRequestError("Synthetic inaccessible project", status), selectedIds: [row.id] });
    try {
      assert.doesNotMatch(fixture.markup, /Synthetic retained conversation|Synthetic original name|synthetic-selection-toolbar/);
      assert.match(fixture.markup, /This project is unavailable/);
      assert.match(fixture.markup, />Retry<\/button>/);
    } finally { fixture.client.clear(); }
  });
}

test("transient failures preserve selected rows and their selection controls", async () => {
  const fixture = await listFixture({ error: new ApiRequestError("Synthetic unavailable service", 503), selectedIds: [row.id] });
  try {
    assert.match(fixture.markup, /Synthetic retained conversation/);
    assert.match(fixture.markup, /synthetic-selection-toolbar/);
    assert.match(fixture.markup, /checked=""/);
  } finally { fixture.client.clear(); }
});

test("an empty cached list with a failed refresh is not represented as a confirmed empty project", async () => {
  const fixture = await listFixture({ rows: [] });
  try {
    assert.match(fixture.markup, /Could not load project conversations/);
    assert.doesNotMatch(fixture.markup, /No conversations in this project|Previously loaded items are shown/);
  } finally { fixture.client.clear(); }
});

test("the retry control requests only the failed query without dropping its cached data", async () => {
  const fixture = await listFixture();
  try {
    assert.equal(fixture.retryButtons.length, 1);
    assert.equal(fixture.retryButtons[0].disabled, false);
    assert.equal(fixture.reads(), 1);
    fixture.retryButtons[0].onClick();
    await setImmediate();
    assert.equal(fixture.reads(), 2);
    assert.deepEqual(fixture.observer.getCurrentResult().data, [row]);
  } finally { fixture.client.clear(); }
});

test("Chinese project recovery uses localized status and retry labels", async () => {
  const fixture = await listFixture({ locale: "zh-CN" });
  try {
    assert.match(fixture.markup, /项目对话更新失败，仍显示上次内容/);
    assert.match(fixture.markup, />重试<\/button>/);
    assert.doesNotMatch(fixture.markup, /Synthetic raw upstream detail/);
  } finally { fixture.client.clear(); }
});
