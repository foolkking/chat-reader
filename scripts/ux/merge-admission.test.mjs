import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { URL } from "node:url";

const appRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = appRequire("typescript");
const React = appRequire("react");
const jsx = appRequire("react/jsx-runtime");
const { renderToStaticMarkup } = appRequire("react-dom/server");
const ids = ["10000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000002"];
const key = "20000000-0000-4000-8000-000000000001";
const task = { job_id: "30000000-0000-4000-8000-000000000001", job_type: "conversation_merge", status: "queued", result: {} };
const saved = { idempotencyKey: key, conversationIds: ids, title: "Synthetic retained merge" };
const noop = () => {};
const source = path => readFileSync(new URL(`../../apps/web/${path}`, import.meta.url), "utf8");
const compile = code => ts.transpileModule(code, { fileName: "test.tsx", compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
class ApiRequestError extends Error {
  constructor(status, code) { super("Synthetic raw request detail"); this.status = status; this.code = code; }
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

// Actual hook logic; React state/effect scheduling, storage and HTTP are explicit
// deterministic doubles. These are not React lifecycle or browser assertions.
function fixture({ initial = null, open = true, submit = async () => task, lookup = async () => ({ found: false, task: null }), onAccepted = noop, storageUnavailable = false } = {}) {
  const storage = new Map(initial ? [["chat-reader:merge-request:synthetic-owner:all", typeof initial === "string" ? initial : JSON.stringify(initial)]] : []);
  let owner = "synthetic-owner", epoch = 1, props = { open }, cursor = 0, dirty = true, result;
  const slots = [], effects = [], calls = [], reads = [], accepted = [];
  const events = new globalThis.EventTarget();
  const hookReact = {
    useState(initialValue) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initialValue === "function" ? initialValue() : initialValue };
      return [slots[index].value, value => {
        const next = typeof value === "function" ? value(slots[index].value) : value;
        if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true; }
      }];
    },
    useRef(initialValue) { const index = cursor++; return slots[index] ??= { current: initialValue }; },
    useEffect(run, deps) {
      const index = cursor++, previous = slots[index];
      if (!previous || deps.some((value, offset) => !Object.is(value, previous.deps[offset]))) {
        effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: run() }; });
      }
    },
  };
  const mocks = {
    react: hookReact,
    "../../lib/api": { ApiRequestError, getConversationMergeRequest: async (requestKey, signal) => { reads.push({ requestKey, signal }); return lookup(requestKey, signal); } },
    "../../lib/auth-client": { getCurrentOfflineRuntimeUserId: () => owner },
    "../../lib/offline-access": { authenticationGeneration: () => epoch, offlineAuthenticationRequired: () => true, OFFLINE_ACCESS_LOCKED_EVENT: "synthetic-lock" },
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", "sessionStorage", "window", "AbortController", "crypto", compile(source("features/conversations/use-merge-admission.ts")))(
    name => { assert.ok(Object.hasOwn(mocks, name), name); return mocks[name]; }, module, module.exports,
    { getItem: name => { if (storageUnavailable) throw new Error("Synthetic blocked storage"); return storage.get(name) ?? null; },
      setItem: (name, value) => { if (storageUnavailable) throw new Error("Synthetic blocked storage"); storage.set(name, value); },
      removeItem: name => { if (storageUnavailable) throw new Error("Synthetic blocked storage"); storage.delete(name); } },
    events, globalThis.AbortController, globalThis.crypto,
  );
  const options = { onSubmit: async (request, signal) => { calls.push({ request: structuredClone(request), signal }); return submit(request, signal); },
    onAccepted: value => { accepted.push(value); return onAccepted(value); } };
  const render = () => { dirty = false; cursor = 0; result = module.exports.useMergeAdmission({ ...options, ...props }); return result; };
  const current = () => {
    for (let round = 0; dirty || effects.length; round += 1) {
      assert.ok(round < 30, "hook fixture settled");
      if (dirty) render();
      while (effects.length) effects.shift()();
    }
    return result;
  };
  current();
  return { current, calls, reads, accepted, storage, decode: module.exports.decodeMergeRequest,
    props: next => { props = { ...props, ...next }; dirty = true; return current(); },
    // Expose the render-to-passive-effect interval without claiming to emulate
    // a real React scheduler. Old callbacks must already respect the new scope.
    beforeEffects: next => { props = { ...props, ...next }; return render(); },
    owner: value => { owner = value; epoch += 1; dirty = true; return current(); },
    lock: () => { owner = null; epoch += 1; events.dispatchEvent(new globalThis.Event("synthetic-lock")); return current(); },
    dispose: () => { for (const slot of slots) slot?.cleanup?.(); },
  };
}

