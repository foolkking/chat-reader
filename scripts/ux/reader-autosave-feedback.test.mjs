import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

const appRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = appRequire("typescript"), React = appRequire("react"), jsx = appRequire("react/jsx-runtime");
const { renderToStaticMarkup } = appRequire("react-dom/server");
const source = readFileSync(new URL("../../apps/web/components/reading-position-sync-status.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { fileName: "reading-position-sync-status.tsx", compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const flush = async () => { await setImmediate(); await setImmediate(); };
const conversationId = "synthetic-quiet-reading";
const local = { conversation_id: conversationId, message_id: "synthetic-local-message", block_index: 3,
  scroll_offset: 12, revision: 2, anchor_data: { ordinal: 4 } };
const server = { ...local, message_id: "synthetic-server-message", block_index: 8, revision: 3 };
const view = extra => ({ local, server, conflict: false, pending: 0, failed: false, submitted: false, ...extra });

// The complete production component is compiled, including its observation and
// recovery callbacks. React static markup is real; hook state/lifecycle, Dexie,
// transport, online state and browser events are explicit doubles. No live DOM.
function fixture({ zh = false, state = view(), online = true, storageError = false, showIdle = false,
  readFailed = false, error = "", navigationTarget = null, onUseServer = true } = {}) {
  const states = [state, false, error, readFailed, 0, navigationTarget];
  const buttons = [], effects = [], events = [], reads = [], resolutions = [], positions = [], retryStorage = [];
  const listeners = new Map();
  let cursor = 0, effectCursor = 0, subscription = null, queryFn = null, openCalls = 0, unsubscribeCalls = 0;
  let dbFailure = false, actionFailure = false, rows = [], storedLocal = local, storedConflict = false;
  const navigator = { onLine: online }, document = { visibilityState: "visible" };
  const window = { addEventListener: (name, action) => listeners.set(name, action), removeEventListener: (name, action) => {
    if (listeners.get(name) === action) listeners.delete(name);
  }, dispatchEvent: event => { events.push(event.type); return true; } };
  const outbox = { where: () => ({ equals: () => ({ filter: predicate => ({
    toArray: async () => rows.filter(predicate), modify: async update => { for (const row of rows.filter(predicate)) Object.assign(row, update); },
  }) }) }) };
  const db = { open: async () => { openCalls += 1; if (dbFailure) throw new Error("Synthetic storage unavailable"); },
    readingPositions: { get: async () => storedLocal }, settings: { get: async key => key.startsWith("conflict:")
      ? storedConflict ? { value: true } : undefined : { value: { server } } }, outbox };
  const useState = initial => { const index = cursor++; if (!(index in states)) states[index] = initial;
    return [states[index], value => { states[index] = typeof value === "function" ? value(states[index]) : value; }]; };
  const useEffect = (operation, deps) => { const index = effectCursor++, previous = effects[index];
    effects[index] = { operation, deps, previousDeps: previous?.previousDeps, cleanup: previous?.cleanup }; };
  const Button = props => { buttons.push(props); return React.createElement("button", props); };
  const capture = factory => (type, props, key) => factory(type === "button" ? Button : type, props, key);
  const module = { exports: {} };
  const imports = name => {
    if (name === "react") return { ...React, useState, useEffect };
    if (name === "react/jsx-runtime") return { ...jsx, jsx: capture(jsx.jsx), jsxs: capture(jsx.jsxs) };
    if (name === "./preferences-provider") return { usePreferences: () => ({ resolvedLocale: zh ? "zh-CN" : "en-US" }) };
    if (name === "dexie") return { liveQuery: callback => { queryFn = callback; return { subscribe: observer => {
      subscription = observer; return { unsubscribe: () => { unsubscribeCalls += 1; subscription = null; } };
    } }; } };
    if (name === "../lib/offline-db") return { offlineDb: db };
    if (name === "../lib/reading-position-sync") return {
      readingConflictKey: id => "conflict:" + id, readingSyncKey: id => "state:" + id,
      readingSignature: row => JSON.stringify(row),
      readSyncedReadingPosition: async (...args) => { reads.push(args); if (actionFailure) throw new Error("Synthetic read failed"); },
      resolveReadingPosition: async (...args) => { resolutions.push(args); if (actionFailure) throw new Error("Synthetic resolve failed"); return args[1] === "server" ? server : null; },
    };
    throw new Error("Unexpected import: " + name);
  };
  new Function("require", "module", "exports", "window", "document", "navigator", compiled)(imports, module, module.exports, window, document, navigator);
  const props = { conversationId, storageError, showIdle,
    onRetryStorage: async () => { retryStorage.push(true); if (actionFailure) throw new Error("Synthetic save failed"); },
    ...(onUseServer ? { onUseServer: async position => { positions.push(position); if (actionFailure) throw new Error("Synthetic locate failed"); } } : {}) };
  const render = () => { cursor = effectCursor = 0; buttons.length = 0; return renderToStaticMarkup(React.createElement(module.exports.ReadingPositionSyncStatus, props)); };
  const runEffects = async () => {
    for (const effect of effects) {
      if (effect.previousDeps && effect.deps.every((value, index) => Object.is(value, effect.previousDeps[index]))) continue;
      effect.cleanup?.(); effect.previousDeps = effect.deps; effect.cleanup = effect.operation();
    }
    await flush();
  };
  return { render, runEffects, buttons, states, props, navigator, document, events, reads, resolutions, positions, retryStorage,
    listeners, setView: value => { states[0] = value; }, setRows: value => { rows = value; }, rows: () => rows,
    setStorageFailure: value => { dbFailure = value; }, setActionFailure: value => { actionFailure = value; },
    setStoredConflict: value => { storedConflict = value; }, setStoredLocal: value => { storedLocal = value; },
    publish: async () => { assert.ok(subscription, "silent component must keep its data subscription"); subscription.next(await queryFn()); },
    failObservation: () => subscription.error(new Error("Synthetic observation failed")),
    openCalls: () => openCalls, unsubscribeCalls: () => unsubscribeCalls,
    click: async label => { const button = buttons.find(item => renderToStaticMarkup(React.createElement(React.Fragment, null, item.children)) === label);
      assert.ok(button, "expected recovery control: " + label); assert.equal(Boolean(button.disabled), false); button.onClick(); await flush(); },
    dispose: () => { for (const effect of effects) effect.cleanup?.(); },
  };
}

for (const zh of [false, true]) {
  const locale = zh ? "zh" : "en";
  const retry = zh ? "重试进度保存与同步" : "Retry saving and syncing progress";
  const waiting = zh ? "阅读进度已保存在本机，等待同步。" : "Reading progress is saved locally and waiting to sync.";
  const saved = zh ? "阅读位置已保存" : "Reading position saved";
  for (const [name, pending, submitted, online] of [
    ["idle", 0, false, true], ["queued", 1, false, true], ["submitted", 2, true, true], ["offline queue", 1, false, false],
  ]) test(locale + ": ordinary " + name + " has no status row or announcement", () => {
    const f = fixture({ zh, state: view({ pending, submitted }), online });
    assert.equal(f.render(), ""); assert.equal(f.buttons.length, 0);
  });
  test(locale + ": repeated normal save/queue/ack cycles stay silent", () => {
    const f = fixture({ zh });
    for (const pending of [0, 1, 2, 0, 1, 0]) { f.setView(view({ pending, submitted: pending > 1 })); assert.equal(f.render(), ""); }
  });
  test(locale + ": an unread initial snapshot remains silent while observation starts", async () => {
    const f = fixture({ zh }); try {
      f.setView(undefined); assert.equal(f.render(), ""); await f.runEffects();
      await f.publish(); assert.equal(f.render(), ""); assert.equal(f.openCalls(), 1);
    } finally { f.dispose(); }
  });
  test(locale + ": explicitly opened sync details retain pending and saved feedback", () => {
    const f = fixture({ zh, showIdle: true, state: view({ pending: 1 }), onUseServer: false });
    assert.ok(f.render().includes(waiting)); f.setView(view()); assert.ok(f.render().includes(saved));
    assert.match(f.render(), /<a /);
  });
  test(locale + ": a real sync failure keeps its local-copy explanation and retry", async () => {
    const f = fixture({ zh, state: view({ pending: 1, failed: true }) });
    f.setRows([{ entity_type: "reading_position", last_error: "NETWORK", attempts: 2, retry_after: 123 }]);
    assert.ok(f.render().includes(zh ? "同步失败，本机位置已保留" : "sync failed. Your local position is saved"));
    await f.click(retry); assert.equal(f.openCalls(), 1); assert.equal(f.rows()[0].attempts, 0); assert.equal(f.rows()[0].last_error, null);
    assert.deepEqual(f.events, ["chat-reader:outbox"]);
  });
  test(locale + ": storage failure remains actionable without routine saved/pending copy", async () => {
    const f = fixture({ zh, storageError: true, state: view({ pending: 1 }) });
    const html = f.render(); assert.match(html, /role="alert"/); assert.equal(html.includes(waiting), false);
    await f.click(retry); assert.equal(f.retryStorage.length, 1);
  });
  test(locale + ": an active storage error cannot claim success in explicit sync details", () => {
    const f = fixture({ zh, showIdle: true, storageError: true }); const html = f.render();
    assert.match(html, /role="alert"/); assert.equal(html.includes(saved), false);
  });
  test(locale + ": unreadable local progress cannot claim success from an old snapshot", async () => {
    const f = fixture({ zh, showIdle: true, readFailed: true }); const html = f.render();
    assert.match(html, /role="alert"/); assert.equal(html.includes(saved), false);
    await f.click(retry); assert.deepEqual(f.reads, [[conversationId, true, true]]);
  });
  test(locale + ": failed explicit conflict action remains visible without a saved-success line", () => {
    const f = fixture({ zh, showIdle: true, error: "Synthetic operation needs review" }); const html = f.render();
    assert.ok(html.includes("Synthetic operation needs review")); assert.equal(html.includes(saved), false);
  });
  test(locale + ": conflicts still require an explicit local/server decision", async () => {
    const f = fixture({ zh, state: view({ conflict: true, pending: 1 }) });
    const html = f.render(); assert.ok(html.includes(zh ? "另一设备也更新了阅读位置" : "Another device updated your reading position"));
    assert.equal(f.resolutions.length, 0); assert.equal(html.includes(waiting), false);
    await f.click(zh ? "使用另一设备位置" : "Use other device position");
    assert.deepEqual(f.resolutions, [[conversationId, "server", 3, JSON.stringify(local)]]); assert.deepEqual(f.positions, [server]);
  });
  test(locale + ": a failed chosen-position locate keeps its exact retry", async () => {
    const f = fixture({ zh, showIdle: true, error: "Synthetic locate failed", navigationTarget: server });
    const html = f.render(); assert.equal(html.includes(saved), false);
    await f.click(zh ? "重新定位已选位置" : "Retry locating the chosen position");
    assert.deepEqual(f.positions, [server]); assert.equal(f.states[5], null);
  });
}

test("silent rendering retains observation and can surface a later failure without remount", async () => {
  const f = fixture(); try {
    f.setRows([{ entity_type: "reading_position", last_error: null, submitted: true }]);
    assert.equal(f.render(), ""); await f.runEffects(); await f.publish(); assert.equal(f.render(), "");
    assert.equal(f.openCalls(), 1); assert.equal(f.listeners.size, 2);
    f.setRows([{ entity_type: "reading_position", last_error: "NETWORK" }]); await f.publish();
    assert.match(f.render(), /Reading progress sync failed/);
    f.setRows([]); await f.publish(); assert.equal(f.render(), "");
    assert.equal(f.resolutions.length, 0); assert.equal(f.positions.length, 0); assert.equal(f.events.length, 0);
  } finally { f.dispose(); }
  assert.equal(f.unsubscribeCalls(), 1); assert.equal(f.listeners.size, 0);
});

test("initial browser-storage failure still surfaces while normal initial observation is silent", async () => {
  const f = fixture(); try {
    f.setView(undefined);
    f.setStorageFailure(true); assert.equal(f.render(), ""); await f.runEffects();
    assert.match(f.render(), /Cannot read local progress/);
  } finally { f.dispose(); }
});

test("a submitted conflict retains disabled decisions, not an automatic resolution", () => {
  const f = fixture({ state: view({ conflict: true, pending: 1, submitted: true }) });
  f.render(); assert.equal(f.buttons.length, 2); assert.ok(f.buttons.every(button => button.disabled)); assert.equal(f.resolutions.length, 0);
});
