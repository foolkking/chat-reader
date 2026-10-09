import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

const appRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const React = appRequire("react"), jsx = appRequire("react/jsx-runtime"), ts = appRequire("typescript");
const { renderToStaticMarkup } = appRequire("react-dom/server");
const { QueryClient, QueryObserver } = appRequire("@tanstack/react-query");
const noop = () => {};
const flush = async () => { await setImmediate(); await setImmediate(); };
const metadataPath = "features/conversations/conversation-metadata-dialog.tsx";
const hasEditor = existsSync(new URL("../../apps/web/" + metadataPath, import.meta.url));
const conversation = (extra = {}) => ({
  id: "synthetic-metadata", title: "Synthetic original title", display_title: "Synthetic original title",
  description_markdown: "Synthetic original description", offline_revision: 7, status: "active",
  project_id: "synthetic-project", project_name: "Synthetic project", is_global_pinned: false,
  last_read_at: "2026-10-09T00:00:00Z", reading_progress: 25, message_count: 2, turn_count: 1,
  external_source_id: null, parser_version: "synthetic", render_version: 1, content_hash: null, sort_time: null,
  ...extra,
});
class ApiRequestError extends Error { constructor(status) { super("Synthetic upstream detail"); this.status = status; } }
function textOf(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return textOf(node.props?.children);
}