test("restoring an original request offers checking without any automatic HTTP", () => {
  const f = fixture({ initial: saved });
  try { assert.equal(f.current().phase, "unknown"); assert.deepEqual(f.current().request, saved); assert.equal(f.calls.length + f.reads.length, 0); }
  finally { f.dispose(); }
});

test("a closed page-level owner restores a pending request without opening or doing HTTP", () => {
  const f = fixture({ initial: saved, open: false });
  try {
    assert.equal(f.current().phase, "unknown"); assert.deepEqual(f.current().request, saved);
    assert.equal(f.calls.length + f.reads.length, 0);
    f.props({ open: true }); assert.deepEqual(f.current().request, saved);
    assert.equal(f.calls.length + f.reads.length, 0);
  } finally { f.dispose(); }
});

test("a closed owner and actions captured before closing cannot read or resubmit", async () => {
  const f = fixture({ initial: saved });
  try {
    const previous = f.current(); f.props({ open: false });
    previous.start(ids, "Ignored closed action"); previous.retry(); await previous.check();
    f.current().start(ids, "Ignored current action"); f.current().retry(); await f.current().check();
    assert.equal(f.calls.length + f.reads.length, 0); assert.equal(f.storage.size, 1);
  } finally { f.dispose(); }
});

for (const next of [{ open: false }, { projectId: "synthetic-next-project" }]) {
  const change = next.open === false ? "close" : "project switch";
  for (const action of ["start", "check", "retry"]) {
    test(`${change} render fences captured ${action} before passive effects`, async () => {
      const f = fixture({ initial: action === "start" ? null : saved });
      try {
        if (action === "retry") await f.current().check();
        const previous = f.current(), previousReads = f.reads.length;
        const rendered = f.beforeEffects(next);
        assert.equal(rendered.request, null, "the new render already masks the previous context");
        if (action === "start") previous.start(ids, "Synthetic stale action");
        else await previous[action]();
        assert.equal(f.calls.length, 0, "the old callback cannot write in the new rendered context");
        assert.equal(f.reads.length, previousReads, "the old callback cannot read in the new rendered context");
      } finally { f.dispose(); }
    });
  }
  test(`${change} render fences late acknowledgement before passive effects`, async () => {
    const held = deferred();
    const f = fixture({ initial: saved, lookup: () => held.promise });
    try {
      const pending = f.current().check();
      f.beforeEffects(next);
      held.resolve({ found: true, task }); await pending;
      assert.equal(f.accepted.length, 0, "the old result cannot acknowledge against the new rendered context");
      assert.equal(f.storage.size, 1, "the old request remains recoverable in its own scope");
      assert.deepEqual(f.current().request, next.open === false ? saved : null);
    } finally { f.dispose(); }
  });
}

test("pending double clicks submit once and freeze the original payload", async () => {
  const held = deferred();
  const f = fixture({ submit: () => held.promise });
  try {
    const selection = [...ids], initial = f.current();
    initial.start(selection, " Synthetic submitted title "); initial.start(ids, "Second click");
    selection.reverse();
    assert.equal(f.current().phase, "submitting"); assert.equal(f.calls.length, 1);
    assert.deepEqual(f.calls[0].request.conversationIds, ids); assert.equal(f.calls[0].request.title, "Synthetic submitted title");
    held.reject(new Error("Synthetic lost response")); await setImmediate();
    assert.equal(f.current().phase, "unknown");
  } finally { f.dispose(); }
});

test("unknown writes cannot resubmit until an explicit missing-result read", async () => {
  const f = fixture({ submit: async () => { throw new Error("Synthetic lost response"); } });
  try {
    f.current().start(ids, "Synthetic merge"); await setImmediate();
    const original = f.calls[0].request;
    f.current().start([...ids].reverse(), "Different"); f.current().retry();
    assert.equal(f.calls.length, 1);
    await f.current().check(); assert.equal(f.calls.length, 1); assert.equal(f.current().phase, "retry");
    f.current().retry(); f.current().retry(); await setImmediate();
    assert.equal(f.calls.length, 2); assert.deepEqual(f.calls[1].request, original);
    assert.deepEqual(f.reads.map(read => read.requestKey), [original.idempotencyKey]);
  } finally { f.dispose(); }
});

test("a failed read and an incomplete receipt keep the original request and forbid writes", async () => {
  let count = 0;
  const f = fixture({ initial: saved, lookup: async () => { if (!count++) throw new Error("Synthetic failed read"); return { found: true, task: null }; } });
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await f.current().check(); assert.equal(f.current().phase, "unknown"); assert.deepEqual(f.current().request, saved); f.current().retry();
    }
    assert.equal(f.calls.length, 0); assert.equal(f.reads.length, 2);
  } finally { f.dispose(); }
});

