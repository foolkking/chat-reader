import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { URL } from "node:url";

const appRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = appRequire("typescript"), React = appRequire("react"), jsx = appRequire("react/jsx-runtime");
const { renderToStaticMarkup } = appRequire("react-dom/server");
const noop = () => {}, childrenOnly = ({ children }) => children;
const ids = ["10000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000002"];
const request = { idempotencyKey: "20000000-0000-4000-8000-000000000001", conversationIds: ids, title: "Synthetic original merge title" };
const task = { job_id: "30000000-0000-4000-8000-000000000001", job_type: "conversation_merge", status: "queued", result: {} };
const projectId = "40000000-0000-4000-8000-000000000001";
const row = id => ({ id, title: "Synthetic current source", display_title: "Synthetic current source", status: "active", message_count: 2, project_relation: { is_pinned: false } });
const source = relative => readFileSync(new URL(`../../apps/web/${relative}`, import.meta.url), "utf8");
class ApiRequestError extends Error { constructor(status) { super("Synthetic list failure"); this.status = status; } }

function load(relative, mocks) {
  const module = { exports: {} };
  const compiled = ts.transpileModule(source(relative), { fileName: relative, compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  new Function("require", "module", "exports", "document", compiled)(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith(".")) throw new Error(`Unexpected component dependency: ${name}`);
    return appRequire(name);
  }, module, module.exports, { body: {} });
  return module.exports;
}

