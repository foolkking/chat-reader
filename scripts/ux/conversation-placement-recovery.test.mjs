import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

const appRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const React = appRequire("react"), jsx = appRequire("react/jsx-runtime"), ts = appRequire("typescript");
const { renderToStaticMarkup } = appRequire("react-dom/server");
const { QueryClient, QueryObserver } = appRequire("@tanstack/react-query");
const placementPath = "features/conversations/conversation-placement.tsx";
const hasOwner = existsSync(new URL("../../apps/web/" + placementPath, import.meta.url));
const noop = () => {};
const flush = async () => { await setImmediate(); await setImmediate(); };
const project = (id, extra = {}) => ({ id, name: `Synthetic ${id}`, is_default: false, is_archived: false,
  conversation_count: 2, pinned_count: 0, ...extra });
const conversation = (extra = {}) => ({ id: "synthetic-move", title: "Synthetic move", display_title: "Synthetic move",
  status: "active", project_id: "source", project_name: "Synthetic source", offline_revision: 7,
  updated_at: "2026-10-09T00:00:00Z", is_global_pinned: true, last_read_at: "2026-10-08T00:00:00Z",
  reading_progress: 42, description_markdown: "Synthetic description", parser_version: "synthetic-parser", ...extra });
class ApiRequestError extends Error { constructor(status) { super("Synthetic upstream detail"); this.status = status; } }
function textOf(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return textOf(node.props?.children);
}

