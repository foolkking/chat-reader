import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const { QueryClient, QueryObserver, onlineManager } = require("@tanstack/react-query");
const read = path => readFileSync(new URL("../../apps/web/" + path, import.meta.url), "utf8");
const readerPath = "features/conversations/conversation-reader.tsx";
const parse = path => ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const reader = parse(readerPath);
const matches = (ast, predicate) => {
  const found = [];
  const visit = node => { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); };
  visit(ast); return found;
};
const initializer = (ast, name) => {
  const found = matches(ast, node => ts.isVariableDeclaration(node) && node.name.getText(ast) === name);
  assert.equal(found.length, 1, `Expected one declaration: ${name}`);
  assert.ok(found[0].initializer);
  return found[0].initializer;
};
const compilerOptions = {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
};
const evaluate = (expression, bindings) => {
  const code = ts.transpileModule(`exports.value = (${expression.getText()});`, { compilerOptions }).outputText;
  const exports = {};
  new Function(...Object.keys(bindings), "exports", code)(...Object.values(bindings), exports);
  return exports.value;
};

// Execute actual query option expressions, not a rewritten policy. Reader state,
// data-source methods and the complete-turn loader are controlled adapters.
// This does not mount React, read IndexedDB, or verify real DOM restoration.
function readerFixture(mode = "offline", patch = {}) {
  const calls = [];
  const record = (method, value) => async (...args) => { calls.push([method, ...args]); return value; };
  const dataSource = {
    mode,
    getConversation: record("metadata", { id: "synthetic-conversation" }),
    getReadingPosition: record("position", { position: { message_id: "synthetic-saved" } }),
    getDialogueIndex: record("index", { items: [] }),
    getToc: record("toc", { items: [] }),
  };
  const bindings = {
    dataSource, conversationId: "synthetic-conversation", readerSourceKey: `${mode}:7:synthetic`,
    initialAnchorMessageId: "synthetic-saved", anchorMessageId: "synthetic-saved",
    canLoadInitialWindow: true, conversationQuery: { isSuccess: true },
    INITIAL_WINDOW_TURNS: evaluate(initializer(parse("features/conversations/reader-window.ts"), "INITIAL_WINDOW_TURNS"), {}),
    loadCompleteTurnWindowWithAnchorFallback: record("turn-window", { items: [], turns: [] }),
    ...patch,
  };
  bindings.readerQueryNetworkMode = evaluate(initializer(reader, "readerQueryNetworkMode"), bindings);
  const options = ["conversationQuery", "positionQuery", "windowQuery"].map(name => {
    const call = initializer(reader, name);
    assert.equal(call.expression.getText(reader), "useQuery");
    return evaluate(call.arguments[0], bindings);
  });
  const prefetches = matches(reader, node => ts.isCallExpression(node)
    && ["queryClient.prefetchQuery", "queryClient.prefetchInfiniteQuery"].includes(node.expression.getText(reader)));
  assert.equal(prefetches.length, 2);
  options.push(...prefetches.map(call => evaluate(call.arguments[0], bindings)));
  const prefetchKinds = prefetches.map(call => call.expression.getText(reader).endsWith("InfiniteQuery") ? "infinite" : "query");
  const runQueryFn = (index) => options[index].queryFn(prefetchKinds[index - 3] === "infinite"
    ? { pageParam: options[index].initialPageParam } : undefined);
  return { calls, options, bindings, prefetchKinds, runQueryFn };
}

// Compile each actual shared component, capturing its query before rendering.
// Hooks, preferences and API functions are adapters; real QueryClient scheduling
// is exercised separately below. No simulated output is browser evidence.
function navigationFixture(name, props = {}, auxiliary = { visible: true, overlay: false }) {
  const filename = name === "ConversationIndex" ? "conversation-index" : "conversation-toc";
  const code = ts.transpileModule(read(`features/toc/${filename}.tsx`), { compilerOptions }).outputText;
  const calls = [], stop = {}, exports = {};
  let options;
  const api = method => async (...args) => { calls.push([method, ...args]); return { items: [] }; };
  const stubs = {
    react: {
      useState: initial => [typeof initial === "function" ? initial() : initial, () => {}],
      useRef: initial => ({ current: initial }), useEffect: () => {},
      useMemo: create => create(), useCallback: callback => callback, memo: component => component,
    },
    "react/jsx-runtime": require("react/jsx-runtime"),
    "@tanstack/react-query": { useQuery: value => { options = value; throw stop; },
      useInfiniteQuery: value => { options = value; throw stop; } },
    "lucide-react": {},
    "../../components/preferences-provider": {
      useTranslations: () => key => key,
      usePreferences: () => ({ resolvedLocale: "en-US", sectionTocMode: "visible", setSectionTocMode: () => {} }),
    },
    "../../components/reader-auxiliary-visibility": { useReaderAuxiliaryVisibility: () => auxiliary },
    "../../lib/api": { getConversationDialogueIndex: api("remote-index"), getConversationToc: api("remote-toc") },
    "../conversations/markdown-renderer": { markdownHeadingLabel: value => value },
  };
  new Function("require", "exports", code)(module => {
    assert.ok(Object.hasOwn(stubs, module), `Unexpected import ${module}`);
    return stubs[module];
  }, exports);
  assert.throws(() => exports[name]({ conversationId: "synthetic-conversation", ...props }), error => error === stop);
  assert.ok(options);
  return { options, calls };
}