// Actual page/dialog JSX and callbacks. React state setters, data queries,
// admission hydration and portals are explicit doubles; SSR is not browser or
// interactive React lifecycle/focus verification.
function fixture({ projectView = false, state = "empty", open = false, selection = false, pending = true, locale = "en-US", busy = false, status, refreshRejects = false, notice = null, savedOpenScope } = {}) {
  const relative = projectView ? "features/projects/project-conversation-list.tsx" : "features/conversations/conversation-list.tsx";
  const componentName = projectView ? "ProjectConversationList" : "ConversationList";
  const ast = ts.createSourceFile(relative, source(relative), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === componentName);
  const stateNames = [], refNames = [];
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && ts.isCallExpression(node.initializer)
      && node.initializer.expression.getText(ast) === "useState") stateNames.push(node.name.elements[0].name.getText(ast));
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer)
      && node.initializer.expression.getText(ast) === "useRef") refNames.push(node.name.text);
    ts.forEachChild(node, visit);
  }
  visit(component);
  const setters = [], dialogs = [], recoveryButtons = [], freshButtons = [], orders = [], focusOptions = [], admissionOptions = [], writes = [], invalidations = [], refs = {};
  const rows = state === "single" || state === "cached-error" ? [row(ids[0])] : state === "loaded" ? ids.map(row) : [];
  const failed = state.includes("error") || status !== undefined;
  const list = { data: state === "loading" || state === "initial-error" ? undefined : rows,
    isLoading: state === "loading", isSuccess: !failed && state !== "loading", isError: failed,
    isFetching: false, error: status ? new ApiRequestError(status) : new Error("Synthetic list failure"), refetch: async () => {} };
  const admission = { phase: pending ? "unknown" : "idle", request: pending ? request : null, error: null, storageFailed: false,
    start: () => { throw new Error("Opening recovery must not submit"); }, check: () => { throw new Error("Opening recovery must not fetch"); }, retry: noop, clearError: noop };
  const client = { invalidateQueries: async value => { invalidations.push(value); if (refreshRejects) throw new Error("Synthetic refresh failure"); }, setQueriesData: noop, setQueryData: noop };
  const capture = factory => (type, props, key) => {
    if (type === "button" && ["Review merge request", "核对原合并"].includes(props.children)) recoveryButtons.push(props);
    if (type === "button" && ["Merge", "合并对话"].includes(props.children)) freshButtons.push(props);
    return factory(type, props, key);
  };
  const actualDialog = load("features/conversations/merge-conversations-dialog.tsx", {
    react: React, "react-dom": { createPortal: element => element },
    "react/jsx-runtime": { ...jsx, jsx: capture(jsx.jsx), jsxs: capture(jsx.jsxs) },
    "@tanstack/react-query": { useQueryClient: () => client, useQuery: () => ({ data: { maximum_merge_message_count: 1000 } }) },
    "../../lib/api": { ApiRequestError }, "../../lib/auth-client": {},
    "../../components/support-limit-action": { SupportLimitAction: () => null },
    "../../components/use-dialog-focus": { useDialogFocus: options => focusOptions.push(options) },
    "../../components/preferences-provider": { usePreferences: () => ({ resolvedLocale: locale }) },
    "./merge-order-list": { MergeOrderList: props => { orders.push(props); return null; } },
    "./use-merge-admission": { useMergeAdmission: options => { admissionOptions.push(options); return admission; } },
  });
  const mergeModule = { ...actualDialog, MergeConversationsDialog: props => { dialogs.push(props); return React.createElement(actualDialog.MergeConversationsDialog, props); } };
  const overrides = { selectedConversationIds: new Set(selection ? rows.map(item => item.id) : []), selectionMode: selection,
    mergeOrderIds: selection ? rows.map(item => item.id) : [], mergeOpen: open, mergeOpenScope: savedOpenScope ?? (open ? projectId : null), batchNotice: notice,
    isMerging: busy, bulkBusy: busy ? "merge" : null };
  let stateIndex = 0, refIndex = 0;
  const mocks = {
    react: { ...React, useState: initial => { const name = stateNames[stateIndex++]; return [Object.hasOwn(overrides, name) ? overrides[name] : typeof initial === "function" ? initial() : initial, value => setters.push({ name, value })]; },
      useRef: initial => { const ref = React.useRef(initial); refs[refNames[refIndex++]] = ref; return ref; } },
    "react/jsx-runtime": { ...jsx, jsx: capture(jsx.jsx), jsxs: capture(jsx.jsxs) },
    "@tanstack/react-query": { useQueryClient: () => client, useQuery: input => input.queryKey[0] === "projects"
      ? { data: [{ id: projectId, name: "Synthetic project", conversation_count: rows.length, pinned_count: 0 }], isFetching: false }
      : input.queryKey[1] === "existence" ? { data: [], isSuccess: true } : list },
    "@dnd-kit/core": { DndContext: childrenOnly, DragOverlay: () => null, useSensor: noop, useSensors: noop },
    "@dnd-kit/sortable": { SortableContext: childrenOnly, useSortable: () => ({ setNodeRef: noop }) },
    "@dnd-kit/utilities": { CSS: { Transform: { toString: noop } } },
    "../../lib/api": { ApiRequestError, mergeConversations: async (payload, signal) => { writes.push({ payload, signal }); return task; } },
    "../../components/preferences-provider": { usePreferences: () => ({ resolvedLocale: locale, conversationSortMode: "recent_read", conversationSortDirection: "desc" }) },
    "../../components/sort-menu": { ConversationSortMenu: () => null },
    "../../components/quick-start-guide": { QuickStartGuide: () => null },
    "../../components/interaction-dialog-provider": { useInteractionDialog: () => ({}) },
    "../../components/selection-toolbar": { SelectionModeButton: () => null, SelectionToolbar: childrenOnly },
    "../../components/use-linear-selection": { useLinearSelection: () => ({ itemHandlers: () => ({}), checkboxClass: () => "flex" }) },
    "../../lib/batch-selection": {},
    "../../lib/activity-time": { formatActivityTime: () => "Synthetic time", fullActivityTime: () => "Synthetic time" },
    "../../components/hover-preview-link": { HoverPreviewLink: ({ href, children }) => React.createElement("a", { href }, children) },
    "../../components/mobile-page-header": { MobilePageHeader: () => null },
    "../../components/workspace-shell": { useWorkspaceShell: () => ({ embedded: true }) },
    "./project-symbol": { ProjectSymbol: () => null }, "./project-sidebar": { ProjectSidebar: () => null },
  };
  for (const prefix of ["./", "../conversations/"]) {
    mocks[`${prefix}conversation-action-menu`] = { ConversationActionMenu: () => null };
    mocks[`${prefix}conversation-placement`] = { useConversationPlacement: () => ({}), ConversationPlacementSurface: () => null };
    mocks[`${prefix}conversation-undo`] = {};
    mocks[`${prefix}markdown-renderer`] = { stripLeadingTimestamp: text => text };
    mocks[`${prefix}use-batch-export`] = { useBatchExport: () => ({ feedback: null }) };
    mocks[`${prefix}merge-conversations-dialog`] = mergeModule;
  }
  const page = load(relative, mocks)[componentName];
  const markup = renderToStaticMarkup(React.createElement(page, projectView ? { projectId } : {}));
  return { markup, dialogs, recoveryButtons, freshButtons, orders, focusOptions, admissionOptions, setters, writes, invalidations, refs };
}

