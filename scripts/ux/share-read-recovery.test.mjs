import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const React = require("react"), ts = require("typescript");
const { QueryClient, QueryObserver } = require("@tanstack/react-query");
const noop = () => {};
const compile = source => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const source = readFileSync(new URL("../../apps/web/components/my-shares-panel.tsx", import.meta.url), "utf8");
const apiSource = readFileSync(new URL("../../apps/web/lib/api.ts", import.meta.url), "utf8");
const apiAst = ts.createSourceFile("api.ts", apiSource, ts.ScriptTarget.Latest, true);
const apiModule = { exports: {} };
new Function("exports", compile(apiAst.statements.find(n => ts.isClassDeclaration(n) && n.name.text === "ApiRequestError").getText(apiAst)))(apiModule.exports);
const { ApiRequestError } = apiModule.exports;
const failure = status => new ApiRequestError("Synthetic transport detail", status, "/api/shares");
const page = { items: [{ id: "synthetic-share", title: "Synthetic share", conversation_title: "Synthetic conversation", status: "active" }], total: 1, has_more: false };
const textOf = node => node == null || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node)
  : Array.isArray(node) ? node.map(textOf).join("") : textOf(node.props?.children);
function find(node, predicate) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const child of node) { const found = find(child, predicate); if (found) return found; } return; }
  return predicate(node) ? node : find(node.props?.children, predicate);
}

// Actual component/query options and installed QueryObserver retry lifecycle.
// React hooks, transport and unrelated children are doubles; retry timers are
// accelerated after recording the actual configured delays. No browser claim.
function fixture({ cached = false, locale = "en-US" } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const hooks = [], calls = [], delays = [], writes = [];
  let cursor = 0, observer, options, tree, read = async () => page, stop;
  const hook = init => { const i = cursor++; return hooks[i] ??= init(); };
  const mocks = {
    react: { ...React, useEffect: noop, useLayoutEffect: noop,
      useState: init => { const h = hook(() => ({ value: typeof init === "function" ? init() : init }));
        return [h.value, next => { h.value = typeof next === "function" ? next(h.value) : next; }]; },
      useRef: init => hook(() => ({ current: init })),
    },
    "@tanstack/react-query": { useQueryClient: () => client, useQuery: value => {
      options = value;
      if (!observer) {
        if (cached) client.setQueryData(value.queryKey, page);
        observer = new QueryObserver(client, { ...value, enabled: false, retryDelay: (...args) => { delays.push(value.retryDelay(...args)); return 0; } });
        stop = observer.subscribe(noop);
      }
      return observer.getCurrentResult();
    } },
    "../lib/api": { ApiRequestError, getMyShares: input => { calls.push(input); return read(); }, revokeShares: input => { writes.push(input); throw new Error("Unexpected write"); } },
    "./preferences-provider": { usePreferences: () => ({ resolvedLocale: locale }) },
    "./interaction-dialog-provider": { useInteractionDialog: () => ({ confirm: async () => true }) },
    "../features/sharing/share-status-details": { ShareStatusDetails: "ShareStatusDetails" },
    "../features/sharing/share-editor": { ShareEditor: "ShareEditor" },
    "../features/sharing/share-actions-menu": { ShareActionsMenu: "ShareActionsMenu" },
  };
  const module = { exports: {} };
  new Function("require", "exports", compile(source))(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith(".")) throw new Error(`Unexpected dependency ${name}`);
    return require(name);
  }, module.exports);
  const render = () => { cursor = 0; return tree = module.exports.MySharesPanel({ onDirtyChange: noop, onOpenConversation: noop }); };
  const button = label => { const result = find(tree, n => n.type === "button" && (n.props["aria-label"] ?? textOf(n)) === label); assert.ok(result, label); return result.props; };
  render();
  return { calls, writes, delays, observer, render, button, setRead: fn => { read = fn; }, get options() { return options; },
    dispose: () => { stop(); observer.destroy(); client.clear(); } };
}

test("a connection failure retries the same read and recovers without writes or polling", async () => {
  const f = fixture();
  try {
    f.setRead(async () => { if (f.calls.length === 1) throw new Error("CONNECTION_FAILED"); return page; });
    await f.observer.refetch();
    assert.equal(f.calls.length, 2); assert.deepEqual(f.calls[0], f.calls[1]); assert.deepEqual(f.delays, [750]);
    assert.match(textOf(f.render()), /Synthetic share/); assert.doesNotMatch(textOf(f.render()), /Unable to load/);
    assert.equal(f.options.refetchInterval, undefined); assert.deepEqual(f.writes, []);
  } finally { f.dispose(); }
});

test("exhausted initial read has an explicit error and manual Refresh recovers", async () => {
  const f = fixture();
  try {
    f.setRead(async () => { throw failure(502); }); await f.observer.refetch();
    assert.equal(f.calls.length, 3); assert.deepEqual(f.delays.slice(0, 2), [750, 1500]);
    assert.match(textOf(f.render()), /Unable to load shares. Refresh to retry./);
    assert.doesNotMatch(textOf(f.render()), /No share links yet|Retrying automatically|Synthetic transport detail/);
    f.setRead(async () => page); f.button("Refresh").onClick(); await f.observer.getCurrentQuery().promise;
    assert.equal(f.calls.length, 4); assert.match(textOf(f.render()), /Synthetic share/); assert.deepEqual(f.writes, []);
  } finally { f.dispose(); }
});

for (const locale of ["en-US", "zh-CN"]) test(`${locale}: cached rows and selection survive retry exhaustion`, async () => {
  const f = fixture({ cached: true, locale });
  try {
    f.button(locale === "en-US" ? "Manage multiple" : "批量管理").onClick(); f.render();
    f.button(locale === "en-US" ? "Select revocable on this page" : "选择本页可撤销项").onClick(); f.render();
    let release;
    f.setRead(() => new Promise((_, reject) => { release = () => reject(failure(503)); }));
    const pending = f.observer.refetch();
    f.render(); assert.equal(f.button(locale === "en-US" ? "Refresh" : "刷新").disabled, true);
    assert.match(textOf(f.render()), /Synthetic share/);
    f.setRead(async () => { throw failure(503); }); release(); await pending;
    const tree = f.render();
    assert.equal(f.calls.length, 3); assert.equal(find(tree, n => n.type === "input" && n.props.type === "checkbox").props.checked, true);
    assert.match(textOf(tree), locale === "en-US" ? /Previously loaded shares are shown. Use Refresh/ : /当前显示上次结果。请点击刷新重试/);
    assert.doesNotMatch(textOf(tree), /Retrying automatically|正在自动重试/);
    assert.deepEqual(f.writes, []);
  } finally { f.dispose(); }
});

for (const status of [401, 403, 404, 422, 429]) test(`HTTP ${status} is not automatically retried`, async () => {
  const f = fixture();
  try { f.setRead(async () => { throw failure(status); }); await f.observer.refetch(); assert.equal(f.calls.length, 1); }
  finally { f.dispose(); }
});
test("an unrecognized failure is not automatically retried", async () => {
  const f = fixture();
  try { f.setRead(async () => { throw new Error("Synthetic unexpected failure"); }); await f.observer.refetch(); assert.equal(f.calls.length, 1); }
  finally { f.dispose(); }
});