for (const status of ["queued", "processing", "cancelling", "committed", "failed", "cancelled"]) {
  test(`finding the original ${status} task acknowledges it without another POST`, async () => {
    const receipt = { ...task, status };
    const f = fixture({ initial: saved, lookup: async () => ({ found: true, task: receipt }) });
    try {
      await f.current().check();
      assert.equal(f.current().phase, "confirmed"); assert.equal(f.current().request, null);
      assert.deepEqual(f.accepted, [receipt]); assert.equal(f.calls.length, 0); assert.equal(f.storage.size, 0);
    } finally { f.dispose(); }
  });
}

for (const status of [400, 422]) {
  test(`HTTP ${status} rejection clears only the pending request and retains the error`, async () => {
    const error = new ApiRequestError(status, "MERGE_MESSAGE_LIMIT");
    const f = fixture({ submit: async () => { throw error; } });
    try {
      f.current().start(ids, "Synthetic unsaved title"); await setImmediate();
      assert.equal(f.current().phase, "idle"); assert.equal(f.current().error, error);
      assert.equal(f.current().request, null); assert.equal(f.accepted.length, 0); assert.equal(f.storage.size, 0);
    } finally { f.dispose(); }
  });
}

test("a key conflict remains checkable and never becomes a new blind submission", async () => {
  const f = fixture({ submit: async () => { throw new ApiRequestError(409, "MERGE_REQUEST_CONFLICT"); } });
  try {
    f.current().start(ids, "Synthetic conflict"); await setImmediate();
    assert.equal(f.current().phase, "unknown"); assert.ok(f.current().request);
    f.current().retry(); assert.equal(f.calls.length, 1);
  } finally { f.dispose(); }
});

test("close and reopen retains the original order/title without starting another merge", async () => {
  const f = fixture({ submit: async () => { throw new Error("Synthetic lost response"); } });
  try {
    f.current().start(ids, "Synthetic retained title"); await setImmediate();
    const original = f.current().request;
    f.props({ open: false }); f.props({ open: true });
    assert.equal(f.current().phase, "unknown"); assert.deepEqual(f.current().request, original);
    f.current().start([...ids].reverse(), "Different current title"); assert.equal(f.calls.length, 1);
  } finally { f.dispose(); }
});

test("project scope and account scope never adopt another unresolved request", () => {
  const f = fixture({ initial: saved });
  try {
    f.props({ projectId: "synthetic-other-project" }); assert.equal(f.current().phase, "idle"); assert.equal(f.current().request, null);
    f.props({ projectId: undefined }); assert.deepEqual(f.current().request, saved);
    f.owner("synthetic-other-owner"); assert.equal(f.current().phase, "idle"); assert.equal(f.current().request, null);
    assert.equal(f.calls.length + f.reads.length, 0);
  } finally { f.dispose(); }
});

test("late responses from the previous account do not acknowledge or erase its receipt", async () => {
  const held = deferred();
  const f = fixture({ submit: () => held.promise });
  try {
    f.current().start(ids, "Synthetic owner A"); f.owner("synthetic-owner-b");
    assert.equal(f.calls[0].signal.aborted, true);
    held.resolve(task); await setImmediate();
    assert.equal(f.accepted.length, 0); assert.equal(f.current().phase, "idle"); assert.equal(f.storage.size, 1);
    f.owner("synthetic-owner"); assert.equal(f.current().phase, "unknown");
  } finally { f.dispose(); }
});

test("locking the account masks the request and fences even an already captured action", async () => {
  const held = deferred();
  const f = fixture({ initial: saved, lookup: () => held.promise });
  try {
    const prior = f.current(), checking = prior.check(); f.lock(); prior.start(ids, "After lock");
    held.resolve({ found: true, task }); await checking;
    assert.equal(f.current().request, null); assert.equal(f.accepted.length, 0); assert.equal(f.calls.length, 0); assert.equal(f.storage.size, 1);
  } finally { f.dispose(); }
});

test("an old lookup cannot clear the request restored into a newly opened dialog", async () => {
  const held = deferred();
  const f = fixture({ initial: saved, lookup: () => held.promise });
  try {
    const pending = f.current().check(); f.props({ open: false }); f.props({ open: true });
    held.resolve({ found: true, task }); await pending;
    assert.equal(f.current().phase, "unknown"); assert.deepEqual(f.current().request, saved); assert.equal(f.accepted.length, 0);
  } finally { f.dispose(); }
});