async function disconnected(run, defaults = {}) {
  const previous = onlineManager.isOnline();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, ...defaults } } });
  client.mount();
  try { onlineManager.setOnline(false); await run(client); }
  finally { client.clear(); client.unmount(); onlineManager.setOnline(previous); }
}

test("all three Reader reads and both sheet prefetch options execute while marked offline", async () => {
  const f = readerFixture();
  assert.deepEqual(f.options.map(options => options.networkMode), Array(5).fill("always"));
  await disconnected(async client => {
    for (const options of f.options.slice(0, 3)) await client.fetchQuery(options);
    for (const [index, options] of f.options.slice(3).entries()) {
      if (f.prefetchKinds[index] === "infinite") await client.prefetchInfiniteQuery(options);
      else await client.prefetchQuery(options);
    }
    assert.deepEqual(f.calls.map(call => call[0]), ["metadata", "position", "turn-window", "index", "toc"]);
    assert.ok(f.options.every(options => client.getQueryState(options.queryKey).status === "success"));
  });
});

test("saved anchor, complete-turn budget, query identities and navigation ranges are retained", async () => {
  const f = readerFixture();
  assert.deepEqual(f.options.map(options => options.queryKey), [
    ["conversation", "offline", "synthetic-conversation"],
    ["reading-position", "offline", "synthetic-conversation"],
    ["reader-turn-window", "offline", "synthetic-conversation", "synthetic-saved"],
    ["conversation-index", "offline:7:synthetic", "synthetic-conversation", "synthetic-saved"],
    ["toc", "offline:7:synthetic", "synthetic-conversation", "synthetic-saved", "pages"],
  ]);
  for (const [index] of f.options.entries()) await f.runQueryFn(index);
  assert.deepEqual(f.calls[2], ["turn-window", f.bindings.dataSource, "synthetic-conversation", "synthetic-saved", 5]);
  assert.deepEqual(f.calls[3], ["index", "synthetic-conversation", { anchorMessageId: "synthetic-saved", limit: 80 }]);
  assert.deepEqual(f.calls[4], ["toc", "synthetic-conversation", { messageId: "synthetic-saved", offset: 0, limit: 200 }]);
  assert.equal(f.options[3].staleTime, 60_000);
  assert.equal(f.options[4].staleTime, 30_000);
  assert.ok(f.options.every(options => !Object.hasOwn(options, "retry")));
  const start = readerFixture("offline", { initialAnchorMessageId: null, anchorMessageId: undefined });
  await start.runQueryFn(2);
  assert.equal(start.calls[0][3], undefined);
  assert.equal(start.options[3].queryKey[3], "start");
});

test("offline policy does not bypass initial-window enablement", async () => {
  for (const [positionReady, metadataReady] of [[false, false], [false, true], [true, false]]) {
    const f = readerFixture("offline", { canLoadInitialWindow: positionReady, conversationQuery: { isSuccess: metadataReady } });
    const options = f.options[2];
    assert.equal(options.enabled, false);
    await disconnected(async client => {
      const observer = new QueryObserver(client, options);
      const unsubscribe = observer.subscribe(() => {});
      try {
        assert.equal(observer.getCurrentResult().fetchStatus, "idle");
        assert.deepEqual(f.calls, []);
      } finally { unsubscribe(); observer.destroy(); }
    });
  }
});

test("remote options omit the override, pause under the normal default and resume on reconnect", async () => {
  const f = readerFixture("remote");
  assert.ok(f.options.every(options => !Object.hasOwn(options, "networkMode")));
  await disconnected(async client => {
    const pending = client.fetchQuery(f.options[0]);
    pending.catch(() => {});
    assert.equal(client.getQueryState(f.options[0].queryKey).fetchStatus, "paused");
    assert.deepEqual(f.calls, []);
    onlineManager.setOnline(true);
    await pending;
    assert.deepEqual(f.calls.map(call => call[0]), ["metadata"]);
  });
});

test("omitted remote policy preserves caller-level defaults instead of overwriting with undefined", async () => {
  const f = readerFixture("remote");
  await disconnected(async client => {
    assert.ok(f.options.every(options => client.defaultQueryOptions(options).networkMode === "offlineFirst"));
    client.setQueryDefaults(["conversation-index"], { networkMode: "always" });
    assert.equal(client.defaultQueryOptions(f.options[3]).networkMode, "always");
    await client.fetchQuery(f.options[0]);
    assert.equal(f.calls.length, 1);
  }, { networkMode: "offlineFirst" });
});

