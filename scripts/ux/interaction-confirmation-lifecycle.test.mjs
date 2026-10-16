import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const React = require("react"), ts = require("typescript");
const source = readFileSync(new URL("../../apps/web/components/interaction-dialog-provider.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
const text = node => node == null || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node)
  : Array.isArray(node) ? node.map(text).join("") : text(node.props?.children);
function find(node, predicate) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) { const found = find(child, predicate); if (found) return found; }
    return;
  }
  return predicate(node) ? node : find(node.props?.children, predicate);
}
const unit = (name, body) => test(name, { timeout: 1000 }, body);
const cancellation = kind => kind === "confirm" ? false : null;

// Compiles the actual provider. Hook scheduling, route, authentication and
// focus-helper callbacks are controlled doubles, not React/browser execution.
// No DOM, real keyboard/focus, service, network or private data is involved.
function fixture({ locale = "en-US" } = {}) {
  const hooks = [], effects = new Map(), listeners = new Map();
  let cursor = 0, tree, focus, pathname = "/synthetic-first", epoch = 1, disposed = false, retiredWrites = 0;
  const hook = init => { const index = cursor++; return hooks[index] ??= init(); };
  const memo = (fn, deps) => {
    const state = hook(() => ({}));
    if (!same(state.deps, deps)) Object.assign(state, { value: fn(), deps });
    return state.value;
  };
  const react = { ...React, useMemo: memo, useCallback: (fn, deps) => memo(() => fn, deps),
    useRef: initial => hook(() => ({ current: initial })),
    useState: initial => {
      const state = hook(() => ({ value: typeof initial === "function" ? initial() : initial }));
      return [state.value, next => {
        if (disposed) retiredWrites++;
        state.value = typeof next === "function" ? next(state.value) : next;
      }];
    },
    useEffect: (fn, deps) => {
      const index = cursor, state = hook(() => ({}));
      if (!same(state.deps, deps)) { state.deps = deps; effects.set(index, fn); }
    },
  };
  const mocks = {
    react,
    "lucide-react": { AlertTriangle: "AlertTriangle", X: "X" },
    "next/navigation": { usePathname: () => pathname },
    "./preferences-provider": { usePreferences: () => ({ resolvedLocale: locale }) },
    "./use-dialog-focus": { useDialogFocus: options => { focus = options; } },
    "../lib/offline-access": { authenticationGeneration: () => epoch,
      AUTH_UNAUTHORIZED_EVENT: "synthetic-unauthorized", OFFLINE_ACCESS_LOCKED_EVENT: "synthetic-locked" },
  };
  const window = {
    addEventListener: (name, callback) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(callback);
    },
    removeEventListener: (name, callback) => listeners.get(name)?.delete(callback),
  };
  const module = { exports: {} };
  new Function("require", "exports", "window", compiled)(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith(".")) throw Error(`Unexpected dependency ${name}`);
    return require(name);
  }, module.exports, window);
  const render = () => {
    cursor = 0;
    return tree = module.exports.InteractionDialogProvider({ children: "Synthetic workspace" });
  };
  const flush = () => {
    for (const [index, fn] of effects) { hooks[index].cleanup?.(); hooks[index].cleanup = fn(); }
    effects.clear();
  };
  const form = () => find(tree, node => node.type === "form");
  const input = () => find(tree, node => node.type === "input");
  const closeButton = () => find(tree, node => node.type === "button" && node.props["aria-label"]);
  const submit = (target = form()) => { assert.ok(target, "Missing original form"); target.props.onSubmit({ preventDefault() {} }); };
  render(); flush();
  return {
    render, flush, form, input, submit, closeButton, focusOptions: () => focus,
    api: () => tree.props.value,
    start(kind, title = "Synthetic decision") {
      const result = tree.props.value[kind]({ title, initialValue: kind === "prompt" ? "Synthetic original draft" : undefined });
      render();
      return result;
    },
    changeValue(value) { assert.ok(input()); input().props.onChange({ target: { value } }); render(); },
    close() { const button = closeButton(); assert.ok(button); button.props.onClick(); },
    cancel() { const button = find(tree, node => node.type === "button" && text(node) === (locale === "zh-CN" ? "取消" : "Cancel")); assert.ok(button); button.props.onClick(); },
    escapeCallback() { assert.equal(focus.open, true); focus.onClose(); },
    backdrop() { const node = find(tree, node => node.props?.["data-dialog-backdrop"]); assert.ok(node); node.props.onPointerDown(); },
    route(value) { pathname = value; }, changeAccount() { epoch++; },
    event(name) { for (const callback of listeners.get(name) ?? []) callback(); },
    text: () => text(tree), listenerCount: () => [...listeners.values()].reduce((total, values) => total + values.size, 0),
    retiredWrites: () => retiredWrites,
    dispose() { disposed = true; for (const state of hooks) state.cleanup?.(); effects.clear(); },
  };
}