// Actual transpiled menu/controller/JSX and installed QueryClient/Observer.
// Hook/effect scheduling, focus, portals, project-read state and transport are
// explicit doubles. This is not React lifecycle, browser, or server acceptance.
// The pre-repair path runs the actual original menu, not an imitation of it.
async function fixture({ outcome = "success", locale = "en-US", refresh = "normal", initial = conversation() } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const keys = { projects: ["projects", "custom", "asc"], remote: ["conversation", "remote", initial.id],
    offline: ["conversation", "offline", initial.id], legacy: ["conversation", initial.id],
    list: ["conversations", "active", "title", "asc"], history: ["conversations", "history", "title", "asc"],
    source: ["project-conversations", "source", "title", "asc"], target: ["project-conversations", "target", "title", "asc"],
    recent: ["recent-items"], position: ["reading-position", "remote", initial.id] };
  const other = conversation({ id: "synthetic-other" });
  const relation = { is_pinned: true, pinned_at: "2026-10-08T00:00:00Z", added_at: "2026-10-08T00:00:00Z", sort_order: 3 };
  const recent = { id: "synthetic-recent", conversation_id: initial.id, project_id: initial.project_id,
    last_message_id: "synthetic-anchor", last_opened_at: "2026-10-08T00:00:00Z", open_count: 4,
    context: { block_index: 3, progress: 42 }, conversation: initial };
  const position = { message_id: "synthetic-anchor", scroll_offset: 18, revision: 4 };
  const initialProjects = [project("source"), project("target"), project("another"), project("default", { is_default: true })];
  client.setQueryData(keys.projects, initialProjects);
  for (const key of [keys.remote, keys.offline, keys.legacy]) client.setQueryData(key, initial);
  for (const key of [keys.list, keys.history]) client.setQueryData(key, [initial, other]);
  client.setQueryData(keys.source, [{ ...initial, project_relation: relation }, { ...other, project_relation: relation }]);
  client.setQueryData(keys.target, [{ ...other, project_id: "target", project_relation: relation }]);
  client.setQueryData(keys.recent, [recent]); client.setQueryData(keys.position, position);
  let server = structuredClone(initial), actualProject = initial.project_id, serverProjects = initialProjects;
  let writeOutcome = outcome, checkError = null, projectError = null, readerError = null, scope = "synthetic-scope", unavailable = false;
  let frameNow = null, controller = null, mounted = true, rowVisible = true, epoch = 0, refreshCalls = 0, projectReads = 0;
  const frames = new Map(), definitions = new Map(), holds = new Map(), writes = [], checks = [], failures = [], queryOptions = [];
  const buttons = [], fields = [], forms = [], containers = [], signals = [], focusOptions = [], confirms = [];
  const document = { body: {}, activeElement: null, querySelector: () => null };
  const opener = { isConnected: true, getClientRects: () => [1], focus: () => { document.activeElement = opener; },
    getBoundingClientRect: () => ({ right: 300, bottom: 100 }) };
  document.activeElement = opener;
  const window = { innerWidth: 1440, innerHeight: 900, addEventListener: noop, removeEventListener: noop };
  const observer = new QueryObserver(client, { queryKey: keys.remote, enabled: true, staleTime: Infinity,
    queryFn: async ({ signal }) => {
      signals.push(signal); const snapshot = structuredClone(server), error = readerError;
      if (holds.has("reader")) await holds.get("reader").promise;
      if (error) throw error;
      return snapshot;
    } });
  const unsubscribe = observer.subscribe(noop);
  const captureTask = value => { if (value?.then) Promise.resolve(value).catch(error => failures.push(error)); };
  function inFrame(name, fn, action) {
    if (!frames.has(name)) frames.set(name, { fn, states: [], refs: [], effects: [] });
    const previous = frameNow, f = frames.get(name);
    f.stateIndex = 0; f.refIndex = 0; f.effectIndex = 0; f.seen = true; frameNow = f;
    try { return action(); } finally { frameNow = previous; }
  }
  const effect = (operation, deps) => {
    const f = frameNow, index = f.effectIndex++, previous = f.effects[index];
    f.effects[index] = { operation, deps, cleanup: previous?.cleanup,
      changed: !previous || !deps || !previous.deps || deps.some((value, i) => value !== previous.deps[i]) };
  };
  const hooks = { ...React,
    useState: initialValue => {
      const f = frameNow, index = f.stateIndex++;
      if (!(index in f.states)) f.states[index] = typeof initialValue === "function" ? initialValue() : initialValue;
      return [f.states[index], value => { f.states[index] = typeof value === "function" ? value(f.states[index]) : value; }];
    },
    useRef: initialValue => {
      const f = frameNow, index = f.refIndex++, name = definitions.get(f.fn)?.refs[index];
      if (!(index in f.refs)) f.refs[index] = { current: name === "buttonRef" ? opener : initialValue };
      return f.refs[index];
    },
    useEffect: effect, useLayoutEffect: effect, useMemo: fn => fn(), useCallback: fn => fn(), useId: () => "synthetic-move-dialog",
  };
  const capture = factory => (type, props, key) => {
    if (type === "button") buttons.push(props);
    if (type === "input") fields.push(props);
    if (type === "form") forms.push(props);
    if (typeof type === "string" && props?.onKeyDown) containers.push(props);
    return factory(type, props, key);
  };
  const setProjects = (status, rows) => {
    if (rows) { serverProjects = rows; client.setQueryData(keys.projects, rows); }
    client.getQueryCache().find({ queryKey: keys.projects, exact: true }).setState({
      status: status === "loading" ? "pending" : status,
      fetchStatus: status === "loading" ? "fetching" : "idle",
      error: status === "error" ? new ApiRequestError(503) : null,
    });
  };
  const refetchProjects = async () => {
    projectReads += 1;
    if (holds.has("projects")) await holds.get("projects").promise;
    if (projectError) { setProjects("error"); return { error: projectError, isError: true }; }
    setProjects("success", serverProjects); return { data: serverProjects, isSuccess: true };
  };
  const api = { ApiRequestError,
    getProjects: async () => { projectReads += 1; if (projectError) throw projectError; return serverProjects; },
    placeConversation: async (id, input, signal) => {
      writes.push({ id, input, signal });
      if (holds.has("write")) await holds.get("write").promise;
      if (writeOutcome === "rejected") throw new ApiRequestError(503);
      if (writeOutcome === "conflict" || input.expected_offline_revision !== server.offline_revision) throw new ApiRequestError(409);
      if (writeOutcome === "invalid") throw new ApiRequestError(422);
      if (writeOutcome === "forbidden") throw new ApiRequestError(403);
      const unchanged = actualProject === input.target_project_id;
      actualProject = input.target_project_id;
      server = { ...server, project_id: actualProject,
        project_name: serverProjects.find(item => item.id === actualProject)?.name ?? null,
        offline_revision: server.offline_revision + (unchanged ? 0 : 1), updated_at: "2026-10-09T00:01:00Z" };
      if (writeOutcome === "lost") throw new Error("Synthetic lost acknowledgement");
      if (writeOutcome === "missing-response") return null;
      return { conversation: { ...server, id: writeOutcome === "wrong-id" ? "synthetic-wrong" : server.id },
        placement: { project_id: writeOutcome === "wrong-target" ? "synthetic-wrong" : actualProject, target_section: unchanged ? "pinned" : "normal",
          is_pinned: unchanged, sort_order: unchanged ? relation.sort_order : 12, offline_revision: server.offline_revision },
        source_project_count: 1, target_project_count: 3, unclassified_count: 0 };
    },
    getConversation: async (id, signal) => {
      checks.push({ id, signal }); const snapshot = structuredClone(server), error = checkError;
      if (holds.has("check")) await holds.get("check").promise;
      if (error) throw error;
      return snapshot;
    },
  };
  const common = { react: hooks, "react/jsx-runtime": { ...jsx, jsx: capture(jsx.jsx), jsxs: capture(jsx.jsxs) },
    "react-dom": { createPortal: element => element },
    "@tanstack/react-query": { useQueryClient: () => client, useQuery: options => {
      queryOptions.push(options); const s = client.getQueryState(keys.projects);
      return { ...s, data: s.data, isSuccess: s.status === "success", isError: s.status === "error",
        isLoading: s.status === "pending" && s.fetchStatus === "fetching", isPending: s.status === "pending",
        isFetching: s.fetchStatus === "fetching", refetch: refetchProjects };
    } },
    "next/navigation": { usePathname: () => "/conversations/" + initial.id, useRouter: () => ({ push: noop, replace: noop }) },
    "next/link": { default: ({ children, ...props }) => React.createElement("a", props, children) },
    "../../lib/api": api, "../../lib/offline-access": { authenticationGeneration: () => epoch },
    "../../components/preferences-provider": { usePreferences: () => ({ resolvedLocale: locale }) },
    "../../components/interaction-dialog-provider": { useInteractionDialog: () => ({ confirm: async options => { confirms.push(options); return true; } }) },
    "../../components/use-dialog-focus": { useDialogFocus: options => { focusOptions.push(options); } },
    "./conversation-undo": {}, "./conversation-metadata-dialog": { ConversationMetadataDialog: () => null },
  };
  function load(path) {
    const source = readFileSync(new URL("../../apps/web/" + path, import.meta.url), "utf8");
    const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    for (const node of ast.statements) if (ts.isFunctionDeclaration(node) && node.name) {
      const refs = [];
      const visit = child => {
        if (ts.isVariableDeclaration(child) && child.initializer && ts.isCallExpression(child.initializer)
          && child.initializer.expression.getText(ast) === "useRef" && ts.isIdentifier(child.name)) refs.push(child.name.text);
        ts.forEachChild(child, visit);
      };
      visit(node); definitions.set(node.name.text, { refs });
    }
    const compiled = ts.transpileModule(source, { fileName: path, compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    }, transformers: { before: [context => root => {
      const visit = node => ts.isVoidExpression(node)
        ? context.factory.createCallExpression(context.factory.createIdentifier("__captureTask"), undefined, [ts.visitNode(node.expression, visit)])
        : ts.visitEachChild(node, visit, context);
      return ts.visitNode(root, visit);
    }] } }).outputText;
    const module = { exports: {} };
    new Function("require", "module", "exports", "document", "window", "__captureTask", compiled)(name => {
      if (Object.hasOwn(common, name)) return common[name];
      if (name.startsWith(".")) throw new Error("Unexpected placement dependency: " + name);
      return appRequire(name);
    }, module, module.exports, document, window, captureTask);
    return module.exports;
  }
  const placement = hasOwner ? load(placementPath) : null;
  const menu = load("features/conversations/conversation-action-menu.tsx");
  const onChanged = async () => {
    refreshCalls += 1;
    if (holds.has("refresh")) await holds.get("refresh").promise;
    if (refresh === "throw") throw new Error("Synthetic refresh callback failure");
    await client.invalidateQueries({ queryKey: ["conversations"] });
  };
  const Menu = () => inFrame("menu", "ConversationActionMenu", () => menu.ConversationActionMenu({
    conversation: initial, projectId: "source", onChanged, placement: controller,
  }));
  const Surface = () => inFrame("surface", "ConversationPlacementSurface", () => placement.ConversationPlacementSurface({ placement: controller }));
  const render = ({ effects = true } = {}) => {
    buttons.length = fields.length = forms.length = containers.length = queryOptions.length = focusOptions.length = 0;
    for (const f of frames.values()) f.seen = false;
    if (mounted && placement) controller = inFrame("owner", "useConversationPlacement", () => placement.useConversationPlacement({ scope, unavailable, onChanged }));
    const html = renderToStaticMarkup(React.createElement(React.Fragment, null,
      mounted && controller ? React.createElement(Surface) : null, mounted && rowVisible ? React.createElement(Menu) : null));
    for (const [name, f] of frames) {
      if (!f.seen) { for (const e of f.effects) e.cleanup?.(); frames.delete(name); continue; }
      if (effects) for (const e of f.effects) if (e.changed) { e.changed = false; e.cleanup?.(); e.cleanup = e.operation(); }
    }
    return html;
  };
  const button = label => {
    const found = buttons.find(p => (p["aria-label"] ?? textOf(p.children).trim()) === label);
    assert.ok(found, "Missing rendered action: " + label); return found;
  };
  const click = async label => { captureTask(button(label).onClick({ preventDefault: noop, stopPropagation: noop })); await flush(); return render(); };
  const openMenu = async () => { render(); return click((locale === "zh-CN" ? "管理" : "Manage") + " " + initial.display_title); };
  const open = async () => {
    await openMenu();
    // The original menu keeps its nested picker open across menu dismissal.
    // Do not accidentally toggle that retained picker off in the baseline.
    if (!hasOwner && fields.some(p => p.placeholder === "Search projects" || p.placeholder === "搜索项目")) return render();
    return click(locale === "zh-CN" ? "移动到项目" : "Move to project");
  };
  const select = async id => {
    const radio = fields.find(p => p.type === "radio" && p.value === id);
    if (radio) captureTask(radio.onChange({ target: { value: id } }));
    else captureTask(button(serverProjects.find(item => item.id === id).name).onClick());
    await flush(); return render();
  };
  const submitHandler = () => forms[0]?.onSubmit ?? button(locale === "zh-CN" ? "移动到所选项目" : "Move to selected project").onClick;
  const submit = async () => { captureTask(submitHandler()({ preventDefault: noop })); await flush(); return render(); };
  const search = value => { const input = fields.find(p => p.type !== "radio"); assert.ok(input); input.onChange({ target: { value } }); return render(); };
  const close = async () => hasOwner ? click(locale === "zh-CN" ? "关闭" : "Close") : openMenu();
  const hold = name => { let release; const promise = new Promise(resolve => { release = resolve; }); holds.set(name, { promise, release });
    return () => { holds.delete(name); release(); }; };
  render();
  return { client, keys, initial, other, recent, position, relation, writes, checks, failures, signals, confirms, observer, opener, document,
    render, openMenu, open, select, submit, submitHandler, search, close, hold, button, click,
    fields: () => fields, queryOptions: () => queryOptions, containers: () => containers, focusOptions: () => focusOptions,
    controller: () => controller, refreshCalls: () => refreshCalls, projectReads: () => projectReads,
    setProjects, setOutcome: value => { writeOutcome = value; }, setCheckError: value => { checkError = value; },
    setServer: value => { server = value; }, server: () => server,
    setProjectError: value => { projectError = value; }, setReaderError: value => { readerError = value; },
    setUnavailable: value => { unavailable = value; }, setScope: value => { scope = value; },
    changeAccount: () => { epoch += 1; }, hideRow: () => { rowVisible = false; opener.isConnected = false; },
    unmount: () => { mounted = false; render(); },
    dispose: async () => { mounted = false; render(); for (const item of holds.values()) item.release(); holds.clear(); await flush(); unsubscribe(); observer.destroy(); client.clear(); },
  };
}