// Actual compiled menu, shared prompt and (after repair) editor callbacks/JSX,
// plus installed QueryClient/Observer. Hook/effect scheduling, transport, auth,
// focus and portals are explicit doubles, not a browser or React lifecycle test.
// Capturing discarded promises prevents the legacy unhandled rejection from
// crashing node:test; it supplies no error UI and does not change the action.
async function fixture({ field = "description", locale = "en-US", outcome = "success", initial = conversation(), refresh = "normal" } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const keys = {
    remote: ["conversation", "remote", initial.id], offline: ["conversation", "offline", initial.id],
    unrelated: ["conversation", "remote", "synthetic-other"], legacy: ["conversation", initial.id],
    list: ["conversations", "active", "title", "asc"], sidebar: ["conversations", "history", "recent_read", "desc"],
    project: ["project-conversations", initial.project_id, "title", "asc"], recent: ["recent-items"],
  };
  const other = conversation({ id: "synthetic-other", title: "Synthetic other", display_title: "Synthetic other" });
  const relation = { is_pinned: true, pinned_at: null, added_at: "2026-10-09T00:00:00Z", sort_order: 3 };
  const recent = { id: "synthetic-recent", conversation_id: initial.id, last_message_id: "synthetic-anchor",
    context: { block_index: 2, character_offset: 8, progress: 25 }, open_count: 3, conversation: initial };
  for (const key of [keys.remote, keys.offline, keys.legacy]) client.setQueryData(key, initial);
  client.setQueryData(keys.unrelated, other);
  for (const key of [keys.list, keys.sidebar]) client.setQueryData(key, [initial, other]);
  client.setQueryData(keys.project, [{ ...initial, project_relation: relation }, { ...other, project_relation: relation }]);
  client.setQueryData(keys.recent, [recent]);
  let server = initial, propsConversation = initial, writeOutcome = outcome, checkError = null, currentFrame = null;
  let epoch = 0, mounted = true, confirming = true, refreshCalls = 0, readCalls = 0, readError = null;
  const frames = new Map(), definitions = new Map(), holds = new Map(), buttons = [], fields = [], forms = [];
  const writes = [], checks = [], failures = [], confirms = [], signals = [], writeSignals = [], focusOptions = [];
  const document = { body: {}, activeElement: null };
  const opener = { isConnected: true, focus: () => { document.activeElement = opener; }, getBoundingClientRect: () => ({ right: 300, bottom: 100 }) };
  document.activeElement = opener;
  const window = { innerWidth: 1440, innerHeight: 900, addEventListener: noop, removeEventListener: noop };
  const queryFn = async ({ signal }) => {
    readCalls += 1; signals.push(signal);
    const snapshot = structuredClone(server), error = readError;
    if (holds.has("read")) await holds.get("read").promise;
    if (error) throw error;
    return snapshot;
  };
  const observer = new QueryObserver(client, { queryKey: keys.remote, queryFn, enabled: true, staleTime: Infinity });
  const stop = observer.subscribe(noop);
  const captureTask = value => { if (value?.then) Promise.resolve(value).catch(error => failures.push(error)); };
  function frame(name, fn, operation) {
    if (!frames.has(name)) frames.set(name, { fn, states: [], refs: [], effects: [] });
    const previous = currentFrame, current = frames.get(name);
    current.stateIndex = 0; current.refIndex = 0; current.effectIndex = 0; current.seen = true; currentFrame = current;
    try { return operation(); } finally { currentFrame = previous; }
  }
  const hooks = { ...React,
    useState: initialValue => {
      const f = currentFrame, index = f.stateIndex++;
      if (!(index in f.states)) f.states[index] = typeof initialValue === "function" ? initialValue() : initialValue;
      return [f.states[index], next => { f.states[index] = typeof next === "function" ? next(f.states[index]) : next; }];
    },
    useRef: initialValue => {
      const f = currentFrame, index = f.refIndex++, name = definitions.get(f.fn)?.refs[index];
      if (!(index in f.refs)) f.refs[index] = { current: name === "buttonRef" ? opener : initialValue };
      return f.refs[index];
    },
    useMemo: fn => fn(), useCallback: fn => fn,
    useContext: context => context.current,
    createContext: initialValue => {
      const context = { current: initialValue };
      context.Provider = ({ value, children }) => { context.current = value; return children; };
      return context;
    },
    useId: () => "synthetic-metadata-field",
  };
  const effect = (operation, deps) => {
    const f = currentFrame, index = f.effectIndex++, prior = f.effects[index];
    f.effects[index] = { operation, deps, cleanup: prior?.cleanup,
      changed: !prior || !deps || !prior.deps || deps.some((value, i) => value !== prior.deps[i]) };
  };
  hooks.useEffect = effect; hooks.useLayoutEffect = effect;
  const capture = factory => (type, props, key) => {
    if (typeof type === "string") {
      if (type === "button") buttons.push(props);
      if (type === "input" || type === "textarea") fields.push({ type, ...props });
      if (type === "form") forms.push(props);
    }
    return factory(type, props, key);
  };
  const api = { ApiRequestError,
    getProjects: async () => [],
    updateConversation: async (id, patch, signal) => {
      writes.push({ id, patch });
      writeSignals.push(signal);
      if (holds.has("write")) await holds.get("write").promise;
      if (writeOutcome === "rejected") throw new ApiRequestError(503);
      if (writeOutcome === "invalid") throw new ApiRequestError(422);
      const saved = { ...server, ...patch, offline_revision: server.offline_revision + 1 };
      if ("description_markdown" in patch) saved.description_markdown = patch.description_markdown?.trim() || null;
      server = saved;
      if (writeOutcome === "lost") throw new Error("Synthetic lost acknowledgement");
      if (writeOutcome === "wrong-id") return { ...saved, id: "synthetic-wrong-response" };
      return structuredClone(saved);
    },
    getConversation: async (id, signal) => {
      checks.push({ id, signal });
      const snapshot = structuredClone(server), error = checkError;
      if (holds.has("check")) await holds.get("check").promise;
      if (error) throw error;
      return snapshot;
    },
  };
  const common = {
    react: hooks, "react/jsx-runtime": { ...jsx, jsx: capture(jsx.jsx), jsxs: capture(jsx.jsxs) },
    "react-dom": { createPortal: element => element },
    "@tanstack/react-query": { useQueryClient: () => client, useQuery: () => ({ data: [] }) },
    "next/navigation": { usePathname: () => "/conversations/" + initial.id, useRouter: () => ({ push: noop, replace: noop }) },
    "../../lib/api": api,
    "../../lib/offline-access": { authenticationGeneration: () => epoch, OFFLINE_ACCESS_LOCKED_EVENT: "synthetic-lock" },
    "../../components/preferences-provider": { usePreferences: () => ({ resolvedLocale: locale }) },
    "./preferences-provider": { usePreferences: () => ({ resolvedLocale: locale }) },
    "./use-dialog-focus": { useDialogFocus: options => { focusOptions.push(options); } },
    "../../components/use-dialog-focus": { useDialogFocus: options => { focusOptions.push(options); } },
    "./conversation-undo": {},
  };
  function load(path, extra = {}) {
    const source = readFileSync(new URL("../../apps/web/" + path, import.meta.url), "utf8");
    const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    for (const declaration of ast.statements) if (ts.isFunctionDeclaration(declaration) && declaration.name) {
      const refs = [], states = [];
      const visit = child => {
        if (ts.isVariableDeclaration(child) && child.initializer && ts.isCallExpression(child.initializer)) {
          if (child.initializer.expression.getText(ast) === "useRef" && ts.isIdentifier(child.name)) refs.push(child.name.text);
          if (child.initializer.expression.getText(ast) === "useState" && ts.isArrayBindingPattern(child.name)) states.push(child.name.elements[0].name.getText(ast));
        }
        ts.forEachChild(child, visit);
      };
      visit(declaration); definitions.set(declaration.name.text, { refs, states });
    }
    const compiled = ts.transpileModule(source, {
      fileName: path, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
      transformers: { before: [context => root => {
        const visit = node => ts.isVoidExpression(node)
          ? context.factory.createCallExpression(context.factory.createIdentifier("__captureTask"), undefined, [ts.visitNode(node.expression, visit)])
          : ts.visitEachChild(node, visit, context);
        return ts.visitNode(root, visit);
      }] },
    }).outputText;
    const module = { exports: {} }, mocks = { ...common, ...extra };
    new Function("require", "module", "exports", "document", "window", "__captureTask", compiled)(name => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith(".")) throw new Error("Unexpected metadata dependency: " + name);
      return appRequire(name);
    }, module, module.exports, document, window, captureTask);
    return module.exports;
  }
  const provider = load("components/interaction-dialog-provider.tsx");
  const interaction = { useInteractionDialog: () => {
    const value = provider.useInteractionDialog();
    return { ...value, confirm: async options => {
      confirms.push(options);
      if (holds.has("confirm")) await holds.get("confirm").promise;
      return confirming;
    } };
  } };
  const editor = hasEditor ? load(metadataPath, { "../../components/interaction-dialog-provider": interaction }) : null;
  const Editor = props => frame("editor", "ConversationMetadataDialog", () => editor.ConversationMetadataDialog(props));
  const menu = load("features/conversations/conversation-action-menu.tsx", {
    "../../components/interaction-dialog-provider": interaction,
    "./conversation-metadata-dialog": { ConversationMetadataDialog: Editor },
  });
  const onChanged = async () => {
    refreshCalls += 1;
    if (holds.has("changed")) await holds.get("changed").promise;
    if (refresh === "throw") throw new Error("Synthetic refresh callback failure");
    await client.invalidateQueries({ queryKey: ["conversations"] });
  };
  const Menu = () => frame("menu", "ConversationActionMenu", () => menu.ConversationActionMenu({ conversation: propsConversation, onChanged }));
  const Provider = () => frame("provider", "InteractionDialogProvider", () => provider.InteractionDialogProvider({ children: mounted ? React.createElement(Menu) : null }));
  const render = ({ effects = true } = {}) => {
    buttons.length = fields.length = forms.length = focusOptions.length = 0;
    for (const f of frames.values()) f.seen = false;
    const html = renderToStaticMarkup(React.createElement(Provider));
    for (const [name, f] of frames) {
      if (!f.seen) { for (const e of f.effects) e.cleanup?.(); frames.delete(name); continue; }
      if (effects) for (const e of f.effects) if (e.changed) { e.changed = false; e.cleanup?.(); e.cleanup = e.operation(); }
    }
    return html;
  };
  const button = label => {
    const item = buttons.find(props => (props["aria-label"] ?? textOf(props.children).trim()) === label);
    assert.ok(item, "Missing rendered action: " + label);
    return item;
  };
  const open = async () => {
    render(); button((locale === "zh-CN" ? "管理" : "Manage") + " " + (propsConversation.display_title || propsConversation.title)).onClick({ preventDefault: noop, stopPropagation: noop });
    render(); button(field === "title" ? (locale === "zh-CN" ? "重命名对话" : "Rename conversation") : (locale === "zh-CN" ? "编辑简介" : "Edit description")).onClick();
    await flush(); render();
  };
  const change = value => { assert.ok(fields[0], "Editable field exists"); fields[0].onChange({ target: { value } }); render(); };
  const submit = async () => { assert.ok(forms[0], "Metadata form exists"); captureTask(forms[0].onSubmit({ preventDefault: noop })); await flush(); return render(); };
  const hold = name => { let release; const promise = new Promise(resolve => { release = resolve; }); holds.set(name, { promise, release });
    return () => { holds.delete(name); release(); }; };
  const busy = () => {
    const f = frames.get(hasEditor ? "editor" : "menu");
    if (!f) return false;
    const names = definitions.get(hasEditor ? "ConversationMetadataDialog" : "ConversationActionMenu").states;
    const value = f.states[names.indexOf(hasEditor ? "phase" : "busy")];
    return hasEditor ? value === "saving" || value === "checking" : value !== null;
  };
  await open();
  return { client, keys, initial, other, relation, recent, writes, checks, failures, confirms, signals, writeSignals, focusOptions, document, opener,
    render, open, change, submit, hold, button, busy, observer, fields: () => fields, forms: () => forms,
    server: () => server, setServer: value => { server = value; }, setOutcome: value => { writeOutcome = value; },
    refreshCalls: () => refreshCalls, readCalls: () => readCalls,
    setCheckError: value => { checkError = value; }, setReadError: value => { readError = value; },
    setProps: value => { propsConversation = value; }, setConfirm: value => { confirming = value; },
    changeAccount: () => { epoch += 1; }, unmount: () => { mounted = false; render(); },
    click: async label => { button(label).onClick(); await flush(); return render(); },
    dispose: async () => { mounted = false; render(); for (const item of holds.values()) item.release(); holds.clear(); await flush(); stop(); observer.destroy(); client.clear(); },
  };
}