for (const firstKind of ["confirm", "prompt"]) for (const nextKind of ["confirm", "prompt"]) {
  unit(`${firstKind} then ${nextKind}: first decision owns the resolver and draft; later call cancels immediately`, async () => {
    const f = fixture();
    try {
      const first = f.start(firstKind, "Synthetic first owner");
      if (firstKind === "prompt") f.changeValue("Synthetic retained input");
      const second = f.api()[nextKind]({ title: "Synthetic rejected second", initialValue: "Must not replace draft" });
      assert.equal(await second, cancellation(nextKind));
      f.render();
      assert.match(f.text(), /Synthetic first owner/);
      assert.doesNotMatch(f.text(), /Synthetic rejected second/);
      if (firstKind === "prompt") assert.equal(f.input().props.value, "Synthetic retained input");
      f.submit();
      assert.equal(await first, firstKind === "confirm" ? true : "Synthetic retained input");
      f.render();
      assert.equal(f.form(), undefined, "State is read only after the next render");
    } finally { f.dispose(); }
  });
}

for (const kind of ["confirm", "prompt"]) for (const action of ["close", "cancel", "backdrop", "escapeCallback"]) {
  unit(`${kind}: ${action} completes with the existing cancellation type`, async () => {
    const f = fixture();
    try {
      const pending = f.start(kind);
      f[action]();
      assert.equal(await pending, cancellation(kind));
      f.render();
      assert.equal(f.form(), undefined);
    } finally { f.dispose(); }
  });
}

for (const kind of ["confirm", "prompt"]) {
  unit(`${kind}: unmount resolves once, removes listeners and retires held callbacks`, async () => {
    const f = fixture(), pending = f.start(kind);
    const oldForm = f.form(), oldApi = f.api(), oldInput = f.input();
    let completions = 0;
    pending.then(() => completions++);
    f.dispose();
    assert.equal(await pending, cancellation(kind));
    f.submit(oldForm);
    oldInput?.props.onChange({ target: { value: "Synthetic retired input" } });
    assert.equal(await oldApi.confirm({ title: "Must not reopen" }), false);
    assert.equal(await oldApi.prompt({ title: "Must not reopen" }), null);
    assert.equal(completions, 1);
    assert.equal(f.listenerCount(), 0);
    assert.equal(f.retiredWrites(), 0);
  });

  unit(`${kind}: route transition hides the old decision before passive cancellation`, async () => {
    const f = fixture();
    try {
      const pending = f.start(kind);
      const oldApi = f.api();
      f.route("/synthetic-next"); f.render();
      assert.equal(f.form(), undefined);
      assert.equal(await oldApi.confirm({ title: "Synthetic retired confirm" }), false);
      assert.equal(await oldApi.prompt({ title: "Synthetic retired prompt" }), null);
      f.flush();
      assert.equal(await pending, cancellation(kind));
      const next = f.start("confirm", "Synthetic next route decision");
      f.submit();
      assert.equal(await next, true);
    } finally { f.dispose(); }
  });

  unit(`${kind}: live account change rejects positive old submission before a rerender`, async () => {
    const f = fixture();
    try {
      const pending = f.start(kind), oldForm = f.form(), oldApi = f.api();
      f.changeAccount();
      f.submit(oldForm);
      assert.equal(await pending, cancellation(kind));
      assert.equal(await oldApi.confirm({ title: "Synthetic old account" }), false);
      f.render(); f.flush();
      const next = f.start("prompt"); f.changeValue("Synthetic current account");
      f.submit();
      assert.equal(await next, "Synthetic current account");
    } finally { f.dispose(); }
  });
}