test("a local read retry can continue without waiting for reconnect", async () => {
  const f = readerFixture();
  let attempts = 0;
  f.bindings.dataSource.getConversation = async () => {
    attempts++;
    if (attempts === 1) throw Error("Synthetic transient local read");
    return { id: "synthetic-conversation" };
  };
  await disconnected(async client => {
    await client.fetchQuery({ ...f.options[0], retry: 1, retryDelay: 0 });
    assert.equal(attempts, 2);
    assert.equal(onlineManager.isOnline(), false);
  });
});

test("shared navigation executes offline: index retains its placeholder, paginated TOC does not reuse a stale anchor", async () => {
  const calls = [];
  const loadPage = async options => { calls.push(options); return { items: [] }; };
  const index = navigationFixture("ConversationIndex", { networkMode: "always", sourceKey: "synthetic-local",
    activeMessageId: "synthetic-saved", mode: "sheet", loadPage });
  const toc = navigationFixture("ConversationToc", { networkMode: "always", sourceKey: "synthetic-local",
    activeMessageId: "synthetic-saved", mode: "sheet", loadPage });
  await disconnected(async client => {
    for (const { options } of [index, toc]) {
      assert.equal(options.enabled, true);
      assert.equal(options.networkMode, "always");
    }
    const previous = { items: [] };
    assert.equal(index.options.placeholderData(previous), previous);
    assert.equal(Object.hasOwn(toc.options, "placeholderData"), false);
    assert.equal(toc.options.initialPageParam, 0);
    await client.fetchQuery(index.options);
    await client.fetchInfiniteQuery(toc.options);
  });
  assert.deepEqual(calls, [
    { anchorMessageId: "synthetic-saved", offset: undefined, limit: 80 },
    { messageId: "synthetic-saved", offset: 0, limit: 200 },
  ]);
  assert.deepEqual(index.calls, []);
  assert.deepEqual(toc.calls, []);
});

test("default shared/Share navigation retains remote loaders and inherited policy", async () => {
  const index = navigationFixture("ConversationIndex", { activeMessageId: "synthetic-saved" });
  const toc = navigationFixture("ConversationToc", { activeMessageId: "synthetic-saved" });
  for (const { options } of [index, toc]) assert.equal(Object.hasOwn(options, "networkMode"), false);
  await index.options.queryFn(); await toc.options.queryFn({ pageParam: toc.options.initialPageParam });
  assert.equal(index.calls[0][0], "remote-index");
  assert.equal(toc.calls[0][0], "remote-toc");
  await disconnected(async client => {
    assert.equal(client.defaultQueryOptions(index.options).networkMode, "offlineFirst");
    assert.equal(client.defaultQueryOptions(toc.options).networkMode, "offlineFirst");
  }, { networkMode: "offlineFirst" });
});

test("supplied navigation items and readiness gates still disable local queries", () => {
  assert.equal(navigationFixture("ConversationIndex", { networkMode: "always", messages: [] }).options.enabled, false);
  assert.equal(navigationFixture("ConversationIndex", { networkMode: "always", ready: false }).options.enabled, false);
  assert.equal(navigationFixture("ConversationToc", { networkMode: "always", activeMessageId: "synthetic-saved", items: [] }).options.enabled, false);
  assert.equal(navigationFixture("ConversationToc", { networkMode: "always", activeMessageId: "synthetic-saved", ready: false }).options.enabled, false);
  assert.equal(navigationFixture("ConversationToc", { networkMode: "always" }).options.enabled, false);
});

for (const name of ["ConversationIndex", "ConversationToc"]) {
  test(`${name}: hidden navigation is disabled and a focus overlay shares the canonical anchor cache`, () => {
    const props = { networkMode: "always", sourceKey: "synthetic-local", activeMessageId: "synthetic-saved" };
    const hidden = navigationFixture(name, props, { visible: false, overlay: false });
    const visible = navigationFixture(name, props);
    const overlay = navigationFixture(name, props, { visible: true, overlay: true });
    assert.equal(hidden.options.enabled, false);
    assert.equal(visible.options.enabled, true);
    assert.equal(overlay.options.enabled, true);
    assert.deepEqual(overlay.options.queryKey, visible.options.queryKey);
    assert.equal(overlay.options.networkMode, "always");
  });
}

test("all four Reader navigation placements receive the source policy, without altering Share callers", () => {
  const navigationTags = ast => matches(ast, node =>
    (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
    && ["ConversationIndex", "ConversationToc"].includes(node.tagName.getText(ast)));
  const tags = navigationTags(reader);
  assert.equal(tags.length, 4);
  for (const tag of tags) {
    const attribute = tag.attributes.properties.find(node => ts.isJsxAttribute(node) && node.name.text === "networkMode");
    assert.equal(attribute?.initializer?.getText(reader), "{readerQueryNetworkMode}");
  }
  const share = parse("features/sharing/share-readonly-reader.tsx");
  const shareTags = navigationTags(share);
  assert.ok(shareTags.length > 0);
  assert.ok(shareTags.every(tag => !tag.attributes.properties.some(node => ts.isJsxAttribute(node) && node.name.text === "networkMode")));
});