test("rename preserves the existing title/display_title patch contract (control)", async () => {
  const f = await fixture({ field: "title" });
  try { f.change("  Synthetic new title  "); await f.submit(); assert.deepEqual(f.writes, [{ id: f.initial.id, patch: { title: "Synthetic new title", display_title: "Synthetic new title" } }]); }
  finally { await f.dispose(); }
});
test("blank titles never send a metadata write (control)", async () => {
  const f = await fixture({ field: "title" });
  try { f.change("  "); const html = await f.submit(); assert.equal(f.writes.length, 0); assert.match(html, /cannot be empty|required/i); }
  finally { await f.dispose(); }
});
test("description editor prefills the existing description (control)", async () => {
  const f = await fixture();
  try { assert.equal(f.fields()[0].value, f.initial.description_markdown); }
  finally { await f.dispose(); }
});
test("clearing a description sends explicit null and no unrelated fields", async () => {
  const f = await fixture();
  try { f.change(" \n "); await f.submit(); assert.deepEqual(f.writes, [{ id: f.initial.id, patch: { description_markdown: null } }]); }
  finally { await f.dispose(); }
});
test("the Markdown description uses a multiline field without native UTF-16 maxlength", async () => {
  const f = await fixture();
  try { assert.equal(f.fields()[0].type, "textarea"); assert.equal(f.fields()[0].maxLength, undefined); }
  finally { await f.dispose(); }
});
test("500 Unicode code points are saved intact", async () => {
  const f = await fixture();
  try { const value = "😀".repeat(500); f.change(value); await f.submit(); assert.equal(f.writes[0]?.patch.description_markdown, value); }
  finally { await f.dispose(); }
});
test("an astral character at the old slice boundary is never cut in half", async () => {
  const f = await fixture();
  try { const value = "a".repeat(499) + "😀"; f.change(value); await f.submit(); assert.equal(f.writes[0]?.patch.description_markdown, value); }
  finally { await f.dispose(); }
});
test("over-limit input is kept with an explicit error and no PATCH", async () => {
  const f = await fixture();
  try { const value = "a".repeat(501); f.change(value); const html = await f.submit(); assert.equal(f.writes.length, 0); assert.equal(f.fields()[0].value, value); assert.match(html, /500/); assert.match(html, /role="alert"/); }
  finally { await f.dispose(); }
});
test("description-only edits keep internal Markdown lines and the field scope (control)", async () => {
  const f = await fixture();
  try { f.change("  Synthetic first\n\n- Synthetic second  "); await f.submit(); assert.deepEqual(f.writes[0]?.patch, { description_markdown: "Synthetic first\n\n- Synthetic second" }); }
  finally { await f.dispose(); }
});
for (const field of ["title", "description"]) test("unchanged " + field + " sends no write or refresh", async () => {
  const f = await fixture({ field });
  try { await f.submit(); assert.equal(f.writes.length, 0); assert.equal(f.refreshCalls(), 0); }
  finally { await f.dispose(); }
});
test("an uncertain write retains the submitted draft and exposes a read-only check", async () => {
  const f = await fixture({ outcome: "lost" });
  try { f.change("Synthetic retained draft"); const html = await f.submit(); assert.equal(f.fields()[0]?.value, "Synthetic retained draft"); assert.match(html, /could not be confirmed/i); assert.ok(f.button("Check current value")); }
  finally { await f.dispose(); }
});
test("checking a matching current value does not repeat the PATCH", async () => {
  const f = await fixture({ outcome: "lost" });
  try { f.change("Synthetic checked draft"); await f.submit(); await f.click("Check current value"); assert.equal(f.writes.length, 1); assert.equal(f.checks.length, 1); assert.equal(f.checks[0].id, f.initial.id); assert.equal(f.forms().length, 0); }
  finally { await f.dispose(); }
});
test("failed checks retain uncertainty and the draft without another write", async () => {
  const f = await fixture({ outcome: "lost" });
  try { f.change("Synthetic retained draft"); await f.submit(); f.setCheckError(new ApiRequestError(503)); const html = await f.click("Check current value"); assert.equal(f.fields()[0]?.value, "Synthetic retained draft"); assert.match(html, /could not|unable/i); assert.equal(f.writes.length, 1); assert.ok(f.button("Check current value")); }
  finally { await f.dispose(); }
});
test("a confirmed save settles before a held owning-list refresh", async () => {
  const f = await fixture();
  try { f.hold("changed"); f.change("Synthetic saved description"); await f.submit(); assert.equal(f.refreshCalls(), 1); assert.equal(f.busy(), false); assert.equal(f.forms().length, 0); }
  finally { await f.dispose(); }
});
test("a confirmed save refreshes the actual remote Reader key", async () => {
  const f = await fixture();
  try { f.hold("read"); f.change("Synthetic remote description"); await f.submit(); assert.equal(f.observer.getCurrentResult().isFetching, true); assert.equal(f.client.getQueryData(f.keys.remote).description_markdown, "Synthetic remote description"); }
  finally { await f.dispose(); }
});
test("confirmed metadata updates existing list and project copies, preserving relations", async () => {
  const f = await fixture();
  try { f.change("Synthetic canonical description"); await f.submit();
    for (const key of [f.keys.list, f.keys.sidebar, f.keys.project]) {
      const rows = f.client.getQueryData(key); assert.equal(rows[0].description_markdown, "Synthetic canonical description"); assert.equal(rows[1].id, f.other.id);
    }
    assert.deepEqual(f.client.getQueryData(f.keys.project)[0].project_relation, f.relation);
  } finally { await f.dispose(); }
});
test("recent metadata changes without replacing the real reading anchor", async () => {
  const f = await fixture({ field: "title" });
  try { f.change("Synthetic renamed recent"); await f.submit(); const recent = f.client.getQueryData(f.keys.recent)[0]; assert.equal(recent.conversation.title, "Synthetic renamed recent"); assert.deepEqual({ ...recent, conversation: f.recent.conversation }, f.recent); }
  finally { await f.dispose(); }
});
test("metadata saves never rewrite offline or unrelated detail namespaces (control)", async () => {
  const f = await fixture();
  try { f.change("Synthetic private edit"); await f.submit(); assert.deepEqual(f.client.getQueryData(f.keys.offline), f.initial); assert.deepEqual(f.client.getQueryData(f.keys.unrelated), f.other); }
  finally { await f.dispose(); }
});
test("a rejecting follow-up callback cannot leak a metadata save rejection", async () => {
  const f = await fixture({ refresh: "throw" });
  try { f.change("Synthetic successful edit"); await f.submit(); assert.equal(f.failures.length, 0); assert.equal(f.writes.length, 1); assert.equal(f.forms().length, 0); }
  finally { await f.dispose(); }
});