test("moving to a project preserves the placement PUT/revision contract (control)", async () => {
  const f = await fixture(); try { await f.open(); await f.select("target"); await f.submit();
    assert.equal(f.writes.length, 1); assert.deepEqual(f.writes[0].input, { target_project_id: "target", target_section: "normal", expected_offline_revision: 7 });
  } finally { await f.dispose(); }
});
test("moving to Unclassified remains one click without a confirmation (control)", async () => {
  const f = await fixture(); try { await f.openMenu(); await f.click("Move to unclassified");
    assert.equal(f.writes.length, 1); assert.equal(f.writes[0].input.target_project_id, null); assert.equal(f.confirms.length, 0);
  } finally { await f.dispose(); }
});
test("unrelated menu actions do not enable project-picker reads", async () => {
  const f = await fixture(); try { await f.openMenu(); assert.ok(f.queryOptions().every(q => !q.enabled)); } finally { await f.dispose(); }
});
test("pending project reads say loading, not no matching projects", async () => {
  const f = await fixture(); try { f.setProjects("loading", []); const html = await f.open();
    assert.match(html, /Loading projects/); assert.doesNotMatch(html, /No matching projects/);
  } finally { await f.dispose(); }
});
test("failed project reads expose a read-only retry instead of an empty result", async () => {
  const f = await fixture(); try { f.setProjects("error", []); const html = await f.open();
    assert.match(html, /role="alert"/); await f.click("Retry projects"); assert.equal(f.projectReads(), 1); assert.equal(f.writes.length, 0);
  } finally { await f.dispose(); }
});
test("a successful empty read is distinct from a filtered empty result", async () => {
  const f = await fixture(); try { f.setProjects("success", [project("default", { is_default: true })]);
    assert.match(await f.open(), /No active projects/);
  } finally { await f.dispose(); }
});
test("a no-match search offers clearing the search without writing", async () => {
  const f = await fixture(); try { await f.open(); assert.match(f.search("missing"), /No matching projects/);
    await f.click("Clear search"); assert.equal(f.fields().find(p => p.type !== "radio").value, ""); assert.equal(f.writes.length, 0);
  } finally { await f.dispose(); }
});
test("search has a permanent label and selection has checked semantics", async () => {
  const f = await fixture(); try { await f.open(); const html = await f.select("target");
    assert.match(html, /<label[^>]*for=/); assert.match(html, /(?:type="radio"[^>]*checked|aria-checked="true")/);
  } finally { await f.dispose(); }
});
test("search Home and End are not consumed by the menu navigation handler", async () => {
  const f = await fixture(); try { await f.open(); let prevented = false;
    const menu = f.containers().find(p => p.role === "menu");
    if (menu) menu.onKeyDown({ key: "Home", target: { tagName: "INPUT" }, preventDefault: () => { prevented = true; }, stopPropagation: noop });
    assert.equal(prevented, false);
  } finally { await f.dispose(); }
});
test("filtering away a selected destination prevents a hidden move", async () => {
  const f = await fixture(); try { await f.open(); await f.select("target"); f.search("another"); await f.submit(); assert.equal(f.writes.length, 0); }
  finally { await f.dispose(); }
});
test("a fresh picker session cannot submit the previous selection", async () => {
  const f = await fixture(); try { await f.open(); await f.select("target"); await f.close(); await f.open(); await f.submit(); assert.equal(f.writes.length, 0); }
  finally { await f.dispose(); }
});
test("a destination removed from the latest read cannot be submitted", async () => {
  const f = await fixture(); try { await f.open(); await f.select("target"); f.setProjects("success", [project("another")]); f.render(); await f.submit(); assert.equal(f.writes.length, 0); }
  finally { await f.dispose(); }
});
test("a failed destination refresh leaves cached choices non-actionable", async () => {
  const f = await fixture(); try { await f.open(); await f.select("target"); f.setProjects("error"); f.render(); await f.submit(); assert.equal(f.writes.length, 0); }
  finally { await f.dispose(); }
});
test("two immediate submit callbacks reserve only one move", async () => {
  const f = await fixture(); try { f.hold("write"); await f.open(); await f.select("target"); const submit = f.submitHandler();
    submit({ preventDefault: noop }); submit({ preventDefault: noop }); assert.equal(f.writes.length, 1);
  } finally { await f.dispose(); }
});
test("lost acknowledgement recovery survives removal of the source row", async () => {
  const f = await fixture({ outcome: "lost" }); try { await f.open(); await f.select("target"); await f.submit(); f.hideRow(); const html = f.render();
    assert.match(html, /could not be confirmed/i); assert.ok(f.button("Check current location")); assert.equal(f.writes.length, 1);
  } finally { await f.dispose(); }
});
test("a failed check keeps uncertainty and never replays placement", async () => {
  const f = await fixture({ outcome: "lost" }); try { await f.open(); await f.select("target"); await f.submit();
    f.setCheckError(new ApiRequestError(503)); const html = await f.click("Check current location");
    assert.match(html, /Could not check/i); assert.equal(f.writes.length, 1); assert.equal(f.checks.length, 1); assert.ok(f.button("Check current location"));
  } finally { await f.dispose(); }
});
test("a successful check is an observation, not a receipt or automatic PUT", async () => {
  const f = await fixture({ outcome: "lost" }); try { await f.open(); await f.select("target"); await f.submit();
    const html = await f.click("Check current location"); assert.match(html, /not a receipt/i); assert.equal(f.writes.length, 1); assert.equal(f.checks.length, 1);
  } finally { await f.dispose(); }
});
test("explicit retry uses the newly reviewed conversation revision", async () => {
  const f = await fixture({ outcome: "lost" }); try { await f.open(); await f.select("target"); await f.submit();
    f.setServer(conversation({ offline_revision: 21, project_id: "another", project_name: "Synthetic another" }));
    await f.click("Check current location"); f.setOutcome("success"); await f.submit();
    assert.equal(f.writes.length, 2); assert.equal(f.writes[1].input.expected_offline_revision, 21);
  } finally { await f.dispose(); }
});
test("a null visible project is not asserted to prove default membership", async () => {
  const f = await fixture({ outcome: "lost" }); try { await f.openMenu(); await f.click("Move to unclassified");
    const html = await f.click("Check current location"); assert.match(html, /archived project/i); assert.match(html, /not a receipt/i); assert.equal(f.writes.length, 1);
  } finally { await f.dispose(); }
});
test("acknowledgement settles before a held owning-list refresh", async () => {
  const f = await fixture(); try { f.hold("refresh"); await f.open(); await f.select("target"); const html = await f.submit();
    assert.match(html, /Move confirmed/); assert.equal(f.refreshCalls(), 1); assert.equal(f.controller()?.busy, false);
  } finally { await f.dispose(); }
});
test("canonical placement updates the existing remote Reader and evicts old membership", async () => {
  const f = await fixture(); try { f.hold("reader"); await f.open(); await f.select("target"); await f.submit();
    assert.equal(f.client.getQueryData(f.keys.remote).project_id, "target"); assert.equal(f.observer.getCurrentResult().isFetching, true);
    assert.equal(f.client.getQueryData(f.keys.remote).parser_version, "synthetic-parser");
    assert.equal(f.client.getQueryData(f.keys.source).some(item => item.id === f.initial.id), false);
    assert.equal(f.client.getQueryData(f.keys.history).some(item => item.id === f.initial.id), false);
    assert.equal(f.client.getQueryData(f.keys.target).some(item => item.id === f.initial.id), false);
  } finally { await f.dispose(); }
});
test("placement does not mutate offline copies, reading anchors or global pin (control)", async () => {
  const f = await fixture(); try { await f.open(); await f.select("target"); await f.submit();
    assert.deepEqual(f.client.getQueryData(f.keys.offline), f.initial); assert.deepEqual(f.client.getQueryData(f.keys.position), f.position);
    const recent = f.client.getQueryData(f.keys.recent)[0]; assert.deepEqual(recent.context, f.recent.context);
    assert.equal(recent.last_message_id, f.recent.last_message_id); assert.equal(f.client.getQueryData(f.keys.list)[0].is_global_pinned, true);
  } finally { await f.dispose(); }
});