for (const mode of ["held", "reject", "throw"]) {
  test(`${mode} acknowledgement callback cannot turn accepted admission into failure`, async () => {
    const held = deferred();
    const f = fixture({ onAccepted: () => {
      if (mode === "throw") throw new Error("Synthetic callback failed");
      if (mode === "reject") return Promise.reject(new Error("Synthetic callback rejected"));
      return held.promise;
    } });
    try {
      f.current().start(ids, "Synthetic accepted"); await setImmediate();
      assert.equal(f.current().phase, "confirmed"); assert.equal(f.current().error, null); assert.equal(f.storage.size, 0); assert.equal(f.accepted.length, 1);
      f.current().start(ids, "Do not repeat"); assert.equal(f.calls.length, 1);
    } finally { held.resolve(); f.dispose(); }
  });
}

test("unavailable session storage retains recovery in memory across dialog reopen", async () => {
  const f = fixture({ storageUnavailable: true, submit: async () => { throw new Error("Synthetic response lost"); } });
  try {
    f.current().start(ids, "Synthetic memory-only"); await setImmediate();
    const original = f.current().request;
    assert.equal(f.current().storageFailed, true); assert.equal(f.current().phase, "unknown");
    f.props({ open: false }); f.props({ open: true });
    assert.equal(f.current().phase, "unknown"); assert.deepEqual(f.current().request, original); assert.equal(f.calls.length, 1);
  } finally { f.dispose(); }
});

test("malformed or duplicate-ID stored requests fail closed without exposing their values", () => {
  const f = fixture({ initial: "{bad synthetic JSON" });
  try {
    assert.equal(f.current().phase, "locked"); assert.equal(f.current().request, null); f.current().start(ids, "Do not overwrite");
    assert.equal(f.calls.length, 0);
    assert.throws(() => f.decode(JSON.stringify({ ...saved, conversationIds: [ids[0], ids[0]] })));
    assert.deepEqual(f.decode(JSON.stringify(saved)), saved);
  } finally { f.dispose(); }
});

function dialogFixture({ phase = "unknown", locale = "en-US", parentBusy = false } = {}) {
  let input, order, titleChanges = 0;
  const admission = { phase, request: phase === "idle" ? null : saved, error: new Error("Synthetic raw response"), storageFailed: false,
    start: noop, check: noop, retry: noop, clearError: noop };
  const mocks = {
    react: React, "react-dom": { createPortal: element => element },
    "react/jsx-runtime": { ...jsx, jsx: (type, props, ...rest) => { if (type === "input") input = props; return jsx.jsx(type, props, ...rest); } },
    "@tanstack/react-query": { useQuery: () => ({ data: { maximum_merge_message_count: 1000 } }), useQueryClient: () => ({ invalidateQueries: async () => {} }) },
    "../../lib/api": { ApiRequestError }, "../../lib/auth-client": {},
    "../../components/support-limit-action": { SupportLimitAction: () => null },
    "../../components/use-dialog-focus": { useDialogFocus: noop },
    "../../components/preferences-provider": { usePreferences: () => ({ resolvedLocale: locale }) },
    "./merge-order-list": { MergeOrderList: props => { order = props; return null; } },
    "./use-merge-admission": { useMergeAdmission: () => admission },
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", "document", compile(source("features/conversations/merge-conversations-dialog.tsx")))(
    name => Object.hasOwn(mocks, name) ? mocks[name] : appRequire(name), module, module.exports, { body: {} });
  const markup = renderToStaticMarkup(React.createElement(module.exports.MergeConversationsDialog, { open: true, busy: parentBusy,
    conversations: [...ids].reverse().map((id, index) => ({ id, title: `Synthetic current ${index}`, display_title: `Synthetic current ${index}`, message_count: 1 })),
    title: "Synthetic current title", onTitleChange: () => { titleChanges += 1; }, onReorder: noop, onMerge: noop, onAccepted: noop, onClose: noop }));
  return { input, order, markup, titleChanges: () => titleChanges, Notice: module.exports.MergeAdmissionNotice };
}

for (const phase of ["submitting", "unknown", "checking", "retry"]) {
  test(`${phase} dialog keeps original title/order read-only and suppresses raw errors`, () => {
    const f = dialogFixture({ phase });
    assert.equal(f.input.readOnly, true); assert.equal(f.input.value, saved.title);
    f.input.onChange({ target: { value: "Ignored pending edit" } }); assert.equal(f.titleChanges(), 0);
    assert.equal(f.order.disabled, true); assert.deepEqual(f.order.conversations.map(row => row.id), ids);
    assert.doesNotMatch(f.markup, /Synthetic raw response/);
    assert.match(f.markup, /Check merge result|Checking|Submitting merge/);
    if (phase === "retry") assert.match(f.markup, /Resubmit original merge/);
    else assert.doesNotMatch(f.markup, /Resubmit original merge/);
  });
}