test("rapid submit callbacks reserve exactly one pending write", async () => {
  const f = await fixture();
  try {
    f.change("Synthetic once"); f.hold("write");
    const submit = f.forms()[0].onSubmit;
    submit({ preventDefault: noop }); submit({ preventDefault: noop }); await flush(); f.render();
    assert.equal(f.writes.length, 1); assert.equal(f.fields()[0].readOnly, true);
    assert.equal(f.button("Saving…").disabled, true); assert.equal(f.button("Cancel").disabled, true);
    f.button("Cancel").onClick(); f.render(); assert.equal(f.forms().length, 1); assert.equal(f.confirms.length, 0);
  } finally { await f.dispose(); }
});
test("pending and unknown states fence captured field edits and submit callbacks", async () => {
  const f = await fixture({ outcome: "lost" });
  try {
    f.change("Synthetic original request");
    const change = f.fields()[0].onChange, submit = f.forms()[0].onSubmit;
    await f.submit();
    change({ target: { value: "Synthetic replacement" } }); submit({ preventDefault: noop }); await flush(); f.render();
    assert.equal(f.fields()[0].value, "Synthetic original request"); assert.equal(f.writes.length, 1);
  } finally { await f.dispose(); }
});
test("different current values are compared without declaring the previous save unapplied", async () => {
  const f = await fixture({ outcome: "rejected" });
  try {
    f.change("Synthetic draft to compare"); await f.submit();
    const html = await f.click("Check current value");
    assert.match(html, /Synthetic original description/); assert.match(html, /cannot prove/);
    assert.ok(f.button("Continue editing draft")); assert.ok(f.button("Use current value"));
    assert.equal(f.fields()[0].readOnly, true); assert.equal(f.writes.length, 1); assert.equal(f.checks.length, 1);
  } finally { await f.dispose(); }
});
test("keeping a differing draft requires a separate explicit save", async () => {
  const f = await fixture({ outcome: "rejected" });
  try {
    f.change("Synthetic reviewed draft"); await f.submit(); await f.click("Check current value");
    await f.click("Continue editing draft");
    assert.equal(f.writes.length, 1); assert.equal(f.fields()[0].readOnly, false);
    f.setOutcome("success"); await f.submit();
    assert.equal(f.writes.length, 2); assert.deepEqual(f.writes[1].patch, { description_markdown: "Synthetic reviewed draft" });
  } finally { await f.dispose(); }
});
test("using a differing current value closes without changing the server", async () => {
  const f = await fixture({ outcome: "rejected" });
  try {
    f.change("Synthetic discarded draft"); await f.submit(); await f.click("Check current value");
    await f.click("Use current value");
    assert.equal(f.writes.length, 1); assert.equal(f.forms().length, 0); assert.deepEqual(f.server(), f.initial);
  } finally { await f.dispose(); }
});
test("rename comparison exposes a different saved title even when the display title matches", async () => {
  const f = await fixture({ field: "title", outcome: "rejected" });
  try {
    f.change("Synthetic intended title"); await f.submit();
    f.setServer(conversation({ title: "Synthetic different saved title", display_title: "Synthetic intended title" }));
    const html = await f.click("Check current value");
    assert.match(html, /Synthetic different saved title/);
    assert.match(html, /Saved title/); assert.match(html, /Display title/);
    assert.match(html, /Saving again sets both titles to your draft/);
    assert.equal(f.fields()[0].value, "Synthetic intended title"); assert.equal(f.writes.length, 1);
  } finally { await f.dispose(); }
});