for (const projectView of [false, true]) {
  for (const state of ["loading", "empty", "initial-error", "cached-error", "single", "loaded"]) {
    test(`${projectView ? "project" : "all"} ${state}: one recovery owner is reachable without selecting rows`, () => {
      const f = fixture({ projectView, state });
      assert.equal(f.dialogs.length, 1, "page retains its recovery owner outside list/selection branches");
      assert.equal(f.recoveryButtons.length, 1); assert.equal(Boolean(f.recoveryButtons[0].disabled), false);
      assert.doesNotMatch(f.markup, /role="dialog"/, "recovery must not auto-open");
      f.recoveryButtons[0].onClick();
      assert.ok(f.setters.some(change => projectView ? change.name === "mergeOpenScope" && change.value === projectId : change.name === "mergeOpen" && change.value === true));
      assert.equal(f.writes.length, 0); assert.equal(f.invalidations.length, 0);
    });
  }

  test(`${projectView ? "project" : "all"}: open recovery keeps original payload when sources and selection are gone`, () => {
    const f = fixture({ projectView, state: "empty", open: true });
    assert.equal(f.dialogs.length, 1); assert.equal(f.admissionOptions.length, 1);
    assert.equal((f.markup.match(/role="dialog"/g) ?? []).length, 1);
    assert.match(f.markup, /Synthetic original merge title/);
    assert.deepEqual(f.orders[0].conversations.map(item => item.id), ids);
    assert.ok(f.orders[0].conversations.every(item => item.title.startsWith("Previously selected conversation")));
    assert.doesNotMatch(f.markup, new RegExp(ids.join("|")));
  });

  test(`${projectView ? "project" : "all"}: no pending request leaves no recovery notice`, () => {
    const f = fixture({ projectView, pending: false });
    assert.equal(f.dialogs.length, 1); assert.equal(f.recoveryButtons.length, 0);
    assert.doesNotMatch(f.markup, /role="dialog"/);
  });

  test(`${projectView ? "project" : "all"}: accepted recovery closes and preserves its notice even from an empty list`, async () => {
    const f = fixture({ projectView, open: true, busy: true, refreshRejects: true });
    assert.equal(f.dialogs.length, 1);
    f.dialogs[0].onClose();
    assert.ok(!f.setters.some(change => ["mergeOpen", "mergeOpenScope"].includes(change.name)), "ordinary pending close remains guarded");
    f.admissionOptions[0].onAccepted(task);
    await setImmediate();
    assert.ok(f.setters.some(change => projectView ? change.name === "mergeOpenScope" && change.value === null : change.name === "mergeOpen" && change.value === false));
    const notice = f.setters.find(change => change.name === "batchNotice");
    assert.equal(notice.value.props.task, task);
    assert.equal(f.invalidations.length, 1); assert.equal(f.writes.length, 0);
    assert.equal(typeof f.dialogs[0].resultFocus, "function");
    const resultTarget = { synthetic: "result element; no DOM focus performed" };
    f.refs.mergeResultRef.current = resultTarget;
    assert.equal(f.focusOptions[0].restoreFocus(), resultTarget);
    const after = fixture({ projectView, pending: false, notice: notice.value });
    assert.match(after.markup, /Merge request accepted/);
    assert.match(after.markup, /tabindex="-1"[^>]*role="status"/);
  });

  for (const state of ["empty", "single", "loaded"]) {
    test(`${projectView ? "project" : "all"} ${state}: new merges still require two selected conversations`, () => {
      const f = fixture({ projectView, state, selection: true, pending: false });
      // The empty all-list branch has no bulk toolbar; project pages retain it.
      if (!projectView && state === "empty") { assert.equal(f.freshButtons.length, 0); return; }
      assert.equal(f.freshButtons.length, 1);
      assert.equal(f.freshButtons[0].disabled, state !== "loaded");
      if (state === "loaded") { f.freshButtons[0].onClick(); assert.equal(f.writes.length, 0); }
    });
  }
}

for (const status of [401, 403, 404]) {
  test(`project HTTP ${status} keeps inaccessible project metadata and merge actions hidden`, () => {
    const f = fixture({ projectView: true, state: "loaded", status, selection: true, open: true });
    assert.equal(f.dialogs.length, 0); assert.equal(f.recoveryButtons.length, 0);
    assert.doesNotMatch(f.markup, /Synthetic original merge title|Synthetic current source|Synthetic project/);
  });
}

test("Chinese recovery entry names its action without submitting or exposing source IDs", () => {
  const f = fixture({ projectView: true, locale: "zh-CN" });
  assert.equal(f.recoveryButtons.length, 1); assert.match(f.markup, /核对原合并/);
  assert.doesNotMatch(f.markup, new RegExp(ids.join("|"))); assert.equal(f.writes.length, 0);
});

test("a different project's remembered open state cannot open the current project's dialog", () => {
  const f = fixture({ projectView: true, state: "loaded", savedOpenScope: "40000000-0000-4000-8000-000000000002", pending: false });
  assert.equal(f.dialogs.length, 1); assert.equal(f.dialogs[0].open, false);
  assert.doesNotMatch(f.markup, /role="dialog"/); assert.equal(f.writes.length, 0);
});