for (const change of ["account", "scope"]) test(`a captured entry cannot start after ${change} changes, before effect cleanup`, async () => {
  const f = await fixture(); try {
    const start = f.controller().start;
    if (change === "account") f.changeAccount(); else f.setScope("synthetic-new-scope");
    f.render({ effects: false }); start(f.initial, () => f.opener, true); await flush();
    assert.equal(f.writes.length, 0); assert.equal(f.controller().state, null);
  } finally { await f.dispose(); }
});
test("a captured reviewed submit cannot write after its dialog closes", async () => {
  const f = await fixture({ outcome: "lost" }); try { await f.open(); await f.select("target"); await f.submit(); await f.click("Check current location");
    const submit = f.submitHandler(); await f.close(); submit({ preventDefault: noop }); await flush(); assert.equal(f.writes.length, 1);
  } finally { await f.dispose(); }
});
test("a captured dialog check cannot run after closing to the feedback surface", async () => {
  const f = await fixture({ outcome: "lost" }); try { await f.open(); await f.select("target"); await f.submit();
    const check = f.button("Check current location").onClick; await f.close(); check(); await flush(); assert.equal(f.checks.length, 0);
  } finally { await f.dispose(); }
});
test("opening retained recovery is neither a GET nor a PUT", async () => {
  const f = await fixture({ outcome: "lost" }); try { await f.open(); await f.select("target"); await f.submit(); await f.close();
    await f.click("Review move"); assert.equal(f.checks.length, 0); assert.equal(f.writes.length, 1);
  } finally { await f.dispose(); }
});
test("a failed newer check retires the old reviewed submit", async () => {
  const f = await fixture({ outcome: "lost" }); try { await f.open(); await f.select("target"); await f.submit(); await f.click("Check current location");
    const submit = f.submitHandler(); f.setCheckError(new ApiRequestError(503)); await f.click("Check current location");
    submit({ preventDefault: noop }); await flush(); assert.equal(f.writes.length, 1); assert.equal(f.controller().state.checked, null);
  } finally { await f.dispose(); }
});
test("a successful newer check also retires the old reviewed submit", async () => {
  const f = await fixture({ outcome: "lost" }); try { await f.open(); await f.select("target"); await f.submit(); await f.click("Check current location");
    const submit = f.submitHandler(); await f.click("Check current location"); submit({ preventDefault: noop }); await flush(); assert.equal(f.writes.length, 1);
  } finally { await f.dispose(); }
});
test("a malformed placement acknowledgement remains unknown, not an unhandled exception", async () => {
  const f = await fixture({ outcome: "missing-response" }); try { await f.open(); await f.select("target"); const html = await f.submit();
    assert.equal(f.failures.length, 0); assert.match(html, /could not confirm/i); assert.ok(f.button("Check current location"));
    assert.equal(f.client.getQueryData(f.keys.remote).project_id, "source");
  } finally { await f.dispose(); }
});
test("HTTP 403 hides retained private identity while allowing an explicit later check", async () => {
  const f = await fixture({ outcome: "forbidden" }); try { await f.open(); await f.select("target"); await f.submit(); f.hideRow();
    const html = f.render(); assert.doesNotMatch(html, /Synthetic (move|target)/); assert.ok(f.button("Check current location"));
  } finally { await f.dispose(); }
});
for (const outcome of ["wrong-id", "wrong-target"]) test(`${outcome} acknowledgement does not publish a confirmed cache location`, async () => {
  const f = await fixture({ outcome }); try { await f.open(); await f.select("target"); const html = await f.submit();
    assert.doesNotMatch(html, /Move confirmed/); assert.ok(f.button("Check current location"));
    assert.equal(f.client.getQueryData(f.keys.remote).project_id, "source");
  } finally { await f.dispose(); }
});
for (const change of ["account", "scope", "unmount"]) test(`a late acknowledgement after ${change} changes cannot publish or refresh`, async () => {
  const f = await fixture(); try { const release = f.hold("write"); await f.open(); await f.select("target"); await f.submit();
    if (change === "account") f.changeAccount(); else if (change === "scope") f.setScope("synthetic-new-scope"); else f.unmount();
    f.render({ effects: false }); release(); await flush(); f.render();
    assert.equal(f.client.getQueryData(f.keys.remote).project_id, "source"); assert.equal(f.refreshCalls(), 0);
  } finally { await f.dispose(); }
});
test("a captured entry and submit cannot run after owner unmount", async () => {
  const f = await fixture(); try { await f.open(); await f.select("target"); const submit = f.submitHandler(), start = f.controller().start;
    f.unmount(); submit({ preventDefault: noop }); start(f.initial, () => f.opener, true); await flush(); assert.equal(f.writes.length, 0);
  } finally { await f.dispose(); }
});
test("writes and checks use bounded abortable signals; unmount aborts the local wait", async () => {
  const f = await fixture(); try { f.hold("write"); await f.open(); await f.select("target"); await f.submit();
    assert.ok(f.writes[0].signal instanceof AbortSignal); assert.equal(f.writes[0].signal.aborted, false);
    f.unmount(); assert.equal(f.writes[0].signal.aborted, true);
  } finally { await f.dispose(); }
});
test("same-project placement keeps the server no-op revision and pin contract", async () => {
  const f = await fixture(); try { await f.open(); await f.select("source"); await f.submit();
    assert.equal(f.server().offline_revision, 7); const row = f.client.getQueryData(f.keys.source).find(item => item.id === f.initial.id);
    assert.equal(row.project_relation.is_pinned, true); assert.equal(row.project_relation.sort_order, f.relation.sort_order);
  } finally { await f.dispose(); }
});
test("a higher cached revision is neither overwritten nor evicted", async () => {
  const f = await fixture(); try { f.hold("reader"); const newer = conversation({ offline_revision: 90, project_id: "newer", project_name: "Synthetic newer" });
    f.client.setQueryData(f.keys.remote, newer); f.client.setQueryData(f.keys.source, [{ ...newer, project_relation: f.relation }]);
    f.client.setQueryData(f.keys.history, [newer]); await f.open(); await f.select("target"); await f.submit();
    assert.equal(f.client.getQueryData(f.keys.remote).offline_revision, 90); assert.equal(f.client.getQueryData(f.keys.source)[0].project_id, "newer");
    assert.equal(f.client.getQueryData(f.keys.history)[0].offline_revision, 90);
  } finally { await f.dispose(); }
});
test("confirmed placement does not create missing caches or destination rows", async () => {
  const f = await fixture(); try { for (const key of [f.keys.remote, f.keys.list, f.keys.target, f.keys.history, f.keys.recent]) f.client.removeQueries({ queryKey: key, exact: true });
    await f.open(); await f.select("target"); await f.submit();
    for (const key of [f.keys.remote, f.keys.list, f.keys.target, f.keys.history, f.keys.recent]) assert.equal(f.client.getQueryData(key), undefined);
  } finally { await f.dispose(); }
});
test("rejecting refresh callbacks do not turn a confirmed write into an unknown move", async () => {
  const f = await fixture({ refresh: "throw" }); try { await f.open(); await f.select("target"); const html = await f.submit();
    assert.match(html, /Move confirmed/); assert.equal(f.controller().busy, false); assert.equal(f.failures.length, 0);
  } finally { await f.dispose(); }
});
test("default and archived projects cannot be selected from cached rows", async () => {
  const f = await fixture(); try { f.setProjects("success", [project("target"), project("archived", { is_archived: true }), project("default", { is_default: true })]);
    const html = await f.open(); assert.doesNotMatch(html, /Synthetic (archived|default)/);
    f.controller().choose("archived"); await f.submit(); assert.equal(f.writes.length, 0);
  } finally { await f.dispose(); }
});
test("an in-flight destination refresh disables submission from a cached choice", async () => {
  const f = await fixture(); try { await f.open(); await f.select("target"); f.setProjects("loading"); f.render(); await f.submit(); assert.equal(f.writes.length, 0); }
  finally { await f.dispose(); }
});
test("late pre-move reads are cancelled before the acknowledged Reader update", async () => {
  const f = await fixture(); try { const release = f.hold("reader"); void f.observer.refetch(); await flush();
    await f.open(); await f.select("target"); await f.submit(); assert.equal(f.signals[0].aborted, true);
    release(); await flush(); assert.equal(f.client.getQueryData(f.keys.remote).project_id, "target");
  } finally { await f.dispose(); }
});
test("closing a pending move retains its acknowledgement without cancelling the server request", async () => {
  const f = await fixture(); try { const release = f.hold("write"); await f.open(); await f.select("target"); await f.submit(); await f.close();
    assert.equal(f.writes[0].signal.aborted, false); assert.match(f.render(), /Moving conversation/);
    release(); await flush(); assert.match(f.render(), /Move confirmed/); assert.equal(f.writes.length, 1);
  } finally { await f.dispose(); }
});
test("a pending read can settle behind closed recovery without reopening it", async () => {
  const f = await fixture({ outcome: "lost" }); try { await f.open(); await f.select("target"); await f.submit();
    const release = f.hold("check"); await f.click("Check current location"); await f.close(); release(); await flush();
    assert.doesNotMatch(f.render(), /role="dialog"/); assert.equal(f.controller().state.phase, "review");
    await f.click("Review move"); assert.equal(f.checks.length, 1); assert.equal(f.writes.length, 1);
  } finally { await f.dispose(); }
});
test("owner access loss hides state and prevents publishing a late acknowledgement", async () => {
  const f = await fixture(); try { const release = f.hold("write"); await f.open(); await f.select("target"); await f.submit(); f.hideRow();
    f.setUnavailable(true); assert.doesNotMatch(f.render({ effects: false }), /Synthetic|role="dialog"/); release(); await flush();
    assert.equal(f.client.getQueryData(f.keys.remote).project_id, "source"); assert.equal(f.refreshCalls(), 0);
    f.setUnavailable(false); assert.match(f.render(), /Check current location/);
  } finally { await f.dispose(); }
});
test("an inactive current conversation cannot enable an explicit retry", async () => {
  const f = await fixture({ outcome: "lost" }); try { await f.open(); await f.select("target"); await f.submit();
    f.setServer(conversation({ status: "archived", offline_revision: 19 })); await f.click("Check current location");
    assert.equal(f.controller().canSubmit, false); await f.controller().submit(); assert.equal(f.writes.length, 1);
  } finally { await f.dispose(); }
});
test("a check for a different conversation never creates a reviewed retry", async () => {
  const f = await fixture({ outcome: "lost" }); try { await f.open(); await f.select("target"); await f.submit();
    f.setServer(conversation({ id: "synthetic-other", offline_revision: 19 })); await f.click("Check current location");
    assert.equal(f.controller().state.phase, "unknown"); assert.equal(f.controller().state.checked, null);
    assert.equal(f.controller().canSubmit, false); assert.equal(f.writes.length, 1);
  } finally { await f.dispose(); }
});
test("renamed destinations use the latest visible name at acknowledgement", async () => {
  const f = await fixture(); try { await f.open(); await f.select("target");
    f.setProjects("success", [project("target", { name: "Synthetic renamed destination" })]);
    assert.match(f.render(), /Selected destination:.*Synthetic renamed destination/);
    assert.match(await f.submit(), /Move confirmed: Synthetic renamed destination/);
  } finally { await f.dispose(); }
});
test("Chinese placement and uncertainty copy is localized", async () => {
  const f = await fixture({ locale: "zh-CN", outcome: "lost" }); try { await f.open(); await f.select("target");
    assert.match(await f.submit(), /无法确认移动结果/); const html = await f.click("核对当前归属");
    assert.match(html, /不是上次移动的回执/); assert.match(html, /按当前状态再次移动/); assert.equal(f.writes.length, 1);
  } finally { await f.dispose(); }
});
function focusProbe(f) {
  const calls = [];
  const close = { focus: options => { calls.push(options); f.document.activeElement = close; } };
  // Explicit DOM double: the actual form's first enabled button is Close.
  // This checks the recovery branch, not real browser focus or Tab behaviour.
  assert.equal(f.button("Close").disabled, undefined);
  f.focusOptions().at(-1).rootRef.current = {
    querySelector: selector => { assert.equal(selector, "button:not([disabled])"); return close; },
  };
  return { calls, close };
}

