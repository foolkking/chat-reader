import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

const appRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const React = appRequire("react"), jsx = appRequire("react/jsx-runtime"), ts = appRequire("typescript");
const { renderToStaticMarkup } = appRequire("react-dom/server");
const { QueryClient, QueryObserver } = appRequire("@tanstack/react-query");
const noop = () => {};
const source = readFileSync(new URL("../../apps/web/features/projects/project-action-menu.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("project-action-menu.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = new Map();
for (const node of ast.statements) {
  if (!ts.isFunctionDeclaration(node) || !node.name) continue;
  const states = [], refs = [];
  function visit(child) {
    if (ts.isVariableDeclaration(child) && child.initializer && ts.isCallExpression(child.initializer)) {
      const call = child.initializer.expression.getText(ast);
      if (call === "useState" && ts.isArrayBindingPattern(child.name)) states.push(child.name.elements[0].name.getText(ast));
      if (call === "useRef" && ts.isIdentifier(child.name)) refs.push(child.name.text);
    }
    ts.forEachChild(child, visit);
  }
  visit(node); declarations.set(node.name.text, { states, refs });
}
const compiled = ts.transpileModule(source, { fileName: "project-action-menu.tsx", compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const project = (id = "synthetic-archive-project", extra = {}) => ({ id, name: `Synthetic ${id}`, description: "Synthetic original",
  is_default: false, is_archived: false, conversation_count: 2, pinned_count: 0, updated_at: "2026-10-09T00:00:00Z", ...extra });
class ApiRequestError extends Error { constructor(status) { super("Synthetic upstream detail"); this.status = status; } }
function textOf(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return textOf(node.props?.children);
}
const flush = async () => { await setImmediate(); await setImmediate(); };

// Actual compiled menu/controller/feedback and installed QueryClient/Observer.
// Hook scheduling, portals, confirmation, focus and server transport are explicit
// doubles, not React lifecycle, DOM focus, browser or API acceptance. Before the
// repair the same actions run the original menu without a shared controller.
async function fixture({ locale = "en-US", outcome = "success", confirm = true, refresh = "normal", initial = project() } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const keys = [["projects", "custom", "asc"], ["projects", "search-filter"], ["projects", "bulk-actions"], ["projects", "archived"]];
  let server = [initial, project("synthetic-other")], target = initial, readError = null, checkError = null;
  let activeFrame = null, controller = null, unavailable = false, overrideProjects = null, menuCount = 1;
  let refreshCalls = 0, readCalls = 0, writeOutcome = outcome, confirmValue = confirm;
  const frames = new Map(), holds = new Map(), buttons = [], writes = [], confirms = [], checks = [], readSignals = [];
  const document = { body: {}, activeElement: null };
  const focusButton = { isConnected: true, focus: () => { document.activeElement = focusButton; },
    getBoundingClientRect: () => ({ right: 300, bottom: 100 }) };
  document.activeElement = focusButton;
  const window = { innerWidth: 1440, innerHeight: 900, addEventListener: noop, removeEventListener: noop };
  for (const key of keys) client.setQueryData(key, structuredClone(server));
  const queryFn = async ({ signal }) => {
    readCalls += 1; readSignals.push(signal);
    const snapshot = structuredClone(server.filter(item => !item.is_archived)), failure = readError;
    if (holds.has("read")) await holds.get("read").promise;
    if (failure) throw failure;
    return snapshot;
  };
  const observer = new QueryObserver(client, { queryKey: keys[0], queryFn, enabled: false, staleTime: Infinity });
  const stop = observer.subscribe(noop);
  const onChanged = async () => {
    refreshCalls += 1;
    if (refresh === "throw") throw new Error("Synthetic refresh callback rejection");
    return client.invalidateQueries({ queryKey: ["projects"] });
  };
  function inFrame(name, fn, operation) {
    if (!frames.has(name)) frames.set(name, { name, fn, states: new Map(), refs: new Map(), effects: new Map() });
    const frame = frames.get(name), previous = activeFrame;
    frame.stateIndex = 0; frame.refIndex = 0; frame.effectIndex = 0; activeFrame = frame;
    try { return operation(); } finally { activeFrame = previous; }
  }
  const Button = props => { buttons.push(props); const { ref: _ref, ...rest } = props; return React.createElement("button", rest); };
  const capture = factory => (type, props, key) => type === "button" ? factory(Button, props, key) : factory(type, props, key);
  const mocks = {
    react: { ...React,
      useState: initialValue => {
        const frame = activeFrame, key = declarations.get(frame.fn).states[frame.stateIndex++];
        assert.ok(key, `Untracked state in ${frame.fn}`);
        if (!frame.states.has(key)) frame.states.set(key, typeof initialValue === "function" ? initialValue() : initialValue);
        return [frame.states.get(key), value => frame.states.set(key, typeof value === "function" ? value(frame.states.get(key)) : value)];
      },
      useRef: initialValue => {
        const frame = activeFrame, key = declarations.get(frame.fn).refs[frame.refIndex++];
        assert.ok(key, `Untracked ref in ${frame.fn}`);
        if (!frame.refs.has(key)) frame.refs.set(key, { current: key === "buttonRef" ? focusButton : initialValue });
        return frame.refs.get(key);
      },
      useEffect: (effect, deps) => {
        const frame = activeFrame, key = frame.effectIndex++, previous = frame.effects.get(key);
        const changed = !previous || !deps || !previous.deps || deps.some((value, index) => value !== previous.deps[index]);
        frame.effects.set(key, { effect, deps, changed, cleanup: previous?.cleanup });
      },
    },
    "react/jsx-runtime": { ...jsx, jsx: capture(jsx.jsx), jsxs: capture(jsx.jsxs) },
    "react-dom": { createPortal: element => element },
    "@tanstack/react-query": { useQueryClient: () => client },
    "next/link": { default: ({ children, ...props }) => React.createElement("a", props, children) },
    "../../lib/api": { ApiRequestError,
      updateProject: async (id, input) => {
        writes.push({ id, input });
        if (holds.has("write")) await holds.get("write").promise;
        if (writeOutcome === "rejected") throw new ApiRequestError(503);
        const saved = { ...server.find(item => item.id === id), ...input, description: "Synthetic canonical response", updated_at: "2026-10-09T00:01:00Z" };
        server = server.map(item => item.id === id ? saved : item);
        if (writeOutcome === "lost") throw new Error("Synthetic lost acknowledgement");
        return saved;
      },
      getProjects: async input => {
        checks.push(input); const snapshot = structuredClone(server), failure = checkError;
        if (holds.has("check")) await holds.get("check").promise;
        if (failure) throw failure;
        return snapshot;
      },
    },
    "../../components/preferences-provider": { usePreferences: () => ({ resolvedLocale: locale }) },
    "../../components/interaction-dialog-provider": { useInteractionDialog: () => ({ confirm: async options => {
      confirms.push(options); if (holds.has("confirm")) await holds.get("confirm").promise; return confirmValue;
    } }) },
    "./project-settings-dialog": { ProjectSettingsDialog: ({ open }) => open ? React.createElement("div", { "data-settings": true }) : null },
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", "window", "document", compiled)(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith(".")) throw new Error(`Unexpected archive dependency: ${name}`);
    return appRequire(name);
  }, module, module.exports, window, document);
  const flushEffects = () => {
    for (const frame of frames.values()) for (const effect of frame.effects.values()) if (effect.changed) {
      effect.changed = false; effect.cleanup?.(); effect.cleanup = effect.effect();
    }
  };
  const Menu = ({ copy }) => inFrame(`menu-${copy}`, "ProjectActionMenu", () => module.exports.ProjectActionMenu({ project: target, onChanged, archive: controller }));
  const Feedback = () => inFrame("feedback", "ProjectArchiveFeedback", () => module.exports.ProjectArchiveFeedback({ archive: controller }));
  const render = () => {
    buttons.length = 0;
    if (module.exports.useProjectArchive) controller = inFrame("owner", "useProjectArchive", () => module.exports.useProjectArchive({
      projects: overrideProjects ?? client.getQueryData(keys[0]), unavailable, onChanged,
    }));
    const html = renderToStaticMarkup(React.createElement(React.Fragment, null,
      controller ? React.createElement(Feedback) : null,
      ...Array.from({ length: menuCount }, (_, index) => React.createElement(Menu, { copy: index, key: index }))));
    flushEffects(); return html;
  };
  const button = (label, occurrence = 0) => {
    const match = buttons.filter(props => (props["aria-label"] ?? textOf(props.children).trim()) === label)[occurrence];
    assert.ok(match, `Missing rendered action: ${label}`); return match;
  };
  const openMenu = (copy = 0) => {
    render(); const label = `${locale === "zh-CN" ? "管理项目" : "Manage project"} ${target.name}`;
    if (!button(label, copy)["aria-expanded"]) { button(label, copy).onClick({ preventDefault: noop, stopPropagation: noop }); render(); }
  };
  const captureArchive = (copy = 0) => { openMenu(copy); return button(locale === "zh-CN" ? "归档项目" : "Archive project", copy).onClick; };
  const hold = name => { let release; const promise = new Promise(resolve => { release = resolve; }); holds.set(name, { promise, release });
    return () => { holds.delete(name); release(); }; };
  const unmount = () => { for (const frame of frames.values()) for (const effect of frame.effects.values()) { effect.cleanup?.(); effect.cleanup = null; } };
  render();
  return { client, keys, observer, writes, confirms, checks, button, render, openMenu, captureArchive, hold, document, focusButton,
    archive: async () => { captureArchive()(); await flush(); },
    get controller() { return controller; },
    busy: () => controller ? controller.busy : frames.get("menu-0").states.get("pending"),
    refreshCalls: () => refreshCalls, readCalls: () => readCalls, readSignals, server: () => server,
    activate: () => observer.setOptions({ queryKey: keys[0], queryFn, enabled: true, staleTime: Infinity }),
    setReadError: value => { readError = value; }, setCheckError: value => { checkError = value; },
    setServer: value => { server = structuredClone(value); }, setOutcome: value => { writeOutcome = value; },
    setConfirm: value => { confirmValue = value; }, setUnavailable: value => { unavailable = value; },
    setProjects: value => { overrideProjects = value; }, setMenuCount: value => { menuCount = value; },
    setTarget: value => { target = value; }, unmount,
    setRef: (frame, name, value) => { frames.get(frame).refs.get(name).current = value; },
    dispose: async () => { unmount(); for (const item of holds.values()) item.release(); holds.clear(); await flush(); stop(); observer.destroy(); client.clear(); },
  };
}

test("archive success sends exactly the original boolean patch and refreshes once (control)", async () => {
  const f = await fixture();
  try { await f.archive(); assert.deepEqual(f.writes, [{ id: project().id, input: { is_archived: true } }]); assert.equal(f.refreshCalls(), 1); }
  finally { await f.dispose(); }
});
test("cancelled confirmation does not write or refresh (control)", async () => {
  const f = await fixture({ confirm: false });
  try { await f.archive(); assert.equal(f.confirms.length, 1); assert.equal(f.writes.length + f.refreshCalls(), 0); }
  finally { await f.dispose(); }
});
test("a held write remains busy and disables archive/settings (control)", async () => {
  const f = await fixture();
  try { f.hold("write"); await f.archive(); f.openMenu(); assert.equal(f.busy(), true); assert.equal(f.button("Project settings").disabled, true); assert.equal(f.button("Archiving…").disabled, true); }
  finally { await f.dispose(); }
});
test("confirmed archive settles before an actual held query refresh", async () => {
  const f = await fixture();
  try { f.activate(); f.hold("read"); await f.archive(); f.render(); assert.equal(f.observer.getCurrentResult().isFetching, true); assert.equal(f.busy(), false); assert.match(f.render(), /Project archived/); }
  finally { await f.dispose(); }
});
test("confirmed archive removes active choices and publishes existing archived-cache metadata", async () => {
  const f = await fixture();
  try {
    await f.archive();
    for (const key of f.keys.slice(0, 3)) assert.deepEqual(f.client.getQueryData(key).map(item => item.id), ["synthetic-other"]);
    assert.deepEqual(f.client.getQueryData(f.keys[3]), f.server());
  } finally { await f.dispose(); }
});
test("ordinary query invalidation failure does not turn a successful PATCH into a failure (control)", async () => {
  const f = await fixture();
  try { f.activate(); f.setReadError(new ApiRequestError(503)); await f.archive(); assert.equal(f.server()[0].is_archived, true); assert.doesNotMatch(f.render(), /Could not archive this project/); }
  finally { await f.dispose(); }
});
test("a rejecting refresh callback cannot reverse confirmed archive feedback", async () => {
  const f = await fixture({ refresh: "throw" });
  try { await f.archive(); assert.match(f.render(), /Project archived/); assert.doesNotMatch(f.render(), /Could not archive this project/); }
  finally { await f.dispose(); }
});
test("lost archive acknowledgement retains a read-only result check outside the closed menu", async () => {
  const f = await fixture({ outcome: "lost" });
  try { await f.archive(); f.setMenuCount(0); assert.match(f.render(), /could not be confirmed/); assert.ok(f.button("Check archive result")); }
  finally { await f.dispose(); }
});
test("a captured archive action cannot replay an uncertain write", async () => {
  const f = await fixture({ outcome: "lost" });
  try { const captured = f.captureArchive(); captured(); await flush(); captured(); await flush(); assert.equal(f.writes.length, 1); assert.equal(f.confirms.length, 1); }
  finally { await f.dispose(); }
});
test("rapid archive activation reserves one confirmation before awaiting it", async () => {
  const f = await fixture();
  try { f.hold("confirm"); const captured = f.captureArchive(); captured(); captured(); await flush(); assert.equal(f.confirms.length, 1); assert.equal(f.writes.length, 0); }
  finally { await f.dispose(); }
});
test("desktop and mobile menu copies share confirmation admission", async () => {
  const f = await fixture();
  try { f.setMenuCount(2); f.hold("confirm"); const first = f.captureArchive(0), second = f.captureArchive(1); first(); second(); await flush(); assert.equal(f.confirms.length, 1); }
  finally { await f.dispose(); }
});
for (const changed of ["missing", "archived", "default", "unavailable"]) {
  test(`confirmation rechecks a ${changed} target before PATCH`, async () => {
    const f = await fixture();
    try {
      const release = f.hold("confirm"); f.captureArchive()(); await flush();
      if (changed === "unavailable") f.setUnavailable(true);
      else f.setProjects(changed === "missing" ? [] : [project(undefined, { is_archived: changed === "archived", is_default: changed === "default" })]);
      f.render(); release(); await flush(); assert.equal(f.writes.length, 0);
    } finally { await f.dispose(); }
  });
}
test("unmounted archive owner cannot submit an old confirmation", async () => {
  const f = await fixture();
  try { const release = f.hold("confirm"); f.captureArchive()(); await flush(); f.unmount(); release(); await flush(); assert.equal(f.writes.length, 0); }
  finally { await f.dispose(); }
});
test("checking a lost response performs only an include-archived read and confirms the existing archive", async () => {
  const f = await fixture({ outcome: "lost" });
  try {
    await f.archive(); f.render(); f.button("Check archive result").onClick(); await flush();
    assert.deepEqual(f.checks, [{ includeArchived: true, sort: "custom", direction: "asc" }]);
    assert.equal(f.writes.length, 1); assert.match(f.render(), /Project archived/);
  } finally { await f.dispose(); }
});
test("failed result checks stay uncertain without enabling archive replay", async () => {
  const f = await fixture({ outcome: "rejected" });
  try {
    await f.archive(); f.setCheckError(new ApiRequestError(503)); f.render(); f.button("Check archive result").onClick(); await flush();
    assert.match(f.render(), /Could not check/); f.openMenu(); assert.equal(f.button("Archive project").disabled, true); assert.equal(f.writes.length, 1);
  } finally { await f.dispose(); }
});
test("a still-active result permits only a new explicit confirmed archive", async () => {
  const f = await fixture({ outcome: "rejected" });
  try {
    await f.archive(); f.render(); f.button("Check archive result").onClick(); await flush();
    assert.match(f.render(), /not archived/); assert.equal(f.writes.length, 1); f.setOutcome("success"); await f.archive();
    assert.equal(f.writes.length, 2); assert.equal(f.confirms.length, 2); assert.match(f.render(), /Project archived/);
  } finally { await f.dispose(); }
});
test("Chinese uncertainty and result-check labels use the existing locale", async () => {
  const f = await fixture({ locale: "zh-CN", outcome: "lost" });
  try { await f.archive(); assert.match(f.render(), /暂时无法确认归档结果/); assert.ok(f.button("核对归档结果")); assert.doesNotMatch(f.render(), /Synthetic upstream detail/); }
  finally { await f.dispose(); }
});

for (const scope of ["archived", "default", "unavailable"]) {
  test(`an initially ${scope} project cannot open archive confirmation`, async () => {
    const f = await fixture({ initial: project(undefined, { is_archived: scope === "archived", is_default: scope === "default" }) });
    try { if (scope === "unavailable") f.setUnavailable(true); await f.archive(); assert.equal(f.confirms.length + f.writes.length, 0); }
    finally { await f.dispose(); }
  });
}
test("a captured successful archive cannot immediately re-archive the same target", async () => {
  const f = await fixture();
  try { const captured = f.captureArchive(); captured(); await flush(); captured(); await flush(); assert.equal(f.writes.length, 1); assert.equal(f.confirms.length, 1); }
  finally { await f.dispose(); }
});
test("held checks reserve a single read and cannot dismiss uncertainty", async () => {
  const f = await fixture({ outcome: "lost" });
  try {
    await f.archive(); f.render(); f.hold("check"); const check = f.button("Check archive result").onClick;
    check(); check(); await flush(); assert.equal(f.checks.length, 1); assert.match(f.render(), /Checking archive result/);
    assert.equal(f.button("Checking…").disabled, true); f.controller.dismiss(); f.render(); assert.equal(f.controller.state.phase, "checking");
    assert.equal(f.writes.length, 1);
  } finally { await f.dispose(); }
});
test("a successful missing-project check clears only that target from existing project caches", async () => {
  const f = await fixture({ outcome: "lost" });
  try {
    await f.archive(); f.setServer([project("synthetic-other")]); f.render(); f.button("Check archive result").onClick(); await flush();
    f.setMenuCount(0); const html = f.render(); assert.match(html, /no longer available/); assert.doesNotMatch(html, /synthetic-archive-project/);
    for (const key of f.keys) assert.deepEqual(f.client.getQueryData(key).map(item => item.id), ["synthetic-other"]);
    assert.equal(f.writes.length, 1);
  } finally { await f.dispose(); }
});
for (const status of [401, 403, 404]) {
  test(`archive result-check HTTP ${status} keeps uncertainty without private notice identity or cache publication`, async () => {
    const f = await fixture({ outcome: "lost" });
    try {
      await f.archive(); const before = structuredClone(f.client.getQueryData(f.keys[0])); f.setCheckError(new ApiRequestError(status));
      f.render(); f.button("Check archive result").onClick(); await flush(); f.setMenuCount(0);
      const html = f.render(); assert.match(html, /access is unavailable/); assert.doesNotMatch(html, /synthetic-archive-project|Synthetic upstream detail/);
      assert.equal(f.controller.blocked, true); assert.deepEqual(f.client.getQueryData(f.keys[0]), before); assert.equal(f.writes.length, 1);
    } finally { await f.dispose(); }
  });
}
test("rendered access denial hides a retained notice and fences old check callbacks", async () => {
  const f = await fixture({ outcome: "lost" });
  try {
    await f.archive(); f.render(); const check = f.button("Check archive result").onClick;
    f.setUnavailable(true); f.setMenuCount(0); assert.equal(f.render(), ""); check(); await flush(); assert.equal(f.checks.length, 0);
    f.setUnavailable(false); assert.match(f.render(), /could not be confirmed/);
  } finally { await f.dispose(); }
});
test("access denial during PATCH keeps the response unconfirmed without republishing private cache data", async () => {
  const f = await fixture();
  try {
    const release = f.hold("write"); await f.archive(); f.setUnavailable(true); f.render(); release(); await flush();
    assert.equal(f.client.getQueryData(f.keys[0])[0].is_archived, false); assert.equal(f.refreshCalls(), 0);
    f.setUnavailable(false); f.render(); assert.equal(f.controller.state.phase, "unconfirmed"); assert.equal(f.controller.blocked, true);
  } finally { await f.dispose(); }
});
test("late PATCH acknowledgement after owner unmount cannot publish cache data or refresh", async () => {
  const f = await fixture();
  try {
    const release = f.hold("write"); await f.archive(); f.unmount(); release(); await flush();
    assert.equal(f.server()[0].is_archived, true); assert.equal(f.client.getQueryData(f.keys[0])[0].is_archived, false); assert.equal(f.refreshCalls(), 0);
  } finally { await f.dispose(); }
});
test("late result check after owner unmount cannot publish cache data", async () => {
  const f = await fixture({ outcome: "lost" });
  try {
    await f.archive(); const release = f.hold("check"); f.render(); f.button("Check archive result").onClick(); await flush();
    f.unmount(); release(); await flush(); assert.equal(f.client.getQueryData(f.keys[0])[0].is_archived, false); assert.equal(f.refreshCalls(), 0);
  } finally { await f.dispose(); }
});
test("cancelling a checked-active retry preserves its earlier result and sends no second PATCH", async () => {
  const f = await fixture({ outcome: "rejected" });
  try {
    await f.archive(); f.render(); f.button("Check archive result").onClick(); await flush(); f.setConfirm(false); await f.archive();
    assert.match(f.render(), /not archived/); assert.equal(f.writes.length, 1); assert.equal(f.confirms.length, 2);
  } finally { await f.dispose(); }
});
test("closing and reopening menu copies does not automatically check or replay an unknown archive", async () => {
  const f = await fixture({ outcome: "lost" });
  try {
    await f.archive(); f.setMenuCount(0); f.render(); f.setMenuCount(2); f.openMenu(1); await flush();
    assert.equal(f.checks.length, 0); assert.equal(f.writes.length, 1); assert.equal(f.button("Archive project").disabled, true);
  } finally { await f.dispose(); }
});
test("older active-list reads are cancelled before canonical archive publication", async () => {
  const f = await fixture();
  try {
    const release = f.hold("read"); const oldRead = f.observer.refetch(); await flush();
    await f.archive(); assert.equal(f.readSignals[0].aborted, true); release(); await oldRead; await flush();
    assert.deepEqual(f.client.getQueryData(f.keys[0]).map(item => item.id), ["synthetic-other"]);
  } finally { await f.dispose(); }
});
test("archive publication does not create an absent archived cache or alter unrelated conversation data", async () => {
  const f = await fixture();
  try {
    f.client.removeQueries({ queryKey: f.keys[3], exact: true });
    const conversationKey = ["conversations", "history", "synthetic"], rows = [{ id: "synthetic-conversation", offline_revision: 4 }];
    f.client.setQueryData(conversationKey, rows); await f.archive();
    assert.equal(f.client.getQueryData(f.keys[3]), undefined); assert.deepEqual(f.client.getQueryData(conversationKey), rows);
  } finally { await f.dispose(); }
});
test("settings still opens independently and does not start an archive (control)", async () => {
  const f = await fixture();
  try { f.openMenu(); f.button("Project settings").onClick(); assert.match(f.render(), /data-settings="true"/); assert.equal(f.writes.length + f.confirms.length, 0); }
  finally { await f.dispose(); }
});
test("acknowledged notice exposes the existing archive route and can be dismissed", async () => {
  const f = await fixture();
  try { await f.archive(); f.setMenuCount(0); assert.match(f.render(), /href="\/archived"/); f.button("Dismiss").onClick(); assert.equal(f.render(), ""); }
  finally { await f.dispose(); }
});
test("an old check callback cannot rerun after confirmation and dismissal", async () => {
  const f = await fixture({ outcome: "lost" });
  try {
    await f.archive(); f.render(); const check = f.button("Check archive result").onClick; check(); await flush();
    f.render(); f.button("Dismiss").onClick(); check(); await flush(); assert.equal(f.checks.length, 1); assert.equal(f.writes.length, 1);
  } finally { await f.dispose(); }
});
for (const focus of ["lost", "chosen", "hidden"]) {
  test(`feedback ${focus === "lost" ? "recovers lost" : "does not steal " + focus} focus with an explicit DOM double`, async () => {
    const f = await fixture(); let focused = 0;
    try {
      await f.archive();
      f.setRef("feedback", "noticeRef", { getClientRects: () => focus === "hidden" ? [] : [{}], focus: () => { focused += 1; } });
      f.focusButton.isConnected = false; f.document.activeElement = focus === "chosen" ? {} : f.document.body;
      f.render(); assert.equal(focused, focus === "lost" ? 1 : 0);
    } finally { await f.dispose(); }
  });
}