test("idle title remains editable, while a parent pending state still protects it", () => {
  const idle = dialogFixture({ phase: "idle" });
  assert.equal(idle.input.readOnly, false); idle.input.onChange({ target: { value: "Edit" } }); assert.equal(idle.titleChanges(), 1);
  assert.equal(dialogFixture({ phase: "idle", parentBusy: true }).input.readOnly, true);
});

test("Chinese recovery copy and completed/cancelled receipts distinguish admission from execution", () => {
  const f = dialogFixture({ phase: "unknown", locale: "zh-CN" });
  assert.match(f.markup, /检查合并结果/); assert.match(f.markup, /核对不会再次合并/);
  const cancelled = renderToStaticMarkup(React.createElement(f.Notice, { task: { ...task, status: "cancelled" }, zh: true }));
  assert.match(cancelled, /未重新开始/);
  const completed = renderToStaticMarkup(React.createElement(f.Notice, { task: { ...task, status: "committed", result: { conversation_id: ids[0] } }, zh: false }));
  assert.match(completed, new RegExp(`/conversations/${ids[0]}`)); assert.match(completed, /Open merged conversation/);
});

for (const path of ["features/conversations/conversation-list.tsx", "features/projects/project-conversation-list.tsx"]) {
  test(`${path} closes confirmed admission even with the preceding busy render captured`, () => {
    const code = source(path), ast = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const callbacks = {};
    function visit(node) {
      if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "MergeConversationsDialog") {
        for (const attribute of node.attributes.properties) {
          if (ts.isJsxAttribute(attribute) && ["onAccepted", "onClose"].includes(attribute.name.text)) {
            callbacks[attribute.name.text] = attribute.initializer.expression.getText(ast);
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(ast); assert.equal(Object.keys(callbacks).length, 2);
    const accepted = [], closed = [];
    const env = { isMerging: true, bulkBusy: "merge", setMergeOpen: value => closed.push(value), setMergeOpenScope: value => closed.push(value),
      setSelectedConversationIds: noop, setMergeOrderIds: noop, setMergeTitle: noop,
      setBatchNotice: value => accepted.push(value.props.task), MergeAdmissionNotice: () => null,
      resolvedLocale: "en-US", zh: false, project: { name: "Synthetic project" } };
    const module = { exports: {} };
    new Function("require", "exports", ...Object.keys(env), compile(`export const accepted = ${callbacks.onAccepted}; export const close = ${callbacks.onClose};`))(appRequire, module.exports, ...Object.values(env));
    // Explicitly execute the callbacks from a pending render: React timing is
    // not simulated. User dismissal must wait; confirmed admission need not.
    module.exports.close(); assert.deepEqual(closed, []);
    module.exports.accepted(task); module.exports.close();
    assert.deepEqual(accepted, [task]); assert.deepEqual(closed, [path.includes("projects/") ? null : false]);
  });

  test(`${path} forwards the original key/payload/signal and settles independently of refresh`, async () => {
    const code = source(path), ast = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let callback;
    function visit(node) {
      if (ts.isJsxAttribute(node) && node.name.text === "onMerge" && node.initializer?.expression?.getText(ast).includes("mergeConversations({")) callback = node.initializer.expression.getText(ast);
      ts.forEachChild(node, visit);
    }
    visit(ast); assert.ok(callback);
    const writes = [], held = deferred(), signal = new globalThis.AbortController().signal;
    const env = { mergeConversations: async (payload, incomingSignal) => { writes.push({ payload, signal: incomingSignal }); return task; },
      setIsMerging: noop, setBulkBusy: noop, projectId: "synthetic-project", queryClient: { invalidateQueries: () => held.promise } };
    const module = { exports: {} };
    new Function("exports", ...Object.keys(env), compile(`export const callback = ${callback};`))(module.exports, ...Object.values(env));
    const result = await module.exports.callback(saved, signal);
    assert.equal(result, task); assert.equal(writes.length, 1);
    assert.equal(writes[0].payload.idempotencyKey, key); assert.equal(writes[0].signal, signal);
    assert.deepEqual(writes[0].payload.conversationIds, ids); assert.equal(writes[0].payload.title, saved.title);
    if (path.includes("projects/")) assert.equal(writes[0].payload.projectId, "synthetic-project");
    held.resolve();
  });
}