test("removing the move button recovers only lost focus to the persistent Close control", async () => {
  const f = await fixture(); try { await f.open(); await f.select("target");
    const probe = focusProbe(f), release = f.hold("write"); f.document.activeElement = f.document.body;
    await f.submit(); assert.equal(f.controller().state.phase, "moving");
    assert.deepEqual(probe.calls, [{ preventScroll: true }]); assert.equal(f.document.activeElement, probe.close);
    release(); await flush(); f.render(); assert.equal(probe.calls.length, 1);
  } finally { await f.dispose(); }
});

test("removing the check button recovers lost focus without a second write", async () => {
  const f = await fixture({ outcome: "lost" }); try { await f.open(); await f.select("target"); await f.submit();
    const probe = focusProbe(f), release = f.hold("check"); f.document.activeElement = f.document.body;
    await f.click("Check current location"); assert.equal(f.controller().state.phase, "checking");
    assert.deepEqual(probe.calls, [{ preventScroll: true }]); assert.equal(f.writes.length, 1);
    release(); await flush(); f.render(); assert.equal(probe.calls.length, 1);
  } finally { await f.dispose(); }
});

test("pending placement phases never steal focus from another chosen control", async () => {
  const f = await fixture({ outcome: "lost" }); try { await f.open(); await f.select("target");
    const probe = focusProbe(f), otherControl = {}; f.document.activeElement = otherControl;
    const releaseWrite = f.hold("write"); await f.submit(); assert.equal(probe.calls.length, 0);
    releaseWrite(); await flush(); f.render(); assert.equal(f.document.activeElement, otherControl);
    const releaseCheck = f.hold("check"); await f.click("Check current location");
    assert.equal(probe.calls.length, 0); assert.equal(f.document.activeElement, otherControl);
    releaseCheck(); await flush(); f.render(); assert.equal(probe.calls.length, 0);
  } finally { await f.dispose(); }
});