for (const difference of ["saved title", "unset display title"]) test("reviewed rename is not a no-op when only the " + difference + " differs", async () => {
  const f = await fixture({ field: "title", outcome: "rejected" });
  try {
    const value = "Synthetic intended title";
    f.change(value); await f.submit();
    f.setServer(conversation(difference === "saved title"
      ? { title: "Synthetic different saved title", display_title: value }
      : { title: value, display_title: null }));
    await f.click("Check current value"); await f.click("Continue editing draft");
    assert.equal(f.writes.length, 1); assert.equal(f.fields()[0].value, value);
    f.setOutcome("success"); await f.submit();
    assert.equal(f.writes.length, 2);
    assert.deepEqual(f.writes[1].patch, { title: value, display_title: value });
    assert.equal(f.forms().length, 0);
  } finally { await f.dispose(); }
});

for (const displayTitle of [null, "Synthetic separate display title"]) test("an untouched initial rename remains a no-op with display title " + displayTitle, async () => {
  const f = await fixture({ field: "title", initial: conversation({ display_title: displayTitle }) });
  try {
    assert.equal(f.fields()[0].value, displayTitle || f.initial.title);
    await f.submit();
    assert.equal(f.writes.length + f.refreshCalls(), 0); assert.equal(f.forms().length, 0);
  } finally { await f.dispose(); }
});

