import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const { QueryClient, QueryObserver, onlineManager } = require("@tanstack/react-query");
const source = readFileSync(new URL("../../apps/web/features/exporting/offline-continuation-panel.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const record = {
  id: "synthetic-conversation",
  continuation: { members: { current: { text: "SYNTHETIC_CURRENT_SOURCE" }, index: { text: '{"synthetic":"index"}' } } },
};
const ready = data => ({ data, error: null, isPending: false, isError: false, isFetching: false });
const failed = (error, data) => ({ data, error, isPending: false, isError: true, isFetching: false });
const walk = node => Array.isArray(node) ? node.flatMap(walk)
  : !node || typeof node !== "object" || !node.props ? [] : [node, ...walk(node.props.children)];
const textOf = node => typeof node === "string" ? node : Array.isArray(node) ? node.map(textOf).join(" ")
  : node && typeof node === "object" && node.props ? textOf(node.props.children) : "";
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

// Execute the compiled actual panel and its real query function. Hooks, locale,
// IndexedDB and access generations are adapters; renderer children are inspected
// as elements, not rendered. No mounted React/focus/browser/storage claim.
function fixture({ result, read = async () => record, locale = "en-US", viewState } = {}) {
  const slots = [], reads = [], refetches = [];
  let cursor = 0, options, tree, generation = 1;
  class AccessError extends Error {}
  const database = { name: "synthetic-local-database", conversations: { get: async id => {
    reads.push(id); return read(id);
  } } };
  const dbModule = { offlineDb: database };
  const props = { conversationId: record.id, onNavigate: async () => true,
    viewState: viewState ?? { member: "current", indexQuery: "synthetic-query" } };
  let query = { data: undefined, error: null, isPending: true, isError: false, isFetching: true,
    refetch: async options => { refetches.push(options); return {}; }, ...result };
  const stubs = {
    react: { useState: initial => {
      const index = cursor++;
      if (!Object.hasOwn(slots, index)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], next => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
    } },
    "react/jsx-runtime": require("react/jsx-runtime"),
    "@tanstack/react-query": { useQuery: next => { options = next; return query; } },
    "../../lib/offline-db": dbModule,
    "../../lib/offline-access": {
      OfflineAccessError: AccessError,
      captureOfflineAccess: () => generation,
      assertOfflineAccess: captured => { if (captured !== generation) throw new AccessError(); },
    },
    "../../components/preferences-provider": { usePreferences: () => ({ resolvedLocale: locale }) },
    "../conversations/markdown-renderer": { MarkdownRenderer: "MarkdownRenderer" },
    "./continuation-document": { IndexReading: "IndexReading" },
    "./continuation-find": { ContinuationFind: "ContinuationFind" },
  };
  const exports = {};
  new Function("require", "exports", compiled)(name => {
    assert.ok(Object.hasOwn(stubs, name), `Unexpected import: ${name}`);
    return stubs[name];
  }, exports);
  const render = () => { cursor = 0; tree = exports.OfflineContinuationPanel(props); };
  render();
  return {
    reads, refetches, props, database, AccessError,
    get options() { return options; }, get tree() { return tree; }, get text() { return textOf(tree); },
    elements: type => walk(tree).filter(node => node.type === type),
    button: label => {
      const button = walk(tree).find(node => node.type === "button" && textOf(node) === label);
      assert.ok(button, `Missing button: ${label}`); return button;
    },
    click(label) { this.button(label).props.onClick(); render(); },
    setQuery: patch => { query = { ...query, ...patch }; render(); },
    retireAccess: () => { generation++; },
    replaceDatabase: next => { dbModule.offlineDb = next; },
    render,
  };
}

async function disconnected(run) {
  const previous = onlineManager.isOnline();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  client.mount();
  try { onlineManager.setOnline(false); await run(client); }
  finally { client.clear(); client.unmount(); onlineManager.setOnline(previous); }
}
const assertNoBody = f => {
  assert.equal(f.elements("MarkdownRenderer").length, 0);
  assert.equal(f.elements("IndexReading").length, 0);
  assert.equal(f.elements("pre").length, 0);
};

test("initial pending is loading, never a missing member or read error", () => {
  const f = fixture();
  assert.match(f.text, /Loading continuation files/);
  assert.doesNotMatch(f.text, /does not contain|copy is unavailable|Could not read/);
  assertNoBody(f);
  assert.ok(walk(f.tree).some(node => node.props.role === "status" && node.props["aria-busy"] === "true"));
});

test("failed first read has stable localized guidance and one read-only Retry, not raw errors or missing-file copy", () => {
  for (const locale of ["en-US", "zh-CN"]) {
    const f = fixture({ locale, result: failed(Error("SYNTHETIC_INTERNAL_DETAIL"), undefined) });
    assert.match(f.text, locale === "en-US" ? /Could not read continuation files/ : /无法读取本机接续文件/);
    assert.doesNotMatch(f.text, /SYNTHETIC_INTERNAL_DETAIL|does not contain|没有这个接续文件/);
    assertNoBody(f);
    f.click(locale === "en-US" ? "Retry" : "重试");
    assert.deepEqual(f.refetches, [{ cancelRefetch: false }]);
  }
});

test("pending retries are disabled and the handler cannot request another refetch", () => {
  const f = fixture({ result: { ...failed(Error("synthetic"), record), isFetching: true } });
  const button = f.button("Retrying…");
  assert.equal(button.props.disabled, true);
  button.props.onClick();
  assert.deepEqual(f.refetches, []);
  assert.equal(f.elements("MarkdownRenderer")[0].props.text, record.continuation.members.current.text);
});

test("confirmed missing conversation differs from a missing optional member", () => {
  const missingCopy = fixture({ result: ready(null) });
  assert.match(missingCopy.text, /offline conversation copy is unavailable/);
  assert.doesNotMatch(missingCopy.text, /does not contain this continuation file/);
  assertNoBody(missingCopy);
  missingCopy.click("Retry");
  assert.deepEqual(missingCopy.refetches, [{ cancelRefetch: false }]);
  const legacy = fixture({ result: ready({ id: record.id }) });
  assert.match(legacy.text, /does not contain this continuation file/);
  assert.doesNotMatch(legacy.text, /Loading continuation|Could not read/);
  assertNoBody(legacy);
});

test("matching cached content remains through a transient refresh failure with an explicit stale-copy notice", () => {
  const f = fixture({ result: failed(Error("SYNTHETIC_INTERNAL_DETAIL"), record) });
  assert.match(f.text, /Showing the previously read offline copy/);
  assert.doesNotMatch(f.text, /SYNTHETIC_INTERNAL_DETAIL|does not contain/);
  assert.equal(f.elements("MarkdownRenderer")[0].props.text, record.continuation.members.current.text);
  assert.equal(walk(f.tree).filter(node => node.props.role === "alert").length, 1);
});

test("locked access and a mismatched cached conversation never expose cached file bodies", () => {
  const locked = fixture({ result: ready(record) });
  locked.setQuery(failed(new locked.AccessError(), record));
  assert.match(locked.text, /Local access is locked/);
  assertNoBody(locked);
  const wrong = fixture({ result: ready({ ...record, id: "synthetic-other-conversation" }) });
  assertNoBody(wrong);
  assert.match(wrong.text, /copy is unavailable/);
});

test("Current/Index, source mode, navigation callback and shared view selection survive a read failure and recovery", () => {
  const f = fixture({ result: ready(record) });
  f.click("Index");
  const index = f.elements("IndexReading")[0];
  assert.equal(index.props.onNavigate, f.props.onNavigate);
  assert.equal(index.props.viewState, f.props.viewState);
  assert.equal(f.props.viewState.member, "index");
  assert.equal(f.props.viewState.indexQuery, "synthetic-query");
  f.click("Source");
  assert.equal(textOf(f.elements("pre")[0]), record.continuation.members.index.text);
  f.setQuery(failed(Error("synthetic"), record));
  assert.equal(textOf(f.elements("pre")[0]), record.continuation.members.index.text);
  f.setQuery(ready(record));
  assert.equal(textOf(f.elements("pre")[0]), record.continuation.members.index.text);
  assert.equal(f.button("Index").props["aria-pressed"], true);
  f.click("Read");
  assert.equal(f.elements("IndexReading")[0].props.text, record.continuation.members.index.text);
});

test("a confirmed absent selected member remains informational and does not hide the other member", () => {
  const f = fixture({ result: ready({ ...record, continuation: { members: { current: record.continuation.members.current } } }) });
  f.click("Index");
  assert.match(f.text, /does not contain this continuation file/);
  assertNoBody(f);
  f.click("Current");
  assert.equal(f.elements("MarkdownRenderer")[0].props.text, record.continuation.members.current.text);
});

test("real query options retain account/conversation identity and local scheduling", { timeout: 5_000 }, async () => {
  const f = fixture();
  assert.deepEqual(f.options.queryKey, ["offline-continuation", f.database.name, record.id]);
  assert.equal(f.options.networkMode, "always");
  assert.equal(Object.hasOwn(f.options, "retry"), false);
  await disconnected(async client => {
    assert.equal(await client.fetchQuery(f.options), record);
    assert.deepEqual(f.reads, [record.id]);
  });
});

test("missing records resolve to null successfully under installed Query rather than undefined-data errors", { timeout: 5_000 }, async () => {
  const f = fixture({ read: async () => undefined });
  await disconnected(async client => {
    assert.equal(await client.fetchQuery(f.options), null);
    assert.equal(client.getQueryState(f.options.queryKey).status, "success");
  });
});

test("retired access after a held read and replaced databases reject through the real compiled query function", { timeout: 5_000 }, async () => {
  const hold = deferred(), f = fixture({ read: () => hold.promise });
  const pending = f.options.queryFn();
  f.retireAccess(); hold.resolve(record);
  await assert.rejects(pending, f.AccessError);
  const other = fixture(), prior = other.options;
  other.replaceDatabase({ name: "synthetic-other-database", conversations: { get: async () => {
    throw Error("New account must not be read by the old query");
  } } });
  await assert.rejects(prior.queryFn(), other.AccessError);
  assert.deepEqual(other.reads, []);
});

test("actual QueryObserver failure feeds the panel error; its actual Retry recovers while disconnected", { timeout: 5_000 }, async () => {
  let broken = true;
  const f = fixture({ read: async () => {
    if (broken) throw Error("SYNTHETIC_INTERNAL_DETAIL");
    return record;
  } });
  await disconnected(async client => {
    const observer = new QueryObserver(client, f.options);
    const firstError = deferred(), recovered = deferred();
    const unsubscribe = observer.subscribe(result => {
      f.setQuery(result);
      if (result.isError) firstError.resolve();
      if (result.isSuccess) recovered.resolve();
    });
    try {
      await firstError.promise;
      assert.match(f.text, /Could not read continuation files/);
      assert.doesNotMatch(f.text, /does not contain|SYNTHETIC_INTERNAL_DETAIL/);
      broken = false;
      f.click("Retry");
      await recovered.promise;
      assert.equal(f.elements("MarkdownRenderer")[0].props.text, record.continuation.members.current.text);
      assert.equal(f.reads.length, 2);
      assert.equal(onlineManager.isOnline(), false);
    } finally { unsubscribe(); observer.destroy(); }
  });
});

test("installed Query coalesces duplicate non-cancelling refetches instead of restarting a cached read", { timeout: 5_000 }, async () => {
  const hold = deferred(), f = fixture({ read: () => hold.promise });
  await disconnected(async client => {
    client.setQueryData(f.options.queryKey, record);
    const first = client.fetchQuery({ ...f.options, staleTime: 0 });
    const second = client.refetchQueries({ queryKey: f.options.queryKey, exact: true }, { cancelRefetch: false, throwOnError: true });
    assert.equal(f.reads.length, 1);
    hold.resolve(record);
    await Promise.all([first, second]);
    assert.equal(f.reads.length, 1);
  });
});