test("closed placement recovery never focuses its absent dialog", async () => {
  const f = await fixture({ outcome: "lost" }); try { await f.open(); await f.select("target");
    const probe = focusProbe(f), release = f.hold("write"); await f.submit();
    f.document.activeElement = f.document.body; await f.close();
    assert.equal(probe.calls.length, 0); release(); await flush();
    assert.doesNotMatch(f.render(), /role="dialog"/); assert.equal(probe.calls.length, 0);
    assert.equal(f.document.activeElement, f.document.body);
  } finally { await f.dispose(); }
});

test("optional API signals preserve the legacy helper URLs, methods and payloads", async () => {
  const path = new URL("../../apps/web/lib/api.ts", import.meta.url), source = readFileSync(path, "utf8");
  const ast = ts.createSourceFile("api.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declarations = ast.statements.filter(node => ts.isFunctionDeclaration(node) && ["getProjects", "placeConversation", "jsonRequest"].includes(node.name?.text));
  assert.equal(declarations.length, 3);
  const compiled = ts.transpileModule(declarations.map(node => node.getText(ast)).join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const calls = [], module = { exports: {} };
  new Function("module", "exports", "fetchJson", compiled)(module, module.exports, async (url, init) => { calls.push({ url, init }); return []; });
  const input = { target_project_id: "synthetic-target", target_section: "normal", expected_offline_revision: 7 };
  const signal = new AbortController().signal;
  await module.exports.placeConversation("synthetic-id", input);
  await module.exports.placeConversation("synthetic-id", input, signal);
  await module.exports.getProjects({ sort: "custom", direction: "asc" }, signal);
  await module.exports.getProjects();
  assert.equal(calls[0].url, "/api/conversations/synthetic-id/placement");
  assert.equal(calls[0].init.method, "PUT"); assert.deepEqual(JSON.parse(calls[0].init.body), input);
  assert.equal(calls[0].init.signal, undefined); assert.equal(calls[1].init.signal, signal);
  assert.equal(calls[2].url, "/api/projects?sort=custom&direction=asc"); assert.equal(calls[2].init.signal, signal);
  assert.equal(calls[3].url, "/api/projects"); assert.equal(calls[3].init.signal, undefined);
});
for (const [path, prefix] of [["features/conversations/conversation-list.tsx", ""], ["features/projects/project-conversation-list.tsx", ""], ["features/projects/project-sidebar.tsx", ""]]) {
  test("source integration keeps one placement owner/surface outside moved rows: " + path, () => {
    const source = readFileSync(new URL("../../apps/web/" + prefix + path, import.meta.url), "utf8");
    const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let owners = 0, surfaces = 0, wiredMenus = 0;
    const visit = node => {
      if (ts.isCallExpression(node) && node.expression.getText(ast) === "useConversationPlacement") owners += 1;
      if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(ast) === "ConversationPlacementSurface") surfaces += 1;
      if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(ast) === "ConversationActionMenu"
        && node.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(ast) === "placement")) wiredMenus += 1;
      ts.forEachChild(node, visit);
    };
    visit(ast); assert.deepEqual({ owners, surfaces, wiredMenus }, { owners: 1, surfaces: 1, wiredMenus: 1 });
    if (path.endsWith("project-sidebar.tsx")) {
      const surfaceAt = source.indexOf("<ConversationPlacementSurface");
      assert.ok(surfaceAt > source.indexOf("</ReaderSidebarFrame>"));
      assert.ok(surfaceAt < source.indexOf("function SidebarContent"));
    }
  });
}
