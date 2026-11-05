import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const { QueryClient } = require("@tanstack/react-query");

function compile(file, modules) {
  const source = readFileSync(new URL(`../../apps/web/${file}`, import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const exports = {};
  new Function("exports", "require", js)(exports, name => {
    assert.ok(Object.hasOwn(modules, name), `Unexpected dependency: ${name}`);
    return modules[name];
  });
  return exports;
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture() {
  let epoch = 1, options, read;
  const disk = new Map(), transactionStarted = deferred(), commit = deferred();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const db = {
    name: "synthetic-account-database",
    settings: {
      async get(key) { return read ? read.promise : disk.get(key); },
      async put(row) { db.pending = structuredClone(row); },
    },
    async transaction(_mode, _table, operation) {
      await operation();
      transactionStarted.resolve();
      // A successful put is not yet a committed transaction. Model that gap.
      await commit.promise;
      if (epoch !== 1) throw Error("account changed");
      disk.set(db.pending.key, structuredClone(db.pending));
    },
  };
  const { useGuidanceSetting } = compile("components/use-guidance-setting.ts", {
    "@tanstack/react-query": {
      useQueryClient: () => client,
      useQuery(value) {
        options = value;
        return { data: client.getQueryData(value.queryKey), isSuccess: true };
      },
    },
    "../lib/offline-db": { offlineDb: db },
    "../lib/offline-access": {
      captureOfflineAccess: () => epoch,
      assertOfflineAccess(captured) { if (captured !== epoch) throw Error("account changed"); },
    },
  });
  const setting = useGuidanceSetting("maintenance:synthetic-conversation");
  return {
    setting, disk, client, transactionStarted, commit,
    cached: () => client.getQueryData(options.queryKey),
    switchAccount() { epoch++; },
    pendingRead() {
      read = deferred();
      const result = client.fetchQuery(options);
      // Cancellation is expected; attach a handler before the save cancels it.
      const outcome = result.then(value => ({ value }), error => ({ error }));
      return { ...read, outcome };
    },
  };
}

test("guidance publishes completion only after the IndexedDB transaction commits", async () => {
  const f = fixture(), value = { muted: true };
  try {
    const saving = f.setting.save(value);
    await f.transactionStarted.promise;
    assert.equal(f.cached(), undefined);
    assert.equal(f.disk.size, 0);
    f.commit.resolve();
    assert.deepEqual(await saving, { persisted: true });
    assert.deepEqual(f.cached(), value);
    assert.deepEqual(f.disk.get("guidance:maintenance:synthetic-conversation").value, value);
  } finally { f.client.clear(); }
});

test("an older read cannot overwrite a committed guidance choice", async () => {
  const f = fixture(), value = { muted: true };
  try {
    const oldRead = f.pendingRead();
    const saving = f.setting.save(value);
    await f.transactionStarted.promise;
    f.commit.resolve();
    await saving;
    oldRead.resolve(undefined);
    assert.ok((await oldRead.outcome).error, "The real QueryClient must cancel the older read");
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.cached(), value);
  } finally { f.client.clear(); }
});

test("unavailable device storage permits only a session dismissal, not a persistent receipt", async () => {
  const f = fixture(), value = { muted: true };
  try {
    const saving = f.setting.save(value);
    await f.transactionStarted.promise;
    f.commit.reject(Error("synthetic quota exceeded"));
    assert.deepEqual(await saving, { persisted: false });
    assert.deepEqual(f.cached(), value);
    assert.equal(f.disk.size, 0);
  } finally { f.client.clear(); }
});

test("an account switch cannot publish a late guidance dismissal into the query cache", async () => {
  const f = fixture();
  try {
    const saving = f.setting.save({ muted: true });
    await f.transactionStarted.promise;
    f.switchAccount();
    f.commit.resolve();
    await assert.rejects(saving, /account changed/);
    assert.equal(f.cached(), undefined);
    assert.equal(f.disk.size, 0);
  } finally { f.client.clear(); }
});

test("account ownership is rechecked after cancelling an older read", async () => {
  const f = fixture();
  try {
    const cancel = f.client.cancelQueries.bind(f.client);
    f.client.cancelQueries = async filters => { await cancel(filters); f.switchAccount(); };
    const saving = f.setting.save({ muted: true });
    await f.transactionStarted.promise;
    f.commit.resolve();
    await assert.rejects(saving, /account changed/);
    assert.equal(f.cached(), undefined);
    assert.equal(f.disk.size, 1, "The old account committed before it changed; no cache is repopulated");
  } finally { f.client.clear(); }
});

function hintFixture() {
  const pending = deferred(), states = [];
  let opened = 0, written;
  const react = { useState: () => [false, value => states.push(value)] };
  const { MaintenanceHint } = compile("features/exporting/maintenance-hint.tsx", {
    react,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "@tanstack/react-query": { useQuery: () => ({ data: {
      suggest_maintenance: true, index_digest: null, unindexed_messages: 105,
      unindexed_characters: 2000, message_threshold: 100, character_threshold: 10000,
    } }) },
    "lucide-react": { ArrowRight: "ArrowRight", X: "X" },
    "../../lib/api": { continuationApi: {} },
    "../../components/preferences-provider": { usePreferences: () => ({ resolvedLocale: "en-US" }) },
    "../../components/use-guidance-setting": { useGuidanceSetting: () => ({
      ready: true, value: null, save(value) { written = value; return pending.promise; },
    }) },
  });
  const tree = MaintenanceHint({ conversationId: "synthetic-conversation", onOpen() { opened++; } });
  const buttons = [];
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (node.type === "button") buttons.push(node);
    visit(node.props?.children);
  }
  visit(tree);
  return { pending, states, buttons, written: () => written, opened: () => opened };
}

for (const persisted of [true, false]) test(`maintenance mute waits for save settlement (persisted=${persisted})`, async () => {
  const f = hintFixture();
  const mute = f.buttons.find(button => button.props.children === "Don't remind for this conversation");
  assert.ok(mute);
  mute.props.onClick();
  assert.equal(f.written().muted, true);
  assert.deepEqual(f.states, []);
  f.pending.resolve({ persisted });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.states, [true]);
});

test("opening Current remains immediate while its hint dismissal is saving", async () => {
  const f = hintFixture();
  f.buttons[0].props.onClick();
  assert.equal(f.opened(), 1);
  assert.deepEqual(f.states, []);
  f.pending.resolve({ persisted: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.states, [true]);
});

test("a rejected old-account save does not hide a hint", async () => {
  const f = hintFixture();
  f.buttons.at(-1).props.onClick();
  f.pending.reject(Error("account changed"));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.states, []);
});
