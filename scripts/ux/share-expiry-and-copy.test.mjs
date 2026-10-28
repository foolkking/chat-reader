import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const source = readFileSync(new URL("../../apps/web/features/sharing/share-panel.tsx", import.meta.url), "utf8");
const compile = value => ts.transpileModule(value, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const walk = node => Array.isArray(node) ? node.flatMap(walk)
  : node && typeof node === "object" && node.props ? [node, ...walk(node.props.children)] : [];
const text = node => node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(text).join("")
  : typeof node === "object" ? text(node.props?.children) : String(node);
const future = "2098-12-15T12:30";

// Actual create/edit component handlers; React/query/API adapters do not prove
// native datetime controls, focus, timezone UI or physical clipboard behavior.
function fixture(row = false) {
  const hooks = [], calls = [];
  let cursor = 0, tree;
  const hook = init => hooks[cursor++] ?? (hooks[cursor - 1] = init());
  const react = {
    useState: init => { const state = hook(() => ({ value: typeof init === "function" ? init() : init }));
      return [state.value, value => { state.value = typeof value === "function" ? value(state.value) : value; }]; },
    useRef: value => hook(() => ({ current: value })), useId: () => "synthetic-expiry-error",
  };
  const api = {};
  const stubs = {
    react, "react/jsx-runtime": require("react/jsx-runtime"),
    "@tanstack/react-query": { useQuery: () => ({ data: [], refetch: async () => ({ isError: false }) }) },
    "../../lib/api": { ApiRequestError: class extends Error {},
      createShare: async (_id, input) => { calls.push(input); return { share_url: "https://synthetic.invalid/share/example" }; },
      updateShare: async (_id, input) => { calls.push(input); }, revokeShare: async () => {} },
    "../../components/preferences-provider": {
      usePreferences: () => ({ resolvedLocale: "en-US", resolvedTheme: "light" }), useTranslations: () => key => key },
    "../../components/use-clipboard-copy": { useClipboardCopy: () => ({ state: "idle", copy: async () => {}, manualRef: { current: null } }) },
  };
  new Function("require", "exports", compile(source + "\nexports.Row = ShareManagementRow; exports.validate = validateFutureExpiry;"))(name => {
    assert.ok(Object.hasOwn(stubs, name), name); return stubs[name];
  }, api);
  const render = () => {
    cursor = 0;
    tree = row ? api.Row({ conversationId: "synthetic-a", share: {
      id: "synthetic-share", expires_at: future, theme: "light", locale: "en-US", created_at: "2026-10-28T00:00:00Z",
    }, onChanged: async () => true }) : api.SharePanel({ conversationId: "synthetic-a", selectedMessageIds: [] });
    return tree;
  };
  const button = label => {
    const node = walk(tree).find(node => node.type === "button" && text(node) === label);
    assert.ok(node, label); return node.props;
  };
  render();
  return { calls, render, button, api,
    choose(mode) { button(mode).onClick(); render(); },
    expiry(value) { walk(tree).find(node => node.props.type === "datetime-local").props.onChange({ target: { value } }); render(); },
    never(value) { walk(tree).find(node => node.type === "input" && node.props.type === "checkbox").props.onChange({ target: { checked: value } }); render(); },
    async submit() { button(row ? "Save expiry" : "createShare").onClick(); await setImmediate(); render(); },
    error() { return walk(tree).filter(node => node.props.role === "alert").map(text).join(" "); },
  };
}

test("custom blank, malformed, rollover and past expiry never send a create request", async () => {
  const f = fixture(); f.choose("custom");
  for (const value of ["", "invalid", "2098-02-30T10:00", "2020-01-01T10:00"]) {
    f.expiry(value); await f.submit();
    assert.equal(f.calls.length, 0); assert.ok(f.error());
  }
  f.expiry(future); await f.submit();
  assert.equal(f.calls[0].expires_at, new Date(future).toISOString());
  assert.equal(f.error(), "");
});

test("only explicit Never maps to permanent; presets remain finite", async () => {
  const f = fixture();
  for (const mode of ["sevenDays", "thirtyDays", "never"]) {
    f.choose(mode); await f.submit();
    const value = f.calls.at(-1).expires_at;
    if (mode === "never") assert.equal(value, null);
    else assert.ok(Date.parse(value) > Date.now());
  }
});

test("editing a finite share cannot turn a blank field into permanent without the Never checkbox", async () => {
  const f = fixture(true);
  f.expiry(""); await f.submit(); assert.equal(f.calls.length, 0);
  f.never(true); await f.submit(); assert.equal(f.calls[0].expires_at, null);
  f.never(false); f.expiry(future); await f.submit();
  assert.equal(f.calls[1].expires_at, new Date(future).toISOString());
});

test("clipboard success/failure belongs to the exact value and cannot publish after unmount", async () => {
  const hooks = [], effects = [];
  let cursor = 0, current, value = "synthetic-first", writes = 0, transport = async () => {};
  const hook = init => hooks[cursor++] ?? (hooks[cursor - 1] = init());
  const react = {
    useState: init => { const state = hook(() => ({ value: init })); return [state.value, next => { writes++; state.value = next; }]; },
    useRef: init => hook(() => ({ current: init })), useCallback: fn => fn,
    useEffect: (fn, deps) => { const state = hook(() => ({}));
      if (!state.deps || deps.some((value, index) => !Object.is(value, state.deps[index]))) {
        state.deps = deps; effects.push(() => { state.cleanup?.(); state.cleanup = fn(); });
      } },
  };
  const api = {}, clipboard = {};
  new Function("require", "exports", "navigator", compile(readFileSync(new URL("../../apps/web/components/use-clipboard-copy.ts", import.meta.url), "utf8")))(
    () => react, api, { get clipboard() { return clipboard.enabled === false ? undefined : { writeText: input => transport(input) }; } },
  );
  const render = () => { cursor = 0; current = api.useClipboardCopy(value); for (const fn of effects.splice(0)) fn(); };
  render(); await current.copy(); render(); assert.equal(current.state, "copied");
  value = "synthetic-next"; render(); assert.equal(current.state, "idle");
  clipboard.enabled = false; await current.copy(); render(); assert.equal(current.state, "failed");
  clipboard.enabled = true; transport = async () => { throw Error("synthetic denied"); };
  await current.copy(); render(); assert.equal(current.state, "failed");
  let finish; transport = () => new Promise(resolve => { finish = resolve; });
  const pending = current.copy(); const before = writes;
  for (const state of hooks) state.cleanup?.();
  finish(); await pending; assert.equal(writes, before);
});