for (const event of ["synthetic-unauthorized", "synthetic-locked"]) for (const kind of ["confirm", "prompt"]) {
  unit(`${kind}: ${event} cancels waiting only; a held positive callback cannot revive it`, async () => {
    const f = fixture();
    try {
      const pending = f.start(kind), oldForm = f.form();
      f.event(event);
      assert.equal(await pending, cancellation(kind));
      f.submit(oldForm); f.render();
      assert.equal(f.form(), undefined);
    } finally { f.dispose(); }
  });
}

unit("leaving and returning to the same pathname retires the original scope and functions", async () => {
  const f = fixture();
  try {
    const first = f.start("confirm"), oldForm = f.form(), oldApi = f.api();
    f.route("/synthetic-other"); f.render();
    f.route("/synthetic-first"); f.render();
    assert.equal(await oldApi.confirm({ title: "Synthetic old visit" }), false);
    const second = f.start("confirm", "Synthetic new visit");
    assert.equal(await first, false);
    f.submit(oldForm);
    assert.match(f.text(), /Synthetic new visit/);
    f.submit();
    assert.equal(await second, true);
  } finally { f.dispose(); }
});

unit("old prompt input, form, close and focus callbacks cannot affect a new prompt", async () => {
  const f = fixture();
  try {
    const first = f.start("prompt"), oldInput = f.input(), oldForm = f.form();
    const oldClose = f.closeButton().props.onClick, oldFocusClose = f.focusOptions().onClose;
    f.close();
    assert.equal(await first, null);
    const second = f.start("prompt", "Synthetic newer prompt");
    f.changeValue("Synthetic newer value");
    oldInput.props.onChange({ target: { value: "Must not overwrite" } });
    oldClose(); oldFocusClose();
    f.submit(oldForm); f.render();
    assert.equal(f.input().props.value, "Synthetic newer value");
    f.submit();
    assert.equal(await second, "Synthetic newer value");
  } finally { f.dispose(); }
});

unit("blank validation and accepted trimming remain unchanged; repeated old submit resolves once", async () => {
  const f = fixture({ locale: "zh-CN" });
  try {
    const pending = f.start("prompt");
    let completions = 0;
    pending.then(() => completions++);
    f.changeValue("   "); f.submit(); f.render();
    assert.match(f.text(), /内容不能为空/);
    assert.ok(f.form());
    f.changeValue("  Synthetic accepted text  ");
    const oldForm = f.form();
    f.submit(); f.submit(oldForm);
    assert.equal(await pending, "Synthetic accepted text");
    assert.equal(completions, 1);
  } finally { f.dispose(); }
});

unit("a caller continuation can open a follow-up after settlement without old cleanup erasing it", async () => {
  const f = fixture();
  try {
    const first = f.start("confirm");
    let next;
    first.then(() => { next = f.api().prompt({ title: "Synthetic explicit follow-up" }); });
    f.submit();
    assert.equal(await first, true);
    f.render();
    assert.match(f.text(), /Synthetic explicit follow-up/);
    f.changeValue("Synthetic follow-up value");
    f.submit();
    assert.equal(await next, "Synthetic follow-up value");
  } finally { f.dispose(); }
});