for (const action of ["Continue editing draft", "Use current value"]) test("a later successful check retires the previous " + action + " callback", async () => {
  const f = await fixture({ outcome: "rejected" });
  try {
    f.change("Synthetic retained draft"); await f.submit(); await f.click("Check current value");
    const oldAction = f.button(action).onClick;
    f.setServer(conversation({ description_markdown: "Synthetic newer checked value", offline_revision: 9 }));
    await f.click("Check current value"); oldAction();
    const html = f.render();
    assert.equal(f.forms().length, 1); assert.equal(f.fields()[0].readOnly, true);
    assert.match(html, /Synthetic newer checked value/);
    assert.equal(f.writes.length, 1); assert.equal(f.checks.length, 2);
    assert.deepEqual(f.client.getQueryData(f.keys.remote), f.initial);
    await f.click("Use current value");
    assert.equal(f.client.getQueryData(f.keys.remote).description_markdown, "Synthetic newer checked value");
  } finally { await f.dispose(); }
});

test("a failed recheck removes its old comparison and fences the old keep action", async () => {
  const f = await fixture({ outcome: "rejected" });
  try {
    f.change("Synthetic checked draft"); await f.submit(); await f.click("Check current value");
    const keep = f.button("Continue editing draft").onClick;
    f.setCheckError(new ApiRequestError(503)); await f.click("Check current value");
    keep(); const html = f.render();
    assert.doesNotMatch(html, /Continue editing draft|Current server value<\/h3>/);
    assert.equal(f.fields()[0].readOnly, true); assert.equal(f.writes.length, 1);
  } finally { await f.dispose(); }
});
test("held checks suppress duplicate checks, save and close", async () => {
  const f = await fixture({ outcome: "lost" });
  try {
    f.change("Synthetic pending check"); await f.submit(); f.hold("check");
    const check = f.button("Check current value").onClick;
    check(); check(); await flush(); f.render();
    assert.equal(f.checks.length, 1); assert.equal(f.button("Check current value").disabled, true);
    f.button("Cancel").onClick(); f.render();
    assert.equal(f.forms().length, 1); assert.equal(f.confirms.length, 0); assert.equal(f.writes.length, 1);
  } finally { await f.dispose(); }
});
for (const status of [401, 403, 404]) test("a " + status + " check retains the draft without enabling blind saving", async () => {
  const f = await fixture({ outcome: "rejected" });
  try {
    f.change("Synthetic access draft"); await f.submit(); f.setCheckError(new ApiRequestError(status));
    const html = await f.click("Check current value");
    assert.match(html, /access may have changed/); assert.equal(f.fields()[0].readOnly, true);
    assert.equal(f.writes.length, 1); assert.equal(f.fields()[0].value, "Synthetic access draft");
  } finally { await f.dispose(); }
});
test("a rejected validation response retains editable input for explicit correction", async () => {
  const f = await fixture({ outcome: "invalid" });
  try {
    f.change("Synthetic rejected draft"); const html = await f.submit();
    assert.match(html, /server did not accept/i); assert.doesNotMatch(html, /Synthetic upstream detail/);
    assert.equal(f.fields()[0].readOnly, false); assert.equal(f.fields()[0].value, "Synthetic rejected draft");
    f.setOutcome("success"); f.change("Synthetic corrected draft"); await f.submit(); assert.equal(f.writes.length, 2);
  } finally { await f.dispose(); }
});
test("unchanged and cancelled dirty dismissal do not write", async () => {
  const f = await fixture();
  try {
    f.setConfirm(false); f.change("Synthetic dirty draft"); await f.click("Cancel");
    assert.equal(f.confirms.length, 1); assert.equal(f.fields()[0].value, "Synthetic dirty draft");
    assert.equal(f.writes.length, 0); assert.equal(f.forms().length, 1);
  } finally { await f.dispose(); }
});
test("pristine dismissal skips confirmation and refresh", async () => {
  const f = await fixture();
  try { await f.click("Cancel"); assert.equal(f.confirms.length, 0); assert.equal(f.forms().length, 0); assert.equal(f.writes.length + f.refreshCalls(), 0); }
  finally { await f.dispose(); }
});
test("unknown dismissal explicitly says it does not cancel or undo the server save", async () => {
  const f = await fixture({ outcome: "lost" });
  try {
    f.change("Synthetic applied but unconfirmed"); await f.submit(); await f.click("Cancel");
    assert.match(f.confirms[0].title, /unconfirmed/); assert.match(f.confirms[0].description, /does not cancel or undo/);
    assert.equal(f.forms().length, 0); assert.equal(f.server().description_markdown, "Synthetic applied but unconfirmed");
  } finally { await f.dispose(); }
});
test("a pending discard confirmation reserves dismissal and fences save and edit", async () => {
  const f = await fixture();
  try {
    f.change("Synthetic discard draft"); const edit = f.fields()[0].onChange, submit = f.forms()[0].onSubmit;
    f.hold("confirm"); const close = f.button("Cancel").onClick; close(); close();
    edit({ target: { value: "Synthetic newer draft" } }); submit({ preventDefault: noop }); await flush(); f.render();
    assert.equal(f.confirms.length, 1); assert.equal(f.writes.length, 0); assert.equal(f.fields()[0].value, "Synthetic discard draft");
    assert.equal(f.fields()[0].readOnly, true);
  } finally { await f.dispose(); }
});
test("background prop refresh never replaces an open draft", async () => {
  const f = await fixture();
  try {
    f.change("Synthetic local draft"); f.setProps(conversation({ description_markdown: "Synthetic newer read", offline_revision: 9 }));
    f.render(); assert.equal(f.fields()[0].value, "Synthetic local draft"); await f.submit();
    assert.deepEqual(f.writes[0].patch, { description_markdown: "Synthetic local draft" });
  } finally { await f.dispose(); }
});
for (const change of ["unmount", "account"]) test("a late write after " + change + " cannot publish to caches", async () => {
  const f = await fixture();
  try {
    f.change("Synthetic late write"); const release = f.hold("write"); await f.submit();
    if (change === "unmount") f.unmount(); else f.changeAccount();
    release(); await flush(); f.render();
    assert.equal(f.writes.length, 1); assert.equal(f.refreshCalls(), 0);
    assert.deepEqual(f.client.getQueryData(f.keys.remote), f.initial);
    assert.equal(f.server().description_markdown, "Synthetic late write");
  } finally { await f.dispose(); }
});
test("unmount aborts only a result check and ignores its late value", async () => {
  const f = await fixture({ outcome: "lost" });
  try {
    f.change("Synthetic late check"); await f.submit(); const release = f.hold("check"); await f.click("Check current value");
    f.unmount(); assert.equal(f.checks[0].signal.aborted, true);
    release(); await flush(); assert.deepEqual(f.client.getQueryData(f.keys.remote), f.initial); assert.equal(f.writes.length, 1);
  } finally { await f.dispose(); }
});
test("account changes fence captured save, check and close before another render", async () => {
  const f = await fixture();
  try {
    f.change("Synthetic old account"); const submit = f.forms()[0].onSubmit, close = f.button("Cancel").onClick;
    f.changeAccount(); submit({ preventDefault: noop }); close(); await flush();
    assert.equal(f.writes.length + f.checks.length + f.confirms.length, 0);
  } finally { await f.dispose(); }
});
test("late pre-save Query reads cannot roll back the confirmed detail", async () => {
  const f = await fixture();
  try {
    const release = f.hold("read"); void f.observer.refetch(); await flush();
    f.change("Synthetic newer metadata"); await f.submit(); assert.equal(f.signals[0].aborted, true);
    release(); await flush(); assert.equal(f.client.getQueryData(f.keys.remote).description_markdown, "Synthetic newer metadata");
  } finally { await f.dispose(); }
});
test("publishing an older acknowledgement preserves newer cached metadata", async () => {
  const f = await fixture();
  try {
    const newer = conversation({ description_markdown: "Synthetic newer cache", offline_revision: 99 });
    f.client.setQueryData(f.keys.remote, newer); f.hold("read");
    f.change("Synthetic delayed response"); await f.submit();
    assert.deepEqual(f.client.getQueryData(f.keys.remote), newer);
  } finally { await f.dispose(); }
});
test("cache publication neither creates missing lists nor inserts absent records", async () => {
  const f = await fixture();
  try {
    f.client.removeQueries({ queryKey: f.keys.project, exact: true }); f.client.removeQueries({ queryKey: f.keys.recent, exact: true });
    f.client.setQueryData(f.keys.list, [f.other]);
    f.change("Synthetic no fabricated rows"); await f.submit();
    assert.equal(f.client.getQueryData(f.keys.project), undefined); assert.equal(f.client.getQueryData(f.keys.recent), undefined);
    assert.deepEqual(f.client.getQueryData(f.keys.list), [f.other]);
  } finally { await f.dispose(); }
});
test("optional empty descriptions already absent are no-ops", async () => {
  const f = await fixture({ initial: conversation({ description_markdown: null }) });
  try { f.change(" \n "); await f.submit(); assert.equal(f.writes.length, 0); assert.equal(f.forms().length, 0); }
  finally { await f.dispose(); }
});
test("length validation uses the normalized value and clears when corrected", async () => {
  const f = await fixture();
  try {
    f.change("a".repeat(501)); await f.submit(); assert.equal(f.fields()[0]["aria-invalid"], true);
    f.change("  " + "😀".repeat(500) + " \n"); assert.equal(f.fields()[0]["aria-invalid"], false);
    await f.submit(); assert.equal(f.writes[0].patch.description_markdown, "😀".repeat(500));
  } finally { await f.dispose(); }
});
test("composed emoji are counted in Unicode code points, not grapheme clusters", async () => {
  const f = await fixture();
  try {
    f.change("👩‍🔬".repeat(167)); await f.submit();
    assert.equal(f.writes.length, 0); assert.match(f.render(), /501 \/ 500/);
  } finally { await f.dispose(); }
});
test("title edits retain the pre-existing lack of a client title length cap", async () => {
  const f = await fixture({ field: "title" });
  try { f.change("T".repeat(501)); await f.submit(); assert.equal(f.writes[0].patch.title.length, 501); }
  finally { await f.dispose(); }
});
test("description field labels, help and error ids remain associated", async () => {
  const f = await fixture();
  try {
    f.change("x".repeat(501)); const html = await f.submit(), input = f.fields()[0];
    assert.match(html, /Markdown description \(optional\)/); assert.ok(input["aria-describedby"].includes(input.id + "-help"));
    assert.ok(input["aria-describedby"].includes(input.id + "-error")); assert.match(html, /role="dialog" aria-modal="true"/);
  } finally { await f.dispose(); }
});
test("Chinese recovery and validation use local copy without raw upstream text", async () => {
  const f = await fixture({ locale: "zh-CN", outcome: "lost" });
  try {
    f.change("合成简介"); const html = await f.submit();
    assert.match(html, /暂时无法确认保存结果/); assert.match(html, /Markdown 简介（可选）/);
    assert.doesNotMatch(html, /Synthetic upstream detail|The save/); await f.click("核对当前内容");
    assert.equal(f.writes.length, 1); assert.equal(f.checks.length, 1);
  } finally { await f.dispose(); }
});
test("the editor passes a bounded abort signal to the existing write helper", async () => {
  const f = await fixture();
  try { f.change("Synthetic timeout guard"); await f.submit(); assert.ok(f.writeSignals[0] instanceof AbortSignal); assert.equal(f.writeSignals[0].aborted, false); }
  finally { await f.dispose(); }
});
test("the focus contract restores the stable menu opener without claiming DOM focus", async () => {
  const f = await fixture();
  try {
    const focus = f.focusOptions.find(options => options.open && options.restoreFocus);
    assert.ok(focus); assert.equal(focus.restoreFocus(), f.opener); assert.ok(focus.initialFocusRef);
  } finally { await f.dispose(); }
});
test("pristine close fences captured callbacks before effect cleanup", async () => {
  const f = await fixture();
  try {
    const change = f.fields()[0].onChange, submit = f.forms()[0].onSubmit;
    f.button("Cancel").onClick();
    change({ target: { value: "Synthetic stale change" } }); submit({ preventDefault: noop });
    await flush(); f.render(); assert.equal(f.writes.length, 0); assert.equal(f.forms().length, 0);
  } finally { await f.dispose(); }
});
test("no-op save fences captured callbacks before unmount", async () => {
  const f = await fixture();
  try {
    const change = f.fields()[0].onChange, submit = f.forms()[0].onSubmit;
    submit({ preventDefault: noop }); change({ target: { value: "Synthetic stale change" } }); submit({ preventDefault: noop });
    await flush(); f.render(); assert.equal(f.writes.length, 0); assert.equal(f.forms().length, 0);
  } finally { await f.dispose(); }
});
test("a mismatched write response cannot publish another conversation", async () => {
  const f = await fixture({ outcome: "wrong-id" });
  try {
    f.change("Synthetic mismatched response"); const html = await f.submit();
    assert.match(html, /did not match this conversation/); assert.ok(f.button("Check current value"));
    assert.deepEqual(f.client.getQueryData(f.keys.remote), f.initial); assert.equal(f.refreshCalls(), 0);
  } finally { await f.dispose(); }
});
for (const withSignal of [true, false]) test("the actual update helper preserves JSON and optional signal: " + withSignal, async () => {
  const source = readFileSync(new URL("../../apps/web/lib/api.ts", import.meta.url), "utf8");
  const ast = ts.createSourceFile("api.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const fn = ast.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === "updateConversation");
  assert.ok(fn);
  const compiled = ts.transpileModule(fn.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} }, calls = [];
  new Function("exports", "fetchJson", "jsonRequest", compiled)(module.exports,
    async (path, init) => { calls.push({ path, init }); return conversation(); },
    (method, body) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  const patch = { description_markdown: null }, controller = new AbortController();
  await module.exports.updateConversation("synthetic-metadata", patch, withSignal ? controller.signal : undefined);
  assert.equal(calls[0].path, "/api/conversations/synthetic-metadata");
  assert.equal(calls[0].init.method, "PATCH"); assert.deepEqual(JSON.parse(calls[0].init.body), patch);
  assert.equal(calls[0].init.signal, withSignal ? controller.signal : undefined);
});
